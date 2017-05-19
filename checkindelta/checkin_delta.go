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

// Package checkindelta contains functions to calculate deltas between snapshots of
// aggregated checkin battery stats from a device.
package checkindelta

import (
	"fmt"
	"log"
	"reflect"
	"strconv"
	"strings"

	"github.com/golang/protobuf/proto"
	"github.com/google/battery-historian/checkinparse"
	"github.com/google/battery-historian/packageutils"

	bspb "github.com/google/battery-historian/pb/batterystats_proto"
	bldpb "github.com/google/battery-historian/pb/build_proto"
)

const (
	// connector string used to combine 2 build information strings.
	connector = " - "
)

// combineProtoStrings compares and combines 2 strings from a proto.
func combineProtoStrings(str1, str2, conn string) *string {
	if str1 == "" && str2 == "" {
		return nil
	}
	if str1 == str2 {
		return proto.String(str1)
	}
	return proto.String(str1 + conn + str2)
}

// appID returns an identifer for the app that should be unique and consistent between reports.
func appID(app *bspb.BatteryStats_App) string {
	if app == nil {
		return ""
	}
	u := app.GetUid()
	// Hard-coded UIDs should be consistent.
	if u < packageutils.FirstApplicationUID {
		return strconv.Itoa(int(u))
	}
	if n := app.GetName(); n != "" {
		return n
	}
	return fmt.Sprintf("UNKNOWN_%d", u)
}

// ComputeDeltaFromSameDevice takes two Batterystats protos taken from the same device and outputs
// a third one that contains the difference between the two, including fields that can only be
// subtracted in special cases (same device and same start clock time). Second will be subtracted
// from first.
func ComputeDeltaFromSameDevice(first, second *bspb.BatteryStats) *bspb.BatteryStats {
	d := ComputeDelta(first, second)
	if d == nil || first.GetSystem().GetBattery().GetStartClockTimeMsec() != second.GetSystem().GetBattery().GetStartClockTimeMsec() {
		// Nothing more we can do.
		return d
	}
	if d.System == nil {
		d.System = &bspb.BatteryStats_System{}
	}
	d.System.ChargeStep = subtractChargeStep(first.GetSystem().GetChargeStep(), second.GetSystem().GetChargeStep())
	d.System.DischargeStep = subtractDischargeStep(first.GetSystem().GetDischargeStep(), second.GetSystem().GetDischargeStep())

	// We can set the StartClockTime and these other fields because the reports came from the
	// same device and have the same start clock time, so they are truly overlapping reports.
	if d.System.Battery == nil {
		d.System.Battery = &bspb.BatteryStats_System_Battery{}
	}
	d.System.Battery.StartClockTimeMsec = proto.Int64(
		second.GetSystem().GetBattery().GetStartClockTimeMsec() + int64(second.GetSystem().GetBattery().GetTotalRealtimeMsec()))
	d.StartTimeUsec = proto.Int64(d.GetSystem().GetBattery().GetStartClockTimeMsec() * 1e3)
	d.EndTimeUsec = first.EndTimeUsec
	if d.System.PowerUseSummary == nil {
		d.System.PowerUseSummary = &bspb.BatteryStats_System_PowerUseSummary{}
	}
	// Battery capacity of the same device doesn't change.
	d.System.PowerUseSummary.BatteryCapacityMah = proto.Float32(first.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah())

	return d
}

