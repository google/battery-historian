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

package checkindelta

import (
	"errors"
	"math"
	"reflect"
	"strings"

	"github.com/golang/protobuf/proto"
	"github.com/google/battery-historian/checkinparse"
	bspb "github.com/google/battery-historian/pb/batterystats_proto"
)

// roundToTwoDecimal rounds off floats to 2 decimal places.
func roundToTwoDecimal(val float64) float64 {
	var roundedVal float64
	if val > 0 {
		roundedVal = math.Floor((val * 100) + .5)
	} else {
		roundedVal = math.Ceil((val * 100) - .5)
	}
	return roundedVal / 100
}

// NormalizeStats takes in a proto and normalizes it by converting
// any absolute value to value/TotalTime.
func NormalizeStats(p *bspb.BatteryStats) (*bspb.BatteryStats, error) {
	totalTimeHour := roundToTwoDecimal(float64((p.GetSystem().GetBattery().GetBatteryRealtimeMsec()) / (3600 * 1000)))

	if totalTimeHour == 0 {
		return nil, errors.New("battery real time cannot be 0")
	}
	normApp := &bspb.BatteryStats{
		ReportVersion:   p.ReportVersion,
		AggregationType: p.AggregationType,
	}

	// Normalize the app data
	for _, a1 := range p.GetApp() {
		a := normalizeApp(a1, totalTimeHour)
		normApp.App = append(normApp.App, a)
	}

	// Normalize system data
	s1 := p.GetSystem()
	s := &bspb.BatteryStats_System{}

	if norm := normalizeMessage(s1.GetBattery(), totalTimeHour); norm != nil {
		s.Battery = norm.(*bspb.BatteryStats_System_Battery)
	}
	if norm := normalizeMessage(s1.GetBatteryDischarge(), totalTimeHour); norm != nil {
		s.BatteryDischarge = norm.(*bspb.BatteryStats_System_BatteryDischarge)
	}
	s.BatteryLevel = s1.GetBatteryLevel()
	if norm := normalizeRepeatedMessage(s1.GetBluetoothState(), totalTimeHour); !norm.IsNil() {
		s.BluetoothState = norm.Interface().([]*bspb.BatteryStats_System_BluetoothState)
	}
	if norm := normalizeRepeatedMessage(s1.GetDataConnection(), totalTimeHour); !norm.IsNil() {
		s.DataConnection = norm.Interface().([]*bspb.BatteryStats_System_DataConnection)
	}
	if norm := normalizeMessage(s1.GetGlobalNetwork(), totalTimeHour); norm != nil {
		s.GlobalNetwork = norm.(*bspb.BatteryStats_System_GlobalNetwork)
	}
	if norm := normalizeRepeatedMessage(s1.GetKernelWakelock(), totalTimeHour); !norm.IsNil() {
		s.KernelWakelock = norm.Interface().([]*bspb.BatteryStats_System_KernelWakelock)
	}
	if norm := normalizeMessage(s1.GetMisc(), totalTimeHour); norm != nil {
		s.Misc = norm.(*bspb.BatteryStats_System_Misc)
	}
	if norm := normalizeRepeatedMessage(s1.GetPowerUseItem(), totalTimeHour); !norm.IsNil() {
		s.PowerUseItem = norm.Interface().([]*bspb.BatteryStats_System_PowerUseItem)
	}
	if norm := normalizeMessage(s1.GetPowerUseSummary(), totalTimeHour); norm != nil {
		s.PowerUseSummary = norm.(*bspb.BatteryStats_System_PowerUseSummary)
	}
	if norm := normalizeRepeatedMessage(s1.GetScreenBrightness(), totalTimeHour); !norm.IsNil() {
		s.ScreenBrightness = norm.Interface().([]*bspb.BatteryStats_System_ScreenBrightness)
	}
	if norm := normalizeMessage(s1.GetSignalScanningTime(), totalTimeHour); norm != nil {
		s.SignalScanningTime = norm.(*bspb.BatteryStats_System_SignalScanningTime)
	}
	if norm := normalizeRepeatedMessage(s1.GetSignalStrength(), totalTimeHour); !norm.IsNil() {
		s.SignalStrength = norm.Interface().([]*bspb.BatteryStats_System_SignalStrength)
	}
	if norm := normalizeRepeatedMessage(s1.GetWakeupReason(), totalTimeHour); !norm.IsNil() {
		s.WakeupReason = norm.Interface().([]*bspb.BatteryStats_System_WakeupReason)
	}
	if norm := normalizeRepeatedMessage(s1.GetWifiState(), totalTimeHour); !norm.IsNil() {
		s.WifiState = norm.Interface().([]*bspb.BatteryStats_System_WifiState)
	}
	if norm := normalizeRepeatedMessage(s1.GetWifiSupplicantState(), totalTimeHour); !norm.IsNil() {
		s.WifiSupplicantState = norm.Interface().([]*bspb.BatteryStats_System_WifiSupplicantState)
	}
	p.System = s
	p.App = normApp.App
	return p, nil
}

