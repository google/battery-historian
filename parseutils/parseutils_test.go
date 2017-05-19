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
	"bytes"
	"errors"
	"fmt"
	"io/ioutil"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/golang/protobuf/proto"
	"github.com/google/battery-historian/csv"

	usagepb "github.com/google/battery-historian/pb/usagestats_proto"
)

var emptyUIDPackageMapping = PackageUIDMapping{}

// TestEcnParse tests the parsing of Ecn entries in a history log.
func TestEcnParse(t *testing.T) {
	tests := []struct {
		desc        string
		input       string
		wantSummary map[string]Dist
		wantCSV     string
	}{
		{
			"Wifi, mobile connect and multiple disconnects",
			strings.Join([]string{
				`9,0,i,vers,11,116,LMY06B,LMY06B`,
				`9,hsp,3,1,"CONNECTED"`,
				`9,hsp,28,1,"DISCONNECTED"`,
				`9,hsp,30,0,"CONNECTED"`,
				`9,hsp,46,0,"DISCONNECTED"`,
				`9,h,0:RESET:TIME:1422620451417`,
				`9,h,1000,Ecn=3`,
				`9,h,2000,Ecn=28`,
				`9,h,2000,Ecn=28`,
				`9,h,1000,Ecn=30`,
				`9,h,1000,Ecn=46`,
				`9,h,1000,Ecn=3`,
				`9,h,1000,Ecn=28`,
			}, "\n"),
			map[string]Dist{
				`TYPE_WIFI:"CONNECTED"`: {
					Num:           2,
					TotalDuration: 3 * time.Second,
					MaxDuration:   2 * time.Second,
				},
				`TYPE_MOBILE:"CONNECTED"`: {
					Num:           1,
					TotalDuration: 1 * time.Second,
					MaxDuration:   1 * time.Second,
				},
			},
			strings.Join([]string{
				csv.FileHeader,
				`Network connectivity,service,1422620452417,1422620454417,"TYPE_WIFI:""CONNECTED""",`,
				`Network connectivity,service,1422620457417,1422620458417,"TYPE_MOBILE:""CONNECTED""",`,
				`Network connectivity,service,1422620459417,1422620460417,"TYPE_WIFI:""CONNECTED""",`,
			}, "\n"),
		},
		{
			"First entry is a disconnect",
			strings.Join([]string{
				`9,0,i,vers,11,116,LMY06B,LMY06B`,
				`9,hsp,3,1,"CONNECTED"`,
				`9,hsp,28,1,"DISCONNECTED"`,
				`9,h,0:RESET:TIME:1422620451417`,
				`9,h,2000,Ecn=28`,
				`9,h,1000,Ecn=3`,
				`9,h,1000,Ecn=28`,
			}, "\n"),
			map[string]Dist{
				`TYPE_WIFI:"CONNECTED"`: {
					Num:           2,
					TotalDuration: 3 * time.Second,
					MaxDuration:   2 * time.Second,
				},
			},
			strings.Join([]string{
				csv.FileHeader,
				`Network connectivity,service,1422620451417,1422620453417,"TYPE_WIFI:""CONNECTED""",`,
				`Network connectivity,service,1422620454417,1422620455417,"TYPE_WIFI:""CONNECTED""",`,
			}, "\n"),
		},
		{
			"Large Network connectivity test",
			strings.Join([]string{
				`9,hsp,3,1,"CONNECTED"`,
				`9,hsp,28,1,"DISCONNECTED"`,
				`9,hsp,30,0,"CONNECTED"`,
				`9,hsp,37,5,"CONNECTED"`,
				`9,hsp,38,5,"DISCONNECTED"`,
				`9,hsp,46,0,"DISCONNECTED"`,
				`9,hsp,121,3,"CONNECTED"`,
				`9,hsp,122,3,"DISCONNECTED"`,
				`9,h,0:RESET:TIME:1422620451417`,
				`9,h,1090,Ecn=3`,
				`9,h,1068,Ecn=28`,
				`9,h,33,Ecn=28`,
				`9,h,17190,Ecn=30`,
				`9,h,120,Ecn=37`,
				`9,h,3693,Ecn=38`,
				`9,h,396,Ecn=30`,
				`9,h,964,Ecn=46`,
				`9,h,9,Ecn=3`,
				`9,h,2151,Ecn=28`,
				`9,h,41,Ecn=28`,
				`9,h,3714,Ecn=30`,
				`9,h,2039,Ecn=46`,
				`9,h,10,Ecn=3`,
				`9,h,3214,Ecn=28`,
				`9,h,106,Ecn=28`,
				`9,h,3866,Ecn=30`,
				`9,h,1179,Ecn=121`,
				`9,h,338,Ecn=122`,
				`9,h,166,Ecn=30`,
				`9,h,1070,Ecn=121`,
				`9,h,249,Ecn=122`,
				`9,h,6,Ecn=30`,
				`9,h,3329,Ecn=121`,
				`9,h,2183,Ecn=122`,
				`9,h,14,Ecn=30`,
				`9,h,182,Ecn=46`,
				`9,h,485,Ecn=3`,
				`9,h,2144,Ecn=121`,
				`9,h,720,Ecn=122`,
				`9,h,182,Ecn=28`,
				`9,h,5,Ecn=28`,
				`9,h,627,Ecn=30`,
				`9,h,43,Ecn=46`,
				`9,h,7,Ecn=3`,
				`9,h,1,+Wl`, // Extra line needed to test that summarizing of an ongoing connection (Ecn=3) works properly.
			}, "\n"),
			map[string]Dist{
				`TYPE_WIFI:"CONNECTED"`: {
					Num:           5,
					TotalDuration: 9480 * time.Millisecond,
					MaxDuration:   3214 * time.Millisecond,
				},
				`TYPE_MOBILE:"CONNECTED"`: {
					Num:           4,
					TotalDuration: 15971 * time.Millisecond,
					MaxDuration:   8716 * time.Millisecond,
				},
				`TYPE_MOBILE_HIPRI:"CONNECTED"`: {
					Num:           1,
					TotalDuration: 3693 * time.Millisecond,
					MaxDuration:   3693 * time.Millisecond,
				},
				`TYPE_MOBILE_SUPL:"CONNECTED"`: {
					Num:           4,
					TotalDuration: 3490 * time.Millisecond,
					MaxDuration:   2183 * time.Millisecond,
				},
			},
			strings.Join([]string{
				csv.FileHeader,
				`Network connectivity,service,1422620452507,1422620453575,"TYPE_WIFI:""CONNECTED""",`,
				`Network connectivity,service,1422620470918,1422620474611,"TYPE_MOBILE_HIPRI:""CONNECTED""",`,
				`Network connectivity,service,1422620470798,1422620475971,"TYPE_MOBILE:""CONNECTED""",`,
				`Network connectivity,service,1422620475980,1422620478131,"TYPE_WIFI:""CONNECTED""",`,
				`Network connectivity,service,1422620481886,1422620483925,"TYPE_MOBILE:""CONNECTED""",`,
				`Network connectivity,service,1422620483935,1422620487149,"TYPE_WIFI:""CONNECTED""",`,
				`Network connectivity,service,1422620492300,1422620492638,"TYPE_MOBILE_SUPL:""CONNECTED""",`,
				`Network connectivity,service,1422620493874,1422620494123,"TYPE_MOBILE_SUPL:""CONNECTED""",`,
				`Network connectivity,service,1422620497458,1422620499641,"TYPE_MOBILE_SUPL:""CONNECTED""",`,
				`Network connectivity,service,1422620491121,1422620499837,"TYPE_MOBILE:""CONNECTED""",`,
				`Network connectivity,service,1422620502466,1422620503186,"TYPE_MOBILE_SUPL:""CONNECTED""",`,
				`Network connectivity,service,1422620500322,1422620503368,"TYPE_WIFI:""CONNECTED""",`,
				`Network connectivity,service,1422620504000,1422620504043,"TYPE_MOBILE:""CONNECTED""",`,
				`Network connectivity,service,1422620504050,1422620504051,"TYPE_WIFI:""CONNECTED""",`,
				"Wifi full lock,bool,1422620504051,1422620504051,true,",
			}, "\n"),
		},
		{
			"Wifi & mobile changes with SUSPENDED",
			strings.Join([]string{
				`9,0,i,vers,14,130,MDA37B,MDA41B`,
				`9,hsp,34,3,"CONNECTED"`,
				`9,hsp,35,3,"DISCONNECTED"`,
				`9,hsp,92,1,"DISCONNECTED"`,
				`9,hsp,93,0,"CONNECTED"`,
				`9,hsp,106,0,"SUSPENDED"`,
				`9,hsp,107,5,"SUSPENDED"`,
				`9,hsp,110,5,"DISCONNECTED"`,
				`9,h,0:RESET:TIME:1422620500000`,
				`9,h,1000,Ecn=34`,
				`9,h,2000,Ecn=35`,
				`9,h,1000,Ecn=92`, // First log is wifi DISCONNECTED, so should assume it was CONNECTED until now.
				`9,h,1000,Ecn=93`,
				`9,h,2000,Ecn=34`,
				`9,h,2000,Ecn=35`,
				`9,h,2000,Ecn=93`,  // mobile CONNECTED that should follow a DISCONNECT. No-op for parsing.
				`9,h,2000,Ecn=106`, // mobile CONNECTED to SUSPENDED.
				`9,h,2000,Ecn=107`, // First log is SUSPENDED, so should assume it was CONNECTED until now.
				`9,h,2000,Ecn=93`,  // SUSPENDED TO CONNECTED
				`9,h,2000,Ecn=110`, // SUSPENDED TO DISCONNECTED
				`9,h,2000,Ecn=106`, // mobile CONNECTED TO SUSPENDED, also test that summarizing of an ongoing suspended connection works properly.
			}, "\n"),
			map[string]Dist{
				// 0 = TYPE_MOBILE
				`TYPE_MOBILE:"CONNECTED"`: {
					Num:           2,
					TotalDuration: 12 * time.Second,
					MaxDuration:   8 * time.Second,
				},
				`TYPE_MOBILE:"SUSPENDED"`: {
					Num:           2,
					TotalDuration: 4 * time.Second,
					MaxDuration:   4 * time.Second,
				},
				// 1 = TYPE_WIFI
				`TYPE_WIFI:"CONNECTED"`: {
					Num:           1,
					TotalDuration: 4 * time.Second,
					MaxDuration:   4 * time.Second,
				},
				// 3 = TYPE_MOBILE_SUPL
				`TYPE_MOBILE_SUPL:"CONNECTED"`: {
					Num:           2,
					TotalDuration: 4 * time.Second,
					MaxDuration:   2 * time.Second,
				},
				// 5 = TYPE_MOBILE_HIPRI
				`TYPE_MOBILE_HIPRI:"CONNECTED"`: {
					Num:           1,
					TotalDuration: 15 * time.Second,
					MaxDuration:   15 * time.Second,
				},
				`TYPE_MOBILE_HIPRI:"SUSPENDED"`: {
					Num:           1,
					TotalDuration: 4 * time.Second,
					MaxDuration:   4 * time.Second,
				},
			},
			strings.Join([]string{
				csv.FileHeader,
				`Network connectivity,service,1422620501000,1422620503000,"TYPE_MOBILE_SUPL:""CONNECTED""",`,
				`Network connectivity,service,1422620500000,1422620504000,"TYPE_WIFI:""CONNECTED""",`,
				`Network connectivity,service,1422620507000,1422620509000,"TYPE_MOBILE_SUPL:""CONNECTED""",`,
				`Network connectivity,service,1422620505000,1422620513000,"TYPE_MOBILE:""CONNECTED""",`,
				`Network connectivity,service,1422620500000,1422620515000,"TYPE_MOBILE_HIPRI:""CONNECTED""",`,
				`Network connectivity,service,1422620513000,1422620517000,"TYPE_MOBILE:""SUSPENDED""",`,
				`Network connectivity,service,1422620515000,1422620519000,"TYPE_MOBILE_HIPRI:""SUSPENDED""",`,
				`Network connectivity,service,1422620517000,1422620521000,"TYPE_MOBILE:""CONNECTED""",`,
				`Network connectivity,service,1422620521000,1422620521000,"TYPE_MOBILE:""SUSPENDED""",`,
			}, "\n"),
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, 0, 1)

		s := result.Summaries[0]
		if !reflect.DeepEqual(test.wantSummary, s.ConnectivitySummary) {
			t.Errorf("%v: AnalyzeHistory(%s,...).Summaries[0].ConnectivitySummary output incorrect:\n  got %v\n  want %v", test.desc, test.input, s.ConnectivitySummary, test.wantSummary)
		}

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) generated incorrect csv:\n  got: %q\n  want: %q", test.desc, test.input, got, want)
		}
	}
}

func TestAnalyzeOverTimeJump(t *testing.T) {
	input := strings.Join([]string{
		`9,0,i,vers,11,116,LMY06B,LMY06B`,
		`9,hsp,8,10013,"com.google.android.gms.fitness/com.google/sergey@google.com"`,
		`9,hsp,24,1010083,"gmail-ls/com.google/page@google.com"`,
		`9,h,0:RESET:TIME:1422620451417`,
		`9,h,20,+Esy=8`,
		`9,h,275,-Esy=8`,
		`9,h,9,+Esy=24`,
		`9,h,1494:TIME:1422654277857`,
		`9,h,658,-Esy=24`,
		`9,h,8,+Esy=8`,
		`9,h,52,-Esy=8`,
	}, "\n")
	want := newActivitySummary(FormatBatteryLevel)
	want.StartTimeMs = 1422654276059
	want.EndTimeMs = 1422654278575
	want.PerAppSyncSummary[`"gmail-ls/com.google/XXX@google.com"`] = Dist{
		Num:           1,
		TotalDuration: 2152 * time.Millisecond,
		MaxDuration:   2152 * time.Millisecond,
	}
	want.PerAppSyncSummary[`"com.google.android.gms.fitness/com.google/XXX@google.com"`] = Dist{
		Num:           2,
		TotalDuration: 327 * time.Millisecond,
		MaxDuration:   275 * time.Millisecond,
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatBatteryLevel, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 0, 1)

	s := result.Summaries[0]
	if want.StartTimeMs != s.StartTimeMs {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].StartTimeMs = %d, want %d", input, s.StartTimeMs, want.StartTimeMs)
	}
	if want.EndTimeMs != s.EndTimeMs {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].EndTimeMs = %d, want %d", input, s.EndTimeMs, want.EndTimeMs)
	}
	if !reflect.DeepEqual(want.PerAppSyncSummary, s.PerAppSyncSummary) {
		// TODO: write function that find the difference between maps
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].PerAppSyncSummary = %v, want %v", input, s.PerAppSyncSummary, want.PerAppSyncSummary)
	}
}

func TestShutdownWithTimeJump(t *testing.T) {
	input := strings.Join([]string{
		"9,0,i,vers,12,116,LVX72L,LVY29G",
		"9,h,0:RESET:TIME:141688070",
		"9,h,0,Bl=46,Bs=d,Bh=g,Bp=u,Bt=326,Bv=3814,+r,+BP",
		"9,h,292:TIME:141688362",
		"9,h,36838,Bt=336",
		"9,h,35075,Bt=346",
		"9,h,35069,Bt=356",
		"9,h,40091,Bt=366",
		"9,h,40087,Bt=376",
		"9,h,50105,Bt=386",
		"9,h,17555,+s,+S",
		"9,h,311,-S",
		"9,h,207,Bp=n,Bt=390,Bv=3815,-BP",
		"9,h,4:START",
		"9,h,0:TIME:507421",
		"9,h,6996,Bl=44,Bs=d,Bh=g,Bp=n,Bt=285,Bv=3703,+r",
		"9,h,85:TIME:514503",
		"9,h,1686,+s,+S",
		"9,h,288,Sb=1",
		"9,h,386,Sb=0,+Eur=2",
		"9,h,309,+a,+Euf=2",
		"9,h,236,Pst=off",
		"9,h,1371,+Psc,Pst=out",
		"9,h,33233,Sb=1",
		"9,h,9286,Bl=43,Bv=3765",
		"9,h,0:TIME:1422918458646",
		"9,h,5571,Bl=58,Bs=d,Bh=g,Bp=n,Bt=227,Bv=3803,+r",
		"9,h,1246,+s,+S,Sb=4",
		"9,h,533,Sb=1,+Wr,+W",
		"9,h,605,-W",
		"9,h,2,+a,+W,Wsp=scan,+Eur=2",
		"9,h,351,-a,",
		"9,h,78,+a",
		"9,h,42,-a,",
		"9,h,47,+a",
		"9,h,71,-a",
		"9,h,24,+a",
		"9,h,35,-a",
		"9,h,73,+a",
		"9,h,43,-a",
		"9,h,34,+a",
		"9,h,31,-a,Pst=off",
		"9,h,1472,+Psc,+a,Pst=out",
		"9,h,906,-a",
		"9,h,43,+a",
		"9,h,31,-a",
		"9,h,50,+a",
		"9,h,37,-Psc,-a,Pst=in",
		"9,h,788:TIME:1422918470191",
		"9,h,900,+Wl,+Ws,+Pr,Pcn=lte,Pss=2",
		"9,h,1065,-Ws",
		"9,h,1299,-Wl",
		"9,h,1629,+Wl,+Ws",
		"9,h,897,-Wl,-Ws",
		"9,h,161,+Eur=137",
		"9,h,3628,+Wl",
		"9,h,4429,+Ws,+a",
		"9,h,1185,-Ws",
		"9,h,3593,Pss=3",
		"9,h,6966,-a",
		"9,h,2215,-W",
		"9,h,980,+W",
		"9,h,3043,+S",
		"9,h,0,-S",
		"9,h,1184,+Ws",
		"9,h,193,Bl=57,Bv=3531,-s,-Ws",
		"9,h,5530,Wsp=asced",
		"9,h,771,Wsp=4-way",
		"9,h,21,Wss=4,Wsp=group",
		"9,h,130,+Ws,Wsp=compl",
		"9,h,391,-Ws",
		"9,h,9675,+Ws",
		"9,h,599,-Ws",
		"9,h,2024,+s",
		"9,h,3067,-s,+a",
		"9,h,4291,+Ws",
		"9,h,589,-Ws",
		"9,h,5377,-Wl",
		"9,h,168,+Wl",
		"9,h,734,-Wl",
		"9,h,3138,+Ws,-Pr,Pcn=none",
		"9,h,593,-Ws",
		"9,h,1032,+S",
		"9,h,1181,+Wl",
		"9,h,213,-Wl",
		"9,h,277,+Wl,+Ws",
		"9,h,165,-Wl,-Ws",
		"9,h,492,-S",
		"9,h,709:SHUTDOWN",
		"9,h,38:START",
		"9,h,0:TIME:1422979129104",
		"9,h,5902,Bl=56,Bs=d,Bh=g,Bp=a,Bt=143,Bv=3921,+r,+BP",
		"9,h,1304,+s,+S,Sb=4",
		"9,h,603,Sb=1,+W,+Eur=2",
		"9,h,820,+Euf=2",
	}, "\n")

	wantTotalTime := []*ActivitySummary{
		{
			StartTimeMs: 141688070,
			EndTimeMs:   141943700,
		},
		{
			StartTimeMs: 1422918404202,
			EndTimeMs:   1422918544725,
		},
		{
			StartTimeMs: 1422979129104,
			EndTimeMs:   1422979137733,
		},
	}

	wantBatteryLevel := []*ActivitySummary{
		{
			StartTimeMs: 141688070,
			EndTimeMs:   141943700,
		},
		{
			StartTimeMs: 1422918404202,
			EndTimeMs:   1422918458078,
		},
		{
			StartTimeMs: 1422918458078,
			EndTimeMs:   1422918463649,
		},
		{
			StartTimeMs: 1422918463649,
			EndTimeMs:   1422918503558,
		},
		{
			StartTimeMs: 1422918503558,
			EndTimeMs:   1422918544725,
		},
		{
			StartTimeMs: 1422979129104,
			EndTimeMs:   1422979137733,
		},
	}

	wantErrs := []error{
		errors.New("** Error in 9,h,5571,Bl=58,Bs=d,Bh=g,Bp=n,Bt=227,Bv=3803,+r with +r : consecutive +r events"),
	}

	resultTotalTime := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)

	resultBatteryLevel := AnalyzeHistory(ioutil.Discard, input, FormatBatteryLevel, emptyUIDPackageMapping, true)

	if !reflect.DeepEqual(wantErrs, resultTotalTime.Errs) {
		t.Errorf("AnalyzeHistory(%s,FormatTotalTime,...)\n errs: %v\n want: %v", input, resultTotalTime.Errs, wantErrs)
	}
	if !reflect.DeepEqual(wantErrs, resultBatteryLevel.Errs) {
		t.Errorf("AnalyzeHistory(%s,FormatBatteryLevel,...)\n errs: %v\n want: %v", input, resultBatteryLevel.Errs, wantErrs)
	}

	summariesTotalTime := resultTotalTime.Summaries
	if len(summariesTotalTime) != len(wantTotalTime) {
		t.Errorf("len(AnalyzeHistory(%s,FormatTotalTime,...).Summaries) = %d, want: %d", input, len(summariesTotalTime), len(wantTotalTime))
	} else {
		for i := 0; i < len(wantTotalTime); i++ {
			if wantTotalTime[i].StartTimeMs != summariesTotalTime[i].StartTimeMs {
				t.Errorf("summariesTotalTime[%d].StartTimeMs = %d, want: %d", i, summariesTotalTime[i].StartTimeMs, wantTotalTime[i].StartTimeMs)
			}
			if wantTotalTime[i].EndTimeMs != summariesTotalTime[i].EndTimeMs {
				t.Errorf("summariesTotalTime[%d].EndTimeMs = %d, want: %d", i, summariesTotalTime[i].EndTimeMs, wantTotalTime[i].EndTimeMs)
			}
		}
	}

	summariesBatteryLevel := resultBatteryLevel.Summaries
	if len(summariesBatteryLevel) != len(wantBatteryLevel) {
		t.Errorf("len(AnalyzeHistory(%s,FormatBatterylLevel,...).Summaries) = %d, want: %d", input, len(summariesBatteryLevel), len(wantBatteryLevel))
	} else {
		for i := 0; i < len(wantBatteryLevel); i++ {
			if wantBatteryLevel[i].StartTimeMs != summariesBatteryLevel[i].StartTimeMs {
				t.Errorf("summariesBatteryLevel[%d].StartTimeMs = %d, want: %d", i, summariesBatteryLevel[i].StartTimeMs, wantBatteryLevel[i].StartTimeMs)
			}
			if wantBatteryLevel[i].EndTimeMs != summariesBatteryLevel[i].EndTimeMs {
				t.Errorf("summariesBatteryLevel[%d].EndTimeMs = %d, want: %d", i, summariesBatteryLevel[i].EndTimeMs, wantBatteryLevel[i].EndTimeMs)
			}
		}
	}
}