// ComputeDelta takes two protos and outputs a third one that
// contains the difference between the two. Second will be subtracted from first.
func ComputeDelta(first, second *bspb.BatteryStats) *bspb.BatteryStats {
	// Deep copy so we don't accidentally change the original protos.
	p1, p2 := proto.Clone(first).(*bspb.BatteryStats), proto.Clone(second).(*bspb.BatteryStats)

	d := &bspb.BatteryStats{
		ReportVersion:   proto.Int32(p1.GetReportVersion()),
		AggregationType: bspb.BatteryStats_AggregationType(p1.GetAggregationType()).Enum(),
		Build:           subtractBuild(p1.GetBuild(), p2.GetBuild()),
	}
	// App Diff
	// Find apps which are in p1 but not in p2 and diff
	p2AppMap := make(map[string]*bspb.BatteryStats_App)
	for _, a2 := range p2.GetApp() {
		p2AppMap[appID(a2)] = a2
	}

	for _, a1 := range p1.GetApp() {
		a2, ok := p2AppMap[appID(a1)]
		if !ok {
			d.App = append(d.App, proto.Clone(a1).(*bspb.BatteryStats_App))
			continue
		}
		if a := subtractApp(a1, a2); a != nil {
			d.App = append(d.App, a)
		}
	}
	// Find apps which are in p2 but not in p1 and get the diff
	p1AppMap := make(map[string]*bspb.BatteryStats_App)
	for _, a1 := range p1.GetApp() {
		p1AppMap[appID(a1)] = a1
	}
	for _, a2 := range p2.GetApp() {
		if _, ok := p1AppMap[appID(a2)]; !ok {
			a1 := &bspb.BatteryStats_App{}
			if a := subtractApp(a1, a2); a != nil {
				d.App = append(d.App, a)
			}
		}
	}

	// System Diff
	s1, s2 := p1.GetSystem(), p2.GetSystem()
	s := &bspb.BatteryStats_System{}
	systemChanged := false

	if diff := subtractMessage(s1.GetBattery(), s2.GetBattery()); diff != nil {
		s.Battery = diff.(*bspb.BatteryStats_System_Battery)
		systemChanged = true
	}
	if diff := subtractMessage(s1.GetBatteryDischarge(), s2.GetBatteryDischarge()); diff != nil {
		s.BatteryDischarge = diff.(*bspb.BatteryStats_System_BatteryDischarge)
		systemChanged = true
	}
	if diff := subtractSystemBatteryLevel(s1.GetBatteryLevel(), s2.GetBatteryLevel()); diff != nil {
		s.BatteryLevel = diff
		systemChanged = true
	}
	if diff := subtractRepeatedMessage(s1.GetBluetoothState(), s2.GetBluetoothState()); !diff.IsNil() {
		s.BluetoothState = diff.Interface().([]*bspb.BatteryStats_System_BluetoothState)
		systemChanged = true
	}
	if diff := subtractRepeatedMessage(s1.GetDataConnection(), s2.GetDataConnection()); !diff.IsNil() {
		s.DataConnection = diff.Interface().([]*bspb.BatteryStats_System_DataConnection)
		systemChanged = true
	}
	if diff := subtractMessage(s1.GetGlobalBluetooth(), s2.GetGlobalBluetooth()); diff != nil {
		s.GlobalBluetooth = diff.(*bspb.BatteryStats_System_GlobalBluetooth)
		systemChanged = true
	}
	if diff := subtractController(s1.GetGlobalBluetoothController(), s2.GetGlobalBluetoothController()); diff != nil {
		s.GlobalBluetoothController = diff
		systemChanged = true
	}
	if diff := subtractController(s1.GetGlobalModemController(), s2.GetGlobalModemController()); diff != nil {
		s.GlobalModemController = diff
		systemChanged = true
	}
	if diff := subtractMessage(s1.GetGlobalNetwork(), s2.GetGlobalNetwork()); diff != nil {
		s.GlobalNetwork = diff.(*bspb.BatteryStats_System_GlobalNetwork)
		systemChanged = true
	}
	if diff := subtractMessage(s1.GetGlobalWifi(), s2.GetGlobalWifi()); diff != nil {
		s.GlobalWifi = diff.(*bspb.BatteryStats_System_GlobalWifi)
		systemChanged = true
	}
	if diff := subtractController(s1.GetGlobalWifiController(), s2.GetGlobalWifiController()); diff != nil {
		s.GlobalWifiController = diff
		systemChanged = true
	}
	if diff := subtractRepeatedMessage(s1.GetKernelWakelock(), s2.GetKernelWakelock()); !diff.IsNil() {
		s.KernelWakelock = diff.Interface().([]*bspb.BatteryStats_System_KernelWakelock)
		systemChanged = true
	}
	if diff := subtractMessage(s1.GetMisc(), s2.GetMisc()); diff != nil {
		s.Misc = diff.(*bspb.BatteryStats_System_Misc)
		systemChanged = true
	}
	if diff := subtractRepeatedMessage(s1.GetPowerUseItem(), s2.GetPowerUseItem()); !diff.IsNil() {
		s.PowerUseItem = diff.Interface().([]*bspb.BatteryStats_System_PowerUseItem)
		systemChanged = true
	}
	if diff := subtractMessage(s1.GetPowerUseSummary(), s2.GetPowerUseSummary()); diff != nil {
		s.PowerUseSummary = diff.(*bspb.BatteryStats_System_PowerUseSummary)
		systemChanged = true
	}
	if diff := subtractRepeatedMessage(s1.GetScreenBrightness(), s2.GetScreenBrightness()); !diff.IsNil() {
		s.ScreenBrightness = diff.Interface().([]*bspb.BatteryStats_System_ScreenBrightness)
		systemChanged = true
	}
	if diff := subtractMessage(s1.GetSignalScanningTime(), s2.GetSignalScanningTime()); diff != nil {
		s.SignalScanningTime = diff.(*bspb.BatteryStats_System_SignalScanningTime)
		systemChanged = true
	}
	if diff := subtractRepeatedMessage(s1.GetSignalStrength(), s2.GetSignalStrength()); !diff.IsNil() {
		s.SignalStrength = diff.Interface().([]*bspb.BatteryStats_System_SignalStrength)
		systemChanged = true
	}
	if diff := subtractRepeatedMessage(s1.GetWakeupReason(), s2.GetWakeupReason()); !diff.IsNil() {
		s.WakeupReason = diff.Interface().([]*bspb.BatteryStats_System_WakeupReason)
		systemChanged = true
	}
	if diff := subtractRepeatedMessage(s1.GetWifiSignalStrength(), s2.GetWifiSignalStrength()); !diff.IsNil() {
		s.WifiSignalStrength = diff.Interface().([]*bspb.BatteryStats_System_WifiSignalStrength)
		systemChanged = true
	}
	if diff := subtractRepeatedMessage(s1.GetWifiState(), s2.GetWifiState()); !diff.IsNil() {
		s.WifiState = diff.Interface().([]*bspb.BatteryStats_System_WifiState)
		systemChanged = true
	}
	if diff := subtractRepeatedMessage(s1.GetWifiSupplicantState(), s2.GetWifiSupplicantState()); !diff.IsNil() {
		s.WifiSupplicantState = diff.Interface().([]*bspb.BatteryStats_System_WifiSupplicantState)
		systemChanged = true
	}
	if systemChanged {
		if s.PowerUseSummary == nil {
			s.PowerUseSummary = &bspb.BatteryStats_System_PowerUseSummary{}
		}
		if s1.GetPowerUseSummary() != nil {
			s.PowerUseSummary.BatteryCapacityMah = s1.GetPowerUseSummary().BatteryCapacityMah
		} else if s2.GetPowerUseSummary() != nil {
			s.PowerUseSummary.BatteryCapacityMah = s2.GetPowerUseSummary().BatteryCapacityMah
		}
		if (s1.GetPowerUseSummary() != nil && s2.GetPowerUseSummary() != nil) &&
			(s1.GetPowerUseSummary().GetBatteryCapacityMah() != s2.GetPowerUseSummary().GetBatteryCapacityMah()) {
			log.Printf("differing battery capacities found %v mah vs %v mah", s1.GetPowerUseSummary().GetBatteryCapacityMah(),
				s2.GetPowerUseSummary().GetBatteryCapacityMah())
		}
		d.System = s
	}
	if systemChanged || len(d.App) > 0 {
		return d
	}
	return nil
}

