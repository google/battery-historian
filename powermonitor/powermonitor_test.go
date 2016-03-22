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

package powermonitor

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// Tests the generating of CSV entries from a powermonitor file.
func TestParse(t *testing.T) {
	tests := []struct {
		desc       string
		input      string
		wantCSV    string
		matched    bool
		wantErrors []error
	}{
		{
			"Single reading",
			strings.Join([]string{
				`1433786060 0.004262`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786061000,4.262,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Reading is whole number",
			strings.Join([]string{
				`1433786060 4`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786061000,4000.000,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"First and last readings per second are fewer",
			strings.Join([]string{
				`1433786060 0.004262`,
				`1433786061 0.004737`,
				`1433786061 0.006574`,
				`1433786062 0.053441`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786061000,4.262,`,
				`Powermonitor,int,1433786061000,1433786061500,4.737,`,
				`Powermonitor,int,1433786061500,1433786062000,6.574,`,
				`Powermonitor,int,1433786062000,1433786063000,53.441,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Initial readings per second is greater than last readings per second",
			strings.Join([]string{
				`1433786060 0.004486`,
				`1433786060 0.003793`,
				`1433786061 0.003809`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786060500,4.486,`,
				`Powermonitor,int,1433786060500,1433786061000,3.793,`,
				`Powermonitor,int,1433786061000,1433786062000,3.809,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Initial readings per second is fewer than last readings per second",
			strings.Join([]string{
				`1433786060 0.004486`,
				`1433786061 0.003793`,
				`1433786061 0.003809`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786061000,4.486,`,
				`Powermonitor,int,1433786061000,1433786061500,3.793,`,
				`Powermonitor,int,1433786061500,1433786062000,3.809,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Multiple readings per second, last missing",
			strings.Join([]string{
				`1433786060 0.003802`,
				`1433786060 0.003810`,
				`1433786061 0.003810`,
				`1433786061 0.004686`,
				`1433786062 0.004479`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786060500,3.802,`,
				`Powermonitor,int,1433786060500,1433786061000,3.810,`,
				`Powermonitor,int,1433786061000,1433786061500,3.810,`,
				`Powermonitor,int,1433786061500,1433786062000,4.686,`,
				`Powermonitor,int,1433786062000,1433786063000,4.479,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Readings per second decreases",
			strings.Join([]string{
				`1433786061 0.003811`,
				`1433786061 0.003791`,
				`1433786062 0.017514`,
				`1433786063 0.005186`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786061000,1433786061500,3.811,`,
				`Powermonitor,int,1433786061500,1433786062000,3.791,`,
				`Powermonitor,int,1433786062000,1433786063000,17.514,`,
				`Powermonitor,int,1433786063000,1433786064000,5.186,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Readings per second increases",
			strings.Join([]string{
				`1433786060 0.003811`,
				`1433786060 0.003791`,
				`1433786061 0.003811`,
				`1433786061 0.003791`,
				`1433786062 0.017514`,
				`1433786062 0.005186`,
				`1433786062 0.003810`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786060500,3.811,`,
				`Powermonitor,int,1433786060500,1433786061000,3.791,`,
				`Powermonitor,int,1433786061000,1433786061500,3.811,`,
				`Powermonitor,int,1433786061500,1433786062000,3.791,`,
				`Powermonitor,int,1433786062000,1433786062333,17.514,`,
				`Powermonitor,int,1433786062333,1433786062666,5.186,`,
				`Powermonitor,int,1433786062666,1433786063000,3.810,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"5 readings per second",
			strings.Join([]string{
				`1433786060 0.004262`,
				`1433786060 0.004737`,
				`1433786060 0.006574`,
				`1433786060 0.053441`,
				`1433786060 0.004486`,
				`1433786061 0.003810`,
				`1433786061 0.004686`,
				`1433786061 0.004479`,
				`1433786061 0.003811`,
				`1433786061 0.003791`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786060200,4.262,`,
				`Powermonitor,int,1433786060200,1433786060400,4.737,`,
				`Powermonitor,int,1433786060400,1433786060600,6.574,`,
				`Powermonitor,int,1433786060600,1433786060800,53.441,`,
				`Powermonitor,int,1433786060800,1433786061000,4.486,`,
				`Powermonitor,int,1433786061000,1433786061200,3.810,`,
				`Powermonitor,int,1433786061200,1433786061400,4.686,`,
				`Powermonitor,int,1433786061400,1433786061600,4.479,`,
				`Powermonitor,int,1433786061600,1433786061800,3.811,`,
				`Powermonitor,int,1433786061800,1433786062000,3.791,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Real power data",
			strings.Join([]string{
				`1433786060 0.004262 0.004262`,
				`1433786060 0.004737 0.004499`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786060500,4.262,`,
				`Powermonitor,int,1433786060500,1433786061000,4.737,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Negative power reading",
			strings.Join([]string{
				`1433786060 -0.004262 0.004262`,
				`1433786060 0.004737 -0.004499`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786060500,-4.262,`,
				`Powermonitor,int,1433786060500,1433786061000,4.737,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Times in fractional seconds",
			strings.Join([]string{
				`1433786060.0 0.004262`,
				`1433786060.1 0.004737`,
				`1433786060.2 0.001234`,
				`1433786060.3 0.005678`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786060100,4.262,`,
				`Powermonitor,int,1433786060100,1433786060200,4.737,`,
				`Powermonitor,int,1433786060200,1433786060300,1.234,`,
				`Powermonitor,int,1433786060300,1433786060300,5.678,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Invalid input",
			strings.Join([]string{
				`1433786060 0.004262`,
				`1433786060 badstring`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786061000,4.262,`,
			}, "\n"),
			true,
			[]error{fmt.Errorf("line did not match format: unix_timestamp amps : %q", "1433786060 badstring")},
		},
		{
			"Fractional timestamp seen after non fractional timestamp",
			strings.Join([]string{
				`1433786060 0.004262`,
				`1433786060.1 0.004737`,
				`1433786060 0.001234`,
			}, "\n"),
			strings.Join([]string{
				`Powermonitor,int,1433786060000,1433786060500,4.262,`,
				`Powermonitor,int,1433786060500,1433786061000,1.234,`,
			}, "\n"),
			true,
			[]error{fmt.Errorf("timestamp %q does not match fractional mode %v", "1433786060.1 0.004737", false)},
		},
		{
			"No lines match powermonitor format",
			strings.Join([]string{
				`AlarmManager-876 [001] d..2 "2015-06-23 17:08:43.754136" wakeup_source_activate: PowerManagerService.WakeLocks state=0x2ed10006`,
				`1016        4        4        0        0        4        0    1 /dev/binder`,
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

// Removes the new line at the end of the string, then splits by newline.
func normalizeCSV(text string) []string {
	return strings.Split(strings.TrimSpace(text), "\n")
}
