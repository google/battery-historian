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

package activity

import (
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/golang/protobuf/proto"
	usagepb "github.com/google/battery-historian/pb/usagestats_proto"
)

// TestParse tests the generation of CSV entries for activity manager events from the bug report event logs.
func TestParse(t *testing.T) {
	tests := []struct {
		desc                string
		input               []string
		pkgs                []*usagepb.PackageInfo
		wantCSV             []string
		wantGroupToLogStart map[string]int64
		wantWarnings        []string
		wantErrors          []error
	}{
		{
			desc: "Multple am_proc_start and am_proc_died events",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-09-15 09:51:29`,
				`========================================================`,
				``,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`09-15 09:29:25.370 29393 31443 I am_proc_start: [11,26187,1110007,com.google.android.gms.unstable,service,com.google.android.gms/.droidguard.DroidGuardService]`,
				`09-15 09:29:35.654 29393 30001 I am_proc_start: [11,26297,1110003,android.process.acore,broadcast,com.android.providers.contacts/.PackageIntentReceiver]`,
				`09-15 09:32:09.049 29393 30001 I am_proc_died: [11,26187,com.google.android.gms.unstable]`,
				`09-15 09:32:11.261 29393 31350 I am_proc_died: [11,26297,android.process.acore]`,
				``,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantCSV: []string{
				`Activity Manager Proc,service,1442334565370,1442334729049,26187~10007~com.google.android.gms.unstable~com.google.android.gms/.droidguard.DroidGuardService,10007`,
				`Activity Manager Proc,service,1442334575654,1442334731261,26297~10003~android.process.acore~com.android.providers.contacts/.PackageIntentReceiver,10003`,
			},
			wantGroupToLogStart: map[string]int64{
				"Activity Manager Proc": 1442334565370,
			},
		},

		{
			desc: "Different timezone",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-07-23 13:33:37`,
				`========================================================`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`07-23 12:57:40.883  1917  7187 I am_proc_start: [10,18230,1010068,com.google.android.apps.plus,broadcast,com.google.android.apps.plus/.service.PackagesMediaMonitor]`,
				`07-23 12:57:43.546  1917  7187 I am_proc_died: [10,18230,com.google.android.apps.plus]`,
				``,
				`[persist.sys.timezone]: [Europe/Dublin]`,
			},
			wantCSV: []string{
				`Activity Manager Proc,service,1437652660883,1437652663546,18230~10068~com.google.android.apps.plus~com.google.android.apps.plus/.service.PackagesMediaMonitor,10068`,
			},
			wantGroupToLogStart: map[string]int64{
				"Activity Manager Proc": 1437652660883,
			},
		},
		{
			desc: "am_proc_start with no corresponding am_proc_died",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-07-23 13:33:37`,
				`========================================================`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`07-23 12:57:40.883  1917  7187 I am_proc_start: [10,18230,1010068,com.google.android.apps.plus,broadcast,com.google.android.apps.plus/.service.PackagesMediaMonitor]`,
				``,
				`[persist.sys.timezone]: [Europe/Dublin]`,
			},
			wantCSV: []string{
				`Activity Manager Proc,service,1437652660883,0,18230~10068~com.google.android.apps.plus~com.google.android.apps.plus/.service.PackagesMediaMonitor,10068`,
			},
			wantGroupToLogStart: map[string]int64{
				"Activity Manager Proc": 1437652660883,
			},
		},
		{
			desc: "am_proc_died with no corresponding am_proc_start",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-07-23 13:33:37`,
				`========================================================`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`07-23 12:57:43.546  1917  7187 I am_proc_died: [10,18230,com.google.android.apps.plus]`,
				``,
				`[persist.sys.timezone]: [Europe/Dublin]`,
			},
			wantCSV: []string{
				`Activity Manager Proc,service,0,1437652663546,18230~~com.google.android.apps.plus~,`,
			},
			wantGroupToLogStart: map[string]int64{
				"Activity Manager Proc": 1437652663546,
			},
		},
		{
			desc: "am_low_memory event",
			input: []string{

				`========================================================`,
				`== dumpstate: 2015-01-27 13:10:19`,
				`========================================================`,
				`...`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`01-27 12:32:33.699   745   923 I am_low_memory: 20`,
				`01-27 12:32:33.702   745  1203 I force_gc: Binder`,
				`01-27 12:32:59.234   745  1290 I am_low_memory: 22`,
				`01-27 12:32:59.238  9074  9074 I force_gc: Binder`,
				`01-27 12:33:25.381   745   764 I am_low_memory: 23`,
				`01-27 12:33:25.386   745   745 I notification_cancel: [10007,28835,com.google.android.gms,10436,NULL,0,0,64,8,NULL]`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantCSV: []string{
				`AM Low Memory,service,1422390753699,1422390753699,20,`,
				`AM Low Memory,service,1422390779234,1422390779234,22,`,
				`AM Low Memory,service,1422390805381,1422390805381,23,`,
			},
			wantGroupToLogStart: map[string]int64{
				"AM Low Memory / ANR": 1422390753699,
			},
		},
		{
			desc: "am_anr event, some pkg info",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-09-27 21:04:31`,
				`========================================================`,
				`...`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`09-27 20:44:59.609   808   822 I am_anr  : [0,2103,com.google.android.gms,-1194836283,executing service com.google.android.gms/.reminders.service.RemindersIntentService]`,
				`09-27 20:47:08.686   808   822 I am_anr  : [0,3503,com.google.android.gms,-1194836283,Broadcast of Intent { act=android.net.conn.CONNECTIVITY_CHANGE flg=0x4000010 cmp=com.google.android.gms/.kids.chimera.SystemEventReceiverProxy (has extras) }]`,
				`09-27 20:47:08.686   808   822 I am_anr  : [0,3503,com.google.android.apps.photos,-1194836283,Broadcast/stuff]`,
				`09-27 20:47:08.704   808  1737 I am_proc_bound: [0,3555,com.google.android.apps.photos]`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			pkgs: []*usagepb.PackageInfo{
				{PkgName: proto.String("com.google.android.apps.photos"), Uid: proto.Int32(1)},
			},
			wantCSV: []string{
				`ANR,service,1443411899609,1443411899609,2103~com.google.android.gms~-1194836283~executing service com.google.android.gms/.reminders.service.RemindersIntentService~,`,
				`ANR,service,1443412028686,1443412028686,3503~com.google.android.gms~-1194836283~Broadcast of Intent { act=android.net.conn.CONNECTIVITY_CHANGE flg=0x4000010 cmp=com.google.android.gms/.kids.chimera.SystemEventReceiverProxy (has extras) }~,`,
				`ANR,service,1443412028686,1443412028686,3503~com.google.android.apps.photos~-1194836283~Broadcast/stuff~1,`,
			},
			wantGroupToLogStart: map[string]int64{
				"AM Low Memory / ANR": 1443411899609,
			},
		},
		{
			desc: "Year rolls over, event in previous year",
			input: []string{

				`========================================================`,
				`== dumpstate: 2016-01-01 21:04:31`,
				`========================================================`,
				`...`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`12-31 20:44:59.609   808   822 I am_anr  : [0,2103,com.google.android.gms,-1194836283,reason]`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantCSV: []string{
				`ANR,service,1451623499609,1451623499609,2103~com.google.android.gms~-1194836283~reason~,`,
			},
			wantGroupToLogStart: map[string]int64{
				"AM Low Memory / ANR": 1451623499609,
			},
		},
		{
			desc: "Year rolls over, event matches new year",
			input: []string{

				`========================================================`,
				`== dumpstate: 2016-01-01 21:04:31`,
				`========================================================`,
				`...`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`01-01 20:44:59.609   808   822 I am_anr  : [0,2103,com.google.android.gms,-1194836283,reason]`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantCSV: []string{
				`ANR,service,1451709899609,1451709899609,2103~com.google.android.gms~-1194836283~reason~,`,
			},
			wantGroupToLogStart: map[string]int64{
				"AM Low Memory / ANR": 1451709899609,
			},
		},
		{
			desc: "Last event after dumpstate time",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-10-20 09:34:16`,
				`========================================================`,
				`...`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`10-20 09:35:23.423  4649  6636 I am_low_memory: 37`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantCSV: []string{
				`AM Low Memory,service,1445358923423,1445358923423,37,`,
			},
			wantGroupToLogStart: map[string]int64{
				"AM Low Memory / ANR": 1445358923423,
			},
		},
		{
			desc: "Event starts and ends in different years",
			input: []string{

				`========================================================`,
				`== dumpstate: 2016-01-01 21:04:31`,
				`========================================================`,
				`...`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`12-31 21:29:25.370 29393 31443 I am_proc_start: [11,26187,1110007,com.google.android.gms.unstable,service,com.google.android.gms/.droidguard.DroidGuardService]`,
				`01-01 20:44:59.609 29393 30001 I am_proc_died: [11,26187,com.google.android.gms.unstable]`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantCSV: []string{
				`Activity Manager Proc,service,1451626165370,1451709899609,26187~10007~com.google.android.gms.unstable~com.google.android.gms/.droidguard.DroidGuardService,10007`,
			},
			wantGroupToLogStart: map[string]int64{
				"Activity Manager Proc": 1451626165370,
			},
		},
		{
			desc: "am_proc_start and am_proc_died warnings and errors",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-09-15 09:51:29`,
				`========================================================`,
				``,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`09-15 09:29:25.370 29393 31443 I am_proc_start: [26187,1110007,com.google.android.gms.unstable,service,com.google.android.gms/.droidguard.DroidGuardService]`,
				`09-15 09:29:35.654 29393 30001 I am_proc_start: [11,26297,1110003,android.process.acore,broadcast,com.android.providers.contacts/.PackageIntentReceiver,Newfield]`,
				`09-15 09:32:09.049 29393 30001 I am_proc_died: [11,com.google.android.gms.unstable]`,
				`09-15 09:32:11.261 29393 31350 I am_proc_died: [11,26297,android.process.acore,new]`,
				``,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantCSV: []string{
				`Activity Manager Proc,service,1442334575654,1442334731261,26297~10003~android.process.acore~com.android.providers.contacts/.PackageIntentReceiver,10003`,
			},
			wantGroupToLogStart: map[string]int64{
				"Activity Manager Proc": 1442334565370,
			},
			wantWarnings: []string{
				"am_proc_start: got 7 parts, expected 6",
				"am_proc_died: got 4 parts, expected 3",
			},
			wantErrors: []error{
				errors.New("am_proc_start: got 5 parts, want 6"),
				errors.New("am_proc_died: got 2 parts, want 3"),
			},
		},
		{
			desc: "am_anr warnings and errors",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-09-27 21:04:31`,
				`========================================================`,
				`...`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`09-27 20:44:59.609   808   822 I am_anr  : [0,2103,com.google.android.gms,-1194836283,executing service com.google.android.gms/.reminders.service.RemindersIntentService,extrafield]`,
				`09-27 20:47:08.686   808   822 I am_anr  : [com.google.android.gms,-1194836283,Broadcast of Intent { act=android.net.conn.CONNECTIVITY_CHANGE flg=0x4000010 cmp=com.google.android.gms/.kids.chimera.SystemEventReceiverProxy (has extras) }]`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantCSV: []string{
				`ANR,service,1443411899609,1443411899609,2103~com.google.android.gms~-1194836283~executing service com.google.android.gms/.reminders.service.RemindersIntentService~,`,
			},
			wantGroupToLogStart: map[string]int64{
				"AM Low Memory / ANR": 1443411899609,
			},
			wantWarnings: []string{
				"am_anr: got 6 parts, expected 5",
			},
			wantErrors: []error{
				errors.New("am_anr: got 3 parts, want 5"),
			},
		},
		{
			desc: "Crashes, volta pkg info provided, no pkg info for vending",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-08-06 15:30:45`,
				`========================================================`,
				`...`,
				`------ SYSTEM LOG (logcat -v threadtime -d *:v) ------`,
				`------ SYSTEM LOG (logcat -v threadtime -d *:v) ------`,
				`08-05 22:58:11.751 10686 10707 E AndroidRuntime: FATAL EXCEPTION: AsyncTask #1`,
				`08-05 22:58:11.751 10686 10707 E AndroidRuntime: Process: com.google.android.volta, PID: 10686`,
				`08-05 22:58:11.751 10686 10707 E AndroidRuntime: java.lang.RuntimeException: An error occured while executing doInBackground()`,
				`08-05 22:58:11.751 10686 10707 E AndroidRuntime:        at android.os.AsyncTask$3.done(AsyncTask.java:304)`,
				`08-06 00:35:50.774 23682 23801 E AndroidRuntime: FATAL EXCEPTION: AsyncTask #2`,
				`08-06 00:35:50.774 23682 23801 E AndroidRuntime: Process: com.google.android.volta, PID: 23682`,
				`08-06 00:35:50.774 23682 23801 E AndroidRuntime: java.lang.RuntimeException: An error occured while executing doInBackground()`,
				`08-06 00:35:50.774 23682 23801 E AndroidRuntime:        at android.os.AsyncTask$3.done(AsyncTask.java:304)`,
				`08-06 00:35:50.774 23682 23801 E AndroidRuntime:        at java.util.concurrent.FutureTask.finishCompletion(FutureTask.java:355)`,
				`08-06 00:35:50.774 20440 20440 E AndroidRuntime: FATAL EXCEPTION: main`,
				`08-06 00:35:50.774 20440 20440 E AndroidRuntime: Process: com.android.vending, PID: 20440`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			pkgs: []*usagepb.PackageInfo{
				{PkgName: proto.String("com.google.android.volta"), Uid: proto.Int32(1)},
			},
			wantCSV: []string{
				`Crashes,service,1438840691751,1438840691751,com.google.android.volta: AsyncTask #1,1`,
				`Crashes,service,1438846550774,1438846550774,com.google.android.volta: AsyncTask #2,1`,
				`Crashes,service,1438846550774,1438846550774,com.android.vending: main,`,
			},
			wantGroupToLogStart: map[string]int64{
				"Crashes": 1438840691751,
			},
		},
		{
			desc: "Bluetooth scans, some PID mappings and pkg info",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-11-05 06:30:29`,
				`========================================================`,
				`...`,
				`------ SYSTEM LOG (logcat -v threadtime -d *:v) ------`,
				`11-05 06:19:14.095  1691  5180 D BluetoothAdapter: startLeScan(): null`,
				`11-05 06:19:15.815  1691  5180 D BluetoothAdapter: startLeScan(): null`,
				`11-05 06:20:10.417 17745 17745 D BluetoothAdapter: startLeScan(): null`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  PID mappings:`,
				`    PID #784: ProcessRecord{b2760e2 784:system/1000}`,
				`    PID #17745: ProcessRecord{4fe996a 17745:gbis.gbandroid/u0a105}`,
			},
			wantCSV: []string{
				`Bluetooth Scan,service,1446733154095,1446733154095,Unknown PID 1691 (PID: 1691),`,
				`Bluetooth Scan,service,1446733155815,1446733155815,Unknown PID 1691 (PID: 1691),`,
				`Bluetooth Scan,service,1446733210417,1446733210417,gbis.gbandroid (PID: 17745),10105`,
			},
			wantGroupToLogStart: map[string]int64{
				"Bluetooth Scan": 1446733154095,
			},
		},
		{
			desc: "Event log, system log and bug report taken events",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-11-05 06:30:29`,
				`========================================================`,
				`...`,
				`------ SYSTEM LOG (logcat -v threadtime -d *:v) ------`,
				`11-05 04:20:57.356   175   175 I Vold    : Vold 2.1 (the revenge) firing up`, // Random event providing system log start time.
				`11-05 06:19:14.095  1691  5180 D BluetoothAdapter: startLeScan(): null`,
				`...`,
				`11-05 06:29:35.969  9662  9662 I dumpstate: begin`,
				`...`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`11-04 21:19:09.047  2236  2236 I notification_cancel: `, // Random event providing event log start time.
				`11-05 06:15:21.609   808   822 I am_anr  : [0,2103,com.google.android.gms,-1194836283,executing service com.google.android.gms/.reminders.service.RemindersIntentService]`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  PID mappings:`,
				`    PID #784: ProcessRecord{b2760e2 784:system/1000}`,
				`    PID #17745: ProcessRecord{4fe996a 17745:gbis.gbandroid/u0a105}`,
			},
			wantCSV: []string{
				`Bluetooth Scan,service,1446733154095,1446733154095,Unknown PID 1691 (PID: 1691),`,
				`ANR,service,1446732921609,1446732921609,2103~com.google.android.gms~-1194836283~executing service com.google.android.gms/.reminders.service.RemindersIntentService~,`,
				`Logcat misc,string,1446733775969,1446733775969,bug report collection triggered,`,
			},
			wantGroupToLogStart: map[string]int64{
				"AM Low Memory / ANR": 1446700749047,
				"Bluetooth Scan":      1446726057356,
				"Logcat misc":         1446726057356,
			},
		},
		{
			desc: "am_proc_start appears in multiple logs",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-09-15 09:51:29`,
				`========================================================`,
				``,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`09-15 09:25:50.539  3970 29436 I Calendar   : enqueueAttachment attachmentId: 10827`,
				`09-15 09:29:25.370 29393 31443 I am_proc_start: [11,26187,1110007,com.google.android.gms.unstable,service,com.google.android.gms/.droidguard.DroidGuardService]`,
				``,
				`------ LAST LOGCAT (logcat -L -v threadtime -b all -d *:v) ------`,
				`09-15 09:19:50.539  3970 29436 I Gmail   : enqueueAttachment attachmentId: 10827`,
				`09-15 09:29:35.654 29393 30001 I am_proc_start: [11,26297,1110003,android.process.acore,broadcast,com.android.providers.contacts/.PackageIntentReceiver]`,
				``,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantCSV: []string{
				`Activity Manager Proc,service,1442334565370,0,26187~10007~com.google.android.gms.unstable~com.google.android.gms/.droidguard.DroidGuardService,10007`,
				`Activity Manager Proc,service,1442334575654,0,26297~10003~android.process.acore~com.android.providers.contacts/.PackageIntentReceiver,10003`,
			},
			wantGroupToLogStart: map[string]int64{
				"Activity Manager Proc": 1442333990539,
			},
		},
		{
			desc: "log timestamps out of order",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-09-15 09:51:29`,
				`========================================================`,
				``,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`09-15 09:30:50.539  3970 29436 I Calendar   : enqueueAttachment attachmentId: 10827`,
				`09-15 09:29:25.370 29393 31443 I am_proc_start: [11,26187,1110007,com.google.android.gms.unstable,service,com.google.android.gms/.droidguard.DroidGuardService]`,
				``,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantCSV: []string{
				`Activity Manager Proc,service,1442334565370,0,26187~10007~com.google.android.gms.unstable~com.google.android.gms/.droidguard.DroidGuardService,10007`,
			},
			wantGroupToLogStart: map[string]int64{
				"Activity Manager Proc": 1442334565370,
			},
			wantErrors: []error{
				fmt.Errorf("expect log timestamps in sorted order, got section start: 1442334650539, event timestamp: 1442334565370"),
			},
		},
	}
	for _, test := range tests {
		output := Parse(test.pkgs, strings.Join(test.input, "\n"))

		got := normalizeCSV(output.CSV)
		want := normalizeCSV(strings.Join(test.wantCSV, "\n"))
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: Parse(%v)\n outputted csv = %v\n want: %v", test.desc, test.input, strings.Join(got, "\n"), strings.Join(want, "\n"))
		}
		if !reflect.DeepEqual(output.Errs, test.wantErrors) {
			t.Errorf("%v: Parse(%v)\n unexpected errors = %v\n want: %v", test.desc, test.input, output.Errs, test.wantErrors)
		}
		if !reflect.DeepEqual(output.Warnings, test.wantWarnings) {
			t.Errorf("%v: Parse(%v)\n unexpected warnings = %v\n want: %v", test.desc, test.input, output.Warnings, test.wantWarnings)
		}
		if !reflect.DeepEqual(output.GroupToLogStart, test.wantGroupToLogStart) {
			t.Errorf("%v: Parse(%v)\n outputted group log time map = %v\n want: %v", test.desc, test.input, output.GroupToLogStart, test.wantGroupToLogStart)
		}
	}
}

// Removes trailing space at the end of the string, then splits by new line and sorts alphabetically.
func normalizeCSV(text string) []string {
	strs := strings.Split(strings.TrimSpace(text), "\n")
	// Order of outputted CSV does not matter and order may vary due to iteration of maps in printing the CSV.
	sort.Strings(strs)
	return strs
}
