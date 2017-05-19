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
	"github.com/google/battery-historian/csv"
	usagepb "github.com/google/battery-historian/pb/usagestats_proto"
)

// TestParse tests the generation of CSV entries for activity manager events from the bug report event logs.
func TestParse(t *testing.T) {
	tests := []struct {
		desc  string
		input []string
		pkgs  []*usagepb.PackageInfo

		wantLogsData LogsData
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
				`------ 0.165s was the duration of 'EVENT LOG' ------`, // This should not be considered a new section.
				``,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Activity Manager Proc,service,1442334565370,1442334729049,"11,26187,1110007,com.google.android.gms.unstable,service,com.google.android.gms/.droidguard.DroidGuardService",10007`,
							`Activity Manager Proc,service,1442334575654,1442334731261,"11,26297,1110003,android.process.acore,broadcast,com.android.providers.contacts/.PackageIntentReceiver",10003`,
						}, "\n"),
						StartMs: 1442334565370,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Activity Manager Proc,service,1437652660883,1437652663546,"10,18230,1010068,com.google.android.apps.plus,broadcast,com.google.android.apps.plus/.service.PackagesMediaMonitor",10068`,
						}, "\n"),
						StartMs: 1437652660883,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Activity Manager Proc,service,1437652660883,-1,"10,18230,1010068,com.google.android.apps.plus,broadcast,com.google.android.apps.plus/.service.PackagesMediaMonitor",10068`,
						}, "\n"),
						StartMs: 1437652660883,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Activity Manager Proc,service,-1,1437652663546,"10,18230,com.google.android.apps.plus",`,
						}, "\n"),
						StartMs: 1437652663546,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`AM Low Memory,service,1422390753699,1422390753699,20,`,
							`force_gc,service,1422390753702,1422390753702,Binder,`,
							`AM Low Memory,service,1422390779234,1422390779234,22,`,
							`force_gc,service,1422390779238,1422390779238,Binder,`,
							`AM Low Memory,service,1422390805381,1422390805381,23,`,
							`notification_cancel,service,1422390805386,1422390805386,"10007,28835,com.google.android.gms,10436,NULL,0,0,64,8,NULL",`,
						}, "\n"),
						StartMs: 1422390753699,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`ANR,service,1443411899609,1443411899609,"0,2103,com.google.android.gms,-1194836283,executing service com.google.android.gms/.reminders.service.RemindersIntentService",`,
							`ANR,service,1443412028686,1443412028686,"0,3503,com.google.android.gms,-1194836283,Broadcast of Intent { act=android.net.conn.CONNECTIVITY_CHANGE flg=0x4000010 cmp=com.google.android.gms/.kids.chimera.SystemEventReceiverProxy (has extras) }",`,
							`ANR,service,1443412028686,1443412028686,"0,3503,com.google.android.apps.photos,-1194836283,Broadcast/stuff",1`,
							`am_proc_bound,service,1443412028704,1443412028704,"0,3555,com.google.android.apps.photos",`,
						}, "\n"),
						StartMs: 1443411899609,
					},
				},
			},
		},
		{
			desc: "Event log header appears twice",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-09-27 21:04:31`,
				`========================================================`,
				`...`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`09-27 20:44:59.609   808   822 I am_anr  : [0,2103,com.google.android.gms,-1194836283,executing service com.google.android.gms/.reminders.service.RemindersIntentService]`,
				`09-27 20:47:08.686   808   822 I am_anr  : [0,3503,com.google.android.gms,-1194836283,Broadcast of Intent { act=android.net.conn.CONNECTIVITY_CHANGE flg=0x4000010 cmp=com.google.android.gms/.kids.chimera.SystemEventReceiverProxy (has extras) }]`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`09-27 20:47:08.686   808   822 I am_anr  : [0,3503,com.google.android.apps.photos,-1194836283,Broadcast/stuff]`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			pkgs: []*usagepb.PackageInfo{
				{PkgName: proto.String("com.google.android.apps.photos"), Uid: proto.Int32(1)},
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`ANR,service,1443411899609,1443411899609,"0,2103,com.google.android.gms,-1194836283,executing service com.google.android.gms/.reminders.service.RemindersIntentService",`,
							`ANR,service,1443412028686,1443412028686,"0,3503,com.google.android.gms,-1194836283,Broadcast of Intent { act=android.net.conn.CONNECTIVITY_CHANGE flg=0x4000010 cmp=com.google.android.gms/.kids.chimera.SystemEventReceiverProxy (has extras) }",`,
							`ANR,service,1443412028686,1443412028686,"0,3503,com.google.android.apps.photos,-1194836283,Broadcast/stuff",1`,
						}, "\n"),
						StartMs: 1443411899609,
					},
				},
				Errs: []error{
					errors.New(`section "EVENT LOG" encountered more than once`),
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`ANR,service,1451623499609,1451623499609,"0,2103,com.google.android.gms,-1194836283,reason",`,
						}, "\n"),
						StartMs: 1451623499609,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`ANR,service,1451709899609,1451709899609,"0,2103,com.google.android.gms,-1194836283,reason",`,
						}, "\n"),
						StartMs: 1451709899609,
					},
				},
			},
		},
		{
			desc: "Events with months far away from dumpstate month",
			input: []string{

				`========================================================`,
				`== dumpstate: 2016-04-01 21:04:31`,
				`========================================================`,
				`...`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`07-01 20:44:59.609   808   822 I am_anr  : [0,2103,com.google.android.gms,-1194836283,reason]`,     // Year should be 2015.
				`02-01 22:44:59.555   808   822 I am_anr  : [0,2103,com.google.android.example,-1194836283,reason]`, // Year should be 2016.
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`ANR,service,1435808699609,1435808699609,"0,2103,com.google.android.gms,-1194836283,reason",`,
							`ANR,service,1454395499555,1454395499555,"0,2103,com.google.android.example,-1194836283,reason",`,
						}, "\n"),
						StartMs: 1454395499555,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`AM Low Memory,service,1445358923423,1445358923423,37,`,
						}, "\n"),
						StartMs: 1445358923423,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Activity Manager Proc,service,1451626165370,1451709899609,"11,26187,1110007,com.google.android.gms.unstable,service,com.google.android.gms/.droidguard.DroidGuardService",10007`,
						}, "\n"),
						StartMs: 1451626165370,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Activity Manager Proc,service,1442334575654,1442334731261,"11,26297,1110003,android.process.acore,broadcast,com.android.providers.contacts/.PackageIntentReceiver,Newfield",10003`,
						}, "\n"),
						StartMs: 1442334565370,
					},
				},
				Warnings: []string{
					"am_proc_start: got 7 parts, expected 6",
					"am_proc_died: got 4 parts, expected 3",
				},
				Errs: []error{
					errors.New("am_proc_start: got 5 parts, want 6"),
					errors.New("am_proc_died: got 2 parts, want 3"),
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`ANR,service,1443411899609,1443411899609,"0,2103,com.google.android.gms,-1194836283,executing service com.google.android.gms/.reminders.service.RemindersIntentService,extrafield",`,
						}, "\n"),
						StartMs: 1443411899609,
					},
				},
				Warnings: []string{
					"am_anr: got 6 parts, expected 5",
				},
				Errs: []error{
					errors.New("am_anr: got 3 parts, want 5"),
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					SystemLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Crashes,service,1438840691751,1438840691751,com.google.android.volta: AsyncTask #1,1`,
							`Crashes,service,1438846550774,1438846550774,com.google.android.volta: AsyncTask #2,1`,
							`Crashes,service,1438846550774,1438846550774,com.android.vending: main,`,
						}, "\n"),
						StartMs: 1438840691751,
					},
				},
			},
		},
		{
			desc: "Native crash",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-02-29 15:45:37`,
				`========================================================`,
				`...`,
				`------ SYSTEM LOG (logcat -v threadtime -v printable -d *:v) ------`,
				`02-29 07:04:15.063  3624  3788 F libc    : Fatal signal 11 (SIGSEGV), code 1, fault addr 0x58 in tid 3788 (RenderThread)`,
				`02-29 07:04:15.216 11706 11706 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***`,
				`02-29 07:04:15.216 11706 11706 F DEBUG   : Build fingerprint: 'google/angler/angler:N/NRC56F/2640559:userdebug/dev-keys'`,
				`02-29 07:04:15.216 11706 11706 F DEBUG   : Revision: '0'`,
				`02-29 07:04:15.216 11706 11706 F DEBUG   : ABI: 'arm64'`,
				`02-29 07:04:15.216 11706 11706 F DEBUG   : pid: 3624, tid: 3788, name: RenderThread  >>> com.android.systemui <<<`,
				`02-29 07:04:15.216 11706 11706 F DEBUG   : signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x58`,
				`02-29 07:04:15.217 11706 11706 F DEBUG   :     x0   00000070d09c0820  x1   00000070d2dab89c  x2   0000000000000000  x3   0000000000000000`,
				`02-29 07:04:15.217 11706 11706 F DEBUG   :     x4   00000070c87e84fc  x5   fffffffffffffffe  x6   0000000000015786  x7   00000070c858f130`,
				`02-29 07:04:15.217 11706 11706 F DEBUG   :     x8   0000000000000000  x9   000000000000018c  x10  000000000000018c  x11  00000070d07e52a0`,
				`02-29 07:04:15.217 11706 11706 F DEBUG   :     x12  00000000000000ca  x13  000000000000001b  x14  000000000000001b  x15  00000000000000f0`,
				`02-29 07:04:15.217 11706 11706 F DEBUG   :     x16  00000070efbd6ef8  x17  00000070efb7fc04  x18  00000070c9cbedc4  x19  00000070c9d2bdc0`,
				`02-29 07:04:15.217 11706 11706 F DEBUG   :     x20  00000070d09c0820  x21  00000070d09c0818  x22  00000070c9d2bdc0  x23  b5c7870e1bcc88af`,
				`02-29 07:04:15.217 11706 11706 F DEBUG   :     x24  b5c7870e1bcc88af  x25  00000070f1f8618c  x26  00000070d2dabe68  x27  00000070d2dabe60`,
				`02-29 07:04:15.217 11706 11706 F DEBUG   :     x28  00000070eebd41f8  x29  00000070d2dab8e0  x30  00000070efba9ab8`,
				`02-29 07:04:15.217 11706 11706 F DEBUG   :     sp   00000070d2dab890  pc   00000070efba9acc  pstate 0000000080000000`,
				`02-29 08:04:15.216 11706 11706 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***`, // Spurious line
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					SystemLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`libc,service,1456758255063,1456758255063,"Fatal signal 11 (SIGSEGV), code 1, fault addr 0x58 in tid 3788 (RenderThread)",`,
							`Native crash,service,1456758255216,1456758255216,com.android.systemui: RenderThread,`,
						}, "\n"),
						StartMs: 1456758255063,
					},
				},
			},
		},
		{
			desc: "am_wtf",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-11-05 06:30:29`,
				`========================================================`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`11-05 06:15:19.609 1136  1175 I am_wtf  : [0,2475,com.google.android.gms.persistent,-1194836283,StrictMode,Stack is too large: numViolations=5 policy=#1600007 front=android.os.StrictMode$StrictModeDiskReadViolation: policy=23068679 violation=2`,
				`11-05 06:15:19.609 1136  1175 I am_wtf  : 	at android.os.StrictMode$AndroidBlockGuardPolicy.onReadFromDisk(StrictMode.java:1293)`,
				`11-05 06:15:19.609 1136  1175 I am_wtf  : 	at libcore.io.BlockGuardOs.read(BlockGuardOs.java:230)`,
				`11-05 06:15:19.609 1136  1175 I am_wtf  : 	at libcore.io.IoBridge.read(IoBri]`,
				`11-05 06:15:21.609 4723  5868 I am_wtf  : [0,4723,system_server,-1,ActivityManager,Sending non-protected broadcast android.net.wifi.DHCP_RENEW from system]`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`am_wtf,service,1446732919609,1446732919609,"0,2475,com.google.android.gms.persistent,-1194836283,StrictMode,Stack is too large: numViolations=5 policy=#1600007 front=android.os.StrictMode$StrictModeDiskReadViolation: policy=23068679 violation=2` + "\n" +
								`at android.os.StrictMode$AndroidBlockGuardPolicy.onReadFromDisk(StrictMode.java:1293)` + "\n" +
								`at libcore.io.BlockGuardOs.read(BlockGuardOs.java:230)` + "\n" +
								`at libcore.io.IoBridge.read(IoBri",`,
							`am_wtf,service,1446732921609,1446732921609,"0,4723,system_server,-1,ActivityManager,Sending non-protected broadcast android.net.wifi.DHCP_RENEW from system",`,
						}, "\n"),
						StartMs: 1446732919609,
					},
				},
			},
		},
		{
			desc: "dvm_lock_sample",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-11-05 06:30:29`,
				`========================================================`,
				`------ EVENT LOG (logcat -b events -v threadtime -d *:v) ------`,
				`11-05 06:15:21.609 31622 31727 I dvm_lock_sample: [com.google.example,0,pool-3-thread-4,494,MetricsManager.java,57,Object.java,-2,98]`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			pkgs: []*usagepb.PackageInfo{
				{PkgName: proto.String("com.google.example"), Uid: proto.Int32(10114)},
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Long dvm_lock_sample,service,1446732921609,1446732921609,"com.google.example,0,pool-3-thread-4,494,MetricsManager.java,57,Object.java,-2,98",10114`,
						}, "\n"),
						StartMs: 1446732921609,
					},
				},
			},
		},
		{
			desc: "GC pauses",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-06-10 15:41:07`,
				`========================================================`,
				`------ SYSTEM LOG (logcat -v threadtime -d *:v) ------`,
				`--------- beginning of system`,
				`--------- beginning of main`,
				`06-10 15:21:43.587  5455  5469 I art     : Background partial concurrent mark sweep GC freed 40761(1528KB) AllocSpace objects, 2(415KB) LOS objects, 39% free, 24MB/40MB, paused 16.364ms total 66.159ms`,
				`06-10 15:21:45.927  1852  2742 I art     : Explicit concurrent mark sweep GC freed 51894(2MB) AllocSpace objects, 4(79KB) LOS objects, 25% free, 47MB/63MB, paused 2.968ms total 106.780ms`,
				`06-10 15:23:36.032  6199  6214 I art     : Background sticky concurrent mark sweep GC freed 59399(3MB) AllocSpace objects, 9(167KB) LOS objects, 11% free, 23MB/26MB, paused 29.133ms total 228.390ms`,
				`06-10 15:37:48.254  1404  1404 I art     : Explicit concurrent mark sweep GC freed 706(30KB) AllocSpace objects, 0(0B) LOS objects, 40% free, 16MB/26MB, paused 632us total 52.753ms`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					SystemLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`GC Pause - Background (partial),service,1433974903587,1433974903587,16364000,`, // Value is pause duration in nanoseconds.
							`GC Pause - Foreground,service,1433974905927,1433974905927,2968000,`,
							`GC Pause - Background (sticky),service,1433975016032,1433975016032,29133000,`,
							`GC Pause - Foreground,service,1433975868254,1433975868254,632000,`,
						}, "\n"),
						StartMs: 1433974903587,
					},
				},
			},
		},
		{
			desc: "Choreographer notifications",
			input: []string{
				`========================================================`,
				`== dumpstate: 2016-02-29 15:45:37`,
				`========================================================`,
				`------ SYSTEM LOG (logcat -v threadtime -v printable -d *:v) ------`,
				`02-29 15:45:14.575 24830 24830 I Choreographer: Skipped 60 frames!  The application may be doing too much work on its main thread.`,
				`...`,
				`  PID mappings:`,
				`PID #24830: ProcessRecord{5dcac88 24830:com.android.settings/1000}`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					SystemLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Choreographer (skipped frames),service,1456789514575,1456789514575,60,1000`,
						}, "\n"),
						StartMs: 1456789514575,
					},
				},
			},
		},
		{
			desc: "StrictMode policy violation",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-11-05 06:30:29`,
				`========================================================`,
				`...`,
				`------ SYSTEM LOG (logcat -v threadtime -d *:v) ------`,
				`11-05 06:15:21.609 18263 18263 D StrictMode: StrictMode policy violation; ~duration=489 ms: android.os.StrictMode$StrictModeDiskReadViolation: policy=65567 violation=2`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.os.StrictMode$AndroidBlockGuardPolicy.onReadFromDisk(StrictMode.java:1293)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at java.io.UnixFileSystem.checkAccess(UnixFileSystem.java:249)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at java.io.File.exists(File.java:780)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.app.ContextImpl.getDataDir(ContextImpl.java:1938)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.app.ContextImpl.getPreferencesDir(ContextImpl.java:466)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.app.ContextImpl.getSharedPreferencesPath(ContextImpl.java:627)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.app.ContextImpl.getSharedPreferences(ContextImpl.java:345)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.content.ContextWrapper.getSharedPreferences(ContextWrapper.java:164)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at com.google.android.apps.gmm.shared.settings.GmmSettings.newInstance(GmmSettings.java:11418)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at com.google.android.apps.gmm.map.impl.MapEnvironmentImplModule_GetSettingsFactory.get(MapEnvironmentImplModule_GetSettingsFactory.java:3222)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at dagger.internal.DoubleCheck.get(DoubleCheck.java:47)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at com.google.android.apps.gmm.map.impl.PaintfeClientPropertiesProviderImpl_Factory.get(PaintfeClientPropertiesProviderImpl_Factory.java:2027)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at dagger.internal.DoubleCheck.get(DoubleCheck.java:47)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at com.google.android.apps.gmm.map.impl.MapEnvironmentImplModule_GetPaintfeClientPropertiesProviderFactory.get(MapEnvironmentImplModule_GetPaintfeClientProp$`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at com.google.android.apps.gmm.shared.net.clientparam.manager.ClientParametersManagerModule_GetClientParametersManagerFactory.get(ClientParametersManagerMod$`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at dagger.internal.DoubleCheck.get(DoubleCheck.java:47)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at com.google.android.apps.gmm.base.app.DaggerApplicationComponent.getClientParametersManager(DaggerApplicationComponent.java:7568)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at com.google.android.apps.gmm.base.app.GoogleMapsApplication.onCreate(GoogleMapsApplication.java:51764)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.app.Instrumentation.callApplicationOnCreate(Instrumentation.java:1024)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.app.ActivityThread.handleBindApplication(ActivityThread.java:5372)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.app.ActivityThread.-wrap2(ActivityThread.java)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.app.ActivityThread$H.handleMessage(ActivityThread.java:1529)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.os.Handler.dispatchMessage(Handler.java:102)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.os.Looper.loop(Looper.java:154)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.app.ActivityThread.main(ActivityThread.java:6088)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at java.lang.reflect.Method.invoke(Native Method)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:886)`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:776)`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			pkgs: []*usagepb.PackageInfo{
				{PkgName: proto.String("android"), Uid: proto.Int32(1000)},
				{PkgName: proto.String("com.google.android.apps.gmm"), Uid: proto.Int32(10110)},
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					SystemLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`StrictMode policy violation,service,1446732921609,1446732921609,~duration=489 ms: android.os.StrictMode$StrictModeDiskReadViolation: policy=65567 violation=2,10110`,
						}, "\n"),
						StartMs: 1446732921609,
					},
				},
			},
		},
		{
			desc: "StrictMode policy violation, without any matched processes",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-11-05 06:30:29`,
				`========================================================`,
				`...`,
				`------ SYSTEM LOG (logcat -v threadtime -d *:v) ------`,
				`11-05 06:15:21.609 18263 18263 D StrictMode: StrictMode policy violation; ~duration=489 ms: android.os.StrictMode$StrictModeDiskReadViolation: policy=65567 violation=2`,
				`11-05 06:15:21.609 18263 18263 D StrictMode:    at android.os.StrictMode$AndroidBlockGuardPolicy.onReadFromDisk(StrictMode.java:1293)`,
				`11-05 06:15:21.888 18263 18263 D StrictMode: StrictMode policy violation; ~duration=100 ms: android.os.StrictMode$StrictModeDiskReadViolation: policy=65567 violation=2`,
				`11-05 06:15:21.999 18263 18263 D StrictMode: StrictMode policy violation; ~duration=789 ms: android.os.StrictMode$StrictModeDiskReadViolation: policy=65567 violation=2`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					SystemLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`StrictMode policy violation,service,1446732921609,1446732921609,~duration=489 ms: android.os.StrictMode$StrictModeDiskReadViolation: policy=65567 violation=2,`,
							`StrictMode policy violation,service,1446732921888,1446732921888,~duration=100 ms: android.os.StrictMode$StrictModeDiskReadViolation: policy=65567 violation=2,`,
							`StrictMode policy violation,service,1446732921999,1446732921999,~duration=789 ms: android.os.StrictMode$StrictModeDiskReadViolation: policy=65567 violation=2,`,
						}, "\n"),
						StartMs: 1446732921609,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					SystemLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Bluetooth Scan,service,1446733154095,1446733154095,Unknown PID 1691 (PID: 1691),`,
							`Bluetooth Scan,service,1446733155815,1446733155815,Unknown PID 1691 (PID: 1691),`,
							`Bluetooth Scan,service,1446733210417,1446733210417,gbis.gbandroid (PID: 17745),10105`,
						}, "\n"),
						StartMs: 1446733154095,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`notification_cancel,service,1446700749047,1446700749047,,`,
							`ANR,service,1446732921609,1446732921609,"0,2103,com.google.android.gms,-1194836283,executing service com.google.android.gms/.reminders.service.RemindersIntentService",`,
						}, "\n"),
						StartMs: 1446700749047,
					},
					SystemLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Vold,service,1446726057356,1446726057356,Vold 2.1 (the revenge) firing up,`,
							`Bluetooth Scan,service,1446733154095,1446733154095,Unknown PID 1691 (PID: 1691),`,
							`Logcat misc,string,1446733775969,1446733775969,bug report collection triggered,`,
						}, "\n"),
						StartMs: 1446726057356,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Calendar,service,1442334350539,1442334350539,enqueueAttachment attachmentId: 10827,`,
							`Activity Manager Proc,service,1442334565370,-1,"11,26187,1110007,com.google.android.gms.unstable,service,com.google.android.gms/.droidguard.DroidGuardService",10007`,
						}, "\n"),
						StartMs: 1442334350539,
					},
					LastLogcatSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Gmail,service,1442333990539,1442333990539,enqueueAttachment attachmentId: 10827,`,
							`Activity Manager Proc,service,1442334575654,-1,"11,26297,1110003,android.process.acore,broadcast,com.android.providers.contacts/.PackageIntentReceiver",10003`,
						}, "\n"),
						StartMs: 1442333990539,
					},
				},
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
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					EventLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`Calendar,service,1442334650539,1442334650539,enqueueAttachment attachmentId: 10827,`,
							`Activity Manager Proc,service,1442334565370,-1,"11,26187,1110007,com.google.android.gms.unstable,service,com.google.android.gms/.droidguard.DroidGuardService",10007`,
						}, "\n"),
						StartMs: 1442334565370,
					},
				},
				Errs: []error{
					fmt.Errorf("expect log timestamps in sorted order, got section start: 1442334650539, event timestamp: 1442334565370"),
				},
			},
		},
		{
			desc: "Log line detail matches section heading",
			input: []string{
				`========================================================`,
				`== dumpstate: 2015-06-10 15:41:07`,
				`========================================================`,
				`------ SYSTEM LOG (logcat -v threadtime -d *:v) ------`,
				`--------- beginning of system`,
				`--------- beginning of main`,
				`06-10 15:19:18.447 20746 21720 I efw     : -------------- Local Query Results -----------`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					SystemLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`efw,service,1433974758447,1433974758447,-------------- Local Query Results -----------,`,
						}, "\n"),
						StartMs: 1433974758447,
					},
				},
			},
		},
		{
			desc: "UID column provided",
			input: []string{
				`========================================================`,
				`== dumpstate: 2017-03-20 15:41:07`,
				`========================================================`,
				`------ SYSTEM LOG (logcat -v threadtime -d *:v) ------`,
				`--------- beginning of system`,
				`--------- beginning of main`,
				`03-19 03:01:21.731  root   381   390 E vold    : fs_mgr_read_fstab_dt(): failed to read fstab from dt`,
				`03-19 03:01:21.741  1000 17606 17674 D VoldConnector: RCV <- {200 8 Command succeeded}`,
				`03-20 07:39:33.032 10084 28160 28160 D DevicePlayback: clearOrphanedFiles`,
				`...`,
				`[persist.sys.timezone]: [America/Los_Angeles]`,
			},
			wantLogsData: LogsData{
				Logs: map[string]*Log{
					SystemLogSection: &Log{
						CSV: strings.Join([]string{
							csv.FileHeader,
							`vold,service,1489917681731,1489917681731,fs_mgr_read_fstab_dt(): failed to read fstab from dt,`,
							`VoldConnector,service,1489917681741,1489917681741,RCV <- {200 8 Command succeeded},`,
							`DevicePlayback,service,1490020773032,1490020773032,clearOrphanedFiles,`,
						}, "\n"),
						StartMs: 1489917681731,
					},
				},
			},
		},
	}
	for _, test := range tests {
		got := Parse(test.pkgs, strings.Join(test.input, "\n"))
		want := test.wantLogsData
		normalizeLogsData(&got)
		normalizeLogsData(&want)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: Parse(%v)\n got: %v\n\n want: %v", test.desc, strings.Join(test.input, "\n"), got, want)
		}
	}
}

func normalizeLogsData(ld *LogsData) {
	for _, l := range ld.Logs {
		// l is a pointer to the log. It shouldn't ever be nil, but add a check just in case.
		if l != nil {
			l.CSV = normalizeCSV(l.CSV)
		}
	}
}

// Removes trailing space at the end of the string, then splits by new line and sorts alphabetically.
// Returns CSV in string format.
func normalizeCSV(text string) string {
	strs := strings.Split(strings.TrimSpace(text), "\n")
	// Order of outputted CSV does not matter and order may vary due to iteration of maps in printing the CSV.
	sort.Strings(strs)
	return strings.Join(strs, "\n")
}