// subtractChargeStep "subtracts" the ChargeStep data in one list from the data in the other list.
// This function acts a little differently from ComputeDelta in that it will "subtract" the shorter list from
// the longer list by only returning data in the longer list that is not in the shorter list.
// The input lists must come from reports from the same device with the same StartClockTimeMsec, otherwise,
// function behavior is undefined.
func subtractChargeStep(c1, c2 []*bspb.BatteryStats_System_ChargeStep) []*bspb.BatteryStats_System_ChargeStep {
	if len(c1) == len(c2) {
		return nil
	}
	// Because the lists are sorted in the same order, with the oldest first,
	// we can just return the non-overlapping section of the longest list.
	l1, l2 := len(c1), len(c2)
	if l1 > l2 {
		return c1[l2:]
	}
	return c2[l1:]
}

// subtractDischargeStep "subtracts" the DischargeStep data in one list from the data in the other list.
// This function acts a little differently from ComputeDelta in that it will "subtract" the shorter list from
// the longer list by only returning data in the longer list that is not in the shorter list.
// The input lists must come from reports from the same device with the same StartClockTimeMsec, otherwise,
// function behavior is undefined.
func subtractDischargeStep(c1, c2 []*bspb.BatteryStats_System_DischargeStep) []*bspb.BatteryStats_System_DischargeStep {
	if len(c1) == len(c2) {
		return nil
	}
	// Because the lists are sorted in the same order, with the oldest first,
	// we can just return the non-overlapping section of the longest list.
	l1, l2 := len(c1), len(c2)
	if l1 > l2 {
		return c1[l2:]
	}
	return c2[l1:]
}

