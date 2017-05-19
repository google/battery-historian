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

// Package presenter contains the logic to create data structures for
// HTML presentation of Battery Historian analysis.
package presenter

import (
	"errors"
	"fmt"
	"html/template"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/golang/protobuf/proto"
	"github.com/google/battery-historian/aggregated"
	"github.com/google/battery-historian/bugreportutils"
	"github.com/google/battery-historian/historianutils"
	"github.com/google/battery-historian/parseutils"
	bspb "github.com/google/battery-historian/pb/batterystats_proto"
	"github.com/google/battery-historian/wakeupreason"
)

func abs(x float32) float32 {
	if x < 0 {
		return -x
	}
	return x
}

func absInt32(x int32) int32 {
	if x < 0 {
		return -x
	}
	return x
}

// userActivity contains a processed form of the UserActivity proto found in github.com/google/battery-historian/pb/batterystats.proto.
type userActivity struct {
	Type  string
	Count float32
}

// AppStat contains the parsed app data from a bugreport.
// This contains the raw App proto in github.com/google/battery-historian/pb/batterystats.proto
// but includes some custom fields that need to be processed before conversion to JS.
type AppStat struct {
	DevicePowerPrediction float32
	CPUPowerPrediction    float32 // Device estimated power use due to CPU usage.
	RawStats              *bspb.BatteryStats_App
	Sensor                []bugreportutils.SensorInfo
	UserActivity          []userActivity
}

// HTMLData is the main structure passed to the frontend HTML template containing all analysis items.
type HTMLData struct {
	SDKVersion             int
	DeviceID               string
	DeviceModel            string
	Historian              template.HTML
	Count                  int
	UnplugSummaries        []UnplugSummary
	CheckinSummary         aggregated.Checkin
	Error                  string
	Warning                string
	Filename               string
	AppStats               []AppStat
	Overflow               bool
	HasBatteryStatsHistory bool
}

// CombinedCheckinSummary is the combined structure for the 2 files being compared
type CombinedCheckinSummary struct {
	UserspaceWakelocksCombined   []ActivityDataDiff
	KernelWakelocksCombined      []ActivityDataDiff
	SyncTasksCombined            []ActivityDataDiff
	WakeupReasonsCombined        []ActivityDataDiff
	TopMobileActiveAppsCombined  []ActivityDataDiff
	TopMobileTrafficAppsCombined []NetworkTrafficDataDiff
	TopWifiTrafficAppsCombined   []NetworkTrafficDataDiff
	DevicePowerEstimatesCombined []PowerUseDataDiff
	WifiFullLockActivityCombined []ActivityDataDiff
	GPSUseCombined               []ActivityDataDiff
	CameraUseCombined            []ActivityDataDiff
	FlashlightUseCombined        []ActivityDataDiff
	AppWakeupsCombined           []RateDataDiff
	ANRAndCrashCombined          []anrCrashDataDiff
	CPUUsageCombined             []cpuDataDiff
}

// MultiFileHTMLData is the main structure passed to the frontend HTML template
// containing all analysis items for both the files.
type MultiFileHTMLData struct {
	SDKVersion          []int
	MinSDKVersion       int // This holds the minimum of the SDK Versions for both the files.
	DeviceID            []string
	DeviceModel         []string
	Historian           []template.HTML
	Count               []int
	UnplugSummaries     [][]UnplugSummary
	CheckinSummary      []aggregated.Checkin
	CombinedCheckinData CombinedCheckinSummary
	Filename            []string
	Error               string
	Warning             string
	Overflow            bool
	AppStats            []AppStat
}

