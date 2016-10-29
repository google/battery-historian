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

// Package packageutils contains functions used to extract package information from a bug report
// and to determine the best guess as to which package is associated with a given string and uid.
package packageutils

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/battery-historian/historianutils"

	usagepb "github.com/google/battery-historian/pb/usagestats_proto"
)

const (
	// perUserRange gives the range of uids allocated for an individual user.
	// Defined in frameworks/base/core/java/android/os/UserHandle.java.
	perUserRange = 100000

	// FirstApplicationUID defines the start of a range of UIDs (and GIDs), going from this number to
	// LAST_APPLICATION_UID (which is 19999) that are reserved for assigning to applications. Both
	// constants are defined in frameworks/base/core/java/android/os/Process.java.
	FirstApplicationUID = 10000
	// First uid used for fully isolated sandboxed processes (with no permissions of their own).
	// Defined in frameworks/base/core/java/android/os/Process.java.
	firstIsolatedUID = 99000
	// Last uid used for fully isolated sandboxed processes (with no permissions of their own).
	// Defined in frameworks/base/core/java/android/os/Process.java.
	lastIsolatedUID = 99999
	// First gid for applications to share resources. Used when forward-locking is enabled but all UserHandles need to be able to read the resources.
	// Defined in frameworks/base/core/java/android/os/Process.java.
	firstSharedApplicationGID = 50000
	// Last gid for applications to share resources. Used when forward-locking is enabled but all UserHandles need to be able to read the resources.
	// Defined in frameworks/base/core/java/android/os/Process.java.
	lastSharedApplicationGID = 59999
)

// abrUIDRE is a regular expression to match an abbreviated uid (ie u0a2). Based on the format printed in frameworks/base/core/java/android/os/UserHandle.java
var abrUIDRE = regexp.MustCompile("u(?P<userId>\\d+)(?P<aidType>[ias])(?P<appId>\\d+)")

// This list is not comprehensive but it will cover the most common cases. The list was curated
// from the output of running both 'adb shell dumpsys activity providers' and
// 'adb shell dumpsys content' on several devices. There are cases where a
// reported name could map to different applications.
var syncAdapterToPackageName = map[string]string{
	// com.android.calendar and com.android.contacts can be used by many applications and are thus only differentiable by the process uid.
	// If it gets to this point, the default packages listed here appear to be installed on all devices.
	"com.android.calendar":                                       "com.android.providers.calendar",
	"com.android.contacts":                                       "com.android.providers.contacts",
	"com.android.gmail.ui":                                       "com.google.android.gm",
	"com.android.inputmethod.japanese":                           "com.google.android.inputmethod.japanese",
	"com.android.inputmethod.korean":                             "com.google.android.inputmethod.korean",
	"com.android.inputmethod.latin":                              "com.google.android.inputmethod.latin",
	"com.android.inputmethod.pinyin":                             "com.google.android.inputmethod.pinyin",
	"com.android.mail.notifier":                                  "com.google.android.gm",
	"com.google.android.apps.bigtop":                             "com.google.android.apps.inbox",
	"com.google.android.apps.docs.editors.kix":                   "com.google.android.apps.docs.editors.docs",
	"com.google.android.apps.docs.editors.punch":                 "com.google.android.apps.docs.editors.slides",
	"com.google.android.apps.docs.editors.ritz":                  "com.google.android.apps.docs.editors.sheets",
	"com.google.android.apps.docs.editors.sketchy":               "com.google.android.apps.docs.editors.slides",
	"com.google.android.apps.docs.editors.trix":                  "com.google.android.apps.docs.editors.sheets",
	"com.google.android.apps.hangouts.content.EsProvider":        "com.google.android.talk",
	"com.google.android.apps.inputmethod.pinyin":                 "com.google.android.inputmethod.pinyin",
	"com.google.android.apps.photos.content":                     "com.google.android.apps.plus",
	"com.google.android.apps.photos.GooglePhotoDownsyncProvider": "com.google.android.apps.plus",
	"com.google.android.finsky.AppIconProvider":                  "com.android.vending",
	"com.google.android.finsky.QSBSuggestionsProvider2":          "com.android.vending",
	"com.google.android.finsky.RecentSuggestionsProvider":        "com.android.vending",
	"com.google.android.gm2.accountcache":                        "com.google.android.gm",
	"com.google.android.gm2.conversation.provider":               "com.google.android.gm",
	"com.google.android.gmail.attachmentprovider":                "com.google.android.gm",
	"com.google.android.gmail.conversation.provider":             "com.google.android.gm",
	"com.google.android.gmail.provider":                          "com.google.android.gm",
	"com.google.android.inputmethod.dictionarypack":              "com.google.android.inputmethod.latin",
	"com.google.android.launcher.settings":                       "com.google.android.googlequicksearchbox",
	"com.google.android.location.copresence":                     "com.google.android.gms",
	"com.google.android.location.internal":                       "com.google.android.gms",
	"com.google.android.location.reporting":                      "com.google.android.gms",
	"com.google.android.maps.NavigationAvailabilityProvider":     "com.google.android.apps.maps",
	"com.google.android.providers.talk":                          "com.google.android.gsf",
	"com.google.android.velvet.extradex.ExtraDexHostProvider":    "com.google.android.googlequicksearchbox",
	"com.google.contacts.gal.provider":                           "com.google.android.syncadapters.contacts",
	"com.google.plus.platform":                                   "com.google.android.apps.plus",
	"com.google.settings":                                        "com.google.android.gsf",
	"contacts;com.android.contacts":                              "com.android.providers.contacts",
	"gmail-appindexing":                                          "com.google.android.gm",
	"gmail-disnot":                                               "com.google.android.gm",
	"gmail-ls":                                                   "com.google.android.gm",
	"subscribedfeeds":                                            "com.google.android.gsf",
}

