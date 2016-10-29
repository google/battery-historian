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

// Package wearable parses WearableService service dumps, and outputs CSV entries for integration
// with Battery Historian.
package wearable

import (
	"bytes"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/battery-historian/bugreportutils"
	"github.com/google/battery-historian/csv"
	"github.com/google/battery-historian/historianutils"
)

var rpcRE = regexp.MustCompile(
	`^(?P<timeStamp>[\d-]+\s\d\d:\d\d:\d\d)` +
		`[\.\:]` +
		`(?P<remainder>\d+)` +
		`(?P<timeZone>[+-]?\d+)?` +
		`:\s` +
		`(?P<action>[\w\*]+)` +
		`\s*\[.*\]\s` +
		`(?P<source>\w+)` +
		`\s(->\s(?P<destination>\w+)\s\(via\s+(?P<via>\w+)\)\s)?` +
		`(?P<detail>.+)$`)
var transportRE = regexp.MustCompile(
	`^\w+:\s` +
		`(?P<timeStamp>[\d-]+\s\d\d:\d\d:\d\d)` +
		`,\s` +
		`(?P<detail>writes/reads\s\(\d+/\d+\),\sbytes\s\(\d+/\d+\))` +
		`,\sduration\s` +
		`(?P<duration>[\d\:]+)` +
		`(,\s(?P<reason>.*))?$`)
var serviceDumpSectionRE = regexp.MustCompile(`^SERVICE\s(?P<service>\S+)\s\w+\spid=\d+$`)

// Parse returns whether the format was valid, and writes a CSV entry for each line in
// WearableService dump.
func Parse(f string, loc string) (bool, string, []error) {
	var buf bytes.Buffer
	csvState := csv.NewState(&buf, true)
	timeZone, err := time.LoadLocation(loc)
	var errs []error
	if err != nil {
		return false, "", []error{err}
	}
	matched := false

	f = extractWearableServiceDump(f)
	for _, l := range strings.Split(f, "\n") {
		if matches, result := historianutils.SubexpNames(rpcRE, l); matches {
			timestamp, err := bugreportutils.TimeStampToMs(result["timeStamp"], result["remainder"], timeZone)
			if err != nil {
				errs = append(errs, err)
				continue
			}

			matched = true
			a := result["action"]
			s := result["source"]
			d := result["destination"]
			v := result["via"]
			dt := result["detail"]

			eventType := "direct"
			if len(a) < 1 {
				errs = append(errs, errors.New("Invalid action string."))
				continue
			}
			if a[len(a)-1] == '*' {
				eventType = "exception"
			} else if v == "cloud" {
				eventType = "cloud"
			}

			csvState.PrintInstantEvent(csv.Entry{
				Desc:  "Wearable RPC",
				Start: timestamp,
				Type:  eventType,
				Value: strings.Replace(fmt.Sprintf("%v: %v from %v to %v via %v %v",
					eventType, a, s, d, v, dt), ",", " ", -1),
			})
		}

		if matches, result := historianutils.SubexpNames(transportRE, l); matches {
			timestamp, err := bugreportutils.TimeStampToMs(result["timeStamp"], "000", timeZone)
			if err != nil {
				errs = append(errs, err)
				continue
			}

			duration, err := parseDurationMs(result["duration"])
			if err != nil {
				errs = append(errs, err)
				continue
			}

			matched = true
			dt := result["detail"]
			rs := result["reason"]

			csvState.Print("Wearable Transport", "transport", timestamp, timestamp+duration,
				strings.Replace(fmt.Sprintf("%v, %v", dt, rs), ",", " ", -1), "")
		}
	}
	return matched, buf.String(), errs
}

func extractWearableServiceDump(input string) string {
	inWearableSection := false
	var wearable []string

Loop:
	for _, line := range strings.Split(input, "\n") {
		line = strings.TrimSpace(line)
		if m, result := historianutils.SubexpNames(serviceDumpSectionRE, line); m {
			switch in := strings.Contains(result["service"],
				"com.google.android.gms/.wearable.service.WearableService"); {
			case inWearableSection && !in: // Just exited the section
				break Loop
			case in:
				inWearableSection = true
				continue Loop
			default: // Random section
				continue Loop
			}
		}
		if inWearableSection {
			wearable = append(wearable, line)
		}
	}

	return strings.Join(wearable, "\n")
}

func parseDurationMs(duration string) (int64, error) {
	var returnValue int64
	for _, value := range strings.Split(duration, ":") {
		returnValue *= 60
		value, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return 0, err
		}
		returnValue += value
	}
	return returnValue * 1000, nil
}
