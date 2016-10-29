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

// local_checkin_delta parses checkin reports into protos and computes the difference between the two.
//
// Example Usage:
//  ./local_checkin_delta -input=checkin_new.txt,checkin_old.txt
package main

import (
	"flag"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/golang/protobuf/proto"
	"github.com/google/battery-historian/bugreportutils"
	"github.com/google/battery-historian/checkindelta"
	"github.com/google/battery-historian/checkinparse"
	"github.com/google/battery-historian/checkinutil"
	bspb "github.com/google/battery-historian/pb/batterystats_proto"
	sessionpb "github.com/google/battery-historian/pb/session_proto"
)

var (
	inputFiles         = flag.String("input", "", "Comma-separated list of input checkin reports")
	deltaFileName      = flag.String("deltaOut", "deltaout", "prefix for delta proto")
	compareFileName    = flag.String("compareOut", "compareout", "prefix for compare proto")
	parseFileName      = flag.String("raw", "parse", "prefix for raw proto")
	normalizedFileName = flag.String("normalized", "normalized", "prefix for normalized raw proto")
	doDelta            = flag.Bool("delta", false, "flag to perform a diff operation between the two files")
	doComp             = flag.Bool("comp", true, "flag to perform a compare(normalized diff) operation between the two files")
)

func min(x, y int) int {
	if x < y {
		return x
	}
	return y
}

func printResults(outputProto *bspb.BatteryStats, fileName string, dir string) {
	if outputProto == nil {
		fmt.Println("Inputs were identical.")
		return
	}

	fmt.Printf("\n################\n")
	fmt.Printf("Partial Wakelocks\n")
	fmt.Printf("################\n\n")
	var pwl []*checkinparse.WakelockInfo
	for _, app := range outputProto.App {
		for _, pw := range app.Wakelock {
			pwl = append(pwl, &checkinparse.WakelockInfo{
				Name:     fmt.Sprintf("%s : %s", app.GetName(), pw.GetName()),
				UID:      app.GetUid(),
				Duration: time.Duration(pw.GetPartialTimeMsec()) * time.Millisecond,
			})
		}
	}

	checkinparse.SortByAbsTime(pwl)
	for _, pw := range pwl[:min(10, len(pwl))] {
		fmt.Printf("%s (File1 uid=%d) %s\n", pw.Duration, pw.UID, pw.Name)
	}

	fmt.Printf("\n################\n")
	fmt.Printf("Kernel Wakelocks\n")
	fmt.Printf("################\n\n")
	var kwl []*checkinparse.WakelockInfo
	for _, kw := range outputProto.GetSystem().KernelWakelock {
		if kw.GetName() != "PowerManagerService.WakeLocks" {
			kwl = append(kwl, &checkinparse.WakelockInfo{
				Name:     kw.GetName(),
				Duration: time.Duration(kw.GetTimeMsec()) * time.Millisecond,
			})
		}
	}
	checkinparse.SortByAbsTime(kwl)
	for _, kw := range kwl[:min(10, len(kwl))] {
		fmt.Printf("%s %s\n", kw.Duration, kw.Name)
	}

	data, err := proto.Marshal(outputProto)
	if err != nil {
		log.Fatalf("Cannot marshal output proto: %v", err)
	}
	ioutil.WriteFile(fileName+".proto", data, 0600)
	ioutil.WriteFile(dir+"/"+fileName+".proto", data, 0600)
}

func main() {
	flag.Parse()

	inputs := strings.Split(*inputFiles, ",")
	if len(inputs) != 2 {
		log.Fatal("wrong input file number, expect 2, got ", len(inputs))
	}

	dir, err := filepath.Abs(filepath.Dir(os.Args[0]))
	if err != nil {
		log.Fatal(err)
	}
	stats := make([]*bspb.BatteryStats, 2)
	normalizedStats := make([]*bspb.BatteryStats, 2)

	var errs []error
	var warns []string
	var ctr checkinutil.IntCounter
	for i, f := range inputs {
		c, err := ioutil.ReadFile(f)
		if err != nil {
			log.Fatalf("Cannot open the file %s: %v", f, err)
		}
		br, fname, err := bugreportutils.ExtractBugReport(f, c)
		if err != nil {
			log.Fatalf("Error getting file contents: %v", err)
		}
		fmt.Printf("** File #%d: %s\n", i, fname)
		bs := bugreportutils.ExtractBatterystatsCheckin(br)
		if strings.Contains(bs, "Exception occurred while dumping") {
			log.Fatalf("Exception found in battery dump.")
		}
		m, err := bugreportutils.ParseMetaInfo(br)
		if err != nil {
			log.Fatalf("Unable to get meta info: %v", err)
		}
		s := &sessionpb.Checkin{
			Checkin:          proto.String(bs),
			BuildFingerprint: proto.String(m.BuildFingerprint),
		}

		stats[i], warns, errs = checkinparse.ParseBatteryStats(&ctr, checkinparse.CreateBatteryReport(s), nil)

		if len(errs) > 0 {
			log.Fatalf("Could not parse battery stats: %v", errs)
		}
		if len(warns) > 0 {
			fmt.Printf("Encountered unexpected warnings: %v\n", warns)
		}

		data, err := proto.Marshal(stats[i])
		if err != nil {
			log.Fatalf("Cannot marshal input proto: %v", err)
		}

		if *doDelta {
			ioutil.WriteFile(*parseFileName+strconv.Itoa(i)+".rawproto", data, 0600)
			ioutil.WriteFile(dir+"/"+*parseFileName+strconv.Itoa(i)+".rawproto", data, 0600)
		}

		if *doComp {
			n, err := checkindelta.NormalizeStats(stats[i])
			if err != nil {
				log.Fatalf("Failed to normalize: %v", err)
			}
			normalizedStats[i] = n

			normData, err := proto.Marshal(normalizedStats[i])
			if err != nil {
				log.Fatalf("Cannot marshal normalized input proto: %v", err)
			}
			ioutil.WriteFile(*normalizedFileName+strconv.Itoa(i)+".rawproto", normData, 0600)
			ioutil.WriteFile(dir+"/"+*normalizedFileName+strconv.Itoa(i)+".rawproto", normData, 0600)
		}
	}

	if *doComp {
		fmt.Printf("\n\nNormalized Delta Report (File1 - File2): \n\n")
		for i, f := range inputs {
			fmt.Printf("File %d: %v\n", i+1, f)
		}

		outputProto := checkindelta.ComputeDelta(normalizedStats[0], normalizedStats[1])
		if outputProto == nil {
			log.Fatalf("empty result")
		}
		printResults(outputProto, *compareFileName, dir)
	}
	if *doDelta {
		fmt.Printf("\n\nDelta Report(File1 - File2)- \n\n")
		for i, f := range inputs {
			fmt.Printf("File %d: %v\n", i+1, f)
		}
		outputProto := checkindelta.ComputeDelta(stats[0], stats[1])
		if outputProto == nil {
			log.Fatalf("empty result")
		}
		printResults(outputProto, *deltaFileName, dir)
	}
}
