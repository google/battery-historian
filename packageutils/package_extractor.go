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
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/golang/protobuf/proto"

	"github.com/google/battery-historian/historianutils"

	usagepb "github.com/google/battery-historian/pb/usagestats_proto"
)

// Time format that firstInstallTime and lastUpdateTime are in, using the constants defined in the Golang time package
const timeFormat = "2006-01-02 15:04:05"

var (
	// uidRE is a regular expression to match a uid line in the appops section (eg. 'Uid 1000:').
	uidRE = regexp.MustCompile(`^Uid\s+(?P<uid>\S+):`)

	// userIDRE is a regular expression to match a userId line in the package dump section (eg. 'userId=1000 gids=[3003]').
	userIDRE = regexp.MustCompile(`^userId=(?P<uid>\d+)(\s+gids.*)?`)

	// appOpsPackageRE is a regular expression to match a package line in the appops dump section (eg. 'Package android:')
	appOpsPackageRE = regexp.MustCompile(`Package\s+(?P<package>\S+):`)

	// packageDumpPackageRE is a regular expression to match a package line in the package dump section (eg. 'Package android:')
	packageDumpPackageRE = regexp.MustCompile(`Package\s+\[(?P<package>\S+)\]\s+\(.*`)

	// packageDumpCompatRE is a regular expression to match a compat name line in the package dump section (eg. 'compat name=')
	packageDumpCompatRE = regexp.MustCompile(`compat name=(?P<package>\S+)`)

	// packageDumpVersionCodeRE is a regular expression to match a version code line in the package dump section (eg. 'versionCode=94 targetSdk=19')
	packageDumpVersionCodeRE = regexp.MustCompile(`versionCode=(?P<versionCode>\d+)(\sminSdk=\S+)?\stargetSdk=\d+`)

	// packageDumpVersionNameRE is a regular expression to match a version name line in the package dump section (eg. 'versionName=4.0.3')
	packageDumpVersionNameRE = regexp.MustCompile(`versionName=(?P<versionName>\S+)`)

	// packageDumpSharedUserRE is a regular expression to match a SharedUser line in the package dump section (eg. 'sharedUser=SharedUserSetting{d4e2481 android.uid.bluetooth/1002}')
	packageDumpSharedUserRE = regexp.MustCompile(`sharedUser=SharedUserSetting{\S+\s+(?P<label>\S+)/(?P<uid>\d+)}`)

	// firstInstallTimeRE is a regular expression to match the firstInstallTime line in the package dump section (eg. 'firstInstallTime=2014-12-05 14:23:12')
	firstInstallTimeRE = regexp.MustCompile("firstInstallTime=(?P<time>.*)")

	// lastUpdateTimeRE is a regular expression to match the lastUpdateTime line in the package dump section (eg. 'lastUpdateTime=2014-12-05 18:23:12')
	lastUpdateTimeRE = regexp.MustCompile("lastUpdateTime=(?P<time>.*)")
)

// extractAppsFromAppOpsDump looks at the app ops service dump from a bug report
// and extracts package names and their UIDs from the dump. It returns a mapping of
// the package name to the PackageInfo object.
func extractAppsFromAppOpsDump(s string) (map[string]*usagepb.PackageInfo, []error) {
	pkgs := make(map[string]*usagepb.PackageInfo)
	var errs []error

	inAppOpsSection := false
	var curUID int32
	var err error

Loop:
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if m, result := historianutils.SubexpNames(historianutils.ServiceDumpRE, line); m {
			switch in := result["service"] == "appops"; {
			case inAppOpsSection && !in: // Just exited the App Ops section
				break Loop
			case in:
				inAppOpsSection = true
				continue
			default: // Random section
				continue
			}
		}
		if !inAppOpsSection {
			continue
		}
		if m, result := historianutils.SubexpNames(uidRE, line); m {
			curUID, err = AppIDFromString(result["uid"])
			if err != nil {
				errs = append(errs, err)
			}
		}
		if m, result := historianutils.SubexpNames(appOpsPackageRE, line); m {
			pkg := result["package"]
			pkgs[pkg] = &usagepb.PackageInfo{
				PkgName: proto.String(pkg),
				Uid:     proto.Int32(curUID),
			}
		}
	}

	return pkgs, errs
}

