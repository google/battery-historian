// Copyright 2016 Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Package parseutils contains the state machine logic to analyze battery history.
package parseutils

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/golang/protobuf/proto"
	"github.com/google/battery-historian/checkinparse"
	"github.com/google/battery-historian/csv"
	"github.com/google/battery-historian/historianutils"
	"github.com/google/battery-historian/packageutils"

	usagepb "github.com/google/battery-historian/pb/usagestats_proto"
)

// These constants should be kept consistent with BatteryStats.java.
const (
	FormatBatteryLevel = "batteryLevel"
	FormatTotalTime    = "totalTime"

	BatteryStatsCheckinVersion = "9"
	HistoryStringPool          = "hsp"
	HistoryData                = "h"

	tsStringDefault       = "default"
	unknownScreenOnReason = "unknown screen on reason"

	// Strings related to Ecn broadcasts.
	ecnConnected    = `"CONNECTED"`
	ecnDisconnected = `"DISCONNECTED"`
	ecnSuspended    = `"SUSPENDED"`

	// Battery history event names.
	BatteryLevel  = "Battery Level"
	Charging      = "Charging on"
	Foreground    = "Foreground process"
	LongWakelocks = "Long Wakelocks"
	Plugged       = "Plugged"
	Top           = "Top app"
)

var (
	// ResetRE is a regular expression to match RESET event.
	ResetRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + "," + HistoryData + "," +
		"(?P<timeDelta>\\d+)" + ":RESET:TIME:(?P<timeStamp>\\d+)")

	// ShutdownRE is a regular expression to match SHUTDOWN event.
	ShutdownRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + "," + HistoryData + "," +
		"(?P<timeDelta>\\d+)" + ":SHUTDOWN")

	// StartRE is a regular expression to match START event.
	StartRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + "," + HistoryData + "," +
		"(?P<timeDelta>\\d+):" + "START")

	// TimeRE is a regular expression to match TIME event.
	TimeRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + "," + HistoryData + "," +
		"(?P<timeDelta>\\d+)" + ":TIME:(?P<timeStamp>\\d+)")

	// GenericHistoryLineRE is a regular expression to match any of the history lines.
	GenericHistoryLineRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + "," +
		HistoryData + "," + "(?P<timeDelta>\\d+).*")

	// GenericHistoryStringPoolLineRE is a regular expression to match any of the history string pool lines.
	GenericHistoryStringPoolLineRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + "," +
		HistoryStringPool + "," + "(?P<index>\\d+),(?P<uid>-?\\d+),(?P<service>.+)")

	// VersionLineRE is a regular expression to match the vers statement in the history log.
	VersionLineRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + `,\d+,i,vers,(?P<version>\d+),\d+,.*`)

	// DataRE is a regular expression to match the data event log.
	DataRE = regexp.MustCompile("(?P<transition>[+-]?)" + "(?P<key>\\w+)" + "(,?(=?(?P<value>\\S+))?)")

	// OverflowRE is a regular expression that matches OVERFLOW event.
	OverflowRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + "," + HistoryData + "," +
		"\\d+:\\*OVERFLOW\\*")

	// CheckinApkLineRE is a regular expression that matches the "apk" line in a checkin log.
	CheckinApkLineRE = regexp.MustCompile("(\\d+,)?(?P<uid>\\d+),l,apk,\\d+,(?P<pkgName>[^,]+),.*")

	// Constants defined in frameworks/base/core/java/android/net/ConnectivityManager.java
	connConstants = map[string]string{
		"-1": "TYPE_NONE",             // The absence of a connection type.
		"0":  "TYPE_MOBILE",           // The Mobile data connection.
		"1":  "TYPE_WIFI",             // The WIFI data connection.
		"2":  "TYPE_MOBILE_MMS",       // An MMS-specific Mobile data connection.
		"3":  "TYPE_MOBILE_SUPL",      // A SUPL-specific Mobile data connection.
		"4":  "TYPE_MOBILE_DUN",       // A DUN-specific Mobile data connection.
		"5":  "TYPE_MOBILE_HIPRI",     // A High Priority Mobile data connection.
		"6":  "TYPE_WIMAX",            // The WiMAX data connection.
		"7":  "TYPE_BLUETOOTH",        // The Bluetooth data connection.
		"8":  "TYPE_DUMMY",            // Dummy data connection.  This should not be used on shipping devices.
		"9":  "TYPE_ETHERNET",         // The Ethernet data connection.
		"10": "TYPE_MOBILE_FOTA",      // Over the air Administration.
		"11": "TYPE_MOBILE_IMS",       // IP Multimedia Subsystem.
		"12": "TYPE_MOBILE_CBS",       // Carrier Branded Services.
		"13": "TYPE_WIFI_P2P",         // A Wi-Fi p2p connection.
		"14": "TYPE_MOBILE_IA",        // The network to use for initially attaching to the network.
		"15": "TYPE_MOBILE_EMERGENCY", // Emergency PDN connection for emergency services.  This may include IMS and MMS in emergency situations.
		"16": "TYPE_PROXY",            // The network that uses proxy to achieve connectivity.
		"17": "TYPE_VPN",              // A virtual network using one or more native bearers.
	}

	// Constants defined in frameworks/base/telephony/java/android/telephony/SignalStrength.java
	signalStrengthConstants = map[string]string{
		"0": "none",
		"1": "poor",
		"2": "moderate",
		"3": "good",
		"4": "great",
	}
)

// ServiceUID contains the identifying service for battery operations.
type ServiceUID struct {
	Start int64
	// We are treating UIDs as strings.
	Service, UID string
	Pkg          *usagepb.PackageInfo
}

// Dist is a distribution summary for a battery metric.
type Dist struct {
	Num           int32
	TotalDuration time.Duration
	MaxDuration   time.Duration
}

// addDuration adds the given duration to the total Dist duration, incrementing Num, and updating MaxDuration if necessary.
func (d *Dist) addDuration(dur time.Duration) {
	d.Num++
	d.TotalDuration += dur
	if dur > d.MaxDuration {
		d.MaxDuration = dur
	}
}

// DCPU are CPU related statistics that detail the entire previous discharge step.
// Each DCPU comes after the change of Battery Level, it records detailed information
// about app and corresponding userTime and systemTime for each battery level step.
type DCPU struct {
	BatteryLevel int // BatteryLevel here is the starting battery level before battery drop.
	Start        int64
	Duration     time.Duration
	// We name the following fields exactly the same as in BatteryStats.java.
	// In Battery History, time spent in user space and the kernel since the last step.
	UserTime   time.Duration
	SystemTime time.Duration

	// Top three apps using CPU in the last step.
	CPUUtilizers []AppCPUUsage
}

// AppCPUUsage is per app cpu usage in DCPU.
// It also implements the csv.EntryState interface.
type AppCPUUsage struct {
	start int64

	pkgName    string
	UID        string
	UserTime   time.Duration
	SystemTime time.Duration
}

// GetStartTime returns the start time of the entry.
func (p *AppCPUUsage) GetStartTime() int64 {
	return p.start
}

// GetType returns the type of the entry.
func (p *AppCPUUsage) GetType() string {
	return "summary"
}

// GetValue returns the stored value of the entry.
func (p *AppCPUUsage) GetValue() string {
	n := p.pkgName
	if n == "" {
		n = fmt.Sprintf("UID %s", p.UID)
	}
	return fmt.Sprintf("%s~%s~%s", n, p.UserTime, p.SystemTime)
}

// GetKey returns the unique identifier for the entry.
func (p *AppCPUUsage) GetKey(metric string) csv.Key {
	return csv.Key{
		Metric:     metric,
		Identifier: fmt.Sprintf("%s(%d)", p.UID, p.start),
	}
}

func (s *DCPU) initStart(curTime int64) {
	if s.Start != 0 {
		s.Start = curTime
	}
}

// DPST are Process related statistics that detail the entire previous discharge step.
// Each DPST comes after the change of Battery Level, it records detailed information
// about Proc/stats for each battery level step.
type DPST struct {
	BatteryLevel int // BatteryLevel here is the starting battery level before battery drop.
	Start        int64
	Duration     time.Duration
	// We name the following fields exactly the same as in BatteryStats.java.
	// Information from /proc/stat.
	StatUserTime    time.Duration
	StatSystemTime  time.Duration
	StatIOWaitTime  time.Duration
	StatIrqTime     time.Duration
	StatSoftIrqTime time.Duration
	StatIdlTime     time.Duration
}

func (s *DPST) initStart(curTime int64) {
	if s.Start != 0 {
		s.Start = curTime
	}
}

// Voter represents a voter for one of the low power states.
type Voter struct {
	// Name of the voter.
	Name string
	// Time the voter spent voting for its power state.
	Time time.Duration
	// How many times the voter had a 'yes' vote.
	Count int32
}

// PowerState represents one of the low power states that the CPU can go into.
type PowerState struct {
	// BatteryLevel is the starting battery level before battery drop.
	batteryLevel int

	// Start time of the battery level drop
	start int64

	// Level of the power state. A higher level represents a deeper (less power consuming) state.
	Level int32
	// Name of the power state.
	Name string
	// Voters for this particular power state.
	Voters []Voter
	// Time spent in this state
	Time time.Duration
	// Count is how many times this state was entered.
	Count int32
}

// GetStartTime returns the start time of the entry.
func (p *PowerState) GetStartTime() int64 {
	return p.start
}

// GetType returns the type of the entry.
func (p *PowerState) GetType() string {
	return "summary"
}

// GetValue returns the stored value of the entry.
func (p *PowerState) GetValue() string {
	return fmt.Sprintf("%s~%s~%d", p.Name, p.Time, p.Count)
}

// GetKey returns the unique identifier for the entry.
func (p *PowerState) GetKey(metric string) csv.Key {
	return csv.Key{
		Metric:     metric,
		Identifier: fmt.Sprintf("%s(%d)", p.Name, p.batteryLevel),
	}
}

// csvLogVoterEntries returns a list of csv.Entries that indicate the voting record for the PowerState.
func (p *PowerState) csvLogVoterEntries() []csv.Entry {
	var ce []csv.Entry
	for _, v := range p.Voters {
		ce = append(ce, csv.Entry{
			Desc:  fmt.Sprintf("%s(%s)", p.Name, v.Name),
			Start: p.start,
			Type:  "float",
			Value: fmt.Sprintf("%.3f", v.Time.Minutes()),
		})
	}
	return ce
}

// powerStateTimer is a wrapper struct around PowerState to allow saving only the timing info to CSV.
type powerStateTimer struct {
	PowerState
}

// GetType returns the type of the entry.
func (p *powerStateTimer) GetType() string {
	return "float"
}

// GetValue returns the stored value of the entry.
func (p *powerStateTimer) GetValue() string {
	return fmt.Sprintf("%.3f", p.Time.Minutes())
}

// rpmStatsGroupEntry returns a csv.Entry that can be used to group rpm lines in the Historian timeline.
func rpmStatsGroupEntry(ps []*PowerState) csv.Entry {
	var n []string
	var s int64
	for _, p := range ps {
		n = append(n, p.Name)
		for _, v := range p.Voters {
			n = append(n, fmt.Sprintf("%s(%s)", p.Name, v.Name))
		}
		s = p.start
	}
	return csv.Entry{
		Desc:  "RPM Stats",
		Start: s,
		Type:  "group",
		Value: strings.Join(n, "|"),
		Opt:   "minutes",
	}
}

// voterByName sorts voters by their name in ascending order.
type voterByName []Voter

func (a voterByName) Len() int      { return len(a) }
func (a voterByName) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a voterByName) Less(i, j int) bool {
	return a[i].Name < a[j].Name
}

// Calculate total duration of sync time without breaking down by apps.
func calTotalSync(state *DeviceState) Dist {
	var d Dist
	d.Num = int32(len(state.syncIntervals))

	// merge intervals
	var intervals []csv.Event
	if d.Num > 0 {
		intervals = csv.MergeEvents(state.syncIntervals)
	}

	// loop through intervals to gather total sync time
	for _, i := range intervals {
		duration := time.Duration(i.End-i.Start) * time.Millisecond
		d.TotalDuration += duration
		// the max duration here is the merged intervals' max duration
		if duration > d.MaxDuration {
			d.MaxDuration = duration
		}
	}
	return d
}

// addSummaryEntry adds an event spanning a time interval from suid.Start to curTime into summary map.
func (s *ServiceUID) addSummaryEntry(curTime int64, suid *ServiceUID, summary map[string]Dist) {
	d := summary[s.Service]
	if duration := time.Duration(curTime-suid.Start) * time.Millisecond; duration > 0 {
		d.addDuration(duration)
		summary[s.Service] = d
	}
}

// Counts on negative transitions
func (s *ServiceUID) assign(curTime int64, summaryActive, logEvent bool, summaryStartTime int64, activeMap map[string]*ServiceUID, summary map[string]Dist, tr, value, desc string, csv *csv.State) error {

	_, alreadyActive := activeMap[value]
	appID, err := packageutils.AppIDFromString(s.UID)
	if err != nil {
		return err
	}
	switch tr {
	case "":
		// The entity was already active when the summary was taken,
		// so count the active time since the beginning of the summary.
		s.Start = summaryStartTime
		activeMap[value] = s

	case "+":
		if alreadyActive {
			return fmt.Errorf("two positive transitions seen for %q", desc)
		}
		// To avoid saying an event occurred before the summary start time. This could happen in the
		// long wakelock case, where we calculate back when the wakelock actually started.
		curTime = historianutils.MaxInt64(curTime, summaryStartTime)
		s.Start = curTime
		activeMap[value] = s

	case "-":
		if !alreadyActive {
			if summary[s.Service].Num != 0 {
				return fmt.Errorf("two negative transitions for %q:%q", desc, tr)
			}
			// There was no + transition for this, so assuming that it was
			// already active at the beginning of the summary period.
			s.Start = summaryStartTime
			activeMap[value] = s
			if logEvent {
				csv.AddEntryWithOpt(desc, s, s.Start, fmt.Sprint(appID))
			}
		}
		if summaryActive && logEvent {
			s.addSummaryEntry(curTime, activeMap[value], summary)
		}
		delete(activeMap, value)

	default:
		return fmt.Errorf("unknown transition for %q:%q", desc, tr)
	}
	if logEvent {
		// We need to keep the raw UID so that services can be sufficiently distinguished in the csv
		// mapping, but Battery Historian only deals with app IDs (with the user ID removed) so we have to make
		// sure the csv prints only the app ID.
		csv.AddEntryWithOpt(desc, s, curTime, fmt.Sprint(appID))
	}
	return nil
}

func (s *ServiceUID) initStart(curTime int64) {
	if s.Start != 0 {
		s.Start = curTime
	}
}

func (s *ServiceUID) updateSummary(curTime int64, summaryActive bool, summaryStartTime int64, summary map[string]Dist) {
	if s.Start == 0 {
		s.Start = summaryStartTime
	}
	if summaryActive {
		d := summary[s.Service]
		duration := time.Duration(curTime-s.Start) * time.Millisecond
		d.addDuration(duration)
		summary[s.Service] = d
	}
	s.Start = curTime
}

// GetStartTime returns the start time of the entry.
func (s *ServiceUID) GetStartTime() int64 {
	return s.Start
}

// GetType returns the type of the entry.
func (s *ServiceUID) GetType() string {
	return "service"
}

// GetValue returns the stored service for the entry.
func (s *ServiceUID) GetValue() string {
	return s.Service
}

// GetKey returns the unique identifier for the entry.
// UIDs can have multiple service names, and different UIDs can use the
// same service name, so we use the UID/Service name pair as the key.
func (s *ServiceUID) GetKey(desc string) csv.Key {
	return csv.Key{
		desc,
		fmt.Sprintf("%s:%s", s.UID, s.Service),
	}
}

// tsInt contains an integer state with initial timestamp in ms.
type tsInt struct {
	Start int64
	Value int
}

