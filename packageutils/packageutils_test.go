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

package packageutils

import (
	"fmt"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/golang/protobuf/proto"
	usagepb "github.com/google/battery-historian/pb/usagestats_proto"
)

const (
	version = 2
	app1    = "app1"
	app2    = "app2"
	app3    = "app3"
	app4    = "app4"
	app5    = "app5"
	app6    = "app6"
	app7    = "app7"
)

type service struct {
	service string
	uid     string
}

func makePackageInfo(pkgName string, versionCode int32, versionName string,
	firstInstallTime int64, lastUpdateTime int64, uid int32) *usagepb.PackageInfo {
	pkgInfo := &usagepb.PackageInfo{
		PkgName:          &pkgName,
		VersionCode:      &versionCode,
		VersionName:      &versionName,
		FirstInstallTime: &firstInstallTime,
		LastUpdateTime:   &lastUpdateTime,
		Uid:              &uid,
	}
	return pkgInfo
}

// TestGuessPackageWithPopulatedUids tests cases where all packages in the uploaded package list have associated UIDs.
func TestGuessPackageWithPopulatedUids(t *testing.T) {
	packageList := []*usagepb.PackageInfo{
		{PkgName: proto.String("android"), Uid: proto.Int32(1)},
		{PkgName: proto.String("com.android.vending"), Uid: proto.Int32(2)},
		// Testing case of two packages sharing the same uid.
		{PkgName: proto.String("com.android.providers.contacts"), Uid: proto.Int32(3)},
		{PkgName: proto.String("com.android.providers.calendar"), Uid: proto.Int32(3)},
		{PkgName: proto.String("com.google.android.apps.inbox"), Uid: proto.Int32(4)},
		{PkgName: proto.String("com.google.android.apps.cloudprint"), Uid: proto.Int32(5)},
		{PkgName: proto.String("com.google.android.apps.docs.editors.docs"), Uid: proto.Int32(6)},
		{PkgName: proto.String("com.google.android.apps.docs.editors.sheets"), Uid: proto.Int32(7)},
		{PkgName: proto.String("com.google.android.apps.fitness"), Uid: proto.Int32(8)},
		{PkgName: proto.String("com.google.android.apps.plus"), Uid: proto.Int32(9)},
		{PkgName: proto.String("com.google.android.music"), Uid: proto.Int32(11)},
		// Testing case of two packages sharing the same uid.
		{PkgName: proto.String("com.google.android.gms"), Uid: proto.Int32(12)},
		{PkgName: proto.String("com.google.android.gsf"), Uid: proto.Int32(12)},
		{PkgName: proto.String("com.google.android.apps.docs"), Uid: proto.Int32(13)},
		{PkgName: proto.String("com.google.android.keep"), Uid: proto.Int32(14)},
		{PkgName: proto.String("com.google.android.talk"), Uid: proto.Int32(15)},
		{PkgName: proto.String("com.google.android.plus"), Uid: proto.Int32(16)},
		{PkgName: proto.String("com.google.android.googlequicksearchbox"), Uid: proto.Int32(17)},
		{PkgName: proto.String("com.google.android.deskclock"), Uid: proto.Int32(18)},
		{PkgName: proto.String("com.google.android.gm"), Uid: proto.Int32(19)},
		{PkgName: proto.String("com.android.vending"), Uid: proto.Int32(10023)},
	}

	serviceToPackageNames := map[service]string{
		// Test that UID matching works correctly for non-shared UIDs.
		service{service: "com.google.android.keep/com.google/XXX@gmail.com", uid: "14"}:                                "com.google.android.keep",
		service{service: "com.google.android.apps.plus.content.EsProvider/com.google/XXX@gmail.com/extra", uid: "9"}:   "com.google.android.apps.plus",
		service{service: "com.google.android.apps.bigtop.provider.bigtopprovider/com.google/XXX@google.com", uid: "4"}: "com.google.android.apps.inbox",
		service{service: "gmail-ls/com.google/XXX@gmail.com", uid: "19"}:                                               "com.google.android.gm",
		service{service: "com.google.android.apps.docs.editors.trix/com.google/XXX@gmail.com", uid: "7"}:               "com.google.android.apps.docs.editors.sheets",
		service{service: "com.google.android.apps.cloudprint.cloudprintprovider", uid: "5"}:                            "com.google.android.apps.cloudprint",
		service{service: "com.android.contacts/com.google/XXX@gmail.com", uid: "19"}:                                   "com.google.android.gm", // Gmail can have a sync under the com.android.contacts name.

		// Test that UID and package name matching works correctly for shared UIDs.
		service{service: "com.google.android.gms.drive.sync/com.google/XXX@gmail.com", uid: "12"}:        "com.google.android.gms",
		service{service: "com.google.android.gms.games.background/com.google/XXX@google.com", uid: "12"}: "com.google.android.gms",
		service{service: "com.google.android.location.reporting/com.google/XXX@google.com", uid: "12"}:   "com.google.android.gms",
		service{service: "com.google.android.location.copresence/com.google/XXX@google.com", uid: "12"}:  "com.google.android.gms",

		// Test package name matching works for cases where a UID is missing.
		service{service: "com.android.calendar/com.google/XXX@google.com"}:                                       "com.android.providers.calendar",
		service{service: "subscribedfeeds/com.google/XXX@google.com"}:                                            "com.google.android.gsf",
		service{service: "com.google.android.apps.photos.GooglePhotoDownsyncProvider/com.google/XXX@google.com"}: "com.google.android.apps.plus",
		service{service: "com.google.android.apps.bigtop.provider.bigtopprovider/com.google/XXX@google.com"}:     "com.google.android.apps.inbox",
		service{service: "gmail-ls/com.google/XXX@gmail.com"}:                                                    "com.google.android.gm",
		service{service: "com.google.android.gms.games.background/com.google/XXX@google.com"}:                    "com.google.android.gms",

		// Test secondary user UIDs
		service{service: "com.google.android.keep/com.google/XXX@gmail.com", uid: "1000014"}:                                 "com.google.android.keep",
		service{service: "com.google.android.apps.plus.content.EsProvider/com.google/XXX@gmail.com/extra", uid: "1000009"}:   "com.google.android.apps.plus",
		service{service: "com.google.android.apps.bigtop.provider.bigtopprovider/com.google/XXX@google.com", uid: "1000004"}: "com.google.android.apps.inbox",
		service{service: "gmail-ls/com.google/XXX@gmail.com", uid: "1000019"}:                                                "com.google.android.gm",
		service{service: "com.google.android.apps.docs.editors.trix/com.google/XXX@gmail.com", uid: "1000007"}:               "com.google.android.apps.docs.editors.sheets",

		// Test matching for a GID
		service{service: "dex2oat", uid: "50023"}: "com.android.vending",
	}

	for service, pkgName := range serviceToPackageNames {
		pkg, err := GuessPackage(service.service, service.uid, packageList)
		if err != nil {
			t.Errorf("Error when guessing package: %v", err)
			continue
		}
		if pkg.GetPkgName() != pkgName {
			t.Errorf("For %v, got %s, expected %s", service, pkg.GetPkgName(), pkgName)
		}
	}
}