// extractAppsFromPackageDump looks at the package service dump from a bug report
// and extracts as much application info from the dump. It returns a mapping of
// the package name to the PackageInfo object.
func extractAppsFromPackageDump(s string) (map[string]*usagepb.PackageInfo, []error) {
	pkgs := make(map[string]*usagepb.PackageInfo)
	var errs []error

	var inPackageDumpSection, inCurrentSection bool
	var curPkg *usagepb.PackageInfo

Loop:
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if m, result := historianutils.SubexpNames(historianutils.ServiceDumpRE, line); m {
			switch in := result["service"] == "package"; {
			case inPackageDumpSection && !in: // Just exited package dump section
				break Loop
			case in:
				inPackageDumpSection = true
				continue
			default: // Random section
				continue
			}
		}
		if !inPackageDumpSection {
			continue
		}
		switch line {
		case "Packages:":
			inCurrentSection = true
			continue
		case "Hidden system packages:":
			inCurrentSection = false
			break Loop
		}
		if !inCurrentSection {
			continue
		}
		if m, result := historianutils.SubexpNames(packageDumpPackageRE, line); m {
			if curPkg != nil {
				pkgs[curPkg.GetPkgName()] = curPkg
			}
			curPkg = &usagepb.PackageInfo{
				PkgName: proto.String(result["package"]),
			}
		} else if m, result := historianutils.SubexpNames(packageDumpCompatRE, line); m {
			if curPkg == nil {
				errs = append(errs, errors.New("found compat line before package line"))
				continue
			}
			curPkg.PkgName = proto.String(result["package"])
		} else if m, result := historianutils.SubexpNames(userIDRE, line); m {
			if curPkg == nil {
				errs = append(errs, errors.New("found userId line before package line"))
				continue
			}
			uid, err := AppIDFromString(result["uid"])
			if err != nil {
				errs = append(errs, err)
			}
			curPkg.Uid = proto.Int32(uid)
		} else if m, result := historianutils.SubexpNames(packageDumpVersionCodeRE, line); m {
			if curPkg == nil {
				errs = append(errs, errors.New("found versionCode line before package line"))
				continue
			}
			vc, err := strconv.Atoi(result["versionCode"])
			if err != nil {
				errs = append(errs, fmt.Errorf("error getting version code from string: %v\n", err))
				continue
			}
			curPkg.VersionCode = proto.Int32(int32(vc))
		} else if m, result := historianutils.SubexpNames(packageDumpVersionNameRE, line); m {
			if curPkg == nil {
				errs = append(errs, errors.New("found versionName line before package line"))
				continue
			}
			curPkg.VersionName = proto.String(result["versionName"])
		} else if m, result := historianutils.SubexpNames(firstInstallTimeRE, line); m {
			if curPkg == nil {
				errs = append(errs, errors.New("found firstInstallTime line before package line"))
				continue
			}
			t, err := time.Parse(timeFormat, result["time"])
			if err != nil {
				errs = append(errs, err)
			}
			curPkg.FirstInstallTime = proto.Int64(t.UnixNano() / int64(time.Millisecond))
		} else if m, result := historianutils.SubexpNames(lastUpdateTimeRE, line); m {
			if curPkg == nil {
				errs = append(errs, errors.New("found lastUpdateTime line before package line"))
				continue
			}
			t, err := time.Parse(timeFormat, result["time"])
			if err != nil {
				errs = append(errs, err)
			}
			curPkg.LastUpdateTime = proto.Int64(t.UnixNano() / int64(time.Millisecond))
		} else if m, result := historianutils.SubexpNames(packageDumpSharedUserRE, line); m {
			if curPkg == nil {
				errs = append(errs, errors.New("found sharedUser line before package line"))
				continue
			}
			uid, err := AppIDFromString(result["uid"])
			if err != nil {
				errs = append(errs, err)
			}
			if curPkg.GetUid() != uid {
				errs = append(errs, errors.New("sharedUser uid is different from package uid"))
				continue
			}
			curPkg.SharedUserId = proto.String(result["label"])
		}
	}

	if curPkg != nil {
		pkgs[curPkg.GetPkgName()] = curPkg
	}

	return pkgs, errs
}

// ExtractAppsFromBugReport looks through a bug report and extracts as much application info
// as possible.
func ExtractAppsFromBugReport(s string) ([]*usagepb.PackageInfo, []error) {
	var pkgs []*usagepb.PackageInfo

	pdPkgs, pdErrs := extractAppsFromPackageDump(s)
	aoPkgs, aoErrs := extractAppsFromAppOpsDump(s)
	errs := append(aoErrs, pdErrs...)

	for name, pdPkg := range pdPkgs {
		// Favor info from package dump since we'll have more data from there.
		pkgs = append(pkgs, pdPkg)
		// Remove related data from appops dump to avoid listing a package twice.
		delete(aoPkgs, name)
	}
	for _, aoPkg := range aoPkgs {
		pkgs = append(pkgs, aoPkg)
	}
	return pkgs, errs
}