func (s *tsInt) assign(curTime int64, value string, summaryActive bool, desc string, csv *csv.State) error {
	parsedInt, err := strconv.Atoi(value)
	if err != nil {
		return fmt.Errorf("parsing int error for %q", desc)
	}
	csv.AddEntry(desc, s, curTime)
	s.Value = parsedInt
	s.Start = curTime
	csv.AddEntry(desc, s, curTime)
	return nil
}

func (s *tsInt) initStart(curTime int64) {
	if s.Start != 0 {
		s.Start = curTime
	}
}

// GetStartTime returns the start time of the entry.
func (s *tsInt) GetStartTime() int64 {
	return s.Start
}

// GetType returns the type of the entry.
func (s *tsInt) GetType() string {
	return "int"
}

// GetValue returns the stored service for the entry.
func (s *tsInt) GetValue() string {
	return strconv.Itoa(s.Value)
}

// GetKey returns the unique identifier for the entry.
func (s *tsInt) GetKey(desc string) csv.Key {
	return csv.Key{
		desc,
		"",
	}
}

// tsBool contains a bool state with initial timestamp in ms.
type tsBool struct {
	Start int64
	Value bool
	data  string // Any extra data associated with this bool
}

// Counts on negative transitions only, as some booleans just indicate a state
func (s *tsBool) assign(curTime int64, summaryActive bool, summaryStartTime int64, summary *Dist, tr, desc string, csv *csv.State) error {
	isOn := false
	switch tr {
	case "+":
		isOn = true
	case "-":
		if !s.Value {
			if summary.Num != 0 {
				return fmt.Errorf("two negative transitions for %q:%q", desc, tr)
			}
			// First negative transition for an event that was in progress at start.
			s.Value = true
			// Set the start time so the csv entry stores the correct value.
			s.Start = summaryStartTime
			csv.AddEntryWithOpt(desc, s, s.Start, s.data)
		}
	default:
		return fmt.Errorf("unknown transition for %q:%q", desc, tr)
	}

	if s.Start == 0 {
		s.Start = summaryStartTime
	}
	// On -> Off
	if !isOn && s.Value {
		if summaryActive {
			duration := time.Duration(curTime-s.Start) * time.Millisecond
			if duration > 0 {
				summary.addDuration(duration)
			}
		}
		s.Value = false
		csv.AddEntryWithOpt(desc, s, curTime, s.data)
	}

	// Off -> On
	if isOn && !s.Value {
		s.Value = true
		csv.AddEntryWithOpt(desc, s, curTime, s.data)
	}
	// Note the time the new state starts
	s.Start = curTime
	return nil
}

func (s *tsBool) initStart(curTime int64) {
	if s.Start != 0 {
		s.Start = curTime
	}
}

func (s *tsBool) updateSummary(curTime int64, summaryActive bool, summaryStartTime int64, summary *Dist) {
	if s.Start == 0 {
		s.Start = summaryStartTime
	}

	if s.Value {
		if summaryActive {
			duration := time.Duration(curTime-s.Start) * time.Millisecond
			summary.addDuration(duration)
		}
		s.Start = curTime
	}
}

// GetStartTime returns the start time of the entry.
func (s *tsBool) GetStartTime() int64 {
	return s.Start
}

// GetType returns the type of the entry.
func (s *tsBool) GetType() string {
	return "bool"
}

// GetValue returns the stored service for the entry.
func (s *tsBool) GetValue() string {
	if s.Value {
		return "true"
	}
	return "false"
}

// GetKey returns the unique identifier for the entry.
func (s *tsBool) GetKey(desc string) csv.Key {
	return csv.Key{
		desc,
		"",
	}
}

// tsString contains a string state with initial timestamp in ms
type tsString struct {
	Start int64
	Value string
}

func (s *tsString) assign(curTime int64, summaryActive bool, summaryStartTime int64, summary map[string]Dist, value, desc string, csv *csv.State) error {
	if s.Start == 0 {
		s.Start = summaryStartTime
	}
	if s.Value != value {
		if s.Value != tsStringDefault {
			csv.AddEntry(desc, s, curTime)
		}
		if summaryActive && s.Value != "" {
			d := summary[s.Value]
			duration := time.Duration(curTime-s.Start) * time.Millisecond
			if duration > 0 {
				d.addDuration(duration)
				summary[s.Value] = d
			}
		}
		// Note the time the new state starts
		s.Start = curTime
		s.Value = value
		csv.AddEntry(desc, s, curTime)
	}

	return nil
}

func (s *tsString) initStart(curTime int64) {
	if s.Start != 0 {
		s.Start = curTime
	}
}

func (s *tsString) updateSummary(curTime int64, summaryActive bool, summaryStartTime int64, summary map[string]Dist) {
	if s.Start == 0 {
		s.Start = summaryStartTime
	}

	if s.Value == "" {
		s.Value = tsStringDefault
	}

	if summaryActive {
		d := summary[s.Value]
		duration := time.Duration(curTime-s.Start) * time.Millisecond
		d.addDuration(duration)
		summary[s.Value] = d
	}
	s.Start = curTime
}

// GetStartTime returns the start time of the entry.
func (s *tsString) GetStartTime() int64 {
	return s.Start
}

// GetType returns the type of the entry.
func (s *tsString) GetType() string {
	return "string"
}

// GetValue returns the stored service for the entry.
func (s *tsString) GetValue() string {
	return s.Value
}

// GetKey returns the unique identifier for the entry.
func (s *tsString) GetKey(desc string) csv.Key {
	return csv.Key{
		desc,
		"",
	}
}

func (d *Dist) csv() string {
	return fmt.Sprintf("%d,%d", d.Num, int64(d.TotalDuration/time.Millisecond))
}

// DeviceState maintains the instantaneous state of the device created using battery history events.
//
// All fields of this type must have corresponding initialization code in initStartTimeForAllStates()
type DeviceState struct {
	CurrentTime        int64
	LastWakeupTime     int64         // To deal with asynchronous arrival of wake reasons
	LastWakeupDuration time.Duration // To deal with asynchronous arrival
	isDpstEvent        bool          // To determine whether the key is a part of Dpst's value
	dpstTokenIndex     int           // To determine the token's index in Dpst
	lastBatteryLevel   tsInt         // To handle summary data that is printed after the battery level changes.
	// The power state summary is printed as an aggregate since boot, so we need to track
	// the cummulative in order to split the summary per battery level or discharge session.
	CummulativePowerState map[string]*PowerState
	// The first Power State value logged in the report. Used to provide a base reference for the timeline values.
	InitialPowerState map[string]*PowerState

	// Instanteous state
	Temperature   tsInt
	Voltage       tsInt
	BatteryLevel  tsInt
	Brightness    tsInt
	CoulombCharge tsInt

	PhoneState          tsString
	DataConnection      tsString // hspa, hspap, lte
	PlugType            tsString
	ChargingStatus      tsString
	Health              tsString
	WifiSuppl           tsString // dsc, scan, group, compl
	PhoneSignalStrength tsString
	WifiSignalStrength  tsString
	UserRunning         tsString
	UserForeground      tsString
	IdleMode            tsString
	//WakeLockType tsString // Alarm, WAlarm

	// Device State metrics from BatteryStats
	CPURunning      tsBool
	SensorOn        tsBool
	GpsOn           tsBool
	WifiFullLock    tsBool
	WifiScan        tsBool
	WifiMulticastOn tsBool
	MobileRadioOn   tsBool
	WifiOn          tsBool
	WifiRadio       tsBool
	WifiRunning     tsBool
	PhoneScanning   tsBool
	BLEScanning     tsBool
	ScreenOn        tsBool
	Plugged         tsBool
	PhoneInCall     tsBool
	WakeLockHeld    tsBool
	FlashlightOn    tsBool
	ChargingOn      tsBool
	CameraOn        tsBool
	VideoOn         tsBool
	AudioOn         tsBool
	LowPowerModeOn  tsBool
	// SyncOn       tsBool

	WakeLockHolder ServiceUID
	WakeupReason   ServiceUID

	syncIntervals []csv.Event

	// Map of uid -> serviceUID for all active entities
	ActiveProcessMap     map[string]*ServiceUID
	AppSyncingMap        map[string]*ServiceUID
	ForegroundProcessMap map[string]*ServiceUID
	TopApplicationMap    map[string]*ServiceUID // There can only be one on top, so the map will have just one entry
	// Connectivity changes are represented in the history log like other applications.
	// For example, we get lines like 9,hsp,3,1,"CONNECTED" and 9,hsp,28,1,"DISCONNECTED",
	// so they are processed and read into ServiceUID objects by the code down in
	// analyzeHistoryLine. So even though changes aren't specific to an app, for the sake
	// of simplicity, they are processed like the rest.
	ConnectivityMap map[string]*ServiceUID
	LongWakelockMap map[string]*ServiceUID
	ScheduledJobMap map[string]*ServiceUID
	TmpWhiteListMap map[string]*ServiceUID // TmpWhiteList contains apps that are given temporary network access after receiving a high priority GCM message.

	// If wakelock_in events are not available, then only the first entity to acquire a
	// wakelock gets charged, so the map will have just one entry
	WakeLockMap map[string]*ServiceUID

	// device state for a debugging event
	AlarmMap map[string]*ServiceUID

	// Statistics that detail the entire previous discharge step
	DpstStats DPST
	DcpuStats DCPU

	// Event names
	/*
	   EventNull tsBool
	   EventProc ServiceUID
	   EventFg   ServiceUID
	   EventTop  ServiceUID
	   EventSy   ServiceUID
	*/

	// Not implemented yet
	BluetoothOn tsBool
}

// initStartTimeForAllStates is used when the device transitions from charging
// battery state to discharging. At this time, we don't want to reset the
// state variables, just start accounting from this time. So if a wakelock
// has been held (or a screen turned on) for some time, we want to discount
// any time prior to the event of the device being unplugged,
// but still remember what state the device is in and initialize the time.
func (state *DeviceState) initStartTimeForAllStates() {
	state.Temperature.initStart(state.CurrentTime)
	state.Voltage.initStart(state.CurrentTime)
	state.BatteryLevel.initStart(state.CurrentTime)
	state.Brightness.initStart(state.CurrentTime)
	state.CoulombCharge.initStart(state.CurrentTime)
	state.PhoneSignalStrength.initStart(state.CurrentTime)
	state.PhoneState.initStart(state.CurrentTime)
	state.DataConnection.initStart(state.CurrentTime)
	state.PlugType.initStart(state.CurrentTime)
	state.ChargingStatus.initStart(state.CurrentTime)
	state.Health.initStart(state.CurrentTime)
	state.CPURunning.initStart(state.CurrentTime)
	state.SensorOn.initStart(state.CurrentTime)
	state.GpsOn.initStart(state.CurrentTime)
	state.WifiFullLock.initStart(state.CurrentTime)
	state.WifiScan.initStart(state.CurrentTime)
	state.WifiMulticastOn.initStart(state.CurrentTime)
	state.MobileRadioOn.initStart(state.CurrentTime)
	state.WifiOn.initStart(state.CurrentTime)
	state.WifiRadio.initStart(state.CurrentTime)
	state.WifiRunning.initStart(state.CurrentTime)
	state.PhoneScanning.initStart(state.CurrentTime)
	state.BLEScanning.initStart(state.CurrentTime)
	state.ScreenOn.initStart(state.CurrentTime)
	state.Plugged.initStart(state.CurrentTime)
	state.PhoneInCall.initStart(state.CurrentTime)
	state.WakeLockHeld.initStart(state.CurrentTime)
	state.WakeLockHolder.initStart(state.CurrentTime)
	state.WakeupReason.initStart(state.CurrentTime)
	state.BluetoothOn.initStart(state.CurrentTime)
	state.VideoOn.initStart(state.CurrentTime)
	state.AudioOn.initStart(state.CurrentTime)
	state.CameraOn.initStart(state.CurrentTime)
	state.LowPowerModeOn.initStart(state.CurrentTime)
	state.IdleMode.initStart(state.CurrentTime)
	state.FlashlightOn.initStart(state.CurrentTime)
	state.ChargingOn.initStart(state.CurrentTime)
	state.WifiSuppl.initStart(state.CurrentTime)
	state.WifiSignalStrength.initStart(state.CurrentTime)
	state.DcpuStats.initStart(state.CurrentTime)
	state.DpstStats.initStart(state.CurrentTime)

	for _, s := range state.ActiveProcessMap {
		s.initStart(state.CurrentTime)
	}
	for _, s := range state.AppSyncingMap {
		s.initStart(state.CurrentTime)
	}
	for _, s := range state.ForegroundProcessMap {
		s.initStart(state.CurrentTime)
	}
	for _, s := range state.TopApplicationMap {
		s.initStart(state.CurrentTime)
	}
	for _, s := range state.ConnectivityMap {
		s.initStart(state.CurrentTime)
	}

	for _, s := range state.LongWakelockMap {
		s.initStart(state.CurrentTime)
	}

	for _, s := range state.WakeLockMap {
		s.initStart(state.CurrentTime)
	}

	for _, s := range state.ScheduledJobMap {
		s.initStart(state.CurrentTime)
	}

	for _, s := range state.TmpWhiteListMap {
		s.initStart(state.CurrentTime)
	}

	for _, s := range state.AlarmMap {
		s.initStart(state.CurrentTime)
	}
}

// topApp returns the current app on top.
func (state *DeviceState) topApp() (*ServiceUID, error) {
	m := state.TopApplicationMap
	switch len(m) {
	case 0: // No active app.
		return nil, nil
	case 1: // The expected case.
		// Even in multi-window mode, the battery history only lists one app as being the top app.
		for _, suid := range m {
			return suid, nil
		}
		return nil, errors.New("unreachable code")
	default:
		return nil, fmt.Errorf("too many apps simultaneously on top: (|TopApplicationMap| = %d)", len(m))
	}
}

// newDeviceState returns a new properly initialized DeviceState structure.
func newDeviceState() *DeviceState {
	return &DeviceState{
		ActiveProcessMap:      make(map[string]*ServiceUID),
		AppSyncingMap:         make(map[string]*ServiceUID),
		ForegroundProcessMap:  make(map[string]*ServiceUID),
		TopApplicationMap:     make(map[string]*ServiceUID),
		ConnectivityMap:       make(map[string]*ServiceUID),
		LongWakelockMap:       make(map[string]*ServiceUID),
		WakeLockMap:           make(map[string]*ServiceUID),
		ScheduledJobMap:       make(map[string]*ServiceUID),
		TmpWhiteListMap:       make(map[string]*ServiceUID),
		AlarmMap:              make(map[string]*ServiceUID),
		ScreenOn:              tsBool{data: unknownScreenOnReason},
		CummulativePowerState: make(map[string]*PowerState),
		InitialPowerState:     make(map[string]*PowerState),
	}
}