func subtractBuild(b1, b2 *bldpb.Build) *bldpb.Build {
	if b1 == nil && b2 == nil {
		return nil
	}
	return &bldpb.Build{
		// We combine the build information for the first proto with that of the second.
		// The output is of the form "info1 - info2".
		// If the information of both the protos is the same, only one set is retained.
		Fingerprint: combineProtoStrings(b1.GetFingerprint(), b2.GetFingerprint(), connector),
		Brand:       combineProtoStrings(b1.GetBrand(), b2.GetBrand(), connector),
		Product:     combineProtoStrings(b1.GetProduct(), b2.GetProduct(), connector),
		Device:      combineProtoStrings(b1.GetDevice(), b2.GetDevice(), connector),
		Release:     combineProtoStrings(b1.GetRelease(), b2.GetRelease(), connector),
		BuildId:     combineProtoStrings(b1.GetBuildId(), b2.GetBuildId(), connector),
	}
}

func subtractApp(a1, a2 *bspb.BatteryStats_App) *bspb.BatteryStats_App {
	// The app name may be empty for one of the inputs,
	// if that file does not contain any occurence for this particular app
	// Here we extract the valid name from the 2 protos
	appName := a1.GetName()
	if appName == "" {
		appName = a2.GetName()
	}

	a := &bspb.BatteryStats_App{
		Name:        proto.String(appName),
		Uid:         proto.Int32(a1.GetUid()),
		VersionName: combineProtoStrings(a1.GetVersionName(), a2.GetVersionName(), connector),
		VersionCode: a1.VersionCode,
	}
	c2map := make(map[string]*bspb.BatteryStats_App_Child)
	for _, c := range a2.GetChild() {
		c2map[c.GetName()] = c
	}

	changed := a1.GetVersionCode() != a2.GetVersionCode() || a1.GetVersionName() != a2.GetVersionName()
	if diff := subtractMessage(a1.GetCpu(), a2.GetCpu()); diff != nil {
		a.Cpu = diff.(*bspb.BatteryStats_App_Cpu)
		changed = true
	}
	if diff := subtractMessage(a1.GetForeground(), a2.GetForeground()); diff != nil {
		a.Foreground = diff.(*bspb.BatteryStats_App_Foreground)
		changed = true
	}
	if diff := subtractAppApk(a1.GetApk(), a2.GetApk()); diff != nil {
		a.Apk = diff
		changed = true
	}
	if diff := subtractMessage(a1.GetBluetoothMisc(), a2.GetBluetoothMisc()); diff != nil {
		a.BluetoothMisc = diff.(*bspb.BatteryStats_App_BluetoothMisc)
		changed = true
	}
	if diff := subtractController(a1.GetBluetoothController(), a2.GetBluetoothController()); diff != nil {
		a.BluetoothController = diff
		changed = true
	}
	if diff := subtractController(a1.GetModemController(), a2.GetModemController()); diff != nil {
		a.ModemController = diff
		changed = true
	}
	if diff := subtractMessage(a1.GetNetwork(), a2.GetNetwork()); diff != nil {
		a.Network = diff.(*bspb.BatteryStats_App_Network)
		changed = true
	}
	if diff := subtractMessage(a1.GetPowerUseItem(), a2.GetPowerUseItem()); diff != nil {
		a.PowerUseItem = diff.(*bspb.BatteryStats_App_PowerUseItem)
		changed = true
	}
	if diff := subtractRepeatedMessage(a1.GetProcess(), a2.GetProcess()); !diff.IsNil() {
		a.Process = diff.Interface().([]*bspb.BatteryStats_App_Process)
		changed = true
	}
	if diff := subtractRepeatedMessage(a1.GetSensor(), a2.GetSensor()); !diff.IsNil() {
		a.Sensor = diff.Interface().([]*bspb.BatteryStats_App_Sensor)
		changed = true
	}
	if diff := subtractMessage(a1.GetStateTime(), a2.GetStateTime()); diff != nil {
		a.StateTime = diff.(*bspb.BatteryStats_App_StateTime)
		changed = true
	}
	if diff := subtractMessage(a1.GetVibrator(), a2.GetVibrator()); diff != nil {
		a.Vibrator = diff.(*bspb.BatteryStats_App_Vibrator)
		changed = true
	}
	if diff := subtractRepeatedMessage(a1.GetWakelock(), a2.GetWakelock()); !diff.IsNil() {
		a.Wakelock = diff.Interface().([]*bspb.BatteryStats_App_Wakelock)
		changed = true
	}
	if diff := subtractRepeatedMessage(a1.GetWakeupAlarm(), a2.GetWakeupAlarm()); !diff.IsNil() {
		a.WakeupAlarm = diff.Interface().([]*bspb.BatteryStats_App_WakeupAlarm)
		changed = true
	}
	if diff := subtractMessage(a1.GetWifi(), a2.GetWifi()); diff != nil {
		a.Wifi = diff.(*bspb.BatteryStats_App_Wifi)
		changed = true
	}
	if diff := subtractController(a1.GetWifiController(), a2.GetWifiController()); diff != nil {
		a.WifiController = diff
		changed = true
	}
	if diff := subtractRepeatedMessage(a1.GetSync(), a2.GetSync()); !diff.IsNil() {
		a.Sync = diff.Interface().([]*bspb.BatteryStats_App_Sync)
		changed = true
	}
	if diff := subtractRepeatedMessage(a1.GetUserActivity(), a2.GetUserActivity()); !diff.IsNil() {
		a.UserActivity = diff.Interface().([]*bspb.BatteryStats_App_UserActivity)
		changed = true
	}
	if diff := subtractRepeatedMessage(a1.GetScheduledJob(), a2.GetScheduledJob()); !diff.IsNil() {
		a.ScheduledJob = diff.Interface().([]*bspb.BatteryStats_App_ScheduledJob)
		changed = true
	}
	for _, c := range a1.GetChild() {
		if c2, ok := c2map[c.GetName()]; ok {
			if diff := subtractAppChild(c, c2); diff != nil {
				a.Child = append(a.Child, diff)
				changed = true
			}
			delete(c2map, c.GetName())
		} else {
			// Child doesn't exist in a2
			a.Child = append(a.Child, c)
			changed = true
		}
	}
	for _, c2 := range c2map {
		// These children aren't in a1
		a.Child = append(a.Child, c2)
		changed = true
	}
	// Subtract the head child
	h1 := a1.GetHeadChild()
	h2 := a2.GetHeadChild()
	if h1 != nil || h2 != nil {
		if h1 == nil {
			a.HeadChild = h2
			changed = true
		} else if h2 == nil {
			a.HeadChild = h1
			changed = true
		} else {
			if diff := subtractAppChild(a1.GetHeadChild(), a2.GetHeadChild()); diff != nil {
				a.HeadChild = diff
				changed = true
			}
		}
	}
	if !changed {
		return nil
	}
	return a
}

