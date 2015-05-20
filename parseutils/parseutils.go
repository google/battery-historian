// Copyright 2015 Google Inc. All Rights Reserved.
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
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/battery-historian/csv"
)

// These constants should be kept consistent with BatteryStats.java.
const (
	FormatBatteryLevel = "batteryLevel"
	FormatTotalTime    = "totalTime"

	BatteryStatsCheckinVersion = "9"
	HistoryStringPool          = "hsp"
	HistoryData                = "h"
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
		HistoryData + "," + "(?P<timeDelta>\\d+).+")

	// GenericHistoryStringPoolLineRE is a regular expression to match any of the history string pool lines.
	GenericHistoryStringPoolLineRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + "," +
		HistoryStringPool + "," + "(?P<index>\\d+),(?P<uid>-?\\d+),(?P<service>.+)")

	// VersionLineRE is a regular expression to match the vers statement in the history log.
	VersionLineRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + `,\d+,i,vers,\d+,\d+,.*`)

	// DataRE is a regular expression to match the data event log.
	DataRE = regexp.MustCompile("(?P<transition>[+-]?)" + "(?P<key>\\w+)" + "(,?(=?(?P<value>\\S+))?)")

	// PIIRE is a regular expression to match any PII string of the form abc@xxx.yyy.
	PIIRE = regexp.MustCompile("(?P<prefix>\\S+/)" + "(?P<account>\\S+)" + "(?P<site>@)" + "(?P<suffix>\\S*)")

	// OverflowRE is a regular expression that matches OVERFLOW event.
	OverflowRE = regexp.MustCompile("^" + BatteryStatsCheckinVersion + "," + HistoryData + "," +
		"\\d+:\\*OVERFLOW\\*")

	// CheckinApkLineRE is a regular expression that matches the "apk" line in a checkin log.
	CheckinApkLineRE = regexp.MustCompile("(\\d+,)?(?P<uid>\\d+),l,apk,\\d+,(?P<pkgName>[^,]+),.*")

	// Constants defined in http://developer.android.com/reference/android/net/ConnectivityManager.html
	connConstants = map[string]string{
		"0":  "TYPE_MOBILE",
		"1":  "TYPE_WIFI",
		"2":  "TYPE_MOBILE_MMS",
		"3":  "TYPE_MOBILE_SUPL",
		"4":  "TYPE_MOBILE_DUN",
		"5":  "TYPE_MOBILE_HIPRI",
		"6":  "TYPE_WIMAX",
		"7":  "TYPE_BLUETOOTH",
		"8":  "TYPE_DUMMY",
		"9":  "TYPE_ETHERNET",
		"17": "TYPE_VPN",
	}
)

// ServiceUID contains the identifying service for battery operations.
type ServiceUID struct {
	Start int64
	// We are treating UIDs as strings
	Service, UID string
}

// Dist is a distribution summary for a battery metric.
type Dist struct {
	Num           int32
	TotalDuration time.Duration
	MaxDuration   time.Duration
}

// interval is used for gathering all sync durations to summarize total sync time
type interval struct {
	startTimeMs, endTimeMs int64
}

// Calculate total duration of sync time without breaking down by apps
func calTotalSync(state *DeviceState) Dist {
	var d Dist
	d.Num = int32(len(state.syncIntervals))

	// merge intervals
	var intervals []interval
	if d.Num > 0 {
		intervals = mergeIntervals(state.syncIntervals)
	}

	// loop through intervals to gather total sync time
	for _, i := range intervals {
		duration := time.Duration(i.endTimeMs-i.startTimeMs) * time.Millisecond
		d.TotalDuration += duration
		// the max duration here is the merged intervals' max duration
		if duration > d.MaxDuration {
			d.MaxDuration = duration
		}
	}
	return d
}

// Merge all the intervals for syncs in all apps
func mergeIntervals(intervals []interval) []interval {
	// Need to sort the intervals by startTime here,
	// because the following algorithm will be relied on sorted intervals
	sort.Sort(sortByStartTime(intervals))

	var res []interval
	prev := intervals[0]
	for _, cur := range intervals[1:] {
		if prev.endTimeMs < cur.startTimeMs {
			res = append(res, prev)
			prev = cur
		} else {
			prev = interval{prev.startTimeMs, max(prev.endTimeMs, cur.endTimeMs)}
		}
	}
	res = append(res, prev)
	return res
}