// ActivitySummary contains battery statistics during an aggregation interval.
// Each entry in here should have a corresponding value in session.proto:Summary.
type ActivitySummary struct {
	Reason              string
	Active              bool
	StartTimeMs         int64 // Millis
	EndTimeMs           int64 // Millis
	InitialBatteryLevel int
	FinalBatteryLevel   int
	SummaryFormat       string

	PluggedInSummary     Dist
	ScreenOnSummary      Dist
	MobileRadioOnSummary Dist
	WifiOnSummary        Dist
	CPURunningSummary    Dist

	GpsOnSummary           Dist
	SensorOnSummary        Dist
	WifiScanSummary        Dist
	WifiFullLockSummary    Dist
	WifiRadioSummary       Dist
	WifiRunningSummary     Dist
	WifiMulticastOnSummary Dist

	AudioOnSummary        Dist
	CameraOnSummary       Dist
	VideoOnSummary        Dist
	LowPowerModeOnSummary Dist
	FlashlightOnSummary   Dist
	ChargingOnSummary     Dist

	PhoneCallSummary Dist
	PhoneScanSummary Dist

	BLEScanSummary Dist

	// Stats for total syncs without breaking down by apps.
	TotalSyncSummary Dist

	// Stats for each individual state.
	DataConnectionSummary    map[string]Dist // LTE, HSPA
	ConnectivitySummary      map[string]Dist
	ForegroundProcessSummary map[string]Dist
	ActiveProcessSummary     map[string]Dist
	LongWakelockSummary      map[string]Dist
	TopApplicationSummary    map[string]Dist
	PerAppSyncSummary        map[string]Dist
	WakeupReasonSummary      map[string]Dist
	ScheduledJobSummary      map[string]Dist
	TmpWhiteListSummary      map[string]Dist
	IdleModeSummary          map[string]Dist

	HealthSummary              map[string]Dist
	PlugTypeSummary            map[string]Dist
	ChargingStatusSummary      map[string]Dist // c, d, n, f
	PhoneStateSummary          map[string]Dist
	WakeLockSummary            map[string]Dist
	WakeLockDetailedSummary    map[string]Dist
	WifiSupplSummary           map[string]Dist
	PhoneSignalStrengthSummary map[string]Dist
	WifiSignalStrengthSummary  map[string]Dist
	UserRunningSummary         map[string]Dist
	UserForegroundSummary      map[string]Dist

	// DpstStatsSummary and DcpuStatsSummary shows details of
	// app cpu usage and proc stats in each battery steps.
	DpstStatsSummary  []DPST
	DcpuStatsSummary  []DCPU
	PowerStateSummary []PowerState

	// An aggregated summary for DpstStatsSummary and
	// DcpuStatsSummary in the whole summary duration.
	DpstOverallSummary map[string]time.Duration
	DcpuOverallSummary map[string]time.Duration

	PowerStateOverallSummary map[string]PowerState

	// device state for debug
	AlarmSummary map[string]Dist

	Date string
}

func (s *ActivitySummary) appendPowerState(ps *PowerState) error {
	s.PowerStateSummary = append(s.PowerStateSummary, *ps)

	// Add to overall summary
	if po, ok := s.PowerStateOverallSummary[ps.Name]; ok {
		if ps.Level != po.Level {
			return fmt.Errorf("power state levels are different. ps = %d, po = %d", ps.Level, po.Level)
		}
		if ps.Name != po.Name {
			return fmt.Errorf("power state names are different. ps = %q, po = %q", ps.Name, po.Name)
		}
		svl := len(ps.Voters)
		if svl != len(po.Voters) {
			return fmt.Errorf("power states have different number of voters. ps has %d, po has %d", svl, len(po.Voters))
		}
		p := PowerState{
			// Level and name should stay the same
			Level: po.Level,
			Name:  po.Name,

			Time:  po.Time + ps.Time,
			Count: po.Count + ps.Count,
		}
		sort.Sort(voterByName(po.Voters))
		sort.Sort(voterByName(ps.Voters))
		for i := 0; i < svl; i++ {
			m, s := po.Voters[i], ps.Voters[i]
			if m.Name != s.Name {
				return fmt.Errorf("power state voter #%d names are different. ps.V = %q, po.V = %q", i, s.Name, m.Name)
			}
			p.Voters = append(p.Voters, Voter{
				// Name should stay the same.
				Name: m.Name,

				Time:  m.Time + s.Time,
				Count: m.Count + s.Count,
			})
		}
		s.PowerStateOverallSummary[p.Name] = p
	} else {
		s.PowerStateOverallSummary[ps.Name] = *ps
	}
	return nil
}

// newActivitySummary returns a new properly initialized ActivitySummary structure.
func newActivitySummary(summaryFormat string) *ActivitySummary {
	return &ActivitySummary{
		Active:                     true,
		SummaryFormat:              summaryFormat,
		InitialBatteryLevel:        -1,
		IdleModeSummary:            make(map[string]Dist),
		DataConnectionSummary:      make(map[string]Dist),
		ConnectivitySummary:        make(map[string]Dist),
		ForegroundProcessSummary:   make(map[string]Dist),
		ActiveProcessSummary:       make(map[string]Dist),
		TopApplicationSummary:      make(map[string]Dist),
		PerAppSyncSummary:          make(map[string]Dist),
		WakeupReasonSummary:        make(map[string]Dist),
		HealthSummary:              make(map[string]Dist),
		PlugTypeSummary:            make(map[string]Dist),
		ChargingStatusSummary:      make(map[string]Dist),
		LongWakelockSummary:        make(map[string]Dist),
		PhoneStateSummary:          make(map[string]Dist),
		WakeLockSummary:            make(map[string]Dist),
		WakeLockDetailedSummary:    make(map[string]Dist),
		ScheduledJobSummary:        make(map[string]Dist),
		TmpWhiteListSummary:        make(map[string]Dist),
		WifiSupplSummary:           make(map[string]Dist),
		PhoneSignalStrengthSummary: make(map[string]Dist),
		WifiSignalStrengthSummary:  make(map[string]Dist),
		AlarmSummary:               make(map[string]Dist),
		UserRunningSummary:         make(map[string]Dist),
		UserForegroundSummary:      make(map[string]Dist),
		PowerStateOverallSummary:   make(map[string]PowerState),
		DcpuOverallSummary:         make(map[string]time.Duration),
		DpstOverallSummary: map[string]time.Duration{
			"usr":  0,
			"sys":  0,
			"io":   0,
			"irq":  0,
			"sirq": 0,
			"idle": 0,
		},
	}
}

// MultiDist is a named distribution summary for a battery metric.
type MultiDist struct {
	Name string
	Stat Dist
}

// SortByTimeAndCount sorts MultiDist in descending order of TotalDuration.
type SortByTimeAndCount []MultiDist

func (a SortByTimeAndCount) Len() int      { return len(a) }
func (a SortByTimeAndCount) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a SortByTimeAndCount) Less(i, j int) bool {
	if a[i].Stat.TotalDuration != a[j].Stat.TotalDuration {
		// Sort order is time followed by count
		return a[i].Stat.TotalDuration < a[j].Stat.TotalDuration
	}
	return a[i].Stat.Num < a[j].Stat.Num
}

// concludeActiveFromState summarizes all activeProcesses, syncs running, apps on top, etc.
func concludeActiveFromState(state *DeviceState, summary *ActivitySummary) (*DeviceState, *ActivitySummary) {
	// Battery level: Bl **
	if state.BatteryLevel.Value != summary.FinalBatteryLevel {
		// Throw: Logical error as summary.FinalBatteryLevel should already be up to date
		state.BatteryLevel.Start = state.CurrentTime
	}

	//////////////// Boolean States ////////////

	// CPURunning: r **
	state.CPURunning.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.CPURunningSummary)

	// Screen: S **
	state.ScreenOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.ScreenOnSummary)

	// Phone in call: Pcl **
	state.PhoneInCall.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.PhoneCallSummary)

	// Mobile Radio: Pr **
	state.MobileRadioOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.MobileRadioOnSummary)

	// Phone scanning: Psc **
	state.PhoneScanning.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.PhoneScanSummary)

	// BLE scanning: bles **
	state.BLEScanning.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.BLEScanSummary)

	// Wifi: W **
	state.WifiOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.WifiOnSummary)

	// Wifi Full lock: Wl **
	state.WifiFullLock.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.WifiFullLockSummary)

	// Wifi Radio: Wr **
	state.WifiRadio.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.WifiRadioSummary)

	// Wifi Running: Ww **
	state.WifiRunning.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.WifiRunningSummary)

	// Plugged: BP
	state.Plugged.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.PluggedInSummary)

	// GPS: g
	state.GpsOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.GpsOnSummary)

	// Sensor: s
	state.SensorOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.SensorOnSummary)

	// Wifi Scan: Ws
	state.WifiScan.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.WifiScanSummary)

	// Wifi Multicast: Wm
	state.WifiMulticastOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.WifiMulticastOnSummary)

	// Idle Mode: di
	state.IdleMode.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.IdleModeSummary)

	// Audio: a
	state.AudioOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.AudioOnSummary)

	// Camera: ca
	state.CameraOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.CameraOnSummary)

	// Flashlight: fl
	state.FlashlightOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.FlashlightOnSummary)

	// Video: v
	state.VideoOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.VideoOnSummary)

	// Charging: ch
	state.ChargingOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.ChargingOnSummary)

	//////////////// String States ////////////

	// Phone state: Pst
	state.PhoneState.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.PhoneStateSummary)

	// Data Connection: Pcn **
	state.DataConnection.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.DataConnectionSummary)

	// Plug type: Bp
	state.PlugType.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.PlugTypeSummary)

	// Charging status: Bs
	state.ChargingStatus.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.ChargingStatusSummary)

	// Battery Health: Bh
	state.Health.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.HealthSummary)

	// Wifi Supplicant: Wsp
	state.WifiSuppl.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.WifiSupplSummary)

	// Phone Signal Strength: Pss
	state.PhoneSignalStrength.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.PhoneSignalStrengthSummary)

	// Wifi Signal Strength: Wss
	state.WifiSignalStrength.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.WifiSignalStrengthSummary)

	/////////////////////////
	// wake_reason: wr **
	if state.WakeupReason.Service != "" {
		state.WakeupReason.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.WakeupReasonSummary)
	}

	// wake_lock: w **
	if state.WakeLockHeld.Value {
		state.WakeLockHolder.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.WakeLockSummary)
	}

	///////////////////

	// Active processes: Epr **
	for _, suid := range state.ActiveProcessMap {
		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.ActiveProcessSummary)
	}

	// Foreground processes: Efg **
	for _, suid := range state.ForegroundProcessMap {
		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.ForegroundProcessSummary)
	}

	// Top application: Etp **
	for _, suid := range state.TopApplicationMap {
		if suid.Start < state.CurrentTime {
			suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.TopApplicationSummary)
		}
	}

	// Sync application: Esy **
	for _, suid := range state.AppSyncingMap {
		var start int64
		if suid.Start == 0 {
			start = summary.StartTimeMs
		} else {
			start = suid.Start
		}
		if summary.Active {
			i := csv.Event{Start: start, End: state.CurrentTime}
			state.syncIntervals = append(state.syncIntervals, i)
		}

		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.PerAppSyncSummary)
	}

	// Long-held wakelocks: Elw
	for _, suid := range state.LongWakelockMap {
		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.LongWakelockSummary)
	}

	// wakelock_in: Ewl **
	for _, suid := range state.WakeLockMap {
		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.WakeLockDetailedSummary)
	}

	// Alarm : Eal **
	for _, suid := range state.AlarmMap {
		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.AlarmSummary)
	}

	// Connectivity changes: Ecn **
	for t, suid := range state.ConnectivityMap {
		ntwkSummary := summary.ConnectivitySummary
		if suid.Start == 0 {
			suid.Start = summary.StartTimeMs
		}
		if summary.Active {
			d := ntwkSummary[t]
			duration := time.Duration(state.CurrentTime-suid.Start) * time.Millisecond
			d.addDuration(duration)
			ntwkSummary[t] = d
		}
		suid.Start = state.CurrentTime
	}

	t := time.Unix(0, summary.StartTimeMs*1e6)
	summary.Date = fmt.Sprintf("%d-%02d-%02d", t.Year(), t.Month(), t.Day())

	// Applications execute scheduled jobs: Ejb
	for _, suid := range state.ScheduledJobMap {
		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.ScheduledJobSummary)
	}

	// Applications on the temporary white list: Etw
	for _, suid := range state.TmpWhiteListMap {
		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.TmpWhiteListSummary)
	}

	// Temperature: Bt
	// Voltage: Bv

	return state, summary
}

// summarizeActiveState stores the current summary in the output slice and resets the summary.
// If a reset of state is requested too (after a reboot or a reset of battery history) only then
// is the state cleared, otherwise the state is retained after summarizing.
func summarizeActiveState(d *DeviceState, s *ActivitySummary, summaries *[]ActivitySummary, reset bool, reason string) (*DeviceState, *ActivitySummary) {
	// TODO: Revisit this filtering logic if we also want to print
	// summary for durations when the device was charging
	if s.StartTimeMs != s.EndTimeMs {
		s.Reason = reason
		d, s = concludeActiveFromState(d, s)
		s.TotalSyncSummary = calTotalSync(d)
		*summaries = append(*summaries, *s)
	}

	s = newActivitySummary(s.SummaryFormat)
	d.syncIntervals = []csv.Event{}

	if !reset {
		s.StartTimeMs = d.CurrentTime
		s.EndTimeMs = d.CurrentTime
		s.InitialBatteryLevel = d.BatteryLevel.Value
		s.FinalBatteryLevel = d.BatteryLevel.Value
	} else {
		d = newDeviceState()
	}
	return d, s
}

// Print outputs a string containing aggregated battery stats.
func (s *ActivitySummary) Print(b io.Writer) {
	fmt.Fprintln(b, "Summary Period: (", s.StartTimeMs, "-", s.EndTimeMs, ")  :",
		time.Unix(0, s.StartTimeMs*int64(time.Millisecond)),
		" - ", time.Unix(0, s.EndTimeMs*int64(time.Millisecond)))

	fmt.Fprintln(b, "Date: ", s.Date)
	fmt.Fprintln(b, "Reason:", s.Reason)

	duration := time.Duration(s.EndTimeMs-s.StartTimeMs) * time.Millisecond
	if duration == 0 {
		log.Printf("Error! Invalid duration equals 0 !")
	}

	fmt.Fprintln(b, "Total Summary Duration ", duration)

	fmt.Fprintln(b, "BatteryLevel Drop ", s.InitialBatteryLevel, "->", s.FinalBatteryLevel, "=",
		s.InitialBatteryLevel-s.FinalBatteryLevel)

	levelDropPerHour := float64(s.InitialBatteryLevel-s.FinalBatteryLevel) / duration.Hours()
	fmt.Fprintf(b, "Drop rate per hour : %.2f pct/hr\n", levelDropPerHour)

	fmt.Fprintln(b)

	fmt.Fprintf(b, "%30s", "ScreenOn: ")
	s.ScreenOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "CPURunning: ")
	s.CPURunningSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "RadioOn: ")
	s.MobileRadioOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "PhoneCall")
	s.PhoneCallSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "GpsOn")
	s.GpsOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "WifiFullLock")
	s.WifiFullLockSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "WifiScan")
	s.WifiScanSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "WifiMulticastOn")
	s.WifiMulticastOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "WifiOn: ")
	s.WifiOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "WifiRadio")
	s.WifiRadioSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "WifiRunning")
	s.WifiRunningSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "PhoneScan")
	s.PhoneScanSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "BLEScan")
	s.BLEScanSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "SensorOn")
	s.SensorOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "PluggedIn:")
	s.PluggedInSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "AudioOn:")
	s.AudioOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "CameraOn:")
	s.CameraOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "FlashlightOn:")
	s.FlashlightOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "VideoOn:")
	s.VideoOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "ChargingOn:")
	s.ChargingOnSummary.print(b, duration)

	printMap(b, "IdleMode", s.IdleModeSummary, duration)
	printMap(b, "DataConnectionSummary", s.DataConnectionSummary, duration)
	printMap(b, "ConnectivitySummary", s.ConnectivitySummary, duration)
	printMap(b, "WakeLockSummary", s.WakeLockSummary, duration)
	printMap(b, "WakeLockDetailedSummary", s.WakeLockDetailedSummary, duration)
	printMap(b, "TopApplicationSummary", s.TopApplicationSummary, duration)
	printMap(b, "PerAppSyncSummary", s.PerAppSyncSummary, duration)
	fmt.Fprintf(b, "TotalSyncTime: %v, TotalSyncNum: %v\n", s.TotalSyncSummary.TotalDuration, s.TotalSyncSummary.Num)
	printMap(b, "WakeupReasonSummary", s.WakeupReasonSummary, duration)

	printMap(b, "ForegroundProcessSummary", s.ForegroundProcessSummary, duration)
	printMap(b, "HealthSummary", s.HealthSummary, duration)
	printMap(b, "PlugTypeSummary", s.PlugTypeSummary, duration)
	printMap(b, "ChargingStatusSummary", s.ChargingStatusSummary, duration)
	printMap(b, "PhoneStateSummary", s.PhoneStateSummary, duration)
	printMap(b, "ActiveProcessSummary", s.ActiveProcessSummary, duration)
	printMap(b, "LongWakelockSummary", s.LongWakelockSummary, duration)
	printMap(b, "ScheduledJobSummary", s.ScheduledJobSummary, duration)
	printMap(b, "TmpWhiteListSummary", s.TmpWhiteListSummary, duration)
	printMap(b, "WifiSupplSummary", s.WifiSupplSummary, duration)
	printMap(b, "PhoneSignalStrengthSummary", s.PhoneSignalStrengthSummary, duration)
	printMap(b, "WifiSignalStrengthSummary", s.WifiSignalStrengthSummary, duration)
	printMap(b, "AlarmSummary", s.AlarmSummary, duration)

	printDcpuSlice(b, "DcpuStatsSummary", s.DcpuStatsSummary)
	printDuration(b, "DcpuOverallSummary", s.DcpuOverallSummary)

	printDpstSlice(b, "DpstStatsSummary", s.DpstStatsSummary)
	printDuration(b, "DpstOverallSummary", s.DpstOverallSummary)

	printPowerStates(b, s.PowerStateSummary)

	fmt.Fprintln(b)
}