// subtractAppApk computes differences of "apk" in App. p2 will be subtracted from p1.
func subtractAppApk(p1, p2 *bspb.BatteryStats_App_Apk) *bspb.BatteryStats_App_Apk {
	d := &bspb.BatteryStats_App_Apk{}
	apkChanged := false
	// there's only one wakeups value per apk, compare wakeups separately
	if diffWakeups := p1.GetWakeups() - p2.GetWakeups(); diffWakeups != 0 {
		apkChanged = true
		d.Wakeups = proto.Float32(diffWakeups)
	}
	if diff := subtractRepeatedMessage(p1.GetService(), p2.GetService()); !diff.IsNil() {
		apkChanged = true
		d.Service = diff.Interface().([]*bspb.BatteryStats_App_Apk_Service)
	}
	if apkChanged {
		return d
	}
	return nil
}

// subtractAppChild computes differences of "child" in App.
// p2 will be subtracted from p1. Both children are expected to have the same name.
func subtractAppChild(p1, p2 *bspb.BatteryStats_App_Child) *bspb.BatteryStats_App_Child {
	if p1.GetName() != p2.GetName() {
		return nil
	}

	d := &bspb.BatteryStats_App_Child{
		Name:        p1.Name,
		VersionName: combineProtoStrings(p1.GetVersionName(), p2.GetVersionName(), connector),
		VersionCode: p1.VersionCode,
	}
	changed := p1.GetVersionCode() != p2.GetVersionCode() || p1.GetVersionName() != p2.GetVersionName()
	if diff := subtractAppApk(p1.GetApk(), p2.GetApk()); diff != nil {
		d.Apk = diff
		changed = true
	}
	if changed {
		return d
	}
	return nil
}

