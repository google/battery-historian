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

package wakeupreason

import (
	"errors"
	"fmt"
	"reflect"
	"sort"
	"testing"
)

func TestFindSubsystem(t *testing.T) {
	tests := []struct {
		name        string
		device      string
		input       string
		wantResult  string
		wantUnknown []string
		wantErr     error
	}{
		{
			name:    "no device given",
			input:   "200:qcom,smd-rpm:203:fc4281d0.qcom,mpm:304:qpnp_adc_tm_interrupt:338:bq24192_irq",
			wantErr: errInputParams,
		},
		{
			name:    "no reason given",
			device:  "hammerhead",
			wantErr: errInputParams,
		},
		{
			name:    "invalid device given",
			device:  "not_a_real_device",
			input:   "200:qcom,smd-rpm:203:fc4281d0.qcom,mpm:304:qpnp_adc_tm_interrupt:338:bq24192_irq",
			wantErr: ErrDeviceNotFound,
		},
		{
			name:        "random hammerhead reason",
			device:      "hammerhead",
			input:       "random:reason",
			wantResult:  "random:reason", // Unknowns are added to the result as is.
			wantUnknown: []string{"random:reason"},
		},
		{
			name:       "single hammerhead reason",
			device:     "hammerhead",
			input:      "304:qpnp_adc_tm_interrupt",
			wantResult: wakeupReasonN5["304$qpnp_adc_tm_interrupt"],
		},
		{
			name:    "only bullhead missingSpmi reason",
			device:  "bullhead",
			input:   "222:fc4cf000.qcom,spmi",
			wantErr: errors.New(missingSpmi),
		},
		{
			name:    "only angler ignoreSubsystem reason",
			device:  "angler",
			input:   "57:qcom,smd-modem",
			wantErr: fmt.Errorf("%s: %q", reasonFormatErr, "57:qcom,smd-modem"),
		},
		{
			name:       "two hammerhead reasons, one is ignoreSubsystem",
			device:     "hammerhead",
			input:      "304:qpnp_adc_tm_interrupt:200:qcom,smd-rpm",
			wantResult: wakeupReasonN5["304$qpnp_adc_tm_interrupt"],
		},
		{
			name:       "two angler reasons, one is missingSpmi",
			device:     "angler",
			input:      "459:qpnp_rtc_alarm:222:fc4cf000.qcom,spmi",
			wantResult: wakeupReasonN6p["459$qpnp_rtc_alarm"],
		},
		{
			name:       "four hammerhead reasons, contains two ignoreSubsystem",
			device:     "hammerhead",
			input:      "200:qcom,smd-rpm:203:fc4281d0.qcom,mpm:304:qpnp_adc_tm_interrupt:338:bq24192_irq",
			wantResult: wakeupReasonN5["304$qpnp_adc_tm_interrupt"] + ", " + wakeupReasonN5["338$bq24192_irq"],
		},
		{
			name:        "four bullhead reasons, contains two unknowns and one ignoreSubsystem",
			device:      "bullhead",
			input:       "200:qcom,smd-rpm:random:reason:458:qpnp_adc_tm_low_interrupt:magic:wakeup",
			wantResult:  "random:reason, " + wakeupReasonN5x["458$qpnp_adc_tm_low_interrupt"] + ", magic:wakeup",
			wantUnknown: []string{"random:reason", "magic:wakeup"},
		},
	}

	for _, test := range tests {
		desc := fmt.Sprintf("Test %q FindSubsystem(%s, %s)", test.name, test.device, test.input)
		res, un, err := FindSubsystem(test.device, test.input)
		if err != nil {
			if test.wantErr == nil {
				t.Errorf("%s produced unexpected error: %v", desc, err)
			} else if test.wantErr.Error() != err.Error() {
				t.Errorf("%s produced incorrect error. Got %v, want %v", desc, err, test.wantErr)
			}
			continue
		}
		if test.wantErr != nil {
			t.Errorf("%s didn't produce expected error", desc)
			continue
		}
		sort.Strings(test.wantUnknown)
		sort.Strings(un)
		if !reflect.DeepEqual(test.wantUnknown, un) {
			t.Errorf("%s didn't identify correct unknowns.\n  Got %v\n  Want %v", desc, un, test.wantUnknown)
		}
		if res != test.wantResult {
			t.Errorf("%s didn't produce correct result:\n  Got %q\n  Want %q", desc, res, test.wantResult)
		}
	}
}
