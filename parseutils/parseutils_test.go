// Copyright 2015 Google Inc. All Rights Reserved.
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
	"fmt"
	"io/ioutil"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/battery-historian/csv"
)

// TestEcnParse tests the parsing of Ecn entries in a history log.
func TestEcnParse(t *testing.T) {
	inputs := []string{
		// Wifi, mobile connect and multiple disconnects.
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

		// First entry is a disconnect.
		strings.Join([]string{
			`9,0,i,vers,11,116,LMY06B,LMY06B`,
			`9,hsp,3,1,"CONNECTED"`,
			`9,hsp,28,1,"DISCONNECTED"`,
			`9,h,0:RESET:TIME:1422620451417`,
			`9,h,2000,Ecn=28`,
			`9,h,1000,Ecn=3`,
			`9,h,1000,Ecn=28`,
		}, "\n"),

		// Copied from a bug report.
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
	}
	summaryWants := []map[string]Dist{
		{
			"TYPE_WIFI": {
				Num:           2,
				TotalDuration: 3 * time.Second,
				MaxDuration:   2 * time.Second,
			},
			"TYPE_MOBILE": {
				Num:           1,
				TotalDuration: 1 * time.Second,
				MaxDuration:   1 * time.Second,
			},
		},

		{
			"TYPE_WIFI": {
				Num:           2,
				TotalDuration: 3 * time.Second,
				MaxDuration:   2 * time.Second,
			},
		},

		{
			"TYPE_WIFI": {
				Num:           5,
				TotalDuration: 9480 * time.Millisecond,
				MaxDuration:   3214 * time.Millisecond,
			},
			"TYPE_MOBILE": {
				Num:           4,
				TotalDuration: 15971 * time.Millisecond,
				MaxDuration:   8716 * time.Millisecond,
			},
			"TYPE_MOBILE_HIPRI": {
				Num:           1,
				TotalDuration: 3693 * time.Millisecond,
				MaxDuration:   3693 * time.Millisecond,
			},
			"TYPE_MOBILE_SUPL": {
				Num:           4,
				TotalDuration: 3490 * time.Millisecond,
				MaxDuration:   2183 * time.Millisecond,
			},
		},
	}

	csvWants := []string{
		strings.Join([]string{
			csv.FileHeader,
			"connectivity,service,1422620452417,1422620454417,TYPE_WIFI,",
			"connectivity,service,1422620457417,1422620458417,TYPE_MOBILE,",
			"connectivity,service,1422620459417,1422620460417,TYPE_WIFI,",
		}, "\n"),

		strings.Join([]string{
			csv.FileHeader,
			"connectivity,service,1422620451417,1422620453417,TYPE_WIFI,",
			"connectivity,service,1422620454417,1422620455417,TYPE_WIFI,",
		}, "\n"),

		strings.Join([]string{
			csv.FileHeader,
			"connectivity,service,1422620452507,1422620453575,TYPE_WIFI,",
			"connectivity,service,1422620470918,1422620474611,TYPE_MOBILE_HIPRI,",
			"connectivity,service,1422620470798,1422620475971,TYPE_MOBILE,",
			"connectivity,service,1422620475980,1422620478131,TYPE_WIFI,",
			"connectivity,service,1422620481886,1422620483925,TYPE_MOBILE,",
			"connectivity,service,1422620483935,1422620487149,TYPE_WIFI,",
			"connectivity,service,1422620492300,1422620492638,TYPE_MOBILE_SUPL,",
			"connectivity,service,1422620493874,1422620494123,TYPE_MOBILE_SUPL,",
			"connectivity,service,1422620497458,1422620499641,TYPE_MOBILE_SUPL,",
			"connectivity,service,1422620491121,1422620499837,TYPE_MOBILE,",
			"connectivity,service,1422620502466,1422620503186,TYPE_MOBILE_SUPL,",
			"connectivity,service,1422620500322,1422620503368,TYPE_WIFI,",
			"connectivity,service,1422620504000,1422620504043,TYPE_MOBILE,",
			"connectivity,service,1422620504050,1422620504051,TYPE_WIFI,",
			"Wifi full lock,bool,1422620504051,1422620504051,true,",
		}, "\n"),
	}
	csvTestDescriptions := []string{
		"Wifi, mobile connect and multiple disconnects",
		"First entry is a disconnect",
		"Large connectivity test",
	}

	for i, input := range inputs {
		var b bytes.Buffer
		result := AnalyzeHistory(input, FormatTotalTime, &b, true)
		validateHistory(input, t, result, 0, 1)

		s := result.Summaries[0]
		if !reflect.DeepEqual(summaryWants[i], s.ConnectivitySummary) {
			t.Errorf("AnalyzeHistory(%s,...).Summaries[0].ConnectivitySummary = %v, want %v", input, s.ConnectivitySummary, summaryWants[i])
		}

		got := normalizeCSV(b.String())
		want := normalizeCSV(csvWants[i])
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", csvTestDescriptions[i], input, got, want)
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

	result := AnalyzeHistory(input, FormatBatteryLevel, ioutil.Discard, true)
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

	resultTotalTime := AnalyzeHistory(input, FormatTotalTime, ioutil.Discard, true)

	resultBatteryLevel := AnalyzeHistory(input, FormatBatteryLevel, ioutil.Discard, true)

	if len(resultTotalTime.Errs) > 0 {
		t.Errorf("AnalyzeHistory(%s,FormatTotalTime,...) errs: %v", input, resultTotalTime.Errs)
	}
	if len(resultBatteryLevel.Errs) > 0 {
		t.Errorf("AnalyzeHistory(%s,FormatBatteryLevel,...) errs: %v", input, resultBatteryLevel.Errs)
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

	result := AnalyzeHistory(input, FormatBatteryLevel, ioutil.Discard, true)
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

// TestMergeIntervals test merging intervals functionality for sync durations
func TestMergeIntervals(t *testing.T) {
	inputs := [][]interval{
		// Test case 1: intervals are not overlaped
		{
			{0, 1},
			{2, 3},
			{4, 5},
			{8, 10},
		},
		// Test case 2: intervals are included in one big interval
		{
			{0, 10},
			{0, 2},
			{4, 5},
			{7, 12},
			{1, 3},
		},
		// Test case 3: intervals are partially overlaped, second interval is overlapped with first interval's right part
		{
			{0, 5},
			{3, 8},
		},
		// Test case 4: intervals are partially overlaped, second interval is overlapped with first interval's left part
		{
			{4, 8},
			{2, 5},
		},
		// Test case 5: intervals are not overlaped but connected by edges
		{
			{1, 4},
			{4, 8},
			{8, 10},
		},
		// Test case 6: random intervals contain all above situations
		{
			{0, 1},
			{3, 4},
			{5, 10},
			{6, 8},
			{7, 9},
			{12, 16},
			{11, 15},
			{16, 18},
			{20, 22},
			{26, 29},
			{25, 27},
			{30, 33},
		},
	}

	wants := [][]interval{
		{
			{0, 1},
			{2, 3},
			{4, 5},
			{8, 10},
		},
		{
			{0, 12},
		},
		{
			{0, 8},
		},
		{
			{2, 8},
		},
		{
			{1, 10},
		},
		{
			{0, 1},
			{3, 4},
			{5, 10},
			{11, 18},
			{20, 22},
			{25, 29},
			{30, 33},
		},
	}
	var output []interval
	for i, input := range inputs {
		output = mergeIntervals(input)
		if !reflect.DeepEqual(wants[i], output) {
			t.Errorf("mergeIntervals(%v) = %v, want %v", input, output, wants[i])
		}
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

	result := AnalyzeHistory(input, FormatTotalTime, ioutil.Discard, true)
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

	result := AnalyzeHistory(input, FormatTotalTime, ioutil.Discard, true)
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
		fmt.Errorf(`** Error in 9,h,4321,-Esy=0 in  -Esy=0 : two negative transitions for "sync app":"-". `),
	}

	result := AnalyzeHistory(input, FormatTotalTime, ioutil.Discard, true)
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
		fmt.Errorf(`** Error in 9,h,4000,-S in  -S : two negative transitions for "screen":"-". `),
	}

	result := AnalyzeHistory(input, FormatTotalTime, ioutil.Discard, true)
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
		result := AnalyzeHistory(input, FormatTotalTime, ioutil.Discard, doScrub)
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

// validateHistory checks there were no errors in the given analysis report,
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
	}, "\n")

	want := newActivitySummary(FormatTotalTime)
	want.StartTimeMs = 1422620451417
	want.EndTimeMs = 1422620462417
	want.WakeLockSummary[`"com.google.android.apps.docs.editors.punch/com.google/XXX@google.com"`] = Dist{
		Num:           1,
		TotalDuration: 10000 * time.Millisecond,
		MaxDuration:   10000 * time.Millisecond,
	}

	result := AnalyzeHistory(input, FormatTotalTime, ioutil.Discard, true)

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

// TestWakeLockInParse tests the parsing of wakelock_in entries in a history log.
// Check that wake lock is ignored if wakelock_in is present.
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
		TotalDuration: 5000 * time.Millisecond,
		MaxDuration:   5000 * time.Millisecond,
	}
	want.WakeLockSummary[`"com.google.android.apps.docs.editors.kix/com.google/XXX@google.com"`] = Dist{
		Num:           1,
		TotalDuration: 8000 * time.Millisecond,
		MaxDuration:   8000 * time.Millisecond,
	}

	result := AnalyzeHistory(input, FormatTotalTime, ioutil.Discard, true)

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