// subtractSystemBatteryLevel sets start level to the current level of the first proto.
func subtractSystemBatteryLevel(p1, p2 *bspb.BatteryStats_System_BatteryLevel) *bspb.BatteryStats_System_BatteryLevel {
	if p1 == nil && p2 == nil {
		return nil
	}
	if p2 == nil {
		return proto.Clone(p1).(*bspb.BatteryStats_System_BatteryLevel)
	}
	if p1 == nil {
		return proto.Clone(p2).(*bspb.BatteryStats_System_BatteryLevel)

	}
	d := &bspb.BatteryStats_System_BatteryLevel{}

	// CurrentLevel is set as the diff between the current level of the 2 protos.
	d.CurrentLevel = proto.Float32(p1.GetCurrentLevel() - p2.GetCurrentLevel())
	// Startlevel is set to the level of the first proto which is our main proto against which we want to diff the other one
	d.StartLevel = proto.Float32(p1.GetCurrentLevel())
	return d
}

func subtractController(c1, c2 *bspb.BatteryStats_ControllerActivity) *bspb.BatteryStats_ControllerActivity {
	if c2 == nil {
		return proto.Clone(c1).(*bspb.BatteryStats_ControllerActivity)
	}
	if c1 == nil {
		c1 = &bspb.BatteryStats_ControllerActivity{}
	}
	c := &bspb.BatteryStats_ControllerActivity{
		IdleTimeMsec: proto.Int64(c1.GetIdleTimeMsec() - c2.GetIdleTimeMsec()),
		RxTimeMsec:   proto.Int64(c1.GetRxTimeMsec() - c2.GetRxTimeMsec()),
		PowerMah:     proto.Int64(c1.GetPowerMah() - c2.GetPowerMah()),
	}
	changed := c.GetIdleTimeMsec() != 0 || c.GetRxTimeMsec() != 0 || c.GetPowerMah() != 0
	if diff := subtractRepeatedMessage(c1.GetTx(), c2.GetTx()); !diff.IsNil() {
		c.Tx = diff.Interface().([]*bspb.BatteryStats_ControllerActivity_TxLevel)
		changed = true
	}

	if changed {
		return c
	}
	return nil
}