// Counts on negative transitions
func (s *ServiceUID) assign(curTime int64, summaryActive bool, summaryStartTime int64, activeMap map[string]*ServiceUID, summary map[string]Dist, tr, value, desc string, csv *csv.State) error {

	_, alreadyActive := activeMap[value]
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
			csv.AddEntryWithOpt(desc, s, s.Start, s.UID)
		}
		if summaryActive {
			d := summary[s.Service]
			duration := time.Duration(curTime-activeMap[value].Start) * time.Millisecond
			d.TotalDuration += duration
			if duration > d.MaxDuration {
				d.MaxDuration = duration
			}
			d.Num++
			summary[s.Service] = d
		}
		delete(activeMap, value)

	default:
		return fmt.Errorf("unknown transition for %q:%q", desc, tr)
	}
	csv.AddEntryWithOpt(desc, s, curTime, s.UID)
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
		d.TotalDuration += duration
		if duration > d.MaxDuration {
			d.MaxDuration = duration
		}
		d.Num++

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
// UIDs can have multiple service names, however we want each
// service name to have it's own csv entry.
func (s *ServiceUID) GetKey(desc string) csv.Key {
	return csv.Key{
		desc,
		s.Service,
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
			csv.AddEntry(desc, s, s.Start)
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
			summary.TotalDuration += duration
			if duration > summary.MaxDuration {
				summary.MaxDuration = duration
			}
			summary.Num++
		}
		s.Value = false
		csv.AddEntry(desc, s, curTime)
	}

	// Off -> On
	if isOn && !s.Value {
		s.Value = true
		csv.AddEntry(desc, s, curTime)
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
			summary.TotalDuration += duration
			if duration > summary.MaxDuration {
				summary.MaxDuration = duration
			}
			summary.Num++
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
		csv.AddEntry(desc, s, curTime)
		if summaryActive {
			d := summary[s.Value]
			duration := time.Duration(curTime-s.Start) * time.Millisecond
			d.TotalDuration += duration
			if duration > d.MaxDuration {
				d.MaxDuration = duration
			}
			d.Num++
			summary[s.Value] = d
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
		s.Value = "default"
	}

	if summaryActive {
		d := summary[s.Value]
		duration := time.Duration(curTime-s.Start) * time.Millisecond
		d.TotalDuration += duration
		if duration > d.MaxDuration {
			d.MaxDuration = duration
		}
		d.Num++
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

func (d *Dist) print(b io.Writer, duration time.Duration) {
	fmt.Fprintf(b, "=> Rate (per hr): (%5.2f , %10.2f secs)\t Total: (%5d, %20s, %20s)\n", float64(d.Num)/duration.Hours(), d.TotalDuration.Seconds()/duration.Hours(), d.Num, d.TotalDuration, d.MaxDuration)
}

// DeviceState maintains the instantaneous state of the device created using battery history events.
//
// All fields of this type must have corresponding initialization code in initStartTimeForAllStates()
type DeviceState struct {
	CurrentTime        int64
	LastWakeupTime     int64         // To deal with asynchronous arrival of wake reasons
	LastWakeupDuration time.Duration // To deal with asynchronous arrival
	WakeLockInSeen     bool          // To determine if detailed wakelock_in events (Ewl) are available for use instead of wake lock (w).

	// Instanteous state
	Temperature    tsInt
	Voltage        tsInt
	BatteryLevel   tsInt
	Brightness     tsInt
	SignalStrength tsInt

	PhoneState     tsString
	DataConnection tsString // hspa, hspap, lte
	PlugType       tsString
	ChargingStatus tsString
	Health         tsString

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
	WifiRunning     tsBool
	PhoneScanning   tsBool
	ScreenOn        tsBool
	Plugged         tsBool
	PhoneInCall     tsBool
	WakeLockHeld    tsBool
	// SyncOn       tsBool
	IdleModeOn tsBool

	WakeLockHolder ServiceUID
	WakeupReason   ServiceUID

	syncIntervals []interval

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
	ScheduledJobMap map[string]*ServiceUID

	// If wakelock_in events are not available, then only the first entity to acquire a
	// wakelock gets charged, so the map will have just one entry
	WakeLockMap map[string]*ServiceUID

	// Event names
	/*
		EventNull tsBool
		EventProc ServiceUID
		EventFg   ServiceUID
		EventTop  ServiceUID
		EventSy   ServiceUID
	*/

	// Not implemented yet
	BluetoothOn    tsBool
	VideoOn        tsBool
	AudioOn        tsBool
	LowPowerModeOn tsBool
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
	state.SignalStrength.initStart(state.CurrentTime)
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
	state.WifiRunning.initStart(state.CurrentTime)
	state.PhoneScanning.initStart(state.CurrentTime)
	state.ScreenOn.initStart(state.CurrentTime)
	state.Plugged.initStart(state.CurrentTime)
	state.PhoneInCall.initStart(state.CurrentTime)
	state.WakeLockHeld.initStart(state.CurrentTime)
	state.WakeLockHolder.initStart(state.CurrentTime)
	state.WakeupReason.initStart(state.CurrentTime)
	state.BluetoothOn.initStart(state.CurrentTime)
	state.VideoOn.initStart(state.CurrentTime)
	state.AudioOn.initStart(state.CurrentTime)
	state.LowPowerModeOn.initStart(state.CurrentTime)
	state.IdleModeOn.initStart(state.CurrentTime)

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

	for _, s := range state.WakeLockMap {
		s.initStart(state.CurrentTime)
	}

	for _, s := range state.ScheduledJobMap {
		s.initStart(state.CurrentTime)
	}
}

// newDeviceState returns a new properly initialized DeviceState structure.
func newDeviceState() *DeviceState {
	return &DeviceState{
		ActiveProcessMap:     make(map[string]*ServiceUID),
		AppSyncingMap:        make(map[string]*ServiceUID),
		ForegroundProcessMap: make(map[string]*ServiceUID),
		TopApplicationMap:    make(map[string]*ServiceUID),
		ConnectivityMap:      make(map[string]*ServiceUID),
		WakeLockMap:          make(map[string]*ServiceUID),
		ScheduledJobMap:      make(map[string]*ServiceUID),
	}
}

// ActivitySummary contains battery statistics during an aggregation interval.
// Each entry in here should have a corresponding value in session.proto:Summary
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
	WifiRunningSummary     Dist
	WifiMulticastOnSummary Dist

	PhoneCallSummary Dist
	PhoneScanSummary Dist

	// Stats for total syncs without breaking down by apps
	TotalSyncSummary Dist

	// Stats for each individual state
	DataConnectionSummary    map[string]Dist // LTE, HSPA
	ConnectivitySummary      map[string]Dist
	ForegroundProcessSummary map[string]Dist
	ActiveProcessSummary     map[string]Dist
	TopApplicationSummary    map[string]Dist
	PerAppSyncSummary        map[string]Dist
	WakeupReasonSummary      map[string]Dist
	ScheduledJobSummary      map[string]Dist

	HealthSummary         map[string]Dist
	PlugTypeSummary       map[string]Dist
	ChargingStatusSummary map[string]Dist // c, d, n, f
	PhoneStateSummary     map[string]Dist
	WakeLockSummary       map[string]Dist

	Date string

	AudioOnSummary        Dist
	VideoOnSummary        Dist
	LowPowerModeOnSummary Dist
	IdleModeOnSummary     Dist
}

// newActivitySummary returns a new properly initialized ActivitySummary structure.
func newActivitySummary(summaryFormat string) *ActivitySummary {
	return &ActivitySummary{
		Active:                   true,
		SummaryFormat:            summaryFormat,
		InitialBatteryLevel:      -1,
		DataConnectionSummary:    make(map[string]Dist),
		ConnectivitySummary:      make(map[string]Dist),
		ForegroundProcessSummary: make(map[string]Dist),
		ActiveProcessSummary:     make(map[string]Dist),
		TopApplicationSummary:    make(map[string]Dist),
		PerAppSyncSummary:        make(map[string]Dist),
		WakeupReasonSummary:      make(map[string]Dist),
		HealthSummary:            make(map[string]Dist),
		PlugTypeSummary:          make(map[string]Dist),
		ChargingStatusSummary:    make(map[string]Dist),
		PhoneStateSummary:        make(map[string]Dist),
		WakeLockSummary:          make(map[string]Dist),
		ScheduledJobSummary:      make(map[string]Dist),
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

// sortByStartTime sorts intervals in ascending order of startTimeMs
type sortByStartTime []interval

func (a sortByStartTime) Len() int      { return len(a) }
func (a sortByStartTime) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a sortByStartTime) Less(i, j int) bool {
	return a[i].startTimeMs < a[j].startTimeMs
}

// max function for int64
func max(a int64, b int64) int64 {
	if a >= b {
		return a
	}
	return b
}

func printMap(b io.Writer, name string, m map[string]Dist, duration time.Duration) {
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

// concludeActiveFromState summarizes all activeProcesses, syncs running, apps on top, etc.
func concludeActiveFromState(state *DeviceState, summary *ActivitySummary, csv *csv.State) (*DeviceState, *ActivitySummary) {
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

	// Wifi: W **
	state.WifiOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.WifiOnSummary)

	// Wifi Full lock: Wl **
	state.WifiFullLock.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.WifiFullLockSummary)

	// Wifi Running: Wr **
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

	// Idle (Doze) Mode: di
	state.IdleModeOn.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, &summary.IdleModeOnSummary)

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

	/////////////////////////
	// wake_reason: wr **
	if state.WakeupReason.Service != "" {
		state.WakeupReason.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.WakeupReasonSummary)
	}

	// wake_lock: w **
	if state.WakeLockHeld.Value && !state.WakeLockInSeen {
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
		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.TopApplicationSummary)
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
			i := interval{start, state.CurrentTime}
			state.syncIntervals = append(state.syncIntervals, i)
		}

		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.PerAppSyncSummary)
	}

	// wakelock_in: Ewl **
	for _, suid := range state.WakeLockMap {
		suid.updateSummary(state.CurrentTime, summary.Active, summary.StartTimeMs, summary.WakeLockSummary)
	}

	// Connectivity changes: Ecn **
	for _, suid := range state.ConnectivityMap {
		t, ok := connConstants[suid.UID]
		if !ok {
			t = "UNKNOWN"
		}

		ntwkSummary := summary.ConnectivitySummary
		if suid.Start == 0 {
			suid.Start = summary.StartTimeMs
		}
		if summary.Active {
			d := ntwkSummary[t]
			duration := time.Duration(state.CurrentTime-suid.Start) * time.Millisecond
			d.TotalDuration += duration
			if duration > d.MaxDuration {
				d.MaxDuration = duration
			}
			d.Num++

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

	// Temperature: Bt

	// Voltage: Bv

	// Screen Brightness: Sb

	// Phone signal strength: Pss

	// Not implemented as yet:
	// Bluetooth, Audio, Video
	return state, summary
}

// summarizeActiveState stores the current summary in the output slice and resets the summary.
// If a reset of state is requested too (after a reboot or a reset of battery history) only then
// is the state cleared, otherwise the state is retained after summarizing.
func summarizeActiveState(d *DeviceState, s *ActivitySummary, summaries *[]ActivitySummary, reset bool, reason string, csv *csv.State) (*DeviceState, *ActivitySummary) {
	if s.StartTimeMs != s.EndTimeMs {
		s.Reason = reason
		d, s = concludeActiveFromState(d, s, csv)
		s.TotalSyncSummary = calTotalSync(d)
		*summaries = append(*summaries, *s)
	}

	s = newActivitySummary(s.SummaryFormat)
	d.syncIntervals = []interval{}

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

	fmt.Fprintf(b, "%30s", "WifiRunning")
	s.WifiRunningSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "PhoneScan")
	s.PhoneScanSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "SensorOn")
	s.SensorOnSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "PluggedIn:")
	s.PluggedInSummary.print(b, duration)

	fmt.Fprintf(b, "%30s", "DozeModeOn:")
	s.IdleModeOnSummary.print(b, duration)

	printMap(b, "DataConnectionSummary", s.DataConnectionSummary, duration)
	printMap(b, "ConnectivitySummary", s.ConnectivitySummary, duration)
	printMap(b, "WakeLockSummary", s.WakeLockSummary, duration)
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
	printMap(b, "ScheduledJobSummary", s.ScheduledJobSummary, duration)
}