// TestUIDToPackageNameMapping tests that mapping of UIDs to package names from the checkin log works properly.
func TestUIDToPackageNameMapping(t *testing.T) {
	input := strings.Join([]string{
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
	}, "\n")

	want := map[int32]string{
		10005: "com.android.providers.calendar",
		1001:  "com.android.phone;com.android.stk",
		10014: "com.google.android.gms",
	}

	got, errs := UIDToPackageNameMapping(input)
	if len(errs) > 0 {
		t.Fatalf("Encountered errors: %v", errs)
	}

	if !reflect.DeepEqual(want, got) {
		t.Errorf("UID--package mapping incorrect.\n  Got: %v,\n  want: %v", got, want)
	}
}

// TestIdleModeOnAndEjbParse tests the parsing of idle_mode and job entries in a history log.
func TestIdleModeOnAndEjbParse(t *testing.T) {
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
		`9,h,6493,+di,+Ejb=19`,
		`9,h,1388,-w`,
		`9,h,3,+w=20`,
		`9,h,13,-w`,
		`9,h,3,+w=20`,
		`9,h,114,-w`,
		`9,h,5575,-di,-Ejb=19`,
		`9,h,28,+w=21,+Ejb=19`,
		`9,h,3,-w`,
		`9,h,3,+w=21,-Ejb=19`,
		`9,h,1,-w`,
		`9,h,4,+w=20`,
		`9,h,5672,-w,+di,+Ejb=21`, // no -di, no -Ejb=21
		`9,h,7,+w=17`,
		`9,h,2,-r,-w`,
	}, "\n")

	want := newActivitySummary(FormatTotalTime)
	want.IdleModeOnSummary = Dist{
		Num:           2,
		TotalDuration: 7105 * time.Millisecond,
		MaxDuration:   7096 * time.Millisecond,
	}
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

	result := AnalyzeHistory(input, FormatTotalTime, ioutil.Discard, true)
	validateHistory(input, t, result, 0, 1)
	s := result.Summaries[0]

	if !reflect.DeepEqual(want.IdleModeOnSummary, s.IdleModeOnSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].IdleModeOnSummary = %v, want %v", input, s.IdleModeOnSummary, want.IdleModeOnSummary)
	}
	if !reflect.DeepEqual(want.ScheduledJobSummary, s.ScheduledJobSummary) {
		t.Errorf("AnalyzeHistory(%s,...).Summaries[0].ScheduledJobSummary = %v, want %v", input, s.ScheduledJobSummary, want.ScheduledJobSummary)
	}
}