// TestGuessPackageWithMissingUids tests cases where some packages in the uploaded package list are missing UIDs.
func TestGuessPackageWithMissingUids(t *testing.T) {
	packageList := []*usagepb.PackageInfo{
		{PkgName: proto.String("com.google.android.volta"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.inputmethod.pinyin"), Uid: proto.Int32(0)},
		{PkgName: proto.String("android"), Uid: proto.Int32(1)},
		{PkgName: proto.String("com.android.vending"), Uid: proto.Int32(2)},
		// Testing case of two packages sharing the same uid.
		{PkgName: proto.String("com.android.providers.contacts"), Uid: proto.Int32(3)},
		{PkgName: proto.String("com.android.providers.calendar"), Uid: proto.Int32(3)},
		{PkgName: proto.String("com.google.android.apps.inbox")},
		{PkgName: proto.String("com.google.android.apps.cloudprint")},
		{PkgName: proto.String("com.google.android.apps.docs.editors.docs"), Uid: proto.Int32(6)},
		{PkgName: proto.String("com.google.android.apps.docs.editors.sheets"), Uid: proto.Int32(7)},
		{PkgName: proto.String("com.google.android.apps.fitness"), Uid: proto.Int32(8)},
		{PkgName: proto.String("com.google.android.apps.plus"), Uid: proto.Int32(9)},
		{PkgName: proto.String("com.google.android.gm"), Uid: proto.Int32(10)},
		{PkgName: proto.String("com.google.android.music"), Uid: proto.Int32(11)},
		// Testing case of two packages sharing the same uid.
		{PkgName: proto.String("com.google.android.gms"), Uid: proto.Int32(12)},
		{PkgName: proto.String("com.google.android.gsf"), Uid: proto.Int32(12)},
		{PkgName: proto.String("com.google.android.apps.docs"), Uid: proto.Int32(13)},
		{PkgName: proto.String("com.google.android.keep")},
		{PkgName: proto.String("com.google.android.talk"), Uid: proto.Int32(15)},
		{PkgName: proto.String("com.google.android.plus"), Uid: proto.Int32(16)},
		{PkgName: proto.String("com.google.android.googlequicksearchbox")},
		{PkgName: proto.String("com.google.android.deskclock"), Uid: proto.Int32(18)},
	}

	serviceToPackageNames := map[service]string{
		// Test that UID matching works correctly for non-shared UIDs.
		service{service: "com.google.android.apps.plus.content.EsProvider/com.google/XXX@gmail.com/extra", uid: "9"}: "com.google.android.apps.plus",
		service{service: "gmail-ls/com.google/XXX@gmail.com", uid: "10"}:                                             "com.google.android.gm",
		service{service: "com.google.android.apps.docs.editors.trix/com.google/XXX@gmail.com", uid: "7"}:             "com.google.android.apps.docs.editors.sheets",
		service{service: "com.android.contacts/com.google/XXX@gmail.com", uid: "10"}:                                 "com.google.android.gm", // Gmail can have a sync under the com.android.contacts name.

		// Test that UID and package name matching works correctly for shared UIDs.
		service{service: "com.google.android.gms.drive.sync/com.google/XXX@gmail.com", uid: "12"}:        "com.google.android.gms",
		service{service: "com.google.android.gms.games.background/com.google/XXX@google.com", uid: "12"}: "com.google.android.gms",
		service{service: "com.google.android.location.reporting/com.google/XXX@google.com", uid: "12"}:   "com.google.android.gms",
		service{service: "com.google.android.location.copresence/com.google/XXX@google.com", uid: "12"}:  "com.google.android.gms",

		// Test package name matching works for cases where a UID is missing.
		service{service: "com.google.android.keep/com.google/XXX@gmail.com", uid: "14"}:                                               "com.google.android.keep",
		service{service: "com.google.android.apps.bigtop.provider.bigtopprovider/com.google/XXX@google.com", uid: "4"}:                "com.google.android.apps.inbox",
		service{service: "com.google.android.apps.cloudprint.cloudprintprovider", uid: "5"}:                                           "com.google.android.apps.cloudprint",
		service{service: "com.android.calendar/com.google/XXX@google.com"}:                                                            "com.android.providers.calendar",
		service{service: "subscribedfeeds/com.google/XXX@google.com"}:                                                                 "com.google.android.gsf",
		service{service: "com.google.android.apps.photos.GooglePhotoDownsyncProvider/com.google/XXX@google.com"}:                      "com.google.android.apps.plus",
		service{service: "com.google.android.apps.bigtop.provider.bigtopprovider/com.google/XXX@google.com"}:                          "com.google.android.apps.inbox",
		service{service: "Volta-com.google.android.volta.BatteryStatsCollectorService", uid: "1010076"}:                               "com.google.android.volta",
		service{service: "*sync*/com.google.android.apps.inputmethod.pinyin.user_dictionary/com.google/XXX@google.com", uid: "10047"}: "com.google.android.inputmethod.pinyin",
	}

	for service, pkgName := range serviceToPackageNames {
		pkg, err := GuessPackage(service.service, service.uid, packageList)
		if err != nil {
			t.Errorf("Error when guessing package: %v", err)
			continue
		}
		if pkg.GetPkgName() != pkgName {
			t.Errorf("For %v, got %s, expected %s", service, pkg.GetPkgName(), pkgName)
		}
	}
}

// TestGuessPackageWithZeroUids tests cases where all packages in the uploaded package list have a uid of 0.
func TestGuessPackageWithZeroUids(t *testing.T) {
	packageList := []*usagepb.PackageInfo{
		{PkgName: proto.String("com.google.android.volta"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.inputmethod.pinyin"), Uid: proto.Int32(0)},
		{PkgName: proto.String("android"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.android.vending"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.android.providers.contacts"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.android.providers.calendar"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.apps.inbox"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.apps.cloudprint"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.apps.fitness"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.apps.plus"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.gm"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.gms"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.gsf"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.apps.docs"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.plus"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.googlequicksearchbox"), Uid: proto.Int32(0)},
	}

	// Given that all the UIDs in the packageList are 0, all of these should be matched by looking at the service string.
	serviceToPackageNames := map[service]string{
		// Bypass comparing UIDs and go straight to comparing the service string.
		service{service: "subscribedfeeds/com.google/XXX@google.com"}:                                        "com.google.android.gsf",
		service{service: "com.google.android.apps.bigtop.provider.bigtopprovider/com.google/XXX@google.com"}: "com.google.android.apps.inbox",

		// These should go through the logic branch of having packages be added to the 'missingUids' slice,
		// so this tests that they are actually added to the slice correctly and then matched by the service string.
		service{service: "gmail-ls/com.google/XXX@gmail.com", uid: "10"}:                               "com.google.android.gm",
		service{service: "com.google.android.location.reporting/com.google/XXX@google.com", uid: "12"}: "com.google.android.gms",
		service{service: "com.google.android.gms.plus.action/com.google/XXX@google.com", uid: "12"}:    "com.google.android.gms",
		// Without the extra UID information, we have no way of knowing that this should go with gmail and must assume that it goes with the contacts provider.
		service{service: "com.android.contacts/com.google/XXX@gmail.com", uid: "10"}: "com.android.providers.contacts",
	}

	for service, pkgName := range serviceToPackageNames {
		pkg, err := GuessPackage(service.service, service.uid, packageList)
		if err != nil {
			t.Errorf("Error when guessing package: %v", err)
			continue
		}
		if pkg.GetPkgName() != pkgName {
			t.Errorf("For %v, got %s, expected %s", service, pkg.GetPkgName(), pkgName)
		}
	}
}

// TestGuessPackageWithInvalidServices tests cases where expected fields of service objects are not fully populated.
func TestGuessPackageWithInvalidServices(t *testing.T) {
	packageList := []*usagepb.PackageInfo{
		{PkgName: proto.String("android"), Uid: proto.Int32(1)},
		{PkgName: proto.String("com.android.vending"), Uid: proto.Int32(2)},
		// Testing case of two packages sharing the same uid.
		{PkgName: proto.String("com.android.providers.contacts"), Uid: proto.Int32(3)},
		{PkgName: proto.String("com.android.providers.calendar"), Uid: proto.Int32(3)},
		{PkgName: proto.String("com.google.android.apps.inbox"), Uid: proto.Int32(4)},
		{PkgName: proto.String("com.google.android.apps.cloudprint"), Uid: proto.Int32(5)},
		{PkgName: proto.String("com.google.android.apps.docs.editors.docs"), Uid: proto.Int32(6)},
		{PkgName: proto.String("com.google.android.apps.docs.editors.sheets"), Uid: proto.Int32(7)},
		{PkgName: proto.String("com.google.android.apps.fitness"), Uid: proto.Int32(8)},
		{PkgName: proto.String("com.google.android.apps.plus"), Uid: proto.Int32(9)},
		{PkgName: proto.String("com.google.android.music"), Uid: proto.Int32(11)},
		// Testing case of two packages sharing the same uid.
		{PkgName: proto.String("com.google.android.gms"), Uid: proto.Int32(12)},
		{PkgName: proto.String("com.google.android.gsf"), Uid: proto.Int32(12)},
		{PkgName: proto.String("com.google.android.apps.docs"), Uid: proto.Int32(13)},
		{PkgName: proto.String("com.google.android.keep"), Uid: proto.Int32(14)},
		{PkgName: proto.String("com.google.android.talk"), Uid: proto.Int32(15)},
		{PkgName: proto.String("com.google.android.plus"), Uid: proto.Int32(16)},
		{PkgName: proto.String("com.google.android.googlequicksearchbox"), Uid: proto.Int32(17)},
		{PkgName: proto.String("com.google.android.deskclock"), Uid: proto.Int32(18)},
		{PkgName: proto.String("com.google.android.gm"), Uid: proto.Int32(19)},
	}

	serviceToPackageNames := map[service]string{
		// Test that UID matching works correctly for non-shared UIDs and empty service strings.
		service{service: "", uid: "14"}: "com.google.android.keep",
		service{uid: "4"}:               "com.google.android.apps.inbox",

		// Test that UID matching works correctly for non-shared UIDs and non-identifying service strings.
		service{service: "Naaa, what's up doc?", uid: "5"}: "com.google.android.apps.cloudprint",

		// Test both service and UID fields are empty.
		service{service: "", uid: ""}: "",
		service{}:                     "",

		// Test non-identifying service strings with no UID.
		service{service: "Dude, where's my UID?"}: "",

		// Test UIDs that are not in the package list
		service{service: "To infinity, and beyond!", uid: "123456789"}: "",
		service{uid: "27"}:                                             "",
	}

	for service, pkgName := range serviceToPackageNames {
		pkg, err := GuessPackage(service.service, service.uid, packageList)
		if err != nil {
			t.Errorf("Error when guessing package: %v", err)
			continue
		}
		if pkg.GetPkgName() != pkgName {
			t.Errorf("For %v, got %s, expected %s", service, pkg.GetPkgName(), pkgName)
		}
	}

	// Test invalid UID that will yield an error
	pkg, err := GuessPackage("Here's my number, so call me maybe", "123-456-7890", packageList)
	expErr := regexp.MustCompile(`error getting appID from string: .* parsing "123-456-7890": invalid syntax`)
	if err == nil {
		t.Errorf("Error not thrown with invalid unparsable UID")
	} else if !expErr.MatchString(err.Error()) {
		t.Errorf("Incorrect error. Got %s, want %s", err, expErr)
	}
	if pkg.GetPkgName() != "" {
		t.Errorf("Got %s, expected empty package name", pkg.GetPkgName())
	}
}

// TestGuessPackageWithLiveData is a test case using live data which is not being determined correctly somewhere in
// the pipeline. The assumption is that if the other tests pass, then this one should automatically pass.
func TestGuessPackageWithLiveData(t *testing.T) {
	// This device was running a build that did not have the change including uploading of UIDs.
	packageList := []*usagepb.PackageInfo{
		{PkgName: proto.String("android"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.gm"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.gm.exchange"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.gms"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.googlequicksearchbox"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.gsf"), Uid: proto.Int32(0)},
		{PkgName: proto.String("com.google.android.gsf.login"), Uid: proto.Int32(0)},
	}

	serviceToPackageNames := map[service]string{
		service{service: "com.google.android.gms.fitness/com.google/XXX@gmail.com", uid: "10007"}:        "com.google.android.gms",
		service{service: "com.google.android.gms.games/com.google/XXX@gmail.com", uid: "10007"}:          "com.google.android.gms",
		service{service: "com.google.android.gms.games/com.google/XXX@google.com", uid: "10007"}:         "com.google.android.gms",
		service{service: "com.google.android.gms.people/com.google/XXX@gmail.com", uid: "10007"}:         "com.google.android.gms",
		service{service: "com.google.android.gms.plus.action/com.google/XXX@google.com", uid: "10007"}:   "com.google.android.gms",
		service{service: "com.google.android.location.reporting/com.google/XXX@gmail.com", uid: "10007"}: "com.google.android.gms",
		service{service: "gmail-ls/com.google/XXX@google.com", uid: "10070"}:                             "com.google.android.gm",
		service{service: "gmail-ls/com.google/XXX@gmail.com", uid: "10070"}:                              "com.google.android.gm",
	}

	for service, pkgName := range serviceToPackageNames {
		pkg, err := GuessPackage(service.service, service.uid, packageList)
		if err != nil {
			t.Errorf("Error when guessing package: %v", err)
			continue
		}
		if pkg.GetPkgName() != pkgName {
			t.Errorf("For %v, got %s, expected %s", service, pkg.GetPkgName(), pkgName)
		}
	}
}

// TestExtractAppsFromAppOpsDump tests that we get all the package info found in the apps ops service dump.
func TestExtractAppsFromAppOpsDump(t *testing.T) {
	// The spaces at the beginning of the input lines are found in actual bug reports so
	// they're included here to make sure they don't cause a problem.
	input := strings.Join([]string{
		// Make sure these lines are skipped
		"DUMP OF SERVICE android.security.keystore:",
		// This line doesn't appear in the keystore dump, but is here to test that it gets skipped
		"Package evil.fake.package",
		"-------------------------------------------------------------------------------",
		// This is where parsing should start
		"DUMP OF SERVICE appops:",
		// Make sure these don't break parsing
		"Current AppOps Service state:",
		"  Clients:",
		"    android.os.Binder@2d88a7f2:",
		"      ClientState{mAppToken=android.os.Binder@2d88a7f2, local}",
		// Test shared int uid
		"  Uid 1000:",
		"    Package com.android.settings:",
		// Make sure these intermediate lines don't affect parsing.
		"      COARSE_LOCATION: mode=0; duration=0",
		"    Package android:",
		"      VIBRATE: mode=0; time=+39s500ms ago; duration=+59ms",
		// Test singular int uid
		"  Uid 1013:",
		"    Package media:",
		// Test singular 'abbreviated' uid
		"  Uid u0a2:",
		"    Package com.android.providers.calendar:",
		// Test shared 'abbreviated' uid'
		"  Uid u0a12:",
		"    Package com.google.android.gsf:",
		"      WAKE_LOCK: mode=0; time=+23m48s927ms ago; duration=+39ms",
		"    Package com.google.android.syncadapters.contacts:",
		"    Package com.google.android.gms:",
		"DUMP OF SERVICE next.service:",
		// We've exited the app ops dump so this should be skipped
		"Package one.line.too.late:",
	}, "\n")

	want := map[string]*usagepb.PackageInfo{
		"com.android.settings": {
			PkgName: proto.String("com.android.settings"),
			Uid:     proto.Int32(1000),
		},
		"android": {
			PkgName: proto.String("android"),
			Uid:     proto.Int32(1000),
		},
		"media": {
			PkgName: proto.String("media"),
			Uid:     proto.Int32(1013),
		},
		"com.android.providers.calendar": {
			PkgName: proto.String("com.android.providers.calendar"),
			Uid:     proto.Int32(10002),
		},
		"com.google.android.gsf": {
			PkgName: proto.String("com.google.android.gsf"),
			Uid:     proto.Int32(10012),
		},
		"com.google.android.syncadapters.contacts": {
			PkgName: proto.String("com.google.android.syncadapters.contacts"),
			Uid:     proto.Int32(10012),
		},
		"com.google.android.gms": {
			PkgName: proto.String("com.google.android.gms"),
			Uid:     proto.Int32(10012),
		},
	}

	out, errs := extractAppsFromAppOpsDump(input)
	if len(errs) > 0 {
		t.Errorf("parsing failed in %v", errs)
	}
	if len(out) != len(want) {
		t.Fatalf("Parsed unexepected number of packages. Got %d, want %d", len(out), len(want))
	}
	for k, v := range want {
		p, ok := out[k]
		if !ok {
			t.Errorf("Did not parse expected package: %s", k)
			continue
		}
		if !reflect.DeepEqual(v, p) {
			t.Errorf("Parsed package '%s' not correct.\n  got %v\n  want %v", k, p, v)
		}
	}
}

// TestExtractAppsFromPackageDump tests that we get all the package info found in the package service dump.
func TestExtractAppsFromPackageDump(t *testing.T) {
	// The spaces at the beginning of the input lines are found in actual bug reports so
	// they're included here to make sure they don't cause a problem.
	input := strings.Join([]string{
		// Make sure these lines are skipped
		"DUMP OF SERVICE android.security.keystore:",
		// This line doesn't appear in the keystore dump, but is here to test that it gets skipped
		"Package evil.fake.package",
		"-------------------------------------------------------------------------------",
		// This is where parsing should start
		"DUMP OF SERVICE package:",
		// Make sure these don't break parsing
		"Database versions:",
		"  SDK Version: internal=22 external=22",
		"  DB Version: internal=3 external=3",
		"  [com.android.sdm.plugins.dcmo]",
		// Expected line in the service dump
		"Packages:",
		// Test single uid and that all fields are populated
		"  Package [com.google.android.youtube] (1cce8bc):",
		"    userId=10089 gids=[3003, 1028, 1015]",
		"    pkg=Package{259e0c2a com.google.android.youtube}",
		"    codePath=/data/app/com.google.android.youtube-1",
		"    versionCode=60013301 targetSdk=21",
		"    versionName=6.0.13",
		"    firstInstallTime=2014-12-05 14:23:12",
		"    lastUpdateTime=2014-12-10 21:46:43",
		// Test applications with shared UID
		"  Package [com.google.android.gms] (24f5913f):",
		"    userId=10012 gids=[]",
		"    sharedUser=SharedUserSetting{2e98f1d5 com.google.uid.shared/10012}",
		"    pkg=Package{1cd5fca7 com.google.android.gms}",
		"    versionCode=6759430 targetSdk=21",
		"    versionName=6.7.59 (1671217-430)",
		"    applicationInfo=ApplicationInfo{55fd874 com.google.android.gms}",
		"    timeStamp=2015-01-09 08:30:14",
		"  Package [com.google.android.gsf] (248a3a0c):",
		"    userId=10012 gids=[]",
		"    sharedUser=SharedUserSetting{2e98f1d5 com.google.uid.shared/10012}",
		"    pkg=Package{114b2cfd com.google.android.gsf}",
		"    versionCode=22 targetSdk=22",
		"    versionName=LollipopMR1-1629941",
		// Test package that doesn't include "gids" in the userId line
		"  Package [com.google.android.apps.photos] (784178f):",
		"    userId=10070",
		"    pkg=Package{c1660f0 com.google.android.apps.photos}",
		"    versionCode=40112 targetSdk=21",
		"    versionName=1.1.1.9",
		"    firstInstallTime=2015-06-05 14:21:22",
		"    lastUpdateTime=2015-06-25 10:11:29",
		// Test renamed package (renamed to com.android.packageinstaller)
		"Package [com.google.android.packageinstaller] (33f4931):",
		"    compat name=com.android.packageinstaller",
		"    userId=10077",
		"    pkg=Package{7254816 com.android.packageinstaller}",
		"    versionCode=23 targetSdk=23",
		"    versionName=6.0-2256973",
		"    timeStamp=2015-09-15 18:26:51",
		"    firstInstallTime=2015-07-06 12:04:19",
		"    lastUpdateTime=2015-09-15 18:26:51",
		"Renamed packages:",
		"  com.google.android.packageinstaller,com.android.packageinstaller",
		// It appears system packages are only hidden and listed in this category when they
		// are updated with newer versions. Disabled applications do not show up in this section.
		"Hidden system packages:",
		// This is hidden and should therefore not override the more recent package listed above.
		"Package [com.google.android.youtube] (1ff2e9b6):",
		" userId=10089 gids=[]",
		"pkg=Package{166726b7 com.google.android.youtube}",
		"codePath=/system/app/YouTube",
		"versionCode=51604100 targetSdk=19",
		"versionName=5.16.4",
		"DUMP OF SERVICE next.service:",
		// We've exited the package dump so this should be skipped
		"  Package [one.line.too.late] (248a3a0c):",
		"    userId=10012 gids=[]",
	}, "\n")

	want := map[string]*usagepb.PackageInfo{
		"com.google.android.youtube": {
			PkgName:          proto.String("com.google.android.youtube"),
			VersionCode:      proto.Int32(60013301),
			VersionName:      proto.String("6.0.13"),
			FirstInstallTime: proto.Int64(1417789392000),
			LastUpdateTime:   proto.Int64(1418248003000),
			Uid:              proto.Int32(10089),
		},
		"com.google.android.gms": {
			PkgName:      proto.String("com.google.android.gms"),
			VersionCode:  proto.Int32(6759430),
			VersionName:  proto.String("6.7.59"),
			Uid:          proto.Int32(10012),
			SharedUserId: proto.String("com.google.uid.shared"),
		},
		"com.google.android.gsf": {
			PkgName:      proto.String("com.google.android.gsf"),
			VersionCode:  proto.Int32(22),
			VersionName:  proto.String("LollipopMR1-1629941"),
			Uid:          proto.Int32(10012),
			SharedUserId: proto.String("com.google.uid.shared"),
		},
		"com.google.android.apps.photos": {
			PkgName:          proto.String("com.google.android.apps.photos"),
			VersionCode:      proto.Int32(40112),
			VersionName:      proto.String("1.1.1.9"),
			FirstInstallTime: proto.Int64(1433514082000),
			LastUpdateTime:   proto.Int64(1435227089000),
			Uid:              proto.Int32(10070),
		},
		"com.android.packageinstaller": {
			PkgName:          proto.String("com.android.packageinstaller"),
			VersionCode:      proto.Int32(23),
			VersionName:      proto.String("6.0-2256973"),
			FirstInstallTime: proto.Int64(1436184259000),
			LastUpdateTime:   proto.Int64(1442341611000),
			Uid:              proto.Int32(10077),
		},
	}

	out, errs := extractAppsFromPackageDump(input)
	if len(errs) > 0 {
		t.Errorf("parsing failed in %v", errs)
	}
	if len(out) != len(want) {
		t.Fatalf("Parsed unexepected number of packages. Got %d, want %d", len(out), len(want))
	}
	for k, v := range want {
		p, ok := out[k]
		if !ok {
			t.Errorf("Did not parse expected package: %s", k)
			continue
		}
		if !reflect.DeepEqual(v, p) {
			t.Errorf("Parsed package '%s' not correct.\n  got %v\n  want %v", k, p, v)
		}
	}
}

// TestExtractAppsFromBugReport tests that we get all the desired package info from a bug report.
func TestExtractAppsFromBugReport(t *testing.T) {
	input := strings.Join([]string{
		// Make sure these lines are skipped
		"DUMP OF SERVICE android.security.keystore:",
		// This line doesn't appear in the keystore dump, but is here to test that it gets skipped
		"Package evil.fake.package",
		"-------------------------------------------------------------------------------",
		// This is where parsing should start
		"DUMP OF SERVICE appops:",
		// Make sure these don't break parsing
		"Current AppOps Service state:",
		"  Clients:",
		"    android.os.Binder@2d88a7f2:",
		"      ClientState{mAppToken=android.os.Binder@2d88a7f2, local}",
		// Test shared int uid
		"  Uid 1000:",
		"    Package com.android.settings:",
		// Make sure these intermediate lines don't affect parsing.
		"      COARSE_LOCATION: mode=0; duration=0",
		"    Package android:",
		"      VIBRATE: mode=0; time=+39s500ms ago; duration=+59ms",
		// No corresponding info from the package dump
		"  Uid 1013:",
		"    Package media:",
		// Test singular 'abbreviated' uid
		"  Uid u0a2:",
		"    Package com.android.providers.calendar:",
		// Test shared 'abbreviated' uid'
		"  Uid u0a12:",
		"    Package com.google.android.gsf:",
		"      WAKE_LOCK: mode=0; time=+23m48s927ms ago; duration=+39ms",
		"    Package com.google.android.syncadapters.contacts:",
		// Test that this gets combined with the info from the package dump
		"    Package com.google.android.gms:",
		"DUMP OF SERVICE next.service:",
		// We've exited the app ops dump so this should be skipped
		"Package one.line.too.late:",
		"DUMP OF SERVICE package:",
		// Make sure these don't break parsing
		"Database versions:",
		"  SDK Version: internal=22 external=22",
		"  DB Version: internal=3 external=3",
		"  [com.android.sdm.plugins.dcmo]",
		// Expected line in the service dump
		"Packages:",
		// Test single uid and that all fields are populated
		// No corresponding info from the appops dump
		"  Package [com.google.android.youtube] (1cce8bc):",
		"    userId=10089 gids=[3003, 1028, 1015]",
		"    pkg=Package{259e0c2a com.google.android.youtube}",
		"    codePath=/data/app/com.google.android.youtube-1",
		"    versionCode=60013301 targetSdk=21",
		"    versionName=6.0.13",
		"    firstInstallTime=2014-12-05 14:23:12",
		"    lastUpdateTime=2014-12-10 21:46:43",
		// Test applications with shared UID
		"  Package [com.google.android.gms] (24f5913f):",
		"    userId=10012 gids=[]",
		"    sharedUser=SharedUserSetting{2e98f1d5 com.google.uid.shared/10012}",
		"    pkg=Package{1cd5fca7 com.google.android.gms}",
		"    versionCode=6759430 targetSdk=21",
		"    versionName=6.7.59 (1671217-430)",
		"    applicationInfo=ApplicationInfo{55fd874 com.google.android.gms}",
		"    timeStamp=2015-01-09 08:30:14",
		// It appears system packages are only hidden and listed in this category when they
		// are updated with newer versions. Disabled applications do not show up in this section.
		"Hidden system packages:",
		// This is hidden and should therefore not override the more recent package listed above.
		"Package [com.google.android.youtube] (1ff2e9b6):",
		" userId=10089 gids=[]",
		"pkg=Package{166726b7 com.google.android.youtube}",
		"codePath=/system/app/YouTube",
		"versionCode=51604100 targetSdk=19",
		"versionName=5.16.4",
		"DUMP OF SERVICE next.service:",
		// We've exited the package dump so this should be skipped
		"  Package [two.lines.too.late] (248a3a0c):",
		"    userId=12345 gids=[]",
	}, "\n")

	want := []*usagepb.PackageInfo{
		{
			PkgName:          proto.String("com.google.android.youtube"),
			VersionCode:      proto.Int32(60013301),
			VersionName:      proto.String("6.0.13"),
			FirstInstallTime: proto.Int64(1417789392000),
			LastUpdateTime:   proto.Int64(1418248003000),
			Uid:              proto.Int32(10089),
		},
		{
			PkgName: proto.String("com.android.settings"),
			Uid:     proto.Int32(1000),
		},
		{
			PkgName: proto.String("android"),
			Uid:     proto.Int32(1000),
		},
		{
			PkgName: proto.String("media"),
			Uid:     proto.Int32(1013),
		},
		{
			PkgName: proto.String("com.android.providers.calendar"),
			Uid:     proto.Int32(10002),
		},
		{
			PkgName: proto.String("com.google.android.gsf"),
			Uid:     proto.Int32(10012),
		},
		{
			PkgName: proto.String("com.google.android.syncadapters.contacts"),
			Uid:     proto.Int32(10012),
		},
		// Data primarily comes from package dump
		{
			PkgName:      proto.String("com.google.android.gms"),
			VersionCode:  proto.Int32(6759430),
			VersionName:  proto.String("6.7.59"),
			Uid:          proto.Int32(10012),
			SharedUserId: proto.String("com.google.uid.shared"),
		},
	}

	out, errs := ExtractAppsFromBugReport(input)
	if len(errs) > 0 {
		t.Errorf("parsing failed in %v", errs)
	}
	if len(out) != len(want) {
		t.Fatalf("Parsed unexpected number of packages. Got %d, want %d", len(out), len(want))
	}
	if diffs := comparePackageList(out, want); len(diffs) > 0 {
		t.Errorf("Unexpected package output:\n%v", diffs)
	}
}

// comparePackageList returns the items in X that are not in Y, or that differ from what's in Y.
func comparePackageList(got, want []*usagepb.PackageInfo) []string {
	var diffs []string
	wMap := make(map[string]*usagepb.PackageInfo)
	gMap := make(map[string]*usagepb.PackageInfo)

	for _, g := range got {
		gMap[g.GetPkgName()] = g
	}

	for _, w := range want {
		wMap[w.GetPkgName()] = w
	}

	for k, w := range wMap {
		if g := gMap[k]; g == nil {
			diffs = append(diffs, fmt.Sprintf("Didn't find expected package: %v", w))
		} else if !reflect.DeepEqual(g, w) {
			diffs = append(diffs, fmt.Sprintf("Parsed package '%s' not correct.\n  got %v\n  want %v", k, g, w))
		}
		delete(gMap, k)
		delete(wMap, k)
	}
	for _, g := range gMap {
		diffs = append(diffs, fmt.Sprintf("Parsed unexpected package: %v", g))
	}

	return diffs
}
