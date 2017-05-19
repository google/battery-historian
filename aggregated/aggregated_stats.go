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

// Package aggregated constructs a checkin struct from a given batterystats proto. The checkin struct contains data categorized by each metric.
package aggregated

import (
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/golang/protobuf/proto"
	"github.com/google/battery-historian/bugreportutils"
	"github.com/google/battery-historian/checkinparse"
	"github.com/google/battery-historian/historianutils"
	bspb "github.com/google/battery-historian/pb/batterystats_proto"
)

const (
	// msecsInMinute is the converter from msec to minute
	msecsInMinute = 60000
)

// PkgAndSub splits up a string into the separate pkg name and metric sub name.
// If the two values are present in the string, then they must be delineated by a colon.
func PkgAndSub(t string) (string, string) {
	s := strings.SplitN(t, ":", 2)
	pkg := strings.TrimSpace(s[0])
	sub := ""
	if len(s) > 1 {
		sub = strings.TrimSpace(s[1])
	}
	return pkg, sub
}

// MDuration holds the duration and the classification level for the value.
type MDuration struct {
	V time.Duration
	L string // Low, Medium, High
}

// MFloat32 holds the float value and the classification level for the value.
type MFloat32 struct {
	V float32
	L string // Low, Medium, High
}

// ActivityData contains count and duration stats about activity on the device.
// The UID field will be pouplated (non-zero) if the activity is connected to a specific UID.
type ActivityData struct {
	Name         string
	Title        string
	UID          int32
	Count        float32
	CountPerHour float32
	CountLevel   string // Low, Medium, High
	// MaxDuration is the single longest duration of this ActivityData. This could sometimes be
	// greater than Duration (eg. in the case of a wakelock whose time was split with another
	// wakelock -- 2 wakelocks held for an hour each -> Duration would be 30 minutes for each,
	// but MaxDuration would be one hour).
	MaxDuration time.Duration
	Duration    time.Duration
	// TotalDuration is used to track the total duration of metrics. This may be different from
	// Duration for metrics such as wakelocks, which will have Duration set to the apportioned
	// duration.
	TotalDuration time.Duration
	// SecondsPerHr based on TotalDuration, if available, otherwise, based on Duration.
	SecondsPerHr  float32
	DurationLevel string // Low, Medium, High
	Level         string // The maximum of CountLevel and DurationLevel.
}

// activityData converts a WakelockInfo into an ActivityData.
func activityData(wi *checkinparse.WakelockInfo, realtime time.Duration) ActivityData {
	ad := ActivityData{
		Name:          wi.Name,
		UID:           wi.UID,
		Count:         wi.Count,
		Duration:      wi.Duration,
		MaxDuration:   wi.MaxDuration,
		TotalDuration: wi.TotalDuration,
	}
	if realtime > 0 {
		ad.CountPerHour = wi.Count / float32(realtime.Hours())
		d := wi.Duration
		if wi.TotalDuration > 0 {
			d = wi.TotalDuration
		}
		ad.SecondsPerHr = float32(d.Seconds()) / float32(realtime.Hours())
	}
	return ad
}

// ANRCrashData contains ANR and crash data for a single app.
type ANRCrashData struct {
	Name                 string
	UID                  int32
	ANRCount, CrashCount int32
}

// byCrashThenANR sorts ANRCrashData by the number of crashes, then by number of ANR, both in descending order.
type byCrashThenANR []*ANRCrashData

func (d byCrashThenANR) Len() int      { return len(d) }
func (d byCrashThenANR) Swap(i, j int) { d[i], d[j] = d[j], d[i] }
func (d byCrashThenANR) Less(i, j int) bool {
	if d[i].CrashCount == d[j].CrashCount {
		return d[i].ANRCount > d[j].ANRCount
	}
	return d[i].CrashCount > d[j].CrashCount
}

// CPUData contains data about app CPU usage.
type CPUData struct {
	Name       string // App name.
	UID        int32
	UserTime   time.Duration
	SystemTime time.Duration
	PowerPct   float32 // Percentage of device power used.

	UserTimeLevel   string // Low, Medium, High
	SystemTimeLevel string // Low, Medium, High
	Level           string // The maximum of UserTimeLevel and SystemTimeLevel.
}

// CPUSecs returns the total CPU duration in seconds.
func (a CPUData) CPUSecs() float64 {
	return a.UserTime.Seconds() + a.SystemTime.Seconds()
}

// ByCPUUsage sorts CPUData by the power usage in descending order. In case of similar
// power usage, sort according to cpu time.
type ByCPUUsage []CPUData

func (a ByCPUUsage) Len() int      { return len(a) }
func (a ByCPUUsage) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a ByCPUUsage) Less(i, j int) bool {
	if historianutils.AbsFloat32(a[j].PowerPct-a[i].PowerPct) < 0.01 {
		// Sort by time if power drain is equal.
		return a[j].CPUSecs() < a[i].CPUSecs()
	}
	return a[j].PowerPct < a[i].PowerPct
}

// RateData contains total count and rate for various app metrics.
type RateData struct {
	Name       string
	UID        int32
	Count      float32
	CountPerHr float32
	CountLevel string // Low, Medium, High
}

// byCount sorts RateData by the total count in descending order.
type byCount []*RateData

func (a byCount) Len() int           { return len(a) }
func (a byCount) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }
func (a byCount) Less(i, j int) bool { return a[j].Count < a[i].Count }

// PowerUseData contains percentage battery consumption for apps and system elements.
type PowerUseData struct {
	Name    string
	UID     int32
	Percent float32 // Percentage of total consumption
}

// byPercent sorts applications by percentage battery used.
type byPercent []*PowerUseData

func (a byPercent) Len() int      { return len(a) }
func (a byPercent) Swap(i, j int) { a[i], a[j] = a[j], a[i] }