func TestPerAppSyncSummary(t *testing.T) {
	input := strings.Join([]string{
		`9,0,i,vers,11,116,LMY06B,LMY06B`,
		`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
		`9,hsp,18,1010051,"com.google.android.apps.docs/com.google/noogler@google.com"`,
		`9,hsp,22,1010052,"com.google.android.apps.docs.editors.kix/com.google/noogler@google.com"`,
		`9,h,0:RESET:TIME:1422620451417`,
		`9,h,1020,+Esy=17`,
		`9,h,54,+Esy=18`,
		`9,h,1059,-Esy=18`,
		`9,h,7,-Esy=17`,
		`9,h,171,+Esy=22`,
		`9,h,14,+Esy=17`,
		`9,h,968,-Esy=17`,
		`9,h,7,+Esy=18`,
		`9,h,87,-Esy=22`,
		`9,h,11,+Esy=22`,
		`9,h,560,-Esy=22`,
		`9,h,1047,-Esy=18`,
		`9,h,74,+Esy=17`,
		`9,h,446,-Esy=17`,
		`9,h,4828,+Esy=18`,
		`9,h,1986:TIME:1422620530684`,
		`9,h,332,-Esy=18`,
		`9,h,3187,+Esy=22`,
		`9,h,1062,-Esy=22`,
		`9,h,30,+Esy=18`,
		`9,h,15,-Esy=18`,
		`9,h,107,+Esy=18`,
		`9,h,1001,-Esy=18`,
		`9,h,88,+Esy=22`,
		`9,h,97,+Esy=18`,
		`9,h,792,-Esy=22`,
		`9,h,129,-Esy=18`,
		`9,h,91,+Esy=17`,
		`9,h,150,-Esy=17`,
		`9,h,17616,+Esy=22`,
		`9,h,89,+Esy=18`,
		`9,h,4758,-Esy=22`,
		`9,h,12,+Esy=17`,
		`9,h,350,-Esy=18`,
		`9,h,4637,-Esy=17`,
		`9,h,9,+Esy=22`,
		`9,h,7,-Esy=22`,
		`9,h,24,+Esy=18`,
		`9,h,28,-Esy=18`,
		`9,h,10,+Esy=17`,
		`9,h,10,-Esy=17`,
		`9,h,20,+Esy=22`, // Test a sync that had not ended by the end of the summary.
	}, "\n")
	want := newActivitySummary(FormatBatteryLevel)
	want.StartTimeMs = 1422620518345
	want.EndTimeMs = 1422620565335
	want.PerAppSyncSummary[`"com.google.android.apps.docs.editors.punch/com.google/XXX@google.com"`] = Dist{
		Num:           6,
		TotalDuration: 7681 * time.Millisecond,
		MaxDuration:   4987 * time.Millisecond,
	}
	want.PerAppSyncSummary[`"com.google.android.apps.docs/com.google/XXX@google.com"`] = Dist{
		Num:           8,
		TotalDuration: 12167 * time.Millisecond,
		MaxDuration:   5120 * time.Millisecond,
	}
	want.PerAppSyncSummary[`"com.google.android.apps.docs.editors.kix/com.google/XXX@google.com"`] = Dist{
		Num:           7,
		TotalDuration: 8441 * time.Millisecond,
		MaxDuration:   4847 * time.Millisecond,
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatBatteryLevel, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 0, 1)

	s := result.Summaries[0]
	if want.StartTimeMs != s.StartTimeMs {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].StartTimeMs = %d, want %d", input, s.StartTimeMs, want.StartTimeMs)
	}
	if want.EndTimeMs != s.EndTimeMs {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].EndTimeMs = %d, want %d", input, s.EndTimeMs, want.EndTimeMs)
	}
	if !reflect.DeepEqual(want.PerAppSyncSummary, s.PerAppSyncSummary) {
		// TODO: write function that find the difference between maps
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].PerAppSyncSummary = %v, want %v", input, s.PerAppSyncSummary, want.PerAppSyncSummary)
	}
}

func TestFixTimeline(t *testing.T) {
	input := strings.Join([]string{
		"9,0,i,vers,12,116,LVX72L,LVY29G",
		"9,h,0:RESET:TIME:141688070",
		"9,h,0,Bl=46,Bs=d,Bh=g,Bp=u,Bt=326,Bv=3814,+r,+BP",
		"9,h,292:TIME:141688362",
		"9,h,36838,Bt=336",
		"9,h,207,Bp=n,Bt=390,Bv=3815,-BP",
		"9,h,4:START",
		"9,h,0:TIME:507421",
		"9,h,6996,Bl=44,Bs=d,Bh=g,Bp=n,Bt=285,Bv=3703,+r",
		"9,h,85:TIME:514503",
		"9,h,1686,+s,+S",
		"9,h,288,Sb=1",
		"9,h,386,Sb=0,+Eur=2",
		"9,h,309,+a,+Euf=2",
		"9,h,236,Pst=off",
		"9,h,1371,+Psc,Pst=out",
		"9,h,33233,Sb=1",
		"9,h,9286,Bl=43,Bv=3765",
		"9,h,0:TIME:1422918458646",
		"9,h,5571,Bl=58,Bs=d,Bh=g,Bp=n,Bt=227,Bv=3803,+r",
		"9,h,1246,+s,+S,Sb=4",
		"9,h,533,Sb=1,+Wr,+W",
		"9,h,605,-W",
		"9,h,2,+a,+W,Wsp=scan,+Eur=2",
		"9,h,351,-a,",
		"9,h,906,-a",
		"9,h,43,+a",
		"9,h,31,-a",
		"9,h,50,+a",
		"9,h,37,-Psc,-a,Pst=in",
		"9,h,788:TIME:1422918470191",
		"9,h,900,+Wl,+Ws,+Pr,Pcn=lte,Pss=2",
		"9,h,1065,-Ws",
		"9,h,1299,-Wl",
		"9,h,1629,+Wl,+Ws",
		"9,h,897,-Wl,-Ws",
		"9,h,161,+Eur=137",
		"9,h,3628,+Wl",
		"9,h,4429,+Ws,+a",
		"9,h,1185,-Ws",
		"9,h,3593,Pss=3",
		"9,h,6966,-a",
		"9,h,2215,-W",
		"9,h,980,+W",
		"9,h,3043,+S",
		"9,h,0,-S",
		"9,h,1184,+Ws",
		"9,h,193,Bl=57,Bv=3531,-s,-Ws",
		"9,h,5530,Wsp=asced",
		"9,h,771,Wsp=4-way",
		"9,h,21,Wss=4,Wsp=group",
		"9,h,130,+Ws,Wsp=compl",
		"9,h,391,-Ws",
		"9,h,2024,+s",
		"9,h,3067,-s,+a",
		"9,h,5377,-Wl",
		"9,h,3138,+Ws,-Pr,Pcn=none",
		"9,h,593,-Ws",
		"9,h,1032,+S",
		"9,h,1181,+Wl",
		"9,h,213,-Wl",
		"9,h,492,-S",
		"9,h,709:SHUTDOWN",
		"9,h,38:START",
		"9,h,0:TIME:1422979129104",
		"9,h,5902,Bl=56,Bs=d,Bh=g,Bp=a,Bt=143,Bv=3921,+r,+BP",
		"9,h,820,+Euf=2",
		// Random lines that should be filtered out.
		"9,0,i,uid,10079,com.google.android.youtube",
		"9,0,l,br,326100,171,0,0,1",
	}, "\n")

	want := []string{
		"9,0,i,vers,12,116,LVX72L,LVY29G",
		"9,h,0:RESET:TIME:141688070",
		"9,h,0,Bl=46,Bs=d,Bh=g,Bp=u,Bt=326,Bv=3814,+r,+BP",
		"9,h,292:TIME:141688362",
		"9,h,36838,Bt=336",
		"9,h,207,Bp=n,Bt=390,Bv=3815,-BP",
		"9,h,4:START",
		"9,h,0:TIME:1422918406152",
		"9,h,6996,Bl=44,Bs=d,Bh=g,Bp=n,Bt=285,Bv=3703,+r",
		"9,h,85:TIME:1422918413233",
		"9,h,1686,+s,+S",
		"9,h,288,Sb=1",
		"9,h,386,Sb=0,+Eur=2",
		"9,h,309,+a,+Euf=2",
		"9,h,236,Pst=off",
		"9,h,1371,+Psc,Pst=out",
		"9,h,33233,Sb=1",
		"9,h,9286,Bl=43,Bv=3765",
		"9,h,0:TIME:1422918460028",
		"9,h,5571,Bl=58,Bs=d,Bh=g,Bp=n,Bt=227,Bv=3803,+r",
		"9,h,1246,+s,+S,Sb=4",
		"9,h,533,Sb=1,+Wr,+W",
		"9,h,605,-W",
		"9,h,2,+a,+W,Wsp=scan,+Eur=2",
		"9,h,351,-a,",
		"9,h,906,-a",
		"9,h,43,+a",
		"9,h,31,-a",
		"9,h,50,+a",
		"9,h,37,-Psc,-a,Pst=in",
		"9,h,788:TIME:1422918470191",
		"9,h,900,+Wl,+Ws,+Pr,Pcn=lte,Pss=2",
		"9,h,1065,-Ws",
		"9,h,1299,-Wl",
		"9,h,1629,+Wl,+Ws",
		"9,h,897,-Wl,-Ws",
		"9,h,161,+Eur=137",
		"9,h,3628,+Wl",
		"9,h,4429,+Ws,+a",
		"9,h,1185,-Ws",
		"9,h,3593,Pss=3",
		"9,h,6966,-a",
		"9,h,2215,-W",
		"9,h,980,+W",
		"9,h,3043,+S",
		"9,h,0,-S",
		"9,h,1184,+Ws",
		"9,h,193,Bl=57,Bv=3531,-s,-Ws",
		"9,h,5530,Wsp=asced",
		"9,h,771,Wsp=4-way",
		"9,h,21,Wss=4,Wsp=group",
		"9,h,130,+Ws,Wsp=compl",
		"9,h,391,-Ws",
		"9,h,2024,+s",
		"9,h,3067,-s,+a",
		"9,h,5377,-Wl",
		"9,h,3138,+Ws,-Pr,Pcn=none",
		"9,h,593,-Ws",
		"9,h,1032,+S",
		"9,h,1181,+Wl",
		"9,h,213,-Wl",
		"9,h,492,-S",
		"9,h,709:SHUTDOWN",
		"9,h,38:START",
		"9,h,0:TIME:1422979129104",
		"9,h,5902,Bl=56,Bs=d,Bh=g,Bp=a,Bt=143,Bv=3921,+r,+BP",
		"9,h,820,+Euf=2",
	}

	output, c, err := fixTimeline(input)
	if err != nil {
		t.Error(err)
	}
	if !c {
		t.Error("Timestamps weren't changed.")
	}
	if !reflect.DeepEqual(want, output) {
		t.Errorf("fixTimeline(%v) = %v, want: %v", input, output, want)
	}
}

// TestTotalSyncTime test the summarizing of total sync time and num in a history log
func TestTotalSyncTime(t *testing.T) {
	input := strings.Join([]string{
		`9,hsp,0,10086,"gmail-ls/com.google/XXX@gmail.com"`,
		`9,hsp,1,0,"0"`,
		`9,hsp,2,-1,"screen"`,
		`9,hsp,3,1001,"RILJ"`,
		`9,hsp,4,0,"349:cwmcu"`,
		`9,hsp,5,10085,"*walarm*:ALARM_ACTION(14804)"`,
		`9,hsp,6,0,"118:4-0058:118:4-0058"`,
		`9,hsp,7,0,"374:bcmsdh_sdmmc"`,
		`9,hsp,8,1000,"*alarm*:android.intent.action.TIME_TICK"`,
		`9,hsp,9,1000,"DHCP"`,
		`9,hsp,10,10008,"NlpWakeLock"`,
		`9,h,0:RESET:TIME:1422681992795`,
		`9,h,2145,+Esy=0`,
		`9,h,77,-Esy=0`,
		`9,h,109,+Esy=1`,
		`9,h,19,+Esy=2`,
		`9,h,620,-Esy=1`,
		`9,h,427,-Esy=2`,
		`9,h,5909,+Esy=3`,
		`9,h,79,+Esy=4`,
		`9,h,2178,+Esy=5`,
		`9,h,89,-Esy=4`,
		`9,h,6838,+Esy=6`,
		`9,h,868,-Esy=3`,
		`9,h,94,-Esy=6`,
		`9,h,109,-Esy=5`,
		`9,h,4894,+Esy=7`,
		`9,h,112,+Esy=8`,
		`9,h,3000,-Esy=7`,
		`9,h,2113,-Esy=8`,
		`9,h,432,+Esy=9`,
		`9,h,116,-Esy=9`,
		`9,h,44,+Esy=10`,
		`9,h,887,-Esy=10`,
	}, "\n")

	want := Dist{
		Num:           11,
		TotalDuration: 17626 * time.Millisecond,
		MaxDuration:   10255 * time.Millisecond,
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 0, 1)
	s := result.Summaries[0]

	if !reflect.DeepEqual(want, s.TotalSyncSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].TotalSyncSummary = %v, want %v", input, s.TotalSyncSummary, want)
	}
}

// TestInProgressEvents test the summarizing of events that were in progress at the start or end of the history.
func TestInProgressEvents(t *testing.T) {
	input := strings.Join([]string{
		`9,hsp,0,10086,"gmail-ls/com.google/XXX@gmail.com"`,
		`9,h,0:RESET:TIME:1422681992795`,
		`9,h,4321,-Esy=0`, // In progress sync at the beginning
		`9,h,111,-S`,      // Screen was on at the beginning
		`9,h,4000,+Esy=0`,
		`9,h,1234,-Esy=0`,
		`9,h,1000,+S`,     // In progress screen on
		`9,h,9876,+Esy=0`, // In progress sync at the end with zero duration
	}, "\n")

	syncWant := Dist{
		Num:           3,
		TotalDuration: 5555 * time.Millisecond,
		MaxDuration:   4321 * time.Millisecond,
	}

	screenWant := Dist{
		Num:           2,
		TotalDuration: 14308 * time.Millisecond,
		MaxDuration:   9876 * time.Millisecond,
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 0, 1)
	s := result.Summaries[0]

	if !reflect.DeepEqual(syncWant, s.TotalSyncSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].TotalSyncSummary = %v, want %v", input, s.TotalSyncSummary, syncWant)
	}

	if !reflect.DeepEqual(screenWant, s.ScreenOnSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].ScreenOnSummary = %v, want %v", input, s.ScreenOnSummary, screenWant)
	}
}

// TestTwoServiceUIDNegativeEvents tests an error condition containing two negative transitions.
func TestTwoServiceUIDNegativeEvents(t *testing.T) {
	input := strings.Join([]string{
		`9,hsp,0,10086,"gmail-ls/com.google/XXX@gmail.com"`,
		`9,hsp,1,10051,"com.google.android.apps.docs/com.google/noogler@google.com"`,
		`9,h,0:RESET:TIME:1422681992795`,
		`9,h,4321,+S`,
		`9,h,1000,+Esy=0`,
		`9,h,1234,-S`,
		`9,h,1000,-Esy=0`,
		`9,h,4000,-Esy=1`,
		`9,h,4321,-Esy=0`, // Second negative transition for ServiceUID=0
	}, "\n")

	want := []error{
		fmt.Errorf(`** Error in 9,h,4321,-Esy=0 with -Esy=0 : two negative transitions for "SyncManager":"-"`),
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 1, 1)

	if !reflect.DeepEqual(want, result.Errs) {
		t.Errorf("AnalyzeHistory(%s,...) = %v, want %v", input, result.Errs, want)
	}
}

// TestTwoBooleanNegativeEvents tests an error condition containing two negative transitions.
func TestTwoBooleanNegativeEvents(t *testing.T) {
	input := strings.Join([]string{
		`9,hsp,0,10086,"gmail-ls/com.google/XXX@gmail.com"`,
		`9,h,0:RESET:TIME:1422681992795`,
		`9,h,4321,+S`,
		`9,h,1000,+Esy=0`,
		`9,h,1234,-S`,
		`9,h,1000,-Esy=0`,
		`9,h,4000,-S`, // Second boolean negative transition
	}, "\n")

	want := []error{
		fmt.Errorf(`** Error in 9,h,4000,-S with -S : two negative transitions for "Screen":"-"`),
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 1, 1)

	if !reflect.DeepEqual(want, result.Errs) {
		t.Errorf("AnalyzeHistory(%s,...) = %v, want %v", input, result.Errs, want)
	}
}

// TestScrubPII tests enabling and disabling ScrubPII in AnalyzeHistory.
func TestScrubPII(t *testing.T) {
	input := strings.Join([]string{
		`9,hsp,0,10086,"gmail-ls/com.google/testname@gmail.com"`,
		`9,h,0:RESET:TIME:1422681992795`,
		`9,h,4000,+Esy=0`,
		`9,h,1000,-Esy=0`,
		`9,h,0:RESET:TIME:1422681997795`,
	}, "\n")

	want := map[bool]string{
		true:  `"gmail-ls/com.google/XXX@gmail.com"`,
		false: `"gmail-ls/com.google/testname@gmail.com"`,
	}

	for doScrub, expectedAddress := range want {
		result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, doScrub)
		validateHistory(input, t, result, 0, 1)

		s := result.Summaries[0]

		wantSummary := make(map[string]Dist)
		wantSummary[expectedAddress] = Dist{
			Num:           1,
			TotalDuration: 1 * time.Second,
			MaxDuration:   1 * time.Second,
		}
		if !reflect.DeepEqual(wantSummary, s.PerAppSyncSummary) {
			t.Errorf("AnalyzeHistory(%s,..., %v).Summaries[0].PerAppSyncSummary = %v, want %v", input, doScrub, s.PerAppSyncSummary, wantSummary)
			t.Errorf("Invalid per app sync summary. Got %v, want %v", s.PerAppSyncSummary, wantSummary)
		}
	}
}

// validateHistory checks there were the expected number of errors in the given analysis report,
// and the correct number of summaries.
func validateHistory(input string, t *testing.T, r *AnalysisReport, numErrorsExpected, numSummariesExpected int) {
	if len(r.Errs) != numErrorsExpected {
		t.Errorf("AnalyzeHistory(%v,...) has errs = %v", input, r.Errs)
	}
	if len(r.Summaries) != numSummariesExpected {
		t.Errorf("len(AnalyzeHistory(%v...).Summaries) = %d, want: %d", input, len(r.Summaries), numSummariesExpected)
	}
}

// TestWakeLockParse tests the parsing of wake_lock entries in a history log.
// No wakelock_in entries.
func TestWakeLockParse(t *testing.T) {
	input := strings.Join([]string{
		`9,0,i,vers,11,116,LMY06B,LMY06B`,
		`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
		`9,h,0:RESET:TIME:1422620451417`,
		`9,h,1000,+w=17`,
		`9,h,10000,-w`,
		`9,h,2000,-w`,    // Negative transition without corresponding positive transition.
		`9,h,1000,+w=17`, // Positive transition without corresponding negative transition.
		`9,h,3,+r`,       // Included to make previous +w have a duration > 0.
	}, "\n")

	want := newActivitySummary(FormatTotalTime)
	want.StartTimeMs = 1422620451417
	want.EndTimeMs = 1422620465420
	want.WakeLockSummary[`"com.google.android.apps.docs.editors.punch/com.google/XXX@google.com"`] = Dist{
		Num:           2,
		TotalDuration: 10003 * time.Millisecond,
		MaxDuration:   10000 * time.Millisecond,
	}
	wantCSV := strings.Join([]string{
		csv.FileHeader,
		`Partial wakelock,service,1422620452417,1422620462417,com.google.android.apps.docs.editors.punch/com.google/XXX@google.com,`,
		`Partial wakelock,error,1422620464417,1422620464417,missing corresponding +w,`,
		`Partial wakelock,service,1422620465417,1422620465420,com.google.android.apps.docs.editors.punch/com.google/XXX@google.com,`,
		`CPU running,string,1422620465420,1422620465420,1422620465420~Unknown wakeup reason,`,
	}, "\n")

	var b bytes.Buffer
	result := AnalyzeHistory(&b, input, FormatTotalTime, emptyUIDPackageMapping, true)

	if len(result.Errs) > 0 {
		t.Errorf("Errors encountered while analyzing history: %v", result.Errs)
	}
	if len(result.Summaries) != 1 {
		t.Fatalf("Unwant number of summaries. Got %d, want: %d", len(result.Summaries), 1)
	}
	s := result.Summaries[0]
	if want.StartTimeMs != s.StartTimeMs {
		t.Errorf("Start times do not match. Got: %d, want: %d", want.StartTimeMs, s.StartTimeMs)
	}
	if want.EndTimeMs != s.EndTimeMs {
		t.Errorf("End times do not match. Got: %d, want: %d", want.EndTimeMs, s.EndTimeMs)
	}
	if !reflect.DeepEqual(want.WakeLockSummary, s.WakeLockSummary) {
		t.Errorf("Invalid wake lock summary. Got: %v, want: %v", s.WakeLockSummary, want.WakeLockSummary)
	}

	gotCSV := normalizeCSV(b.String())
	normWantCSV := normalizeCSV(wantCSV)
	if !reflect.DeepEqual(gotCSV, normWantCSV) {
		t.Errorf("AnalyzeHistory(%v) generated incorrect csv:\n  got: %s\n  want: %s", input, gotCSV, normWantCSV)
	}
}

