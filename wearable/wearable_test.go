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

package wearable

import (
	"reflect"
	"strings"
	"testing"

	"github.com/google/battery-historian/csv"
)

// Tests the generating of CSV entries from a Kernel Wakesource logging file.
func TestParse(t *testing.T) {
	tests := []struct {
		desc       string
		location   string
		input      string
		wantCSV    string
		matched    bool
		wantErrors []error
	}{
		{
			"Single RPC Reading",
			"America/Los_Angeles",
			strings.Join([]string{
				`SERVICE com.google.android.gms/.wearable.service.WearableService d7440b7 pid=744`,
				`  Client:`,
				`    #####################################`,
				`    ZRpcTracker`,
				`    num events: 300, bytes used: 38951`,
				`    2016-06-21 12:13:46.408-0700: inbound  [104:2853] 9bbd1b8c -> 691153a1 (via 9bbd1b8c) com.google.android.wearable.app /clockwork_proxy/proxy 237`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Wearable RPC,direct,1466536426408,1466536426408,direct: inbound from 9bbd1b8c to 691153a1 via 9bbd1b8c com.google.android.wearable.app /clockwork_proxy/proxy 237,`,
			}, "\n"),
			true,
			nil,
		},
		{
			"Single Transport Reading",
			"America/Los_Angeles",
			strings.Join([]string{
				`SERVICE com.google.android.gms/.wearable.service.WearableService d7440b7 pid=744`,
				`  Client:`,
				`    #####################################`,
				`    WearableTransport`,
				`        STUCK WHILE WRITING 00:02`,
				`        Old: 2016-06-03 12:38:02, writes/reads (29/29), bytes (158100/57934), duration 00:12, writer threw IOException: Broken pipe`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Wearable Transport,transport,1464982682000,1464982694000,writes/reads (29/29)  bytes (158100/57934)  writer threw IOException: Broken pipe,`,
			}, "\n"),
			true,
			nil,
		},
	}
	for _, test := range tests {
		matched, output, errs := Parse(test.input, test.location)
		if matched != test.matched {
			t.Errorf("%v: Parse(%v) matched was %v, want %v", test.desc, test.input, matched,
				test.matched)
		}
		if !test.matched {
			continue
		}

		got := normalizeCSV(output)
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: Parse(%v) outputted csv = %q, want: %q", test.desc, test.input, got,
				want)
		}
		if !reflect.DeepEqual(errs, test.wantErrors) {
			t.Errorf("%v: Parse(%v) unexpected errors = %v, want: %v", test.desc, test.input,
				errs, test.wantErrors)
		}
	}
}

// Removes trailing space at the end of the string, then splits by new line.
func normalizeCSV(text string) []string {
	return strings.Split(strings.TrimSpace(text), "\n")
}