func (d *Dist) print(b io.Writer, duration time.Duration) {
	fmt.Fprintf(b, "=> Rate (per hr): (%5.2f , %10.2f secs)\t Total: (%5d, %20s, %20s)\n", float64(d.Num)/duration.Hours(), d.TotalDuration.Seconds()/duration.Hours(), d.Num, d.TotalDuration, d.MaxDuration)
}

func printMap(b io.Writer, name string, m map[string]Dist, duration time.Duration) {
	if len(m) == 0 {
		return
	}

	stats := make([]MultiDist, len(m), len(m))
	idx := 0
	for k, v := range m {
		stats[idx] = MultiDist{Name: k, Stat: v}
		idx++
	}

	sort.Sort(sort.Reverse(SortByTimeAndCount(stats)))
	fmt.Fprintln(b, name, "\n---------------------")
	for _, s := range stats {
		if s.Stat.TotalDuration.Nanoseconds() > 0 {
			fmt.Fprintf(b, "%85s => Rate (per hr): (%5.2f , %10.2f secs)\tTotal: (%5d, %20s, %20s)\n", s.Name, float64(s.Stat.Num)/duration.Hours(), s.Stat.TotalDuration.Seconds()/duration.Hours(), s.Stat.Num, s.Stat.TotalDuration, s.Stat.MaxDuration)
		}
	}
	fmt.Fprintln(b)
}

func printDcpuSlice(b io.Writer, name string, slice []DCPU) {
	if len(slice) == 0 {
		return
	}

	fmt.Fprintln(b, name, "\n--------------------------")
	for _, s := range slice {
		fmt.Fprintf(b, "=> BatteryLevel: %d\t Duration: %20s\t UserTime: %10s\t SystemTime: %10s\n", s.BatteryLevel, s.Duration, s.UserTime, s.SystemTime)
		for i, c := range s.CPUUtilizers {
			fmt.Fprintf(b, "\t App:%d\t AppCpuUID:%20s\t AppCpuUserTime:%10s\t AppCpuSystemTime: %10s\n", i+1, c.UID, c.UserTime, c.SystemTime)
		}
	}
	fmt.Fprintln(b)
}

func printDpstSlice(b io.Writer, name string, slice []DPST) {
	if len(slice) == 0 {
		return
	}

	fmt.Fprintln(b, name, "\n--------------------------")
	for _, s := range slice {
		fmt.Fprintf(b, "=> BatteryLevel: %d\t Duration: %20s\t StatUserTime: %10s\t StatSystemTime: %10s\t StatIOWaitTime: %10s\t StatIrqTime: %10s\t StatSoftIrqTime: %10s\t StatIdlTime: %10s\n", s.BatteryLevel, s.Duration, s.StatUserTime, s.StatSystemTime, s.StatIOWaitTime, s.StatIrqTime, s.StatSoftIrqTime, s.StatIdlTime)
	}
	fmt.Fprintln(b)
}

func printDuration(b io.Writer, name string, m map[string]time.Duration) {
	if len(m) == 0 {
		return
	}

	fmt.Fprintln(b, name, "\n--------------------------")
	for k, v := range m {
		fmt.Fprintf(b, "\t Name: %10s\t Duration: %20s\t\n", k, v)
	}
	fmt.Fprintln(b)
}

func printPowerStates(b io.Writer, states []PowerState) {
	if len(states) == 0 {
		return
	}

	fmt.Fprintln(b, "Low power states", "\n--------------------------")
	bl := -1
	for _, ps := range states {
		if bl != ps.batteryLevel {
			bl = ps.batteryLevel
			fmt.Fprintf(b, "=> Battery level: %d\n", bl)
		}
		fmt.Fprintf(b, "    (%d) %-15s ==>\tDuration: %20s\t Count: %d\n", ps.Level, ps.Name, ps.Time, ps.Count)
		for _, v := range ps.Voters {
			fmt.Fprintf(b, "          %-13s -->\tDuration: %20s\t Count: %d\n", v.Name, v.Time, v.Count)
		}
	}
	fmt.Fprintln(b)
}

// Regular expressions to match different sections of the low power state output.
const (
	voterREString = `voter_\d+\s+name=(?P<name>\S+)\s+time=(?P<time>\d+)\s+count=(?P<count>\d+)\s*`
	stateREString = `state_(?P<idx>\d+)\s+name=(?P<name>\S+)\s+time=(?P<time>\d+)\s+count=(?P<count>\d+)\s*`
)

var (
	voterRE          = regexp.MustCompile(voterREString)
	stateRE          = regexp.MustCompile(stateREString)
	fullPowerStateRE = regexp.MustCompile(stateREString + `\s*(?P<voters>(` + voterREString + `)*)`)
)

// parsePowerStates parses a full power state line.
// Example format:
// state_1 name=XO_shutdown time=0 count=0 voter_1 name=APSS time=264740801 count=85367 voter_2 name=MPSS time=314921409 count=286147 voter_3 name=LPASS time=339626342 count=96649 state_2 name=VMIN time=245626000 count=289658
// Times are printed in milliseconds.
func parsePowerStates(input string) ([]*PowerState, error) {
	split := fullPowerStateRE.FindAllString(input, -1)
	if len(split) == 0 {
		return nil, fmt.Errorf("invalid power_state line: %q", input)
	}
	var states []*PowerState
	for _, s := range split {
		// Need to use stateRE here so that voter info doesn't accidentally get used.
		match, st := historianutils.SubexpNames(stateRE, s)
		if !match {
			return nil, fmt.Errorf(`couldn't find power state info in "%v"`, s)
		}
		idx, err := strconv.Atoi(st["idx"])
		if err != nil {
			return nil, fmt.Errorf("error getting power state level from string: %v", err)
		}
		tm, err := strconv.Atoi(st["time"])
		if err != nil {
			return nil, fmt.Errorf("error getting power state time from string: %v", err)
		}
		c, err := strconv.Atoi(st["count"])
		if err != nil {
			return nil, fmt.Errorf("error getting power state count from string: %v", err)
		}
		ps := PowerState{
			Level: int32(idx),
			Name:  st["name"],
			Time:  time.Duration(tm) * time.Millisecond,
			Count: int32(c),
		}

		match, f := historianutils.SubexpNames(fullPowerStateRE, s)
		if !match {
			// This case should never happen because s is created from fullPowerStateRE.FindAllString.
			return nil, fmt.Errorf("matched string didn't match: %q", s)
		}
		vs := voterRE.FindAllString(f["voters"], -1)
		for _, v := range vs {
			match, vt := historianutils.SubexpNames(voterRE, v)
			if !match {
				// This case should never happen because v is created from voterRE.FindAllString.
				return nil, fmt.Errorf("matched string didn't match: %q", v)
			}
			tm, err = strconv.Atoi(vt["time"])
			if err != nil {
				return nil, fmt.Errorf("error getting voter time from string: %v", err)
			}
			c, err = strconv.Atoi(vt["count"])
			if err != nil {
				return nil, fmt.Errorf("error getting voter count from string: %v", err)
			}
			ps.Voters = append(ps.Voters, Voter{
				Name:  vt["name"],
				Time:  time.Duration(tm) * time.Millisecond,
				Count: int32(c),
			})
		}
		states = append(states, &ps)
	}
	return states, nil
}

// subtractPowerStates subtracts one power state from another.
// Subtrahend is subtracted from Minuend (https://en.wikipedia.org/wiki/Subtraction).
// The PowerStates are expected to be the same state (same name, level, and set of voters).
func subtractPowerStates(min, sub *PowerState) (*PowerState, error) {
	if sub.Level != min.Level {
		return nil, fmt.Errorf("power state levels are different. sub = %d, min = %d", sub.Level, min.Level)
	}
	if sub.Name != min.Name {
		return nil, fmt.Errorf("power state names are different. sub = %q, min = %q", sub.Name, min.Name)
	}
	svl := len(sub.Voters)
	if svl != len(min.Voters) {
		return nil, fmt.Errorf("power states have different number of voters. sub has %d, min has %d", svl, len(min.Voters))
	}
	ps := PowerState{
		// Level and name should stay the same
		Level: min.Level,
		Name:  min.Name,

		batteryLevel: min.batteryLevel - sub.batteryLevel,
		Time:         min.Time - sub.Time,
		Count:        min.Count - sub.Count,
	}
	sort.Sort(voterByName(min.Voters))
	sort.Sort(voterByName(sub.Voters))
	for i := 0; i < svl; i++ {
		m, s := min.Voters[i], sub.Voters[i]
		if m.Name != s.Name {
			return nil, fmt.Errorf("power state voter #%d names are different. sub.V = %q, min.V = %q", i, s.Name, m.Name)
		}
		ps.Voters = append(ps.Voters, Voter{
			// Name should stay the same.
			Name: m.Name,

			Time:  m.Time - s.Time,
			Count: m.Count - s.Count,
		})
	}

	return &ps, nil
}

