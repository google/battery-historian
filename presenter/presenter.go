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

// Package presenter contains the logic to create data structures for
// HTML presentation of Battery Historian analysis.
package presenter

import (
	"bytes"
	"fmt"
	"html/template"
	"sort"
	"strconv"
	"time"

	"github.com/golang/protobuf/proto"

	"github.com/google/battery-historian/checkinparse"
	"github.com/google/battery-historian/parseutils"

	bspb "github.com/google/battery-historian/pb/batterystats_proto"
)

type mDuration struct {
	V time.Duration
	L string // Low, Medium, High
}

type mFloat32 struct {
	V float32
	L string // Low, Medium, High
}

// HTMLData is the main structure passed to the frontend HTML template containing all analysis items.
type HTMLData struct {
	SDKVersion      int
	DeviceModel     string
	HistorianCsv    string
	Historian       template.HTML
	Count           int
	UnplugSummaries []UnplugSummary
	CheckinSummary  checkin
	Error           string
	Warning         string
	Filename        string
	AppStats        []*bspb.BatteryStats_App
}

// WakelockData contains stats about wakelocks.
type WakelockData struct {
	Name     string
	UID      int32
	Count    float32
	Duration time.Duration
	Level    int // Low, Medium, High
}

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
func (a byPercent) Less(i, j int) bool {
	if x, y := a[i].Percent, a[j].Percent; x != y {
		return x > y
	}
	return a[i].Name < a[j].Name
}

// MobileActiveData contains the total amount of time an application actively used the mobile network.
type MobileActiveData struct {
	Name     string
	UID      int32
	Duration time.Duration
}

// byTime sorts MobileActiveData by the time used.
type byTime []*MobileActiveData

func (m byTime) Len() int      { return len(m) }
func (m byTime) Swap(i, j int) { m[i], m[j] = m[j], m[i] }

// Less sorts by decreasing time order then increasing alphabetic order to break the tie.
func (m byTime) Less(i, j int) bool {
	if x, y := m[i].Duration, m[j].Duration; x != y {
		return x > y
	}
	return m[i].Name < m[j].Name
}

// NetworkTrafficData contains the total amount of bytes transferred over mobile and wifi.
type NetworkTrafficData struct {
	Name                           string
	UID                            int32
	WifiMegaBytes, MobileMegaBytes float32
}

// byMobileBytes sorts NetworkTrafficData by the amount of bytes transferred over mobile.
type byMobileBytes []*NetworkTrafficData

func (n byMobileBytes) Len() int      { return len(n) }
func (n byMobileBytes) Swap(i, j int) { n[i], n[j] = n[j], n[i] }

// Less sorts in decreasing order.
func (n byMobileBytes) Less(i, j int) bool {
	return n[i].MobileMegaBytes > n[j].MobileMegaBytes
}

// byWifiBytes sorts NetworkTrafficData by the amount of bytes transferred over mobile.
type byWifiBytes []*NetworkTrafficData

func (n byWifiBytes) Len() int      { return len(n) }
func (n byWifiBytes) Swap(i, j int) { n[i], n[j] = n[j], n[i] }

// Less sorts in decreasing order.
func (n byWifiBytes) Less(i, j int) bool {
	return n[i].WifiMegaBytes > n[j].WifiMegaBytes
}

func min(x, y int) int {
	if x < y {
		return x
	}
	return y
}

// CheckinSummary contains the aggregated batterystats data for a bugreport.
type checkin struct {
	Device           string
	Build            string
	BuildFingerprint string
	ReportVersion    int32

	ScreenOffDischargePoints float32
	ScreenOnDischargePoints  float32
	MiscPercentage           float32
	BatteryCapacity          float32 // mAh
	ActualDischarge          float32 // mAh
	EstimatedDischarge       float32 // mAh
	WifiDischargePoints      float32
	BluetoothDischargePoints float32

	Realtime          time.Duration
	ScreenOffRealtime time.Duration

	Uptime                mDuration
	ScreenOffUptime       mDuration
	ScreenOnTime          mDuration
	PartialWakelockTime   mDuration
	KernelOverheadTime    mDuration
	SignalScanningTime    mDuration
	MobileActiveTime      mDuration
	WifiOnTime            mDuration
	WifiIdleTime          mDuration
	WifiTransmitTime      mDuration // tx + rx
	BluetoothIdleTime     mDuration
	BluetoothTransmitTime mDuration // tx + rx

	ScreenOffDichargeRatePerHr  mFloat32
	ScreenOnDichargeRatePerHr   mFloat32
	MobileKiloBytesPerHr        mFloat32
	WifiKiloBytesPerHr          mFloat32
	WifiDischargeRatePerHr      mFloat32
	BluetoothDischargeRatePerHr mFloat32

	UserspaceWakelocks []WakelockData
	KernelWakelocks    []WakelockData
	SyncTasks          []WakelockData

	TopMobileActiveApps []MobileActiveData

	TopMobileTrafficApps []NetworkTrafficData
	TopWifiTrafficApps   []NetworkTrafficData

	TopBatteryConsumingEntities []PowerUseData
}