// HistogramStats is the struct that contains all the checkin metrics
// which are passed to HTML in order to generate the histogram charts.
type HistogramStats struct {
	//Screen Data
	ScreenOffDischargeRatePerHr aggregated.MFloat32
	ScreenOnDischargeRatePerHr  aggregated.MFloat32
	ScreenOffUptimePercentage   float32
	ScreenOnTimePercentage      float32
	// Data Transfer
	MobileKiloBytesPerHr            aggregated.MFloat32
	WifiKiloBytesPerHr              aggregated.MFloat32
	WifiDischargeRatePerHr          aggregated.MFloat32
	BluetoothDischargeRatePerHr     aggregated.MFloat32
	ModemDischargeRatePerHr         aggregated.MFloat32
	WifiOnTimePercentage            float32
	WifiTransferTimePercentage      float32
	BluetoothTransferTimePercentage float32
	ModemTransferTimePercentage     float32
	BluetoothOnTimePercentage       float32
	// Wakelock Data
	PartialWakelockTimePercentage float32
	KernelOverheadTimePercentage  float32
	FullWakelockTimePercentage    float32
	// Usage Data
	SignalScanningTimePercentage        float32
	MobileActiveTimePercentage          float32
	PhoneCallTimePercentage             float32
	DeviceIdlingTimePercentage          float32
	InteractiveTimePercentage           float32
	DeviceIdleModeEnabledTimePercentage float32
	LowPowerModeEnabledTimePercentage   float32
	// App Data
	TotalAppGPSUseTimePerHour  float32
	TotalAppANRCount           int32
	TotalAppCrashCount         int32
	TotalAppSyncsPerHr         float32
	TotalAppWakeupsPerHr       float32
	TotalAppCPUPowerPct        float32
	TotalAppFlashlightUsePerHr float32
	TotalAppCameraUsePerHr     float32
	ConnectivityChanges        float32
	// Pie charts data.
	ScreenBrightness   map[string]float32
	SignalStrength     map[string]float32
	WifiSignalStrength map[string]float32
	BluetoothState     map[string]float32
	DataConnection     map[string]float32
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
	PowerStates      map[string]parseutils.PowerState
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

func (d internalDist) print(name string, duration time.Duration) DurationStats {
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

func mapPrint(name string, m map[string]parseutils.Dist, duration time.Duration) MultiDurationStats {
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

// byName sorts applications by name in ascending order.
type byName []AppStat

func (a byName) Len() int           { return len(a) }
func (a byName) Swap(i, j int)      { a[i], a[j] = a[j], a[i] }
func (a byName) Less(i, j int) bool { return a[i].RawStats.GetName() < a[j].RawStats.GetName() }

func parseAppStats(checkin *bspb.BatteryStats, sensors map[int32]bugreportutils.SensorInfo) []AppStat {
	var as []AppStat
	bCapMah := checkin.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah()

	for _, app := range checkin.GetApp() {
		a := AppStat{
			RawStats: app,
		}
		if bCapMah > 0 {
			a.DevicePowerPrediction = 100 * float32(app.GetPowerUseItem().GetComputedPowerMah()) / bCapMah
		}

		if app.GetName() == "" {
			app.Name = proto.String(fmt.Sprintf("UNKNOWN_%d", app.GetUid()))
		}

		// Only add it to AppStat if the CPU field exists and is therefore populated.
		if app.Cpu != nil && bCapMah > 0 {
			a.CPUPowerPrediction = 100 * (app.Cpu.GetPowerMaMs() / (1000 * 60 * 60)) / bCapMah
		}

		for _, u := range app.GetUserActivity() {
			a.UserActivity = append(a.UserActivity, userActivity{
				Type:  u.GetName().String(),
				Count: u.GetCount(),
			})
		}

		for _, s := range app.GetSensor() {
			sensor, ok := sensors[s.GetNumber()]
			if !ok {
				sensor = bugreportutils.SensorInfo{
					Name:   fmt.Sprintf("unknown sensor (#%d)", s.GetNumber()),
					Number: s.GetNumber(),
				}
			}
			sensor.TotalTimeMs = int64(s.GetTotalTimeMsec())
			sensor.Count = s.GetCount()
			a.Sensor = append(a.Sensor, sensor)
		}
		as = append(as, a)
	}

	// Sort by name so that we can display the apps in alphabetical order in the dropdown.
	sort.Sort(byName(as))
	return as
}

// PowerUseDataDiff holds PowerUseData info for the 2 files being compared.
type PowerUseDataDiff struct {
	Name           string
	Entries        [2]aggregated.PowerUseData
	PercentageDiff float32
}

// byPercentageDiff sorts applications by the absolute value of percentage battery used in desc order.
type byPercentageDiff []PowerUseDataDiff

func (a byPercentageDiff) Len() int      { return len(a) }
func (a byPercentageDiff) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a byPercentageDiff) Less(i, j int) bool {
	x, y := a[i].PercentageDiff, a[j].PercentageDiff
	return abs(x) >= abs(y)
}

// cpuDataDiff contains the combined CPU usage for file1 and file2.
type cpuDataDiff struct {
	Name         string                // App name.
	Entries      [2]aggregated.CPUData // Array stores data for file1 and file2.
	PowerPctDiff float32               // Difference in percentage of device power used.
}

// byPowerPctDiff sorts applications by absolute value of PowerPctDiff in desc order.
type byPowerPctDiff []cpuDataDiff

func (a byPowerPctDiff) Len() int      { return len(a) }
func (a byPowerPctDiff) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a byPowerPctDiff) Less(i, j int) bool {
	x, y := a[i].PowerPctDiff, a[j].PowerPctDiff
	return abs(x) >= abs(y)
}

// anrCrashDataDiff contains the combined ANR and crash data for file1 and file2.
type anrCrashDataDiff struct {
	Name                         string
	Entries                      [2]aggregated.ANRCrashData // Array stores data for file1 and file2.
	ANRCountDiff, CrashCountDiff int32
}

// byCrashThenANRDiff sorts anrCrashData by the absolute value of the difference in the number
// of crashes, then by the abs(difference) in the number of ANR, both in descending order.
type byCrashThenANRDiff []anrCrashDataDiff

func (d byCrashThenANRDiff) Len() int      { return len(d) }
func (d byCrashThenANRDiff) Swap(i, j int) { d[i], d[j] = d[j], d[i] }
func (d byCrashThenANRDiff) Less(i, j int) bool {
	if d[i].CrashCountDiff == d[j].CrashCountDiff {
		return absInt32(d[i].ANRCountDiff) > absInt32(d[j].ANRCountDiff)
	}
	return absInt32(d[i].CrashCountDiff) > absInt32(d[j].CrashCountDiff)
}

// RateDataDiff contains the combined app metrics for file1 and file2.
type RateDataDiff struct {
	Name           string
	Entries        [2]aggregated.RateData // Array stores data for file1 and file2.
	CountPerHrDiff float32                // Difference in CountPerHr for the two files.
}

// byCountPerHrDiff sorts applications by absolute value of CountPerHrDiff in desc order.
type byCountPerHrDiff []RateDataDiff

func (a byCountPerHrDiff) Len() int      { return len(a) }
func (a byCountPerHrDiff) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a byCountPerHrDiff) Less(i, j int) bool {
	x, y := a[i].CountPerHrDiff, a[j].CountPerHrDiff
	return abs(x) >= abs(y)
}