// TestWakeLockInParse tests the parsing of wakelock_in entries in a history log.
// Check that wake lock is still processed even if wakelock_in is present.
func TestWakeLockInParse(t *testing.T) {
	input := strings.Join([]string{
		`9,0,i,vers,11,116,LMY06B,LMY06B`,
		`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
		`9,hsp,22,1010052,"com.google.android.apps.docs.editors.kix/com.google/noogler@google.com"`,
		`9,h,0:RESET:TIME:1422620451417`,
		`9,h,1000,+w=17,+Ewl=17`,
		`9,h,2000,+Ewl=22`,
		`9,h,3000,-Ewl=17`,
		`9,h,5000,-w,-Ewl=22`,
	}, "\n")

	want := newActivitySummary(FormatTotalTime)
	want.StartTimeMs = 1422620451417
	want.EndTimeMs = 1422620462417
	want.WakeLockSummary[`"com.google.android.apps.docs.editors.punch/com.google/XXX@google.com"`] = Dist{
		Num:           1,
		TotalDuration: 10000 * time.Millisecond,
		MaxDuration:   10000 * time.Millisecond,
	}
	want.WakeLockDetailedSummary[`"com.google.android.apps.docs.editors.punch/com.google/XXX@google.com"`] = Dist{
		Num:           1,
		TotalDuration: 5000 * time.Millisecond,
		MaxDuration:   5000 * time.Millisecond,
	}
	want.WakeLockDetailedSummary[`"com.google.android.apps.docs.editors.kix/com.google/XXX@google.com"`] = Dist{
		Num:           1,
		TotalDuration: 8000 * time.Millisecond,
		MaxDuration:   8000 * time.Millisecond,
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)

	if len(result.Errs) > 0 {
		t.Errorf("Errors encountered while analyzing history: %v", result.Errs)
	}
	if len(result.Summaries) != 1 {
		t.Fatalf("Unwant number of summaries. Got %d, want: %d", len(result.Summaries), 1)
	}
	s := result.Summaries[0]
	if want.StartTimeMs != s.StartTimeMs {
		t.Errorf("Start times do not match. Got: %d, want: %d", want.StartTimeMs, s.StartTimeMs)
	}
	if want.EndTimeMs != s.EndTimeMs {
		t.Errorf("End times do not match. Got: %d, want: %d", want.EndTimeMs, s.EndTimeMs)
	}
	if !reflect.DeepEqual(want.WakeLockSummary, s.WakeLockSummary) {
		t.Errorf("Invalid wake lock summary. Got: %v, want: %v", s.WakeLockSummary, want.WakeLockSummary)
	}
}

// TestWakeupReasonParsing tests the parsing of wakeup reason entries in a history log.
func TestWakeupReasonParsing(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantSummary *ActivitySummary
		wantCSV     string
	}{
		{
			name: "Kernel only, no userspace wakelock",
			input: strings.Join([]string{
				`9,0,i,vers,12,116,LMY47D,LMY47D`,
				`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
				`9,hsp,48,0,"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`,
				`9,hsp,90,0,"200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1423000000000`,
				`9,h,5000,+r,wr=48`,
				`9,h,5000,-r`,
			}, "\n"),
			wantSummary: &ActivitySummary{
				StartTimeMs:     1423000000000,
				EndTimeMs:       1423000010000,
				WakeLockSummary: map[string]Dist{},
				WakeupReasonSummary: map[string]Dist{
					`"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`: Dist{
						Num:           1,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1423000005000,1423000010000,"1423000005000~1423000010000~289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio",`,
			}, "\n"),
		},
		{
			name: "Userspace wakelock at the same time as CPU starts running",
			input: strings.Join([]string{
				`9,0,i,vers,12,116,LMY47D,LMY47D`,
				`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
				`9,hsp,48,0,"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`,
				`9,hsp,90,0,"200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1423000000000`,
				`9,h,5000,+r,wr=48,+w=17`,
				`9,h,5000,-r,-w`,
			}, "\n"),
			wantSummary: &ActivitySummary{
				StartTimeMs: 1423000000000,
				EndTimeMs:   1423000010000,
				WakeLockSummary: map[string]Dist{
					`"com.google.android.apps.docs.editors.punch/com.google/XXX@google.com"`: Dist{
						Num:           1,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
				},
				WakeupReasonSummary: map[string]Dist{
					`"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`: Dist{
						Num:           1,
						TotalDuration: 0, // Userspace wakelock was acquired as soon as the CPU started running.
						MaxDuration:   0,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1423000005000,1423000010000,"1423000005000~289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio",`,
				`Partial wakelock,service,1423000005000,1423000010000,com.google.android.apps.docs.editors.punch/com.google/XXX@google.com,`,
			}, "\n"),
		},
		{
			name: "Userspace wakelock starts shortly after CPU starts running",
			input: strings.Join([]string{
				`9,0,i,vers,12,116,LMY47D,LMY47D`,
				`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
				`9,hsp,48,0,"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`,
				`9,hsp,90,0,"200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1423000000000`,
				`9,h,5000,+r,wr=48`,
				`9,h,5000,+w=17`,
				`9,h,5000,-r,-w`,
			}, "\n"),
			wantSummary: &ActivitySummary{
				StartTimeMs: 1423000000000,
				EndTimeMs:   1423000015000,
				WakeLockSummary: map[string]Dist{
					`"com.google.android.apps.docs.editors.punch/com.google/XXX@google.com"`: Dist{
						Num:           1,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
				},
				WakeupReasonSummary: map[string]Dist{
					`"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`: Dist{
						Num:           1,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1423000005000,1423000015000,"1423000005000~1423000010000~289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio",`,
				`Partial wakelock,service,1423000010000,1423000015000,com.google.android.apps.docs.editors.punch/com.google/XXX@google.com,`,
			}, "\n"),
		},
		{
			// This does appear in real bug reports.
			name: "Userspace wakelock ends before CPU stops running",
			input: strings.Join([]string{
				`9,0,i,vers,12,116,LMY47D,LMY47D`,
				`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
				`9,hsp,48,0,"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`,
				`9,hsp,90,0,"200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1423000000000`,
				`9,h,5000,+r,wr=48`,
				`9,h,5000,+w=17`,
				`9,h,5000,-w`,
				`9,h,5000,-r`,
			}, "\n"),
			wantSummary: &ActivitySummary{
				StartTimeMs: 1423000000000,
				EndTimeMs:   1423000020000,
				WakeLockSummary: map[string]Dist{
					`"com.google.android.apps.docs.editors.punch/com.google/XXX@google.com"`: Dist{
						Num:           1,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
				},
				WakeupReasonSummary: map[string]Dist{
					`"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`: Dist{
						Num:           1,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1423000005000,1423000020000,"1423000005000~1423000010000~289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio",`,
				`Partial wakelock,service,1423000010000,1423000015000,com.google.android.apps.docs.editors.punch/com.google/XXX@google.com,`,
			}, "\n"),
		},
		{
			// I don't know if this actually happens in reports.
			name: "Userspace wakelock starts shortly after CPU starts running, wakeup reason specified after wakelock acquired",
			input: strings.Join([]string{
				`9,0,i,vers,12,116,LMY47D,LMY47D`,
				`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
				`9,hsp,48,0,"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`,
				`9,hsp,90,0,"200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1423000000000`,
				`9,h,5000,+r`,
				`9,h,5000,+w=17`,
				`9,h,5000,wr=48`, // Wakeup reason is logged after userspace wakelock is acquired...Assuming it was meant to be for the +r.
				`9,h,5000,-r,-w`,
			}, "\n"),
			wantSummary: &ActivitySummary{
				StartTimeMs: 1423000000000,
				EndTimeMs:   1423000020000,
				WakeLockSummary: map[string]Dist{
					`"com.google.android.apps.docs.editors.punch/com.google/XXX@google.com"`: Dist{
						Num:           1,
						TotalDuration: 10000 * time.Millisecond,
						MaxDuration:   10000 * time.Millisecond,
					},
				},
				WakeupReasonSummary: map[string]Dist{
					`"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`: Dist{
						Num:           1,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1423000005000,1423000020000,"1423000005000~1423000010000~289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio",`,
				`Partial wakelock,service,1423000010000,1423000020000,com.google.android.apps.docs.editors.punch/com.google/XXX@google.com,`,
			}, "\n"),
		},
		{
			// I don't know if this actually happens in reports.
			name: "Userspace wakelock starts shortly after CPU starts running, wakeup reason specified after wakelock released",
			input: strings.Join([]string{
				`9,0,i,vers,12,116,LMY47D,LMY47D`,
				`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
				`9,hsp,48,0,"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`,
				`9,hsp,96,0,"Abort:some device prevented suspend :("`,
				`9,h,0:RESET:TIME:1423000000000`,
				`9,h,5000,+r,wr=48`,
				`9,h,5000,+w=17`,
				`9,h,5000,-w`,
				`9,h,5000,wr=96`, // Wakeup reason is logged after userspace wakelock ends...Assuming it was essentially an "abort" (preventing suspend). It should be marked as causing the CPU run from the very end of the userspace wakelock.
				`9,h,10000,-r`,
			}, "\n"),
			wantSummary: &ActivitySummary{
				StartTimeMs: 1423000000000,
				EndTimeMs:   1423000030000,
				WakeLockSummary: map[string]Dist{
					`"com.google.android.apps.docs.editors.punch/com.google/XXX@google.com"`: Dist{
						Num:           1,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
				},
				WakeupReasonSummary: map[string]Dist{
					`"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`: Dist{
						Num:           1,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
					`"Abort:some device prevented suspend :("`: Dist{
						Num:           1,
						TotalDuration: 15000 * time.Millisecond,
						MaxDuration:   15000 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1423000005000,1423000030000,"1423000005000~1423000010000~289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio|1423000015000~1423000030000~Abort:some device prevented suspend :(",`,
				`Partial wakelock,service,1423000010000,1423000015000,com.google.android.apps.docs.editors.punch/com.google/XXX@google.com,`,
			}, "\n"),
		},
		{
			// This does actually occur in reports.
			name: "Multiple wakeup reasons, one after -r",
			input: strings.Join([]string{
				`9,0,i,vers,12,116,LMY47D,LMY47D`,
				`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
				`9,hsp,48,0,"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`,
				`9,hsp,96,0,"Abort:some device prevented suspend :("`,
				`9,h,0:RESET:TIME:1423000000000`,
				`9,h,5000,+r,wr=48`,
				`9,h,10000,-r,wr=96`, // Wakeup reason should have count incremented, but not duration
				`9,h,5000,+r,wr=48`,
				`9,h,5000,-r`,
			}, "\n"),
			wantSummary: &ActivitySummary{
				StartTimeMs:     1423000000000,
				EndTimeMs:       1423000025000,
				WakeLockSummary: map[string]Dist{},
				WakeupReasonSummary: map[string]Dist{
					`"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`: Dist{
						Num:           2,
						TotalDuration: 15000 * time.Millisecond,
						MaxDuration:   10000 * time.Millisecond,
					},
					`"Abort:some device prevented suspend :("`: Dist{
						Num:           1,
						TotalDuration: 0 * time.Millisecond,
						MaxDuration:   0 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1423000005000,1423000015000,"1423000005000~1423000015000~289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio|1423000015000~Abort:some device prevented suspend :(",`,
				`CPU running,string,1423000020000,1423000025000,"1423000020000~1423000025000~289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio",`,
			}, "\n"),
		},
		{
			// In my sample set of looking at <3% of 1 report, I did not see this actually happen.
			name: "No wakeup reason",
			input: strings.Join([]string{
				`9,0,i,vers,12,116,LMY47D,LMY47D`,
				`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
				`9,hsp,48,0,"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`,
				`9,hsp,90,0,"200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1423000000000`,
				`9,h,5000,+r`,
				`9,h,5000,-r`,
			}, "\n"),
			wantSummary: &ActivitySummary{
				StartTimeMs:         1423000000000,
				EndTimeMs:           1423000010000,
				WakeLockSummary:     map[string]Dist{},
				WakeupReasonSummary: map[string]Dist{},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1423000005000,1423000010000,1423000005000~1423000010000~` + csv.UnknownWakeup + `,`,
			}, "\n"),
		},
		{
			// This does appear in real bug reports.
			name: "Multiple wakeup reasons within one +/-r block",
			input: strings.Join([]string{
				`9,0,i,vers,12,116,LMY47D,LMY47D`,
				`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
				`9,hsp,48,0,"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`,
				`9,hsp,90,0,"200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1423000000000`,
				`9,h,5000,+r,wr=48`,
				`9,h,5000,wr=90`,
				`9,h,5000,wr=90`,
				`9,h,5000,wr=90`,
				`9,h,5000,-r`,
			}, "\n"),
			wantSummary: &ActivitySummary{
				StartTimeMs:     1423000000000,
				EndTimeMs:       1423000025000,
				WakeLockSummary: map[string]Dist{},
				WakeupReasonSummary: map[string]Dist{
					`"289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio"`: Dist{
						Num:           1,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
					`"200:qcom,smd-rpm"`: Dist{
						Num:           3,
						TotalDuration: 15000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1423000005000,1423000025000,"1423000005000~1423000010000~289:bcmsdh_sdmmc:200:qcom,smd-rpm:240:msmgpio|1423000010000~1423000015000~200:qcom,smd-rpm|1423000015000~1423000020000~200:qcom,smd-rpm|1423000020000~1423000025000~200:qcom,smd-rpm",`,
			}, "\n"),
		},
		{
			// Pulled from bug report and slightly simplified. wr #191 is the focus of this test.
			name: "Multi-sequence, wr 191",
			input: strings.Join([]string{
				`9,0,i,vers,20,153,OPR1.170406.004,OPR1.170406.004`,
				`9,hsp,13,0,"Abort:not important"`,
				`9,hsp,16,1002,"bluetooth_timer"`,
				`9,hsp,27,0,"Abort:other not important"`,
				`9,hsp,34,10017,"GCM_READ"`,
				`9,hsp,191,0,"Abort:important"`,
				`9,h,0:RESET:TIME:1423000000000`,

				// Block 1
				`9,h,10000,+r,+w=34,wr=13`,
				`9,h,500,-r,-w,wr=191`,

				// Block 2
				// Alternating between wakeup reasons that we don't necessarily care about until the end.
				`9,h,20000,+r,+w=16,wr=13`,
				`9,h,500,-w,wr=27`,
				`9,h,500,wr=13`,
				`9,h,500,wr=27`,
				`9,h,500,+w=34`,
				`9,h,500,-w`,
				`9,h,500,wr=13`, // wr #13 covers gap between previous line (-w) and next one (-r)
				`9,h,500,-r,wr=191`,

				// Block 3
				// Repeated wakelock acquisition and release.
				`9,h,30000,+r,+w=16`,
				`9,h,500,wr=13`,
				`9,h,500,-w`,
				`9,h,500,+w=34`,
				`9,h,500,-w`,
				`9,h,500,+w=34`,
				`9,h,500,-w`,
				`9,h,500,+w=34`,
				`9,h,500,-r,-w,wr=191`,

				// Block 4
				// Wakeup reason after wakelock release.
				`9,h,40000,+r,+w=34,wr=27`,
				`9,h,500,-w,wr=13`,
				`9,h,500,+w=16`,
				`9,h,500,-w,wr=191`,
				`9,h,500,+w=16`,
				`9,h,500,-w`,
				`9,h,500,-r`,

				// Block 5
				`9,h,50000,+r,+w=16,wr=13`,
				`9,h,500,-w,wr=191`,
				`9,h,500,-r,wr=13`,

				// Block 6
				`9,h,60000,+r,wr=13`,
				`9,h,500,wr=191`,
				`9,h,500,-r`,

				// Block 7
				`9,h,70000,+r,+w=34`,
				`9,h,500,-w`,
				`9,h,500,+w=16,wr=13`, // wr #13 covers gap between previous line (-w) and this one
				`9,h,500,-w`,
				`9,h,500,+w=16`,
				`9,h,500,-w,wr=27`,
				`9,h,500,+w=34,wr=191`,
				`9,h,500,-w`,
				`9,h,500,-r`,
			}, "\n"),
			wantSummary: &ActivitySummary{
				StartTimeMs: 1423000000000,
				EndTimeMs:   1423000297000,
				WakeLockSummary: map[string]Dist{
					`"bluetooth_timer"`: Dist{
						Num:           7,
						TotalDuration: 4000 * time.Millisecond,
						MaxDuration:   1000 * time.Millisecond,
					},
					`"GCM_READ"`: Dist{
						Num:           8,
						TotalDuration: 4000 * time.Millisecond,
						MaxDuration:   500 * time.Millisecond,
					},
				},
				WakeupReasonSummary: map[string]Dist{
					`"Abort:not important"`: Dist{
						Num:           10,
						TotalDuration: 3000 * time.Millisecond,
						MaxDuration:   1000 * time.Millisecond,
					},
					`"Abort:other not important"`: Dist{
						Num:           4,
						TotalDuration: 1500 * time.Millisecond,
						MaxDuration:   500 * time.Millisecond,
					},
					`"Abort:important"`: Dist{
						Num:           7,
						TotalDuration: 1500 * time.Millisecond,
						MaxDuration:   500 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				// Block 1
				`CPU running,string,1423000010000,1423000010500,1423000010000~Abort:not important|1423000010500~Abort:important,`,
				`Partial wakelock,service,1423000010000,1423000010500,GCM_READ,`,
				// Block 2
				`CPU running,string,1423000030500,1423000034000,1423000030500~Abort:not important|1423000031000~1423000031500~Abort:other not important|1423000031500~1423000032000~Abort:not important|1423000032000~1423000032500~Abort:other not important|1423000033000~1423000034000~Abort:not important|1423000034000~Abort:important,`,
				`Partial wakelock,service,1423000030500,1423000031000,bluetooth_timer,`,
				`Partial wakelock,service,1423000032500,1423000033000,GCM_READ,`,
				// Block 3
				`CPU running,string,1423000064000,1423000068000,1423000064000~Abort:not important|1423000068000~Abort:important,`,
				`Partial wakelock,service,1423000064000,1423000065000,bluetooth_timer,`,
				`Partial wakelock,service,1423000065500,1423000066000,GCM_READ,`,
				`Partial wakelock,service,1423000066500,1423000067000,GCM_READ,`,
				`Partial wakelock,service,1423000067500,1423000068000,GCM_READ,`,
				// Block 4
				`CPU running,string,1423000108000,1423000111000,1423000108000~Abort:other not important|1423000108500~1423000109000~Abort:not important|1423000109500~1423000110000~Abort:important,`,
				`Partial wakelock,service,1423000108000,1423000108500,GCM_READ,`,
				`Partial wakelock,service,1423000109000,1423000109500,bluetooth_timer,`,
				`Partial wakelock,service,1423000110000,1423000110500,bluetooth_timer,`,
				// Block 5
				`CPU running,string,1423000161000,1423000162000,1423000161000~Abort:not important|1423000161500~1423000162000~Abort:important|1423000162000~Abort:not important,`,
				`Partial wakelock,service,1423000161000,1423000161500,bluetooth_timer,`,
				// Block 6
				`CPU running,string,1423000222000,1423000223000,1423000222000~1423000222500~Abort:not important|1423000222500~1423000223000~Abort:important,`,
				// Block 7
				`CPU running,string,1423000293000,1423000297000,1423000293500~1423000294000~Abort:not important|1423000295500~1423000296000~Abort:other not important|1423000296000~Abort:important,`,
				`Partial wakelock,service,1423000293000,1423000293500,GCM_READ,`,
				`Partial wakelock,service,1423000294000,1423000294500,bluetooth_timer,`,
				`Partial wakelock,service,1423000295000,1423000295500,bluetooth_timer,`,
				`Partial wakelock,service,1423000296000,1423000296500,GCM_READ,`,
			}, "\n"),
		},
	}

	for _, test := range tests {
		// Include test name in output log so it's easier to debug problems.
		fmt.Printf("Testing %s\n", test.name)

		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)

		if len(result.Errs) > 0 {
			t.Errorf("%q: Errors encountered while analyzing history: %v", test.name, result.Errs)
			continue
		}
		if len(result.Summaries) != 1 {
			t.Errorf("%q: Incorrect number of summaries. Got %d, want: %d", test.name, len(result.Summaries), 1)
			continue
		}
		s := result.Summaries[0]
		want := test.wantSummary
		if want.StartTimeMs != s.StartTimeMs {
			t.Errorf("%q: Start times do not match. Got: %d, want: %d", test.name, want.StartTimeMs, s.StartTimeMs)
		}
		if want.EndTimeMs != s.EndTimeMs {
			t.Errorf("%q: End times do not match. Got: %d, want: %d", test.name, want.EndTimeMs, s.EndTimeMs)
		}
		if !reflect.DeepEqual(want.WakeLockSummary, s.WakeLockSummary) {
			t.Errorf("%q: Incorrect wake lock summary.\n Got: %v,\n want: %v", test.name, s.WakeLockSummary, want.WakeLockSummary)
		}
		if !reflect.DeepEqual(want.WakeupReasonSummary, s.WakeupReasonSummary) {
			t.Errorf("%q: Incorrect wakeup reason summary.\n Got: %v,\n want: %v", test.name, s.WakeupReasonSummary, want.WakeupReasonSummary)
		}

		gotCSV := normalizeCSV(b.String())
		wantCSV := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(wantCSV, gotCSV) {
			t.Errorf("%q test generated incorrect csv:\n  Got: %q\n  Want: %q", test.name, gotCSV, wantCSV)
		}
	}
}

// TestUIDAndPackageNameMapping tests that mapping of UIDs to package names from the checkin log works properly.
func TestUIDAndPackageNameMapping(t *testing.T) {
	inputCheckin := strings.Join([]string{
		// Random lines that should be skipped.
		"9,0,l,pr,system,0,3150,0,0,0,0",
		"9,1000,l,wl,SyncManagerHandleSyncAlarm,0,f,0,1568,p,80,0,w,0",
		"9,0,l,sst,0",
		// Actual sync lines to be parsed.
		"9,10005,l,apk,1,com.android.providers.calendar,com.android.providers.calendar.CalendarProviderIntentService,160,1,1",
		// Shared UID
		"9,1001,l,apk,9,com.android.phone,com.android.phone.TelephonyDebugService,8630050,1,1",
		"9,1001,l,apk,0,com.android.stk,com.android.stk.StkAppService,8630050,1,1",
		// Removing legacy '9' to ensure parsing still works.
		"10014,l,apk,225,com.google.android.gms,com.google.android.gms.auth.GetToken,0,0,137",
		// Data will also be in the package list.
		"9,10123,l,apk,25,com.google.android.youtube,com.google.android.youtube.ViralVideo,0,0,137",
		"9,10456,l,apk,5,com.google.android.apps.photos,com.google.android.apps.photos.AwesomePhoto,0,0,137",
		// Secondary user.
		"9,1010005,l,apk,5,com.android.providers.calendar,com.android.providers.calendar.CalendarProviderIntentService,160,1,1",
		// Secondary user app with no corresponding primary user app.
		"9,1010789,l,apk,1,com.google.android.play.games,com.google.android.play.games.SuperCoolGame,160,1,1",
		// Secondary user with data in package list.
		"9,1010456,l,apk,15,com.google.android.apps.photos,com.google.android.apps.photos.AwesomePhoto,0,0,137",
	}, "\n")
	inputList := []*usagepb.PackageInfo{
		{
			// Package not found in checkin.
			PkgName: proto.String("com.google.android.videos"),
			Uid:     proto.Int32(10007),
		},
		{
			// Package with shared UID.
			PkgName:      proto.String("com.google.android.gsf"),
			Uid:          proto.Int32(10014),
			SharedUserId: proto.String("com.google.uid.shared"),
		},
		{
			// Package same as data found in checkin.
			PkgName: proto.String("com.google.android.youtube"),
			Uid:     proto.Int32(10123),
		},
		{
			// Package same as data found in checkin, with secondary user.
			PkgName: proto.String("com.google.android.apps.photos"),
			Uid:     proto.Int32(10456),
		},
		// Shared UIDs that aren't predefined
		{
			// Package with shared UID.
			PkgName:      proto.String("com.random.app.one"),
			Uid:          proto.Int32(10025),
			SharedUserId: proto.String("com.random.uid.shared"),
		},
		{
			// Package with shared UID.
			PkgName:      proto.String("com.random.app.two"),
			Uid:          proto.Int32(10025),
			SharedUserId: proto.String("com.random.uid.shared"),
		},
		{
			// Package with shared UID.
			PkgName:      proto.String("com.random.app.three"),
			Uid:          proto.Int32(10025),
			SharedUserId: proto.String("com.random.uid.shared"),
		},
	}

	want := PackageUIDMapping{
		uidToPackage: map[int32]string{
			1001:    "com.android.phone;com.android.stk",
			10005:   "com.android.providers.calendar",
			10007:   "com.google.android.videos",
			10014:   "com.google.android.gms;com.google.android.gsf",
			10025:   "com.random.app.one;com.random.app.two;com.random.app.three",
			10123:   "com.google.android.youtube",
			10456:   "com.google.android.apps.photos",
			1010005: "com.android.providers.calendar",
			1010456: "com.google.android.apps.photos",
			1010789: "com.google.android.play.games",
		},
		packageToUID: map[string]int32{
			"com.android.phone":              1001,
			"com.android.stk":                1001,
			"com.android.providers.calendar": 10005,
			"com.google.android.videos":      10007,
			"com.google.android.gms":         10014,
			"com.google.android.gsf":         10014,
			"com.random.app.one":             10025,
			"com.random.app.two":             10025,
			"com.random.app.three":           10025,
			"com.google.android.youtube":     10123,
			"com.google.android.apps.photos": 10456,
			"com.google.android.play.games":  10789,
		},
		sharedUIDName: map[int32]string{
			10014: "GOOGLE_SERVICES",
			10025: "SharedUserID(com.random.uid.shared)",
		},
		pkgList: inputList,
	}

	got, errs := UIDAndPackageNameMapping(inputCheckin, inputList)
	if len(errs) > 0 {
		t.Fatalf("Encountered errors: %v", errs)
	}

	if !reflect.DeepEqual(want, got) {
		t.Errorf("UID--package mapping incorrect.\n  Got: %v,\n  want: %v", got, want)
	}
}

// TestEjbParsing tests the parsing of job (Ejb) entries in a history log.
func TestEjbParsing(t *testing.T) {
	input := strings.Join([]string{
		`9,0,i,vers,11,116,LMY06B,LMY06B`,
		`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
		`9,hsp,19,10008,"com.android.providers.downloads/.DownloadIdleService"`,
		`9,hsp,20,1010054,"*net_scheduler*\"`,
		`9,hsp,21,1010054,"*job*/com.google.android.gms/.gcm.nts.TaskExecutionService"`,
		`9,h,0:RESET:TIME:1422620451417`,
		`9,h,1000,+w=17`,
		`9,h,1000,-Ejb=21`, // no +Ejb = 21
		`9,h,10000,-w`,
		`9,h,6493,+Ejb=19`,
		`9,h,1388,-w`,
		`9,h,3,+w=20`,
		`9,h,13,-w`,
		`9,h,3,+w=20`,
		`9,h,114,-w`,
		`9,h,5575,-Ejb=19`,
		`9,h,28,+w=21,+Ejb=19`,
		`9,h,3,-w`,
		`9,h,3,+w=21,-Ejb=19`,
		`9,h,1,-w`,
		`9,h,4,+w=20`,
		`9,h,5672,-w,+Ejb=21`, // no -Ejb=21
		`9,h,7,+w=17`,
		`9,h,2,-r,-w`,
	}, "\n")

	want := newActivitySummary(FormatTotalTime)
	want.ScheduledJobSummary[`"com.android.providers.downloads/.DownloadIdleService"`] = Dist{
		Num:           2,
		TotalDuration: 7102 * time.Millisecond,
		MaxDuration:   7096 * time.Millisecond,
	}
	want.ScheduledJobSummary[`"*job*/com.google.android.gms/.gcm.nts.TaskExecutionService"`] = Dist{
		Num:           2,
		TotalDuration: 2009 * time.Millisecond,
		MaxDuration:   2000 * time.Millisecond,
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 0, 1)
	s := result.Summaries[0]

	if !reflect.DeepEqual(want.ScheduledJobSummary, s.ScheduledJobSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].ScheduledJobSummary = %v, want %v", input, s.ScheduledJobSummary, want.ScheduledJobSummary)
	}
}

// TestElwParsing tests the parsing of longwake (Elw) entries in a history log.
func TestElwParsing(t *testing.T) {
	input := strings.Join([]string{
		`9,0,i,vers,11,116,LMY06B,LMY06B`,
		`9,hsp,57,10017,"*net_scheduler*"`,
		`9,hsp,64,10191,"hgn"`,
		`9,hsp,363,10017,"*sync*/com.google.android.gms.fitness/com.google/noogle@google.com"`,
		`9,h,0:RESET:TIME:1469130000000`,
		`9,h,60000,-Elw=57`,  // no +Elw=57
		`9,h,31000,+Elw=64`,  // wl 64 was acquired one minute before this statement
		`9,h,32000,+Elw=363`, // wl 363 was acquired one minute before this statement
		`9,h,33000,-Elw=64`,
		`9,h,34000,-Elw=363`,
		`9,h,60000,+Elw=57`, // no -Elw=57, wl 57 was acquired one minute before this statement
	}, "\n")

	wantSummary := map[string]Dist{
		`"*net_scheduler*"`: {
			Num:           2,
			TotalDuration: 120000 * time.Millisecond,
			MaxDuration:   60000 * time.Millisecond,
		},
		`"hgn"`: {
			Num:           1,
			TotalDuration: 125000 * time.Millisecond,
			MaxDuration:   125000 * time.Millisecond,
		},
		`"*sync*/com.google.android.gms.fitness/com.google/XXX@google.com"`: {
			Num:           1,
			TotalDuration: 127000 * time.Millisecond,
			MaxDuration:   127000 * time.Millisecond,
		},
	}
	wantCSV := normalizeCSV(strings.Join([]string{
		csv.FileHeader,
		// The wakelock was held at the beginning of the report, so the start time should be at the beginning of the report, not one minute before.
		`Long Wakelocks,service,1469130000000,1469130060000,*net_scheduler*,10017`,
		`Long Wakelocks,service,1469130031000,1469130156000,hgn,10191`,
		`Long Wakelocks,service,1469130063000,1469130190000,*sync*/com.google.android.gms.fitness/com.google/XXX@google.com,10017`,
		`Long Wakelocks,service,1469130190000,1469130250000,*net_scheduler*,10017`,
	}, "\n"))

	var b bytes.Buffer
	result := AnalyzeHistory(&b, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 0, 1)
	s := result.Summaries[0]

	if !reflect.DeepEqual(wantSummary, s.LongWakelockSummary) {
		t.Errorf("Invalid LongWakelock Summary:\n  got:  %v\n  want: %v", s.LongWakelockSummary, wantSummary)
	}
	gotCSV := normalizeCSV(b.String())
	if !reflect.DeepEqual(gotCSV, wantCSV) {
		t.Errorf("Parsing generated incorrect csv:\n  got:  %s\n  want: %s", gotCSV, wantCSV)
	}
}

// TestIdleModeParsing tests the parsing of idle_mode entries in a history log.
func TestIdleModeParsing(t *testing.T) {
	tests := []struct {
		desc                string
		input               string
		wantReportVersion   int32
		wantNumSummaries    int
		wantIdleModeSummary []map[string]Dist
		wantCSV             string
	}{
		{
			desc: "idle mode parsing in M, dozing from beginning", // Simply +/-di
			input: strings.Join([]string{
				`9,0,i,vers,15,130,LMY06B,LMY06B`,
				`9,h,0:RESET:TIME:1422620500000`, // Should parse as di=full
				`9,h,1000,-di`,                   // No +di; -di should count as di=off
				`9,h,6000,+di`,                   // +di should count as di=full
				`9,h,5000,-di`,
				`9,h,4000,+di`, // no -di
				`9,h,50,+Wl`,   // Extra line needed to test that summarizing of ongoing doze mode (di=light) works properly.
			}, "\n"),
			wantReportVersion: 15,
			wantNumSummaries:  1,
			wantIdleModeSummary: []map[string]Dist{
				{
					"full": {
						Num:           3,
						TotalDuration: 6050 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
					"off": {
						Num:           2,
						TotalDuration: 10000 * time.Millisecond,
						MaxDuration:   6000 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				"Doze,string,1422620500000,1422620501000,full,",
				"Doze,string,1422620501000,1422620507000,off,",
				"Doze,string,1422620507000,1422620512000,full,",
				"Doze,string,1422620512000,1422620516000,off,",
				"Doze,string,1422620516000,1422620516050,full,",
				"Wifi full lock,bool,1422620516050,1422620516050,true,",
			}, "\n"),
		},
		{
			desc: "idle mode parsing in M, not dozing at beginning", // Simply +/-di
			input: strings.Join([]string{
				`9,0,i,vers,15,130,LMY06B,LMY06B`,
				`9,h,0:RESET:TIME:1422620500000`, // Should parse as di=off from here
				`9,h,7000,+di`,                   // +di should count as di=full
				`9,h,5000,-di`,                   // -di should count as di=off
				`9,h,4000,+di`,                   // no -di
			}, "\n"),
			wantReportVersion: 15,
			wantNumSummaries:  1,
			wantIdleModeSummary: []map[string]Dist{
				{
					"full": {
						Num:           2,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
					"off": {
						Num:           2,
						TotalDuration: 11000 * time.Millisecond,
						MaxDuration:   7000 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				"Doze,string,1422620500000,1422620507000,off,",
				"Doze,string,1422620507000,1422620512000,full,",
				"Doze,string,1422620512000,1422620516000,off,",
				"Doze,string,1422620516000,1422620516000,full,",
			}, "\n"),
		},
		{
			desc: "idle mode parsing in N, unknown idle at beginning", // di=[off|light|full]
			input: strings.Join([]string{
				`9,0,i,vers,16,135,NYC22B,NYC22B`,
				`9,h,0:RESET:TIME:1422620500000`,
				`9,h,1000,di=off`, // No di=[light|full], so parsing should say unknown
				`9,h,6000,di=light`,
				`9,h,5000,di=full`,
				`9,h,4000,di=off`,
				`9,h,5000,di=light`, // no di=off
			}, "\n"),
			wantReportVersion: 16,
			wantNumSummaries:  1,
			wantIdleModeSummary: []map[string]Dist{
				{
					"full": {
						Num:           1,
						TotalDuration: 4000 * time.Millisecond,
						MaxDuration:   4000 * time.Millisecond,
					},
					"light": {
						Num:           2,
						TotalDuration: 5000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
					"off": {
						Num:           2,
						TotalDuration: 11000 * time.Millisecond,
						MaxDuration:   6000 * time.Millisecond,
					},
					"unknown": {
						Num:           1,
						TotalDuration: 1000 * time.Millisecond,
						MaxDuration:   1000 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				"Doze,string,1422620500000,1422620501000,unknown,",
				"Doze,string,1422620501000,1422620507000,off,",
				"Doze,string,1422620507000,1422620512000,light,",
				"Doze,string,1422620512000,1422620516000,full,",
				"Doze,string,1422620516000,1422620521000,off,",
				"Doze,string,1422620521000,1422620521000,light,",
			}, "\n"),
		},
		{
			desc: "idle mode parsing in N, first doze entry not 'off'", // di=[off|light|full]
			input: strings.Join([]string{
				`9,0,i,vers,16,135,NYC22B,NYC22B`,
				`9,h,0:RESET:TIME:1422620500000`,
				`9,h,1000,di=light`, // Should start counting idle data from here
				`9,h,2000,di=off`,
				`9,h,3000,di=light`,
				`9,h,5000,di=full`,
				`9,h,4000,di=off`,
			}, "\n"),
			wantReportVersion: 16,
			wantNumSummaries:  1,
			wantIdleModeSummary: []map[string]Dist{
				{
					"full": {
						Num:           1,
						TotalDuration: 4000 * time.Millisecond,
						MaxDuration:   4000 * time.Millisecond,
					},
					"light": {
						Num:           2,
						TotalDuration: 7000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
					"off": {
						Num:           2,
						TotalDuration: 3000 * time.Millisecond,
						MaxDuration:   3000 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				"Doze,string,1422620501000,1422620503000,light,",
				"Doze,string,1422620503000,1422620506000,off,",
				"Doze,string,1422620506000,1422620511000,light,",
				"Doze,string,1422620511000,1422620515000,full,",
				"Doze,string,1422620515000,1422620515000,off,",
			}, "\n"),
		},
		{
			desc: "idle mode parsing in N, with SHUTDOWN", // di=[off|light|full]
			input: strings.Join([]string{
				`9,0,i,vers,16,135,NYC22B,NYC22B`,
				`9,h,0:RESET:TIME:1422620500000`,
				`9,h,1000,di=light`, // Should start counting idle data from here
				`9,h,2000,di=off`,
				`9,h,3000,di=light`,
				`9,h,5000,di=full`,
				`9,h,4000,di=off`,
				`9,h,500:SHUTDOWN`,
				`9,h,500:START`,
				`9,h,0:TIME:1422620530000`,
				`9,h,1000,di=light`,
				`9,h,50,+Wl`, // Extra line needed to test that summarizing of ongoing doze mode (di=light) works properly.
			}, "\n"),
			wantReportVersion: 16,
			wantNumSummaries:  2,
			wantIdleModeSummary: []map[string]Dist{
				{
					"full": {
						Num:           1,
						TotalDuration: 4000 * time.Millisecond,
						MaxDuration:   4000 * time.Millisecond,
					},
					"light": {
						Num:           2,
						TotalDuration: 7000 * time.Millisecond,
						MaxDuration:   5000 * time.Millisecond,
					},
					"off": {
						Num:           2,
						TotalDuration: 3500 * time.Millisecond,
						MaxDuration:   3000 * time.Millisecond,
					},
				},
				{
					"light": {
						Num:           1,
						TotalDuration: 50 * time.Millisecond,
						MaxDuration:   50 * time.Millisecond,
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				"Doze,string,1422620501000,1422620503000,light,",
				"Doze,string,1422620503000,1422620506000,off,",
				"Doze,string,1422620506000,1422620511000,light,",
				"Doze,string,1422620511000,1422620515000,full,",
				"Doze,string,1422620515000,1422620515500,off,",
				"Reboot,bool,1422620515500,1422620530000,true,",
				"Doze,string,1422620531000,1422620531050,light,",
				"Wifi full lock,bool,1422620531050,1422620531050,true,",
			}, "\n"),
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, 0, test.wantNumSummaries)

		if result.ReportVersion != test.wantReportVersion {
			t.Errorf("%v: AnalyzeHistory(%s) didn't parse the correct report version:\n  got %d\n  want %d", test.desc, test.input, result.ReportVersion, test.wantReportVersion)
		}

		if len(result.Summaries) == test.wantNumSummaries {
			for i, s := range result.Summaries {
				if !reflect.DeepEqual(test.wantIdleModeSummary[i], s.IdleModeSummary) {
					t.Errorf("%v: AnalyzeHistory(%s,...).Summaries[%d].IdleModeSummary incorrect:\n  got: %v\n  want: %v", test.desc, test.input, i, s.IdleModeSummary, test.wantIdleModeSummary[i])
				}
			}
		}

		gotCSV := normalizeCSV(b.String())
		wantCSV := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(gotCSV, wantCSV) {
			t.Errorf("%v: AnalyzeHistory(%v) generated incorrect csv:\n  got: %s\n  want: %s", test.desc, test.input, gotCSV, wantCSV)
		}
	}
}

// TestEtwParsing tests the parsing of tmpwhitelist (Etw) events in a history log.
func TestEtwParsing(t *testing.T) {
	input := strings.Join([]string{
		`9,0,i,vers,14,130,MRA06B,MRA30G`,
		`9,hsp,1,10035,"com.google.android.volta/.LogUploaderService"`,
		`9,hsp,19,10008,"com.android.providers.downloads/.DownloadIdleService"`,
		`9,hsp,23,10016,"broadcast:u0a16:com.google.android.intent.action.GCM_RECONNECT"`,
		`9,h,0:RESET:TIME:1422620450000`,
		`9,h,1000,+r,+Etw=23`,
		`9,h,1000,-Etw=1`,  // no +Etw=1
		`9,h,5000,+Etw=19`, // 19 overlaps 23
		`9,h,300,-Etw=23`,
		`9,h,4000,-Etw=19`,
		`9,h,200,+Etw=19`,
		`9,h,500,-Etw=19`,
		`9,h,2000,+Etw=23`, // no -Etw=23
		`9,h,250,-r`,
	}, "\n")

	want := map[string]Dist{
		`"com.google.android.volta/.LogUploaderService"`: {
			Num:           1,
			TotalDuration: 2000 * time.Millisecond,
			MaxDuration:   2000 * time.Millisecond,
		},
		`"com.android.providers.downloads/.DownloadIdleService"`: {
			Num:           2,
			TotalDuration: 4800 * time.Millisecond,
			MaxDuration:   4300 * time.Millisecond,
		},
		`"broadcast:u0a16:com.google.android.intent.action.GCM_RECONNECT"`: {
			Num:           2,
			TotalDuration: 6550 * time.Millisecond,
			MaxDuration:   6300 * time.Millisecond,
		},
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 0, 1)
	if len(result.Summaries) == 1 {
		s := result.Summaries[0]
		if !reflect.DeepEqual(want, s.TmpWhiteListSummary) {
			t.Errorf("AnalyzeHistory(%s,...).Summaries[0].TmpWhiteListSummary generated incorrect output\n  got %v\n  want %v", input, s.TmpWhiteListSummary, want)
		}
	}
}

// Tests the generating of CSV entries for a tsBool type.
func TestCSVBoolEntry(t *testing.T) {
	tests := []struct {
		desc             string
		input            string
		wantNumSummaries int
		wantCSV          string
	}{
		{
			"Several positive and negative transitions",
			strings.Join([]string{
				"9,0,i,vers,11,116,LMY06B,LMY06B",
				"9,h,0:RESET:TIME:1422620451417",
				"9,h,1000,+Psc",
				"9,h,1500,-Psc",
				"9,h,2500,+Psc",
				"9,h,2000,-Psc",
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				"Phone scanning,bool,1422620452417,1422620453917,true,",
				"Phone scanning,bool,1422620456417,1422620458417,true,",
			}, "\n"),
		},
		{
			"First entry is a negative transition",
			strings.Join([]string{
				"9,0,i,vers,11,116,LMY06B,LMY06B",
				"9,h,0:RESET:TIME:1422620451417",
				"9,h,1000,-Psc",
				"9,h,1000,+Psc",
				"9,h,1500,-Psc",
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				"Phone scanning,bool,1422620451417,1422620452417,true,",
				"Phone scanning,bool,1422620453417,1422620454917,true,",
			}, "\n"),
		},
		{
			"Positive transition before shutdown",
			strings.Join([]string{
				"9,0,i,vers,11,116,LMY06B,LMY06B",
				"9,h,0:RESET:TIME:1422620451417",
				"9,h,1000,+Psc",
				"9,h,500:SHUTDOWN",
				"9,h,4:START",
				"9,h,0:TIME:1430000000000",
				"9,h,1000,+Psc",
				"9,h,2000,-Psc",
			}, "\n"),
			2,
			strings.Join([]string{
				csv.FileHeader,
				"Phone scanning,bool,1422620452417,1422620452917,true,",
				"Reboot,bool,1422620452917,1430000000000,true,",
				"Phone scanning,bool,1430000001000,1430000003000,true,",
			}, "\n"),
		},
		{
			"Negative transition before shutdown",
			strings.Join([]string{
				"9,0,i,vers,11,116,LMY06B,LMY06B",
				"9,h,0:RESET:TIME:1422620451417",
				"9,h,1000,-Psc",
				"9,h,500:SHUTDOWN",
				"9,h,4:START",
				"9,h,0:TIME:1430000000000",
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				"Phone scanning,bool,1422620451417,1422620452417,true,",
				"Reboot,bool,1422620452917,1430000000000,true,",
			}, "\n"),
		},
	}
	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, 0, test.wantNumSummaries)

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", test.desc, test.input, got, want)
		}
	}
}

// Tests the generating of CSV entries for a tsInt type.
func TestCSVIntEntry(t *testing.T) {
	tests := []struct {
		desc             string
		input            string
		wantNumSummaries int
		wantCSV          string
	}{
		{
			"Brightness changes",
			strings.Join([]string{
				"9,0,i,vers,11,116,LMY06B,LMY06B",
				"9,h,0:RESET:TIME:1422620451417",
				"9,h,1000,Sb=0",
				"9,h,1500,Sb=1",
				"9,h,2500,Sb=4",
				"9,h,2000,Sb=0",
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				"Brightness,int,1422620452417,1422620453917,0,",
				"Brightness,int,1422620453917,1422620456417,1,",
				"Brightness,int,1422620456417,1422620458417,4,",
				"Brightness,int,1422620458417,1422620458417,0,",
			}, "\n"),
		},
		{
			"Shutdown event between brightness changes",

			strings.Join([]string{
				"9,0,i,vers,11,116,LMY06B,LMY06B",
				"9,h,0:RESET:TIME:1422620451417",
				"9,h,1000,Sb=0",
				"9,h,1500,Sb=1",
				"9,h,500:SHUTDOWN",
				"9,h,4:START",
				"9,h,0:TIME:1430000000000",
				"9,h,1000,Sb=4",
				"9,h,2000,Sb=0",
			}, "\n"),
			2,
			strings.Join([]string{
				csv.FileHeader,
				"Brightness,int,1422620452417,1422620453917,0,",
				"Brightness,int,1422620453917,1422620454417,1,",
				"Reboot,bool,1422620454417,1430000000000,true,",
				"Brightness,int,1430000001000,1430000003000,4,",
				"Brightness,int,1430000003000,1430000003000,0,",
			}, "\n"),
		},
	}
	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, 0, test.wantNumSummaries)

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", test.desc, test.input, got, want)
		}
	}
}

// Tests the generating of CSV entries for a tsString type.
func TestCSVStringEntry(t *testing.T) {
	tests := []struct {
		desc             string
		input            string
		wantNumSummaries int
		wantCSV          string
	}{
		{
			"Data connection changes",
			strings.Join([]string{
				"9,0,i,vers,11,116,LMY06B,LMY06B",
				"9,h,0:RESET:TIME:1422620451417",
				"9,h,1000,Pcn=hspa",
				"9,h,1500,Pcn=lte",
				"9,h,2500,Pcn=hspap",
				"9,h,2000,Pcn=lte",
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				"Mobile network type,string,1422620452417,1422620453917,hspa,",
				"Mobile network type,string,1422620453917,1422620456417,lte,",
				"Mobile network type,string,1422620456417,1422620458417,hspap,",
				"Mobile network type,string,1422620458417,1422620458417,lte,",
			}, "\n"),
		},
		{
			"Shutdown event between data connection changes",
			strings.Join([]string{
				"9,0,i,vers,11,116,LMY06B,LMY06B",
				"9,h,0:RESET:TIME:1422620451417",
				"9,h,1000,Pcn=hspa",
				"9,h,1500,Pcn=lte",
				"9,h,500:SHUTDOWN",
				"9,h,4:START",
				"9,h,0:TIME:1430000000000",
				"9,h,1000,Pcn=lte",
				"9,h,2000,Pcn=hspap",
			}, "\n"),
			2,
			strings.Join([]string{
				csv.FileHeader,
				"Mobile network type,string,1422620452417,1422620453917,hspa,",
				"Mobile network type,string,1422620453917,1422620454417,lte,",
				"Reboot,bool,1422620454417,1430000000000,true,",
				"Mobile network type,string,1430000001000,1430000003000,lte,",
				"Mobile network type,string,1430000003000,1430000003000,hspap,",
			}, "\n"),
		},
		{
			"Charging status event before data connection change",
			strings.Join([]string{
				"9,0,i,vers,11,116,LMY06B,LMY06B",
				"9,h,0:RESET:TIME:1422620451417",
				"9,h,1000,Bs=c",
				"9,h,1500,Pcn=lte",
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				"Charging status,string,1422620452417,1422620453917,c,",
				"Mobile network type,string,1422620453917,1422620453917,lte,",
			}, "\n"),
		},
	}
	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, 0, test.wantNumSummaries)

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", test.desc, test.input, got, want)
		}
	}
}

// Tests the generating of CSV entries for a ServiceUID type.
func TestCSVServiceEntry(t *testing.T) {
	tests := []struct {
		desc             string
		input            string
		wantNumSummaries int
		wantCSV          string
	}{
		{
			"Overlapping wakelock entries",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1422620451417`,
				`9,hsp,17,1010054,com.google.android.apps.docs.editors.punch/com.google/noogler@google.com`,
				`9,hsp,18,1010051,com.google.android.apps.docs/com.google/noogler@google.com`,
				`9,hsp,22,1010052,com.google.android.apps.docs.editors.kix/com.google/noogler@google.com`,
				`9,h,1000,+Ewl=17`,
				`9,h,2000,+Ewl=22`,
				`9,h,3000,-Ewl=17`,
				`9,h,2000,+Ewl=18`,
				`9,h,5000,-Ewl=22`,
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				`Wakelock_in,service,1422620452417,1422620457417,com.google.android.apps.docs.editors.punch/com.google/noogler@google.com,10054`,
				`Wakelock_in,service,1422620454417,1422620464417,com.google.android.apps.docs.editors.kix/com.google/noogler@google.com,10052`,
				`Wakelock_in,service,1422620459417,1422620464417,com.google.android.apps.docs/com.google/noogler@google.com,10051`,
			}, "\n"),
		},
		{
			"Nesting wakelock entries",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1422620451417`,
				`9,hsp,17,1010054,com.google.android.apps.docs.editors.punch/com.google/noogler@google.com`,
				`9,hsp,18,1010051,com.google.android.apps.docs/com.google/noogler@google.com`,
				`9,hsp,22,1010052,com.google.android.apps.docs.editors.kix/com.google/noogler@google.com`,
				`9,h,1000,+Ewl=17`,
				`9,h,2000,+Ewl=22`,
				`9,h,2000,+Ewl=18`,
				`9,h,2000,-Ewl=18`,
				`9,h,5000,-Ewl=22`,
				`9,h,3000,-Ewl=17`,
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				`Wakelock_in,service,1422620456417,1422620458417,com.google.android.apps.docs/com.google/noogler@google.com,10051`,
				`Wakelock_in,service,1422620454417,1422620463417,com.google.android.apps.docs.editors.kix/com.google/noogler@google.com,10052`,
				`Wakelock_in,service,1422620452417,1422620466417,com.google.android.apps.docs.editors.punch/com.google/noogler@google.com,10054`,
			}, "\n"),
		},
		{
			"First wakelock entry is a negative transition",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1422620451417`,
				`9,hsp,17,1010054,com.google.android.apps.docs.editors.punch/com.google/noogler@google.com`,
				`9,h,2000,-Ewl=17`,
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				`Wakelock_in,service,1422620451417,1422620453417,com.google.android.apps.docs.editors.punch/com.google/noogler@google.com,10054`,
			}, "\n"),
		},
		{
			"Last Wakelock entry has no corresponding negative transition before shutdown",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1422620451417`,
				`9,hsp,17,1010054,com.google.android.apps.docs.editors.punch/com.google/noogler@google.com`,
				`9,hsp,18,1010051,com.google.android.apps.docs/com.google/noogler@google.com`,
				`9,h,1000,+Ewl=17`,
				`9,h,2000,+Ewl=18`,
				`9,h,2000,-Ewl=18`,
				`9,h,500:SHUTDOWN`,
				`9,h,4:START`,
				`9,h,0:TIME:1430000000000`,
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				`Wakelock_in,service,1422620454417,1422620456417,com.google.android.apps.docs/com.google/noogler@google.com,10051`,
				`Wakelock_in,service,1422620452417,1422620456917,com.google.android.apps.docs.editors.punch/com.google/noogler@google.com,10054`,
				`Reboot,bool,1422620456917,1430000000000,true,`,
			}, "\n"),
		},
	}
	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, false)
		validateHistory(test.input, t, result, 0, test.wantNumSummaries)

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v)\n  got: %q\n  want: %q", test.desc, test.input, got, want)
		}
	}
}

// Tests the generating of CSV entries for the sync app type.
func TestCSVSyncEntry(t *testing.T) {
	tests := []struct {
		desc             string
		input            string
		wantNumSummaries int
		wantCSV          string
	}{
		{
			"Sync app entries with same UID, but different values",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1422620451417`,
				`9,hsp,94,10011,"com.google.android.gms.people/com.google/test@google.com"`,
				`9,hsp,97,10011,"com.google.android.gms.games/com.google/test@google.com"`,
				`9,h,1000,+Esy=94`,
				`9,h,2000,+Esy=97`,
				`9,h,3000,-Esy=94`,
				`9,h,2000,-Esy=97`,
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				`SyncManager,service,1422620452417,1422620457417,com.google.android.gms.people/com.google/test@google.com,10011`,
				`SyncManager,service,1422620454417,1422620459417,com.google.android.gms.games/com.google/test@google.com,10011`,
			}, "\n"),
		},
		{
			"Same sync name for different UIDs", // Based on a log from a bug report.
			strings.Join([]string{
				`9,hsp,86,10007,"com.google.android.gms.games/com.google/noogler@gmail.com"`,
				`9,hsp,87,1010007,"com.google.android.gms.games/com.google/test@google.com"`,
				`9,hsp,88,10007,"com.google.android.gms.games/com.google/test@google.com"`,
				`9,h,0:RESET:TIME:1422620450000`,
				`9,h,100,+Esy=87`,
				`9,h,200,+Esy=86`,
				`9,h,200,-Esy=86`,
				`9,h,300,+Esy=88`,
				`9,h,200,-Esy=88`,
				`9,h,500,-Esy=87`,
			}, "\n"),
			1,
			strings.Join([]string{
				csv.FileHeader,
				`SyncManager,service,1422620450300,1422620450500,com.google.android.gms.games/com.google/noogler@gmail.com,10007`,
				`SyncManager,service,1422620450800,1422620451000,com.google.android.gms.games/com.google/test@google.com,10007`,
				`SyncManager,service,1422620450100,1422620451500,com.google.android.gms.games/com.google/test@google.com,10007`,
			}, "\n"),
		},
	}
	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, false)
		validateHistory(test.input, t, result, 0, test.wantNumSummaries)

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v)\n  got: %q\n  want: %q", test.desc, test.input, got, want)
		}
	}
}

// Tests the generating of CSV entries for the running type, as well as associating these entries with wakeup reasons.
func TestCSVRunningEntry(t *testing.T) {
	tests := []struct {
		desc             string
		input            string
		wantNumSummaries int
		wantCSV          string
		wantErrs         []error
	}{
		{
			desc: "Wake reason comes after running entry begins",
			input: strings.Join([]string{
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1422620451417`,
				`9,h,500,+r,+Wl`,
				`9,h,1000,-Wl`,
				`9,h,500,+Wl,wr=10`,
				`9,h,1000,-r,-Wl`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Wifi full lock,bool,1422620451917,1422620452917,true,`,
				`CPU running,string,1422620451917,1422620454417,"1422620451917~1422620454417~57:qcom,smd-modem:200:qcom,smd-rpm",`,
				`Wifi full lock,bool,1422620453417,1422620454417,true,`,
			}, "\n"),
		},
		{
			desc: "Running entries, followed by a wake reason",
			input: strings.Join([]string{
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1432132601233`,
				`9,h,0,Bl=100,+r`,
				`9,h,1000,-r`,
				`9,h,2000,+r,wr=10`,
				`9,h,1000,-r`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Battery Level,int,1432132601233,1432132605233,100,`,
				`CPU running,string,1432132601233,1432132602233,1432132601233~1432132602233~` + csv.UnknownWakeup + `,`,
				`CPU running,string,1432132604233,1432132605233,"1432132604233~1432132605233~57:qcom,smd-modem:200:qcom,smd-rpm",`,
			}, "\n"),
		},
		{
			desc: "Extra wake reason",
			input: strings.Join([]string{
				`9,hsp,26,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,hsp,33,10007,"*walarm*:ALARM_WAKEUP_LOCATOR"`,
				`9,h,0:RESET:TIME:1432132601233`,
				`9,h,1000,+r,wr=26`,
				`9,h,2000,-r,wr=33`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1432132602233,1432132604233,"1432132602233~1432132604233~57:qcom,smd-modem:200:qcom,smd-rpm|1432132604233~*walarm*:ALARM_WAKEUP_LOCATOR",`,
			}, "\n"),
		},
		{
			desc: "Wake reason comes after running entry ends",
			input: strings.Join([]string{
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1432132601233`,
				`9,h,0,+r`,
				`9,h,1000,-r`,
				`9,h,2000,wr=10`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1432132601233,1432132602233,"1432132604233~57:qcom,smd-modem:200:qcom,smd-rpm",`,
			}, "\n"),
		},
		{
			desc: "First entry is a negative running transition",
			input: strings.Join([]string{
				`9,0,i,vers,11,116,LMY06B,LMY06B`,
				`9,h,0:RESET:TIME:1422620451417`,
				`9,h,1000,-r`,
				`9,h,1000,+r`,
				`9,h,1500,-r`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1422620451417,1422620452417,1422620451417~1422620452417~` + csv.UnknownWakeup + `,`,
				`CPU running,string,1422620453417,1422620454917,1422620453417~1422620454917~` + csv.UnknownWakeup + `,`,
			}, "\n"),
		},
		{
			desc: "First entry is a negative running transition, with multiple wakeup reasons",
			input: strings.Join([]string{
				`9,0,i,vers,11,116,LMY06B,LMY06B`,
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,hsp,20,0,"Abort:Some devices failed to suspend"`,
				`9,h,0:RESET:TIME:1422620451417`,
				`9,h,0,wr=10`,
				`9,h,1000,wr=20`,
				`9,h,1000,-r`,
				`9,h,1000,+r`,
				`9,h,1500,-r`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1422620451417,1422620453417,"1422620451417~1422620452417~57:qcom,smd-modem:200:qcom,smd-rpm|1422620452417~1422620453417~Abort:Some devices failed to suspend",`,
				`CPU running,string,1422620454417,1422620455917,1422620454417~1422620455917~` + csv.UnknownWakeup + `,`,
			}, "\n"),
		},
		{
			desc: "Multiple running without wake reasons",
			input: strings.Join([]string{
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1432132601233`,
				`9,h,0,Bl=100,+r`,
				`9,h,1000,-r`,
				`9,h,2000,+r`,
				`9,h,1000,-r`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Battery Level,int,1432132601233,1432132605233,100,`,
				`CPU running,string,1432132601233,1432132602233,1432132601233~1432132602233~` + csv.UnknownWakeup + `,`,
				`CPU running,string,1432132604233,1432132605233,1432132604233~1432132605233~` + csv.UnknownWakeup + `,`,
			}, "\n"),
		},
		{
			desc: "Positive running transition without corresponding negative transition",
			input: strings.Join([]string{
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1432132601233`,
				`9,h,0,Bl=100`,
				`9,h,1000,+r`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Battery Level,int,1432132601233,1432132602233,100,`,
				`CPU running,string,1432132602233,1432132602233,1432132602233~` + csv.UnknownWakeup + `,`,
			}, "\n"),
		},
		{
			desc: "Positive running transition without corresponding negative transition, with wakeup reason",
			input: strings.Join([]string{
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1432132601233`,
				`9,h,0,Bl=100`,
				`9,h,1000,+r,wr=10`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Battery Level,int,1432132601233,1432132602233,100,`,
				`CPU running,string,1432132602233,1432132602233,"1432132602233~57:qcom,smd-modem:200:qcom,smd-rpm",`,
			}, "\n"),
		},
		{
			desc: "Consecutive positive running transitions",
			input: strings.Join([]string{
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1432132601233`,
				`9,h,1000,+r`,
				`9,h,1000,+r`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1432132602233,1432132603233,1432132603233~` + csv.UnknownWakeup + `,`,
			}, "\n"),
			wantErrs: []error{
				errors.New("** Error in 9,h,1000,+r with +r : consecutive +r events"),
			},
		},
		{
			desc: "Consecutive negative running transitions",
			input: strings.Join([]string{
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1432132601233`,
				`9,h,1000,+r`,
				`9,h,1000,-r`,
				`9,h,1000,-r`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1432132602233,1432132603233,1432132602233~1432132603233~` + csv.UnknownWakeup + `,`,
			}, "\n"),
			wantErrs: []error{
				errors.New("** Error in 9,h,1000,-r with -r : -r received without a corresponding +r"),
			},
		},
		{
			desc: "Subsequent running - check wake reasons correctly attributed",
			input: strings.Join([]string{
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1422620451417`,
				`9,hsp,33,10007,"*walarm*:ALARM_WAKEUP_LOCATOR"`,
				`9,h,500,+r,wr=10`,
				`9,h,500,-r`,
				`9,h,1000,+r,wr=33`,
				`9,h,1000,-r`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1422620451917,1422620452417,"1422620451917~1422620452417~57:qcom,smd-modem:200:qcom,smd-rpm",`,
				`CPU running,string,1422620453417,1422620454417,1422620453417~1422620454417~*walarm*:ALARM_WAKEUP_LOCATOR,`,
			}, "\n"),
		},
		{
			desc: "Second running gets wake reason after negative transition",
			input: strings.Join([]string{
				`9,hsp,10,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1422620451417`,
				`9,hsp,33,10007,"*walarm*:ALARM_WAKEUP_LOCATOR"`,
				`9,h,500,+r,wr=10`,
				`9,h,500,-r`,
				`9,h,1000,+r`,
				`9,h,1000,-r,wr=33`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1422620451917,1422620452417,"1422620451917~1422620452417~57:qcom,smd-modem:200:qcom,smd-rpm",`,
				`CPU running,string,1422620453417,1422620454417,1422620454417~*walarm*:ALARM_WAKEUP_LOCATOR,`,
			}, "\n"),
		},
		{
			desc: "Multiple wake up reasons",
			input: strings.Join([]string{
				`9,hsp,20,0,"Abort:Pending Wakeup Sources: ipc00000177_FLP Service Cal "`,
				`9,hsp,21,0,"Abort:Pending Wakeup Sources: sh2ap_wakelock "`,
				`9,hsp,22,0,"Abort:Some devices failed to suspend"`,
				`9,hsp,28,0,"200:qcom,smd-rpm:222:fc4cf000.qcom,spmi"`,
				`9,h,0:RESET:TIME:1000`,
				`9,h,0,+r`,
				`9,h,1000,wr=20`,
				`9,h,500,wr=21`,
				`9,h,1000,wr=22`,
				`9,h,1000,wr=21`,
				`9,h,100,-r`,
				`9,h,4900,+r,wr=28`,
				`9,h,1000,-r`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`CPU running,string,1000,4600,1000~2500~Abort:Pending Wakeup Sources: ipc00000177_FLP Service Cal |2500~3500~Abort:Pending Wakeup Sources: sh2ap_wakelock |3500~4500~Abort:Some devices failed to suspend|4500~4600~Abort:Pending Wakeup Sources: sh2ap_wakelock ,`,
				`CPU running,string,9500,10500,"9500~10500~200:qcom,smd-rpm:222:fc4cf000.qcom,spmi",`,
			}, "\n"),
		},
		{
			desc: "Reset in history",
			input: strings.Join([]string{
				`9,hsp,50,0,"Abort:Last active Wakeup Source: eventpoll"`,
				`9,hsp,51,0,"Abort:Pending Wakeup Sources: sh2ap_wakelock "`,
				`9,hsp,52,0,"57:qcom,smd-modem:200:qcom,smd-rpm"`,
				`9,h,0:RESET:TIME:1000`,
				`9,h,2000,+r`,
				`9,h,1000:RESET:TIME:20000`, // No START line before RESET, most likely user caused.
				`9,h,1000,+r`,
				`9,h,1000,wr=50`,
				`9,h,5000,-r,wr=51`,
			}, "\n"),
			wantNumSummaries: 2,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				// fixTimeline will change the timestamps based on the latest seen TIME values.
				`CPU running,string,19000,19000,19000~` + csv.UnknownWakeup + `,`,
				`CPU running,string,21000,27000,21000~27000~Abort:Last active Wakeup Source: eventpoll|27000~Abort:Pending Wakeup Sources: sh2ap_wakelock ,`,
			}, "\n"),
		},
	}
	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, false)
		validateHistory(test.input, t, result, len(test.wantErrs), test.wantNumSummaries)

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v)\n  got csv = %q\n  want: %q", test.desc, test.input, got, want)
		}
		if !reflect.DeepEqual(test.wantErrs, result.Errs) {
			t.Errorf("%v: AnalyzeHistory(%v,...)\n errs = %q\n want %q", test.desc, test.input, result.Errs, test.wantErrs)
		}
	}
}