// Less sorts by decreasing time order then increasing alphabetic order to break the tie.
// OVERCOUNTED and UNACCOUNTED are always sorted to the beginning.
func (a byPercent) Less(i, j int) bool {
	if a[i].Name == bspb.BatteryStats_System_PowerUseItem_OVERCOUNTED.String() || a[i].Name == bspb.BatteryStats_System_PowerUseItem_UNACCOUNTED.String() {
		return true
	}
	if a[j].Name == bspb.BatteryStats_System_PowerUseItem_OVERCOUNTED.String() || a[j].Name == bspb.BatteryStats_System_PowerUseItem_UNACCOUNTED.String() {
		return false
	}

	if x, y := a[i].Percent, a[j].Percent; x != y {
		return x > y
	}
	return a[i].Name < a[j].Name
}

// NetworkTrafficData contains the total amount of bytes transferred over mobile and wifi.
type NetworkTrafficData struct {
	Name                   string
	UID                    int32
	WifiMegaBytes          float32
	MobileMegaBytes        float32
	WifiMegaBytesPerHour   float32
	MobileMegaBytesPerHour float32
	WifiLevel              string // Low, medium, high
	MobileLevel            string // Low, medium, high
	Level                  string // The maximum of WifiLevel and MobileLevel.
}

// ByMobileBytes sorts NetworkTrafficData by the amount of bytes transferred over mobile.
type ByMobileBytes []NetworkTrafficData

func (n ByMobileBytes) Len() int      { return len(n) }
func (n ByMobileBytes) Swap(i, j int) { n[i], n[j] = n[j], n[i] }

// Less sorts in decreasing order.
func (n ByMobileBytes) Less(i, j int) bool {
	return n[i].MobileMegaBytes > n[j].MobileMegaBytes
}

// ByWifiBytes sorts NetworkTrafficData by the amount of bytes transferred over mobile.
type ByWifiBytes []NetworkTrafficData

func (n ByWifiBytes) Len() int      { return len(n) }
func (n ByWifiBytes) Swap(i, j int) { n[i], n[j] = n[j], n[i] }

// Less sorts in decreasing order.
func (n ByWifiBytes) Less(i, j int) bool {
	return n[i].WifiMegaBytes > n[j].WifiMegaBytes
}

func min(x, y int) int {
	if x < y {
		return x
	}
	return y
}

// AppData contains aggregated values for some app metrics.
type AppData struct {
	Name             string
	UID              int32
	Alarms           RateData
	CPU              CPUData
	GPSUse           ActivityData
	ScheduledJobs    ActivityData
	Network          NetworkTrafficData
	PartialWakelocks ActivityData
	Syncs            ActivityData
	WifiScan         ActivityData
}

// stateData contains information about the different state levels an app can be in.
type stateData struct {
	Name              string
	UID               int32
	Background        MDuration
	Cached            MDuration
	Foreground        MDuration
	ForegroundService MDuration
	Top               MDuration
	TopSleeping       MDuration
}

// byState sorts stateData in descending order of state duration, in order of state precedence
// (ie. top > foreground service > top sleeping > foreground > background > cached).
type byState []stateData

func (s byState) Len() int      { return len(s) }
func (s byState) Swap(i, j int) { s[i], s[j] = s[j], s[i] }
func (s byState) Less(i, j int) bool {
	sI, sJ := s[i], s[j]
	if sI.Top.V != sJ.Top.V {
		return sI.Top.V > sJ.Top.V
	}
	if sI.ForegroundService.V != sJ.ForegroundService.V {
		return sI.ForegroundService.V > sJ.ForegroundService.V
	}
	if sI.TopSleeping.V != sJ.TopSleeping.V {
		return sI.TopSleeping.V > sJ.TopSleeping.V
	}
	if sI.Foreground.V != sJ.Foreground.V {
		return sI.Foreground.V > sJ.Foreground.V
	}
	if sI.Background.V != sJ.Background.V {
		return sI.Background.V > sJ.Background.V
	}
	return sI.Cached.V > sJ.Cached.V
}