// ActivityDataDiff stores the combined activity data for the 2 files being compared.
type ActivityDataDiff struct {
	Name             string
	Entries          [2]aggregated.ActivityData // Array stores data for file1 and file2.
	CountPerHourDiff float32                    // Difference in CountPerHr for the two files.
	SecondsPerHrDiff float32                    // Difference in durPerHr for the two files.
}

// bySecondsPerHrDiff sorts applications by absolute value of SecondsPerHrDiff in desc order.
type bySecondsPerHrDiff []ActivityDataDiff

func (a bySecondsPerHrDiff) Len() int      { return len(a) }
func (a bySecondsPerHrDiff) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a bySecondsPerHrDiff) Less(i, j int) bool {
	x, y := a[i].SecondsPerHrDiff, a[j].SecondsPerHrDiff
	return abs(x) >= abs(y)
}

// NetworkTrafficDataDiff stores combined network traffic data for the 2 files being compared.
type NetworkTrafficDataDiff struct {
	Name                       string
	Entries                    [2]aggregated.NetworkTrafficData // Array stores data for file1 and file2.
	WifiMegaBytesPerHourDiff   float32
	MobileMegaBytesPerHourDiff float32
}

// byWifiMegaBytesPerHourDiff sorts applications by the absolute value of WifiMegaBytesPerHour
// difference between data from the two files.
type byWifiMegaBytesPerHourDiff []NetworkTrafficDataDiff

func (a byWifiMegaBytesPerHourDiff) Len() int      { return len(a) }
func (a byWifiMegaBytesPerHourDiff) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a byWifiMegaBytesPerHourDiff) Less(i, j int) bool {
	x, y := a[i].WifiMegaBytesPerHourDiff, a[j].WifiMegaBytesPerHourDiff
	return abs(x) >= abs(y)
}