// Removes trailing space at the end of the string, then splits by new line.
func normalizeCSV(text string) []string {
	lines := strings.Split(strings.TrimSpace(text), "\n")

	// Order of events generated might not be the same - if several transitions are open
	// at a SHUTDOWN event, then we iterate through the open events and create csv entries.
	// As iteration order of go maps is not defined, this may result a different order generated.
	sort.Strings(lines)

	return lines
}

// TestSignificantMotionParse tests the parsing of 'Esm' entries in a history log.
func TestSignificantMotionParse(t *testing.T) {
	test := struct {
		desc    string
		input   string
		wantCSV string
	}{
		"Test significant motion parse",
		strings.Join([]string{
			`9,hsp,87,0,""`,
			`9,h,0:RESET:TIME:1432450900000`,
			`9,h,100,+di`,
			`9,h,100,-di,`, // no Esm
			`9,h,100,+di`,
			`9,h,100,-di,Esm=87`, // Esm following -di
			`9,h,100,+di`,
			`9,h,100,-di,Esm=87`, // Esm in the last line of a summary
		}, "\n"),
		strings.Join([]string{
			csv.FileHeader,
			`Doze,string,1432450900000,1432450900100,off,`,
			`Doze,string,1432450900100,1432450900200,full,`,
			`Doze,string,1432450900200,1432450900300,off,`,
			`Doze,string,1432450900300,1432450900400,full,`,
			`Doze,string,1432450900400,1432450900500,off,`,
			`Significant motion,bool,1432450900400,1432450900400,true,`,
			`Doze,string,1432450900500,1432450900600,full,`,
			`Doze,string,1432450900600,1432450900600,off,`,
			`Significant motion,bool,1432450900600,1432450900600,true,`,
		}, "\n"),
	}

	var b bytes.Buffer
	result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(test.input, t, result, 0, 1)

	got := normalizeCSV(b.String())
	want := normalizeCSV(test.wantCSV)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%v: AnalyzeHistory(%v) generated incorrect csv:\n  got: %q\n  want: %q", test.desc, test.input, got, want)
	}
}