// updateState method interprets the events contained in the battery history string
// according to the definitions in:
// android//frameworks/base/core/java/android/os/BatteryStats.java
func updateState(b io.Writer, csv *csv.State, state *DeviceState, summary *ActivitySummary, summaries *[]ActivitySummary,
	idxMap map[string]ServiceUID, idx, tr, key, value string) (*DeviceState, *ActivitySummary, error) {

	switch key {
	case "Bs": // status
		i := state.ChargingStatus
		active := summary.Active
		ret := state.ChargingStatus.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.ChargingStatusSummary, value, "Charging status", csv)

		switch value {
		case "?": // unknown
		case "c": // charging
			if active && i != state.ChargingStatus {
				state, summary = summarizeActiveState(state, summary, summaries, false, "CHARGING", csv)
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
			summary.HealthSummary, value, "health", csv)

	case "Bp": // plug
		switch value {
		case "n": // none
		case "a": // ac
		case "w": // wireless
		case "u": // usb
		default:
			return state, summary, fmt.Errorf("unknown plug type = %q", value)
		}
		return state, summary, state.PlugType.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.PlugTypeSummary, value, "plug", csv)

	case "Bt": // temperature
		return state, summary, state.Temperature.assign(state.CurrentTime, value, summary.Active, "temperature", csv)

	case "Bv": // volt
		return state, summary, state.Voltage.assign(state.CurrentTime, value, summary.Active, "voltage", csv)

	case "Bl": // level
		i := state.BatteryLevel
		parsedLevel, err := strconv.Atoi(value)
		if err != nil {
			return state, summary, errors.New("parsing int error for level")
		}
		ret := state.BatteryLevel.assign(state.CurrentTime, value, summary.Active, "level", csv)

		summary.FinalBatteryLevel = parsedLevel

		if !summary.Active || summary.InitialBatteryLevel == -1 {
			summary.InitialBatteryLevel = parsedLevel
		} else {
			if summary.Active && summary.SummaryFormat == FormatBatteryLevel && i != state.BatteryLevel {
				state, summary = summarizeActiveState(state, summary, summaries, false, "LEVEL", csv)
			}
		}
		return state, summary, ret

	case "BP": // plugged = {+BP, -BP}
		return state, summary, state.Plugged.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.PluggedInSummary, tr, "plugged", csv)

	case "r": // running
		// Needs special handling as the wakeup reason will arrive asynchronously
		switch tr {
		case "+":
			// Note the time the new state starts
			state.CPURunning.Start = state.CurrentTime
			state.CPURunning.Value = true
			csv.AddEntry("CPU running", &state.CPURunning, state.CurrentTime)

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
			}
			csv.AddEntry("CPU running", &state.CPURunning, state.CurrentTime)
			if summary.Active {
				duration := time.Duration(state.CurrentTime-state.CPURunning.Start) * time.Millisecond
				summary.CPURunningSummary.TotalDuration += duration
				if duration > summary.CPURunningSummary.MaxDuration {
					summary.CPURunningSummary.MaxDuration = duration
				}
				summary.CPURunningSummary.Num++
			}
			state.LastWakeupDuration = time.Duration(state.CurrentTime-state.CPURunning.Start) * time.Millisecond
			// Note the time the new state starts
			state.CPURunning.Start = state.CurrentTime
			state.CPURunning.Value = false

			// Account for wakeup reason stats
			if state.WakeupReason.Service != "" {
				if summary.Active {
					d := summary.WakeupReasonSummary[state.WakeupReason.Service]

					duration := state.LastWakeupDuration
					d.TotalDuration += duration
					if duration > d.MaxDuration {
						d.MaxDuration = duration
					}
					d.Num++
					summary.WakeupReasonSummary[state.WakeupReason.Service] = d
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
		state.WakeupReason.Service = serviceUID.Service

		if state.CPURunning.Value == true {
			state.WakeupReason.Start = state.CPURunning.Start
		} else {
			// Wakeup reason received when CPU is not running.
			// Summarize here based on the lastwakeuptime and lastwakeupduration
			if state.LastWakeupTime == 0 {
				return state, summary, nil
			}
			state.WakeupReason.Start = state.LastWakeupTime
			if summary.Active {
				d := summary.WakeupReasonSummary[state.WakeupReason.Service]
				duration := state.LastWakeupDuration
				d.TotalDuration += duration
				if duration > d.MaxDuration {
					d.MaxDuration = duration
				}
				d.Num++
				summary.WakeupReasonSummary[state.WakeupReason.Service] = d
			}
			state.WakeupReason.Service = ""
			state.LastWakeupTime = 0
			state.LastWakeupDuration = 0
		}

	case "w": // wake_lock
		//   Special case this, as the +w will only have the first application to take the wakelock
		if state.WakeLockInSeen {
			// If wakelock_in has been seen, ignore wake_lock.
			return state, summary, nil
		}
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
						return state, summary, errors.New("Logic error")
					}
					return state, summary, nil
				}
				// Dealing with the case where we see two consecutive +w=123, +w=456
				return state, summary, errors.New("two holders of the wakelock?")
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
					return state, summary, fmt.Errorf("Wakelock held by unknown service : %q", value)
				}
				state.WakeLockHolder.Service = serviceUID.Service
			}
			state.WakeLockHolder.Start = state.CurrentTime
			state.WakeLockHeld = tsBool{Start: state.CurrentTime, Value: true}
		case "-":
			if !state.WakeLockHeld.Value {
				// There was no + transition for this
				state.WakeLockHolder.Start = summary.StartTimeMs
				state.WakeLockHolder.Service = "unknown-wakelock-holder"
			}
			if summary.Active {
				d := summary.WakeLockSummary[state.WakeLockHolder.Service]
				duration := time.Duration(state.CurrentTime-state.WakeLockHolder.Start) * time.Millisecond
				d.TotalDuration += duration
				if duration > d.MaxDuration {
					d.MaxDuration = duration
				}
				d.Num++
				summary.WakeLockSummary[state.WakeLockHolder.Service] = d
			}
			state.WakeLockHeld = tsBool{Start: state.CurrentTime, Value: false}

		default:
			return state, summary, fmt.Errorf("unknown transition for wakelock : %q", tr)
		}
		csv.AddEntry("Partial wakelock", &state.WakeLockHolder, state.CurrentTime)

	case "g": // gps
		return state, summary, state.GpsOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.GpsOnSummary, tr, "GPS", csv)

	case "s": // sensor
		return state, summary, state.SensorOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.SensorOnSummary, tr, "Sensor", csv)

	case "S": // screen
		return state, summary, state.ScreenOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.ScreenOnSummary, tr, "Screen", csv)

	case "Sb": // brightness
		return state, summary, state.Brightness.assign(state.CurrentTime, value, summary.Active, "Brightness", csv)

	case "Pcl": // phone_in_call
		return state, summary, state.PhoneInCall.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.PhoneCallSummary, tr, "Phone call", csv)

	case "Pcn": // data_conn
		return state, summary, state.DataConnection.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.DataConnectionSummary, value, "Data connection", csv)

	case "Pr": // modile_radio
		return state, summary, state.MobileRadioOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.MobileRadioOnSummary, tr, "Mobile radio", csv)

	case "Psc": // phone_scanning
		return state, summary, state.PhoneScanning.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.PhoneScanSummary, tr, "Phone scanning", csv)

	case "Pss": // signal_strength
		return state, summary, state.SignalStrength.assign(state.CurrentTime, value, summary.Active, "Signal strength", csv)

	case "Pst": // phone_state
		switch value {
		case "in":
		case "out":
		case "em": // emergency
		case "off":
		default:
			return state, summary, fmt.Errorf("unknown phone state = %q", value)
		}
		return state, summary, state.PhoneState.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			summary.PhoneStateSummary, value, "Phone state", csv)

	case "Enl": // null
		return state, summary, errors.New("sample: Null Event line = " + tr + key + value)

	case "Epr": // proc
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for active process", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs, state.ActiveProcessMap,
			summary.ActiveProcessSummary, tr, value, "Active process", csv)

	case "Efg": // fg
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for foreground process", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs, state.ForegroundProcessMap,
			summary.ForegroundProcessSummary, tr, value, "Foreground process", csv)

	case "Etp": // top
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for top app", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs, state.TopApplicationMap,
			summary.TopApplicationSummary, tr, value, "Top app", csv)

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
				i := interval{start, state.CurrentTime}
				state.syncIntervals = append(state.syncIntervals, i)
			}
		}

		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs, state.AppSyncingMap,
			summary.PerAppSyncSummary, tr, value, "SyncManager app", csv)

	case "W": // wifi
		return state, summary, state.WifiOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.WifiOnSummary, tr, "Wifi on", csv)

	case "Wl": // wifi_full_lock
		return state, summary, state.WifiFullLock.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.WifiFullLockSummary, tr, "Wifi full lock", csv)

	case "Ws": // wifi_scan
		return state, summary, state.WifiScan.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.WifiScanSummary, tr, "Wifi scan", csv)

	case "Wm": // wifi_multicast
		return state, summary, state.WifiMulticastOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.WifiMulticastOnSummary, tr, "Wifi multicast", csv)

	case "Wr": // wifi_running
		// Temporary workaround to disambiguate Wr
		if len(tr) > 0 {
			// WifI Lock
			return state, summary, state.WifiRunning.assign(state.CurrentTime,
				summary.Active, summary.StartTimeMs,
				&summary.WifiRunningSummary, tr, "Wifi running", csv)
		}

	case "lp", "ps": // Low power mode was renamed to power save mode in M: ag/659258
		return state, summary, state.LowPowerModeOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.LowPowerModeOnSummary, tr, "Power Save Mode", csv)

	case "a": // audio
		return state, summary, state.AudioOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.AudioOnSummary, tr, "Audio", csv)

	case "v": // video
		return state, summary, state.VideoOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.VideoOnSummary, tr, "Video", csv)

	case "Ecn":
		suid := idxMap[value]
		t, ok := connConstants[suid.UID]
		if !ok {
			t = "UNKNOWN"
		}

		activeNtwks := state.ConnectivityMap
		ntwkSummary := summary.ConnectivitySummary

		_, alreadyActive := activeNtwks[t]

		switch suid.Service {
		case `"CONNECTED"`:
			if alreadyActive {
				// Intended behavior, no change to record.
				return state, summary, nil
			}
			suid.Start = state.CurrentTime
			activeNtwks[t] = &suid

		case `"DISCONNECTED"`:
			d := ntwkSummary[t]
			if !alreadyActive {
				// There was no CONNECT for this, and there hasn't been a prior
				// DISCONNECT, so assuming that it was already active at the
				// beginning of the summary period (the current ActivitySummary).
				// There could be duplicate DISCONNECTs due to b/19114418 and
				// b/19269815 so we need to verify that this is the first
				// DISCONNECT seen.
				if d.Num != 0 {
					return state, summary, nil
				}
				suid.Start = summary.StartTimeMs
				activeNtwks[t] = &suid
				csv.AddEntry("Network connectivity", &ServiceUID{suid.Start, t, suid.UID}, suid.Start)
			}

			if summary.Active {
				duration := time.Duration(state.CurrentTime-activeNtwks[t].Start) * time.Millisecond
				d.TotalDuration += duration
				if duration > d.MaxDuration {
					d.MaxDuration = duration
				}
				d.Num++
				ntwkSummary[t] = d
			}
			delete(activeNtwks, t)

		default:
			fmt.Printf("Unknown Ecn change string: %s\n", suid.Service)
			return state, summary, fmt.Errorf("Unknown Ecn change string: %s\n", suid.Service)
		}
		csv.AddEntry("Network connectivity", &ServiceUID{state.CurrentTime, t, suid.UID}, state.CurrentTime)

	case "Ewl": // wakelock_in
		if !state.WakeLockInSeen {
			// TODO: Verify if WakeLockMap should be overwritten or extended.
			// First time seeing wakelock_in, overwrite the current map in case
			// wake_lock summaries have been stored.
			state.WakeLockMap = make(map[string]*ServiceUID)
			state.WakeLockInSeen = true
		}
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for wakelock_in", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs, state.WakeLockMap,
			summary.WakeLockSummary, tr, value, "wakelock_in", csv)

	case "di": // device idle (doze) mode of M
		return state, summary, state.IdleModeOn.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs,
			&summary.IdleModeOnSummary, tr, "Doze Mode", csv)

	case "Ejb": // job: an application executing a scheduled job
		serviceUID, ok := idxMap[value]
		if !ok {
			return state, summary, fmt.Errorf("unable to find index %q in idxMap for job", value)
		}
		return state, summary, serviceUID.assign(state.CurrentTime,
			summary.Active, summary.StartTimeMs, state.ScheduledJobMap,
			summary.ScheduledJobSummary, tr, value, "JobScheduler", csv)

	// TODO:
	case "Epk": // pkg: installed
	case "Esm": // motion: significant motion
	case "Eac": // active : device active
	case "Eur": // User
	case "Euf": // UserFg
	case "Wsp": // WiFi Supplicant
	case "Wss": // WiFi Signal Strength

	// Not yet implemented in the framework
	case "b": // bluetooth
		return state, summary, errors.New("sample: bluetooth line = " + tr + key + value)

	default:
		fmt.Printf("/ %s / %s / %s /\n", tr, key, value)
		return state, summary, errors.New("unknown key " + key)
	}
	return state, summary, nil
}

