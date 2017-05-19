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

// Package dmesg parses kernel dmesg log events and outputs CSV entries for those events.
package dmesg

import (
	"bytes"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/battery-historian/bugreportutils"
	"github.com/google/battery-historian/csv"
	"github.com/google/battery-historian/historianutils"
)

var (
	// entryRE is a regular expression that matches the common prefix for events in the dmesg log.
	// e.g. <6>[64525.117426] lowmemorykiller: Killing 'e.process.gapps' (32546), adj 906,
	entryRE = regexp.MustCompile(`^` + `<\d+>` + `\s*\[\s*` + `(?P<secondsSinceBoot>[^.]+)` + `[.]` + `(?P<remainder>\d+)` + `\s*\]\s*` + `(?P<details>.*)`)

	// timeRE is a regular expression that matches UTC timestamps printed with suspend exit and
	// entry lines. These allow mapping from "since boot" time milliseconds to unix milliseconds.
	// <6>[64524.124339] PM: suspend exit 2016-02-29 19:34:06.906699640 UTC
	timeRE = regexp.MustCompile(`PM: suspend ` + `(?P<transition>(exit|entry))` + `\s+` + `(?P<timeStamp>[\d-\s:]+)` + `[.]` + `(?P<remainder>\d+)` + `\s+UTC`)
)

// section is the expected section heading for the kernel dmesg log.
const section = "KERNEL LOG (dmesg)"

// Data stores the CSV and first seen event start time parsed from the kernel dmesg log.
type Data struct {
	CSV     string
	StartMs int64
	Errs    []error
}

// secsToMs converts the given seconds and fraction of a second into milliseconds.
// e.g. "64524" and "124339" = 64524.124 (ms)
func secsToMs(secs, remainder string) (int64, error) {
	parsed, err := strconv.ParseInt(secs, 10, 64)
	if err != nil {
		return 0, err
	}
	ms, err := bugreportutils.SecFractionAsMs(remainder)
	if err != nil {
		return 0, err
	}
	return (parsed * 1000) + ms, nil
}

// bootToUnixMs converts a kernel "since boot" time milliseconds time to unix milliseconds
// using the given time mapping.
// e.g. bootMs : 24450470
//      timeMapping: {sinceBootMs: 24448456, unixMs: 1440725565111}
//      would return 1440725567125
// If the time mapping is not populated, this will just return the original "since boot" time.
func bootToUnixMs(bootMs int64, tm timeMapping) int64 {
	if tm.unixMs == 0 {
		return bootMs
	}
	return tm.unixMs + bootMs - tm.sinceBootMs
}

// timeMapping holds a mapping for milliseconds since boot to unix milliseconds.
type timeMapping struct {
	sinceBootMs, unixMs int64
}

// Parse writes a CSV entry for each line matching activity manager proc start and died, ANR and low memory events.
func Parse(f string) Data {
	var inSection, inSuspend bool
	// Track the first seen time in the log, and most recent bootMs-unixMs mapping.
	// We need to use the most recent suspend entry mapping as the "since boot" times
	// might not include time in suspend.
	var first, cur timeMapping

	buf := new(bytes.Buffer)
	csvState := csv.NewState(buf, true)

	var pending []csv.Entry
	var errs []error
	for _, line := range strings.Split(f, "\n") {
		if m, result := historianutils.SubexpNames(bugreportutils.BugReportSectionRE, line); m {
			if strings.TrimSpace(result["section"]) == section {
				inSection = true
				continue
			} else if inSection {
				// Just exited the kernel section.
				break
			}
			continue
		}
		m, result := historianutils.SubexpNames(entryRE, line)
		if !m {
			continue
		}

		bootMs, err := secsToMs(result["secondsSinceBoot"], result["remainder"])
		if err != nil {
			errs = append(errs, err)
			continue
		}
		// Store the time of the first seen event. We won't have the unix timestamp
		// until we encounter a suspend entry / exit line.
		if first.sinceBootMs == 0 {
			first.sinceBootMs = bootMs
		}
		details := strings.TrimSpace(result["details"])

		if m, result := historianutils.SubexpNames(timeRE, details); m {
			unixMs, err := bugreportutils.TimeStampToMs(result["timeStamp"], result["remainder"], time.UTC) // Kernel times are always reported in UTC.
			if err != nil {
				errs = append(errs, err)
				continue
			}
			inSuspend = result["transition"] == "entry"
			cur.unixMs = unixMs
			cur.sinceBootMs = bootMs

			if first.unixMs == 0 {
				// This may be inaccurate if the first seen timestamp is a suspend exit,
				// as suspend time may not be included in the "since boot" timestamps.
				// In that case this time will be slightly later than it should be, but
				// it's the best estimate we have.
				first.unixMs = bootToUnixMs(first.sinceBootMs, cur)
				// There may be events that occurred before the first suspend reported timestamp.
				// We should only output them if they occurred before a suspend entry event
				// (i.e. was not in suspend).
				// Output all stored events.
				for _, p := range pending {
					if inSuspend { // Just entered suspend, so was not in suspend before.
						// Convert the milliseconds since boot to unix milliseconds.
						p.Start = bootToUnixMs(p.Start, cur)
						csvState.PrintInstantEvent(p)
					} else {
						errs = append(errs, fmt.Errorf("%s event during suspend", p.Desc))
					}
				}
			}
			pending = nil
			continue
		}
		if inSuspend {
			continue
		}
		e := parseEvent(cur, bootMs, details)
		if e.Desc == "" {
			continue
		}
		if cur.unixMs == 0 {
			// Haven't encountered a UTC timestamp yet. Store the events to output later.
			pending = append(pending, e)
		} else {
			csvState.PrintInstantEvent(e)
		}
	}
	return Data{
		StartMs: first.unixMs,
		CSV:     buf.String(),
		Errs:    errs,
	}
}

func parseEvent(curMapping timeMapping, bootMs int64, details string) csv.Entry {
	if strings.HasPrefix(details, "lowmemorykiller:") {
		return csv.Entry{
			Desc:  "Low memory killer",
			Start: bootToUnixMs(bootMs, curMapping), // If we haven't seen any UTC timestamps yet, this will just be the boot time ms.
			Type:  "service",
			Value: strings.TrimSpace(strings.TrimPrefix(details, "lowmemorykiller:")),
		}
	}
	if strings.Contains(details, "avc: denied") {
		return csv.Entry{
			Desc:  "SELinux denial",
			Start: bootToUnixMs(bootMs, curMapping),
			Type:  "service",
			Value: details,
		}
	}
	return csv.Entry{}
}