// updateState method interprets the events contained in the battery history string
// according to the definitions in: frameworks/base/core/java/android/os/BatteryStats.java
func updateState(b io.Writer, csvState *csv.State, state *DeviceState, summary *ActivitySummary, summaries *[]ActivitySummary,
	idxMap map[string]ServiceUID, pum PackageUIDMapping, idx, tr, key, value string) (*DeviceState, *ActivitySummary, error) {

	switch key {
	case "Bs": // status
		i := state.ChargingStatus
		active := summary.Active
		ret := state.ChargingStatus.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.ChargingStatusSummary, value, "Charging status", csvState)

		switch value {
		case "?": // unknown
		case "c": // charging
			if active && i != state.ChargingStatus {
				state, summary = summarizeActiveState(state, summary, summaries, false, "CHARGING")
				summary.Active = false
			}
		case "n": // not-charging
			fallthrough
		case "d": // discharging
			if !active {
				state.initStartTimeForAllStates()
				summary.StartTimeMs = state.CurrentTime
				summary.EndTimeMs = state.CurrentTime
				summary.Active = true
			}
		case "f": // full
		default:
			return state, summary, fmt.Errorf("unknown status = %q", value)
		}
		return state, summary, ret

	case "Bh": // health
		switch value {
		case "?": // unknown
		case "g": // good
		case "h": // overheat
		case "d": // dead
		case "v": // over-voltage
		case "f": // failure
		case "c": // cold
		default:
			return state, summary, fmt.Errorf("unknown health = %q", value)
		}
		return state, summary, state.Health.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.HealthSummary, value, "Health", csvState)

	case "Bp": // plug
		switch value {
		case "n": // none
		case "a": // ac
		case "u": // usb
		case "w": // wireless
		default:
			return state, summary, fmt.Errorf("unknown plug type = %q", value)
		}
		return state, summary, state.PlugType.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.PlugTypeSummary, value, "Plug", csvState)

	case "Bt": // temperature
		return state, summary, state.Temperature.assign(state.CurrentTime, value, summary.Active, "Temperature", csvState)

	case "Bv": // volt
		return state, summary, state.Voltage.assign(state.CurrentTime, value, summary.Active, "Voltage", csvState)

	case "Bl": // level
		i := state.BatteryLevel
		parsedLevel, err := strconv.Atoi(value)
		if err != nil {
			return state, summary, errors.New("parsing int error for level")
		}
		state.lastBatteryLevel = i
		ret := state.BatteryLevel.assign(state.CurrentTime, value, summary.Active, BatteryLevel, csvState)

		summary.FinalBatteryLevel = parsedLevel

		if !summary.Active || summary.InitialBatteryLevel == -1 {
			summary.InitialBatteryLevel = parsedLevel
		} else if summary.SummaryFormat == FormatBatteryLevel && i != state.BatteryLevel {
			state, summary = summarizeActiveState(state, summary, summaries, false, "LEVEL")
		}
		return state, summary, ret

	case "BP": // plugged = {+BP, -BP}
		return state, summary, state.Plugged.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.PluggedInSummary, tr, Plugged, csvState)

	case "Bcc": // coulomb charge (in mAh)
		return state, summary, state.CoulombCharge.assign(state.CurrentTime, value, summary.Active, "Coulomb charge", csvState)

	case "r": // running
		// Needs special handling as the wakeup reason will arrive asynchronously
		switch tr {
		case "+":
			if state.CPURunning.Value {
				return state, summary, errors.New("consecutive +r events")
			}
			// Note the time the new state starts
			state.CPURunning.Start = state.CurrentTime
			state.CPURunning.Value = true
			csvState.AddEntry("CPU running", &tsString{state.CPURunning.Start, ""}, state.CurrentTime)

			// Store the details of the last wakeup to correctly attribute wakeup reason
			state.LastWakeupTime = state.CurrentTime

		case "-":
			if !state.CPURunning.Value {
				// -r was received without a corresponding +r
				if state.CPURunning.Start != 0 && state.CPURunning.Start != summary.StartTimeMs {
					// This is not the beginning of a new session
					return state, summary, errors.New("-r received without a corresponding +r")
				}
				state.CPURunning.Start = summary.StartTimeMs
				csvState.AddEntry("CPU running", &tsString{state.CPURunning.Start, ""}, state.CPURunning.Start)
			}
			csvState.AddEntry("CPU running", &tsString{state.CPURunning.Start, state.WakeupReason.Service}, state.CurrentTime)
			if summary.Active {
				duration := time.Duration(state.CurrentTime-state.CPURunning.Start) * time.Millisecond
				if duration > 0 {
					summary.CPURunningSummary.addDuration(duration)
				}
			}
			state.LastWakeupDuration = time.Duration(state.CurrentTime-state.LastWakeupTime) * time.Millisecond
			// Set the last wakeup time as now in case any wakeup reasons are logged after the -r. They should get a duration of 0.
			state.LastWakeupTime = state.CurrentTime
			// Note the time the new state starts
			state.CPURunning.Start = state.CurrentTime
			state.CPURunning.Value = false

			// Account for wakeup reason stats
			if state.WakeupReason.Service != "" {
				if err := csvState.EndWakeupReason(state.WakeupReason.Service, state.CurrentTime); err != nil {
					return state, summary, err
				}
				if summary.Active {
					d := summary.WakeupReasonSummary[state.WakeupReason.Service]

					duration := state.LastWakeupDuration
					if duration > 0 {
						d.addDuration(duration)
						summary.WakeupReasonSummary[state.WakeupReason.Service] = d
					}
				}
				state.WakeupReason.Service = ""
			}

		default:
			return state, summary, fmt.Errorf("unknown transition for cpu running : %q", tr)
		}
		return state, summary, nil

	case "wr": // wake reason
		// Special case as there are no transitions for this.
		// Just the wake reason that also arrives asynchronously
		// WakeupReason, WakeupReasonSummary
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for wakelock", value)
		}
		old := state.WakeupReason.Service
		state.WakeupReason.Service = serviceUID.Service

		if state.CPURunning.Value && state.LastWakeupTime != 0 && (state.WakeLockHeld.Value || old == "") {
			// If a wakelock is curently held or there wasn't a previously saved wakeup reason,
			// LastWakeupTime should give the time when the CPU started running.
			csvState.StartWakeupReason(state.WakeupReason.Service, state.LastWakeupTime)
			if state.WakeLockHeld.Value {
				csvState.EndWakeupReason(state.WakeupReason.Service, state.WakeLockHeld.Start)
			}
		} else {
			csvState.StartWakeupReason(state.WakeupReason.Service, state.CurrentTime)
		}
		if state.CPURunning.Value == true {
			state.WakeupReason.Start = state.CPURunning.Start
			endT := state.CurrentTime
			if old == "" && state.WakeLockHeld.Value {
				old = state.WakeupReason.Service
				// Wakeup reason duration ends when a userspace wakelock is acquired.
				endT = state.WakeLockHolder.Start
				// Don't need to track this wakeup reason anymore.
				state.WakeupReason.Service = ""
				state.LastWakeupDuration = time.Duration(endT-state.LastWakeupTime) * time.Millisecond
			}
			if old != "" {
				if summary.Active {
					d := summary.WakeupReasonSummary[old]
					duration := time.Duration(endT-state.LastWakeupTime) * time.Millisecond
					d.addDuration(duration)
					summary.WakeupReasonSummary[old] = d
				}
				state.LastWakeupTime = state.CurrentTime
			}
		} else {
			// Wakeup reason received when CPU is not running.
			// Summarize here based on the lastwakeuptime and lastwakeupduration
			if state.LastWakeupTime == 0 {
				// Wakeup reason given before a +r. That means that either the CPU is already running (we see a -r before a +r), or there's a problem (we'll see a +r before a -r)
				// Current parsing assumes for now that it is the first case.
				// TODO: figure out how to detect and handle the second case.
				state.LastWakeupTime = state.CurrentTime
				return state, summary, nil
			}

			state.WakeupReason.Start = state.LastWakeupTime
			if summary.Active {
				d := summary.WakeupReasonSummary[state.WakeupReason.Service]
				duration := time.Duration(state.LastWakeupTime-state.CurrentTime) * time.Millisecond
				d.addDuration(duration)
				summary.WakeupReasonSummary[state.WakeupReason.Service] = d
			}
			state.LastWakeupTime = state.CurrentTime
			if state.CPURunning.Start != 0 {
				// We've encountered a -r before. Without this check, if we see two wr events before the first -r, we'll incorrectly print out the times for the second event.
				csvState.EndWakeupReason(state.WakeupReason.Service, state.CurrentTime)
				state.WakeupReason.Service = ""
			}
		}

	case "w": // wake_lock
		// Special case this, as the +w will have the first application to take the wakelock
		// and -w may or may not contain the last application to release it.
		switch tr {
		case "":
			fallthrough
		case "+":
			if state.WakeLockHeld.Value {
				if value == "" {
					// Dealing with the case where we see +w=123, +w
					// This is just reporting that a wakelock was already held when
					// the summary was requested, so we just ignore +w
					if state.WakeLockHolder.Service == "" {
						return state, summary, errors.New("logic error")
					}
					return state, summary, nil
				}
				// Dealing with the case where we see two consecutive +w=123, +w=456
				return state, summary, errors.New("two holders of the wakelock?")
			}
			if state.WakeupReason.Service != "" {
				// Wakeup reason stats in checkin data count the amount of time between the wakeup
				// from suspend and the acquiring of the first wakelock by userspace. So if there was a
				// wakeup reason being tracked, mark this wakelock acquisition as the end of the wakeup reason duration.
				if err := csvState.EndWakeupReason(state.WakeupReason.Service, state.CurrentTime); err != nil {
					return state, summary, err
				}
				if summary.Active {
					d := summary.WakeupReasonSummary[state.WakeupReason.Service]

					duration := state.LastWakeupDuration
					if duration == 0 {
						duration = time.Duration(state.CurrentTime-state.LastWakeupTime) * time.Millisecond
					}
					d.addDuration(duration)
					summary.WakeupReasonSummary[state.WakeupReason.Service] = d
				}
				state.WakeupReason.Service = ""
				// There was previously a wakeup reason keeping the CPU awake. Set the last wakeup time to now so that any
				// wr=* the same line as this +w will not get the incorrect duration.
				state.LastWakeupTime = state.CurrentTime
			}
			if value == "" {
				// Dealing with the case where we see a +w for the first time
				// The entity was already active when the summary was taken,
				// so count the active time since the beginning of the summary.
				state.WakeLockHolder.Service = "unknown-wakelock-holder"
				if state.CurrentTime != summary.StartTimeMs {
					return state, summary, errors.New("got w state in the middle of the summary")
				}
			} else {
				serviceUID, ok := idxMap[value]
				if !ok {
					return state, summary, fmt.Errorf("wakelock held by unknown service : %q", value)
				}
				state.WakeLockHolder.Service = serviceUID.Service
			}
			state.WakeLockHolder.Start = state.CurrentTime
			state.WakeLockHeld = tsBool{Start: state.CurrentTime, Value: true}
		case "-":
			// For any wakeup reasons that are given after the wakelock is released.
			state.LastWakeupTime = state.CurrentTime
			if !state.WakeLockHeld.Value {
				// There was no + transition for this.
				// This is the case where a -w appears in the middle of a report,
				// so we want to show an instant error event with the time of the -w.
				// If the entity was already active when the summary was taken,
				// +w without a value would be present and is handled above.
				state.WakeLockHolder.Start = state.CurrentTime
				state.WakeLockHolder.Service = "unknown-wakelock-holder"
				addCSVInstantEvent(csvState, state, "Partial wakelock", "error", `"missing corresponding +w"`)
				return state, summary, nil
			}
			if summary.Active {
				d := summary.WakeLockSummary[state.WakeLockHolder.Service]
				duration := time.Duration(state.CurrentTime-state.WakeLockHolder.Start) * time.Millisecond
				if duration > 0 {
					d.addDuration(duration)
					summary.WakeLockSummary[state.WakeLockHolder.Service] = d
				}
			}
			state.WakeLockHeld = tsBool{Start: state.CurrentTime, Value: false}

		default:
			return state, summary, fmt.Errorf("unknown transition for wakelock : %q", tr)
		}
		csvState.AddEntry("Partial wakelock", &state.WakeLockHolder, state.CurrentTime)

	case "g": // gps
		return state, summary, state.GpsOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.GpsOnSummary, tr, "GPS", csvState)

	case "s": // sensor
		return state, summary, state.SensorOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.SensorOnSummary, tr, "Sensor", csvState)

	case "Esw": // screen wake reason
		if state.ScreenOn.Value && state.ScreenOn.Start > 0 && state.ScreenOn.data != unknownScreenOnReason {
			// TODO: currently treating a second Esw between a single pair of +S...-S as an error. Figure out what the correct policy should be.
			return state, summary, errors.New("encountered multiple Esw events between a single pair of +S/-S events")
		}

		suid, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("screen turned on by unknown process: %q", value)
		}

		if !state.ScreenOn.Value {
			var err error
			if state.ScreenOn.data != unknownScreenOnReason {
				err = fmt.Errorf("encountered multiple Esw events (%s and %s) outside of +S/-S events", state.ScreenOn.data, suid.Service)
			}
			state.ScreenOn.data = suid.Service // Need to set the ScreenOn.data field so the csv is printed out correctly
			return state, summary, err
		}

		state.ScreenOn.data = suid.Service                              // Need to set the ScreenOn.data field so the csv is printed out correctly
		csvState.AddOptToEntry("Screen", &state.ScreenOn, suid.Service) // Overwrite the +S csv entry opt field to ensure output csv is correct
		return state, summary, nil

	case "S": // screen
		prevVal := state.ScreenOn.Value
		err := state.ScreenOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.ScreenOnSummary, tr, "Screen", csvState)

		if tr == "-" {
			// Reset data on screen off transition so we don't carry over reasons to other screen on events
			state.ScreenOn.data = unknownScreenOnReason
		}
		if err != nil || prevVal == state.ScreenOn.Value {
			return state, summary, err
		}
		// Update state for the top app.
		topAppSuid, err := state.topApp()
		if err != nil || topAppSuid == nil {
			return state, summary, err
		}
		appID, err := packageutils.AppIDFromString(topAppSuid.UID)
		if err != nil {
			return state, summary, err
		}
		// Update stats if needed and screen got turned off.
		if !state.ScreenOn.Value && summary.Active {
			topAppSuid.addSummaryEntry(state.CurrentTime, topAppSuid, summary.TopApplicationSummary)
		}
		// Add 'Top app' entry to the log and update the start time.
		csvState.AddEntryWithOpt(Top, topAppSuid, state.CurrentTime, fmt.Sprint(appID))
		topAppSuid.Start = state.CurrentTime
		return state, summary, nil

	case "Sb": // brightness
		return state, summary, state.Brightness.assign(state.CurrentTime, value, summary.Active, "Brightness", csvState)

	case "Pcl": // phone_in_call
		return state, summary, state.PhoneInCall.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.PhoneCallSummary, tr, "Phone call", csvState)

	case "Pcn": // data_conn
		return state, summary, state.DataConnection.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.DataConnectionSummary, value, "Mobile network type", csvState)

	case "Pr": // modile_radio
		return state, summary, state.MobileRadioOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.MobileRadioOnSummary, tr, "Mobile radio active", csvState)

	case "Psc": // phone_scanning
		return state, summary, state.PhoneScanning.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.PhoneScanSummary, tr, "Phone scanning", csvState)

	case "Pss": // phone_signal_strength
		signalValue, ok := signalStrengthConstants[value]
		if !ok {
			return state, summary, fmt.Errorf("unknown phone signal strength = %q", value)
		}
		return state, summary, state.PhoneSignalStrength.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs, summary.PhoneSignalStrengthSummary,
			signalValue, "Mobile signal strength", csvState)

	case "Pst": // phone_state
		switch value {
		case "in":
		case "out":
		case "em": // emergency
		case "off":
			// Phone went off. Make sure the signal strength metric is updated accordingly.
			state.PhoneSignalStrength.assign(state.CurrentTime,
				summary.Active, summary.StartTimeMs, summary.PhoneSignalStrengthSummary,
				"none", "Mobile signal strength", csvState)
		default:
			return state, summary, fmt.Errorf("unknown phone state = %q", value)
		}
		return state, summary, state.PhoneState.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.PhoneStateSummary, value, "Phone state", csvState)

	case "bles": // ble_scanning
		return state, summary, state.BLEScanning.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.BLEScanSummary, tr, "BLE scanning", csvState)

	case "Enl": // null
		return state, summary, errors.New("sample: Null Event line = " + tr + key + value)

	case "Epr": // proc
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for active process", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, true, summary.StartTimeMs, state.ActiveProcessMap,
			summary.ActiveProcessSummary, tr, value, "Active process", csvState)

	case "Efg": // fg
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for foreground process", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, true, summary.StartTimeMs, state.ForegroundProcessMap,
			summary.ForegroundProcessSummary, tr, value, Foreground, csvState)

	case "Etp": // top
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for top app", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, state.ScreenOn.Value, summary.StartTimeMs, state.TopApplicationMap,
			summary.TopApplicationSummary, tr, value, Top, csvState)

	case "Esy": // sync
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap sync app", value)
		}
		_, alreadyActive := state.AppSyncingMap[value]
		if tr == "-" {
			var start int64
			if !alreadyActive {
				start = summary.StartTimeMs
			} else {
				start = state.AppSyncingMap[value].Start
			}
			if summary.Active {
				i := csv.Event{Start: start, End: state.CurrentTime}
				state.syncIntervals = append(state.syncIntervals, i)
			}
		}

		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, true, summary.StartTimeMs, state.AppSyncingMap,
			summary.PerAppSyncSummary, tr, value, "SyncManager", csvState)

	case "W": // wifi
		if tr == "-" {
			// Wifi went off. Make sure the signal strength metric is updated accordingly.
			state.WifiSignalStrength.assign(state.CurrentTime,
				summary.Active, summary.StartTimeMs, summary.WifiSignalStrengthSummary,
				"none", "Wifi signal strength", csvState)
		}
		return state, summary, state.WifiOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.WifiOnSummary, tr, "Wifi on", csvState)

	case "Wl": // wifi_full_lock
		return state, summary, state.WifiFullLock.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.WifiFullLockSummary, tr, "Wifi full lock", csvState)

	case "Ws": // wifi_scan
		return state, summary, state.WifiScan.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.WifiScanSummary, tr, "Wifi scan", csvState)

	case "Wm": // wifi_multicast
		return state, summary, state.WifiMulticastOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.WifiMulticastOnSummary, tr, "Wifi multicast", csvState)

	case "Wr": // wifi_radio
		// Temporary workaround to disambiguate Wr
		if len(tr) > 0 {
			// WifI Lock
			return state, summary, state.WifiRadio.assign(state.CurrentTime,
				summary.Active, summary.StartTimeMs,
				&summary.WifiRadioSummary, tr, "Wifi radio", csvState)
		}

	case "Ww": // wifi_running
		return state, summary, state.WifiRunning.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.WifiRunningSummary, tr, "Wifi running", csvState)

	case "lp", "ps": // Low power mode was renamed to power save mode in M
		return state, summary, state.LowPowerModeOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.LowPowerModeOnSummary, tr, "Battery Saver", csvState)

	case "a": // audio
		return state, summary, state.AudioOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.AudioOnSummary, tr, "Audio", csvState)

	case "ca": // camera
		return state, summary, state.CameraOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.CameraOnSummary, tr, "Camera", csvState)

	case "v": // video
		return state, summary, state.VideoOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.VideoOnSummary, tr, "Video", csvState)

	case "Ecn": // network connectivity
		suid := idxMap[value]
		t, ok := connConstants[suid.UID]
		if !ok {
			t = "UNKNOWN"
		}

		activeNtwks := state.ConnectivityMap
		ntwkSummary := summary.ConnectivitySummary

		ts := t
		switch suid.Service {
		case ecnConnected:
			ts = t + `:` + ecnConnected
			tmp := t + `:` + ecnSuspended
			if _, ok := activeNtwks[ts]; ok {
				// Intended behavior, no change to record.
				// Due to historic issues, the connectivity stack will reiterate the default network's connected state after all disconnect broadcasts.
				return state, summary, nil
			} else if _, ok := activeNtwks[tmp]; ok {
				// End SUSPENDED state for switch to CONNECTED.
				d := ntwkSummary[tmp]
				if summary.Active {
					duration := time.Duration(state.CurrentTime-activeNtwks[tmp].Start) * time.Millisecond
					if duration > 0 {
						d.addDuration(duration)
						ntwkSummary[tmp] = d
					}
				}
				delete(activeNtwks, tmp)
				su := &ServiceUID{
					Start:   state.CurrentTime,
					Service: tmp,
					UID:     suid.UID,
				}
				csvState.AddEntry("Network connectivity", su, state.CurrentTime)
			}
			suid.Start = state.CurrentTime
			activeNtwks[ts] = &suid

		case ecnDisconnected:
			ts = t + `:` + ecnSuspended
			_, alreadyActive := activeNtwks[ts]
			if !alreadyActive {
				ts = t + `:` + ecnConnected
				_, alreadyActive = activeNtwks[ts]
			}
			d := ntwkSummary[ts]
			if !alreadyActive {
				// There was no CONNECT for this, and there hasn't been a prior
				// DISCONNECT, so assuming that it was already active at the
				// beginning of the summary period (the current ActivitySummary).
				// There could be duplicate DISCONNECTs due to a few bugs, so we
				// need to verify that this is the first DISCONNECT seen.
				if d.Num != 0 {
					return state, summary, nil
				}
				suid.Start = summary.StartTimeMs
				activeNtwks[ts] = &suid
				su := &ServiceUID{
					Start:   suid.Start,
					Service: ts,
					UID:     suid.UID,
				}
				csvState.AddEntry("Network connectivity", su, suid.Start)
			}

			if summary.Active {
				duration := time.Duration(state.CurrentTime-activeNtwks[ts].Start) * time.Millisecond
				if duration > 0 {
					d.addDuration(duration)
					ntwkSummary[ts] = d
				}
			}
			delete(activeNtwks, ts)

		case ecnSuspended:
			// A SUSPENDED network can no longer pass traffic. It's not active, it's just paused.
			// It may recover to CONNECTED or it may not recover and go to DISCONNECTED.
			// Cell tech can hold things for networking processes while a user rides an elevator or drives
			// through a tunnel or otherwise temporarily lose coverage. Instead of incurring the cost of
			// re-establishing the connection, SUSPENDED was built in.

			ts = t + `:` + ecnSuspended
			if _, ok := activeNtwks[ts]; ok {
				// Intended behavior, no change to record.
				// Due to historic issues, the connectivity stack will reiterate the default network's connected state after all disconnect broadcasts.
				return state, summary, nil
			}

			// End CONNECTED state for switch to SUSPENDED.
			tmp := t + `:` + ecnConnected
			if _, ok := activeNtwks[tmp]; !ok {
				// There was no CONNECTED state before this line.
				// There is an extremely small window in which the connectivity stack could have communicated with the carrier,
				// established a connection, but not validated the connection or notified any processes of the connection. In this situation,
				// the first indication could come in as SUSPENDED, but it's not very likely given that it's a pretty tight window.
				// Given the unlikeliness of this situation, it is assumed that the connection was CONNECTED until this time.
				suid.Start = summary.StartTimeMs
				activeNtwks[tmp] = &suid
				su := &ServiceUID{
					Start:   suid.Start,
					Service: tmp,
					UID:     suid.UID,
				}
				csvState.AddEntry("Network connectivity", su, suid.Start)
			}
			d := ntwkSummary[tmp]
			if summary.Active {
				duration := time.Duration(state.CurrentTime-activeNtwks[tmp].Start) * time.Millisecond
				if duration > 0 {
					d.addDuration(duration)
					ntwkSummary[tmp] = d
				}
			}
			delete(activeNtwks, tmp)
			su := &ServiceUID{
				Start:   state.CurrentTime,
				Service: tmp,
				UID:     suid.UID,
			}
			csvState.AddEntry("Network connectivity", su, state.CurrentTime)

			suid.Start = state.CurrentTime
			activeNtwks[ts] = &suid

		default:
			fmt.Printf("Unknown Ecn change string: %s\n", suid.Service)
			return state, summary, fmt.Errorf("unknown Ecn change string: %s\n", suid.Service)
		}
		su := &ServiceUID{
			Start:   state.CurrentTime,
			Service: ts,
			UID:     suid.UID,
		}
		csvState.AddEntry("Network connectivity", su, state.CurrentTime)

	case "Ewl": // wakelock_in
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for wakelock_in", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, true, summary.StartTimeMs, state.WakeLockMap,
			summary.WakeLockDetailedSummary, tr, value, "Wakelock_in", csvState)

	case "di": // Doze mode
		if value == "" { // This will be the case for histories from M devices.
			switch tr {
			case "+":
				value = "full"
			case "-":
				value = "off"
			default:
				return state, summary, fmt.Errorf("unknown transition for di: %q", tr)
			}
			if state.IdleMode.Value == "" {
				switch value {
				case "off":
					// For M, mark initial state as full
					state.IdleMode.Value = "full"
				case "full":
					// For M, mark initial state as off
					state.IdleMode.Value = "off"
				}
				// Mark it as being in the opposite state from the beginning.
				state.IdleMode.Start = summary.StartTimeMs
				csvState.AddEntry("Doze", &state.IdleMode, summary.StartTimeMs)
				state.IdleMode.assign(state.CurrentTime,
					summary.Active, summary.StartTimeMs,
					summary.IdleModeSummary, value, "Doze", csvState)
			}
		} else if state.IdleMode.Value == "" && value == "off" {
			// value will be non-empty for histories from N+ devices.
			// If the first transition we see is 'off', then we can't tell what state idle mode was in prior to this event.
			// Mark it as being unknown from the beginning.
			state.IdleMode.Value = "unknown"
			state.IdleMode.Start = summary.StartTimeMs
			csvState.AddEntry("Doze", &state.IdleMode, summary.StartTimeMs)
			state.IdleMode.assign(state.CurrentTime,
				summary.Active, summary.StartTimeMs,
				summary.IdleModeSummary, value, "Doze", csvState)
		}
		var err error
		if value == "???" {
			// tsString.assign always returns nil so we can log this info and continue to parse it
			err = errors.New("encountered ??? doze mode")
			fmt.Println("encountered ??? doze mode")
		}
		state.IdleMode.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.IdleModeSummary, value, "Doze", csvState)
		return state, summary, err

	case "Ejb": // job: an application executing a scheduled job
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for job", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, true, summary.StartTimeMs, state.ScheduledJobMap,
			summary.ScheduledJobSummary, tr, value, "JobScheduler", csvState)

	case "Elw": // longwake: long-held wakelocks
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for longwake", value)
		}
		curTime := state.CurrentTime
		if tr == "+" {
			// Include the minute that the wakelock was held before it was logged in the history.
			curTime = state.CurrentTime - int64(time.Minute/time.Millisecond)
		}
		return state, summary, serviceUID.assign(curTime,
			summary.Active, true, summary.StartTimeMs, state.LongWakelockMap,
			summary.LongWakelockSummary, tr, value, LongWakelocks, csvState)

	case "Etw": // tmpwhitelist: an application on the temporary whitelist
		// Etw events log apps going on/off the temporary whitelist, for example when GCM delivers a high priority message to the app and temporarily whitelists it for network access
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for tmpwhitelist", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, true, summary.StartTimeMs, state.TmpWhiteListMap,
			summary.TmpWhiteListSummary, tr, value, "Temp White List", csvState)

	case "Wsp": // Wifi Supplicant
		switch value {
		// invalid, disconn, disabled, inactive, scanning, authenticating, associating, associated,
		// 4-way-handshake, group-handshake, completed, dormant, uninit
		case "inv", "dsc", "dis", "inact", "scan", "auth", "ascing", "asced", "4-way", "group", "compl", "dorm", "uninit":
		default:
			return state, summary, fmt.Errorf("unknown Wifi Supplicant state = %q", value)
		}
		return state, summary, state.WifiSuppl.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.WifiSupplSummary, value, "Wifi supplicant", csvState)

	case "Wss": // WiFi Signal Strength
		signalValue, ok := signalStrengthConstants[value]
		if !ok {
			return state, summary, fmt.Errorf("unknown wifi signal strength = %q", value)
		}
		return state, summary, state.WifiSignalStrength.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs, summary.WifiSignalStrengthSummary,
			signalValue, "Wifi signal strength", csvState)

	case "fl": // flashlight
		return state, summary, state.FlashlightOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.FlashlightOnSummary, tr, "Flashlight on", csvState)

	case "ch": // charging
		// The "ch" bit is whether the device currently considers itself to be charging, which may not
		// exactly follow the battery state. If you are plugged in to power but not getting enough
		// power that the battery is actually draining, charging will not be set (-ch).
		return state, summary, state.ChargingOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.ChargingOnSummary, tr, Charging, csvState)

	case "Epi": // pkginst: package being installed, regardless of whether an older version of
		return state, summary, addCSVInstantAppEvent(csvState, state, idxMap, "Package install", value)

	case "Epu": // pkgunin: package being uninstalled, applys to updates as well.
		return state, summary, addCSVInstantAppEvent(csvState, state, idxMap, "Package uninstall", value)

	case "Esm": // significant motion
		// Significant Motion Detection is a state change event that is added to CSV as a point event without a duration.
		addCSVInstantEvent(csvState, state, "Significant motion", "bool", "true")
		return state, summary, nil

	case "Ewa": // wakeup AP: a UID caused the application processor to wakeup.
		// This can be caused by either +mobile-radio or +wifi, but those don't have to be on the same history line.
		addCSVInstantAppEvent(csvState, state, idxMap, "App Processor wakeup", value)
		return state, summary, nil

	case "Eaa": // package active. Event for a package becoming active due to an interaction.
		return state, summary, addCSVInstantAppEvent(csvState, state, idxMap, "Package active", value)

	case "Eac": // device active, like turning the screen on or plugging in to power
		addCSVInstantEvent(csvState, state, "Device active", "bool", "true")
		return state, summary, nil

	case "Eai": // package inactive. Event for a package becoming inactive due to being unused for a period of time.
		return state, summary, addCSVInstantAppEvent(csvState, state, idxMap, "Package inactive", value)

	case "Eal": // alarm
		// "Eal" is an alarm going off event. These are all from alarms scheduled by apps with the AlarmManager.
		// These events aren't generated unless you explicitly enable them for debugging purposes.
		suid, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for Alarm going off (Eal)", value)
		}
		err := suid.assign(state.CurrentTime, summary.Active, true, summary.StartTimeMs, state.AlarmMap, summary.AlarmSummary, tr, value, "Alarm", csvState)
		return state, summary, err

	case "Est": // stats
		// Est is only for our internal debugging use, which is not enabled by default, it is just for us
		// to see why we are collecting power data. This is noting that we have decided to pull external
		// power data (from wifi, bluetooth, etc) and the reason why.
		// It displays as the following format in battery history log:
		// 9,hsp,31,0,"wifi-data"
		// 9,h,44377,+r,+Wr,Est=31
		// 9,h,55,-r,-Wr,wr=32,Est=31
		// We will not add them to historian v2 because they are only for debugging and too rarely to be used,
		// and it doesn't make sense to display them as summary table.
		if _, ok := idxMap[value]; !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for collect external stats event (Est)", value)
		}
		return state, summary, nil

	// Not yet implemented in the framework
	case "b": // bluetooth
		return state, summary, fmt.Errorf("sample: bluetooth line = %s%s%s", tr, key, value)

	case "Dcpu": // cpu_summary
		// "9,h,0,Dcpu=112830:66390/1000:32930:19830/0:9850:23180/10019:21720:5570"
		dcpu := state.DcpuStats
		dcpu.CPUUtilizers = nil

		if dcpu.Start == 0 {
			dcpu.Start = summary.StartTimeMs
		}
		dcpu.BatteryLevel = state.lastBatteryLevel.Value
		dcpu.Duration = time.Duration(state.CurrentTime-dcpu.Start) * time.Millisecond

		// parse the value into different tokens
		subs := strings.Split(value, "/")

		for i, sub := range subs {
			ss := strings.Split(sub, ":")
			var s []int
			for _, a := range ss {
				b, err := strconv.Atoi(a)
				if err != nil {
					return state, summary, errors.New("parsing int error for Dcpu")
				}
				s = append(s, b)
			}
			switch i {
			case 0:
				dcpu.UserTime = time.Duration(s[0]) * time.Millisecond
				dcpu.SystemTime = time.Duration(s[1]) * time.Millisecond
			case 1, 2, 3:
				app := AppCPUUsage{
					start:      state.lastBatteryLevel.Start,
					UID:        ss[0],
					UserTime:   time.Duration(s[1]) * time.Millisecond,
					SystemTime: time.Duration(s[2]) * time.Millisecond,
				}
				appID, err := packageutils.AppIDFromString(app.UID)
				if err != nil {
					return state, summary, err
				}
				app.pkgName = pum.packageName(appID)
				// The implementation of addEntryWithOpt requires two calls in order for the csv line to be printed out.
				csvState.AddEntryWithOpt("Highest App CPU Usage", &app, app.start, fmt.Sprint(appID))
				csvState.AddEntryWithOpt("Highest App CPU Usage", &app, state.CurrentTime, fmt.Sprint(appID))
				dcpu.CPUUtilizers = append(dcpu.CPUUtilizers, app)
				calDcpuOverallSummary(ss[0], s[1], s[2], summary.DcpuOverallSummary, summary.Active)
			default:
				return state, summary, fmt.Errorf("unknown Dcpu part: %q", sub)
			}
		}
		state.DcpuStats = dcpu
		summary.DcpuStatsSummary = append(summary.DcpuStatsSummary, state.DcpuStats)
		// A new battery step begins
		state.DcpuStats.Start = state.CurrentTime
		return state, summary, nil

	case "Dpst": // proc_stat_summary
		// "9,h,0,Dpst=176140,62360,14690,20,2920,242170". Because the events are split by ',',
		// in the case "Dpst", we only get "176140" as value.
		// The following fields are parsed as key in default case.
		state.isDpstEvent = true
		if state.DpstStats.Start == 0 {
			state.DpstStats.Start = summary.StartTimeMs
		}
		state.DpstStats.BatteryLevel = state.BatteryLevel.Value + 1 // +1 is to make BatteryLevel the starting battery level
		state.DpstStats.Duration = time.Duration(state.CurrentTime-state.DpstStats.Start) * time.Millisecond

		v, err := strconv.Atoi(value)
		if err != nil {
			return state, summary, errors.New("parsing int error for Dpst")
		}
		d := time.Duration(v) * time.Millisecond
		state.DpstStats.StatUserTime = d // Dpst token 0, statUserTime
		summary.DpstOverallSummary["usr"] += d
		state.dpstTokenIndex = 1
		return state, summary, nil

	// low power states...unfortunately, there's no real key in the checkin format of the history,
	// so we have to look for these instead
	case "null":
		// The system doesn't support this hardware for low power states. Nothing to do here.
	case "state_1":
		pStates, err := parsePowerStates(value)
		if err != nil {
			return state, summary, err
		}

		if len(state.CummulativePowerState) == 0 {
			// This is the first log we see for power states.
			// This could potentially include data from before the batterystats was reset,
			// so not saving it as the stats for the previous drop.
			for _, p := range pStates {
				p.start = summary.StartTimeMs
				state.CummulativePowerState[p.Name] = p
				state.InitialPowerState[p.Name] = p
			}
			// Start & end times don't really matter for groups.
			csvState.PrintInstantEvent(rpmStatsGroupEntry(pStates))
			return state, summary, nil
		}

		// Numbers are stored as aggregates since boot, so we need to subtract to get the stats for the last discharge step.
		for _, p := range pStates {
			pc, ok := state.CummulativePowerState[p.Name]
			if !ok {
				// All the states should be printed out all the time,
				// so this shouldn't happen since we check for an empty map above.
				return state, summary, fmt.Errorf("device state cummulative power state map doesn't include %q", p.Name)
			}

			pd, err := subtractPowerStates(p, pc)
			if err != nil {
				return state, summary, err
			}
			s := summary
			if summary.Active && summary.SummaryFormat == FormatBatteryLevel && len(*summaries) > 0 {
				// Power state info for a specific level drop (eg. 87% -> 86%) is printed out after the battery
				// level has changed in the log. Given that, if the format is by battery level, the 'summary'
				// variable will point to the summary for the new level drop (eg. 86% -> 85%), so we need to
				// get the previous summary from the list of summaries.
				s = &(*summaries)[len(*summaries)-1]
			}
			pd.batteryLevel = state.lastBatteryLevel.Value
			pd.start = state.lastBatteryLevel.Start
			if err = s.appendPowerState(pd); err != nil {
				return state, summary, err
			}
			// The implementation of AddEntry requires two calls in order for the csv line to be printed out.
			csvState.AddEntry("Low Power State", pd, state.CurrentTime)
			csvState.AddEntry("Low Power State", pd, state.CurrentTime)
		}

		// Update cummulative map to prepare for next discharge step.
		for _, p := range pStates {
			state.CummulativePowerState[p.Name] = p
			// Subtract the initial value to make sure each timeline entry is relative to 0.
			pt, err := subtractPowerStates(p, state.InitialPowerState[p.Name])
			if err != nil {
				return state, summary, err
			}
			pt.start = state.CurrentTime
			for _, ve := range pt.csvLogVoterEntries() {
				csvState.PrintInstantEvent(ve)
			}
			// Print out the timer lines so we can graph it in the timeline
			pdt := &powerStateTimer{*pt}
			csvState.AddEntry(pdt.Name, pdt, state.CurrentTime)
			csvState.AddEntry(pdt.Name, pdt, state.CurrentTime)
		}

		return state, summary, nil

	// TODO:
	case "Eur":
	case "Euf":

	default:
		// Handle Dpst Event
		if state.isDpstEvent {
			k, err := strconv.Atoi(key)
			// In Battery History, time (in milliseconds) spent in user space and the kernel since the last step.
			d := time.Duration(k) * time.Millisecond
			if err != nil {
				return state, summary, errors.New("parsing int error for Dpst")
			}

			switch state.dpstTokenIndex {
			case 1:
				state.DpstStats.StatSystemTime = d
				summary.DpstOverallSummary["sys"] += d
			case 2:
				state.DpstStats.StatIOWaitTime = d
				summary.DpstOverallSummary["io"] += d
			case 3:
				state.DpstStats.StatIrqTime = d
				summary.DpstOverallSummary["irq"] += d
			case 4:
				state.DpstStats.StatSoftIrqTime = d
				summary.DpstOverallSummary["sirq"] += d
			case 5:
				state.DpstStats.StatIdlTime = d
				summary.DpstOverallSummary["idle"] += d
			}
			if state.dpstTokenIndex == 5 {
				summary.DpstStatsSummary = append(summary.DpstStatsSummary, state.DpstStats)
				state.DpstStats.Start = state.CurrentTime

				state.isDpstEvent = false
				return state, summary, nil
			}
			state.dpstTokenIndex++
		} else {
			fmt.Printf("Unknown history key: %s%s / %s\n", tr, key, value)
			return state, summary, errors.New("unknown key " + key)
		}
	}
	return state, summary, nil
}