func printDebugEvent(b io.Writer, event, line string, state *DeviceState, summary *ActivitySummary) {
	fmt.Fprintln(b, "Processed", event, "in "+line,
		" state.CurrentTime =", time.Unix(0, state.CurrentTime*int64(time.Millisecond)),
		" summary.StartTime=", time.Unix(0, summary.StartTimeMs*int64(time.Millisecond)),
		" summary.EndTime=", time.Unix(0, summary.EndTimeMs*int64(time.Millisecond)))
}

// SubexpNames returns a mapping of the sub-expression names to values if the Regexp
// successfully matches the string, otherwise, it returns false.
func SubexpNames(r *regexp.Regexp, s string) (bool, map[string]string) {
	if matches := r.FindStringSubmatch(strings.TrimSpace(s)); matches != nil {
		names := r.SubexpNames()
		result := make(map[string]string)
		for i, match := range matches {
			result[names[i]] = match
		}
		return true, result
	}
	return false, nil
}

func analyzeData(b io.Writer, csv *csv.State, state *DeviceState, summary *ActivitySummary, summaries *[]ActivitySummary,
	idxMap map[string]ServiceUID, line string) (*DeviceState, *ActivitySummary, error) {

	/*
					   8,h,60012:START
		                           8,h,0:RESET:TIME:1400165448955
					   8,h,0:TIME:1398116676025
				           8,h,15954,+r,+w=37,+Wl,+Ws,Wr=28
	*/
	// Check for history resets
	if matches, result := SubexpNames(ResetRE, line); matches {
		ts, exists := result["timeStamp"]
		if !exists {
			return state, summary, errors.New("Count not extract TIME in line:" + line)
		}
		parsedInt64, err := strconv.ParseInt(ts, 10, 64)
		if err != nil {
			return state, summary, errors.New("int parsing error for TIME in line:" + line)
		}
		// Reset state and summary and start from scratch, History string pool
		// is still valid as we just read it
		if summary.StartTimeMs > 0 {
			state, summary = summarizeActiveState(state, summary, summaries, true, "RESET", csv)
		}
		summary.StartTimeMs = parsedInt64
		summary.EndTimeMs = parsedInt64
		// state is reinitialized by summary.SummarizeAndResetState() so
		// this should never come before summaryPtr resetting.
		state.CurrentTime = parsedInt64
		return state, summary, nil
	}

	if matches, result := SubexpNames(ShutdownRE, line); matches {
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
		state, summary = summarizeActiveState(state, summary, summaries, true, "START", csv)
		return state, summary, nil
	}

	// Check for history start time
	if matches, result := SubexpNames(TimeRE, line); matches {
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

	success := true
	var errorBuffer bytes.Buffer

	if len(parts) >= 4 {
		partArr := sanitizeInput(parts[3:])
		for _, part := range partArr {
			if matches, result := SubexpNames(DataRE, part); matches {
				var err error
				state, summary, err = updateState(b, csv, state, summary, summaries, idxMap, timeDelta,
					result["transition"], result["key"], result["value"])
				if err != nil {

					success = false
					errorBuffer.WriteString("** Error in " + line + " in  " + part + " : " + err.Error() + ". ")
				}
			}
		}
		if success {
			return state, summary, nil
		}
		return state, summary, errors.New(errorBuffer.String())
	} else if len(parts) == 3 {
		return state, summary, nil
	}
	return state, summary, errors.New("Unknown format: " + line)
}

// sanitizeInput converts comma separated parts array of a string with the batteryHistory bug
// of no separator before w=, to an array with correct number of parts from:
// +r,+w=27,Wr=28,+Esy=29,Pss=0w=105w=10,-Esy=30 =>
//         +r,+w=27,Wr=28,+Esy=29,Pss=0,w=105,w=10,-Esy=30
func sanitizeInput(inputs []string) []string {
	var outputs []string
	for _, part := range inputs {
		// Sanitize string
		if strings.Count(part, "=") > 1 {
			if strings.Contains(part, "w=") {
				part = strings.Replace(part, "w=", ",w=", -1)
				outputs = append(outputs, strings.Split(part, ",")...)
				continue
			}
		} else if strings.Contains(part, "Wsw=") {
			part = strings.Replace(part, "Wsw=", "Ws,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else if strings.Contains(part, "Ww=") {
			part = strings.Replace(part, "Ww=", "W,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else if strings.Contains(part, "Wlw=") {
			part = strings.Replace(part, "Wlw=", "Wl,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else if strings.Contains(part, "Wmw=") {
			part = strings.Replace(part, "Wmw=", "Wm,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else if strings.Contains(part, "sw=") {
			part = strings.Replace(part, "sw=", "s,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else if strings.Contains(part, "Sw=") {
			part = strings.Replace(part, "Sw=", "S,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else if strings.Contains(part, "rw=") {
			part = strings.Replace(part, "rw=", "r,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else if strings.Contains(part, "Prw=") {
			part = strings.Replace(part, "Prw=", "Pr,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else if strings.Contains(part, "Pclw=") {
			part = strings.Replace(part, "Pclw=", "Pcl,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else if strings.Contains(part, "BPw=") {
			part = strings.Replace(part, "BPw=", "BP,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else if strings.Contains(part, "gw=") {
			part = strings.Replace(part, "gw=", "g,w=", -1)
			outputs = append(outputs, strings.Split(part, ",")...)
			continue
		} else {
			outputs = append(outputs, part)
		}
	}
	return outputs
}

// ScrubPII scrubs any part of the string that looks like an email address (@<blah>.com)
// From:
//     com.google.android.apps.plus.content.EsProvider/com.google/john.doe@gmail.com/extra
// To:
//     com.google.android.apps.plus.content.EsProvider/com.google/XXX@gmail.com/extra
func ScrubPII(input string) string {
	output := ""
	matches := PIIRE.FindStringSubmatch(input)
	if matches == nil {
		return input
	}

	names := PIIRE.SubexpNames()
	for i, match := range matches {
		if names[i] == "account" {
			output += "XXX"
		} else if i != 0 {
			output += match
		}
	}
	return output
}

// analyzeHistoryLine takes a battery history event string and updates the device state.
func analyzeHistoryLine(b io.Writer, csvState *csv.State, state *DeviceState, summary *ActivitySummary,
	summaries *[]ActivitySummary, idxMap map[string]ServiceUID, line string, scrubPII bool) (*DeviceState, *ActivitySummary, error) {

	if match, result := SubexpNames(GenericHistoryStringPoolLineRE, line); match {
		index := result["index"]
		service := result["service"]
		if scrubPII {
			service = ScrubPII(service)
		}
		idxMap[index] = ServiceUID{
			Service: service,
			UID:     result["uid"],
		}
		return state, summary, nil
	} else if GenericHistoryLineRE.MatchString(line) {
		return analyzeData(b, csvState, state, summary, summaries, idxMap, line)
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
	Summaries         []ActivitySummary
	TimestampsAltered bool
	OutputBuffer      bytes.Buffer
	IdxMap            map[string]ServiceUID
	Errs              []error
}

// AnalyzeHistory takes as input a complete history log and desired summary format.
// It then analyzes the log line by line (delimited by newline characters).
// No summaries (before an OVERFLOW line) are excluded/filtered out.
func AnalyzeHistory(history, format string, csvWriter io.Writer, scrubPII bool) *AnalysisReport {
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

	if format != FormatTotalTime {
		csvWriter = ioutil.Discard
	}
	csvState := csv.NewState(csvWriter)
	var b bytes.Buffer

	for _, line := range h {
		if OverflowRE.MatchString(line) {
			// Stop summary as soon as you OVERFLOW
			break
		}
		deviceState, summary, err = analyzeHistoryLine(&b, csvState, deviceState, summary, &summaries, idxMap, line, scrubPII)
		if err != nil && len(line) > 0 {
			errs = append(errs, err)
		}
	}
	csvState.PrintAllReset(deviceState.CurrentTime)
	csvState.PrintRebootEvent(deviceState.CurrentTime)
	if summary.Active {
		deviceState, summary = summarizeActiveState(deviceState, summary, &summaries, true, "END", csvState)
	}

	return &AnalysisReport{
		Summaries:         summaries,
		TimestampsAltered: c,
		OutputBuffer:      b,
		IdxMap:            idxMap,
		Errs:              errs,
	}
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
			if StartRE.MatchString(line) || ShutdownRE.MatchString(line) || OverflowRE.MatchString(line) {
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
			if match, result := SubexpNames(GenericHistoryLineRE, line); match {
				d, err := strconv.ParseInt(result["timeDelta"], 10, 64)
				if err != nil {
					return nil, changed, err
				}
				time -= d
			}
		} else {
			if timeFound, result = SubexpNames(TimeRE, line); !timeFound {
				timeFound, result = SubexpNames(ResetRE, line)
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

// UIDToPackageNameMapping builds a mapping of UIDs to package names.
// For shared UIDs, package names will be combined and delineated by ';'
func UIDToPackageNameMapping(checkin string) (map[int32]string, []error) {
	m := make(map[int32]string)
	var errs []error

	for _, l := range strings.Split(checkin, "\n") {
		if match, result := SubexpNames(CheckinApkLineRE, l); match {
			u, err := strconv.ParseInt(result["uid"], 10, 32)
			if err != nil {
				errs = append(errs, fmt.Errorf("invalid UID in checkin 'apk' line: %q", err))
				continue
			}
			uid := int32(u)
			apk := result["pkgName"]
			if n, ok := m[uid]; ok {
				m[uid] = fmt.Sprintf("%s;%s", n, apk)
			} else {
				m[uid] = apk
			}
		}
	}

	return m, errs
}