// Tests the generating of CSV entries for a tsBool type.
func TestCSVBoolEntry(t *testing.T) {
	inputs := []string{
		// Several positive and negative transitions.
		strings.Join([]string{
			"9,0,i,vers,11,116,LMY06B,LMY06B",
			"9,h,0:RESET:TIME:1422620451417",
			"9,h,1000,+Psc",
			"9,h,1500,-Psc",
			"9,h,2500,+Psc",
			"9,h,2000,-Psc",
		}, "\n"),

		// First entry is a negative transition.
		strings.Join([]string{
			"9,0,i,vers,11,116,LMY06B,LMY06B",
			"9,h,0:RESET:TIME:1422620451417",
			"9,h,1000,-Psc",
			"9,h,1000,+Psc",
			"9,h,1500,-Psc",
		}, "\n"),

		// Positive transition before shutdown.
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

		// Negative transition before shutdown.
		strings.Join([]string{
			"9,0,i,vers,11,116,LMY06B,LMY06B",
			"9,h,0:RESET:TIME:1422620451417",
			"9,h,1000,-Psc",
			"9,h,500:SHUTDOWN",
			"9,h,4:START",
			"9,h,0:TIME:1430000000000",
		}, "\n"),
	}
	csvWants := []string{
		strings.Join([]string{
			csv.FileHeader,
			"phone scanning,bool,1422620452417,1422620453917,true,",
			"phone scanning,bool,1422620456417,1422620458417,true,",
		}, "\n"),
		strings.Join([]string{
			csv.FileHeader,
			"phone scanning,bool,1422620451417,1422620452417,true,",
			"phone scanning,bool,1422620453417,1422620454917,true,",
		}, "\n"),
		strings.Join([]string{
			csv.FileHeader,
			"phone scanning,bool,1422620452417,1422620452917,true,",
			"reboot,bool,1422620452917,1430000000000,true,",
			"phone scanning,bool,1430000001000,1430000003000,true,",
		}, "\n"),
		strings.Join([]string{
			csv.FileHeader,
			"phone scanning,bool,1422620451417,1422620452417,true,",
			"reboot,bool,1422620452917,1430000000000,true,",
		}, "\n"),
	}
	numSummariesWants := []int{
		1,
		1,
		2,
		1,
	}
	csvTestDescriptions := []string{
		"Several positive and negative transitions",
		"First entry is a negative transition",
		"Positive transition before shutdown",
		"Negative transition before shutdown",
	}

	for i, input := range inputs {
		var b bytes.Buffer
		result := AnalyzeHistory(input, FormatTotalTime, &b, true)
		validateHistory(input, t, result, 0, numSummariesWants[i])

		got := normalizeCSV(b.String())
		want := normalizeCSV(csvWants[i])
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", csvTestDescriptions[i], input, got, want)
		}
	}
}