// addCSVInstantAppEvent adds an instantaneous app event to the csv log.
func addCSVInstantAppEvent(csv *csv.State, state *DeviceState, idxMap map[string]ServiceUID, eventName, value string) error {
	suid, ok := idxMap[value]
	if !ok {
		return fmt.Errorf("unable to find index %q in idxMap for %q", value, eventName)
	}
	var appID int32
	s := suid.Service
	if suid.Pkg == nil {
		var err error
		appID, err = packageutils.AppIDFromString(suid.UID)
		if err != nil {
			return err
		}
	} else {
		appID = suid.Pkg.GetUid()
		if s == "" || s == `""` {
			// The current regex will include "" in the service string. Removing it will be a large change.
			// TODO: determine if it's better to keep the quotes in the struct representation or not.
			s = fmt.Sprintf(`%q`, suid.Pkg.GetPkgName())
		}
	}
	e := ServiceUID{
		Start:   state.CurrentTime,
		Service: s,
		UID:     suid.UID,
	}
	// The implementation of addEntryWithOpt requires two calls in order for the csv line to be printed out.
	csv.AddEntryWithOpt(eventName, &e, state.CurrentTime, fmt.Sprint(appID))
	csv.AddEntryWithOpt(eventName, &e, state.CurrentTime, fmt.Sprint(appID))
	return nil
}

