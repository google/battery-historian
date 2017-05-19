// Copyright 2017 Google Inc. All Rights Reserved.
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

package broadcasts

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/google/battery-historian/csv"
)

// TestParse tests the generation of CSV entries for broadcast events.
func TestParse(t *testing.T) {
	tests := []struct {
		desc  string
		input []string

		wantCSV  string
		wantErrs []error
	}{
		{
			desc: "Historical broadcast summary events",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-09-27 16:27:41`,
				`========================================================`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  Historical broadcasts summary [foreground]:`,
				`  #0: act=com.google.android.c2dm.intent.RECEIVE flg=0x10000010 pkg=com.google.android.gms (has extras)`,
				`    +379ms dispatch +43ms finish`,
				`    enq=2016-09-27 16:28:54 disp=2016-09-27 16:28:54 fin=2016-09-27 16:28:54`,
				`    extras: Bundle[mParcelledData.dataSize=340]`,
				`  #1: act=com.google.android.c2dm.intent.RECEIVE flg=0x10000010 pkg=com.Slack (has extras)`,
				`    0 dispatch +1s264ms finish`,
				`    enq=2016-09-27 16:28:53 disp=2016-09-27 16:28:53 fin=2016-09-27 16:28:54`,
				`    extras: Bundle[mParcelledData.dataSize=6476]`,
				``,
				`  Historical broadcasts summary [background]:`,
				`  #0: act=com.google.android.c2dm.intent.RECEIVE flg=0x10 pkg=com.Slack (has extras)`,
				`    +473ms dispatch +767ms finish`,
				`    enq=2016-09-27 16:28:53 disp=2016-09-27 16:28:54 fin=2016-09-27 16:28:54`,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Broadcast Enqueue (foreground),string,1475018934000,1475018934379,0,`,
				`Broadcast Dispatch (foreground),string,1475018934379,1475018934422,0,`,
				`Broadcast Enqueue (foreground),string,1475018933000,1475018933000,1,`,
				`Broadcast Dispatch (foreground),string,1475018933000,1475018934264,1,`,
				`Broadcast Enqueue (background),string,1475018933000,1475018933473,0,`,
				`Broadcast Dispatch (background),string,1475018933473,1475018934240,0,`,
			}, "\n"),
		},
		{
			desc: "Historical broadcast summary events - some missing log lines",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-09-27 16:27:41`,
				`========================================================`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  Historical broadcasts summary [foreground]:`,
				`  #0: act=com.google.android.c2dm.intent.RECEIVE flg=0x10000010 pkg=com.google.android.gms (has extras)`,
				`    enq=2016-09-27 16:28:54 disp=2016-09-27 16:28:54 fin=2016-09-27 16:28:54`,
				`    extras: Bundle[mParcelledData.dataSize=340]`,
				`  #1: act=com.google.android.c2dm.intent.RECEIVE flg=0x10000010 pkg=com.Slack (has extras)`,
				`    0 dispatch +1s264ms finish`,
				`    enq=2016-09-27 16:28:53 disp=2016-09-27 16:28:53 fin=2016-09-27 16:28:54`,
				`    extras: Bundle[mParcelledData.dataSize=6476]`,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Broadcast Enqueue (foreground),string,1475018933000,1475018933000,1,`,
				`Broadcast Dispatch (foreground),string,1475018933000,1475018934264,1,`,
			}, "\n"),
			wantErrs: []error{errors.New("#0: missing dispatch and finish offsets")},
		},
		{
			desc: "Historical broadcast summary events - invalid offset",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-09-16 16:27:41`,
				`========================================================`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  Historical broadcasts summary [foreground]:`,
				`  #141: act=com.google.android.awareness.geofence.receiver flg=0x10 (has extras)`,
				`   -17060d15h40m33s520ms dispatch +17060d15h41m6s201ms finish`,
				`   enq=2016-09-16 08:40:33 disp=1969-12-31 16:00:00 fin=2016-09-16 08:41:06`,
				`   extras: Bundle[mParcelledData.dataSize=696]`,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
			}, "\n"),
			wantErrs: []error{errors.New("#141: negative offset")},
		},
		{
			desc: "Historical broadcast summary events with UID information",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-10-01 15:49:08`,
				`========================================================`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  Historical broadcasts [foreground]:`,
				`  Historical Broadcast foreground #0:`,
				`    BroadcastRecord{46c2166 u0 android.intent.action.BUGREPORT_STARTED} to user 0`,
				`    Intent { act=android.intent.action.BUGREPORT_STARTED flg=0x10000010 (has extras) }`,
				`      extras: Bundle[mParcelledData.dataSize=296]`,
				`    caller=null null pid=14751 uid=2000`,
				`    requiredPermissions=[android.permission.DUMP]  appOp=-1`,
				`    enqueueClockTime=2016-10-01 15:49:09 dispatchClockTime=2016-10-01 15:49:09`,
				`    dispatchTime=-20s976ms (0 since enq) finishTime=-20s968ms (+8ms since disp)`,
				`  Historical Broadcast foreground #1:`,
				`    BroadcastRecord{f1b7ca7 u-1 android.intent.action.CLOSE_SYSTEM_DIALOGS} to user -1`,
				`    Intent { act=android.intent.action.CLOSE_SYSTEM_DIALOGS flg=0x50000010 (has extras) }`,
				`      extras: Bundle[{reason=globalactions}]`,
				`    caller=null null pid=-1 uid=1000`,
				`    enqueueClockTime=2016-10-01 15:49:06 dispatchClockTime=2016-10-01 15:49:06`,
				`    dispatchTime=-24s357ms (0 since enq) finishTime=-24s355ms (+2ms since disp)`,
				``,
				`  Historical broadcasts summary [foreground]:`,
				`  #0: act=android.intent.action.BUGREPORT_STARTED flg=0x10000010 (has extras)`,
				`    0 dispatch +9ms finish`,
				`    enq=2016-10-01 15:49:09 disp=2016-10-01 15:49:09 fin=2016-10-01 15:49:09`,
				`    extras: Bundle[mParcelledData.dataSize=296]`,
				`  #1: act=android.intent.action.CLOSE_SYSTEM_DIALOGS flg=0x50000010 (has extras)`,
				`    0 dispatch +2ms finish`,
				`    enq=2016-10-01 15:49:06 disp=2016-10-01 15:49:06 fin=2016-10-01 15:49:06`,
				`    extras: Bundle[{reason=globalactions}]`,
				``,
				`  Historical broadcasts [background]:`,
				`  Historical Broadcast background #0:`,
				`    BroadcastRecord{293f0bb u0 android.intent.action.MEDIA_SCANNER_SCAN_FILE} to user 0`,
				`    Intent { act=android.intent.action.MEDIA_SCANNER_SCAN_FILE dat=file:///data/user_de/0/com.android.shell/files/bugreports/screenshot-14750-1.png flg=0x10 }`,
				`    caller=null null pid=14794 uid=5000`,
				`    enqueueClockTime=2016-10-01 15:49:18 dispatchClockTime=2016-10-01 15:49:18`,
				`    dispatchTime=-12s372ms (0 since enq) finishTime=-12s228ms (+144ms since disp)`,
				``,
				`  Historical broadcasts summary [background]:`,
				`  #0: act=android.intent.action.MEDIA_SCANNER_SCAN_FILE dat=file:///data/user_de/0/com.android.shell/files/bugreports/screenshot-14750-1.png flg=0x10`,
				`    0 dispatch +145ms finish`,
				`    enq=2016-10-01 15:49:18 disp=2016-10-01 15:49:18 fin=2016-10-01 15:49:18`,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Broadcast Enqueue (foreground),string,1475362149000,1475362149000,0,2000`,
				`Broadcast Dispatch (foreground),string,1475362149000,1475362149009,0,2000`,
				`Broadcast Enqueue (foreground),string,1475362146000,1475362146000,1,1000`,
				`Broadcast Dispatch (foreground),string,1475362146000,1475362146002,1,1000`,
				`Broadcast Enqueue (background),string,1475362158000,1475362158000,0,5000`,
				`Broadcast Dispatch (background),string,1475362158000,1475362158145,0,5000`,
			}, "\n"),
		},
		{
			desc: "Historical broadcast summary events with missing UIDss",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-10-01 15:49:08`,
				`========================================================`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  Historical broadcasts [foreground]:`,
				`  Historical Broadcast foreground #0:`,
				`    BroadcastRecord{46c2166 u0 android.intent.action.BUGREPORT_STARTED} to user 0`,
				`    Intent { act=android.intent.action.BUGREPORT_STARTED flg=0x10000010 (has extras) }`,
				`      extras: Bundle[mParcelledData.dataSize=296]`,
				`  Historical Broadcast foreground #1:`,
				`    BroadcastRecord{f1b7ca7 u-1 android.intent.action.CLOSE_SYSTEM_DIALOGS} to user -1`,
				`    Intent { act=android.intent.action.CLOSE_SYSTEM_DIALOGS flg=0x50000010 (has extras) }`,
				`      extras: Bundle[{reason=globalactions}]`,
				``,
				`  Historical broadcasts summary [foreground]:`,
				`  #0: act=android.intent.action.BUGREPORT_STARTED flg=0x10000010 (has extras)`,
				`    0 dispatch +9ms finish`,
				`    enq=2016-10-01 15:49:09 disp=2016-10-01 15:49:09 fin=2016-10-01 15:49:09`,
				`    extras: Bundle[mParcelledData.dataSize=296]`,
				`  #1: act=android.intent.action.CLOSE_SYSTEM_DIALOGS flg=0x50000010 (has extras)`,
				`    0 dispatch +2ms finish`,
				`    enq=2016-10-01 15:49:06 disp=2016-10-01 15:49:06 fin=2016-10-01 15:49:06`,
				`    extras: Bundle[{reason=globalactions}]`,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Broadcast Enqueue (foreground),string,1475362149000,1475362149000,0,`,
				`Broadcast Dispatch (foreground),string,1475362149000,1475362149009,0,`,
				`Broadcast Enqueue (foreground),string,1475362146000,1475362146000,1,`,
				`Broadcast Dispatch (foreground),string,1475362146000,1475362146002,1,`,
			}, "\n"),
			wantErrs: []error{
				errors.New("#0 (foreground): full historical broadcast info missing UID"),
				errors.New("#1 (foreground): full historical broadcast info missing UID"),
			},
		},
		{
			desc: "Historical broadcast summary events - massive offset",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-09-16 16:27:41`,
				`========================================================`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  Historical broadcasts summary [foreground]:`,
				`  #141: act=com.google.android.awareness.geofence.receiver flg=0x10 (has extras)`,
				`   +366d3h19m27s100ms dispatch 0 finish`,
				`   enq=2016-09-16 08:40:33 disp=2017-09-16 12:00:00 fin=2017-09-16 12:00:00 `,
				`   extras: Bundle[mParcelledData.dataSize=696]`,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
			}, "\n"),
			wantErrs: []error{errors.New("#141: offset is too large")},
		},
		{
			desc: "Active broadcast events",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-09-27 14:35:25`,
				`========================================================`,

				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  Active ordered broadcasts [foreground]:`,
				`  Active Ordered Broadcast foreground #0:`,
				`    BroadcastRecord{3e57e94 u-1 android.intent.action.SCREEN_OFF} to user -1`,
				`    Intent { act=android.intent.action.SCREEN_OFF flg=0x50000010 }`,
				`    caller=android 7469:system/1000 pid=7469 uid=1000`,
				`    enqueueClockTime=2016-09-27 14:33:16 dispatchClockTime=2016-09-27 14:33:24`,
				`    dispatchTime=-- (+8s3ms since enq) receiverTime=--`,
				``,
				`  Active ordered broadcasts [background]:`,
				`  Active Ordered Broadcast background #5:`,
				`    BroadcastRecord{3868621 u-1 android.net.conn.DATA_ACTIVITY_CHANGE} to user -1`,
				`    Intent { act=android.net.conn.DATA_ACTIVITY_CHANGE flg=0x10 (has extras) }`,
				`      extras: Bundle[{tsNanos=701265365120394, isActive=true, deviceType=0}]`,
				`    caller=android 4546:system/1000 pid=4546 uid=1000`,
				`    requiredPermissions=[android.permission.RECEIVE_DATA_ACTIVITY_CHANGE]  appOp=-1`,
				`    enqueueClockTime=2016-09-27 14:36:16 dispatchClockTime=1969-12-31 16:00:00`,
				`    dispatchTime=-- (-17071d21h36m16s749ms since enq) receiverTime=--`,
				`    resultTo=null resultCode=0 resultData=null`,
				`    resultAbort=false ordered=true sticky=false initialSticky=false`,
				`    Pending #0: BroadcastFilter{5d9d464 u0 ReceiverList{5a43df7 13038 com.google.android.gms.persistent/10013/u0 remote:4a4d5f6}}`,
				`  Active Ordered Broadcast background #4:`,
				`    BroadcastRecord{bab5a46 u-1 android.net.conn.CONNECTIVITY_CHANGE} to user -1`,
				`    Intent { act=android.net.conn.CONNECTIVITY_CHANGE flg=0x4000010 (has extras) }`,
				`      extras: Bundle[{networkInfo=[type: WIFI[], state: DISCONNECTED/DISCONNECTED, reason: (unspecified), extra: <unknown ssid>, failover: false, available: true, roaming: false, metered: false], networkType=1, $`,
				`    caller=android 4546:system/1000 pid=4546 uid=2000`,
				`    options=Bundle[{android:broadcast.maxManifestReceiverApiLevel=23}]`,
				`    enqueueClockTime=2016-09-27 14:36:16 dispatchClockTime=1969-12-31 16:00:00`,
				`    dispatchTime=-- (-17071d21h36m16s694ms since enq) receiverTime=--`,
				`    resultAbort=false ordered=false sticky=true initialSticky=false`,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Active Broadcast (foreground),string,1475011996000,1475012004003,0,1000`,
				`Active Broadcast (background),string,1475012176000,-1,5,1000`,
				`Active Broadcast (background),string,1475012176000,-1,4,2000`,
			}, "\n"),
		},
		{
			desc: "Active broadcast events - #5 is missing enqueue clock time",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-09-27 14:35:25`,
				`========================================================`,

				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  Active ordered broadcasts [background]:`,
				`  Active Ordered Broadcast background #5:`,
				`    BroadcastRecord{3868621 u-1 android.net.conn.DATA_ACTIVITY_CHANGE} to user -1`,
				`    Intent { act=android.net.conn.DATA_ACTIVITY_CHANGE flg=0x10 (has extras) }`,
				`      extras: Bundle[{tsNanos=701265365120394, isActive=true, deviceType=0}]`,
				`    caller=android 4546:system/1000 pid=4546 uid=12000`,
				`    requiredPermissions=[android.permission.RECEIVE_DATA_ACTIVITY_CHANGE]  appOp=-1`,
				`    resultTo=null resultCode=0 resultData=null`,
				`    resultAbort=false ordered=true sticky=false initialSticky=false`,
				`    Pending #0: BroadcastFilter{5d9d464 u0 ReceiverList{5a43df7 13038 com.google.android.gms.persistent/10013/u0 remote:4a4d5f6}}`,
				`  Active Ordered Broadcast background #4:`,
				`    BroadcastRecord{bab5a46 u-1 android.net.conn.CONNECTIVITY_CHANGE} to user -1`,
				`    Intent { act=android.net.conn.CONNECTIVITY_CHANGE flg=0x4000010 (has extras) }`,
				`      extras: Bundle[{networkInfo=[type: WIFI[], state: DISCONNECTED/DISCONNECTED, reason: (unspecified), extra: <unknown ssid>, failover: false, available: true, roaming: false, metered: false], networkType=1, $`,
				`    caller=android 4546:system/1000 pid=4546 uid=13000`,
				`    options=Bundle[{android:broadcast.maxManifestReceiverApiLevel=23}]`,
				`    enqueueClockTime=2016-09-27 14:36:16 dispatchClockTime=1969-12-31 16:00:00`,
				`    dispatchTime=-- (-17071d21h36m16s694ms since enq) receiverTime=--`,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Active Broadcast (background),string,1475012176000,-1,4,13000`,
			}, "\n"),
			wantErrs: []error{errors.New("#5: missing broadcast enqueue timestamp")},
		},
		{
			desc: "Active broadcast events - #1 is missing dispatch offset",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-09-27 14:35:25`,
				`========================================================`,

				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  Active ordered broadcasts [foreground]:`,
				`  Active Ordered Broadcast foreground #2:`,
				`    BroadcastRecord{3e57e94 u-1 android.intent.action.SCREEN_OFF} to user -1`,
				`    Intent { act=android.intent.action.SCREEN_OFF flg=0x50000010 }`,
				`    caller=android 7469:system/1000 pid=7469 uid=1000`,
				`    enqueueClockTime=2016-09-27 14:33:16 dispatchClockTime=2016-09-27 14:33:16`,
				`    dispatchTime=-- (0 since enq) receiverTime=--`,
				`  Active Ordered Broadcast foreground #1:`,
				`    BroadcastRecord{3e57e94 u-1 android.intent.action.SCREEN_OFF} to user -1`,
				`    Intent { act=android.intent.action.SCREEN_OFF flg=0x50000010 }`,
				`    caller=android 7469:system/1000 pid=7469 uid=10000`,
				`    enqueueClockTime=2016-09-27 14:33:16 dispatchClockTime=2016-09-27 14:33:24`,
				`  Active Ordered Broadcast foreground #0:`,
				`    BroadcastRecord{3e57e94 u-1 android.intent.action.SCREEN_OFF} to user -1`,
				`    Intent { act=android.intent.action.SCREEN_OFF flg=0x50000010 }`,
				`    caller=android 7469:system/1000 pid=7469 uid=1000`,
				`    enqueueClockTime=2016-09-27 14:33:16 dispatchClockTime=2016-09-27 14:33:24`,
				`    dispatchTime=-- (+10s3ms since enq) receiverTime=--`,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Active Broadcast (foreground),string,1475011996000,1475011996000,2,1000`,
				`Active Broadcast (foreground),string,1475011996000,1475012006003,0,1000`,
			}, "\n"),
			wantErrs: []error{errors.New("#1: missing dispatch offset")},
		},
		{
			desc: "Active broadcast event - massive offset",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-09-16 16:27:41`,
				`========================================================`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
				`...`,
				`  Active ordered broadcasts [foreground]:`,
				`  Active Ordered Broadcast foreground #0:`,
				`    BroadcastRecord{3e57e94 u-1 android.intent.action.SCREEN_OFF} to user -1`,
				`    Intent { act=android.intent.action.SCREEN_OFF flg=0x50000010 }`,
				`    caller=android 7469:system/1000 pid=7469 uid=1000`,
				`    enqueueClockTime=2016-09-27 14:33:16 dispatchClockTime=2017-09-27 14:33:16`,
				`    dispatchTime=-- (+366d since enq) receiverTime=--`,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
			}, "\n"),
			wantErrs: []error{errors.New("#0: offset is too large")},
		},
	}

	for _, test := range tests {
		input := strings.Join(test.input, "\n")
		gotCSV, errs := Parse(input)
		if !reflect.DeepEqual(errs, test.wantErrs) {
			t.Errorf("%v: Parse(%v)\n got errs: %v\n\n want errs: %v", test.desc, input, errs, test.wantErrs)
		}
		gotCSV = strings.TrimSpace(gotCSV)
		wantCSV := strings.TrimSpace(test.wantCSV)
		if !reflect.DeepEqual(gotCSV, wantCSV) {
			t.Errorf("%v: Parse(%v)\n got: %v\n\n want: %v", test.desc, input, gotCSV, wantCSV)
		}
	}
}
