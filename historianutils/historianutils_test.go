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

package historianutils

import (
	"testing"
)

func TestScrubPII(t *testing.T) {
	test := map[string]string{
		"pureemail@google.com":                               "XXX@google.com",
		"hyphen-ated@google.com":                             "XXX@google.com",
		"under_score@google.com":                             "XXX@google.com",
		"with.dot@google.com":                                "XXX@google.com",
		"notAn-email":                                        "notAn-email",
		"incomplete@":                                        "incomplete@",
		"wake.lock@1a23b4":                                   "wake.lock@1a23b4", // There are some wakelocks with this name format
		"com.android.calendar/com.google/noogley@google.com": "com.android.calendar/com.google/XXX@google.com",
		"lot-o-prefixes/with//com.google/noogley@google.com": "lot-o-prefixes/with//com.google/XXX@google.com",
	}
	for in, want := range test {
		got := ScrubPII(in)
		if got != want {
			t.Errorf("ScrubPII(%s) output incorrect email:\n  got: %s\n  want: %s", in, got, want)
		}
	}
}