// Checkin contains the aggregated batterystats data for a bugreport.
type Checkin struct {
	Device           string
	Build            string
	BuildFingerprint string
	ReportVersion    int32

	ScreenOffDischargePoints float32
	ScreenOnDischargePoints  float32
	ActualDischarge          float32 // mAh
	EstimatedDischarge       float32 // mAh
	WifiDischargePoints      float32
	BluetoothDischargePoints float32
	ModemDischargePoints     float32

	Realtime          time.Duration
	ScreenOffRealtime time.Duration

	Uptime                          MDuration
	ScreenOffUptime                 MDuration
	ScreenOffUptimePercentage       float32
	ScreenOnTime                    MDuration
	ScreenOnTimePercentage          float32
	PartialWakelockTime             MDuration
	PartialWakelockTimePercentage   float32
	KernelOverheadTime              MDuration
	KernelOverheadTimePercentage    float32
	SignalScanningTime              MDuration
	SignalScanningTimePercentage    float32
	MobileActiveTime                MDuration
	MobileActiveTimePercentage      float32
	WifiOnTime                      MDuration
	WifiOnTimePercentage            float32
	WifiIdleTime                    MDuration
	WifiTransferTime                MDuration // tx + rx
	WifiTransferTimePercentage      float32
	BluetoothIdleTime               MDuration
	BluetoothTransferTime           MDuration // tx + rx
	BluetoothTransferTimePercentage float32
	ModemIdleTime                   MDuration
	ModemTransferTime               MDuration // tx + rx
	ModemTransferTimePercentage     float32

	PhoneCallTime                       MDuration
	PhoneCallTimePercentage             float32
	DeviceIdlingTime                    MDuration
	DeviceIdlingTimePercentage          float32
	FullWakelockTime                    MDuration
	FullWakelockTimePercentage          float32
	InteractiveTime                     MDuration
	InteractiveTimePercentage           float32
	DeviceIdleModeEnabledTime           MDuration
	DeviceIdleModeEnabledTimePercentage float32

	ScreenOffDischargeRatePerHr MFloat32
	ScreenOnDischargeRatePerHr  MFloat32
	MobileKiloBytesPerHr        MFloat32
	WifiKiloBytesPerHr          MFloat32
	WifiDischargeRatePerHr      MFloat32
	BluetoothDischargeRatePerHr MFloat32
	ModemDischargeRatePerHr     MFloat32

	// Aggregated across all apps/entries.
	AggCameraUse            ActivityData
	AggFlashlightUse        ActivityData
	AggGPSUse               ActivityData
	AggKernelWakelocks      ActivityData
	AggScheduledJobs        ActivityData
	AggSyncTasks            ActivityData
	AggWakeupReasons        ActivityData
	AggWifiScanActivity     ActivityData
	AggWifiFullLockActivity ActivityData
	AggAppWakeups           RateData
	AggCPUUsage             CPUData

	// Each element corresponds to a single entry/app.
	UserspaceWakelocks   []ActivityData
	KernelWakelocks      []ActivityData
	ScheduledJobs        []ActivityData
	SyncTasks            []ActivityData
	WakeupReasons        []ActivityData
	GPSUse               []ActivityData
	TopMobileActiveApps  []ActivityData
	WifiScanActivity     []ActivityData
	WifiFullLockActivity []ActivityData
	CameraUse            []ActivityData
	FlashlightUse        []ActivityData

	TopMobileTrafficApps []NetworkTrafficData
	TopWifiTrafficApps   []NetworkTrafficData

	DevicePowerEstimates []PowerUseData

	AppWakeups            []RateData
	AppWakeupsByAlarmName []RateData

	ANRAndCrash []ANRCrashData

	CPUUsage []CPUData

	AppStates []stateData

	AggregatedApps []AppData

	TotalAppGPSUseTimePerHour         float32
	TotalAppCPUPowerPct               float32
	BluetoothOnTime                   MDuration
	BluetoothOnTimePercentage         float32
	LowPowerModeEnabledTime           MDuration
	LowPowerModeEnabledTimePercentage float32
	TotalAppANRCount                  int32
	TotalAppANRRate                   float32
	TotalAppCrashCount                int32
	TotalAppCrashRate                 float32
	TotalAppScheduledJobsPerHr        float32
	TotalAppSyncsPerHr                float32
	TotalAppWakeupsPerHr              float32
	TotalAppFlashlightUsePerHr        float32
	TotalAppCameraUsePerHr            float32
	ConnectivityChanges               float32

	ScreenBrightness   map[string]float32
	SignalStrength     map[string]float32
	WifiSignalStrength map[string]float32
	BluetoothState     map[string]float32
	DataConnection     map[string]float32
}

// sumWakelockInfo sums the Count and Duration fields of the given WakelockInfos.
// CountPerHour and SecondsPerHour will be filled in if r is not 0.
func sumWakelockInfo(d []*checkinparse.WakelockInfo, r time.Duration) ActivityData {
	wd := ActivityData{}
	for _, w := range d {
		wd.Count += w.Count
		wd.Duration += w.Duration
	}
	if r != 0 {
		wd.CountPerHour = wd.Count / float32(r.Hours())
		wd.SecondsPerHr = float32(wd.Duration.Seconds()) / float32(r.Hours())
	}
	return wd
}

