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

package dmesg

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/google/battery-historian/csv"
)

// TestParse tests the generation of CSV entries from the kernel dmesg logs.
func TestParse(t *testing.T) {
	tests := []struct {
		desc  string
		input []string

		wantData Data
	}{
		{
			desc: "Low memory killer event",
			input: []string{
				`<6>[24448.456280] PM: suspend exit 2015-08-28 01:32:45.111006517 UTC`,
				`<4>[24449.434767] dhd_set_suspend: Remove extra suspend setting`,
				`<6>[24450.470350] lowmemorykiller: Killing 'facebook.katana' (20003), adj 1000,`, // 2s 14ms after suspend exit.
			},
			wantData: Data{
				CSV: strings.Join([]string{
					csv.FileHeader,
					`Low memory killer,service,1440725567125,1440725567125,"Killing 'facebook.katana' (20003), adj 1000,",`,
				}, "\n"),
				StartMs: 1440725565111, // Time of suspend exit.
			},
		},
		{
			desc: "First seen timestamp is suspend exit, low memory killer event prior to it",
			input: []string{
				`<6>[24448.455350] lowmemorykiller: Killing 'facebook.katana' (20003), adj 1000,`, // During suspend.
				`<6>[24448.456280] PM: suspend exit 2015-08-28 01:32:45.111006517 UTC`,
			},
			wantData: Data{
				StartMs: 1440725565110, // lowmemorykiller was first event.
				CSV: strings.Join([]string{
					csv.FileHeader, // No events.
				}, "\n"),
				Errs: []error{errors.New("Low memory killer event during suspend")},
			},
		},
		{
			desc: "First seen timestamp is suspend entry, low memory event prior to it",
			input: []string{
				`<6>[24447.446350] lowmemorykiller: Killing 'facebook.katana' (20003), adj 1000,`, // 1s 10ms before suspend enter.
				`<6>[24448.456280] PM: suspend entry 2015-08-28 01:32:45.111006517 UTC`,
			},
			wantData: Data{
				CSV: strings.Join([]string{
					csv.FileHeader,
					`Low memory killer,service,1440725564101,1440725564101,"Killing 'facebook.katana' (20003), adj 1000,",`,
				}, "\n"),
				StartMs: 1440725564101, // lowmemorykiller was first event.
			},
		},
		{
			desc: "Multiple timestamps",
			input: []string{
				`<6>[24448.456280] PM: suspend exit 2015-08-28 01:32:45.111006517 UTC`,
				`<6>[24449.456280] lowmemorykiller: Killing 'facebook.katana' (20003), adj 1000,`, // 1s after suspend exit.
				`<6>[24450.456280] lowmemorykiller: Killing 'android.vending' (21432), adj 1000,`, // 2s after suspend exit.
				`<6>[24451.456280] PM: suspend entry 2015-08-28 01:32:48.111006517 UTC`,
				`<6>[24451.856280] PM: suspend exit 2015-08-28 01:36:15.2345006517 UTC`,           // Suspended for 30s.
				`<6>[24452.856280] lowmemorykiller: Killing 'me.lyft.android' (21326), adj 1000,`, // 1s after suspend exit.
			},
			wantData: Data{
				CSV: strings.Join([]string{
					csv.FileHeader,
					`Low memory killer,service,1440725566111,1440725566111,"Killing 'facebook.katana' (20003), adj 1000,",`,
					`Low memory killer,service,1440725567111,1440725567111,"Killing 'android.vending' (21432), adj 1000,",`,
					`Low memory killer,service,1440725776234,1440725776234,"Killing 'me.lyft.android' (21326), adj 1000,",`,
				}, "\n"),
				StartMs: 1440725565111, // Time of suspend exit.
			},
		},
		{
			desc: "SELinux denials",
			input: []string{
				`<6>[64524.124339] PM: suspend exit 2016-02-29 19:34:06.906699640 UTC`,
				`<36>[64525.125774] type=1400 audit(1456774448.669:1456): avc: denied { read } for pid=2325 comm="DnsConfigServic" name="/" dev="rootfs" ino=1 scontext=u:r:untrusted_app:s0:c512,c768 tcontext=u:object_r:rootfs:s0 tclass=dir permissive=0`,
				`<36>[64550.127026] type=1400 audit(1456774473.483:1457): avc: denied { read } for pid=2361 comm="DnsConfigServic" name="/" dev="rootfs" ino=1 scontext=u:r:untrusted_app:s0:c512,c768 tcontext=u:object_r:rootfs:s0 tclass=dir permissive=0`,
			},
			wantData: Data{
				CSV: strings.Join([]string{
					csv.FileHeader,
					`SELinux denial,service,1456774447907,1456774447907,"type=1400 audit(1456774448.669:1456): avc: denied { read } for pid=2325 comm=""DnsConfigServic"" name=""/"" dev=""rootfs"" ino=1 scontext=u:r:untrusted_app:s0:c512,c768 tcontext=u:object_r:rootfs:s0 tclass=dir permissive=0",`,
					`SELinux denial,service,1456774472909,1456774472909,"type=1400 audit(1456774473.483:1457): avc: denied { read } for pid=2361 comm=""DnsConfigServic"" name=""/"" dev=""rootfs"" ino=1 scontext=u:r:untrusted_app:s0:c512,c768 tcontext=u:object_r:rootfs:s0 tclass=dir permissive=0",`,
				}, "\n"),
				StartMs: 1456774446906, // Time of suspend exit.
			},
		},
	}
	for _, test := range tests {
		got := Parse(strings.Join(test.input, "\n"))
		want := test.wantData
		got.CSV = strings.TrimSpace(got.CSV)
		want.CSV = strings.TrimSpace(want.CSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: Parse(%v)\n got: %v\n\n want: %v", test.desc, strings.Join(test.input, "\n"), got, want)
		}
	}
}