// addCSVInstantEvent adds an instantaneous non-app event to the csv log.
func addCSVInstantEvent(csvState *csv.State, state *DeviceState, eventName, eventType, value string) {
	csvState.PrintInstantEvent(csv.Entry{
		Desc:  eventName,
		Start: state.CurrentTime,
		Type:  eventType,
		Value: value,
	})
}

func calDcpuOverallSummary(uid string, usrTime, sysTime int, dcpuOverallMap map[string]time.Duration, summaryActive bool) {
	if summaryActive {
		dcpuOverallMap[uid] += time.Duration(usrTime+sysTime) * time.Millisecond
	}
}

func printDebugEvent(b io.Writer, event, line string, state *DeviceState, summary *ActivitySummary) {
	fmt.Fprintln(b, "Processed", event, "in "+line,
		" state.CurrentTime =", time.Unix(0, state.CurrentTime*int64(time.Millisecond)),
		" summary.StartTime=", time.Unix(0, summary.StartTimeMs*int64(time.Millisecond)),
		" summary.EndTime=", time.Unix(0, summary.EndTimeMs*int64(time.Millisecond)))
}

func analyzeData(b io.Writer, csv *csv.State, state *DeviceState, summary *ActivitySummary, summaries *[]ActivitySummary,
	idxMap map[string]ServiceUID, pum PackageUIDMapping, line string) (*DeviceState, *ActivitySummary, error) {

	/*
	  8,h,60012:START
	  8,h,0:RESET:TIME:1400165448955
	  8,h,0:TIME:1398116676025
	  8,h,15954,+r,+w=37,+Wl,+Ws,Wr=28
	*/
	// Check for history resets
	if matches, result := historianutils.SubexpNames(ResetRE, line); matches {
		ts, exists := result["timeStamp"]
		if !exists {
			return state, summary, errors.New("count not extract TIME in line:" + line)
		}
		parsedInt64, err := strconv.ParseInt(ts, 10, 64)
		if err != nil {
			return state, summary, errors.New("int parsing error for TIME in line:" + line)
		}
		csv.PrintAllReset(state.CurrentTime)
		// Reset state and summary and start from scratch, History string pool
		// is still valid as we just read it
		if summary.StartTimeMs > 0 {
			state, summary = summarizeActiveState(state, summary, summaries, true, "RESET")
		}
		summary.StartTimeMs = parsedInt64
		summary.EndTimeMs = parsedInt64
		// state is reinitialized by summary.SummarizeAndResetState() so
		// this should never come before summaryPtr resetting.
		state.CurrentTime = parsedInt64
		return state, summary, nil
	}

	if matches, result := historianutils.SubexpNames(ShutdownRE, line); matches {
		// There should be a START statement immediately following this, so it would be
		// redundant to save the state here.
		timeDelta := result["timeDelta"]
		parsedInt64, err := strconv.ParseInt(timeDelta, 10, 64)
		if err != nil {
			return state, summary, errors.New("int parsing error for timestamp in line:" + line)
		}
		state.CurrentTime += parsedInt64
		summary.EndTimeMs = state.CurrentTime
		csv.AddRebootEvent(state.CurrentTime)

		return state, summary, nil
	}

	// Check for reboots, no need to increment the time as TIME statement will follow
	// just after START statement
	if matches := StartRE.FindStringSubmatch(line); matches != nil {
		csv.PrintAllReset(state.CurrentTime)
		// If there was no SHUTDOWN event in the bugreport,
		// we need to create the reboot entry here.
		if !csv.HasRebootEvent() {
			csv.AddRebootEvent(state.CurrentTime)
		}
		// printDebugEvent("START", line, state, summary)
		// Reset state and summary and start from scratch, History string pool
		// is still valid as we just read it
		state, summary = summarizeActiveState(state, summary, summaries, true, "START")
		return state, summary, nil
	}

	// Check for history start time
	if matches, result := historianutils.SubexpNames(TimeRE, line); matches {
		parsedInt64, err := strconv.ParseInt(result["timeStamp"], 10, 64)
		if err != nil {
			return state, summary, errors.New("int parsing error for TIME in line:" + line)
		}
		// Do not reset the summary start time if we are just parsing the next periodic report.
		// This is a random timestamp chosen to filter out timestamps that start at epoch.
		cutTime := time.Date(2005, time.August, 17, 12, 0, 0, 0, time.UTC).UnixNano() / int64(time.Millisecond)
		if summary.StartTimeMs < cutTime && parsedInt64 > cutTime {
			summary.StartTimeMs = parsedInt64
			summary.EndTimeMs = parsedInt64
		}
		state.CurrentTime = parsedInt64
		// Prints the reboot event if it exists. We assume a SHUTDOWN event is followed by START, then TIME.
		// It is printed here so the end time of the reboot event is the next start time.
		csv.PrintRebootEvent(state.CurrentTime)
		// printDebugEvent("TIME", line, state, summary)
		return state, summary, nil
	}

	// Check for overflow
	if OverflowRE.MatchString(line) {
		fmt.Fprintln(b, "Overflow line in "+line)
		// History is no longer useful
		return state, summary, nil
	}

	parts := strings.Split(line, ",")
	if len(parts) < 3 {
		return state, summary, errors.New("unknown format: " + line)
	}

	// Update current timestamp
	timeDelta := parts[2]
	parsedInt64, err := strconv.ParseInt(timeDelta, 10, 64)
	if err != nil {
		return state, summary, errors.New("int parsing error for timestamp in line:" + line)
	}
	state.CurrentTime += parsedInt64
	summary.EndTimeMs = state.CurrentTime

	if len(parts) >= 4 {
		success := true
		var errorBuffer bytes.Buffer
		for _, part := range parts[3:] {
			var err error
			if matches, result := historianutils.SubexpNames(DataRE, part); matches {
				v := result["value"]
				if result["key"] == "state_1" {
					// DataRE doesn't get the rest of the output because it doesn't expect spaces.
					v = part
				}
				state, summary, err = updateState(b, csv, state, summary, summaries, idxMap, pum, timeDelta,
					result["transition"], result["key"], v)
				if err != nil {
					success = false
					errorBuffer.WriteString("** Error in " + line + " with " + part + " : " + err.Error() + "\n")
				}
			}
		}
		if success {
			return state, summary, nil
		}
		return state, summary, errors.New(strings.TrimSpace(errorBuffer.String()))
	} else if len(parts) == 3 {
		return state, summary, nil
	}
	return state, summary, errors.New("unknown format: " + line)
}

// analyzeHistoryLine takes a battery history event string and updates the device state.
func analyzeHistoryLine(b io.Writer, csvState *csv.State, state *DeviceState, summary *ActivitySummary,
	summaries *[]ActivitySummary, idxMap map[string]ServiceUID, pum PackageUIDMapping,
	d *deltaMapping, line string, scrubPII bool) (*DeviceState, *ActivitySummary, error) {

	if match, result := historianutils.SubexpNames(GenericHistoryStringPoolLineRE, line); match {
		index := result["index"]
		service := result["service"]
		if scrubPII {
			service = historianutils.ScrubPII(service)
		}
		suid := ServiceUID{
			Service: service,
			UID:     result["uid"],
		}
		err := pum.matchServiceWithPackageInfo(&suid)
		idxMap[index] = suid
		return state, summary, err
	} else if match, result := historianutils.SubexpNames(GenericHistoryLineRE, line); match {
		state, summary, err := analyzeData(b, csvState, state, summary, summaries, idxMap, pum, line)
		// Add a mapping from the timestamp to current cumulative delta.
		// If there was no valid delta, don't add a mapping.
		timeDelta := result["timeDelta"]
		parsedInt64, parsedErr := strconv.ParseInt(timeDelta, 10, 64)
		if parsedErr != nil {
			log.Printf("could not parse time delta: %v", parsedErr.Error())
			return state, summary, err
		}
		if mappingErr := d.addMapping(state.CurrentTime, parsedInt64); mappingErr != nil {
			log.Printf("could not add time mapping: %v", mappingErr.Error())
		}
		return state, summary, err
	} else if matched, _ := regexp.MatchString("^NEXT: (\\d+)", line); matched {
		// Check for NEXT
		for k := range idxMap {
			delete(idxMap, k)
		}
		return state, summary, nil
	} else if matched, _ := regexp.MatchString("^7,h", line); matched {
		// Ignore old history versions
		return state, summary, nil
	} else if !VersionLineRE.MatchString(line) {
		return state, summary, errors.New("unknown line format: " + line)
	}
	return state, summary, nil
}

// AnalysisReport contains fields that are created as a result of analyzing and parsing a history.
type AnalysisReport struct {
	ReportVersion     int32
	Summaries         []ActivitySummary
	TimestampsAltered bool
	OutputBuffer      bytes.Buffer
	IdxMap            map[string]ServiceUID
	Errs              []error
	OverflowMs        int64
	// The keys are the unix timestamp in ms, and the values are the human readable time deltas.
	TimeToDelta map[string]string
}

// levelSummaryDimension has the name of a dimension, its attribute name corresponding to the attributes of AcitivitySummary,
// and a flag indicating whether it contains both number and duration (and is a Dist).
type levelSummaryDimension struct {
	name          string
	attributeName string
	hasNumDur     bool
}

// levelSummaryDimensions defines the order of dimensions in level summary CSV.
var levelSummaryDimensions = []levelSummaryDimension{
	{"StartTime", "StartTimeMs", false},
	{"EndTime", "EndTimeMs", false},
	{"Duration", "", false},
	{"Reason", "Reason", false},
	{"InitialBatteryLevel", "InitialBatteryLevel", false},
	{"FinalBatteryLevel", "FinalBatteryLevel", false},
	{"LevelDropPerHour", "", false},

	// The following dimensions have number and duration asscoiated.
	// Each will be expanded into two dimensions with suffix ".num" and ".dur".
	// Thus the third parameter should be "true".
	{"PluggedIn", "PluggedInSummary", true},
	{"ScreenOn", "ScreenOnSummary", true},
	{"MobileRadioOn", "MobileRadioOnSummary", true},
	{"WifiOn", "WifiOnSummary", true},
	{"CPURunning", "CPURunningSummary", true},

	{"GpsOn", "GpsOnSummary", true},
	{"SensorOn", "SensorOnSummary", true},
	{"WifiScan", "WifiScanSummary", true},
	{"WifiFullLock", "WifiFullLockSummary", true},
	{"WifiRadio", "WifiRadioSummary", true},
	{"WifiRunning", "WifiRunningSummary", true},
	{"WifiMulticastOn", "WifiMulticastOnSummary", true},

	{"AudioOn", "AudioOnSummary", true},
	{"CameraOn", "CameraOnSummary", true},
	{"VideoOn", "VideoOnSummary", true},
	{"LowPowerModeOn", "LowPowerModeOnSummary", true},
	{"FlashlightOn", "FlashlightOnSummary", true},
	{"ChargingOn", "ChargingOnSummary", true},

	{"PhoneCall", "PhoneCallSummary", true},
	{"PhoneScan", "PhoneScanSummary", true},

	{"BLEScan", "BLEScanSummary", true},

	{"TotalSync", "TotalSyncSummary", true},
}

// Prints the dimension value for a given level drop.
func (s ActivitySummary) printLevelSummaryValue(d levelSummaryDimension) string {
	duration := time.Duration(s.EndTimeMs-s.StartTimeMs) * time.Millisecond
	levelDropPerHour := float64(s.InitialBatteryLevel-s.FinalBatteryLevel) / duration.Hours()
	switch {
	case d.name == "Duration":
		return fmt.Sprintf("%d", int64(duration/time.Millisecond))
	case d.name == "Reason":
		return s.Reason
	case d.name == "LevelDropPerHour":
		return fmt.Sprintf("%f", levelDropPerHour)
	case !d.hasNumDur:
		return fmt.Sprint(reflect.ValueOf(s).FieldByName(d.attributeName).Interface())
	default:
		// Has number and duration. Use csv().
		summary := reflect.ValueOf(s).FieldByName(d.attributeName).Interface().(Dist)
		return summary.csv()
	}
}