// TestDeviceActiveParse tests the parsing of 'Eac' entries in a history log.
func TestDeviceActiveParse(t *testing.T) {
	test := struct {
		desc    string
		input   string
		wantCSV string
	}{
		"Test significant motion parse",
		strings.Join([]string{
			`9,hsp,50,0,""`,
			`9,h,0:RESET:TIME:1432450900000`,
			`9,h,100,+di`,
			`9,h,100,-di,`, // no Eac
			`9,h,100,+di`,
			`9,h,100,-di,Eac=50`, // Eac following -di
			`9,h,100,+di`,
			`9,h,100,-di,Eac=50`, // Eac in the last line of a summary
		}, "\n"),
		strings.Join([]string{
			csv.FileHeader,
			`Doze,string,1432450900000,1432450900100,off,`,
			`Doze,string,1432450900100,1432450900200,full,`,
			`Doze,string,1432450900200,1432450900300,off,`,
			`Doze,string,1432450900300,1432450900400,full,`,
			`Doze,string,1432450900400,1432450900500,off,`,
			`Device active,bool,1432450900400,1432450900400,true,`,
			`Doze,string,1432450900500,1432450900600,full,`,
			`Doze,string,1432450900600,1432450900600,off,`,
			`Device active,bool,1432450900600,1432450900600,true,`,
		}, "\n"),
	}

	var b bytes.Buffer
	result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(test.input, t, result, 0, 1)

	got := normalizeCSV(b.String())
	want := normalizeCSV(test.wantCSV)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%v: AnalyzeHistory(%v) generated incorrect csv:\n  got: %q\n  want: %q", test.desc, test.input, got, want)
	}
}

// TestServicePackageMatching tests that matching package info to ServiceUIDs works properly.
func TestServicePackageMatching(t *testing.T) {
	tests := []struct {
		desc         string
		inputHistory string
		inputCheckin string
		pkgList      []*usagepb.PackageInfo
		wantIdxMap   map[string]ServiceUID
	}{
		{
			desc: "Test simple parsing",
			inputHistory: strings.Join([]string{
				`9,hsp,4,10139,"com.google.android.apps.interactiveevents"`, // There should be no match
				`9,hsp,6,1234,"com.google.android.apps.chromecast.app"`,     // The "UID" section for Epi is actually just the version code of the app.
				`9,hsp,7,81,"com.google.android.apps.blogger"`,              // The "UID" section for Epu is actually just the version code of the app.
				`9,h,0:RESET:TIME:1432964300000`,
				`9,h,2000,Eai=4`,
				`9,h,3000,Epi=6`,
				`9,h,4000,Epu=7`,
			}, "\n"),
			inputCheckin: `9,10061,l,apk,0,com.google.android.apps.chromecast.app,...`, // Test that index 6 matches via checkin output matching.
			pkgList: []*usagepb.PackageInfo{ // Test that index 7 matches via pkg list matching.
				{
					PkgName:     proto.String("com.google.android.apps.blogger"),
					Uid:         proto.Int32(10070),
					VersionCode: proto.Int32(81),
				},
			},
			wantIdxMap: map[string]ServiceUID{
				"4": {
					Service: `"com.google.android.apps.interactiveevents"`,
					UID:     "10139",
				},
				"6": {
					Service: `"com.google.android.apps.chromecast.app"`,
					UID:     "1234",
					Pkg: &usagepb.PackageInfo{
						PkgName: proto.String("com.google.android.apps.chromecast.app"),
						Uid:     proto.Int32(10061),
					},
				},
				"7": {
					Service: `"com.google.android.apps.blogger"`,
					UID:     "81",
					Pkg: &usagepb.PackageInfo{
						PkgName:     proto.String("com.google.android.apps.blogger"),
						Uid:         proto.Int32(10070),
						VersionCode: proto.Int32(81),
					},
				},
			},
		},
	}

	for _, test := range tests {
		upm, errs := UIDAndPackageNameMapping(test.inputCheckin, test.pkgList)
		if len(errs) > 0 {
			t.Errorf("%v: UIDAndPackageMatching(%v, %v) generated unexpected errors:\n  %v", test.desc, test.inputCheckin, test.pkgList, errs)
		}
		result := AnalyzeHistory(ioutil.Discard, test.inputHistory, FormatTotalTime, upm, true)
		validateHistory(test.inputHistory, t, result, 0, 1)
		if len(result.Errs) > 0 {
			t.Errorf("%v: AnalyzeHistory(%v, %v) generated unexpected errors:\n  %v", test.desc, test.inputHistory, upm, result.Errs)
		}

		if !reflect.DeepEqual(result.IdxMap, test.wantIdxMap) {
			t.Errorf("%v: AnalyzeHistory(%v, %v) generated service map:\n  got: %q\n  want: %q", test.desc, test.inputHistory, upm, result.IdxMap, test.wantIdxMap)
		}
	}
}

// TestInstantAppEventParsing tests the parsing of 'Eaa', 'Eai', 'Epi', 'Epu', and 'Ewa' entries in a history log
func TestInstantAppEventParsing(t *testing.T) {
	tests := []struct {
		desc         string
		inputHistory string
		inputCheckin string
		pkgList      []*usagepb.PackageInfo
		wantCSV      string
		wantErrors   []error
	}{
		{
			desc: "Test simple parsing",
			inputHistory: strings.Join([]string{
				`9,hsp,3,10028,"com.googlecode.eyesfree.brailleback"`,
				`9,hsp,4,10139,"com.google.android.apps.interactiveevents"`,
				`9,hsp,6,1234,"com.google.android.apps.chromecast.app"`, // The "UID" section for Epi is actually just the version code of the app.
				`9,hsp,7,81,"com.google.android.apps.blogger"`,          // The "UID" section for Epu is actually just the version code of the app.
				`9,hsp,8,10070,""`,                                      // The log won't include the application name, just the UID.
				`9,h,0:RESET:TIME:1432964300000`,
				`9,h,1000,Eaa=3`,
				`9,h,2000,Eai=4`,
				`9,h,3000,Epi=6`,
				`9,h,4000,Epu=7`,
				`9,h,5000,Ewa=8`,
			}, "\n"),
			inputCheckin: `9,10061,l,apk,1,com.google.android.apps.chromecast.app,...`, // Test that epi=6 outputs the proper UID via checkin output matching.
			pkgList: []*usagepb.PackageInfo{ // Test that Epu=7 outputs the proper UID via pkg list matching.
				{
					PkgName:     proto.String("com.google.android.apps.blogger"),
					Uid:         proto.Int32(10070),
					VersionCode: proto.Int32(81),
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Package active,service,1432964301000,1432964301000,com.googlecode.eyesfree.brailleback,10028`,
				`Package inactive,service,1432964303000,1432964303000,com.google.android.apps.interactiveevents,10139`,
				`Package install,service,1432964306000,1432964306000,com.google.android.apps.chromecast.app,10061`,
				`Package uninstall,service,1432964310000,1432964310000,com.google.android.apps.blogger,10070`,
				`App Processor wakeup,service,1432964315000,1432964315000,com.google.android.apps.blogger,10070`,
			}, "\n"),
		},
		{
			desc: "Test missing entries",
			inputHistory: strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300000`,
				`9,h,1000,Eaa=3`,
				`9,h,2000,Eai=4`,
				`9,h,3000,Epi=6`,
				`9,h,4000,Epu=7`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
			}, "\n"),
			wantErrors: []error{
				errors.New(`** Error in 9,h,1000,Eaa=3 with Eaa=3 : unable to find index "3" in idxMap for "Package active"`),
				errors.New(`** Error in 9,h,2000,Eai=4 with Eai=4 : unable to find index "4" in idxMap for "Package inactive"`),
				errors.New(`** Error in 9,h,3000,Epi=6 with Epi=6 : unable to find index "6" in idxMap for "Package install"`),
				errors.New(`** Error in 9,h,4000,Epu=7 with Epu=7 : unable to find index "7" in idxMap for "Package uninstall"`),
			},
		},
	}

	for _, test := range tests {
		upm, errs := UIDAndPackageNameMapping(test.inputCheckin, test.pkgList)
		if len(errs) > 0 {
			t.Errorf("%v: UIDAndPackageMatching(%v, %v) generated unexpected errors:\n  %v", test.desc, test.inputCheckin, test.pkgList, errs)
		}

		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.inputHistory, FormatTotalTime, upm, true)
		validateHistory(test.inputHistory, t, result, len(test.wantErrors), 1)

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v, %v) generated incorrect csv:\n  got: %q\n  want: %q", test.desc, test.inputHistory, upm, got, want)
		}
		if !reflect.DeepEqual(result.Errs, test.wantErrors) {
			t.Errorf("%v: AnalyzeHistory(%v, %v) generated unexpected errors:\n  got: %v\n  want: %v", test.desc, test.inputHistory, upm, result.Errs, test.wantErrors)
		}
	}
}

// Tests fixing bug in adding empty duration to summary for TotalTime format
func TestFixDurationInTotalTime(t *testing.T) {
	input := strings.Join([]string{
		`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
		`9,h,0:RESET:TIME:141688070`,
		`9,h,0,Bl=46,Bs=d,Bh=g,Bp=u,Bt=326,Pst=out,Bv=3814,+r,+BP`,
		`9,h,3255,Pst=in`,
		`9,h,70,+w=17`,
		`9,h,3255,Pst=off`,
	}, "\n")

	want := map[string]Dist{
		"out": {
			Num:           1,
			TotalDuration: 3255 * time.Millisecond,
			MaxDuration:   3255 * time.Millisecond,
		},
		"in": {
			Num:           1,
			TotalDuration: 3325 * time.Millisecond,
			MaxDuration:   3325 * time.Millisecond,
		},
		"off": {
			Num:           1,
			TotalDuration: 0,
			MaxDuration:   0,
		},
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 0, 1)
	s := result.Summaries[0]

	if !reflect.DeepEqual(s.PhoneStateSummary, want) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].PhoneStateSummary = %v, want %v", input, s.PhoneStateSummary, want)
	}
}

// Tests fixing bug in adding empty duration to summary for BatteryLevel format
func TestFixDurationInBatteryLevel(t *testing.T) {
	tests := []struct {
		desc        string
		input       string
		wantSummary []map[string]Dist
	}{
		{
			desc: "BatteryLevel format summary, normal cases",
			input: strings.Join([]string{
				`9,h,0:RESET:TIME:141688070`,
				`9,h,0,Bl=46,Pst=out`,
				`9,h,3255,Pst=in`,
				`9,h,3255,Pst=off`,
				`9,h,30,Bl=45`,
				`9,h,3255,Pst=out`,
				`9,h,3255,Pst=in`,
				`9,h,30,Bl=44`,
				`9,h,3255,Pst=out`,
				`9,h,30,Bl=43`,
				`9,h,3255,Pst=off`,
				`9,h,70,Bl=42`,
			}, "\n"),
			wantSummary: []map[string]Dist{
				{
					"out": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"in": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"off": {
						Num:           1,
						TotalDuration: 30 * time.Millisecond,
						MaxDuration:   30 * time.Millisecond,
					},
				},
				{
					"off": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"out": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"in": {
						Num:           1,
						TotalDuration: 30 * time.Millisecond,
						MaxDuration:   30 * time.Millisecond,
					},
				},
				{
					"in": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"out": {
						Num:           1,
						TotalDuration: 30 * time.Millisecond,
						MaxDuration:   30 * time.Millisecond,
					},
				},
				{
					"out": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"off": {
						Num:           1,
						TotalDuration: 70 * time.Millisecond,
						MaxDuration:   70 * time.Millisecond,
					},
				},
			},
		},
		{
			desc: `BatteryLevel format summary, events followed by and with Bl immediately.
      We deleted empty duration dist cases at the beginning of summaries, and keep
      the ones at the end of summaries in case events not ended by the end of the summary.`,
			input: strings.Join([]string{
				`9,h,0:RESET:TIME:141688070`,
				`9,h,0,Bl=46,Pst=out`,
				`9,h,3255,Pst=in`,
				`9,h,3255,Pst=off`,
				`9,h,0,Bl=45`,
				`9,h,0,Pst=in`, // Pst=in immediately following Bl
				`9,h,3255,Pst=out`,
				`9,h,3255,Pst=off`,
				`9,h,0,Bl=44`,
				`9,h,3255,Pst=in`,
				`9,h,3255,Pst=out`, // Pst=out immediately followed by Bl
				`9,h,0,Bl=43`,
				`9,h,3255,Pst=off`,
				`9,h,0,Bl=42`,
			}, "\n"),
			wantSummary: []map[string]Dist{
				{
					"out": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"in": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"off": {
						Num:           1,
						TotalDuration: 0 * time.Millisecond,
						MaxDuration:   0 * time.Millisecond,
					},
				},
				{
					"in": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"out": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"off": {
						Num:           1,
						TotalDuration: 0 * time.Millisecond,
						MaxDuration:   0 * time.Millisecond,
					},
				},
				{
					"off": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"in": Dist{
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"out": {
						Num:           1,
						TotalDuration: 0 * time.Millisecond,
						MaxDuration:   0 * time.Millisecond,
					},
				},
				{
					"out": {
						Num:           1,
						TotalDuration: 3255 * time.Millisecond,
						MaxDuration:   3255 * time.Millisecond,
					},
					"off": {
						Num:           1,
						TotalDuration: 0 * time.Millisecond,
						MaxDuration:   0 * time.Millisecond,
					},
				},
			},
		},
	}

	for _, test := range tests {
		result := AnalyzeHistory(ioutil.Discard, test.input, FormatBatteryLevel, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, 0, len(test.wantSummary))

		if len(result.Summaries) == len(test.wantSummary) {
			for i, s := range result.Summaries {
				if !reflect.DeepEqual(s.PhoneStateSummary, test.wantSummary[i]) {
					t.Errorf("AnalyzeHistory(%s,...).Summaries[%v].PhoneStateSummary = %v, want %v", test.input, i, s.PhoneStateSummary, test.wantSummary[i])
				}
			}
		}
	}
}

// TestPhoneParsing tests the parsing of phone state (Pst) and phone signal strength (Pss) events.
func TestPhoneParsing(t *testing.T) {
	tests := []struct {
		desc                           string
		input                          string
		wantPhoneStateSummary          map[string]Dist
		wantPhoneSignalStrengthSummary map[string]Dist
	}{
		{
			desc: "Parse every phone state and signal strength",
			input: strings.Join([]string{
				`9,h,0:RESET:TIME:141688070`,
				`9,h,0,Pst=off,Pss=0`,
				`9,h,500,Pst=out`,
				`9,h,1000,Pst=in,Pss=1`,
				`9,h,1000,Pss=2`,
				`9,h,1000,Pst=em,Pss=3`,
				`9,h,1000,Pss=4`,
				`9,h,1500,Pst=off`, // Pss=4 should end here since the phone state is off.
				`9,h,2000,Bl=50`,   // Extra line just to make sure 'off' duration is good.
			}, "\n"),
			wantPhoneStateSummary: map[string]Dist{
				"off": {
					Num:           2,
					TotalDuration: 2500 * time.Millisecond,
					MaxDuration:   2000 * time.Millisecond,
				},
				"out": {
					Num:           1,
					TotalDuration: 1000 * time.Millisecond,
					MaxDuration:   1000 * time.Millisecond,
				},
				"in": {
					Num:           1,
					TotalDuration: 2000 * time.Millisecond,
					MaxDuration:   2000 * time.Millisecond,
				},
				"em": {
					Num:           1,
					TotalDuration: 2500 * time.Millisecond,
					MaxDuration:   2500 * time.Millisecond,
				},
			},
			wantPhoneSignalStrengthSummary: map[string]Dist{
				"none": { // 0 = none
					Num:           2,
					TotalDuration: 3500 * time.Millisecond,
					MaxDuration:   2000 * time.Millisecond,
				},
				"poor": { // 1 = poor
					Num:           1,
					TotalDuration: 1000 * time.Millisecond,
					MaxDuration:   1000 * time.Millisecond,
				},
				"moderate": { // 2 = moderate
					Num:           1,
					TotalDuration: 1000 * time.Millisecond,
					MaxDuration:   1000 * time.Millisecond,
				},
				"good": { // 3 = good
					Num:           1,
					TotalDuration: 1000 * time.Millisecond,
					MaxDuration:   1000 * time.Millisecond,
				},
				"great": { // 4 = great
					Num:           1,
					TotalDuration: 1500 * time.Millisecond,
					MaxDuration:   1500 * time.Millisecond,
				},
			},
		},
	}

	for _, test := range tests {
		result := AnalyzeHistory(ioutil.Discard, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, 0, 1)

		if len(result.Summaries) == 1 {
			s := result.Summaries[0]
			if !reflect.DeepEqual(s.PhoneStateSummary, test.wantPhoneStateSummary) {
				t.Errorf("%s--AnalyzeHistory(%s,...).Summaries.PhoneStateSummary gave incorrect output:\n got:  %v\n  want: %v", test.desc, test.input, s.PhoneStateSummary, test.wantPhoneStateSummary)
			}
			if !reflect.DeepEqual(s.PhoneSignalStrengthSummary, test.wantPhoneSignalStrengthSummary) {
				t.Errorf("%s--AnalyzeHistory(%s,...).Summaries.PhoneSignalStrengthSummary gave incorrect output:\n got:  %v\n  want: %v", test.desc, test.input, s.PhoneSignalStrengthSummary, test.wantPhoneSignalStrengthSummary)
			}
		}
	}
}

// TestWifiParsing tests the parsing of wifi (W) and wifi signal strength (Wss) logs.
func TestWifiParsing(t *testing.T) {
	tests := []struct {
		desc                          string
		input                         string
		wantWifiOnSummary             Dist
		wantWifiSignalStrengthSummary map[string]Dist
	}{
		{
			desc: "Parse simple wifi on/off and all wifi signal strength",
			input: strings.Join([]string{
				`9,h,0:RESET:TIME:141688070`,
				`9,h,0,+W`,
				`9,h,500,Wss=0`,
				`9,h,1000,Wss=1`,
				`9,h,1000,Wss=2`,
				`9,h,1000,Wss=3`,
				`9,h,1000,Wss=4`,
				`9,h,500,-W`, // Wss=4 should end here since the phone state is off.
			}, "\n"),
			wantWifiOnSummary: Dist{
				Num:           1,
				TotalDuration: 5000 * time.Millisecond,
				MaxDuration:   5000 * time.Millisecond,
			},
			wantWifiSignalStrengthSummary: map[string]Dist{
				"none": { // 0 = none
					Num:           2,
					TotalDuration: 1000 * time.Millisecond,
					MaxDuration:   1000 * time.Millisecond,
				},
				"poor": { // 1 = poor
					Num:           1,
					TotalDuration: 1000 * time.Millisecond,
					MaxDuration:   1000 * time.Millisecond,
				},
				"moderate": { // 2 = moderate
					Num:           1,
					TotalDuration: 1000 * time.Millisecond,
					MaxDuration:   1000 * time.Millisecond,
				},
				"good": { // 3 = good
					Num:           1,
					TotalDuration: 1000 * time.Millisecond,
					MaxDuration:   1000 * time.Millisecond,
				},
				"great": { // 4 = great
					Num:           1,
					TotalDuration: 500 * time.Millisecond,
					MaxDuration:   500 * time.Millisecond,
				},
			},
		},
	}

	for _, test := range tests {
		result := AnalyzeHistory(ioutil.Discard, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, 0, 1)

		if len(result.Summaries) == 1 {
			s := result.Summaries[0]
			if !reflect.DeepEqual(s.WifiOnSummary, test.wantWifiOnSummary) {
				t.Errorf("%s--AnalyzeHistory(%s,...).Summaries.WifiOnSummary gave incorrect output:\n got:  %v\n  want: %v", test.desc, test.input, s.WifiOnSummary, test.wantWifiOnSummary)
			}
			if !reflect.DeepEqual(s.WifiSignalStrengthSummary, test.wantWifiSignalStrengthSummary) {
				t.Errorf("%s--AnalyzeHistory(%s,...).Summaries.WifiSignalStrengthSummary gave incorrect output:\n got:  %v\n  want: %v", test.desc, test.input, s.WifiSignalStrengthSummary, test.wantWifiSignalStrengthSummary)
			}
		}
	}
}

// TestAlarmParse tests the parsing of 'Eal' entries in a history log.
func TestAlarmParse(t *testing.T) {
	test := struct {
		desc        string
		input       string
		wantSummary map[string]Dist
		wantCSV     string
	}{
		"Normal alarm parse cases",
		strings.Join([]string{
			`9,hsp,34,1000,"PhoneWindowManager.mPowerKeyWakeLock"`,
			`9,hsp,35,10116,"flipboard.app"`,
			`9,hsp,40,10105,"com.whatsapp"`,
			`9,h,0:RESET:TIME:1432964300076`,
			`9,h,1000,+Eal=34`,
			`9,h,1000,+Eal=40`,
			`9,h,1000,-Eal=40`,
			`9,h,1000,-Eal=34`,
			`9,h,1000,+Eal=35`,
			`9,h,1000,-Eal=35`,
			`9,h,1000,+Eal=40`,
		}, "\n"),
		map[string]Dist{
			`"PhoneWindowManager.mPowerKeyWakeLock"`: {
				Num:           1,
				TotalDuration: 3000 * time.Millisecond,
				MaxDuration:   3000 * time.Millisecond,
			},
			`"flipboard.app"`: {
				Num:           1,
				TotalDuration: 1000 * time.Millisecond,
				MaxDuration:   1000 * time.Millisecond,
			},
			`"com.whatsapp"`: {
				Num:           2,
				TotalDuration: 1000 * time.Millisecond,
				MaxDuration:   1000 * time.Millisecond,
			},
		},
		strings.Join([]string{
			csv.FileHeader,
			`Alarm,service,1432964302076,1432964303076,com.whatsapp,10105`,
			`Alarm,service,1432964301076,1432964304076,PhoneWindowManager.mPowerKeyWakeLock,1000`,
			`Alarm,service,1432964305076,1432964306076,flipboard.app,10116`,
			`Alarm,service,1432964307076,1432964307076,com.whatsapp,10105`,
		}, "\n"),
	}

	var b bytes.Buffer
	result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(test.input, t, result, 0, 1)

	s := result.Summaries[0]
	if !reflect.DeepEqual(s.AlarmSummary, test.wantSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].AlarmSummary = %v, want %v", test.input, s.AlarmSummary, test.wantSummary)
	}

	got := normalizeCSV(b.String())
	want := normalizeCSV(test.wantCSV)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", test.desc, test.input, got, want)
	}
}

// TestEstParse tests an error condition for 'Est' parsing in a history log.
func TestEstParse(t *testing.T) {
	input := strings.Join([]string{
		`9,h,0:RESET:TIME:1432964300076`,
		`9,h,44377,Est=31`,
	}, "\n")

	want := []error{
		fmt.Errorf(`** Error in 9,h,44377,Est=31 with Est=31 : unable to find index "31" in idxMap for collect external stats event (Est)`),
	}

	result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 1, 1)

	if !reflect.DeepEqual(want, result.Errs) {
		t.Errorf("AnalyzeHistory(%s,...) = %v, want %v", input, result.Errs, want)
	}
}

// TestWifiSupplParse tests the parsing of 'Wsp' entries in a history log.
func TestWifiSupplParse(t *testing.T) {
	tests := []struct {
		desc        string
		input       string
		wantSummary map[string]Dist
		wantCSV     string
		wantErrors  []error
	}{
		{
			"Test wifi supplicant parse",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,0,Wsp=compl`,
				`9,h,16591,Wsp=dsc`,
				`9,h,106,Wsp=scan`,
				`9,h,1880,Wsp=dsc`,
				`9,h,16,Wsp=scan`,
				`9,h,65684,Wsp=group`,
				`9,h,1,Wsp=compl`,
				`9,h,8294,Wsp=ascing`,
				`9,h,1596,Wsp=asced`,
				`9,h,4,Wsp=4-way`,
				`9,h,143,Wsp=group`,
				`9,h,80,Wsp=compl`,
			}, "\n"),
			map[string]Dist{
				"compl": {
					Num:           3,
					TotalDuration: 24885 * time.Millisecond,
					MaxDuration:   16591 * time.Millisecond,
				},
				"dsc": {
					Num:           2,
					TotalDuration: 122 * time.Millisecond,
					MaxDuration:   106 * time.Millisecond,
				},
				"scan": {
					Num:           2,
					TotalDuration: 67564 * time.Millisecond,
					MaxDuration:   65684 * time.Millisecond,
				},
				"group": {
					Num:           2,
					TotalDuration: 81 * time.Millisecond,
					MaxDuration:   80 * time.Millisecond,
				},
				"ascing": {
					Num:           1,
					TotalDuration: 1596 * time.Millisecond,
					MaxDuration:   1596 * time.Millisecond,
				},
				"asced": {
					Num:           1,
					TotalDuration: 4 * time.Millisecond,
					MaxDuration:   4 * time.Millisecond,
				},
				"4-way": {
					Num:           1,
					TotalDuration: 143 * time.Millisecond,
					MaxDuration:   143 * time.Millisecond,
				},
			},
			strings.Join([]string{
				csv.FileHeader,
				"Wifi supplicant,string,1432964300076,1432964316667,compl,",
				"Wifi supplicant,string,1432964316667,1432964316773,dsc,",
				"Wifi supplicant,string,1432964316773,1432964318653,scan,",
				"Wifi supplicant,string,1432964318653,1432964318669,dsc,",
				"Wifi supplicant,string,1432964318669,1432964384353,scan,",
				"Wifi supplicant,string,1432964384353,1432964384354,group,",
				"Wifi supplicant,string,1432964384354,1432964392648,compl,",
				"Wifi supplicant,string,1432964392648,1432964394244,ascing,",
				"Wifi supplicant,string,1432964394244,1432964394248,asced,",
				"Wifi supplicant,string,1432964394248,1432964394391,4-way,",
				"Wifi supplicant,string,1432964394391,1432964394471,group,",
				"Wifi supplicant,string,1432964394471,1432964394471,compl,",
			}, "\n"),
			nil,
		},
		{
			"Unknown wifi supplicant",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,0,Wsp=5`,
			}, "\n"),
			map[string]Dist{},
			strings.Join([]string{
				csv.FileHeader,
			}, "\n"),
			[]error{fmt.Errorf(`*** Error in 9,h,0,Wss=5 with Wss=5 : unknown Wifi Supplicant state = "5"`)},
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, len(test.wantErrors), len(result.Summaries))

		if len(result.Summaries) > 0 {
			s := result.Summaries[0]
			if !reflect.DeepEqual(s.WifiSupplSummary, test.wantSummary) {
				t.Errorf("AnalyzeHistory(%s,...).Summaries[0].WifiSupplSummary = %v, want %v", test.input, s.WifiSupplSummary, test.wantSummary)
			}

			got := normalizeCSV(b.String())
			want := normalizeCSV(test.wantCSV)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", test.desc, test.input, got, want)
			}
			if !reflect.DeepEqual(result.Errs, test.wantErrors) {
				t.Errorf("%v: AnalyzeHistory(%v) unexpected errors = %v, want: %v", test.desc, test.input, result.Errs, test.wantErrors)
			}
		}
	}
}

// TestWifiSignalStrengthParse tests the parsing of 'Wss' entries in a history log.
func TestWifiSignalStrengthParse(t *testing.T) {
	tests := []struct {
		desc        string
		input       string
		wantSummary map[string]Dist
		wantCSV     string
		wantErrors  []error
	}{
		{
			"Normal wifi signalStrength Parse",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,0,Wss=3`,
				`9,h,942,Wss=4`,
				`9,h,2021,Wss=3`,
				`9,h,5293,Wss=2`,
				`9,h,7723,Wss=3`,
				`9,h,4495,Wss=2`,
				`9,h,1759,Wss=3`,
				`9,h,3064,Wss=0`,
				`9,h,304,Wss=1`,
			}, "\n"),
			map[string]Dist{
				"good": {
					Num:           4,
					TotalDuration: 13794 * time.Millisecond,
					MaxDuration:   5293 * time.Millisecond,
				},
				"great": {
					Num:           1,
					TotalDuration: 2021 * time.Millisecond,
					MaxDuration:   2021 * time.Millisecond,
				},
				"moderate": {
					Num:           2,
					TotalDuration: 9482 * time.Millisecond,
					MaxDuration:   7723 * time.Millisecond,
				},
				"none": {
					Num:           1,
					TotalDuration: 304 * time.Millisecond,
					MaxDuration:   304 * time.Millisecond,
				},
				"poor": {
					Num:           1,
					TotalDuration: 0 * time.Millisecond,
					MaxDuration:   0 * time.Millisecond,
				},
			},
			strings.Join([]string{
				csv.FileHeader,
				"Wifi signal strength,string,1432964300076,1432964301018,good,",
				"Wifi signal strength,string,1432964301018,1432964303039,great,",
				"Wifi signal strength,string,1432964303039,1432964308332,good,",
				"Wifi signal strength,string,1432964308332,1432964316055,moderate,",
				"Wifi signal strength,string,1432964316055,1432964320550,good,",
				"Wifi signal strength,string,1432964320550,1432964322309,moderate,",
				"Wifi signal strength,string,1432964322309,1432964325373,good,",
				"Wifi signal strength,string,1432964325373,1432964325677,none,",
				"Wifi signal strength,string,1432964325677,1432964325677,poor,",
			}, "\n"),
			nil,
		},
		{
			"No wifi signal strength event in bugreport",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,26640,+Wl`, // Extra line needed to mimic other events in bugreport.
			}, "\n"),
			map[string]Dist{
				"default": {
					Num:           1,
					TotalDuration: 26640 * time.Millisecond,
					MaxDuration:   26640 * time.Millisecond,
				},
			},
			strings.Join([]string{
				csv.FileHeader,
				"Wifi full lock,bool,1432964326716,1432964326716,true,",
			}, "\n"),
			nil,
		},
		{
			"Unknown wifi signal strength",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,0,Wss=5`,
			}, "\n"),
			map[string]Dist{},
			strings.Join([]string{
				csv.FileHeader,
			}, "\n"),
			[]error{fmt.Errorf(`*** Error in 9,h,0,Wss=5 with Wss=5 : unknown wifi signal strength = "5"`)},
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, len(test.wantErrors), len(result.Summaries))

		if len(result.Summaries) > 0 {
			s := result.Summaries[0]
			if !reflect.DeepEqual(s.WifiSignalStrengthSummary, test.wantSummary) {
				t.Errorf("AnalyzeHistory(%s,...).Summaries[0].WifiSignalStrengthSummary = %v, want %v", test.input, s.WifiSignalStrengthSummary, test.wantSummary)
			}

			got := normalizeCSV(b.String())
			want := normalizeCSV(test.wantCSV)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", test.desc, test.input, got, want)
			}
			if !reflect.DeepEqual(result.Errs, test.wantErrors) {
				t.Errorf("%v: AnalyzeHistory(%v) unexpected errors = %v, want: %v", test.desc, test.input, result.Errs, test.wantErrors)
			}
		}
	}
}