// Tests the generating of CSV entries for a tsInt type.
func TestCSVIntEntry(t *testing.T) {
	inputs := []string{
		// Several brightness changes.
		strings.Join([]string{
			"9,0,i,vers,11,116,LMY06B,LMY06B",
			"9,h,0:RESET:TIME:1422620451417",
			"9,h,1000,Sb=0",
			"9,h,1500,Sb=1",
			"9,h,2500,Sb=4",
			"9,h,2000,Sb=0",
		}, "\n"),

		// With a time reset.
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
	}
	csvWants := []string{
		strings.Join([]string{
			csv.FileHeader,
			"brightness,int,1422620452417,1422620453917,0,",
			"brightness,int,1422620453917,1422620456417,1,",
			"brightness,int,1422620456417,1422620458417,4,",
			"brightness,int,1422620458417,1422620458417,0,",
		}, "\n"),
		strings.Join([]string{
			csv.FileHeader,
			"brightness,int,1422620452417,1422620453917,0,",
			"brightness,int,1422620453917,1422620454417,1,",
			"reboot,bool,1422620454417,1430000000000,true,",
			"brightness,int,1430000001000,1430000003000,4,",
			"brightness,int,1430000003000,1430000003000,0,",
		}, "\n"),
	}
	numSummariesWants := []int{
		1,
		2,
	}
	csvTestDescriptions := []string{
		"Brightness changes",
		"Shutdown event between brightness changes",
	}

	for i, input := range inputs {
		var b bytes.Buffer
		result := AnalyzeHistory(input, FormatTotalTime, &b, true)
		validateHistory(input, t, result, 0, numSummariesWants[i])

		got := normalizeCSV(b.String())
		want := normalizeCSV(csvWants[i])
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", csvTestDescriptions[i], input, got, want)
		}
	}
}

