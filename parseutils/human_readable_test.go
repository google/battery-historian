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

package parseutils

import (
	"io/ioutil"
	"reflect"
	"strings"
	"testing"
)

// TestParseHistory tests the mapping of timestamps to deltas from the checkin battery history in a bug report.
func TestParseHistory(t *testing.T) {
	tests := []struct {
		desc            string
		input           string
		wantTimeToDelta map[string]string
	}{
		{
			"Shutdown event",
			strings.Join([]string{
				`9,hsp,3,10010,"com.google.android.gms/.gcm.nts.TaskExecutionService"`,
				`9,h,0:RESET:TIME:1424553841351`,
				`9,h,334,+Ejb=3`,
				`9,h,22,-Ejb=3`,
				`9,h,2000:SHUTDOWN`,
				`9,h,23:START`,
				`9,h,0:TIME:1424664683701`,
				`9,h,10000,Bl=85,Bs=d,Bh=g,Bp=n,Bt=283,Bv=4057,+r,wr=92`,
			}, "\n"),
			map[string]string{
				"1424553841351": "0",
				"1424553841685": "+334ms",
				"1424553841707": "+356ms",
				"1424553843707": "+2s356ms",
				"1424664683701": "+2s379ms",
				"1424664693701": "+12s379ms",
			},
		},
		{
			"Multiple time statements",
			strings.Join([]string{
				`9,hsp,176,10117,"com.northpark.drinkwater`,
				`9,h,0:RESET:TIME:1439187859870`,
				`9,h,1000,Wsp=scan`,
				`9,h,1000:TIME:1424664752248`,
				`9,h,4,Wsp=asced`,
			}, "\n"),
			map[string]string{
				"1424664750248": "0",
				"1424664751248": "+1s000ms",
				"1424664752248": "+2s000ms",
				"1424664752252": "+2s004ms",
			},
		},
		{
			"Larger deltas",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1439187859870`,
				`9,h,193300003,Wsp=scan`,
			}, "\n"),
			map[string]string{
				"1439187859870": "0",
				"1439381159873": "+2d05h41m40s003ms",
			},
		},
		{
			"Largest unit is milliseconds",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1000`,
				`9,h,100,Wsp=scan`,
			}, "\n"),
			map[string]string{
				"1000": "0",
				"1100": "+100ms",
			},
		},
		{
			"Largest unit is seconds",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1000`,
				`9,h,1000,Wsp=scan`,
			}, "\n"),
			map[string]string{
				"1000": "0",
				"2000": "+1s000ms",
			},
		},
		{
			"Largest unit is minutes",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1000`,
				`9,h,60001,Wsp=scan`,
			}, "\n"),
			map[string]string{
				"1000":  "0",
				"61001": "+1m00s001ms",
			},
		},
		{
			"Largest unit is hours",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1000`,
				`9,h,3650002,Wsp=scan`,
			}, "\n"),
			map[string]string{
				"1000":    "0",
				"3651002": "+1h00m50s002ms",
			},
		},
		{
			"Largest unit is days",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1000`,
				`9,h,86400000,Wsp=scan`,
			}, "\n"),
			map[string]string{
				"1000":     "0",
				"86401000": "+1d00h00m00s000ms",
			},
		},
	}

	for _, test := range tests {
		got := AnalyzeHistory(ioutil.Discard, test.input, FormatTotalTime, PackageUIDMapping{}, true)

		if !reflect.DeepEqual(got.TimeToDelta, test.wantTimeToDelta) {
			t.Errorf("%v AnalyzeHistory(%s).TimeToDelta\n got %v\n expected %v", test.desc, test.input, got.TimeToDelta, test.wantTimeToDelta)
		}
	}
}