// TestPhoneSignalStrengthParse tests the parsing of 'Pss' entries in a history log.
func TestPhoneSignalStrengthParse(t *testing.T) {
	tests := []struct {
		desc        string
		input       string
		wantSummary map[string]Dist
		wantCSV     string
		wantErrors  []error
	}{
		{
			"Normal phone signal strength parse",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,0,Pss=3`,
				`9,h,942,Pss=4`,
				`9,h,2021,Pss=3`,
				`9,h,5293,Pss=2`,
				`9,h,7723,Pss=3`,
				`9,h,4495,Pss=2`,
				`9,h,1759,Pss=3`,
				`9,h,3064,Pss=0`,
				`9,h,304,Pss=1`,
			}, "\n"),
			map[string]Dist{
				"good": {
					Num:           4,
					TotalDuration: 13794 * time.Millisecond,
					MaxDuration:   5293 * time.Millisecond,
				},
				"great": {
					Num:           1,
					TotalDuration: 2021 * time.Millisecond,
					MaxDuration:   2021 * time.Millisecond,
				},
				"moderate": {
					Num:           2,
					TotalDuration: 9482 * time.Millisecond,
					MaxDuration:   7723 * time.Millisecond,
				},
				"none": {
					Num:           1,
					TotalDuration: 304 * time.Millisecond,
					MaxDuration:   304 * time.Millisecond,
				},
				"poor": {
					Num:           1,
					TotalDuration: 0 * time.Millisecond,
					MaxDuration:   0 * time.Millisecond,
				},
			},
			strings.Join([]string{
				csv.FileHeader,
				"Mobile signal strength,string,1432964300076,1432964301018,good,",
				"Mobile signal strength,string,1432964301018,1432964303039,great,",
				"Mobile signal strength,string,1432964303039,1432964308332,good,",
				"Mobile signal strength,string,1432964308332,1432964316055,moderate,",
				"Mobile signal strength,string,1432964316055,1432964320550,good,",
				"Mobile signal strength,string,1432964320550,1432964322309,moderate,",
				"Mobile signal strength,string,1432964322309,1432964325373,good,",
				"Mobile signal strength,string,1432964325373,1432964325677,none,",
				"Mobile signal strength,string,1432964325677,1432964325677,poor,",
			}, "\n"),
			nil,
		},
		{
			"No phone signal strength event in bugreport",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,26640,+Wl`, // Extra line needed to mimic other events in bugreport.
			}, "\n"),
			map[string]Dist{
				"default": {
					Num:           1,
					TotalDuration: 26640 * time.Millisecond,
					MaxDuration:   26640 * time.Millisecond,
				},
			},
			strings.Join([]string{
				csv.FileHeader,
				"Wifi full lock,bool,1432964326716,1432964326716,true,",
			}, "\n"),
			nil,
		},
		{
			"Unknown phone signal strength",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,0,Pss=5`,
			}, "\n"),
			map[string]Dist{},
			strings.Join([]string{
				csv.FileHeader,
			}, "\n"),
			[]error{fmt.Errorf(`*** Error in 9,h,0,Pss=5 with Pss=5 : unknown phone signal strength = "5"`)},
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, len(test.wantErrors), len(result.Summaries))

		if len(result.Summaries) > 0 {
			s := result.Summaries[0]
			if !reflect.DeepEqual(s.PhoneSignalStrengthSummary, test.wantSummary) {
				t.Errorf("AnalyzeHistory(%s,...).Summaries[0].PhoneSignalStrengthSummary = %v, want %v", test.input, s.PhoneSignalStrengthSummary, test.wantSummary)
			}

			got := normalizeCSV(b.String())
			want := normalizeCSV(test.wantCSV)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", test.desc, test.input, got, want)
			}
			if !reflect.DeepEqual(result.Errs, test.wantErrors) {
				t.Errorf("%v: AnalyzeHistory(%v) unexpected errors = %v, want: %v", test.desc, test.input, result.Errs, test.wantErrors)
			}
		}
	}
}

// TestChargingOnParse tests the parsing of 'ch' entries in a history log.
func TestChargingOnParse(t *testing.T) {
	tests := []struct {
		desc        string
		input       string
		wantSummary Dist
		wantCSV     string
		wantErrors  []error
	}{
		{
			"Normal case for charging on",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,2242,+ch`,
				`9,h,64,-ch`,
				"9,h,1000,+ch",
				"9,h,1500,-ch",
			}, "\n"),
			Dist{
				Num:           2,
				TotalDuration: 1564 * time.Millisecond,
				MaxDuration:   1500 * time.Millisecond,
			},
			strings.Join([]string{
				csv.FileHeader,
				"Charging on,bool,1432964302318,1432964302382,true,",
				"Charging on,bool,1432964303382,1432964304882,true,",
			}, "\n"),
			nil,
		},
		{
			"First entry is a negative transition",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,64,-ch`,
				"9,h,1000,+ch",
				"9,h,1500,-ch",
			}, "\n"),
			Dist{
				Num:           2,
				TotalDuration: 1564 * time.Millisecond,
				MaxDuration:   1500 * time.Millisecond,
			},
			strings.Join([]string{
				csv.FileHeader,
				"Charging on,bool,1432964300076,1432964300140,true,",
				"Charging on,bool,1432964301140,1432964302640,true,",
			}, "\n"),
			nil,
		},
		{
			"Positive transition before shutdown",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,2242,+ch`,
				`9,h,64,-ch`,
				"9,h,1000,+ch",
			}, "\n"),
			Dist{
				Num:           2,
				TotalDuration: 64 * time.Millisecond,
				MaxDuration:   64 * time.Millisecond,
			},
			strings.Join([]string{
				csv.FileHeader,
				"Charging on,bool,1432964302318,1432964302382,true,",
				"Charging on,bool,1432964303382,1432964303382,true,",
			}, "\n"),
			nil,
		},
		{
			"Containing two negative transitions continuously",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,218,-ch`,
				`9,h,2021,-ch`,
			}, "\n"),
			Dist{
				Num:           1,
				TotalDuration: 218 * time.Millisecond,
				MaxDuration:   218 * time.Millisecond,
			},
			strings.Join([]string{
				csv.FileHeader,
				"Charging on,bool,1432964300076,1432964300294,true,",
			}, "\n"),
			[]error{fmt.Errorf(`** Error in 9,h,2021,-ch with -ch : two negative transitions for "Charging on":"-"`)},
		},
		{
			"Containing unknown transition",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,218,ch`,
			}, "\n"),
			Dist{
				Num:           0,
				TotalDuration: 0,
				MaxDuration:   0,
			},
			strings.Join([]string{
				csv.FileHeader,
			}, "\n"),
			[]error{fmt.Errorf(`** Error in 9,h,218,ch with ch : unknown transition for "Charging on":""`)},
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, len(test.wantErrors), 1)

		s := result.Summaries[0]
		if !reflect.DeepEqual(s.ChargingOnSummary, test.wantSummary) {
			t.Errorf("AnalyzeHistory(%s,...).Summaries[0].WifiSignalStrengthSummary = %v, want %v", test.input, s.ChargingOnSummary, test.wantSummary)
		}

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", test.desc, test.input, got, want)
		}
		if !reflect.DeepEqual(result.Errs, test.wantErrors) {
			t.Errorf("%v: AnalyzeHistory(%v) unexpected errors = %v, want: %v", test.desc, test.input, result.Errs, test.wantErrors)
		}
	}
}

// TestFlashlightOnParse tests the parsing of 'fl' entries in a history log.
func TestFlashlightOnParse(t *testing.T) {
	tests := []struct {
		desc        string
		input       string
		wantSummary Dist
		wantCSV     string
		wantErrors  []error
	}{
		{
			"Normal case for flashlight on",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,218,+fl`,
				`9,h,2021,-fl`,
				`9,h,2892,+fl`,
				`9,h,872,-fl`,
			}, "\n"),
			Dist{
				Num:           2,
				TotalDuration: 2893 * time.Millisecond,
				MaxDuration:   2021 * time.Millisecond,
			},
			strings.Join([]string{
				csv.FileHeader,
				"Flashlight on,bool,1432964300294,1432964302315,true,",
				"Flashlight on,bool,1432964305207,1432964306079,true,",
			}, "\n"),
			nil,
		},
		{
			"First entry is a negative transition",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,2021,-fl`,
				`9,h,2892,+fl`,
				`9,h,872,-fl`,
			}, "\n"),
			Dist{
				Num:           2,
				TotalDuration: 2893 * time.Millisecond,
				MaxDuration:   2021 * time.Millisecond,
			},
			strings.Join([]string{
				csv.FileHeader,
				"Flashlight on,bool,1432964300076,1432964302097,true,",
				"Flashlight on,bool,1432964304989,1432964305861,true,",
			}, "\n"),
			nil,
		},
		{
			"Positive transition before shutdown",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,218,+fl`,
				`9,h,2021,-fl`,
				`9,h,2892,+fl`,
			}, "\n"),
			Dist{
				Num:           2,
				TotalDuration: 2021 * time.Millisecond,
				MaxDuration:   2021 * time.Millisecond,
			},
			strings.Join([]string{
				csv.FileHeader,
				"Flashlight on,bool,1432964300294,1432964302315,true,",
				"Flashlight on,bool,1432964305207,1432964305207,true,",
			}, "\n"),
			nil,
		},
		{
			"Containing two negative transitions continuously",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,218,-fl`,
				`9,h,2021,-fl`,
			}, "\n"),
			Dist{
				Num:           1,
				TotalDuration: 218 * time.Millisecond,
				MaxDuration:   218 * time.Millisecond,
			},
			strings.Join([]string{
				csv.FileHeader,
				"Flashlight on,bool,1432964300076,1432964300294,true,",
			}, "\n"),
			[]error{fmt.Errorf(`** Error in 9,h,2021,-fl with -fl : two negative transitions for "Flashlight on":"-"`)},
		},
		{
			"Containing unknown transition",
			strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,218,fl`,
			}, "\n"),
			Dist{
				Num:           0,
				TotalDuration: 0,
				MaxDuration:   0,
			},
			strings.Join([]string{
				csv.FileHeader,
			}, "\n"),
			[]error{fmt.Errorf(`** Error in 9,h,218,fl with fl : unknown transition for "Flashlight on":""`)},
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, len(test.wantErrors), 1)

		s := result.Summaries[0]
		if !reflect.DeepEqual(s.FlashlightOnSummary, test.wantSummary) {
			t.Errorf("AnalyzeHistory(%s,...).Summaries[0].FlashlightOnSummary = %v, want %v", test.input, s.FlashlightOnSummary, test.wantSummary)
		}

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", test.desc, test.input, got, want)
		}
		if !reflect.DeepEqual(result.Errs, test.wantErrors) {
			t.Errorf("%v: AnalyzeHistory(%v) unexpected errors = %v, want: %v", test.desc, test.input, result.Errs, test.wantErrors)
		}
	}
}

// TestCameraEventParsing tests the parsing of 'ca' events in a history log.
func TestCameraEventParsing(t *testing.T) {
	tests := []struct {
		desc        string
		input       string
		wantSummary Dist
		wantCSV     string
		wantErrors  []error
	}{
		{
			desc: "Normal case for camera",
			input: strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300000`,
				`9,h,200,+ca`,
				`9,h,2000,-ca`,
				`9,h,3000,+ca`,
				`9,h,800,-ca`,
			}, "\n"),
			wantSummary: Dist{
				Num:           2,
				TotalDuration: 2800 * time.Millisecond,
				MaxDuration:   2000 * time.Millisecond,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				"Camera,bool,1432964300200,1432964302200,true,",
				"Camera,bool,1432964305200,1432964306000,true,",
			}, "\n"),
		},
		{
			desc: "First entry is a negative transition",
			input: strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300000`,
				`9,h,2000,-ca`,
			}, "\n"),
			wantSummary: Dist{
				Num:           1,
				TotalDuration: 2000 * time.Millisecond,
				MaxDuration:   2000 * time.Millisecond,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				"Camera,bool,1432964300000,1432964302000,true,",
			}, "\n"),
		},
		{
			desc: "Positive transition before end of report",
			input: strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300000`,
				`9,h,200,+ca`,
				`9,h,2000,-ca`,
				`9,h,3000,+ca`,
			}, "\n"),
			wantSummary: Dist{
				Num:           2,
				TotalDuration: 2000 * time.Millisecond,
				MaxDuration:   2000 * time.Millisecond,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				"Camera,bool,1432964300200,1432964302200,true,",
				"Camera,bool,1432964305200,1432964305200,true,",
			}, "\n"),
		},
		{
			desc: "Containing two consecutive negative transitions",
			input: strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300000`,
				`9,h,200,-ca`,
				`9,h,2000,-ca`,
			}, "\n"),
			wantSummary: Dist{
				Num:           1,
				TotalDuration: 200 * time.Millisecond,
				MaxDuration:   200 * time.Millisecond,
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				"Camera,bool,1432964300000,1432964300200,true,",
			}, "\n"),
			wantErrors: []error{fmt.Errorf(`** Error in 9,h,2000,-ca with -ca : two negative transitions for "Camera":"-"`)},
		},
		{
			desc: "Containing unknown transition",
			input: strings.Join([]string{
				`9,h,0:RESET:TIME:1432964300000`,
				`9,h,218,ca`,
			}, "\n"),
			wantCSV: strings.Join([]string{
				csv.FileHeader,
			}, "\n"),
			wantErrors: []error{fmt.Errorf(`** Error in 9,h,218,ca with ca : unknown transition for "Camera":""`)},
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, len(test.wantErrors), 1)

		if len(result.Summaries) == 1 {
			s := result.Summaries[0]
			if !reflect.DeepEqual(s.CameraOnSummary, test.wantSummary) {
				t.Errorf("AnalyzeHistory(%s,...).Summaries[0].Camera generated incorrect summary\n  got %v\n  want %v", test.input, s.CameraOnSummary, test.wantSummary)
			}

			got := normalizeCSV(b.String())
			want := normalizeCSV(test.wantCSV)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%v: AnalyzeHistory(%v) generated incorrect csv\n  got %q\n  want: %q", test.desc, test.input, got, want)
			}
			if !reflect.DeepEqual(result.Errs, test.wantErrors) {
				t.Errorf("%v: AnalyzeHistory(%v) generated unexpected errors\n got  %v\n  want: %v", test.desc, test.input, result.Errs, test.wantErrors)
			}
		}
	}
}

// TestPackageInstallParse tests the parsing of 'Epi' entries in a history log.
func TestPackageInstallParse(t *testing.T) {
	tests := []struct {
		desc       string
		input      string
		wantCSV    string
		wantErrors []error
	}{
		{
			"Test package install parse",
			strings.Join([]string{
				`9,hsp,3,28,"com.googlecode.eyesfree.brailleback"`,
				`9,hsp,4,239,"com.google.android.apps.interactiveevents"`,
				`9,hsp,6,10110061,"com.google.android.apps.chromecast.app"`,
				`9,hsp,7,81,"com.google.android.apps.blogger"`,
				`9,hsp,8,119,"com.google.android.apps.giant"`,
				`9,hsp,16,3900,"com.google.android.apps.vega"`,
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,16595,Epi=3`,
				`9,h,6059,Epi=4`,
				`9,h,22070,Epi=6`,
				`9,h,17391,Epi=7`,
				`9,h,9962,Epi=8`,
				`9,h,865,Epi=16`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Package install,service,1432964316671,1432964316671,com.googlecode.eyesfree.brailleback,28`,
				`Package install,service,1432964322730,1432964322730,com.google.android.apps.interactiveevents,239`,
				`Package install,service,1432964344800,1432964344800,com.google.android.apps.chromecast.app,10061`,
				`Package install,service,1432964362191,1432964362191,com.google.android.apps.blogger,81`,
				`Package install,service,1432964372153,1432964372153,com.google.android.apps.giant,119`,
				`Package install,service,1432964373018,1432964373018,com.google.android.apps.vega,3900`,
			}, "\n"),
			nil,
		},
		{
			"Unable to find index for package install",
			strings.Join([]string{
				`9,hsp,3,28,"com.googlecode.eyesfree.brailleback"`,
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,16595,Epi=3`,
				`9,h,22070,Epi=6`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Package install,service,1432964316671,1432964316671,com.googlecode.eyesfree.brailleback,28`,
			}, "\n"),
			[]error{errors.New(`** Error in 9,h,22070,Epi=6 with Epi=6 : unable to find index "6" in idxMap for "Package install"`)},
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, len(test.wantErrors), 1)

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) generated incorrect csv:\n  got: %q\n  want: %q", test.desc, test.input, got, want)
		}
		if !reflect.DeepEqual(result.Errs, test.wantErrors) {
			t.Errorf("%v: AnalyzeHistory(%v) gave unexpected errors:\n  got %v\n  want: %v", test.desc, test.input, result.Errs, test.wantErrors)
		}
	}
}

// TestPackageUninstallParse tests the parsing of 'Epu' entries in a history log.
func TestPackageUninstallParse(t *testing.T) {
	tests := []struct {
		desc       string
		input      string
		wantCSV    string
		wantErrors []error
	}{
		{
			"Test package uninstall parse",
			strings.Join([]string{
				`9,hsp,3,28,"com.googlecode.eyesfree.brailleback"`,
				`9,hsp,4,239,"com.google.android.apps.interactiveevents"`,
				`9,hsp,6,10110061,"com.google.android.apps.chromecast.app"`,
				`9,hsp,7,81,"com.google.android.apps.blogger"`,
				`9,hsp,8,119,"com.google.android.apps.giant"`,
				`9,hsp,16,3900,"com.google.android.apps.vega"`,
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,16595,Epu=3`,
				`9,h,6059,Epu=4`,
				`9,h,22070,Epu=6`,
				`9,h,17391,Epu=7`,
				`9,h,9962,Epu=8`,
				`9,h,865,Epu=16`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Package uninstall,service,1432964316671,1432964316671,com.googlecode.eyesfree.brailleback,28`,
				`Package uninstall,service,1432964322730,1432964322730,com.google.android.apps.interactiveevents,239`,
				`Package uninstall,service,1432964344800,1432964344800,com.google.android.apps.chromecast.app,10061`,
				`Package uninstall,service,1432964362191,1432964362191,com.google.android.apps.blogger,81`,
				`Package uninstall,service,1432964372153,1432964372153,com.google.android.apps.giant,119`,
				`Package uninstall,service,1432964373018,1432964373018,com.google.android.apps.vega,3900`,
			}, "\n"),
			nil,
		},
		{
			"Unable to find index for package uninstall",
			strings.Join([]string{
				`9,hsp,3,28,"com.googlecode.eyesfree.brailleback"`,
				`9,h,0:RESET:TIME:1432964300076`,
				`9,h,16595,Epu=3`,
				`9,h,22070,Epu=6`,
			}, "\n"),
			strings.Join([]string{
				csv.FileHeader,
				`Package uninstall,service,1432964316671,1432964316671,com.googlecode.eyesfree.brailleback,28`,
			}, "\n"),
			[]error{fmt.Errorf(`** Error in 9,h,22070,Epu=6 with Epu=6 : unable to find index "6" in idxMap for "Package uninstall"`)},
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, len(test.wantErrors), 1)

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) generated incorrect csv:\n  got: %q\n  want: %q", test.desc, test.input, got, want)
		}
		if !reflect.DeepEqual(result.Errs, test.wantErrors) {
			t.Errorf("%v: AnalyzeHistory(%v) gave unexpected errors:\n  got %v\n  want: %v", test.desc, test.input, result.Errs, test.wantErrors)
		}
	}
}

// TestScreenWakeReasonParsing tests the parsing of 'Esw' and '+/-S' entries in a history log.
func TestScreenWakeReasonParsing(t *testing.T) {
	tests := []struct {
		desc             string
		input            string
		wantNumSummaries int
		wantCSV          string
		wantErrs         []error
	}{
		{
			desc: `test single screen on and off events with Esw description`,
			input: strings.Join([]string{
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,500,+S,Esw=9`,
				`9,h,750,-S`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433550500,1437433551250,true,android.server.wm:TURN_ON`,
			}, "\n"),
		},
		{
			desc: `test successive screen on and off events with Esw description`,
			input: strings.Join([]string{
				`9,hsp,3,1000,"android.policy:POWER"`,
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,500,+S,Esw=9`,
				`9,h,750,-S`,
				`9,h,10000,+S,Esw=3`,
				`9,h,300,-S`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433550500,1437433551250,true,android.server.wm:TURN_ON`,
				`Screen,bool,1437433561250,1437433561550,true,android.policy:POWER`,
			}, "\n"),
		},
		{
			desc: `test screen on and off events with no Esw description`,
			input: strings.Join([]string{
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,500,+S`,
				`9,h,750,-S`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433550500,1437433551250,true,unknown screen on reason`,
			}, "\n"),
		},
		{
			desc: `test Esw on line following +S`,
			input: strings.Join([]string{
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,500,+S`,
				`9,h,50,Esw=9`,
				`9,h,750,-S`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433550500,1437433551300,true,android.server.wm:TURN_ON`,
			}, "\n"),
		},
		{
			desc: `test screen on from beginning of report (no Esw)`,
			input: strings.Join([]string{
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,750,-S`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433550000,1437433550750,true,unknown screen on reason`,
			}, "\n"),
		},
		{
			desc: `test screen on and Esw with no screen off log before shutdown`,
			input: strings.Join([]string{
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,500,+S,Esw=9`,
				`9,h,500:SHUTDOWN`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433550500,1437433551000,true,android.server.wm:TURN_ON`,
				`Reboot,bool,1437433551000,1437433551000,true,`,
			}, "\n"),
		},
		{
			desc: `test screen on reason doesn't get transferred to screen on after SHUTDOWN`,
			input: strings.Join([]string{
				`9,hsp,3,1000,"android.policy:POWER"`,
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,500,+S,Esw=9`,
				`9,h,500:SHUTDOWN`,
				`9,h,500:START`,
				`9,h,0:TIME:1437433551500`,
				`9,h,10000,+S,Esw=3`,
				`9,h,1000,-S`,
			}, "\n"),
			wantNumSummaries: 2,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433550500,1437433551000,true,android.server.wm:TURN_ON`,
				`Reboot,bool,1437433551000,1437433551500,true,`,
				`Screen,bool,1437433561500,1437433562500,true,android.policy:POWER`,
			}, "\n"),
		},
		{
			desc: `test screen on and no Esw with no screen off log before shutdown`,
			input: strings.Join([]string{
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,500,+S`,
				`9,h,500:SHUTDOWN`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433550500,1437433551000,true,unknown screen on reason`,
				`Reboot,bool,1437433551000,1437433551000,true,`,
			}, "\n"),
		},
		{
			desc: `test Esw event before screen on event`,
			input: strings.Join([]string{
				`9,hsp,3,1000,"android.policy:POWER"`,
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,998,Esw=3`,
				`9,h,2,+S`,
				`9,h,300,-S`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433551000,1437433551300,true,android.policy:POWER`,
			}, "\n"),
		},
		{
			desc: `test second Esw event between screen on and screen off`,
			input: strings.Join([]string{
				`9,hsp,3,1000,"android.policy:POWER"`,
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,10000,+S,Esw=3`,
				`9,h,1000,Esw=9`, // TODO: currently marking as error. Figure out what the correct policy should be.
				`9,h,300,-S`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433560000,1437433561300,true,android.policy:POWER`,
			}, "\n"),
			wantErrs: []error{errors.New(`** Error in 9,h,1000,Esw=9 with Esw=9 : encountered multiple Esw events between a single pair of +S/-S events`)},
		},
		{
			desc: `test multiple Esw events outside of screen on/off blocks`,
			input: strings.Join([]string{
				`9,hsp,3,1000,"android.policy:POWER"`,
				`9,hsp,9,1000,"android.server.wm:TURN_ON"`,
				`9,h,0:RESET:TIME:1437433550000`,
				`9,h,1000,+S`,
				`9,h,1000,-S`,
				`9,h,50,Esw=3`,
				`9,h,100,Esw=9`,
				`9,h,1000,+S`,
				`9,h,300,-S`,
			}, "\n"),
			wantNumSummaries: 1,
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Screen,bool,1437433551000,1437433552000,true,unknown screen on reason`,
				`Screen,bool,1437433553150,1437433553450,true,android.server.wm:TURN_ON`,
			}, "\n"),
			wantErrs: []error{errors.New(`** Error in 9,h,100,Esw=9 with Esw=9 : encountered multiple Esw events ("android.policy:POWER" and "android.server.wm:TURN_ON") outside of +S/-S events`)},
		},
	}

	for _, test := range tests {
		var b bytes.Buffer
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.input, t, result, len(test.wantErrs), test.wantNumSummaries)

		got := normalizeCSV(b.String())
		want := normalizeCSV(test.wantCSV)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s: AnalyzeHistory(%s) generated incorrect csv.\n  got: %q,\n  want: %q", test.desc, test.input, got, want)
		}
		if !reflect.DeepEqual(result.Errs, test.wantErrs) {
			t.Errorf("%s: AnalyzeHistory(%s) returned unexpected errors.\n  got %v,\n  want: %v", test.desc, test.input, result.Errs, test.wantErrs)
		}
	}
}

// TestDPSTDCPUParse tests the parsing of Dpst and Dcpu in a history log.
func TestDPSTDCPUParse(t *testing.T) {
	input := strings.Join([]string{
		`9,0,i,vers,11,116,LMY06B,LMY06B`,
		`9,h,0:RESET:TIME:1422620451417`,
		`9,h,0,Bl=100`,
		`9,h,1000,Bl=99`,
		`9,h,0,Dcpu=112830:66390/1000:32930:19830/0:9850:23180/10019:21720:5570`,
		`9,h,0,Dpst=176140,62360,14690,20,2920,242170`,
		`9,h,3000,Bl=98`,
		`9,h,0,Dcpu=27650:50140/1000:9865:28630/0:5070:15025/10010:357:3200`,
		`9,h,0,Dpst=29130,47690,4900,0,990,342030`,
		`9,h,5000,Bl=97`,
		`9,h,0,Dcpu=0:0`,
		`9,h,0,Dpst=0,0,0,0,0,0`,
		`9,h,1000,+S`,
	}, "\n")

	want := newActivitySummary(FormatTotalTime)
	want.DcpuStatsSummary = []DCPU{
		{
			BatteryLevel: 100,
			Start:        1422620451417,
			Duration:     1000 * time.Millisecond,
			UserTime:     112830 * time.Millisecond,
			SystemTime:   66390 * time.Millisecond,
			CPUUtilizers: []AppCPUUsage{
				{
					start:      1422620451417,
					pkgName:    "ANDROID_SYSTEM",
					UID:        "1000",
					UserTime:   32930 * time.Millisecond,
					SystemTime: 19830 * time.Millisecond,
				},
				{
					start:      1422620451417,
					pkgName:    "ROOT",
					UID:        "0",
					UserTime:   9850 * time.Millisecond,
					SystemTime: 23180 * time.Millisecond,
				},
				{
					start:      1422620451417,
					pkgName:    "com.google.android.keep",
					UID:        "10019",
					UserTime:   21720 * time.Millisecond,
					SystemTime: 5570 * time.Millisecond,
				},
			},
		},
		{
			BatteryLevel: 99,
			Start:        1422620452417,
			Duration:     3000 * time.Millisecond,
			UserTime:     27650 * time.Millisecond,
			SystemTime:   50140 * time.Millisecond,
			CPUUtilizers: []AppCPUUsage{
				{
					start:      1422620452417,
					pkgName:    "ANDROID_SYSTEM",
					UID:        "1000",
					UserTime:   9865 * time.Millisecond,
					SystemTime: 28630 * time.Millisecond,
				},
				{
					start:      1422620452417,
					pkgName:    "ROOT",
					UID:        "0",
					UserTime:   5070 * time.Millisecond,
					SystemTime: 15025 * time.Millisecond,
				},
				{
					start: 1422620452417,
					// No package name in mapping.
					UID:        "10010",
					UserTime:   357 * time.Millisecond,
					SystemTime: 3200 * time.Millisecond,
				},
			},
		},
		{
			BatteryLevel: 98,
			Start:        1422620455417,
			Duration:     5000 * time.Millisecond,
			UserTime:     0,
			SystemTime:   0,
			CPUUtilizers: nil,
		},
	}
	want.DcpuOverallSummary = map[string]time.Duration{
		"1000":  91255 * time.Millisecond,
		"0":     53125 * time.Millisecond,
		"10019": 27290 * time.Millisecond,
		"10010": 3557 * time.Millisecond,
	}
	want.DpstStatsSummary = []DPST{
		{
			BatteryLevel:    100,
			Start:           1422620451417,
			Duration:        1000 * time.Millisecond,
			StatUserTime:    176140 * time.Millisecond,
			StatSystemTime:  62360 * time.Millisecond,
			StatIOWaitTime:  14690 * time.Millisecond,
			StatIrqTime:     20 * time.Millisecond,
			StatSoftIrqTime: 2920 * time.Millisecond,
			StatIdlTime:     242170 * time.Millisecond,
		},
		{
			BatteryLevel:    99,
			Start:           1422620452417,
			Duration:        3000 * time.Millisecond,
			StatUserTime:    29130 * time.Millisecond,
			StatSystemTime:  47690 * time.Millisecond,
			StatIOWaitTime:  4900 * time.Millisecond,
			StatIrqTime:     0,
			StatSoftIrqTime: 990 * time.Millisecond,
			StatIdlTime:     342030 * time.Millisecond,
		},
		{
			BatteryLevel:    98,
			Start:           1422620455417,
			Duration:        5000 * time.Millisecond,
			StatUserTime:    0,
			StatSystemTime:  0,
			StatIOWaitTime:  0,
			StatIrqTime:     0,
			StatSoftIrqTime: 0,
			StatIdlTime:     0,
		},
	}
	want.DpstOverallSummary = map[string]time.Duration{
		"usr":  205270 * time.Millisecond,
		"sys":  110050 * time.Millisecond,
		"io":   19590 * time.Millisecond,
		"irq":  20 * time.Millisecond,
		"sirq": 3910 * time.Millisecond,
		"idle": 584200 * time.Millisecond,
	}
	pum := PackageUIDMapping{
		uidToPackage: map[int32]string{
			10019: "com.google.android.keep",
		},
		packageToUID: map[string]int32{
			"com.google.android.keep": 10019,
		},
		pkgList: []*usagepb.PackageInfo{
			{
				PkgName: proto.String("com.google.android.keep"),
				Uid:     proto.Int32(10019),
			},
		},
	}
	wantCSV := strings.Join([]string{
		csv.FileHeader,
		`Battery Level,int,1422620451417,1422620452417,100,`,
		`Battery Level,int,1422620452417,1422620455417,99,`,
		// 100->99 drop.
		`Highest App CPU Usage,summary,1422620451417,1422620452417,ANDROID_SYSTEM~32.93s~19.83s,1000`,
		`Highest App CPU Usage,summary,1422620451417,1422620452417,ROOT~9.85s~23.18s,0`,
		`Highest App CPU Usage,summary,1422620451417,1422620452417,com.google.android.keep~21.72s~5.57s,10019`,
		`Battery Level,int,1422620455417,1422620460417,98,`,
		// 99->98 drop.
		`Highest App CPU Usage,summary,1422620452417,1422620455417,ANDROID_SYSTEM~9.865s~28.63s,1000`,
		`Highest App CPU Usage,summary,1422620452417,1422620455417,ROOT~5.07s~15.025s,0`,
		`Highest App CPU Usage,summary,1422620452417,1422620455417,UID 10010~357ms~3.2s,10010`,
		`Battery Level,int,1422620460417,1422620461417,97,`,
		// None for the 98->97 drop.
		`Screen,bool,1422620461417,1422620461417,true,unknown screen on reason`,
	}, "\n")

	var b bytes.Buffer
	result := AnalyzeHistory(&b, input, FormatTotalTime, pum, true)
	validateHistory(input, t, result, 0, 1)
	s := result.Summaries[0]

	if !reflect.DeepEqual(want.DcpuStatsSummary, s.DcpuStatsSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].DcpuStatsSummary = %v, want %v", input, s.DcpuStatsSummary, want.DcpuStatsSummary)
	}
	if !reflect.DeepEqual(want.DpstStatsSummary, s.DpstStatsSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].DpstStatsSummary = %v, want %v", input, s.DpstStatsSummary, want.DpstStatsSummary)
	}
	if !reflect.DeepEqual(want.DpstOverallSummary, s.DpstOverallSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].DpstOverallSummary = %v, want %v", input, s.DpstOverallSummary, want.DpstOverallSummary)
	}
	if !reflect.DeepEqual(want.DcpuOverallSummary, s.DcpuOverallSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].DcpuOverallSummary = %v, want %v", input, s.DcpuOverallSummary, want.DcpuOverallSummary)
	}
	gCSV := normalizeCSV(b.String())
	wCSV := normalizeCSV(wantCSV)
	if !reflect.DeepEqual(gCSV, wCSV) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0] generated incorrect csv:\n  got: %v\n  want: %v", input, gCSV, wCSV)
	}
}

// TestParsePowerStates tests the parsing of power states lines.
func TestParsePowerStates(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantStates []*PowerState
		wantErr    error
	}{
		{
			name:  "state 1 with voters, state 2 without voters",
			input: `state_1 name=XO_shutdown time=0 count=0 voter_1 name=APSS time=4000 count=4 voter_2 name=MPSS time=5000 count=5 voter_3 name=LPASS time=6000 count=6  state_2 name=VMIN time=3500 count=10`,
			wantStates: []*PowerState{
				{
					Level: 1,
					Name:  `XO_shutdown`,
					Time:  0,
					Count: 0,
					Voters: []Voter{
						{
							Name:  `APSS`,
							Time:  4 * time.Second,
							Count: 4,
						},
						{
							Name:  `MPSS`,
							Time:  5 * time.Second,
							Count: 5,
						},
						{
							Name:  `LPASS`,
							Time:  6 * time.Second,
							Count: 6,
						},
					},
				},
				{
					Level: 2,
					Name:  `VMIN`,
					Time:  3500 * time.Millisecond,
					Count: 10,
				},
			},
		},
		{
			name:  "state 1 and 2 with voters",
			input: `state_1 name=XO_shutdown time=0 count=0 voter_1 name=APSS time=5000 count=6 voter_2 name=MPSS time=7000 count=8 voter_3 name=LPASS time=9000 count=10  state_2 name=VMIN time=9500 count=25 voter_1 name=V1 time=123 count=456 voter_2 name=V2 time=468 count=864`,
			wantStates: []*PowerState{
				{
					Level: 1,
					Name:  `XO_shutdown`,
					Time:  0,
					Count: 0,
					Voters: []Voter{
						{
							Name:  `APSS`,
							Time:  5 * time.Second,
							Count: 6,
						},
						{
							Name:  `MPSS`,
							Time:  7 * time.Second,
							Count: 8,
						},
						{
							Name:  `LPASS`,
							Time:  9 * time.Second,
							Count: 10,
						},
					},
				},
				{
					Level: 2,
					Name:  `VMIN`,
					Time:  9500 * time.Millisecond,
					Count: 25,
					Voters: []Voter{
						{
							Name:  `V1`,
							Time:  123 * time.Millisecond,
							Count: 456,
						},
						{
							Name:  `V2`,
							Time:  468 * time.Millisecond,
							Count: 864,
						},
					},
				},
			},
		},
		{
			name:    "invalid input",
			input:   `9,h,1000,-w`,
			wantErr: errors.New(`invalid power_state line: "9,h,1000,-w"`),
		},
	}

	for _, test := range tests {
		d := fmt.Sprintf("[%s] parsePowerStates(%s)", test.name, test.input)
		ps, err := parsePowerStates(test.input)
		if err != nil {
			if test.wantErr == nil {
				t.Errorf(`%s generated unexpected error "%v"`, d, err)
			} else if test.wantErr.Error() != err.Error() {
				t.Errorf(`%s generated unexpected error. Got "%v", want "%v"`, d, err, test.wantErr)
			}
			continue
		}
		if test.wantErr != nil {
			t.Errorf(`%s didn't generate expected error`, d)
			continue
		}
		if len(ps) != len(test.wantStates) {
			t.Errorf(`%s didn't parse correct number of states. Got %d states, want %d:\n  got %v\n  want %v`, d, len(ps), len(test.wantStates), ps, test.wantStates)
			continue
		}
		for i, p := range ps {
			pw := test.wantStates[i]
			if !reflect.DeepEqual(p, pw) {
				t.Errorf("%s parsed state #%d incorrect:\n  got %v\n  want %v", d, i, p, pw)
			}
		}
	}
}