// Tests the generating of CSV entries for a tsString type.
func TestCSVStringEntry(t *testing.T) {
	inputs := []string{
		// Several different values.
		strings.Join([]string{
			"9,0,i,vers,11,116,LMY06B,LMY06B",
			"9,h,0:RESET:TIME:1422620451417",
			"9,h,1000,Pcn=hspa",
			"9,h,1500,Pcn=lte",
			"9,h,2500,Pcn=hspap",
			"9,h,2000,Pcn=lte",
		}, "\n"),

		// With a time reset.
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
	}
	csvWants := []string{
		strings.Join([]string{
			csv.FileHeader,
			"data conn,string,1422620452417,1422620453917,hspa,",
			"data conn,string,1422620453917,1422620456417,lte,",
			"data conn,string,1422620456417,1422620458417,hspap,",
			"data conn,string,1422620458417,1422620458417,lte,",
		}, "\n"),
		strings.Join([]string{
			csv.FileHeader,
			"data conn,string,1422620452417,1422620453917,hspa,",
			"data conn,string,1422620453917,1422620454417,lte,",
			"reboot,bool,1422620454417,1430000000000,true,",
			"data conn,string,1430000001000,1430000003000,lte,",
			"data conn,string,1430000003000,1430000003000,hspap,",
		}, "\n"),
	}
	numSummariesWants := []int{
		1,
		2,
	}
	csvTestDescriptions := []string{
		"Data connection changes",
		"Shutdown event between data connection changes",
	}

	for i, input := range inputs {
		var b bytes.Buffer
		result := AnalyzeHistory(input, FormatTotalTime, &b, true)
		validateHistory(input, t, result, 0, numSummariesWants[i])

		got := normalizeCSV(b.String())
		want := normalizeCSV(csvWants[i])
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", csvTestDescriptions[i], input, got, want)
		}
	}
}

