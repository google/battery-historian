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
	"sort"
	"strings"
	"testing"

	"github.com/google/battery-historian/csv"
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
			desc: "Single reading",
			input: strings.Join([]string{
				`1433786060 0.004262`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786061000,4.262,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "Reading is whole number",
			input: strings.Join([]string{
				`1433786060 4`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786061000,4000.000,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "First and last readings per second are fewer",
			input: strings.Join([]string{
				`1433786060 0.004262`,
				`1433786061 0.004737`,
				`1433786061 0.006574`,
				`1433786062 0.053441`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786061000,4.262,`,
				`Power Monitor (mA),float,1433786061000,1433786061500,4.737,`,
				`Power Monitor (mA),float,1433786061500,1433786062000,6.574,`,
				`Power Monitor (mA),float,1433786062000,1433786063000,53.441,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "Initial readings per second is greater than last readings per second",
			input: strings.Join([]string{
				`1433786060 0.004486`,
				`1433786060 0.003793`,
				`1433786061 0.003809`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786060500,4.486,`,
				`Power Monitor (mA),float,1433786060500,1433786061000,3.793,`,
				`Power Monitor (mA),float,1433786061000,1433786062000,3.809,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "Initial readings per second is fewer than last readings per second",
			input: strings.Join([]string{
				`1433786060 0.004486`,
				`1433786061 0.003793`,
				`1433786061 0.003809`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786061000,4.486,`,
				`Power Monitor (mA),float,1433786061000,1433786061500,3.793,`,
				`Power Monitor (mA),float,1433786061500,1433786062000,3.809,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "Multiple readings per second, last missing",
			input: strings.Join([]string{
				`1433786060 0.003802`,
				`1433786060 0.003810`,
				`1433786061 0.003810`,
				`1433786061 0.004686`,
				`1433786062 0.004479`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786060500,3.802,`,
				`Power Monitor (mA),float,1433786060500,1433786061000,3.810,`,
				`Power Monitor (mA),float,1433786061000,1433786061500,3.810,`,
				`Power Monitor (mA),float,1433786061500,1433786062000,4.686,`,
				`Power Monitor (mA),float,1433786062000,1433786063000,4.479,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "Readings per second decreases",
			input: strings.Join([]string{
				`1433786061 0.003811`,
				`1433786061 0.003791`,
				`1433786062 0.017514`,
				`1433786063 0.005186`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786061000,1433786061500,3.811,`,
				`Power Monitor (mA),float,1433786061500,1433786062000,3.791,`,
				`Power Monitor (mA),float,1433786062000,1433786063000,17.514,`,
				`Power Monitor (mA),float,1433786063000,1433786064000,5.186,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "Readings per second increases",
			input: strings.Join([]string{
				`1433786060 0.003811`,
				`1433786060 0.003791`,
				`1433786061 0.003811`,
				`1433786061 0.003791`,
				`1433786062 0.017514`,
				`1433786062 0.005186`,
				`1433786062 0.003810`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786060500,3.811,`,
				`Power Monitor (mA),float,1433786060500,1433786061000,3.791,`,
				`Power Monitor (mA),float,1433786061000,1433786061500,3.811,`,
				`Power Monitor (mA),float,1433786061500,1433786062000,3.791,`,
				`Power Monitor (mA),float,1433786062000,1433786062333,17.514,`,
				`Power Monitor (mA),float,1433786062333,1433786062666,5.186,`,
				`Power Monitor (mA),float,1433786062666,1433786063000,3.810,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "5 readings per second",
			input: strings.Join([]string{
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
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786060200,4.262,`,
				`Power Monitor (mA),float,1433786060200,1433786060400,4.737,`,
				`Power Monitor (mA),float,1433786060400,1433786060600,6.574,`,
				`Power Monitor (mA),float,1433786060600,1433786060800,53.441,`,
				`Power Monitor (mA),float,1433786060800,1433786061000,4.486,`,
				`Power Monitor (mA),float,1433786061000,1433786061200,3.810,`,
				`Power Monitor (mA),float,1433786061200,1433786061400,4.686,`,
				`Power Monitor (mA),float,1433786061400,1433786061600,4.479,`,
				`Power Monitor (mA),float,1433786061600,1433786061800,3.811,`,
				`Power Monitor (mA),float,1433786061800,1433786062000,3.791,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "Real power data",
			input: strings.Join([]string{
				`1433786060 0.004262 0.004262`,
				`1433786060 0.004737 0.004499`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786060500,4.262,`,
				`Power Monitor (mA),float,1433786060500,1433786061000,4.737,`,
				`Power Monitor (mW),float,1433786060000,1433786060500,0.018,`,
				`Power Monitor (mW),float,1433786060500,1433786061000,0.021,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "Negative power reading",
			input: strings.Join([]string{
				`1433786060 -0.004262 0.004262`,
				`1433786060 0.004737 -0.004499`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786060500,-4.262,`,
				`Power Monitor (mA),float,1433786060500,1433786061000,4.737,`,
				`Power Monitor (mW),float,1433786060000,1433786060500,-0.018,`,
				`Power Monitor (mW),float,1433786060500,1433786061000,-0.021,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "Number of columns increase",
			input: strings.Join([]string{
				`1433786060 0.004262`,
				`1433786060 0.004737 4.000`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786061000,4.262,`,
			}, "\n"),
			matched:    true,
			wantErrors: []error{fmt.Errorf("found unexpected voltage column")},
		},
		{
			desc: "Number of columns decrease",
			input: strings.Join([]string{
				`1433786060 0.004262 4.000`,
				`1433786060 0.004737 `,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786061000,4.262,`,
				`Power Monitor (mW),float,1433786060000,1433786061000,17.048,`,
			}, "\n"),
			matched:    true,
			wantErrors: []error{fmt.Errorf("expected voltage column but was missing")},
		},
		{
			desc: "Times in fractional seconds",
			input: strings.Join([]string{
				`1433786060.0 0.004262`,
				`1433786060.1 0.004737`,
				`1433786060.2 0.001234`,
				`1433786060.3 0.005678`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786060100,4.262,`,
				`Power Monitor (mA),float,1433786060100,1433786060200,4.737,`,
				`Power Monitor (mA),float,1433786060200,1433786060300,1.234,`,
				`Power Monitor (mA),float,1433786060300,1433786060300,5.678,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "Invalid input",
			input: strings.Join([]string{
				`1433786060 0.004262`,
				`1433786060 badstring`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786061000,4.262,`,
			}, "\n"),
			matched:    true,
			wantErrors: []error{fmt.Errorf("line did not match format: unix_timestamp current optional_voltage : %q", "1433786060 badstring")},
		},
		{
			desc: "Fractional timestamp seen after non fractional timestamp",
			input: strings.Join([]string{
				`1433786060 0.004262`,
				`1433786060.1 0.004737`,
				`1433786060 0.001234`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1433786060000,1433786060500,4.262,`,
				`Power Monitor (mA),float,1433786060500,1433786061000,1.234,`,
			}, "\n"),
			matched:    true,
			wantErrors: []error{fmt.Errorf("timestamp %q does not match fractional mode %v", "1433786060.1 0.004737", false)},
		},
		{
			desc: "Timestamps in millisecond format",
			input: strings.Join([]string{
				`1484169264601 451.9 4201.0`,
				`1484169264701 443.2 4198.0`,
				`1484169264801 446.1 4195.0`,
				`1484169264901 449.0 4189.0`,
				`1484169265001 280.5 4227.9`,
				`1484169265101 277.6 4239.9`,
				`1484169265201 202.0 4257.9`,
				`1484169265301 181.7 4257.9`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Power Monitor (mA),float,1484169264601,1484169264701,451.900,`,
				`Power Monitor (mA),float,1484169264701,1484169264801,443.200,`,
				`Power Monitor (mA),float,1484169264801,1484169264901,446.100,`,
				`Power Monitor (mA),float,1484169264901,1484169265001,449.000,`,
				`Power Monitor (mA),float,1484169265001,1484169265101,280.500,`,
				`Power Monitor (mA),float,1484169265101,1484169265201,277.600,`,
				`Power Monitor (mA),float,1484169265201,1484169265301,202.000,`,
				`Power Monitor (mA),float,1484169265301,1484169265301,181.700,`,
				`Power Monitor (mW),float,1484169264601,1484169264701,1898.432,`,
				`Power Monitor (mW),float,1484169264701,1484169264801,1860.554,`,
				`Power Monitor (mW),float,1484169264801,1484169264901,1871.390,`,
				`Power Monitor (mW),float,1484169264901,1484169265001,1880.861,`,
				`Power Monitor (mW),float,1484169265001,1484169265101,1185.926,`,
				`Power Monitor (mW),float,1484169265101,1484169265201,1176.996,`,
				`Power Monitor (mW),float,1484169265201,1484169265301,860.096,`,
				`Power Monitor (mW),float,1484169265301,1484169265301,773.660,`,
			}, "\n"),
			matched: true,
		},
		{
			desc: "No lines match Power Monitor format",
			input: strings.Join([]string{
				`AlarmManager-876 [001] d..2 "2015-06-23 17:08:43.754136" wakeup_source_activate: PowerManagerService.WakeLocks state=0x2ed10006`,
				`1016        4        4        0        0        4        0    1 /dev/binder`,
			}, "\n"),
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
				t.Errorf("%v: Parse(%v)\n\n outputted csv = %v\n\n want: %v", test.desc, test.input, strings.Join(got, "\n"), strings.Join(want, "\n"))
			}
			if !reflect.DeepEqual(errs, test.wantErrors) {
				t.Errorf("%v: Parse(%v) unexpected errors = %v, want: %v", test.desc, test.input, errs, test.wantErrors)
			}
		}
	}
}

// TestValidLines tests the extracting of valid power monitor lines.
func TestValidLines(t *testing.T) {
	tests := []struct {
		input     string
		wantLines []string
	}{
		{
			input: strings.Join([]string{
				`some invalid header`,
				`1433786060 0.003810`,
				`another invalid line`,
				`1433786060 0.003820`,
			}, "\n"),
			wantLines: []string{
				`1433786060 0.003810`,
				`1433786060 0.003820`,
			},
		},
		{
			input: strings.Join([]string{
				`all invalid`,
			}, "\n"),
		},
	}

	for _, test := range tests {
		if got := ValidLines([]byte(test.input)); !reflect.DeepEqual(got, test.wantLines) {
			t.Errorf("ValidLines(%v) got: %v, want: %v", test.input, got, test.wantLines)
		}
	}
}

// Removes the new line at the end of the string, then splits by newline.
func normalizeCSV(text string) []string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	sort.Strings(lines)
	return lines
}