// genericListOrDie converts an interface into a reflect.Value representation of it.
// Since this will be used with proto slices, an input of nil will return a generic
// proto.Message slice. This function will stop the program if the input is not an
// array or slice.
func genericListOrDie(v interface{}) reflect.Value {
	if v == nil {
		return reflect.ValueOf([]proto.Message{})
	}

	l := reflect.ValueOf(v)
	if vv, ok := v.(reflect.Value); ok {
		l = vv
	}

	if k := l.Kind(); k != reflect.Array && k != reflect.Slice {
		log.Fatalf("genericListOrDie: expected array or slice, found %s", k.String())
	}
	return l
}

// name returns the identifer of a struct value as a string.
// Caller of this function should only pass in a struct value whose
// first field is its identifier.
func name(v reflect.Value) string {
	n := v.Elem().Field(0).Elem()
	switch n.Kind() {
	case reflect.String:
		return n.String()
	case reflect.Int32:
		id := int(n.Int())
		return strconv.Itoa(id)
	default:
		log.Fatalf("cannot extract name from %s\n", n.Kind().String())
		return ""
	}
}

// subtractRepeatedMessage subtracts protos in list2 from the corresponding protos in list1.
// The input lists should only contain protos, and the protos should have their identifiers
// be their first field.
func subtractRepeatedMessage(list1, list2 interface{}) reflect.Value {
	if list1 == nil && list2 == nil {
		return reflect.ValueOf([]proto.Message{})
	}
	l1 := genericListOrDie(list1)
	if list2 == nil {
		return l1
	}
	l2 := genericListOrDie(list2)
	if list1 == nil {
		// Need to make negatives of the elements in list2, so can't just return here.
		l1 = reflect.MakeSlice(l2.Type(), 0, 0)
	}

	t1, t2 := l1.Type(), l2.Type()
	if t1 != t2 {
		log.Fatalf("Mismatched list types: %v vs %v", t1, t2)
	}

	// All entries may not occur in both files, so use maps to keep track of everything.
	m1, m2 := make(map[string]proto.Message), make(map[string]proto.Message)
	for i := 0; i < l1.Len(); i++ {
		item := l1.Index(i)
		m1[name(item)] = item.Interface().(proto.Message)
	}
	for i := 0; i < l2.Len(); i++ {
		item := l2.Index(i)
		m2[name(item)] = item.Interface().(proto.Message)
	}

	out := reflect.MakeSlice(t1, 0, l1.Len()+l2.Len())
	for n, p1 := range m1 {
		p2, ok := m2[n]
		if !ok {
			// In list1 but not list2.
			out = reflect.Append(out, reflect.ValueOf(p1))
			continue
		}
		if diff := subtractMessage(p1, p2); diff != nil {
			out = reflect.Append(out, reflect.ValueOf(diff))
		}
	}
	for n, p2 := range m2 {
		if _, ok := m1[n]; !ok {
			// In list2 but not list1. Subtract to get negative values.
			if diff := subtractMessage(nil, p2); diff != nil {
				out = reflect.Append(out, reflect.ValueOf(diff))
			}
		}
	}
	if out.Len() == 0 {
		return reflect.Zero(l1.Type())
	}
	return out
}

// subtractValue subtracts actual value of type float32. Nested data, like
// slice, pointer and struct should not use this function.
// string, int32 and int64 are taken as identifiers (should be
// consistent in both input values). We set output of these types
// to the value of the first input value.
//
// id indicates whether the type should be treated as an identifier.
//
// Returns (bool, bool) - (Is there a diff between the values, Is this value an identifier)
func subtractValue(out, in1, in2 reflect.Value, section string, id bool) (bool, bool) {
	switch in1.Kind() {
	case reflect.Float32:
		if id {
			if in1.Float() != 0 {
				out.Set(in1)
			} else {
				out.Set(in2)
			}
			return false, true
		}

		if roundToTwoDecimal(in1.Float()-in2.Float()) == 0 {
			// This takes care of -0 values which may be returned by roundToTwoDecimal.
			out.SetFloat(0)
			return false, false
		}
		out.SetFloat(in1.Float() - in2.Float())
		return true, false

	case reflect.String:
		if id {
			if in1.String() != "" {
				out.Set(in1)
			} else {
				out.Set(in2)
			}
			return false, true
		}
		if in1.String() == in2.String() {
			out.Set(in1)
			return false, false
		}
		s := combineProtoStrings(in1.String(), in2.String(), connector)
		out.SetString(*s)
		return true, false

	case reflect.Int32, reflect.Int64:
		if id {
			if in1.Int() != 0 {
				out.Set(in1)
			} else {
				out.Set(in2)
			}
			return false, true
		}
		if diff := in1.Int() - in2.Int(); diff != 0 {
			out.SetInt(diff)
			return true, false
		}
		out.SetInt(0)
		return false, false

	default:
		reportWarningf("subtracting %s type in %s not supported", in1.Kind().String(), section)
		out.Set(in1)
		return false, true
	}
}