// Tests the generating of CSV entries for a ServiceUID type.
func TestCSVServiceEntry(t *testing.T) {
	inputs := []string{
		// Overlapping entries.
		strings.Join([]string{
			`9,h,0:RESET:TIME:1422620451417`,
			`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
			`9,hsp,18,1010051,"com.google.android.apps.docs/com.google/noogler@google.com"`,
			`9,hsp,22,1010052,"com.google.android.apps.docs.editors.kix/com.google/noogler@google.com"`,
			`9,h,1000,+Ewl=17`,
			`9,h,2000,+Ewl=22`,
			`9,h,3000,-Ewl=17`,
			`9,h,2000,+Ewl=18`,
			`9,h,5000,-Ewl=22`,
		}, "\n"),

		// Nested entries.
		strings.Join([]string{
			`9,h,0:RESET:TIME:1422620451417`,
			`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
			`9,hsp,18,1010051,"com.google.android.apps.docs/com.google/noogler@google.com"`,
			`9,hsp,22,1010052,"com.google.android.apps.docs.editors.kix/com.google/noogler@google.com"`,
			`9,h,1000,+Ewl=17`,
			`9,h,2000,+Ewl=22`,
			`9,h,2000,+Ewl=18`,
			`9,h,2000,-Ewl=18`,
			`9,h,5000,-Ewl=22`,
			`9,h,3000,-Ewl=17`,
		}, "\n"),

		// First entry is a negative transition.
		strings.Join([]string{
			`9,h,0:RESET:TIME:1422620451417`,
			`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
			`9,h,2000,-Ewl=17`,
		}, "\n"),

		// Open entry before shutdown.
		strings.Join([]string{
			`9,h,0:RESET:TIME:1422620451417`,
			`9,hsp,17,1010054,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com"`,
			`9,hsp,18,1010051,"com.google.android.apps.docs/com.google/noogler@google.com"`,
			`9,h,1000,+Ewl=17`,
			`9,h,2000,+Ewl=18`,
			`9,h,2000,-Ewl=18`,
			`9,h,500:SHUTDOWN`,
			`9,h,4:START`,
			`9,h,0:TIME:1430000000000`,
		}, "\n"),
	}
	csvWants := []string{
		strings.Join([]string{
			csv.FileHeader,
			`wakelock_in,service,1422620452417,1422620457417,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com",1010054`,
			`wakelock_in,service,1422620454417,1422620464417,"com.google.android.apps.docs.editors.kix/com.google/noogler@google.com",1010052`,
			`wakelock_in,service,1422620459417,1422620464417,"com.google.android.apps.docs/com.google/noogler@google.com",1010051`,
		}, "\n"),
		strings.Join([]string{
			csv.FileHeader,
			`wakelock_in,service,1422620456417,1422620458417,"com.google.android.apps.docs/com.google/noogler@google.com",1010051`,
			`wakelock_in,service,1422620454417,1422620463417,"com.google.android.apps.docs.editors.kix/com.google/noogler@google.com",1010052`,
			`wakelock_in,service,1422620452417,1422620466417,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com",1010054`,
		}, "\n"),
		strings.Join([]string{
			csv.FileHeader,
			`wakelock_in,service,1422620451417,1422620453417,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com",1010054`,
		}, "\n"),
		strings.Join([]string{
			csv.FileHeader,
			`wakelock_in,service,1422620454417,1422620456417,"com.google.android.apps.docs/com.google/noogler@google.com",1010051`,
			`wakelock_in,service,1422620452417,1422620456917,"com.google.android.apps.docs.editors.punch/com.google/noogler@google.com",1010054`,
			`reboot,bool,1422620456917,1430000000000,true,`,
		}, "\n"),
	}
	numSummariesWants := []int{
		1,
		1,
		1,
		1,
	}
	csvTestDescriptions := []string{
		"Overlapping wakelock entries",
		"Nesting wakelock entries",
		"First wakelock entry is a negative transition",
		"Last Wakelock entry has no corresponding negative transition before shutdown",
	}

	for i, input := range inputs {
		var b bytes.Buffer
		result := AnalyzeHistory(input, FormatTotalTime, &b, false)
		validateHistory(input, t, result, 0, numSummariesWants[i])

		got := normalizeCSV(b.String())
		want := normalizeCSV(csvWants[i])
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: AnalyzeHistory(%v) outputted csv = %q, want: %q", csvTestDescriptions[i], input, got, want)
		}
	}
}

// Removes trailing spaces and sorts the csv lines.
func normalizeCSV(text string) []string {
	lines := strings.Split(strings.TrimSpace(text), "\n")

	// Order of events generated might not be the same - if several transitions are open
	// at a SHUTDOWN event, then we iterate through the open events and create csv entries.
	// As iteration order of go maps is not defined, this may result a different order generated.
	sort.Strings(lines)

	return lines
}
