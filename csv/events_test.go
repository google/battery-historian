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

package csv

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

// TestExtractEvents tests the extracting of metric specific events from the CSV output.
func TestExtractEvents(t *testing.T) {
	tests := []struct {
		desc       string
		input      []string
		metrics    []string
		wantEvents map[string][]Event
		wantErrs   []error
	}{
		{
			desc: "Match multiple metrics",
			input: []string{
				FileHeader,
				"Mobile network type,string,1422620452417,1422620453917,hspa,",
				"Charging status,string,1422620452417,1422620453917,c,",
				"Mobile network type,string,1422620453917,1422620454417,lte,",
				`Wakelock_in,service,1422620456417,1422620458417,"com.google.android.apps.docs/com.google/noogler@google.com",10051`,
				"Reboot,bool,1422620454417,1430000000000,true,",
				`CPU running,string,1430000001000,1430000003000,"1430000001000~57:qcom,smd-modem:200:qcom,smd-rpm|1430000003000~Abort:Some devices failed to suspend",`,
				`CPU running,string,1430000003000,1430000003000,"1430000003000~57:qcom,smd-modem:200:qcom,smd-rpm",`,
			},
			metrics: []string{"CPU running", "Charging status", "Wakelock_in"},
			wantEvents: map[string][]Event{
				"CPU running": {
					{
						Type:  "string",
						Start: 1430000001000,
						End:   1430000003000,
						Value: "1430000001000~57:qcom,smd-modem:200:qcom,smd-rpm|1430000003000~Abort:Some devices failed to suspend",
						Opt:   "",
					},
					{
						Type:  "string",
						Start: 1430000003000,
						End:   1430000003000,
						Value: "1430000003000~57:qcom,smd-modem:200:qcom,smd-rpm",
						Opt:   "",
					},
				},
				"Charging status": {
					{
						Type:  "string",
						Start: 1422620452417,
						End:   1422620453917,
						Value: "c",
						Opt:   "",
					},
				},
				"Wakelock_in": {
					{
						Type:  "service",
						Start: 1422620456417,
						End:   1422620458417,
						Value: "com.google.android.apps.docs/com.google/noogler@google.com",
						Opt:   "10051",
					},
				},
			},
		},
		{
			desc: "None matching",
			input: []string{
				FileHeader,
				"Mobile network type,string,1422620452417,1422620453917,hspa,",
				"Charging status,string,1422620452417,1422620453917,c,",
				"Mobile network type,string,1422620453917,1422620454417,lte,",
				"Reboot,bool,1422620454417,1430000000000,true,",
				`CPU running,string,1430000001000,1430000003000,"1430000001000~57:qcom,smd-modem:200:qcom,smd-rpm|1430000003000~Abort:Some devices failed to suspend",`,
				`CPU running,string,1430000003000,1430000003000,"1430000003000~57:qcom,smd-modem:200:qcom,smd-rpm",`,
			},
			metrics: []string{"Temperature", "Level"},
			wantEvents: map[string][]Event{
				"Temperature": nil,
				"Level":       nil,
			},
		},
		{
			desc: "Errors in parsing",
			input: []string{
				FileHeader,
				"Mobile network type,string,1422620452417,1422620453917,hspa,",
				"Reboot,bool,notanumber,1430000000000,1430000000000,",
				"Reboot,bool,1422620454417,1430000000000,",
				"Charging status,string,1422620452417,1422620453917,c,",
				"Mobile network type,string,1422620453917,1422620454417,lte,",
				"Reboot,bool,1422620454417,1430000000000,true,",
			},
			metrics: []string{"Reboot"},
			wantEvents: map[string][]Event{
				"Reboot": {
					{
						Type:  "bool",
						Start: 1422620454417,
						End:   1430000000000,
						Value: "true",
						Opt:   "",
					},
				},
			},
			wantErrs: []error{
				errors.New(`record 2: strconv.ParseInt: parsing "notanumber": invalid syntax`),
				errors.New(`record 3: non matching [Reboot bool 1422620454417 1430000000000 ], len was 5`),
			},
		},
	}
	for _, test := range tests {
		input := strings.Join(test.input, "\n")
		got, errs := ExtractEvents(input, test.metrics)
		want := test.wantEvents
		if !reflect.DeepEqual(errs, test.wantErrs) {
			t.Errorf("%v: ExtractEvents(%v) generated unexpected errors\n got %v\n want %v", test.desc, test.input, errs, test.wantErrs)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: ExtractEvents(%v) generated incorrect events:\n got: %q\n want: %q", test.desc, test.input, got, want)
		}
	}
}