// Generates a csv string for one aggregated level drop.
func (s *ActivitySummary) levelSummaryCSVString() string {
	duration := time.Duration(s.EndTimeMs-s.StartTimeMs) * time.Millisecond
	if duration == 0 {
		log.Printf("Error! Invalid duration equals 0!")
		return ""
	}
	var csv []string
	for _, d := range levelSummaryDimensions {
		csv = append(csv, s.printLevelSummaryValue(d))
	}
	return strings.Join(csv, ",")
}

// BatteryLevelSummariesToCSV writes level summary CSV for the visualization.
func BatteryLevelSummariesToCSV(buf io.Writer, summaries *[]ActivitySummary, printDimensions bool) {
	if printDimensions {
		dims := []string{}
		for _, d := range levelSummaryDimensions {
			if d.hasNumDur {
				dims = append(dims, d.name+".num", d.name+".dur")
			} else {
				dims = append(dims, d.name)
			}
		}
		io.WriteString(buf, strings.Join(dims, ",")+"\n")
	}
	for _, s := range *summaries {
		if s.InitialBatteryLevel > s.FinalBatteryLevel {
			line := s.levelSummaryCSVString()
			io.WriteString(buf, line+"\n")
		}
	}
}

// AnalyzeHistory takes as input a complete history log and desired summary format.
// It then analyzes the log line by line (delimited by newline characters).
// No summaries (before an OVERFLOW line) are excluded/filtered out.
func AnalyzeHistory(csvWriter io.Writer, history, format string, pum PackageUIDMapping, scrubPII bool) *AnalysisReport {
	// 8,hsp,0,10073,"com.google.android.volta"
	// 8,hsp,28,0,"200:qcom,smd-rpm:203:fc4281d0.qcom,mpm:222:fc4cf000.qcom,spmi"

	h, c, err := fixTimeline(history)
	var errs []error
	if err != nil {
		errs = append(errs, err)
	}

	deviceState := newDeviceState()
	summary := newActivitySummary(format)
	summaries := []ActivitySummary{}
	idxMap := make(map[string]ServiceUID)

	var writer io.Writer
	if format == FormatTotalTime {
		writer = csvWriter
	} else {
		writer = ioutil.Discard
	}

	csvState := csv.NewState(writer, true)
	var b bytes.Buffer
	var v int32
	overflowIdx := -1
	var overflowMs int64

	d := newDeltaMapping()

	for i, line := range h {
		if OverflowRE.MatchString(line) {
			overflowIdx = i
			// There can be multiple overflow events, but we only care about plotting the first one.
			overflowMs = deviceState.CurrentTime
			// Stop summary as soon as you OVERFLOW
			break
		}
		if match, result := historianutils.SubexpNames(VersionLineRE, line); match {
			p, err := strconv.ParseInt(result["version"], 10, 64)
			if err != nil {
				log.Printf("could not parse report version: %v", err.Error())
				continue
			}
			v = int32(p)
		} else {
			deviceState, summary, err = analyzeHistoryLine(&b, csvState, deviceState, summary, &summaries, idxMap, pum, d, line, scrubPII)
			if err != nil && len(line) > 0 {
				errs = append(errs, err)
			}
		}
	}

	if overflowIdx >= 0 {
		// All battery level events are still reported after overflow.
		es, lErrs := extractLevel(h[overflowIdx+1:], deviceState.CurrentTime, d)
		if len(lErrs) > 0 {
			errs = append(errs, lErrs...)
		}
		// End any existing battery level event using the start time of the first battery level event
		// after overflow. This needs to be done before PrintAllReset, as otherwise that would end the
		// battery level event at the time of overflow.
		// e.g.
		//   "9,h,0:RESET:TIME:1400000000000",
		//   "9,h,0,Bl=52",
		//   "9,h,0:*OVERFLOW*",
		//   "9,h,1000,Bl=51,Bt=236,Bv=3820,Pss=3,w=14,wr=18,+Esy=10",
		// should result in 2 entries:
		//   "Level,int,1400000000000,1400000001000,52,"  // End time equal Bl=51 event start time.
		//   "Level,int,1400000001000,1400000001000,51,"
		//
		// If there were no level events after overflow, that means overflow was the very last event,
		// and PrintAllReset will end any existing battery level event at the correct time.
		if len(es) > 0 && csvState.HasEvent(BatteryLevel, "") {
			csvState.EndEvent(BatteryLevel, "", es[0].Start)
		}
		// This may lead to CSV events being unordered, but we sort events on the JS side anyway.
		for _, e := range es {
			csvState.PrintEvent(BatteryLevel, e)
		}
	}

	csvState.PrintAllReset(deviceState.CurrentTime)
	csvState.PrintRebootEvent(deviceState.CurrentTime)
	if summary.Active {
		deviceState, summary = summarizeActiveState(deviceState, summary, &summaries, true, "END")
	}

	// csv generation must go after analyzing the history lines
	if format == FormatBatteryLevel {
		BatteryLevelSummariesToCSV(csvWriter, &summaries, true)
	}

	return &AnalysisReport{
		ReportVersion:     v,
		Summaries:         summaries,
		TimestampsAltered: c,
		OutputBuffer:      b,
		IdxMap:            idxMap,
		Errs:              errs,
		OverflowMs:        overflowMs,
		TimeToDelta:       d.timeToDelta,
	}
}

// extractLevel returns battery level events from the given history lines after an overflow event.
func extractLevel(h []string, curMs int64, d *deltaMapping) ([]csv.Event, []error) {
	var b bytes.Buffer
	csvState := csv.NewState(&b, false)

	ds := newDeviceState()
	ds.CurrentTime = curMs

	// We only want the generated CSV, so these are just dummy variables passed to analyzeHistoryLine.
	as := newActivitySummary(FormatTotalTime)
	var sums []ActivitySummary
	pum := PackageUIDMapping{}

	for _, l := range h {
		// Ignore errors as most will be due to incomplete (non battery level) events.
		// e.g. two negative transitions for "Temp White List
		ds, _, _ = analyzeHistoryLine(ioutil.Discard, csvState, ds, as, &sums, nil, pum, d, l, true)
	}
	csvState.PrintAllReset(ds.CurrentTime)
	es, errs := csv.ExtractEvents(b.String(), []string{BatteryLevel})
	return es[BatteryLevel], errs
}

// fixTimeline processes the given history, tries to fix the time statements in the
// history so that there is a consistent timeline, filters out lines that are not a
// part of the history log, and returns a slice of the fixed history, split by new
// lines, along with a boolean to indicate if the original history timestamps were
// modified. The function operates with the assumption that the last time statement
// in a history (between reboots) is the most accurate. This function should be
// called before analyzing the history.
func fixTimeline(h string) ([]string, bool, error) {
	var s []string
	// Filter out non-history log lines.
	for _, l := range strings.Split(h, "\n") {
		l = strings.TrimSpace(l)
		if GenericHistoryLineRE.MatchString(l) || GenericHistoryStringPoolLineRE.MatchString(l) || VersionLineRE.MatchString(l) {
			s = append(s, l)
		}
	}

	changed := false

	var time int64 // time will be defined at the beginning of the current line --> the time before the delta has been added
	timeFound := false
	var result map[string]string

	for i := len(s) - 1; i >= 0; i-- {
		line := s[i]

		if timeFound {
			if StartRE.MatchString(line) || ShutdownRE.MatchString(line) {
				// Seeing a START or SHUTDOWN means that the time we were using won't be valid for earlier statements
				// so go back to looking for a new TIME statement to use.
				timeFound = false
				continue
			}
			// For both 9,h,4051:TIME:1426513282239 and 9,h,0:RESET:TIME:1420714559370
			if sep := strings.Split(line, ":TIME:"); len(sep) == 2 {
				if time < 0 {
					return nil, false, errors.New("negative time calculated")
				}
				// Replace the time reported in the history log with the calculated time.
				s[i] = fmt.Sprintf("%s:TIME:%d", sep[0], time)
				changed = true
			}
			if match, result := historianutils.SubexpNames(GenericHistoryLineRE, line); match {
				d, err := strconv.ParseInt(result["timeDelta"], 10, 64)
				if err != nil {
					return nil, changed, err
				}
				time -= d
			}
		} else {
			if timeFound, result = historianutils.SubexpNames(TimeRE, line); !timeFound {
				timeFound, result = historianutils.SubexpNames(ResetRE, line)
			}
			if timeFound {
				t, err := strconv.ParseInt(result["timeStamp"], 10, 64)
				if err != nil {
					return nil, changed, err
				}
				d, err := strconv.ParseInt(result["timeDelta"], 10, 64)
				if err != nil {
					return nil, changed, err
				}
				time = t - d
			}
		}
	}
	return s, changed, nil
}

// PackageUIDMapping contains a series of mapping between package names and their UIDs.
type PackageUIDMapping struct {
	// uidToPackage maps from UIDs to their containing packages.
	// For shared UIDs, package names will be combined and delineated by ';'.
	uidToPackage map[int32]string
	// packageToUID maps from a package name to a UID.
	// The UID will be the appID as defined in packageutils.AppID()
	packageToUID map[string]int32
	// sharedUIDName maps from a UID to the corresponding shared UID label.
	// The string will be the predefined name, if it exists, otherwise, the shared UID name.
	sharedUIDName map[int32]string
	// pkgList contains all of the packages parsed to generate the mappings.
	pkgList []*usagepb.PackageInfo
}

// UIDAndPackageNameMapping builds a mapping of UIDs to package names and package names to UIDs.
// For shared UIDs in the UID to package name map, package names will be combined and delineated by ';'.
// For logs with multiple users, the package name to UID map will only include the app UID (which excludes the user ID).
func UIDAndPackageNameMapping(checkin string, pkgs []*usagepb.PackageInfo) (PackageUIDMapping, []error) {
	m := make(map[int32]string)
	p := make(map[string]int32)
	s := make(map[int32]string)
	var errs []error

	for _, l := range strings.Split(checkin, "\n") {
		if match, result := historianutils.SubexpNames(CheckinApkLineRE, l); match {
			u, err := strconv.ParseInt(result["uid"], 10, 32)
			if err != nil {
				errs = append(errs, fmt.Errorf("invalid UID in checkin 'apk' line: %q", err))
				continue
			}
			uid := int32(u)
			apk := result["pkgName"]
			if n, ok := m[uid]; ok {
				if !strings.Contains(n, apk) {
					m[uid] = fmt.Sprintf("%s;%s", n, apk)
				}
			} else {
				m[uid] = apk
			}
			appID := packageutils.AppID(uid)
			if i, ok := p[apk]; ok && i != appID {
				errs = append(errs, fmt.Errorf("duplicate package names found with different UIDs: %d and %d", i, appID))
			} else {
				p[apk] = appID
			}
		}
	}

	// Augment the maps with data in the pkg list since the checkin log will not have apk lines for every app.
	for _, pkg := range pkgs {
		i, ok := p[pkg.GetPkgName()]
		if !ok {
			p[pkg.GetPkgName()] = pkg.GetUid()
		} else if i != pkg.GetUid() {
			errs = append(errs, fmt.Errorf("mismatched UIDs between checkin log and package list: %d and %d", i, pkg.GetUid()))
		}

		if n, ok := m[pkg.GetUid()]; ok {
			if !strings.Contains(n, pkg.GetPkgName()) {
				m[pkg.GetUid()] = fmt.Sprintf("%s;%s", n, pkg.GetPkgName())
			}
		} else {
			m[pkg.GetUid()] = pkg.GetPkgName()
		}

		if suid := pkg.GetSharedUserId(); pkg.GetUid() != 0 && suid != "" {
			gn := checkinparse.GroupName(suid)
			if gn == "" {
				gn = fmt.Sprintf("SharedUserID(%s)", suid)
			}
			if c, ok := s[pkg.GetUid()]; ok && c != gn {
				errs = append(errs, fmt.Errorf("uid %d had different shared user IDs: %q vs %q", pkg.GetUid(), c, gn))
				continue
			}
			s[pkg.GetUid()] = gn
		}
	}

	return PackageUIDMapping{m, p, s, pkgs}, errs
}

// matchServiceWithPackageInfo attempts to match the best usagepb.PackageInfo for the given ServiceUID.
func (pum *PackageUIDMapping) matchServiceWithPackageInfo(suid *ServiceUID) error {
	// Check hard-coded UIDs first
	uid, err := packageutils.AppIDFromString(suid.UID)
	if err != nil {
		return err
	}
	if uid != 0 {
		// Some valid entries in the history would have been logged with UID '0',
		// so ignore it at this check.
		if n, ok := checkinparse.KnownUIDs[uid]; ok {
			suid.Pkg = &usagepb.PackageInfo{
				PkgName: proto.String(n),
				Uid:     proto.Int32(uid),
			}
			return nil
		}
		if n, ok := pum.sharedUIDName[uid]; ok {
			suid.Pkg = &usagepb.PackageInfo{
				PkgName: proto.String(n),
				Uid:     proto.Int32(uid),
			}
			return nil
		}
	}

	// See if simple matching works
	pkg, err := packageutils.GuessPackage(suid.Service, suid.UID, pum.pkgList)
	if err != nil {
		return err
	}
	if pkg != nil {
		// Check if the package is part of a shared UID group. If so, we should use that instead.
		if n := checkinparse.GroupName(pkg.GetSharedUserId()); n != "" {
			suid.Pkg = &usagepb.PackageInfo{
				PkgName: proto.String(n),
				Uid:     pkg.Uid,
			}
			return nil
		}
		if n := checkinparse.PackageUIDGroupName(pkg.GetPkgName()); n != "" {
			suid.Pkg = &usagepb.PackageInfo{
				PkgName: proto.String(n),
				Uid:     pkg.Uid,
			}
			return nil
		}
	}
	// Holding off this check until now in case GuessPackage returns a better package.
	if ps := pum.uidToPackage[uid]; uid != 0 && strings.Contains(ps, ";") {
		suid.Pkg = &usagepb.PackageInfo{
			PkgName: proto.String(ps),
			Uid:     proto.Int32(uid),
		}
		return nil
	}

	// Many applications will incorrectly match with the "android" package. If we didn't find a package
	// using the service (usually sync) name or it incorrectly matched with android then we try to use
	// the package name listed in the checkin log to try to get a better match. We do this after trying
	// to use the service string because trying to do it in the opposite order yields poor results when
	// dealing with shared UIDs. For example, given the service string "com.google.android.gms.games/...@google.com",
	// we would expect that to match to com.google.android.gms, however, com.google.android.gms and com.google.android.gsf
	// share the UID, so if we did this in the opposite order, there is a chance we would match the
	// service string to gsf instead of gms.
	if pkg == nil || pkg.GetPkgName() == "android" {
		if p, ok := pum.uidToPackage[uid]; ok {
			pkg, err = packageutils.GuessPackage(p, suid.UID, pum.pkgList)
			if err != nil {
				return err
			}
			if pkg == nil {
				pkg = &usagepb.PackageInfo{
					PkgName: proto.String(p),
					Uid:     proto.Int32(uid),
				}
			}
		} else {
			s := strings.Trim(suid.Service, `"`)
			if u, ok := pum.packageToUID[s]; ok {
				pkg, err = packageutils.GuessPackage(s, fmt.Sprint(u), pum.pkgList)
				if err != nil {
					return err
				}
				if pkg == nil {
					pkg = &usagepb.PackageInfo{
						PkgName: proto.String(s),
						Uid:     proto.Int32(u),
					}
				}
			}
		}
	}
	suid.Pkg = pkg
	return nil
}

// packageName attempts to get the best package name for the given UID.
func (pum *PackageUIDMapping) packageName(uid int32) string {
	// Check hard-coded UIDs first
	if n, ok := checkinparse.KnownUIDs[uid]; ok {
		return n
	}
	if n, ok := pum.sharedUIDName[uid]; ok {
		return n
	}
	return pum.uidToPackage[uid]
}