// subtractStruct traverses a struct value and subtract each field
func subtractStruct(out, in1, in2 reflect.Value, ids map[int]bool) bool {
	if in1.NumField() != in2.NumField() {
		log.Fatalf("Tried to subtract two different struct types: %v vs %v", reflect.TypeOf(in1), reflect.TypeOf(in2))
	}

	changed := false
	for i := 0; i < in1.NumField(); i++ {
		if f := in1.Type().Field(i); strings.HasPrefix(f.Name, "XXX_") || f.PkgPath != "" {
			continue // skip XXX_ and unexported fields
		}
		// pointer to field i
		fieldPtrV1, fieldPtrV2 := in1.Field(i), in2.Field(i)
		if fieldPtrV1.IsNil() && fieldPtrV2.IsNil() {
			continue
		}
		// pointer to the change
		diffV := reflect.New(fieldPtrV1.Type().Elem())
		delta, isID := false, false
		if fieldPtrV1.IsNil() {
			// compare field value with zero value
			delta, isID = subtractValue(diffV.Elem(), reflect.Zero(fieldPtrV2.Elem().Type()), fieldPtrV2.Elem(), in2.String(), ids[i])
		} else if fieldPtrV2.IsNil() {
			// compare field value with zero value
			delta, isID = subtractValue(diffV.Elem(), fieldPtrV1.Elem(), reflect.Zero(fieldPtrV1.Elem().Type()), in1.String(), ids[i])
		} else {
			delta, isID = subtractValue(diffV.Elem(), fieldPtrV1.Elem(), fieldPtrV2.Elem(), in1.String(), ids[i])
		}
		if delta || isID {
			// only save the field in proto if there is a change or value serves as identifier
			out.Field(i).Set(diffV)
		}
		if delta {
			changed = true
		}
	}
	return changed
}

// subtractMessage subtracts two protos of the same type.
// This function cannot deal with nested protos.
func subtractMessage(p1, p2 proto.Message) proto.Message {
	if p1 == nil && p2 == nil {
		return nil
	}

	r1, r2 := reflect.TypeOf(p1), reflect.TypeOf(p2)
	if p1 != nil && p2 != nil && r1 != r2 {
		// Just....just don't.
		log.Fatalf("mismatched types: %v vs %v", r1, r2)
	}
	r := r1
	if p1 == nil {
		r = r2
	}
	in1 := reflect.ValueOf(p1)
	in2 := reflect.ValueOf(p2)
	if !in1.IsValid() || in1.IsNil() {
		// Initialize the first pointer, to compare in2 with zero value
		// of the same type.
		in1 = reflect.New(in2.Type().Elem())
	}
	if !in2.IsValid() || in2.IsNil() {
		// Initialize the second pointer, to compare in1 with zero value
		// of the same type.
		in2 = reflect.New(in1.Type().Elem())
	}
	out := reflect.New(in1.Type().Elem())
	// ID fields should not be diffed.
	changed := subtractStruct(out.Elem(), in1.Elem(), in2.Elem(), checkinparse.BatteryStatsIDMap[r])
	if !changed {
		return nil
	}
	return out.Interface().(proto.Message)
}

func reportWarningf(format string, a ...interface{}) {
	fmt.Printf(format, a...)
	fmt.Println()
}