// Normalize app data
func normalizeApp(a *bspb.BatteryStats_App, totalTimeHour float64) *bspb.BatteryStats_App {
	if a == nil {
		return nil
	}
	res := proto.Clone(a).(*bspb.BatteryStats_App)

	if norm := normalizeMessage(a.GetForeground(), totalTimeHour); norm != nil {
		res.Foreground = norm.(*bspb.BatteryStats_App_Foreground)
	}
	if norm := normalizeAppApk(a.GetApk(), totalTimeHour); norm != nil {
		res.Apk = norm
	}
	normalizeAppChildren(res.GetChild(), totalTimeHour)
	if norm := normalizeMessage(a.GetNetwork(), totalTimeHour); norm != nil {
		res.Network = norm.(*bspb.BatteryStats_App_Network)
	}
	if norm := normalizeMessage(a.GetPowerUseItem(), totalTimeHour); norm != nil {
		res.PowerUseItem = norm.(*bspb.BatteryStats_App_PowerUseItem)
	}
	if norm := normalizeRepeatedMessage(a.GetProcess(), totalTimeHour).Interface(); norm != nil {
		res.Process = norm.([]*bspb.BatteryStats_App_Process)
	}
	if norm := normalizeRepeatedMessage(a.GetSensor(), totalTimeHour).Interface(); norm != nil {
		res.Sensor = norm.([]*bspb.BatteryStats_App_Sensor)
	}
	if norm := normalizeMessage(a.GetStateTime(), totalTimeHour); norm != nil {
		res.StateTime = norm.(*bspb.BatteryStats_App_StateTime)
	}
	if norm := normalizeMessage(a.GetVibrator(), totalTimeHour); norm != nil {
		res.Vibrator = norm.(*bspb.BatteryStats_App_Vibrator)
	}
	if norm := normalizeRepeatedMessage(a.GetWakelock(), totalTimeHour).Interface(); norm != nil {
		res.Wakelock = norm.([]*bspb.BatteryStats_App_Wakelock)
	}
	if norm := normalizeRepeatedMessage(a.GetWakeupAlarm(), totalTimeHour).Interface(); norm != nil {
		res.WakeupAlarm = norm.([]*bspb.BatteryStats_App_WakeupAlarm)
	}
	if norm := normalizeMessage(a.GetWifi(), totalTimeHour); norm != nil {
		res.Wifi = norm.(*bspb.BatteryStats_App_Wifi)
	}
	if norm := normalizeRepeatedMessage(a.GetUserActivity(), totalTimeHour).Interface(); norm != nil {
		res.UserActivity = norm.([]*bspb.BatteryStats_App_UserActivity)
	}
	if norm := normalizeRepeatedMessage(a.GetScheduledJob(), totalTimeHour).Interface(); norm != nil {
		res.ScheduledJob = norm.([]*bspb.BatteryStats_App_ScheduledJob)
	}
	return res
}

// normalizeAppApk normalizes values in the "apk" section of App.
func normalizeAppApk(p *bspb.BatteryStats_App_Apk, totalTimeHour float64) *bspb.BatteryStats_App_Apk {
	norm := &bspb.BatteryStats_App_Apk{}

	// there's only one wakeups value per apk
	norm.Wakeups = proto.Float32(float32(roundToTwoDecimal(float64(p.GetWakeups()) / totalTimeHour)))
	norm.Service = normalizeRepeatedMessage(p.GetService(), totalTimeHour).Interface().([]*bspb.BatteryStats_App_Apk_Service)
	return norm
}

// normalizeAppChildren normalizes values in the "child" section of App.
func normalizeAppChildren(children []*bspb.BatteryStats_App_Child, totalTimeHour float64) {
	for _, c := range children {
		c.Apk = normalizeAppApk(c.GetApk(), totalTimeHour)
	}
}

// normalizeRepeatedMessage loops over a repeated message value and calls normalizeMessage
// for each if the message.
func normalizeRepeatedMessage(list interface{}, totalTimeHour float64) reflect.Value {
	l := genericListOrDie(list)
	out := reflect.MakeSlice(l.Type(), 0, l.Len())
	for i := 0; i < l.Len(); i++ {
		item := l.Index(i)
		norm := normalizeMessage(item.Interface().(proto.Message), totalTimeHour)
		out = reflect.Append(out, reflect.ValueOf(norm))
	}
	if out.Len() == 0 {
		return reflect.Zero(l.Type())
	}
	return out
}

// normalizeMessage extracts the struct within the message and calls normalizeStruct
// to normalize the value contained.
func normalizeMessage(p proto.Message, totalTimeHour float64) proto.Message {
	in := reflect.ValueOf(p)
	if in.IsNil() {
		return nil
	}
	out := reflect.New(in.Type().Elem())
	normalizeStruct(out.Elem(), in.Elem(), totalTimeHour, checkinparse.BatteryStatsIDMap[reflect.TypeOf(p)])
	return out.Interface().(proto.Message)
}

// normalizeStruct traverses a struct value and normalizes each field
func normalizeStruct(out, in reflect.Value, totalTimeHour float64, ids map[int]bool) {
	for i := 0; i < in.NumField(); i++ {
		if f := in.Type().Field(i); strings.HasPrefix(f.Name, "XXX_") || f.PkgPath != "" {
			continue // skip XXX_ and unexported fields
		}
		fieldPtrV := in.Field(i)
		if fieldPtrV.IsNil() {
			continue
		}
		normV := reflect.New(fieldPtrV.Type().Elem())
		normalizeValue(normV.Elem(), fieldPtrV.Elem(), in.String(), totalTimeHour, ids[i])
		out.Field(i).Set(normV)
	}
}

// normalizeValue normalizes numerical values.
func normalizeValue(out, in reflect.Value, section string, totalTimeHour float64, id bool) {
	switch in.Kind() {
	case reflect.Float32, reflect.Float64:
		if id {
			out.Set(in)
		} else {
			out.SetFloat(roundToTwoDecimal(in.Float() / totalTimeHour))
		}
	case reflect.Int32, reflect.Int64:
		if id {
			out.Set(in)
		} else {
			// Some rounding error is okay for the integer fields.
			out.SetInt(int64(float64(in.Int()) / totalTimeHour))
		}
	case reflect.String:
		if !id {
			reportWarningf("Tried to normalize a string for %s", section)
		}
		out.Set(in)
	default:
		reportWarningf("Normalizing %s type in %s not supported", in.Kind().String(), section)
	}
}