// byMobileMegaBytesPerHourDiff sorts applications by absolute value of MobileMegaBytesPerHour
// difference between data from the two files in decending order.
type byMobileMegaBytesPerHourDiff []NetworkTrafficDataDiff

func (a byMobileMegaBytesPerHourDiff) Len() int      { return len(a) }
func (a byMobileMegaBytesPerHourDiff) Swap(i, j int) { a[i], a[j] = a[j], a[i] }
func (a byMobileMegaBytesPerHourDiff) Less(i, j int) bool {
	x, y := a[i].MobileMegaBytesPerHourDiff, a[j].MobileMegaBytesPerHourDiff
	return abs(x) >= abs(y)
}

// combineCheckinData combines the Checkin data for the two files being compared in to one common struct.
func combineCheckinData(data []HTMLData) CombinedCheckinSummary {
	// Maps to merge the two individual data by application name.
	topBat := make(map[string]PowerUseDataDiff)
	uWl := make(map[string]ActivityDataDiff)
	kerWl := make(map[string]ActivityDataDiff)
	sync := make(map[string]ActivityDataDiff)
	wake := make(map[string]ActivityDataDiff)
	active := make(map[string]ActivityDataDiff)
	full := make(map[string]ActivityDataDiff)
	gps := make(map[string]ActivityDataDiff)
	cam := make(map[string]ActivityDataDiff)
	flash := make(map[string]ActivityDataDiff)
	mob := make(map[string]NetworkTrafficDataDiff)
	wifi := make(map[string]NetworkTrafficDataDiff)
	appW := make(map[string]RateDataDiff)
	ac := make(map[string]anrCrashDataDiff)
	cpu := make(map[string]cpuDataDiff)

	// Loop over data for the two files.
	for index, dataValue := range data {
		for _, value := range dataValue.CheckinSummary.DevicePowerEstimates {
			p := topBat[value.Name]
			p.Entries[index] = value
			p.Name = value.Name
			topBat[value.Name] = p
			// Calculating the diff between the two individual file metrics.
			p.PercentageDiff = topBat[value.Name].Entries[0].Percent -
				topBat[value.Name].Entries[1].Percent
			topBat[value.Name] = p
		}

		for _, value := range dataValue.CheckinSummary.UserspaceWakelocks {
			u := uWl[value.Name]
			u.Entries[index] = value
			u.Name = value.Name
			uWl[value.Name] = u
			// Calculating the diff between the two individual file metrics.
			u.CountPerHourDiff = uWl[value.Name].Entries[0].CountPerHour -
				uWl[value.Name].Entries[1].CountPerHour
			u.SecondsPerHrDiff = uWl[value.Name].Entries[0].SecondsPerHr -
				uWl[value.Name].Entries[1].SecondsPerHr
			uWl[value.Name] = u
		}

		for _, value := range dataValue.CheckinSummary.KernelWakelocks {
			k := kerWl[value.Name]
			k.Entries[index] = value
			k.Name = value.Name
			kerWl[value.Name] = k
			// Calculating the diff between the two individual file metrics.
			k.CountPerHourDiff = kerWl[value.Name].Entries[0].CountPerHour -
				kerWl[value.Name].Entries[1].CountPerHour
			k.SecondsPerHrDiff = kerWl[value.Name].Entries[0].SecondsPerHr -
				kerWl[value.Name].Entries[1].SecondsPerHr
			kerWl[value.Name] = k
		}

		for _, value := range dataValue.CheckinSummary.SyncTasks {
			s := sync[value.Name]
			s.Entries[index] = value
			s.Name = value.Name
			sync[value.Name] = s
			// Calculating the diff between the two individual file metrics.
			s.CountPerHourDiff = sync[value.Name].Entries[0].CountPerHour -
				sync[value.Name].Entries[1].CountPerHour
			s.SecondsPerHrDiff = sync[value.Name].Entries[0].SecondsPerHr -
				sync[value.Name].Entries[1].SecondsPerHr
			sync[value.Name] = s
		}

		for _, value := range dataValue.CheckinSummary.WakeupReasons {
			w := wake[value.Name]
			w.Entries[index] = value
			w.Name = value.Name
			wake[value.Name] = w
			// Calculating the diff between the two individual file metrics.
			w.CountPerHourDiff = wake[value.Name].Entries[0].CountPerHour -
				wake[value.Name].Entries[1].CountPerHour
			w.SecondsPerHrDiff = wake[value.Name].Entries[0].SecondsPerHr -
				wake[value.Name].Entries[1].SecondsPerHr
			wake[value.Name] = w
		}

		for _, value := range dataValue.CheckinSummary.TopMobileTrafficApps {
			t := mob[value.Name]
			t.Entries[index] = value
			t.Name = value.Name
			mob[value.Name] = t
			// Calculating the diff between the two individual file metrics.
			t.WifiMegaBytesPerHourDiff = mob[value.Name].Entries[0].WifiMegaBytesPerHour -
				mob[value.Name].Entries[1].WifiMegaBytesPerHour
			t.MobileMegaBytesPerHourDiff = mob[value.Name].Entries[0].MobileMegaBytesPerHour -
				mob[value.Name].Entries[1].MobileMegaBytesPerHour
			mob[value.Name] = t
		}

		for _, value := range dataValue.CheckinSummary.TopWifiTrafficApps {
			w := wifi[value.Name]
			w.Entries[index] = value
			w.Name = value.Name
			wifi[value.Name] = w
			// Calculating the diff between the two individual file metrics.
			w.WifiMegaBytesPerHourDiff = wifi[value.Name].Entries[0].WifiMegaBytesPerHour -
				wifi[value.Name].Entries[1].WifiMegaBytesPerHour
			w.MobileMegaBytesPerHourDiff = wifi[value.Name].Entries[0].MobileMegaBytesPerHour -
				wifi[value.Name].Entries[1].MobileMegaBytesPerHour
			wifi[value.Name] = w
		}

		for _, value := range dataValue.CheckinSummary.TopMobileActiveApps {
			m := active[value.Name]
			m.Entries[index] = value
			m.Name = value.Name
			active[value.Name] = m
			// Calculating the diff between the two individual file metrics.
			m.CountPerHourDiff = active[value.Name].Entries[0].CountPerHour -
				active[value.Name].Entries[1].CountPerHour
			m.SecondsPerHrDiff = active[value.Name].Entries[0].SecondsPerHr -
				active[value.Name].Entries[1].SecondsPerHr
			active[value.Name] = m
		}

		for _, value := range dataValue.CheckinSummary.WifiFullLockActivity {
			k := full[value.Name]
			k.Entries[index] = value
			k.Name = value.Name
			full[value.Name] = k
			// Calculating the diff between the two individual file metrics.
			k.SecondsPerHrDiff = full[value.Name].Entries[0].SecondsPerHr -
				full[value.Name].Entries[1].SecondsPerHr
			full[value.Name] = k
		}

		for _, value := range dataValue.CheckinSummary.GPSUse {
			k := gps[value.Name]
			k.Entries[index] = value
			k.Name = value.Name
			gps[value.Name] = k
			// Calculating the diff between the two individual file metrics.
			k.CountPerHourDiff = gps[value.Name].Entries[0].CountPerHour -
				gps[value.Name].Entries[1].CountPerHour
			k.SecondsPerHrDiff = gps[value.Name].Entries[0].SecondsPerHr -
				gps[value.Name].Entries[1].SecondsPerHr
			gps[value.Name] = k
		}

		for _, value := range dataValue.CheckinSummary.CameraUse {
			k := cam[value.Name]
			k.Entries[index] = value
			k.Name = value.Name
			cam[value.Name] = k
			// Calculating the diff between the two individual file metrics.
			k.CountPerHourDiff = cam[value.Name].Entries[0].CountPerHour -
				cam[value.Name].Entries[1].CountPerHour
			k.SecondsPerHrDiff = cam[value.Name].Entries[0].SecondsPerHr -
				cam[value.Name].Entries[1].SecondsPerHr
			cam[value.Name] = k
		}

		for _, value := range dataValue.CheckinSummary.FlashlightUse {
			k := flash[value.Name]
			k.Entries[index] = value
			k.Name = value.Name
			flash[value.Name] = k
			// Calculating the diff between the two individual file metrics.
			k.CountPerHourDiff = flash[value.Name].Entries[0].CountPerHour -
				flash[value.Name].Entries[1].CountPerHour
			k.SecondsPerHrDiff = flash[value.Name].Entries[0].SecondsPerHr -
				flash[value.Name].Entries[1].SecondsPerHr
			flash[value.Name] = k
		}

		for _, value := range dataValue.CheckinSummary.AppWakeups {
			m := appW[value.Name]
			m.Entries[index] = value
			m.Name = value.Name
			appW[value.Name] = m
			// Calculating the diff between the two individual file metrics.
			m.CountPerHrDiff = appW[value.Name].Entries[0].CountPerHr -
				appW[value.Name].Entries[1].CountPerHr
			appW[value.Name] = m
		}

		for _, value := range dataValue.CheckinSummary.ANRAndCrash {
			m := ac[value.Name]
			m.Entries[index] = value
			m.Name = value.Name
			ac[value.Name] = m
			// Calculating the diff between the two individual file metrics.
			m.ANRCountDiff = ac[value.Name].Entries[0].ANRCount -
				ac[value.Name].Entries[1].ANRCount
			m.CrashCountDiff = ac[value.Name].Entries[0].CrashCount -
				ac[value.Name].Entries[1].CrashCount
			ac[value.Name] = m
		}

		for _, value := range dataValue.CheckinSummary.CPUUsage {
			m := cpu[value.Name]
			m.Entries[index] = value
			m.Name = value.Name
			cpu[value.Name] = m
			// Calculating the diff between the two individual file metrics.
			m.PowerPctDiff = cpu[value.Name].Entries[0].PowerPct -
				cpu[value.Name].Entries[1].PowerPct
			cpu[value.Name] = m
		}
	}
	/* Convert all the maps into arrays in order to sort them.
	 * We sort the arrays by the absolute values of their diff values
	 * since, we want to display the data sorted by descending order of
	 * differences.
	 */

	// Arrays to store the final sorted list. These arrays are sorted by the
	// absolute value of diffs between data from the 2 files.
	var result CombinedCheckinSummary
	{
		var t []PowerUseDataDiff
		for _, value := range topBat {
			t = append(t, value)
		}
		sort.Sort(byPercentageDiff(t))
		result.DevicePowerEstimatesCombined = t
	}
	{
		var u []ActivityDataDiff
		for _, value := range uWl {
			u = append(u, value)
		}
		sort.Sort(bySecondsPerHrDiff(u))
		result.UserspaceWakelocksCombined = u
	}
	{
		var k []ActivityDataDiff
		for _, value := range kerWl {
			k = append(k, value)
		}
		sort.Sort(bySecondsPerHrDiff(k))
		result.KernelWakelocksCombined = k
	}
	{
		var s []ActivityDataDiff
		for _, value := range sync {
			s = append(s, value)
		}
		sort.Sort(bySecondsPerHrDiff(s))
		result.SyncTasksCombined = s
	}
	{
		var r []ActivityDataDiff
		for _, value := range wake {
			r = append(r, value)
		}
		sort.Sort(bySecondsPerHrDiff(r))
		result.WakeupReasonsCombined = r
	}
	{
		var m []NetworkTrafficDataDiff
		for _, value := range mob {
			m = append(m, value)
		}
		sort.Sort(byMobileMegaBytesPerHourDiff(m))
		result.TopMobileTrafficAppsCombined = m
	}
	{
		var w []NetworkTrafficDataDiff
		for _, value := range wifi {
			w = append(w, value)
		}
		sort.Sort(byWifiMegaBytesPerHourDiff(w))
		result.TopWifiTrafficAppsCombined = w
	}
	{
		var a []ActivityDataDiff
		for _, value := range active {
			a = append(a, value)
		}
		sort.Sort(bySecondsPerHrDiff(a))
		result.TopMobileActiveAppsCombined = a
	}
	{
		var r []RateDataDiff
		for _, value := range appW {
			r = append(r, value)
		}
		sort.Sort(byCountPerHrDiff(r))
		result.AppWakeupsCombined = r
	}
	{
		var a []ActivityDataDiff
		for _, value := range full {
			a = append(a, value)
		}
		sort.Sort(bySecondsPerHrDiff(a))
		result.WifiFullLockActivityCombined = a
	}
	{
		var a []ActivityDataDiff
		for _, value := range gps {
			a = append(a, value)
		}
		sort.Sort(bySecondsPerHrDiff(a))
		result.GPSUseCombined = a
	}
	{
		var a []ActivityDataDiff
		for _, value := range cam {
			a = append(a, value)
		}
		sort.Sort(bySecondsPerHrDiff(a))
		result.CameraUseCombined = a
	}
	{
		var a []ActivityDataDiff
		for _, value := range flash {
			a = append(a, value)
		}
		sort.Sort(bySecondsPerHrDiff(a))
		result.FlashlightUseCombined = a
	}
	{
		var a []anrCrashDataDiff
		for _, value := range ac {
			a = append(a, value)
		}
		sort.Sort(byCrashThenANRDiff(a))
		result.ANRAndCrashCombined = a
	}
	{
		var a []cpuDataDiff
		for _, value := range cpu {
			a = append(a, value)
		}
		sort.Sort(byPowerPctDiff(a))
		result.CPUUsageCombined = a
	}
	return result
}