// TestPowerStateParsing tests the parsing of low power state data.
func TestPowerStateParsing(t *testing.T) {
	zeroDuration := time.Duration(0).String()

	// Summary of states per activity summary
	type states struct {
		detailed []PowerState
		overall  map[string]PowerState
	}
	tests := []struct {
		name  string
		input string
		// A different slice of states for each expected summary.
		wantStatesTT []states
		wantStatesBL []states
		wantCSV      string
	}{
		{
			name: "single discharge",
			input: strings.Join([]string{
				`9,0,i,vers,17,144,NRD32,NRD41`,
				`9,h,0:RESET:TIME:1422620000000`,
				`9,h,0,Bl=100`,
				`9,h,60000,Bl=99`,
				`9,h,0,Dpst=262180,124520,4950,8110,6200,181080,state_1 name=XO_shutdown time=0 count=0 voter_1 name=APSS time=6000 count=50 voter_2 name=MPSS time=3000 count=100 voter_3 name=LPASS time=3000 count=150 state_2 name=VMIN time=1500 count=75`,
				`9,h,60000,Bl=98`,
				`9,h,0,Dpst=262180,124520,4950,8110,6200,181080,state_1 name=XO_shutdown time=0 count=0 voter_1 name=APSS time=12000 count=90 voter_2 name=MPSS time=6000 count=140 voter_3 name=LPASS time=4500 count=160 state_2 name=VMIN time=3000 count=95`,
				`9,h,60000,Bl=97`,
				`9,h,0,Dpst=262180,124520,4950,8110,6200,181080,state_1 name=XO_shutdown time=0 count=0 voter_1 name=APSS time=15000 count=100 voter_2 name=MPSS time=9000 count=200 voter_3 name=LPASS time=6000 count=200 state_2 name=VMIN time=6000 count=100`,
			}, "\n"),
			wantStatesTT: []states{
				{
					detailed: []PowerState{
						// There won't be a log for the 100->99 discharge since the log started at 100.
						{
							batteryLevel: 99, // 99->98 step
							start:        1422620060000,
							Level:        1,
							Name:         `XO_shutdown`,
							Time:         0,
							Count:        0,
							Voters: []Voter{
								{
									Name:  `APSS`,
									Time:  6000 * time.Millisecond,
									Count: 40,
								},
								{
									Name:  `LPASS`,
									Time:  1500 * time.Millisecond,
									Count: 10,
								},
								{
									Name:  `MPSS`,
									Time:  3000 * time.Millisecond,
									Count: 40,
								},
							},
						},
						{
							batteryLevel: 99, // 99->98 step
							start:        1422620060000,
							Level:        2,
							Name:         `VMIN`,
							Time:         1500 * time.Millisecond,
							Count:        20,
						},
						{
							batteryLevel: 98, // 98->97 step
							start:        1422620120000,
							Level:        1,
							Name:         `XO_shutdown`,
							Time:         0,
							Count:        0,
							Voters: []Voter{
								{
									Name:  `APSS`,
									Time:  3000 * time.Millisecond,
									Count: 10,
								},
								{
									Name:  `LPASS`,
									Time:  1500 * time.Millisecond,
									Count: 40,
								},
								{
									Name:  `MPSS`,
									Time:  3000 * time.Millisecond,
									Count: 60,
								},
							},
						},
						{
							batteryLevel: 98, // 98->97 step
							start:        1422620120000,
							Level:        2,
							Name:         `VMIN`,
							Time:         3000 * time.Millisecond,
							Count:        5,
						},
					},
					overall: map[string]PowerState{
						`XO_shutdown`: {
							Level: 1,
							Name:  `XO_shutdown`,
							Time:  0,
							Count: 0,
							Voters: []Voter{
								{
									Name:  `APSS`,
									Time:  9000 * time.Millisecond,
									Count: 50,
								},
								{
									Name:  `LPASS`,
									Time:  3000 * time.Millisecond,
									Count: 50,
								},
								{
									Name:  `MPSS`,
									Time:  6000 * time.Millisecond,
									Count: 100,
								},
							},
						},
						`VMIN`: {
							Level: 2,
							Name:  `VMIN`,
							Time:  4500 * time.Millisecond,
							Count: 25,
						},
					},
				},
			},
			wantStatesBL: []states{
				{
					// There won't be any power states saved for the 100->99 discharge since the log started at 100.
					detailed: []PowerState{},
				},
				{
					detailed: []PowerState{
						{
							batteryLevel: 99, // 99->98 step
							start:        1422620060000,
							Level:        1,
							Name:         `XO_shutdown`,
							Time:         0,
							Count:        0,
							Voters: []Voter{
								{
									Name:  `APSS`,
									Time:  6000 * time.Millisecond,
									Count: 40,
								},
								{
									Name:  `LPASS`,
									Time:  1500 * time.Millisecond,
									Count: 10,
								},
								{
									Name:  `MPSS`,
									Time:  3000 * time.Millisecond,
									Count: 40,
								},
							},
						},
						{
							batteryLevel: 99, // 99->98 step
							start:        1422620060000,
							Level:        2,
							Name:         `VMIN`,
							Time:         1500 * time.Millisecond,
							Count:        20,
						},
					},
					overall: map[string]PowerState{
						`XO_shutdown`: {
							batteryLevel: 99, // 99->98 step
							start:        1422620060000,
							Level:        1,
							Name:         `XO_shutdown`,
							Time:         0,
							Count:        0,
							Voters: []Voter{
								{
									Name:  `APSS`,
									Time:  6000 * time.Millisecond,
									Count: 40,
								},
								{
									Name:  `LPASS`,
									Time:  1500 * time.Millisecond,
									Count: 10,
								},
								{
									Name:  `MPSS`,
									Time:  3000 * time.Millisecond,
									Count: 40,
								},
							},
						},
						`VMIN`: {
							batteryLevel: 99, // 99->98 step
							start:        1422620060000,
							Level:        2,
							Name:         `VMIN`,
							Time:         1500 * time.Millisecond,
							Count:        20,
						},
					},
				},
				{
					detailed: []PowerState{
						{
							batteryLevel: 98, // 98->97 step
							start:        1422620120000,
							Level:        1,
							Name:         `XO_shutdown`,
							Time:         0,
							Count:        0,
							Voters: []Voter{
								{
									Name:  `APSS`,
									Time:  3000 * time.Millisecond,
									Count: 10,
								},
								{
									Name:  `LPASS`,
									Time:  1500 * time.Millisecond,
									Count: 40,
								},
								{
									Name:  `MPSS`,
									Time:  3000 * time.Millisecond,
									Count: 60,
								},
							},
						},
						{
							batteryLevel: 98, // 98->97 step
							start:        1422620120000,
							Level:        2,
							Name:         `VMIN`,
							Time:         3000 * time.Millisecond,
							Count:        5,
						},
					},
					overall: map[string]PowerState{
						`XO_shutdown`: {
							batteryLevel: 98, // 98->97 step
							start:        1422620120000,
							Level:        1,
							Name:         `XO_shutdown`,
							Time:         0,
							Count:        0,
							Voters: []Voter{
								{
									Name:  `APSS`,
									Time:  3000 * time.Millisecond,
									Count: 10,
								},
								{
									Name:  `LPASS`,
									Time:  1500 * time.Millisecond,
									Count: 40,
								},
								{
									Name:  `MPSS`,
									Time:  3000 * time.Millisecond,
									Count: 60,
								},
							},
						},
						`VMIN`: {
							batteryLevel: 98, // 98->97 step
							start:        1422620120000,
							Level:        2,
							Name:         `VMIN`,
							Time:         3000 * time.Millisecond,
							Count:        5,
						},
					},
				},
			},
			wantCSV: strings.Join([]string{
				csv.FileHeader,
				`Battery Level,int,1422620000000,1422620060000,100,`,
				`Battery Level,int,1422620060000,1422620120000,99,`,
				// Make these instantaneous at the time that they increased.
				// t0 = when battery changed to 99% (1422620060000) since that was when the first RPM stats line was printed. We zero at t0.
				// t1 = the second RPM stats line (1422620120000) -- the first increase.
				`Low Power State,summary,1422620120000,1422620120000,XO_shutdown~` + zeroDuration + `~0,`,
				`Low Power State,summary,1422620120000,1422620120000,VMIN~1.5s~20,`,
				`Battery Level,int,1422620120000,1422620180000,98,`,
				`Low Power State,summary,1422620180000,1422620180000,XO_shutdown~` + zeroDuration + `~0,`,
				`Low Power State,summary,1422620180000,1422620180000,VMIN~3s~5,`,
				`VMIN,float,1422620120000,1422620120000,0.025,`,
				`XO_shutdown,float,1422620120000,1422620120000,0.000,`,
				`XO_shutdown(APSS),float,1422620120000,1422620120000,0.100,`,
				`XO_shutdown(LPASS),float,1422620120000,1422620120000,0.025,`,
				`XO_shutdown(MPSS),float,1422620120000,1422620120000,0.050,`,
				`Battery Level,int,1422620180000,1422620180000,97,`,
				`VMIN,float,1422620180000,1422620180000,0.075,`,
				`XO_shutdown,float,1422620180000,1422620180000,0.000,`,
				`XO_shutdown(APSS),float,1422620180000,1422620180000,0.150,`,
				`XO_shutdown(LPASS),float,1422620180000,1422620180000,0.050,`,
				`XO_shutdown(MPSS),float,1422620180000,1422620180000,0.100,`,
				`RPM Stats,group,1422620000000,1422620000000,XO_shutdown|XO_shutdown(APSS)|XO_shutdown(MPSS)|XO_shutdown(LPASS)|VMIN,minutes`,
			}, "\n"),
		},
		// TODO: add test for two discharge sessions
		// TODO: add test for reboot case
	}

	var b bytes.Buffer
	for _, test := range tests {
		// FormatTotalTime
		result := AnalyzeHistory(&b, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		validateHistory(test.name, t, result, 0, len(test.wantStatesTT))
		if len(result.Summaries) != len(test.wantStatesTT) {
			t.Errorf("%s got incorrect number of total summaries. Got %d, want %d", test.name, len(result.Summaries), len(test.wantStatesTT))
		} else {
			for i, want := range test.wantStatesTT {
				gotD := result.Summaries[i].PowerStateSummary
				if !reflect.DeepEqual(gotD, want.detailed) {
					t.Errorf("%s[total] got incorrect detailed states for summary #%d.\n  Got %v\n  Want %v", test.name, i, gotD, want.detailed)
				}
				gotO := result.Summaries[i].PowerStateOverallSummary
				if !reflect.DeepEqual(gotO, want.overall) {
					t.Errorf("%s[total] got incorrect overall states for summary #%d.\n  Got %v\n  Want %v", test.name, i, gotO, want.overall)
				}
			}
			gotCSV := normalizeCSV(b.String())
			wantCSV := normalizeCSV(test.wantCSV)
			if !reflect.DeepEqual(gotCSV, wantCSV) {
				t.Errorf("%s[total] generated incorrect csv:\n  Got: %q\n  Want: %q", test.name, gotCSV, wantCSV)
			}
		}

		// FormatBatteryLevel
		result = AnalyzeHistory(ioutil.Discard, test.input, FormatBatteryLevel, emptyUIDPackageMapping, true)
		validateHistory(test.name, t, result, 0, len(test.wantStatesBL))
		if len(result.Summaries) != len(test.wantStatesBL) {
			t.Errorf("%s got incorrect number of battery level summaries. Got %d, want %d", test.name, len(result.Summaries), len(test.wantStatesBL))
		} else {
			for i, want := range test.wantStatesBL {
				gotD := result.Summaries[i].PowerStateSummary
				if len(gotD) == 0 && len(want.detailed) == 0 {
					// The initial level will be in this case.
					continue
				}
				if !reflect.DeepEqual(gotD, want.detailed) {
					t.Errorf("%s[level] got detailed incorrect states for summary #%d.\n  Got %v\n  Want %v", test.name, i, gotD, want.detailed)
				}
				gotO := result.Summaries[i].PowerStateOverallSummary
				if !reflect.DeepEqual(gotO, want.overall) {
					t.Errorf("%s[level] got incorrect overall states for summary #%d.\n  Got %v\n  Want %v", test.name, i, gotO, want.overall)
				}
			}
		}
	}
}

// TestBatteryLevelSummariesToCSV tests the level summary CSV generation.
func TestBatteryLevelSummariesToCSV(t *testing.T) {
	input := []ActivitySummary{
		{
			Reason:              "LEVEL",
			StartTimeMs:         1422997326657,
			EndTimeMs:           1422997348702,
			InitialBatteryLevel: 100,
			FinalBatteryLevel:   99,

			PluggedInSummary:     Dist{1, 2000000, 0},
			ScreenOnSummary:      Dist{3, 4000000, 0},
			MobileRadioOnSummary: Dist{5, 6000000, 0},
			WifiOnSummary:        Dist{7, 8000000, 0},
			CPURunningSummary:    Dist{9, 10000000, 0},

			GpsOnSummary:           Dist{11, 12000000, 0},
			SensorOnSummary:        Dist{13, 14000000, 0},
			WifiScanSummary:        Dist{15, 16000000, 0},
			WifiFullLockSummary:    Dist{17, 18000000, 0},
			WifiRadioSummary:       Dist{19, 20000000, 0},
			WifiRunningSummary:     Dist{21, 22000000, 0},
			WifiMulticastOnSummary: Dist{23, 24000000, 0},

			AudioOnSummary:        Dist{25, 26000000, 0},
			CameraOnSummary:       Dist{27, 28000000, 0},
			VideoOnSummary:        Dist{29, 30000000, 0},
			LowPowerModeOnSummary: Dist{31, 32000000, 0},
			FlashlightOnSummary:   Dist{33, 34000000, 0},
			ChargingOnSummary:     Dist{35, 36000000, 0},

			PhoneCallSummary: Dist{37, 38000000, 0},
			PhoneScanSummary: Dist{39, 40000000, 0},
			BLEScanSummary:   Dist{41, 42000000, 0},

			TotalSyncSummary: Dist{43, 44000000, 0},
		},
	}

	expectedDimensionLine := strings.Join([]string{
		"StartTime",
		"EndTime",
		"Duration",
		"Reason",
		"InitialBatteryLevel",
		"FinalBatteryLevel",
		"LevelDropPerHour",
		"PluggedIn.num",
		"PluggedIn.dur",
		"ScreenOn.num",
		"ScreenOn.dur",
		"MobileRadioOn.num",
		"MobileRadioOn.dur",
		"WifiOn.num",
		"WifiOn.dur",
		"CPURunning.num",
		"CPURunning.dur",
		"GpsOn.num",
		"GpsOn.dur",
		"SensorOn.num",
		"SensorOn.dur",
		"WifiScan.num",
		"WifiScan.dur",
		"WifiFullLock.num",
		"WifiFullLock.dur",
		"WifiRadio.num",
		"WifiRadio.dur",
		"WifiRunning.num",
		"WifiRunning.dur",
		"WifiMulticastOn.num",
		"WifiMulticastOn.dur",
		"AudioOn.num",
		"AudioOn.dur",
		"CameraOn.num",
		"CameraOn.dur",
		"VideoOn.num",
		"VideoOn.dur",
		"LowPowerModeOn.num",
		"LowPowerModeOn.dur",
		"FlashlightOn.num",
		"FlashlightOn.dur",
		"ChargingOn.num",
		"ChargingOn.dur",
		"PhoneCall.num",
		"PhoneCall.dur",
		"PhoneScan.num",
		"PhoneScan.dur",
		"BLEScan.num",
		"BLEScan.dur",
		"TotalSync.num",
		"TotalSync.dur",
	}, ",") + "\n"
	expectedValueLine := strings.Join([]string{
		"1422997326657",
		"1422997348702",
		"22045",
		"LEVEL",
		"100",
		"99",
		"163.302336",
		"1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44",
	}, ",") + "\n"

	var buf bytes.Buffer
	BatteryLevelSummariesToCSV(&buf, &input, true)

	if buf.String() != expectedDimensionLine+expectedValueLine {
		t.Errorf("BatteryLevelSummariesToCSV (printDimensions=true) received %v, expected %v", buf.String(), expectedDimensionLine+expectedValueLine)
	}

	buf.Reset()
	BatteryLevelSummariesToCSV(&buf, &input, false)
	if buf.String() != expectedValueLine {
		t.Errorf("BatteryLevelSummariesToCSV (printDimensions=false) received %v, expected %v", buf.String(), expectedValueLine)
	}
}

// TestReportVersionParsing tests that the report version is parsed correctly.
func TestReportVersionParsing(t *testing.T) {
	tests := []struct {
		input       string
		wantVersion int32
	}{
		{
			input:       `9,0,i,vers,11,116,LMY06B,LMY06B`,
			wantVersion: 11,
		},
		{
			input:       `9,0,i,vers,14,130,MDA37B,MDA41B`,
			wantVersion: 14,
		},
	}

	for _, test := range tests {
		result := AnalyzeHistory(ioutil.Discard, test.input, FormatTotalTime, emptyUIDPackageMapping, true)
		if len(result.Errs) > 0 {
			t.Errorf("analyzeHistory(%s) generated unexpected errors:\n  %v", test.input, result.Errs)
		}
		if result.ReportVersion != test.wantVersion {
			t.Errorf("analyzeHistory(%s) didn't parse the correct report version:\n  got %d\n  want %d", test.input, result.ReportVersion, test.wantVersion)
		}
	}
}

// TestMultipleResetsParse tests that reports with multiple RESET lines are parsed correctly.
func TestMultipleResetsParse(t *testing.T) {
	input := strings.Join([]string{
		`9,0,i,vers,11,116,LMY06B,LMY06B`,
		`9,h,0:RESET:TIME:1422620444417`, // fixTimeline will change this to 1422620441417.
		`9,h,2000,+S`,
		`9,h,7000,-S`,
		`9,h,0:RESET:TIME:1422620450417`,
		`9,h,1000,+S`,
		`9,h,100,-S`,
	}, "\n")

	want := []*ActivitySummary{
		newActivitySummary(FormatTotalTime),
		newActivitySummary(FormatTotalTime),
	}
	want[0].StartTimeMs = 1422620441417
	want[0].EndTimeMs = 1422620450417
	want[0].ScreenOnSummary = Dist{
		Num:           1,
		TotalDuration: 7000 * time.Millisecond,
		MaxDuration:   7000 * time.Millisecond,
	}
	want[1].StartTimeMs = 1422620450417
	want[1].EndTimeMs = 1422620451517
	want[1].ScreenOnSummary = Dist{
		Num:           1,
		TotalDuration: 100 * time.Millisecond,
		MaxDuration:   100 * time.Millisecond,
	}
	result := AnalyzeHistory(ioutil.Discard, input, FormatTotalTime, emptyUIDPackageMapping, true)
	if len(result.Errs) > 0 {
		t.Errorf("AnalyzeHistory(%s,...).Errs:\n %v\n want nil", input, result.Errs)
	}
	if len(result.Summaries) != 2 {
		t.Fatalf("AnalyzeHistory(%s,...).Summaries len = %d, want %d", input, len(result.Summaries), 2)
	}
	for i, s := range result.Summaries {
		if want[i].StartTimeMs != s.StartTimeMs {
			t.Errorf("AnalyzeHistory(%s,...).Summaries[%v].StartTimeMs = %d, want %d", input, i, s.StartTimeMs, want[i].StartTimeMs)
		}
		if want[i].EndTimeMs != s.EndTimeMs {
			t.Errorf("AnalyzeHistory(%s,...).Summaries[%v].EndTimeMs = %d, want %d", input, i, s.EndTimeMs, want[i].EndTimeMs)
		}
		if !reflect.DeepEqual(want[i].ScreenOnSummary, s.ScreenOnSummary) {
			t.Errorf("AnalyzeHistory(%s,...).Summaries[%v].ScreenOnSummary:\n %v\n want %v", input, i, s.ScreenOnSummary, want[i].ScreenOnSummary)
		}
	}
}

// TestPackageUIDMapping tests mapping of packages and matching with ServiceUIDs.
func TestPackageUIDMapping(t *testing.T) {
	upm := PackageUIDMapping{
		uidToPackage: map[int32]string{
			1001:    "com.android.phone;com.android.stk",
			10003:   "com.android.providers.contacts;com.android.contacts",
			10005:   "com.android.providers.calendar",
			10014:   "com.google.android.gms;com.google.android.gsf",
			10023:   "com.google.android.youtube",
			10036:   "com.google.android.apps.photos",
			10049:   "com.random.app.one;com.random.app.two;com.random.app.three",
			10056:   "com.some.other.app",
			1010005: "com.android.providers.calendar",
			1010036: "com.google.android.apps.photos",
		},
		packageToUID: map[string]int32{
			"com.android.phone":              1001,
			"com.android.stk":                1001,
			"com.android.contacts":           10003,
			"com.android.providers.contacts": 10003,
			"com.android.providers.calendar": 10005,
			"com.google.android.gms":         10014,
			"com.google.android.gsf":         10014,
			"com.google.android.youtube":     10023,
			"com.google.android.apps.photos": 10036,
			"com.random.app.free":            10049,
			"com.random.app.paid":            10049,
			"com.random.app.pro":             10049,
			"com.some.other.app":             10056,
		},
		sharedUIDName: map[int32]string{
			10014: "GOOGLE_SERVICES",
			10049: "SharedUserID(com.random.uid.shared)",
		},
		pkgList: []*usagepb.PackageInfo{
			{
				// Package with shared UID. Predefined group name.
				PkgName:      proto.String("com.google.android.gms"),
				Uid:          proto.Int32(10014),
				SharedUserId: proto.String("com.google.uid.shared"),
			},
			{
				// Package with shared UID. Predefined group name.
				PkgName:      proto.String("com.google.android.gsf"),
				Uid:          proto.Int32(10014),
				SharedUserId: proto.String("com.google.uid.shared"),
			},
			{
				// Package with shared UID. No predefined group name.
				PkgName:      proto.String("com.random.app.free"),
				Uid:          proto.Int32(10049),
				SharedUserId: proto.String("com.random.uid.shared"),
			},
			{
				// Package with shared UID. No predefined group name.
				PkgName:      proto.String("com.random.app.paid"),
				Uid:          proto.Int32(10049),
				SharedUserId: proto.String("com.random.uid.shared"),
			},
			{
				// Package with shared UID. No predefined group name.
				PkgName:      proto.String("com.random.app.pro"),
				Uid:          proto.Int32(10049),
				SharedUserId: proto.String("com.random.uid.shared"),
			},
			{
				// Package with shared UID. SharedUserId not in log.
				PkgName: proto.String("com.android.providers.contacts"),
				Uid:     proto.Int32(10003),
			},
			{
				// Package with shared UID. SharedUserId not in log.
				PkgName: proto.String("com.android.contacts"),
				Uid:     proto.Int32(10003),
			},
			{
				PkgName: proto.String("com.some.other.app"),
				Uid:     proto.Int32(10056),
			},
			{
				PkgName: proto.String("com.google.android.youtube"),
				Uid:     proto.Int32(10123),
			},
			{
				PkgName: proto.String("com.google.android.apps.photos"),
				Uid:     proto.Int32(10456),
			},
			{
				PkgName: proto.String("com.google.android.keep"),
				Uid:     proto.Int32(10189),
			},
		},
	}

	tests := []struct {
		desc    string
		input   *ServiceUID
		wantPkg *usagepb.PackageInfo
	}{
		{
			desc: "Match keep with both service string and uid",
			input: &ServiceUID{
				Service: `"com.google.android.keep/com.google/XXX@gmail.com"`,
				UID:     "10189",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("com.google.android.keep"),
				Uid:     proto.Int32(10189),
			},
		},
		{
			desc: "Match keep with service string only",
			input: &ServiceUID{
				Service: `"com.google.android.keep/com.google/XXX@gmail.com"`,
				UID:     "0",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("com.google.android.keep"),
				Uid:     proto.Int32(10189),
			},
		},
		{
			desc: "Hard-coded UID",
			input: &ServiceUID{
				Service: `"AudioIn"`,
				UID:     "1013",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("MEDIA"),
				Uid:     proto.Int32(1013),
			},
		},
		{
			desc: "Predefined UID group, match through UID",
			input: &ServiceUID{
				Service: `"com.google.android.gsf.subscribedfeeds.GCMIntentService"`,
				UID:     "10014",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("GOOGLE_SERVICES"),
				Uid:     proto.Int32(10014),
			},
		},
		{
			desc: "Predefined UID group, match through service string",
			input: &ServiceUID{
				Service: `"com.google.android.gms/.gcm.nts.TaskExecutionService"`,
				UID:     "",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("GOOGLE_SERVICES"),
				Uid:     proto.Int32(10014),
			},
		},
		{
			desc: "Predefined UID group, match through UID and service group, secondary UID",
			input: &ServiceUID{
				Service: `"com.google.android.gms.people/com.google/XXX@google.com"`,
				UID:     "1110014",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("GOOGLE_SERVICES"),
				Uid:     proto.Int32(10014),
			},
		},
		{
			desc: "No match anywhere",
			input: &ServiceUID{
				Service: `"com.google.android.talk"`,
				UID:     "12345",
			},
			wantPkg: nil, // Nothing should be matched with this.
		},
		{
			desc: "Match with unknown shared uid group",
			input: &ServiceUID{
				Service: `"com.random.app/servicial_stuff"`,
				UID:     "10049",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("SharedUserID(com.random.uid.shared)"),
				Uid:     proto.Int32(10049),
			},
		},
		{
			desc: "Match with uid, service string almost match",
			input: &ServiceUID{
				Service: `"com.some.other/servicial_stuff"`,
				UID:     "10056",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("com.some.other.app"),
				Uid:     proto.Int32(10056),
			},
		},
		{
			desc: "Match with known shared uid group even though missing SharedUserId field",
			input: &ServiceUID{
				Service: `"com.android.contacts/com.google/trevorbunker@gmail.com"`,
				UID:     "10003",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("CONTACTS_PROVIDER"),
				Uid:     proto.Int32(10003),
			},
		},
	}

	for _, test := range tests {
		if err := upm.matchServiceWithPackageInfo(test.input); err != nil {
			t.Errorf("Error encountered when matching %q: %v", test.desc, err)
			continue
		}
		if !reflect.DeepEqual(test.wantPkg, test.input.Pkg) {
			t.Errorf("%q didn't get expected package:\n  got: %v\n  want: %v", test.desc, test.input.Pkg, test.wantPkg)
		}
	}
}

// TestUIDAndPackageNameMappingAndMatching tests that mapping of UIDs to package names and matching with service strings works properly.
// This is an end-to-end test.
func TestUIDAndPackageNameMappingAndMatching(t *testing.T) {
	inputCheckin := strings.Join([]string{
		// Random lines that should be skipped.
		"9,0,l,pr,system,0,3150,0,0,0,0",
		"9,1000,l,wl,SyncManagerHandleSyncAlarm,0,f,0,1568,p,80,0,w,0",
		"9,0,l,sst,0",
		// Actual sync lines to be parsed.
		"9,10005,l,apk,1,com.android.providers.calendar,com.android.providers.calendar.CalendarProviderIntentService,160,1,1",
		// Shared UID
		"9,1001,l,apk,9,com.android.phone,com.android.phone.TelephonyDebugService,8630050,1,1",
		"9,1001,l,apk,0,com.android.stk,com.android.stk.StkAppService,8630050,1,1",
		// Removing legacy '9' to ensure parsing still works.
		"10014,l,apk,225,com.google.android.gms,com.google.android.gms.auth.GetToken,0,0,137",
		// Data will also be in the package list.
		"9,10123,l,apk,25,com.google.android.youtube,com.google.android.youtube.ViralVideo,0,0,137",
		"9,10456,l,apk,5,com.google.android.apps.photos,com.google.android.apps.photos.AwesomePhoto,0,0,137",
		// Secondary user.
		"9,1010005,l,apk,5,com.android.providers.calendar,com.android.providers.calendar.CalendarProviderIntentService,160,1,1",
		// Secondary user app with no corresponding primary user app.
		"9,1010789,l,apk,1,com.google.android.play.games,com.google.android.play.games.SuperCoolGame,160,1,1",
		// Secondary user with data in package list.
		"9,1010456,l,apk,15,com.google.android.apps.photos,com.google.android.apps.photos.AwesomePhoto,0,0,137",
	}, "\n")
	inputList := []*usagepb.PackageInfo{
		{
			// Package not found in checkin.
			PkgName: proto.String("com.google.android.videos"),
			Uid:     proto.Int32(10007),
		},
		{
			// Package with shared UID. Predefined group name.
			PkgName:      proto.String("com.google.android.gms"),
			Uid:          proto.Int32(10014),
			SharedUserId: proto.String("com.google.uid.shared"),
		},
		{
			// Package with shared UID. Predefined group name.
			PkgName:      proto.String("com.google.android.gsf"),
			Uid:          proto.Int32(10014),
			SharedUserId: proto.String("com.google.uid.shared"),
		},
		{
			// Package same as data found in checkin.
			PkgName: proto.String("com.google.android.youtube"),
			Uid:     proto.Int32(10123),
		},
		{
			// Package same as data found in checkin, with secondary user.
			PkgName: proto.String("com.google.android.apps.photos"),
			Uid:     proto.Int32(10456),
		},
		// Shared UIDs that aren't predefined
		{
			// Package with shared UID. No predefined group name.
			PkgName:      proto.String("com.random.app.free"),
			Uid:          proto.Int32(10049),
			SharedUserId: proto.String("com.random.uid.shared"),
		},
		{
			// Package with shared UID. No predefined group name.
			PkgName:      proto.String("com.random.app.paid"),
			Uid:          proto.Int32(10049),
			SharedUserId: proto.String("com.random.uid.shared"),
		},
		{
			// Package with shared UID. No predefined group name.
			PkgName:      proto.String("com.random.app.pro"),
			Uid:          proto.Int32(10049),
			SharedUserId: proto.String("com.random.uid.shared"),
		},
		{
			// Package with shared UID. SharedUserId not in log.
			PkgName: proto.String("com.android.providers.contacts"),
			Uid:     proto.Int32(10036),
		},
		{
			// Package with shared UID. SharedUserId not in log.
			PkgName: proto.String("com.android.contacts"),
			Uid:     proto.Int32(10036),
		},
		{
			PkgName: proto.String("com.google.android.keep"),
			Uid:     proto.Int32(10189),
		},
	}

	upm, errs := UIDAndPackageNameMapping(inputCheckin, inputList)
	if len(errs) > 0 {
		t.Fatalf("Encountered errors: %v", errs)
	}
	tests := []struct {
		desc    string
		input   *ServiceUID
		wantPkg *usagepb.PackageInfo
	}{
		{
			desc: "Match keep with both service string and uid",
			input: &ServiceUID{
				Service: `"com.google.android.keep/com.google/XXX@gmail.com"`,
				UID:     "10189",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("com.google.android.keep"),
				Uid:     proto.Int32(10189),
			},
		},
		{
			desc: "Match keep with service string only",
			input: &ServiceUID{
				Service: `"com.google.android.keep/com.google/XXX@gmail.com"`,
				UID:     "0",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("com.google.android.keep"),
				Uid:     proto.Int32(10189),
			},
		},
		{
			desc: "Hard-coded UID",
			input: &ServiceUID{
				Service: `"AudioIn"`,
				UID:     "1013",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("MEDIA"),
				Uid:     proto.Int32(1013),
			},
		},
		{
			desc: "Predefined UID group, match through UID",
			input: &ServiceUID{
				Service: `"com.google.android.gsf.subscribedfeeds.GCMIntentService"`,
				UID:     "10014",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("GOOGLE_SERVICES"),
				Uid:     proto.Int32(10014),
			},
		},
		{
			desc: "Predefined UID group, match through service string",
			input: &ServiceUID{
				Service: `"com.google.android.gms/.gcm.nts.TaskExecutionService"`,
				UID:     "",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("GOOGLE_SERVICES"),
				Uid:     proto.Int32(10014),
			},
		},
		{
			desc: "Predefined UID group, match through UID and service group, secondary UID",
			input: &ServiceUID{
				Service: `"com.google.android.gms.people/com.google/XXX@google.com"`,
				UID:     "1110014",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("GOOGLE_SERVICES"),
				Uid:     proto.Int32(10014),
			},
		},
		{
			desc: "No match anywhere",
			input: &ServiceUID{
				Service: `"com.google.android.talk"`,
				UID:     "12345",
			},
			wantPkg: nil, // Nothing should be matched with this.
		},
		{
			desc: "Match with unknown shared uid group",
			input: &ServiceUID{
				Service: `"com.random.app/servicial_stuff"`,
				UID:     "10049",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("SharedUserID(com.random.uid.shared)"),
				Uid:     proto.Int32(10049),
			},
		},
		{
			desc: "Match with known shared uid group even though missing SharedUserId field",
			input: &ServiceUID{
				Service: `"com.android.contacts/com.google/trevorbunker@gmail.com"`,
				UID:     "10036",
			},
			wantPkg: &usagepb.PackageInfo{
				PkgName: proto.String("CONTACTS_PROVIDER"),
				Uid:     proto.Int32(10036),
			},
		},
	}

	for _, test := range tests {
		if err := upm.matchServiceWithPackageInfo(test.input); err != nil {
			t.Errorf("Error encountered when matching %q: %v", test.desc, err)
			continue
		}
		if !reflect.DeepEqual(test.wantPkg, test.input.Pkg) {
			t.Errorf("%q didn't get expected package:\n  got: %v\n  want: %v", test.desc, test.input.Pkg, test.wantPkg)
		}
	}
}

func TestTopAppSummary(t *testing.T) {
	input := strings.Join([]string{
		`9,hsp,0,10031,"com.google.android.googlequicksearchbox"`,
		`9,hsp,4,10066,"com.google.android.apps.messaging"`,
		`9,hsp,19,10038,"com.android.calendar/com.google/noogler@google.com"`,
		`9,h,0:RESET:TIME:1456809000000`,
		`9,h,0,+S,Etp=0`,  // Turn screen on, top app = search
		`9,h,3000,-Etp=0`, // Remove search from the top.
		`9,h,0,+Etp=4`,    // Put messaging on top (1).
		`9,h,5000,-S`,     // Turn screen off.
		`9,h,7000,-Etp=4`, // Remove messaging from the top.
		`9,h,0,+Etp=19`,   // Put calendar on top.
		`9,h,500,+S`,      // Turn screen on.
		`9,h,400,-Etp=19`, // Remove calendar from the top.
		`9,h,0,+Etp=4`,    // Put messaging on top (2).
		`9,h,50,-S`,       // Turn screen off.
		`9,h,70,-Etp=4`,   // Remove messaging from the top.
		`9,h,0,+Etp=0`,    // Activate search top (should not count because screen is off).

	}, "\n")
	want := newActivitySummary(FormatTotalTime)
	want.StartTimeMs = 1456809000000
	want.EndTimeMs = 1456809016020
	want.TopApplicationSummary[`"com.google.android.googlequicksearchbox"`] = Dist{
		Num:           1,
		TotalDuration: 3000 * time.Millisecond,
		MaxDuration:   3000 * time.Millisecond,
	}
	want.TopApplicationSummary[`"com.google.android.apps.messaging"`] = Dist{
		Num:           2,
		TotalDuration: 5050 * time.Millisecond,
		MaxDuration:   5000 * time.Millisecond,
	}
	want.TopApplicationSummary[`"com.android.calendar/com.google/XXX@google.com"`] = Dist{
		Num:           1,
		TotalDuration: 400 * time.Millisecond,
		MaxDuration:   400 * time.Millisecond,
	}

	wantCSV := strings.Join([]string{
		csv.FileHeader,
		`Top app,service,1456809000000,1456809003000,com.google.android.googlequicksearchbox,10031`,
		`Top app,service,1456809003000,1456809008000,com.google.android.apps.messaging,10066`,
		`Screen,bool,1456809000000,1456809008000,true,unknown screen on reason`,
		`Top app,service,1456809015500,1456809015900,com.android.calendar/com.google/XXX@google.com,10038`,
		`Top app,service,1456809015900,1456809015950,com.google.android.apps.messaging,10066`,
		`Screen,bool,1456809015500,1456809015950,true,unknown screen on reason`,
	}, "\n")

	var b bytes.Buffer
	result := AnalyzeHistory(&b, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 0, 1)

	s := result.Summaries[0]
	if want.StartTimeMs != s.StartTimeMs {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].StartTimeMs = %d, want %d", input, s.StartTimeMs, want.StartTimeMs)
	}
	if want.EndTimeMs != s.EndTimeMs {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].EndTimeMs = %d, want %d", input, s.EndTimeMs, want.EndTimeMs)
	}
	if !reflect.DeepEqual(want.TopApplicationSummary, s.TopApplicationSummary) {
		// TODO: write function that find the difference between maps
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].TopApplicationSummary = %v, want %v", input, s.TopApplicationSummary, want.TopApplicationSummary)
	}

	gotCSV := normalizeCSV(b.String())
	wantCSVNormalized := normalizeCSV(wantCSV)
	if !reflect.DeepEqual(gotCSV, wantCSVNormalized) {
		t.Errorf("AnalyzeHistory(%s,...) generated incorrect csv:\n  got: %q\n  want: %q", input, gotCSV, wantCSVNormalized)
	}
}