// UnplugSummary contains stats processed from battery history during discharge intervals.
type UnplugSummary struct {
	Date             string
	Reason           string
	SummaryStart     string
	SummaryEnd       string
	Duration         string
	LevelDrop        int32
	LevelDropPerHour float64
	SystemStats      []DurationStats
	BreakdownStats   []MultiDurationStats
}

// DurationStats contain stats on the occrurence frequency and activity duration of a metric present in history.
type DurationStats struct {
	Name          string
	NumRate       float64
	DurationRate  float64
	Num           int32
	TotalDuration time.Duration
	MaxDuration   time.Duration
	NumLevel      string
	DurationLevel string
}

// MultiDurationStats contains named DurationStats.
type MultiDurationStats struct {
	Metric string
	Stats  []DurationStats
}

type internalDist struct {
	parseutils.Dist
}

func (d internalDist) print(device, name string, duration time.Duration) DurationStats {
	ds := DurationStats{
		Name:          name,
		NumRate:       float64(d.Num) / duration.Hours(),
		DurationRate:  d.TotalDuration.Seconds() / duration.Hours(),
		Num:           d.Num,
		TotalDuration: d.TotalDuration,
		MaxDuration:   d.MaxDuration,
	}
	return ds
}

func mapPrint(device, name string, m map[string]parseutils.Dist, duration time.Duration) MultiDurationStats {
	var stats []parseutils.MultiDist
	for k, v := range m {
		stats = append(stats, parseutils.MultiDist{Name: k, Stat: v})
	}
	sort.Sort(sort.Reverse(parseutils.SortByTimeAndCount(stats)))

	var ds []DurationStats
	for _, s := range stats {
		if s.Stat.TotalDuration > 0 {
			d := DurationStats{
				Name:          s.Name,
				NumRate:       float64(s.Stat.Num) / duration.Hours(),
				DurationRate:  s.Stat.TotalDuration.Seconds() / duration.Hours(),
				Num:           s.Stat.Num,
				TotalDuration: s.Stat.TotalDuration,
				MaxDuration:   s.Stat.MaxDuration,
			}
			ds = append(ds, d)
		}
	}
	return MultiDurationStats{Metric: name, Stats: ds}
}