// MultiFileData returns a single structure (MultiFileHTMLData) containing
// aggregated battery stats for both the compare files in html format.
func MultiFileData(data []HTMLData) MultiFileHTMLData {
	var m MultiFileHTMLData
	m.MinSDKVersion = math.MaxInt32
	m.CombinedCheckinData = combineCheckinData(data)

	for _, value := range data {
		m.SDKVersion = append(m.SDKVersion, value.SDKVersion)
		m.DeviceID = append(m.DeviceID, value.DeviceID)
		m.DeviceModel = append(m.DeviceModel, value.DeviceModel)
		m.Historian = append(m.Historian, value.Historian)
		m.Filename = append(m.Filename, value.Filename)
		m.CheckinSummary = append(m.CheckinSummary, value.CheckinSummary)
		m.UnplugSummaries = append(m.UnplugSummaries, value.UnplugSummaries)
		m.Count = append(m.Count, value.Count)
		if value.Warning != "" {
			m.Warning = fmt.Sprintf("%s\n%s:\n  %s", m.Warning, value.Filename, value.Warning)
		}
		if value.Error != "" {
			m.Error = fmt.Sprintf("%s\n%s:\n  %s", m.Error, value.Filename, value.Error)
		}
		m.Overflow = m.Overflow || value.Overflow

		if value.SDKVersion < m.MinSDKVersion {
			m.MinSDKVersion = value.SDKVersion
		}
	}
	return m
}