func TestTopAppMultipleSummaries(t *testing.T) {
	input := strings.Join([]string{
		`9,hsp,0,10031,"com.google.android.googlequicksearchbox"`,
		`9,h,0:RESET:TIME:1456809000000`,
		`9,h,0,+S,Etp=0`,  // Turn screen on, top app = search
		`9,h,1000,Bs=c`,   // Charging the phone.
		`9,h,2000,Bs=d`,   // Done charging.
		`9,h,5000,-Etp=0`, // Remove search from the top.
	}, "\n")

	want := []*ActivitySummary{
		newActivitySummary(FormatTotalTime),
		newActivitySummary(FormatTotalTime),
	}
	want[0].StartTimeMs = 1456809000000
	want[0].EndTimeMs = 1456809001000
	want[0].TopApplicationSummary[`"com.google.android.googlequicksearchbox"`] = Dist{
		Num:           1,
		TotalDuration: 1000 * time.Millisecond,
		MaxDuration:   1000 * time.Millisecond,
	}
	want[1].StartTimeMs = 1456809003000
	want[1].EndTimeMs = 1456809008000
	want[1].TopApplicationSummary[`"com.google.android.googlequicksearchbox"`] = Dist{
		Num:           1,
		TotalDuration: 5000 * time.Millisecond,
		MaxDuration:   5000 * time.Millisecond,
	}

	wantCSV := strings.Join([]string{
		csv.FileHeader,
		`Charging status,string,1456809001000,1456809003000,c,`,
		`Charging status,string,1456809003000,1456809008000,d,`,
		`Top app,service,1456809000000,1456809008000,com.google.android.googlequicksearchbox,10031`,
		`Screen,bool,1456809000000,1456809008000,true,unknown screen on reason`,
	}, "\n")

	var b bytes.Buffer
	result := AnalyzeHistory(&b, input, FormatTotalTime, emptyUIDPackageMapping, true)
	validateHistory(input, t, result, 0, 2)

	for i, s := range result.Summaries {
		if want[i].StartTimeMs != s.StartTimeMs {
			t.Errorf("AnalyzeHistory(%s,...).Summaries[%v].StartTimeMs = %d, want %d", input, i, s.StartTimeMs, want[i].StartTimeMs)
		}
		if want[i].EndTimeMs != s.EndTimeMs {
			t.Errorf("AnalyzeHistory(%s,...).Summaries[%v].EndTimeMs = %d, want %d", input, i, s.EndTimeMs, want[i].EndTimeMs)
		}
		if !reflect.DeepEqual(want[i].TopApplicationSummary, s.TopApplicationSummary) {
			t.Errorf("AnalyzeHistory(%s,...).Summaries[%v].TopApplicationSummary = %v, want %v", input, i, s.TopApplicationSummary, want[i].TopApplicationSummary)
		}
	}

	gotCSV := normalizeCSV(b.String())
	wantCSVNormalized := normalizeCSV(wantCSV)
	if !reflect.DeepEqual(gotCSV, wantCSVNormalized) {
		t.Errorf("AnalyzeHistory(%s,...) generated incorrect csv:\n  got: %q\n  want: %q", input, gotCSV, wantCSVNormalized)
	}
}

// TestOverflow tests the generation of dist summaries and CSV entries from battery history with overflow events.
func TestOverflow(t *testing.T) {
	input := strings.Join([]string{
		"9,0,i,vers,12,116,LVX72L,LVY29G",
		`9,hsp,94,10011,"com.google.android.gms.people/com.google/test@google.com"`,
		"9,h,0:RESET:TIME:1400000030000", // The time should be changed to 1400000000000 in fixTimeline.
		"9,h,0,Bl=52",
		"9,h,2000,-Esy=94",
		"9,h,5000,+Esy=94",
		"9,h,0:*OVERFLOW*",
		"9,h,1000,Bl=51,Bt=236,Bv=3820,Pss=3,w=14,wr=18,+Esy=10",
		"9,h,2000,Bl=50,Bv=3791,-w=134,+Pr,Pcn=lte,Pss=2,wr=18,-Esy=94",
		"9,h,0:TIME:1400000010000",
		"9,h,2000,Bl=49,Bs=c,Bh=d,Bp=a,Bt=282,Bv=3706,+r,+BP,wr=203",
		"9,h,0:*OVERFLOW*",
		"9,h,3000,Bl=48,Bt=294,Bv=3785,-w=13,-s,-a,-S,Pss=3,Sb=0,Wss=2,Wsp=compl,wr=18,-Esy=94",
	}, "\n")

	wantCSV := strings.Join([]string{
		csv.FileHeader,
		`Battery Level,int,1400000000000,1400000008000,52,`,
		`SyncManager,service,1400000000000,1400000002000,com.google.android.gms.people/com.google/test@google.com,10011`,
		`SyncManager,service,1400000007000,1400000007000,com.google.android.gms.people/com.google/test@google.com,10011`,
		`Battery Level,int,1400000008000,1400000010000,51,`,
		`Battery Level,int,1400000010000,1400000012000,50,`,
		`Battery Level,int,1400000012000,1400000015000,49,`,
		`Battery Level,int,1400000015000,1400000015000,48,`,
	}, "\n")

	wantSummary := newActivitySummary(FormatTotalTime)
	wantSummary.StartTimeMs = 1400000000000
	wantSummary.EndTimeMs = 1400000007000
	wantSummary.PerAppSyncSummary[`"com.google.android.gms.people/com.google/test@google.com"`] = Dist{
		Num:           2,
		TotalDuration: 2000 * time.Millisecond,
		MaxDuration:   2000 * time.Millisecond,
	}

	var b bytes.Buffer
	result := AnalyzeHistory(&b, input, FormatTotalTime, emptyUIDPackageMapping, false)
	validateHistory(input, t, result, 0, 1)

	s := result.Summaries[0]
	if wantSummary.StartTimeMs != s.StartTimeMs {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].StartTimeMs = %d, want %d", input, s.StartTimeMs, wantSummary.StartTimeMs)
	}
	if wantSummary.EndTimeMs != s.EndTimeMs {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].EndTimeMs = %d, want %d", input, s.EndTimeMs, wantSummary.EndTimeMs)
	}
	if !reflect.DeepEqual(wantSummary.PerAppSyncSummary, s.PerAppSyncSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].PerAppSyncSummary output incorrect:\n  got %v\n  want %v", input, s.PerAppSyncSummary, wantSummary.PerAppSyncSummary)
	}

	got := normalizeCSV(b.String())
	want := normalizeCSV(wantCSV)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("AnalyzeHistory(%v) generated incorrect csv:\n  got: %q\n  want: %q", input, got, want)
	}
}
