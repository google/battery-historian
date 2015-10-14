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

package main

import (
	"flag"
	"fmt"
	"io/ioutil"
	"log"
	"time"

	"github.com/golang/protobuf/proto"

	"github.com/google/battery-historian/checkinparse"
	"github.com/google/battery-historian/checkinutil"
	"github.com/google/battery-historian/packageutils"
	sessionpb "github.com/google/battery-historian/pb/session_proto"
)

var (
	inputFile = flag.String("input", "", "bugreport to be read")
)

func min(x, y int) int {
	if x < y {
		return x
	}
	return y
}

func main() {
	flag.Parse()

	c, err := ioutil.ReadFile(*inputFile)
	if err != nil {
		log.Fatalf("Cannot open the file %s: %v", *inputFile, err)
	}

	br := string(c)
	s := &sessionpb.Checkin{Checkin: proto.String(br)}
	pkgs, errs := packageutils.ExtractAppsFromBugReport(br)
	if len(errs) > 0 {
		log.Fatalf("Errors encountered when getting package list: %v", errs)
	}

	var ctr checkinutil.IntCounter
	stats, warns, errs := checkinparse.ParseBatteryStats(&ctr, checkinparse.CreateCheckinReport(s), pkgs)
	if len(warns) > 0 {
		log.Printf("Encountered unexpected warnings: %v\n", warns)
	}
	if len(errs) > 0 {
		log.Fatalf("Could not parse battery stats: %v\n", errs)
	}
	fmt.Println("\n################\n")
	fmt.Println("Partial Wakelocks")
	fmt.Println("################\n")
	var pwl []*checkinparse.WakelockInfo
	for _, app := range stats.App {
		for _, pw := range app.Wakelock {
			if pw.GetPartialTimeMsec() > 0 {
				pwl = append(pwl,
					&checkinparse.WakelockInfo{
						Name:     fmt.Sprintf("%s : %s", app.GetName(), pw.GetName()),
						UID:      app.GetUid(),
						Duration: time.Duration(pw.GetPartialTimeMsec()) * time.Millisecond,
					})
			}
		}

	}
	checkinparse.SortByTime(pwl)
	for _, pw := range pwl[:min(5, len(pwl))] {
		fmt.Printf("%s (uid=%d) %s\n", pw.Duration, pw.UID, pw.Name)
	}

	fmt.Println("\n################")
	fmt.Println("Kernel Wakelocks")
	fmt.Println("################\n")
	var kwl []*checkinparse.WakelockInfo
	for _, kw := range stats.System.KernelWakelock {
		if kw.GetName() != "PowerManagerService.WakeLocks" && kw.GetTimeMsec() > 0 {
			kwl = append(kwl, &checkinparse.WakelockInfo{
				Name:     kw.GetName(),
				Duration: time.Duration(kw.GetTimeMsec()) * time.Millisecond,
			})
		}
	}
	checkinparse.SortByTime(kwl)
	for _, kw := range kwl[:min(5, len(kwl))] {
		fmt.Printf("%s %s\n", kw.Duration, kw.Name)
	}

	data, err := proto.Marshal(stats)
	if err != nil {
		log.Fatalf("Error from proto.Marshal: %v", err)
	}
	ioutil.WriteFile("checkin.proto", data, 0600)
}