// decodeWakeupReasons performs final processing of the aggregated checkin before displaying it.
func decodeWakeupReasons(c *aggregated.Checkin) ([]string, []error) {
	if !wakeupreason.IsSupportedDevice(c.Device) {
		return nil, nil
	}

	var errs []error
	var warns []string
	// Range copies the values from the slice, preventing modification.
	for i := 0; i < len(c.WakeupReasons); i++ {
		w := &c.WakeupReasons[i]
		n := w.Name
		if strings.HasPrefix(n, "Abort:") {
			// Aborts won't be in the mapping.
			continue
		}
		r, unknown, err := wakeupreason.FindSubsystem(c.Device, n)
		for _, u := range unknown {
			warns = append(warns, fmt.Sprintf("Unknown wakeup reason %q", u))
		}
		if err != nil {
			if err.Error() == wakeupreason.ErrDeviceNotFound.Error() {
				// This shouldn't happen since we call IsSupportedDevice before looping.
				errs = append(errs, fmt.Errorf("wakeup_reason flip flopped on supported device %q", c.Device))
			} else {
				errs = append(errs, err)
			}
		}
		if rs := strings.TrimSpace(r); rs != "" {
			w.Name = fmt.Sprintf("%s (%s)", rs, n)
			w.Title = n
		}
	}
	return warns, errs
}