// ParseCheckinData creates a Checkin struct from the given aggregated battery stats.
func ParseCheckinData(c *bspb.BatteryStats) Checkin {
	if c == nil {
		return Checkin{}
	}

	realtime := time.Duration(c.System.Battery.GetBatteryRealtimeMsec()) * time.Millisecond
	if realtime < 0 {
		log.Printf("realtime was negative: %v\n", realtime)
	}

	out := Checkin{
		Device:           c.Build.GetDevice(),
		Build:            c.Build.GetBuildId(),
		BuildFingerprint: c.Build.GetFingerprint(),
		ReportVersion:    c.GetReportVersion(),

		Realtime:          realtime,
		ScreenOffRealtime: time.Duration(c.System.Battery.GetScreenOffRealtimeMsec()) * time.Millisecond,

		ScreenOffDischargePoints: c.System.BatteryDischarge.GetScreenOff(),
		ScreenOnDischargePoints:  c.System.BatteryDischarge.GetScreenOn(),

		EstimatedDischarge: c.System.PowerUseSummary.GetComputedPowerMah(),
		ActualDischarge:    (c.System.PowerUseSummary.GetMinDrainedPowerMah() + c.System.PowerUseSummary.GetMaxDrainedPowerMah()) / 2,

		// Uptime is the same as screen-off uptime + screen on time
		Uptime: MDuration{
			V: (time.Duration(c.System.Battery.GetBatteryUptimeMsec()) * time.Millisecond),
		},

		ScreenOffUptime: MDuration{
			V: (time.Duration(c.System.Battery.GetScreenOffUptimeMsec()) * time.Millisecond),
		},

		ScreenOnTime: MDuration{
			V: (time.Duration(c.System.Misc.GetScreenOnTimeMsec()) * time.Millisecond),
		},

		PartialWakelockTime: MDuration{
			V: (time.Duration(c.System.Misc.GetPartialWakelockTimeMsec()) * time.Millisecond),
		},

		KernelOverheadTime: MDuration{
			V: (time.Duration(c.System.Battery.GetScreenOffUptimeMsec()-c.System.Misc.GetPartialWakelockTimeMsec()) * time.Millisecond),
		},

		SignalScanningTime: MDuration{
			V: (time.Duration(c.System.SignalScanningTime.GetTimeMsec()) * time.Millisecond),
		},

		MobileActiveTime: MDuration{
			V: (time.Duration(c.System.Misc.GetMobileActiveTimeMsec()) * time.Millisecond),
		},

		PhoneCallTime: MDuration{
			V: (time.Duration(c.System.Misc.GetPhoneOnTimeMsec()) * time.Millisecond),
		},

		WifiOnTime: MDuration{
			V: (time.Duration(c.System.Misc.GetWifiOnTimeMsec()) * time.Millisecond),
		},

		DeviceIdleModeEnabledTime: MDuration{
			V: (time.Duration(c.System.Misc.GetDeviceIdleModeEnabledTimeMsec()) * time.Millisecond),
		},

		DeviceIdlingTime: MDuration{
			V: (time.Duration(c.System.Misc.GetDeviceIdlingTimeMsec()) * time.Millisecond),
		},

		FullWakelockTime: MDuration{
			V: (time.Duration(c.System.Misc.GetFullWakelockTimeMsec()) * time.Millisecond),
		},

		InteractiveTime: MDuration{
			V: (time.Duration(c.System.Misc.GetInteractiveTimeMsec()) * time.Millisecond),
		},

		BluetoothOnTime: MDuration{
			V: (time.Duration(c.System.Misc.GetBluetoothOnTimeMsec()) * time.Millisecond),
		},

		LowPowerModeEnabledTime: MDuration{
			V: (time.Duration(c.System.Misc.GetLowPowerModeEnabledTimeMsec()) * time.Millisecond),
		},
		ConnectivityChanges: c.System.Misc.GetConnectivityChanges(),
	}
	if realtime > 0 {
		out.ScreenOffUptimePercentage = (float32(out.ScreenOffUptime.V) / float32(realtime)) * 100
		out.ScreenOnTimePercentage = (float32(out.ScreenOnTime.V) / float32(realtime)) * 100
		out.PartialWakelockTimePercentage = (float32(out.PartialWakelockTime.V) / float32(realtime)) * 100
		out.KernelOverheadTimePercentage = (float32(out.KernelOverheadTime.V) / float32(realtime)) * 100
		out.SignalScanningTimePercentage = (float32(out.SignalScanningTime.V) / float32(realtime)) * 100
		out.MobileActiveTimePercentage = (float32(out.MobileActiveTime.V) / float32(realtime)) * 100
		out.FullWakelockTimePercentage = (float32(out.FullWakelockTime.V) / float32(realtime)) * 100
		out.PhoneCallTimePercentage = (float32(out.PhoneCallTime.V) / float32(realtime)) * 100
		out.DeviceIdleModeEnabledTimePercentage = (float32(out.DeviceIdleModeEnabledTime.V) / float32(realtime)) * 100
		out.DeviceIdlingTimePercentage = (float32(out.DeviceIdlingTime.V) / float32(realtime)) * 100
		out.InteractiveTimePercentage = (float32(out.InteractiveTime.V) / float32(realtime)) * 100

		out.BluetoothOnTimePercentage = (float32(out.BluetoothOnTime.V) / float32(realtime)) * 100
		out.LowPowerModeEnabledTimePercentage = (float32(out.LowPowerModeEnabledTime.V) / float32(realtime)) * 100

		out.MobileKiloBytesPerHr = MFloat32{V: (c.System.GlobalNetwork.GetMobileBytesRx() + c.System.GlobalNetwork.GetMobileBytesTx()) / (1024 * float32(realtime.Hours()))}
		out.WifiKiloBytesPerHr = MFloat32{V: (c.System.GlobalNetwork.GetWifiBytesRx() + c.System.GlobalNetwork.GetWifiBytesTx()) / (1024 * float32(realtime.Hours()))}
	}

	bCapMah := c.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah()
	if bCapMah < 0 {
		log.Printf("battery capacity mAh was negative: %v\n", bCapMah)
	}
	if c.GetReportVersion() >= 14 {
		out.WifiOnTime = MDuration{V: time.Duration(c.System.GlobalWifi.GetWifiOnTimeMsec()) * time.Millisecond}
		out.WifiIdleTime = MDuration{V: time.Duration(c.System.GlobalWifi.GetWifiIdleTimeMsec()) * time.Millisecond}
		out.WifiTransferTime = MDuration{V: time.Duration(c.System.GlobalWifi.GetWifiRxTimeMsec()+c.System.GlobalWifi.GetWifiTxTimeMsec()) * time.Millisecond}
		if realtime > 0 {
			out.WifiOnTimePercentage = (float32(out.WifiOnTime.V) / float32(realtime)) * 100
			out.WifiTransferTimePercentage = (float32(out.WifiTransferTime.V) / float32(realtime)) * 100
		}
		if bCapMah > 0 {
			out.WifiDischargePoints = 100 * c.System.GlobalWifi.GetWifiPowerMah() / bCapMah
			if realtime > 0 {
				out.WifiDischargeRatePerHr = MFloat32{
					V: out.WifiDischargePoints / float32(realtime.Hours()),
				}
			}
		}

		out.BluetoothIdleTime = MDuration{V: time.Duration(c.System.GlobalBluetooth.GetBluetoothIdleTimeMsec()) * time.Millisecond}
		out.BluetoothTransferTime = MDuration{V: time.Duration(c.System.GlobalBluetooth.GetBluetoothRxTimeMsec()+c.System.GlobalBluetooth.GetBluetoothTxTimeMsec()) * time.Millisecond}
		if realtime > 0 {
			out.BluetoothTransferTimePercentage = (float32(out.BluetoothTransferTime.V) / float32(realtime)) * 100
		}
		if bCapMah > 0 {
			out.BluetoothDischargePoints = 100 * c.System.GlobalBluetooth.GetBluetoothPowerMah() / bCapMah
			if realtime > 0 {
				out.BluetoothDischargeRatePerHr = MFloat32{
					V: out.BluetoothDischargePoints / float32(realtime.Hours()),
				}
			}
		}
	}
	if c.GetReportVersion() >= 17 {
		sumCtrlrTransferTime := func(ctrlr *bspb.BatteryStats_ControllerActivity) time.Duration {
			if ctrlr == nil {
				return 0
			}
			sum := ctrlr.GetRxTimeMsec()
			for _, tx := range ctrlr.Tx {
				sum += tx.GetTimeMsec()
			}
			return time.Duration(sum) * time.Millisecond
		}

		out.BluetoothIdleTime = MDuration{V: time.Duration(c.System.GlobalBluetoothController.GetIdleTimeMsec()) * time.Millisecond}
		out.ModemIdleTime = MDuration{V: time.Duration(c.System.GlobalModemController.GetIdleTimeMsec()) * time.Millisecond}
		out.WifiIdleTime = MDuration{V: time.Duration(c.System.GlobalWifiController.GetIdleTimeMsec()) * time.Millisecond}

		out.BluetoothTransferTime = MDuration{V: sumCtrlrTransferTime(c.System.GlobalBluetoothController)}
		out.ModemTransferTime = MDuration{V: sumCtrlrTransferTime(c.System.GlobalModemController)}
		out.WifiTransferTime = MDuration{V: sumCtrlrTransferTime(c.System.GlobalWifiController)}

		if realtime > 0 {
			out.BluetoothTransferTimePercentage = (float32(out.BluetoothTransferTime.V) / float32(realtime)) * 100
			out.ModemTransferTimePercentage = (float32(out.ModemTransferTime.V) / float32(realtime)) * 100
			out.WifiTransferTimePercentage = (float32(out.WifiTransferTime.V) / float32(realtime)) * 100
		}
		if bCapMah > 0 {
			out.BluetoothDischargePoints = 100 * float32(c.System.GlobalBluetoothController.GetPowerMah()) / bCapMah
			out.ModemDischargePoints = 100 * float32(c.System.GlobalModemController.GetPowerMah()) / bCapMah
			out.WifiDischargePoints = 100 * float32(c.System.GlobalWifiController.GetPowerMah()) / bCapMah
			if realtime > 0 {
				out.BluetoothDischargeRatePerHr = MFloat32{
					V: out.BluetoothDischargePoints / float32(realtime.Hours()),
				}

				out.ModemDischargeRatePerHr = MFloat32{
					V: out.ModemDischargePoints / float32(realtime.Hours()),
				}

				out.WifiDischargeRatePerHr = MFloat32{
					V: out.WifiDischargePoints / float32(realtime.Hours()),
				}
			}
		}
	}

	if s := c.System.Battery.GetScreenOffRealtimeMsec(); s > 0 {
		out.ScreenOffDischargeRatePerHr = MFloat32{V: 60 * 60 * 1000 * c.System.BatteryDischarge.GetScreenOff() / s}
	}
	if s := c.System.Misc.GetScreenOnTimeMsec(); s > 0 {
		out.ScreenOnDischargeRatePerHr = MFloat32{V: 60 * 60 * 1000 * c.System.BatteryDischarge.GetScreenOn() / s}
	}
	if realtime > 0 {
		// Screen Brightness.
		out.ScreenBrightness = make(map[string]float32)
		for _, sb := range c.System.ScreenBrightness {
			out.ScreenBrightness[sb.GetName().String()] += (sb.GetTimeMsec() / msecsInMinute) / float32(realtime.Hours())
		}
		// Signal Strength.
		out.SignalStrength = make(map[string]float32)
		for _, ss := range c.System.SignalStrength {
			out.SignalStrength[ss.GetName().String()] += (ss.GetTimeMsec() / msecsInMinute) / float32(realtime.Hours())
		}
		// Wifi Signal Strength.
		out.WifiSignalStrength = make(map[string]float32)
		for _, ws := range c.System.WifiSignalStrength {
			out.WifiSignalStrength[ws.GetName().String()] += (ws.GetTimeMsec() / msecsInMinute) / float32(realtime.Hours())
		}
		// Bluetooth States.
		out.BluetoothState = make(map[string]float32)
		for _, bs := range c.System.BluetoothState {
			out.BluetoothState[bs.GetName().String()] += (bs.GetTimeMsec() / msecsInMinute) / float32(realtime.Hours())

		}
		// DataConnection
		out.DataConnection = make(map[string]float32)
		for _, dc := range c.System.DataConnection {
			out.DataConnection[dc.GetName().String()] += (dc.GetTimeMsec() / msecsInMinute) / float32(realtime.Hours())
		}
	}
	// Kernel Wakelocks.
	var kwl []*checkinparse.WakelockInfo
	for _, kw := range c.System.KernelWakelock {
		if kw.GetName() != "PowerManagerService.WakeLocks" && kw.GetTimeMsec() >= 0.01 {
			kwl = append(kwl, &checkinparse.WakelockInfo{
				Name:     kw.GetName(),
				Duration: time.Duration(kw.GetTimeMsec()) * time.Millisecond,
				Count:    kw.GetCount(),
			})
		}
	}
	out.AggKernelWakelocks = sumWakelockInfo(kwl, realtime)
	// Sorting Kernel Wakelocks by time.
	checkinparse.SortByTime(kwl)
	for _, kw := range kwl {
		out.KernelWakelocks = append(out.KernelWakelocks, activityData(kw, realtime))
	}

	// Wakeup Reasons.
	var wrl []*checkinparse.WakelockInfo
	for _, wr := range c.System.WakeupReason {
		if wr.GetTimeMsec() >= 0.01 {
			wrl = append(wrl, &checkinparse.WakelockInfo{
				Name:     wr.GetName(),
				Duration: time.Duration(wr.GetTimeMsec()) * time.Millisecond,
				Count:    wr.GetCount(),
			})
		}
	}
	out.AggWakeupReasons = sumWakelockInfo(wrl, realtime)

	// Sorting Wakeup Reasons by count.
	checkinparse.SortByCount(wrl)
	for _, wr := range wrl {
		out.WakeupReasons = append(out.WakeupReasons, activityData(wr, realtime))
	}

	// Power usage per app.
	var e []*PowerUseData
	// Network usage per app.
	var m []*checkinparse.WakelockInfo
	var n []*NetworkTrafficData
	// App wakeup count.
	// wubn is wakeup alarms broken down by name.
	var wu, wubn []*RateData
	// App ANR and crash count.
	var ac []*ANRCrashData
	// CPU use per app.
	var cpu []*CPUData
	// Wifi activity per app.
	var wfScan []*checkinparse.WakelockInfo
	var wfFull []*checkinparse.WakelockInfo
	// Scheduled Jobs (JobScheduler Jobs).
	var sj []*checkinparse.WakelockInfo
	// SyncManager Tasks.
	var stl []*checkinparse.WakelockInfo
	// Userspace Partial Wakelocks and GPS use.
	var pwl []*checkinparse.WakelockInfo
	var gps []*checkinparse.WakelockInfo
	// Camera use per app.
	var ca []*checkinparse.WakelockInfo
	// Flashlight use per app.
	var fla []*checkinparse.WakelockInfo
	au := make(map[string]int32)
	for _, app := range c.App {
		if app.GetName() == "" {
			app.Name = proto.String(fmt.Sprintf("UNKNOWN_%d", app.GetUid()))
		}
		au[app.GetName()] = app.GetUid()
		this := AppData{
			Name: app.GetName(),
			UID:  app.GetUid(),
		}

		if pct := 100 * app.PowerUseItem.GetComputedPowerMah() / bCapMah; pct >= 0.01 {
			e = append(e, &PowerUseData{
				Name:    app.GetName(),
				UID:     app.GetUid(),
				Percent: pct,
			})
		}
		if mat, mac := app.Network.GetMobileActiveTimeMsec(), app.Network.GetMobileActiveCount(); mat >= 0.01 || mac > 0 {
			m = append(m, &checkinparse.WakelockInfo{
				Name:     app.GetName(),
				UID:      app.GetUid(),
				Duration: time.Duration(mat) * time.Millisecond,
				Count:    mac,
			})
		}
		wr := app.Network.GetWifiBytesRx()
		wt := app.Network.GetWifiBytesTx()
		mt := app.Network.GetMobileBytesTx()
		mr := app.Network.GetMobileBytesRx()
		if wr+wt+mt+mr >= 0.01 {
			ntd := NetworkTrafficData{
				Name:            app.GetName(),
				UID:             app.GetUid(),
				WifiMegaBytes:   (wr + wt) / (1024 * 1024),
				MobileMegaBytes: (mr + mt) / (1024 * 1024),
			}
			if realtime > 0 {
				ntd.WifiMegaBytesPerHour = (wr + wt) / (1024 * 1024) / float32(realtime.Hours())
				ntd.MobileMegaBytesPerHour = (mr + mt) / (1024 * 1024) / float32(realtime.Hours())
			}
			n = append(n, &ntd)
			this.Network = ntd
		}
		if w := app.Apk.GetWakeups(); w > 0 {
			rd := RateData{
				Name:  app.GetName(),
				UID:   app.GetUid(),
				Count: w,
			}
			if realtime > 0 {
				rd.CountPerHr = w / float32(realtime.Hours())
			}
			wu = append(wu, &rd)
			this.Alarms = rd
		}
		for _, w := range app.WakeupAlarm {
			if wc := w.GetCount(); wc > 0 {
				rd := RateData{
					Name:  fmt.Sprintf("%s : %s", app.GetName(), w.GetName()),
					UID:   app.GetUid(),
					Count: float32(wc),
				}
				if realtime > 0 {
					rd.CountPerHr = float32(wc) / float32(realtime.Hours())
				}
				wubn = append(wubn, &rd)
			}
		}
		for _, p := range app.Process {
			if an, cr := p.GetAnrs(), p.GetCrashes(); an > 0 || cr > 0 {
				ac = append(ac, &ANRCrashData{
					Name:       fmt.Sprintf("%s : %s", app.GetName(), p.GetName()),
					UID:        app.GetUid(),
					ANRCount:   int32(an),
					CrashCount: int32(cr),
				})
				out.TotalAppANRCount += int32(an)
				out.TotalAppCrashCount += int32(cr)
			}
		}
		if realtime > 0 {
			out.TotalAppANRRate = float32(out.TotalAppANRCount) / float32(realtime.Hours())
			out.TotalAppCrashRate = float32(out.TotalAppCrashCount) / float32(realtime.Hours())
		}

		if ut, st := app.Cpu.GetUserTimeMs(), app.Cpu.GetSystemTimeMs(); ut > 0 || st > 0 {
			cpud := CPUData{
				Name:       app.GetName(),
				UID:        app.GetUid(),
				UserTime:   time.Duration(ut) * time.Millisecond,
				SystemTime: time.Duration(st) * time.Millisecond,
			}
			if bCapMah > 0 {
				cpud.PowerPct = 100 * (app.Cpu.GetPowerMaMs() / (1000 * 60 * 60)) / bCapMah
			}
			cpu = append(cpu, &cpud)
			this.CPU = cpud

			out.AggCPUUsage.UserTime += time.Duration(ut) * time.Millisecond
			out.AggCPUUsage.SystemTime += time.Duration(st) * time.Millisecond
			out.AggCPUUsage.PowerPct += cpud.PowerPct
		}
		if wfl := app.Wifi.GetFullWifiLockTimeMsec(); wfl > 0 {
			wfFull = append(wfFull, &checkinparse.WakelockInfo{
				Name:     app.GetName(),
				UID:      app.GetUid(),
				Duration: time.Duration(wfl) * time.Millisecond,
			})
		}
		wst := app.Wifi.GetScanTimeMsec()
		wsc := app.Wifi.GetScanCount()
		if wst > 0 || wsc > 0 {
			wfScan = append(wfScan, &checkinparse.WakelockInfo{
				Name:     app.GetName(),
				UID:      app.GetUid(),
				Duration: time.Duration(wst) * time.Millisecond,
				Count:    wsc,
			})
			this.WifiScan = ActivityData{
				Name:     app.GetName(),
				UID:      app.GetUid(),
				Count:    wsc,
				Duration: time.Duration(wst) * time.Millisecond,
			}
			if realtime > 0 {
				this.WifiScan.CountPerHour = wsc / float32(realtime.Hours())
				this.WifiScan.SecondsPerHr = float32(time.Duration(wst).Seconds()) / float32(realtime.Hours())
			}
		}

		var sjt []*checkinparse.WakelockInfo
		for _, jst := range app.ScheduledJob {
			sjt = append(sjt, &checkinparse.WakelockInfo{
				Name:     fmt.Sprintf("%s : %s", app.GetName(), jst.GetName()),
				UID:      app.GetUid(),
				Duration: time.Duration(jst.GetTotalTimeMsec()) * time.Millisecond,
				Count:    jst.GetCount(),
			})
		}
		sj = append(sj, sjt...)
		this.ScheduledJobs = sumWakelockInfo(sjt, realtime)
		this.ScheduledJobs.Name = app.GetName()
		this.ScheduledJobs.UID = app.GetUid()

		var stlt []*checkinparse.WakelockInfo
		for _, st := range app.Sync {
			stlt = append(stlt, &checkinparse.WakelockInfo{
				Name:     fmt.Sprintf("%s : %s", app.GetName(), st.GetName()),
				UID:      app.GetUid(),
				Duration: time.Duration(st.GetTotalTimeMsec()) * time.Millisecond,
				Count:    st.GetCount(),
			})
		}
		stl = append(stl, stlt...)
		this.Syncs = sumWakelockInfo(stlt, realtime)
		this.Syncs.Name = app.GetName()
		this.Syncs.UID = app.GetUid()

		var pwlt []*checkinparse.WakelockInfo
		for _, pw := range app.Wakelock {
			w := &checkinparse.WakelockInfo{
				Name:     fmt.Sprintf("%s : %s", app.GetName(), pw.GetName()),
				UID:      app.GetUid(),
				Duration: time.Duration(pw.GetPartialTimeMsec()) * time.Millisecond,
				Count:    pw.GetPartialCount(),
			}
			if c.GetReportVersion() >= 20 {
				// The values are only valid in v20+.
				w.MaxDuration = time.Duration(pw.GetPartialMaxDurationMsec()) * time.Millisecond
				if c.GetReportVersion() >= 21 {
					// The values are only valid in v21+.
					w.TotalDuration = time.Duration(pw.GetPartialTotalDurationMsec()) * time.Millisecond
				}
			}
			pwlt = append(pwlt, w)
		}
		pwl = append(pwl, pwlt...)
		this.PartialWakelocks = sumWakelockInfo(pwlt, realtime)
		this.PartialWakelocks.Name = app.GetName()
		this.PartialWakelocks.UID = app.GetUid()

		var gpst []*checkinparse.WakelockInfo
		for _, s := range app.Sensor {
			if s.GetNumber() == bugreportutils.GPSSensorNumber {
				gpst = append(gpst, &checkinparse.WakelockInfo{
					Name:     app.GetName(),
					UID:      app.GetUid(),
					Duration: time.Duration(s.GetTotalTimeMsec()) * time.Millisecond,
					Count:    s.GetCount(),
				})
				continue
			}
		}
		gps = append(gps, gpst...)
		this.GPSUse = sumWakelockInfo(gpst, realtime)
		this.GPSUse.Name = app.GetName()
		this.GPSUse.UID = app.GetUid()

		if cat, cac := app.Camera.GetTotalTimeMsec(), app.Camera.GetCount(); cat > 0 || cac > 0 {
			ca = append(ca, &checkinparse.WakelockInfo{
				Name:     app.GetName(),
				UID:      app.GetUid(),
				Duration: time.Duration(cat) * time.Millisecond,
				Count:    cac,
			})
		}
		if flt, flc := app.Flashlight.GetTotalTimeMsec(), app.Flashlight.GetCount(); flt > 0 || flc > 0 {
			fla = append(fla, &checkinparse.WakelockInfo{
				Name:     app.GetName(),
				UID:      app.GetUid(),
				Duration: time.Duration(flt) * time.Millisecond,
				Count:    flc,
			})
		}

		if c.GetReportVersion() >= 17 {
			// The data is only valid in v17+.
			bkg := app.GetStateTime().GetBackgroundTimeMsec()
			cch := app.GetStateTime().GetCachedTimeMsec()
			fre := app.GetStateTime().GetForegroundTimeMsec()
			frs := app.GetStateTime().GetForegroundServiceTimeMsec()
			top := app.GetStateTime().GetTopTimeMsec()
			tps := app.GetStateTime().GetTopSleepingTimeMsec()
			if bkg > 0 || cch > 0 || fre > 0 || frs > 0 || top > 0 || tps > 0 {
				out.AppStates = append(out.AppStates, stateData{
					Name:              app.GetName(),
					UID:               app.GetUid(),
					Background:        MDuration{V: time.Duration(bkg) * time.Millisecond},
					Cached:            MDuration{V: time.Duration(cch) * time.Millisecond},
					Foreground:        MDuration{V: time.Duration(fre) * time.Millisecond},
					ForegroundService: MDuration{V: time.Duration(frs) * time.Millisecond},
					Top:               MDuration{V: time.Duration(top) * time.Millisecond},
					TopSleeping:       MDuration{V: time.Duration(tps) * time.Millisecond},
				})
			}
		}

		out.AggregatedApps = append(out.AggregatedApps, this)
	}
	for _, pwi := range c.System.PowerUseItem {
		if pwi.GetName() == bspb.BatteryStats_System_PowerUseItem_APP {
			// We have the apps split up in the preceding for loop, and the APP entry is just the sum of all of them, so we skip it here.
			continue
		}
		if pct := 100 * pwi.GetComputedPowerMah() / bCapMah; pct >= 0.01 {
			e = append(e, &PowerUseData{
				Name:    pwi.GetName().String(),
				Percent: pct,
			})
		}
	}

	sort.Sort(byPercent(e))
	for _, ent := range e {
		out.DevicePowerEstimates = append(out.DevicePowerEstimates, *ent)
	}

	checkinparse.SortByTime(m)
	for _, mad := range m {
		out.TopMobileActiveApps = append(out.TopMobileActiveApps, activityData(mad, realtime))
	}

	for _, ntd := range n {
		if ntd.MobileMegaBytes >= 0.01 {
			out.TopMobileTrafficApps = append(out.TopMobileTrafficApps, *ntd)
		}
	}
	sort.Sort(ByMobileBytes(out.TopMobileTrafficApps))

	for _, ntd := range n {
		if ntd.WifiMegaBytes >= 0.01 {
			out.TopWifiTrafficApps = append(out.TopWifiTrafficApps, *ntd)
		}
	}
	sort.Sort(ByWifiBytes(out.TopWifiTrafficApps))

	sort.Sort(byCount(wu))
	for _, w := range wu {
		out.AppWakeups = append(out.AppWakeups, *w)
		out.AggAppWakeups.Count += w.Count
	}
	if realtime > 0 {
		out.AggAppWakeups.CountPerHr = out.AggAppWakeups.Count / float32(realtime.Hours())
		out.TotalAppWakeupsPerHr = out.AggAppWakeups.CountPerHr
	}
	sort.Sort(byCount(wubn))
	for _, w := range wubn {
		out.AppWakeupsByAlarmName = append(out.AppWakeupsByAlarmName, *w)
	}

	sort.Sort(byCrashThenANR(ac))
	for _, x := range ac {
		out.ANRAndCrash = append(out.ANRAndCrash, *x)
	}

	for _, cp := range cpu {
		out.CPUUsage = append(out.CPUUsage, *cp)
		out.TotalAppCPUPowerPct += cp.PowerPct
	}
	sort.Sort(ByCPUUsage(out.CPUUsage))

	checkinparse.SortByTime(wfScan)
	for _, w := range wfScan {
		out.WifiScanActivity = append(out.WifiScanActivity, activityData(w, realtime))
	}
	out.AggWifiScanActivity = sumWakelockInfo(wfScan, realtime)

	checkinparse.SortByTime(wfFull)
	for _, w := range wfFull {
		out.WifiFullLockActivity = append(out.WifiFullLockActivity, activityData(w, realtime))
	}
	out.AggWifiFullLockActivity = sumWakelockInfo(wfFull, realtime)

	// Sorting JobScheduler Jobs by time.
	checkinparse.SortByTime(sj)
	for _, jst := range sj {
		out.ScheduledJobs = append(out.ScheduledJobs, activityData(jst, realtime))
		if realtime > 0 {
			out.TotalAppScheduledJobsPerHr += float32(jst.Duration.Seconds()) / float32(realtime.Hours())
		}
	}
	out.AggScheduledJobs = sumWakelockInfo(sj, realtime)

	// Sorting SyncManager Tasks by time.
	checkinparse.SortByTime(stl)
	for _, st := range stl {
		out.SyncTasks = append(out.SyncTasks, activityData(st, realtime))
		if realtime > 0 {
			out.TotalAppSyncsPerHr += float32(st.Duration.Seconds()) / float32(realtime.Hours())
		}
	}
	out.AggSyncTasks = sumWakelockInfo(stl, realtime)

	// Sorting Partial Wakelocks by time.
	checkinparse.SortByTime(pwl)
	for _, pw := range pwl {
		out.UserspaceWakelocks = append(out.UserspaceWakelocks, activityData(pw, realtime))
	}

	// Sort GPS use by time.
	checkinparse.SortByTime(gps)
	for _, g := range gps {
		out.GPSUse = append(out.GPSUse, activityData(g, realtime))
		if realtime > 0 {
			out.TotalAppGPSUseTimePerHour += float32(g.Duration.Seconds()) / float32(realtime.Hours())
		}
	}
	out.AggGPSUse = sumWakelockInfo(gps, realtime)

	// Sort camera use by time.
	checkinparse.SortByTime(ca)
	for _, c := range ca {
		out.CameraUse = append(out.CameraUse, activityData(c, realtime))
		if realtime > 0 {
			out.TotalAppCameraUsePerHr += float32(c.Duration.Seconds()) / float32(realtime.Hours())
		}
	}
	out.AggCameraUse = sumWakelockInfo(ca, realtime)

	// Sort flashlight use by time.
	checkinparse.SortByTime(fla)
	for _, f := range fla {
		out.FlashlightUse = append(out.FlashlightUse, activityData(f, realtime))
	}
	out.AggFlashlightUse = sumWakelockInfo(fla, realtime)

	sort.Sort(byState(out.AppStates))

	return out
}