func parseCheckinData(c *bspb.BatteryStats) checkin {
	if c == nil {
		return checkin{}
	}

	realtime := time.Duration(c.System.Battery.GetBatteryRealtimeMsec()) * time.Millisecond

	out := checkin{
		Device:           c.Build.GetDevice(),
		Build:            c.Build.GetBuildId(),
		BuildFingerprint: c.Build.GetFingerprint(),
		ReportVersion:    c.GetReportVersion(),

		Realtime:          realtime,
		ScreenOffRealtime: time.Duration(c.System.Battery.GetScreenOffRealtimeMsec()) * time.Millisecond,

		ScreenOffDischargePoints: c.System.BatteryDischarge.GetScreenOff(),
		ScreenOnDischargePoints:  c.System.BatteryDischarge.GetScreenOn(),

		BatteryCapacity:    c.System.PowerUseSummary.GetBatteryCapacityMah(),
		EstimatedDischarge: c.System.PowerUseSummary.GetComputedPowerMah(),
		ActualDischarge:    (c.System.PowerUseSummary.GetMinDrainedPowerMah() + c.System.PowerUseSummary.GetMaxDrainedPowerMah()) / 2,

		// Uptime is the same as screen-off uptime + screen on time
		Uptime: mDuration{
			V: (time.Duration(c.System.Battery.GetBatteryUptimeMsec()) * time.Millisecond),
		},

		ScreenOffUptime: mDuration{
			V: (time.Duration(c.System.Battery.GetScreenOffUptimeMsec()) * time.Millisecond),
		},

		ScreenOnTime: mDuration{
			V: (time.Duration(c.System.Misc.GetScreenOnTimeMsec()) * time.Millisecond),
		},

		PartialWakelockTime: mDuration{
			V: (time.Duration(c.System.Misc.GetPartialWakelockTimeMsec()) * time.Millisecond),
		},

		KernelOverheadTime: mDuration{
			V: (time.Duration(c.System.Battery.GetScreenOffUptimeMsec()-c.System.Misc.GetPartialWakelockTimeMsec()) * time.Millisecond),
		},

		SignalScanningTime: mDuration{
			V: (time.Duration(c.System.SignalScanningTime.GetTimeMsec()) * time.Millisecond),
		},

		MobileActiveTime: mDuration{
			V: (time.Duration(c.System.Misc.GetMobileActiveTimeMsec()) * time.Millisecond),
		},
	}

	out.MiscPercentage = 100 * (out.ActualDischarge - out.EstimatedDischarge) / out.BatteryCapacity

	out.MobileKiloBytesPerHr = mFloat32{V: (c.System.GlobalNetwork.GetMobileBytesRx() + c.System.GlobalNetwork.GetMobileBytesTx()) / (1024 * float32(realtime.Hours()))}
	out.WifiKiloBytesPerHr = mFloat32{V: (c.System.GlobalNetwork.GetWifiBytesRx() + c.System.GlobalNetwork.GetWifiBytesTx()) / (1024 * float32(realtime.Hours()))}

	if c.GetReportVersion() >= 14 {
		out.WifiOnTime = mDuration{V: time.Duration(c.System.GlobalWifi.GetWifiOnTimeMsec()) * time.Millisecond}
		out.WifiIdleTime = mDuration{V: time.Duration(c.System.GlobalWifi.GetWifiIdleTimeMsec()) * time.Millisecond}
		out.WifiTransmitTime = mDuration{V: time.Duration(c.System.GlobalWifi.GetWifiRxTimeMsec()+c.System.GlobalWifi.GetWifiTxTimeMsec()) * time.Millisecond}
		out.WifiDischargePoints = 100 * c.System.GlobalWifi.GetWifiPowerMah() / c.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah()
		out.WifiDischargeRatePerHr = mFloat32{
			V: 100 * c.System.GlobalWifi.GetWifiPowerMah() / c.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah() / float32(realtime.Hours()),
		}

		out.BluetoothIdleTime = mDuration{V: time.Duration(c.System.GlobalBluetooth.GetBluetoothIdleTimeMsec()) * time.Millisecond}
		out.BluetoothTransmitTime = mDuration{V: time.Duration(c.System.GlobalBluetooth.GetBluetoothRxTimeMsec()+c.System.GlobalBluetooth.GetBluetoothTxTimeMsec()) * time.Millisecond}
		out.BluetoothDischargePoints = 100 * c.System.GlobalBluetooth.GetBluetoothPowerMah() / c.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah()
		out.BluetoothDischargeRatePerHr = mFloat32{
			V: 100 * c.System.GlobalBluetooth.GetBluetoothPowerMah() / c.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah() / float32(realtime.Hours()),
		}
	}

	if s := c.System.Battery.GetScreenOffRealtimeMsec(); s > 0 {
		out.ScreenOffDichargeRatePerHr = mFloat32{V: 60 * 60 * 1000 * c.System.BatteryDischarge.GetScreenOff() / s}
	}
	if s := c.System.Misc.GetScreenOnTimeMsec(); s > 0 {
		out.ScreenOnDichargeRatePerHr = mFloat32{V: 60 * 60 * 1000 * c.System.BatteryDischarge.GetScreenOn() / s}
	}

	// Top Partial Wakelocks by time and count
	var pwl []*checkinparse.WakelockInfo
	for _, app := range c.App {
		for _, pw := range app.Wakelock {
			if pw.GetPartialTimeMsec() >= 0.01 {
				pwl = append(pwl, &checkinparse.WakelockInfo{
					Name:     fmt.Sprintf("%s : %s", app.GetName(), pw.GetName()),
					UID:      app.GetUid(),
					Duration: time.Duration(pw.GetPartialTimeMsec()) * time.Millisecond,
					Count:    pw.GetPartialCount(),
				})
			}
		}
	}

	// Top Partial Wakelocks by time
	checkinparse.SortByTime(pwl)
	for _, pw := range pwl {
		out.UserspaceWakelocks = append(out.UserspaceWakelocks, WakelockData{
			Name:     pw.Name,
			UID:      pw.UID,
			Count:    pw.Count,
			Duration: pw.Duration,
		})
	}

	// Top 5 Kernel Wakelocks
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
	// Top Kernel Wakelocks by time
	checkinparse.SortByTime(kwl)
	for _, kw := range kwl {
		out.KernelWakelocks = append(out.KernelWakelocks, WakelockData{
			Name:     kw.Name,
			Count:    kw.Count,
			Duration: kw.Duration,
		})
	}

	// Top SyncTasks by time and count
	var stl []*checkinparse.WakelockInfo
	for _, app := range c.App {
		for _, st := range app.Sync {
			if st.GetTotalTimeMsec() >= 0.01 {
				stl = append(stl, &checkinparse.WakelockInfo{
					Name:     fmt.Sprintf("%s : %s", app.GetName(), st.GetName()),
					UID:      app.GetUid(),
					Duration: time.Duration(st.GetTotalTimeMsec()) * time.Millisecond,
					Count:    st.GetCount(),
				})
			}
		}
	}

	// Top SyncTasks by time
	checkinparse.SortByTime(stl)
	for _, st := range stl {
		out.SyncTasks = append(out.SyncTasks, WakelockData{
			Name:     st.Name,
			UID:      st.UID,
			Count:    st.Count,
			Duration: st.Duration,
		})
	}

	// Top power consumers and network users
	var e []*PowerUseData
	var m []*MobileActiveData
	var n []*NetworkTrafficData
	for _, app := range c.App {
		if mah := app.PowerUseItem.GetComputedPowerMah(); mah >= 0.01 {
			e = append(e, &PowerUseData{
				Name:    app.GetName(),
				UID:     app.GetUid(),
				Percent: 100 * mah / c.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah(),
			})
		}
		if mat := app.Network.GetMobileActiveTimeMsec(); mat >= 0.01 {
			m = append(m, &MobileActiveData{
				Name:     app.GetName(),
				UID:      app.GetUid(),
				Duration: time.Duration(mat) * time.Millisecond,
			})
		}
		wr := app.Network.GetWifiBytesRx()
		wt := app.Network.GetWifiBytesTx()
		mt := app.Network.GetMobileBytesTx()
		mr := app.Network.GetMobileBytesRx()
		if wr+wt+mt+mr >= 0.01 {
			n = append(n, &NetworkTrafficData{
				Name:            app.GetName(),
				UID:             app.GetUid(),
				WifiMegaBytes:   (wr + wt) / (1024 * 1024),
				MobileMegaBytes: (mr + mt) / (1024 * 1024),
			})
		}
	}
	for _, pwi := range c.System.PowerUseItem {
		if pwi.GetName() == bspb.BatteryStats_System_PowerUseItem_APP {
			// We have the apps split up in the preceding for loop, and the APP entry is just the sum of all of them, so we skip it here.
			continue
		}
		if mah := pwi.GetComputedPowerMah(); mah >= 0.01 {
			e = append(e, &PowerUseData{
				Name:    pwi.GetName().String(),
				Percent: 100 * mah / c.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah(),
			})
		}
	}

	sort.Sort(byPercent(e))
	for _, ent := range e {
		out.TopBatteryConsumingEntities = append(out.TopBatteryConsumingEntities, *ent)
	}

	sort.Sort(byTime(m))
	for _, mad := range m {
		out.TopMobileActiveApps = append(out.TopMobileActiveApps, *mad)
	}

	sort.Sort(byMobileBytes(n))
	for _, ntd := range n {
		if ntd.MobileMegaBytes >= 0.01 {
			out.TopMobileTrafficApps = append(out.TopMobileTrafficApps, *ntd)
		}
	}

	sort.Sort(byWifiBytes(n))
	for _, ntd := range n {
		if ntd.WifiMegaBytes >= 0.01 {
			out.TopWifiTrafficApps = append(out.TopWifiTrafficApps, *ntd)
		}
	}

	return out
}