// Data returns a single structure (HTMLData) containing aggregated battery stats in html format.
func Data(meta *bugreportutils.MetaInfo, fname string, summaries []parseutils.ActivitySummary,
	checkinOutput *bspb.BatteryStats, historianOutput string,
	warnings []string, errs []error, overflow, hasBatteryStatsHistory bool) HTMLData {
	var output []UnplugSummary
	ch := aggregated.ParseCheckinData(checkinOutput)
	w, e := decodeWakeupReasons(&ch)
	errs = append(errs, e...)
	warnings = append(warnings, w...)

	for _, s := range summaries {
		duration := time.Duration(s.EndTimeMs-s.StartTimeMs) * time.Millisecond
		if duration == 0 {
			errs = append(errs, fmt.Errorf("history duration is 0"))
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
				internalDist{s.ScreenOnSummary}.print(hScreenOn, duration),
				internalDist{s.CPURunningSummary}.print(hCPURunning, duration),
				internalDist{s.TotalSyncSummary}.print(hTotalSync, duration),
				internalDist{s.MobileRadioOnSummary}.print(hRadioOn, duration),
				internalDist{s.PhoneCallSummary}.print(hPhoneCall, duration),
				internalDist{s.GpsOnSummary}.print(hGpsOn, duration),
				internalDist{s.WifiFullLockSummary}.print(hWifiFullLock, duration),
				internalDist{s.WifiScanSummary}.print(hWifiScan, duration),
				internalDist{s.WifiMulticastOnSummary}.print(hWifiMulticastOn, duration),
				internalDist{s.WifiOnSummary}.print(hWifiOn, duration),
				internalDist{s.WifiRunningSummary}.print(hWifiRunning, duration),
				internalDist{s.WifiRadioSummary}.print(hWifiRadio, duration),
				internalDist{s.PhoneScanSummary}.print(hPhoneScan, duration),
				internalDist{s.SensorOnSummary}.print(hSensorOn, duration),
				internalDist{s.PluggedInSummary}.print(hPluggedIn, duration),
				internalDist{s.FlashlightOnSummary}.print(hFlashlightOn, duration),
				internalDist{s.LowPowerModeOnSummary}.print(hLowPowerModeOn, duration),
				internalDist{s.AudioOnSummary}.print(hAudioOn, duration),
				internalDist{s.VideoOnSummary}.print(hVideoOn, duration),
			},
			BreakdownStats: []MultiDurationStats{
				mapPrint(hDataConnectionSummary, s.DataConnectionSummary, duration),
				mapPrint(hConnectivitySummary, s.ConnectivitySummary, duration),
				mapPrint(hPerAppSyncSummary, s.PerAppSyncSummary, duration),
				mapPrint(hWakeupReasonSummary, s.WakeupReasonSummary, duration),
				mapPrint(hFirstWakelockAfterSuspend, s.WakeLockSummary, duration),
				mapPrint(hDetailedWakelockSummary, s.WakeLockDetailedSummary, duration),
				mapPrint(hForegroundProcessSummary, s.ForegroundProcessSummary, duration),
				mapPrint(hPhoneStateSummary, s.PhoneStateSummary, duration),
				mapPrint(hScheduledJobSummary, s.ScheduledJobSummary, duration),
				mapPrint(hWifiSupplSummary, s.WifiSupplSummary, duration),
				mapPrint(hPhoneSignalStrengthSummary, s.PhoneSignalStrengthSummary, duration),
				mapPrint(hWifiSignalStrengthSummary, s.WifiSignalStrengthSummary, duration),
				mapPrint(hTopApplicationSummary, s.TopApplicationSummary, duration),
				mapPrint(hIdleModeSummary, s.IdleModeSummary, duration),
				// Disabled as they were not found to be very useful.
				/*
				   mapPrint("HealthSummary", s.HealthSummary, duration),
				   mapPrint("PlugTypeSummary", s.PlugTypeSummary, duration),
				   mapPrint("ChargingStatusSummary", s.ChargingStatusSummary, duration),
				*/
			},
			PowerStates: s.PowerStateOverallSummary,
		}
		output = append(output, t)
	}
	if checkinOutput.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah() == 0 {
		errs = append(errs, errors.New("device capacity is 0"))
	}

	return HTMLData{
		DeviceID:               meta.DeviceID,
		SDKVersion:             meta.SdkVersion,
		DeviceModel:            meta.ModelName,
		Historian:              template.HTML(historianOutput),
		Filename:               fname,
		Count:                  len(output),
		UnplugSummaries:        output,
		CheckinSummary:         ch,
		Error:                  historianutils.ErrorsToString(errs),
		Warning:                strings.Join(warnings, "\n"),
		AppStats:               parseAppStats(checkinOutput, meta.Sensors),
		Overflow:               overflow,
		HasBatteryStatsHistory: hasBatteryStatsHistory,
	}
}
