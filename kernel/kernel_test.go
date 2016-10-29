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

package kernel

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/google/battery-historian/csv"
)

// Tests the generating of CSV entries from a Kernel Wakesource logging file.
func TestParse(t *testing.T) {
	tests := []struct {
		desc       string
		input      string
		wantCSV    string
		matched    bool
		wantErrors []error
	}{
		{
			"First seen transition for event is negative, Negative transition should be ignored",
			strings.Join([]string{
				`<idle>-0 [001] d.h6 "1970-01-01 00:00:50.000000" wakeup_source_activate: [timerfd] state=0x176d0003`,
				`<idle>-0 [001] dNs4 "1970-01-01 00:00:51.000000" wakeup_source_deactivate: vbus-tegra-otg state=0x18490000`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Kernel Wakesource,service,50000,51000,[timerfd],`,
			}, "\n"),
			true,
			[]error{fmt.Errorf("negative transition without positive transition for %q, wakesource %q", KernelWakeSource, "vbus-tegra-otg")},
		},
		{
			"Multiple negative transitions.",
			strings.Join([]string{
				`AlarmManager-1285 [000] d..2 "1970-01-01 00:00:50.000000" wakeup_source_activate: [timerfd] state=0x1b720008`,
				`AlarmManager-1285 [000] d..2 "1970-01-01 00:00:51.000000" wakeup_source_deactivate: [timerfd] state=0x1b740007`,
				`AlarmManager-1285 [000] d..2 "1970-01-01 00:00:52.000000" wakeup_source_deactivate: [timerfd] state=0x1b750006`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Kernel Wakesource,service,50000,51000,[timerfd],`,
			}, "\n"),
			true,
			[]error{fmt.Errorf("negative transition without positive transition for %q, wakesource %q", KernelWakeSource, "[timerfd]")},
		},
		{
			"Multiple positive.",
			strings.Join([]string{
				`AlarmManager-1285 [000] d..2 "1970-01-01 00:00:50.000000" wakeup_source_activate: [timerfd] state=0x1b720008`,
				`AlarmManager-1285 [000] d..2 "1970-01-01 00:00:51.000000" wakeup_source_activate: [timerfd] state=0x1b740007`,
				`AlarmManager-1285 [000] d..2 "1970-01-01 00:00:52.000000" wakeup_source_deactivate: [timerfd] state=0x1b750006`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Kernel Wakesource,service,50000,52000,[timerfd],`,
			}, "\n"),
			true,
			[]error{fmt.Errorf("two positive transitions for %q, wakesource %q", KernelWakeSource, "[timerfd]")},
		},
		{
			"Last seen transition for event is positive.",
			strings.Join([]string{
				`<idle>-0 [001] d.h6 "1970-01-01 00:00:50.000000" wakeup_source_activate: [timerfd] state=0x176d0003`,
				`kworker/0:5-6483 [000] d..3 "1970-01-01 00:00:50.000000" wakeup_source_activate: vbus-tegra-otg state=0x1f130002`,
				`dhd_watchdog_th-148 [000] d..3 "1970-01-01 00:00:51.000000" wakeup_source_deactivate: [timerfd] state=0x22290003`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Kernel Wakesource,service,50000,51000,[timerfd],`,
				`Kernel Wakesource,service,50000,51000,vbus-tegra-otg,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Events copied from actual Kernel Wakesource log file",
			strings.Join([]string{
				`<idle>-0 [001] d.h6 "2015-05-28 19:50:27.636508" wakeup_source_activate: [timerfd] state=0x176d0003`,
				`healthd-188 [001] d..2 "2015-05-28 19:50:27.636636" wakeup_source_activate: eventpoll state=0x176d0004`,
				`healthd-188 [001] d..2 "2015-05-28 19:50:27.636649" wakeup_source_deactivate: [timerfd] state=0x176e0003`,
				`healthd-188 [001] d..2 "2015-05-28 19:50:27.636664" wakeup_source_activate: [timerfd] state=0x176e0004`,
				`healthd-188 [001] d..3 "2015-05-28 19:50:27.636677" wakeup_source_deactivate: eventpoll state=0x176f0003`,
				`healthd-188 [000] d..2 "2015-05-28 19:50:27.643529" wakeup_source_activate: eventpoll state=0x176f0004`,
				`healthd-188 [000] d..2 "2015-05-28 19:50:27.643544" wakeup_source_deactivate: [timerfd] state=0x17700003`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Kernel Wakesource,service,1432842627636,1432842627636,[timerfd],`,
				`Kernel Wakesource,service,1432842627636,1432842627636,eventpoll,`,
				`Kernel Wakesource,service,1432842627636,1432842627643,[timerfd],`,
				`Kernel Wakesource,service,1432842627643,1432842627643,eventpoll,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Multiple errors for negative transitions",
			strings.Join([]string{
				`AlarmManager-876 [001] d..2 "2015-06-23 17:08:43.754136" wakeup_source_activate: PowerManagerService.WakeLocks state=0x2ed10006`,
				`<...>-3641 [001] d.s4 "2015-06-23 17:13:13.680213" wakeup_source_deactivate: alarm_rtc state=0x36f90002`,
				`<...>-5433 [001] d.s4 "2015-06-23 17:24:08.680210" wakeup_source_deactivate: alarm_rtc state=0x79cc0002`,
				`<...>-5462 [001] d.s4 "2015-06-23 17:24:23.680240" wakeup_source_deactivate: alarm_rtc state=0x79da0002`,
				`<...>-809 [001] d..2 "2015-06-23 17:28:14.250634" wakeup_source_deactivate: PowerManagerService.WakeLocks state=0x7a3d0001`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Kernel Wakesource,service,1435079323754,1435080494250,PowerManagerService.WakeLocks,`,
			}, "\n"),
			true,
			[]error{
				fmt.Errorf("negative transition without positive transition for %q, wakesource %q", KernelWakeSource, "alarm_rtc"),
				fmt.Errorf("negative transition without positive transition for %q, wakesource %q", KernelWakeSource, "alarm_rtc"),
				fmt.Errorf("negative transition without positive transition for %q, wakesource %q", KernelWakeSource, "alarm_rtc"),
			},
		},
		{
			"No lines match kernel format",
			strings.Join([]string{
				`1433786060 0.004262`,
				`ID: 12 SSID: "MakuNet3.0" BSSID: null FQDN: null REALM: null PRIO: 2563`,
			}, "\n"),
			"",
			false,
			nil,
		},
	}
	for _, test := range tests {
		matched, output, errs := Parse(test.input)

		if matched != test.matched {
			t.Errorf("%v: Parse(%v) matched was %v, want %v", test.desc, test.input, matched, test.matched)
		}
		if test.matched {
			got := normalizeCSV(output)
			want := normalizeCSV(test.wantCSV)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%v: Parse(%v) outputted csv = %q, want: %q", test.desc, test.input, got, want)
			}
			if !reflect.DeepEqual(errs, test.wantErrors) {
				t.Errorf("%v: Parse(%v) unexpected errors = %v, want: %v", test.desc, test.input, errs, test.wantErrors)
			}
		}
	}
}

// Removes trailing space at the end of the string,
// then splits by new line.
func normalizeCSV(text string) []string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	return lines
}