// guessPackageJustFromIdentifier tries to guess the package based on the given
// identifying string (for example, a sync adapter or wakelock name).
func guessPackageJustFromIdentifier(s string, p []*usagepb.PackageInfo) (likeliest *usagepb.PackageInfo) {
	// Unfortunately there's no standard format in the hsp lines for package names
	// and there isn't a common enough pattern (apart from aaa(.bbb)+) to allow
	// the successful use of regexp
	original := s
	keyFound := ""
	for key, val := range syncAdapterToPackageName {
		if strings.Contains(original, key) && len(key) > len(keyFound) {
			s = val
			keyFound = key
		}
	}

	// There can be multiple packages that match in the second for loop, for example, "android",
	// is uploaded as a package name, which will match with almost everything Google. To avoid
	// returning the wrong package, keep track of the match with the longest matched package name
	for _, pkg := range p {
		if strings.Contains(s, pkg.GetPkgName()) {
			if likeliest == nil || len(likeliest.GetPkgName()) < len(pkg.GetPkgName()) {
				likeliest = pkg
			}
		}
	}
	return likeliest
}

// GuessPackage returns the best guess for the owning package corresponding to the identifying string
// (ie. a sync adapter or wakelock name) by evaluating the given UID and the package name found in desc.
func GuessPackage(identifier string, uid string, p []*usagepb.PackageInfo) (l *usagepb.PackageInfo, err error) {
	u, err := AppIDFromString(uid)
	if u == 0 {
		return guessPackageJustFromIdentifier(identifier, p), err
	}

	var matchedUids []*usagepb.PackageInfo
	var missingUids []*usagepb.PackageInfo

	for _, pkg := range p {
		// A package would have a uid of 0 if the device was unable to populate it.
		// 0 is used as the default for apps with unknown UIDs.
		a := AppID(pkg.GetUid())
		if a == 0 {
			missingUids = append(missingUids, pkg)
		} else if a == u {
			matchedUids = append(matchedUids, pkg)
		}
	}

	if len(matchedUids) == 1 {
		return matchedUids[0], err
	}

	// Found multiple packages with same UID or packages that don't have a UID. Default to comparing the identifier.
	candidatePackages := append(missingUids, matchedUids...)
	return guessPackageJustFromIdentifier(identifier, candidatePackages), err
}

// AppID returns the appID (or base uid) for a given uid, stripping out the user id from it.
// Based on frameworks/base/core/java/android/os/UserHandle.java.
func AppID(uid int32) int32 {
	u := uid % perUserRange
	// Application GID to appID parsing defined in frameworks/base/core/java/android/os/UserHandle.java
	if firstSharedApplicationGID <= u && u <= lastSharedApplicationGID {
		return u + FirstApplicationUID - firstSharedApplicationGID
	}
	return u
}

// AppIDFromString returns the appID (or base uid) for a given uid, stripping out the user id from it.
// (ie. "10001" -> 10001,nil; "u0a25" -> 10025,nil; "text" -> 0,error
func AppIDFromString(uid string) (int32, error) {
	// The empty string is a valid/expected value to pass through here.
	if uid == "" {
		return 0, nil
	}

	if m, result := historianutils.SubexpNames(abrUIDRE, uid); m {
		i, err := strconv.Atoi(result["appId"])
		if err != nil {
			return 0, fmt.Errorf("error getting appID from string: %v", err)
		}
		// These are types defined and formatted in frameworks/base/core/java/android/os/UserHandle.java
		switch result["aidType"] {
		case "i": // Isolated UID
			return int32(i) + firstIsolatedUID, nil
		case "a": // appId >= FirstApplicationUID
			return int32(i) + FirstApplicationUID, nil
		case "s": // Unmodified appID
			return int32(i), nil
		default:
			return int32(i), fmt.Errorf("unknown appIdType: %s", result["aidType"])
		}
	}

	i, err := strconv.Atoi(uid)
	if err != nil {
		return 0, fmt.Errorf("error getting appID from string: %v", err)
	}
	return AppID(int32(i)), nil
}

// IsSandboxedProcess returns true if the given UID is the UID of a fully isolated sandboxed process.
func IsSandboxedProcess(uid int32) bool {
	return firstIsolatedUID <= uid && uid <= lastIsolatedUID
}