// byName sorts applications by name in ascending order.
type byName []*bspb.BatteryStats_App

func (a byName) Len() int           { return len(a) }
func (a byName) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }
func (a byName) Less(i, j int) bool { return a[i].GetName() < a[j].GetName() }

func parseAppStats(checkin *bspb.BatteryStats) []*bspb.BatteryStats_App {
	var as []*bspb.BatteryStats_App
	unknown := 1

	for _, a := range checkin.GetApp() {
		if a.GetName() == "" {
			a.Name = proto.String("UNKNOWN_" + strconv.Itoa(unknown))
			unknown++
		}
		as = append(as, a)
	}

	// Sort by name so that we can display the apps in alphabetical order in the dropdown.
	sort.Sort(byName(as))
	return as
}

// Data returns a single structure (HTMLData) containing aggregated battery stats in html format.
func Data(sdkVersion int, model, csv, fname string, summaries []parseutils.ActivitySummary, checkinOutput *bspb.BatteryStats, historianOutput string, warnings []string, errs []error) HTMLData {
	var output []UnplugSummary
	ch := parseCheckinData(checkinOutput)
	dev := ch.Device

	for _, s := range summaries {
		duration := time.Duration(s.EndTimeMs-s.StartTimeMs) * time.Millisecond
		if duration == 0 {
			errs = append(errs, fmt.Errorf("error! Invalid duration equals 0"))
			continue
		}

		t := UnplugSummary{
			Date:             s.Date,
			Reason:           s.Reason,
			SummaryStart:     time.Unix(0, s.StartTimeMs*int64(time.Millisecond)).String(),
			SummaryEnd:       time.Unix(0, s.EndTimeMs*int64(time.Millisecond)).String(),
			Duration:         (time.Duration(s.EndTimeMs-s.StartTimeMs) * time.Millisecond).String(),
			LevelDrop:        int32(s.InitialBatteryLevel - s.FinalBatteryLevel),
			LevelDropPerHour: float64(s.InitialBatteryLevel-s.FinalBatteryLevel) / duration.Hours(),
			SystemStats: []DurationStats{
				internalDist{s.ScreenOnSummary}.print(dev, hScreenOn, duration),
				internalDist{s.CPURunningSummary}.print(dev, hCPURunning, duration),
				internalDist{s.TotalSyncSummary}.print(dev, hTotalSync, duration),
				internalDist{s.MobileRadioOnSummary}.print(dev, hRadioOn, duration),
				internalDist{s.PhoneCallSummary}.print(dev, hPhoneCall, duration),
				internalDist{s.GpsOnSummary}.print(dev, hGpsOn, duration),
				internalDist{s.WifiFullLockSummary}.print(dev, hWifiFullLock, duration),
				internalDist{s.WifiScanSummary}.print(dev, hWifiScan, duration),
				internalDist{s.WifiMulticastOnSummary}.print(dev, hWifiMulticastOn, duration),
				internalDist{s.WifiOnSummary}.print(dev, hWifiOn, duration),
				internalDist{s.PhoneScanSummary}.print(dev, hPhoneScan, duration),
				internalDist{s.SensorOnSummary}.print(dev, hSensorOn, duration),
				internalDist{s.PluggedInSummary}.print(dev, hPluggedIn, duration),
				internalDist{s.IdleModeOnSummary}.print(dev, hIdleModeOn, duration),
				// Disabled as they were not found to be very useful.
				/*
					internalDist{s.WifiRunningSummary}.print("WifiRunning", duration),
				*/
			},
			BreakdownStats: []MultiDurationStats{
				mapPrint(dev, hDataConnectionSummary, s.DataConnectionSummary, duration),
				mapPrint(dev, hConnectivitySummary, s.ConnectivitySummary, duration),
				mapPrint(dev, hPerAppSyncSummary, s.PerAppSyncSummary, duration),
				mapPrint(dev, hWakeupReasonSummary, s.WakeupReasonSummary, duration),
				mapPrint(dev, hFirstWakelockAfterSuspend, s.WakeLockSummary, duration),
				mapPrint(dev, hForegroundProcessSummary, s.ForegroundProcessSummary, duration),
				mapPrint(dev, hPhoneStateSummary, s.PhoneStateSummary, duration),
				mapPrint(dev, hScheduledJobSummary, s.ScheduledJobSummary, duration),
				// Disabled as they were not found to be very useful.
				/*
					mapPrint("HealthSummary", s.HealthSummary, duration),
					mapPrint("PlugTypeSummary", s.PlugTypeSummary, duration),
					mapPrint("ChargingStatusSummary", s.ChargingStatusSummary, duration),
					mapPrint("TopApplicationSummary", s.TopApplicationSummary, duration),
				*/
			},
		}
		output = append(output, t)
	}

	// We want each error and warning to be seen on separate lines for clarity
	var errorB, warnB bytes.Buffer
	for _, e := range errs {
		fmt.Fprintln(&errorB, e.Error())
	}
	for _, w := range warnings {
		fmt.Fprintln(&warnB, w)
	}

	return HTMLData{
		SDKVersion:      sdkVersion,
		DeviceModel:     model,
		HistorianCsv:    csv,
		Historian:       template.HTML(historianOutput),
		Filename:        fname,
		Count:           len(output),
		UnplugSummaries: output,
		CheckinSummary:  ch,
		Error:           errorB.String(),
		Warning:         warnB.String(),
		AppStats:        parseAppStats(checkinOutput),
	}
}
