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

// Package activity parses activity manager events in bugreport files and outputs CSV entries for those events.
package activity

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/battery-historian/bugreportutils"
	"github.com/google/battery-historian/csv"
	"github.com/google/battery-historian/historianutils"
	"github.com/google/battery-historian/packageutils"
	metricspb "github.com/google/battery-historian/pb/metrics_proto"
	usagepb "github.com/google/battery-historian/pb/usagestats_proto"
)

var (
	// logEntryRE is a regular expression that matches the common prefix to event log and logcat lines in the bug report.
	// The details are then matched with the various log event types below.
	// e.g. "11-19 11:29:07.341  2206  2933 I"
	logEntryRE = regexp.MustCompile(`^(?P<month>\d+)-(?P<day>\d+)` + `\s+` +
		`(?P<timeStamp>[^.]+)` + `[.]` + `(?P<remainder>\d+)` + `\s+` +
		`(?P<uid>\S+\s+)?` + `(?P<pid>\d+)` + `\s+\d+\s+\S+\s+` + `(?P<event>\S+)` + `\s*:` + `(?P<details>.*)`)

	// crashStartRE is a regular expression that matches the first line of a crash event.
	crashStartRE = regexp.MustCompile(`^FATAL\sEXCEPTION:\s+` + `(?P<source>.+)`)

	// crashProcessRE is a regular expression that matches the process information of a crash event.
	crashProcessRE = regexp.MustCompile(`^Process:\s(?P<process>\S+)` + `\s*,\s*` + `PID:\s(?P<pid>.+)`)

	// nativeCrashProcessRE is the regular expression that matches the process information of a native crash event.
	nativeCrashProcessRE = regexp.MustCompile(`name:\s+` + `(?P<thread>\S+)` + `\s+>>>\s+` + `(?P<process>\S+)` + `\s+<<<`)

	// choregrapherRE is the regular expression that matches choreographer skipped frames notifications.
	choreographerRE = regexp.MustCompile(`Skipped (?P<numFrames>\d+) frames!`)

	// gcPauseRE is the regular expression that matches ART garbage collection pauses.
	// e.g. "Explicit concurrent mark sweep GC freed 706(30KB) AllocSpace objects, 0(0B) LOS objects, 40% free, 16MB/26MB, paused 632us total 52.753ms"
	gcPauseRE = regexp.MustCompile(`(?P<type>(Background partial|Background sticky|Explicit))` + ` concurrent mark sweep GC.*paused\s+` + `(?P<pausedDur>[^\s]+)`)
)

const (
	// strictModePre matches the prefix of the first line of a StrictMode policy violation event.
	strictModePre = "StrictMode policy violation;"

	// nativeCrashStart is the expected first line of a native crash event.
	// https://source.android.com/devices/tech/debug/
	nativeCrashStart = "*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***"

	// procStartEvent is the string for matching application process start events in the bug report.
	procStartEvent = "am_proc_start"

	// procDiedEvent is the string for matching application process died events in the bug report.
	procDiedEvent = "am_proc_died"

	// anrEvent is the string for matching application not responding events in the bug report.
	anrEvent = "am_anr"

	// lowMemoryEvent is the string for matching low memory events in the bug report.
	lowMemoryEvent = "am_low_memory"

	// lowMemoryANRGroup is the group name for low memory and application not responding events.
	lowMemoryANRGroup = "AM Low Memory / ANR"

	// amProc is the CSV description for the Activity Manager Process related events.
	amProc = "Activity Manager Proc"

	// amWTFEvent is the string for matching am_wtf events in the bug report.
	amWTFEvent = "am_wtf"

	// crashes is the the CSV description of Crash events.
	crashes = "Crashes"

	// unknownTime is used when the start or end time of an event is unknown.
	// This is not zero as csv.AddEntryWithOpt ignores events with a zero time.
	unknownTime = -1

	// EventLogSection is the heading found in the log line before the start of the event log section.
	EventLogSection = "EVENT LOG"
	// SystemLogSection is the heading found in the log line before the start of the system log section.
	SystemLogSection = "SYSTEM LOG"
	// LastLogcatSection is the heading found in the log line before the start of the last logcat section.
	LastLogcatSection = "LAST LOGCAT"
)

// Log contains the CSV generated from the log as well as the start time of the log.
type Log struct {
	StartMs int64
	CSV     string
}

// LogsData contains the CSV generated from the system and event logs and the start times of the logs.
type LogsData struct {
	// Logs is a map from section name to Log data.
	Logs     map[string]*Log
	Warnings []string
	Errs     []error
}

// String returns a string representation of the LogsData.
func (ld LogsData) String() string {
	var b bytes.Buffer
	for n, l := range ld.Logs {
		// l is a pointer to the log. It shouldn't ever be nil, but add a check just in case.
		if l != nil {
			fmt.Fprintf(&b, "\n%s startMs: %d\n%s\n", n, l.StartMs, l.CSV)
		}
	}
	for _, w := range ld.Warnings {
		b.WriteString(w)
	}
	for _, e := range ld.Errs {
		b.WriteString(e.Error())
	}
	return b.String()
}

type parser struct {
	// referenceYear is the year extracted from the dumpstate line in a bugreport. Event log lines don't contain a year in the date string, so we use this to reconstruct the full timestamp.
	referenceYear int

	// referenceMonth is the month extracted from the dumpstate line in a bugreport. Since a bugreport may span over a year boundary, we use the month to check whether the year for the event needs to be decremented or incremented.
	referenceMonth time.Month

	// loc is the location parsed from timezone information in the bugreport. The event log is in the user's local timezone which we need to convert to UTC time.
	loc *time.Location

	// buf is the buffer to write the CSV events to.
	buf *bytes.Buffer

	// csvState stores and prints out events in CSV format.
	csvState *csv.State

	// pidMappings maps from PID to app info.
	pidMappings map[string][]bugreportutils.AppInfo

	// lastEventType stores the name of the last seen event. e.g. StrictMode
	lastEventType string

	// partialEvent stores the existing state of a partially parsed event.
	// e.g. a crash event occurs over several lines and can't be outputted until all parts are found.
	partialEvent csv.Entry
}

// newParser creates a parser for the given bugreport.
func newParser(br string) (*parser, []string, error) {
	loc, err := bugreportutils.TimeZone(br)
	if err != nil {
		return nil, []string{}, err
	}
	pm, warnings := bugreportutils.ExtractPIDMappings(br)
	// Extract the year and month from the bugreport dumpstate line.
	d, err := bugreportutils.DumpState(br)
	if err != nil {
		return nil, warnings, fmt.Errorf("could not find dumpstate information in the bugreport: %v", err)
	}
	buf := new(bytes.Buffer)
	return &parser{
		referenceYear:  d.Year(),
		referenceMonth: d.Month(),
		loc:            loc,
		buf:            buf,
		csvState:       csv.NewState(buf, true),
		pidMappings:    pm,
	}, warnings, nil
}

// fullTimestamp constructs the unix ms timestamp from the given date and time information.
// Since event log events have no corresponding year, we reconstruct the full timestamp using
// the stored reference year and month extracted from the dumpstate line of the bug report.
func (p *parser) fullTimestamp(month, day, partialTimestamp, remainder string) (int64, error) {
	parsedMonth, err := strconv.Atoi(month)
	if err != nil {
		return 0, err
	}
	if !validMonth(parsedMonth) {
		return 0, fmt.Errorf("invalid month: %d", parsedMonth)
	}
	year := p.referenceYear
	// The reference month and year represents the time the bugreport was taken.
	// Since events do not have the year and may be out of order, we guess the
	// year based on the month the event occurred and the reference month.
	//
	// If the event's month was greater than the reference month by a lot, the event
	// is assumed to have taken place in the year preceding the reference year since
	// it doesn't make sense for events to exist so long after the bugreport was taken.
	// e.g. Reference date: March 2016, Event month: October, year assumed to be 2015.
	//
	// If the bug report event log begins near the end of a year, and rolls over to the next year,
	// the event would have taken place in the year preceding the reference year.
	if int(p.referenceMonth)-parsedMonth < -1 {
		year--
		// Some events may still occur after the given reference date, so we check for a year rollover in the other direction.
	} else if p.referenceMonth == time.December && time.Month(parsedMonth) == time.January {
		year++
	}
	return bugreportutils.TimeStampToMs(fmt.Sprintf("%d-%s-%s %s", year, month, day, partialTimestamp), remainder, p.loc)
}

// Parse writes a CSV entry for each line matching activity manager proc start and died, ANR and low memory events.
// Package info is used to match crash events to UIDs. Errors encountered during parsing will be collected into an errors slice and will continue parsing remaining events.
func Parse(pkgs []*usagepb.PackageInfo, f string) LogsData {
	p, warnings, err := newParser(f)
	res := LogsData{Warnings: warnings, Logs: make(map[string]*Log)}
	if err != nil {
		res.Errs = append(res.Errs, err)
		return res
	}
	var lastTimestamp int64
	// Pointer to the log data to modify. Will be stored in the Logs map.
	var log *Log
	for _, line := range strings.Split(f, "\n") {
		// We don't want to falsely match log lines that contain text matching the BugReportSectionRE.
		// Even if we're not interested in these events, matching it as an unknown section heading
		// leads to log lines being skipped.
		// e.g. "06-10 15:19:18.447 20746 21720 I efw     : -------------- Local Query Results -----------"
		if m, result := historianutils.SubexpNames(bugreportutils.BugReportSectionRE, line); m && strings.HasPrefix(line, "-") {
			s := result["section"]
			// Just encountered a new section. Output any pending events.
			if log != nil {
				log.CSV = appendCSVs(log.CSV, p.outputCSV(lastTimestamp))
				log = nil
			}
			section := ""
			switch {
			case strings.HasPrefix(s, EventLogSection):
				section = EventLogSection
			case strings.HasPrefix(s, SystemLogSection):
				section = SystemLogSection
			case strings.HasPrefix(s, LastLogcatSection):
				section = LastLogcatSection
			default:
				continue // Not a log section we're interested in.
			}
			// Only output a CSV header if it's the first time we're seeing a section.
			p.resetCSVState(res.Logs[section] == nil)
			if res.Logs[section] != nil {
				res.Errs = append(res.Errs, fmt.Errorf("section %q encountered more than once", section))
			} else {
				res.Logs[section] = &Log{}
			}
			log = res.Logs[section]
			continue
		}
		if log == nil {
			// Not in a valid log section.
			continue
		}
		m, result := historianutils.SubexpNames(logEntryRE, line)
		if !m {
			continue
		}
		timestamp, err := p.fullTimestamp(result["month"], result["day"], result["timeStamp"], result["remainder"])
		lastTimestamp = timestamp
		if err != nil {
			res.Errs = append(res.Errs, err)
			continue
		}
		// Store the first time seen for the current section.
		// If there's a big jump between the purported log start time and the current event timestamp,
		// it's unlikely the user cares about the earlier events, so we overwrite the log start time
		// to avoid skewing the graph. Usually the relevant event log events don't
		// span more than a few days.
		// TODO: consider making this duration configurable. If there are many events
		// falling in this duration, we might consider showing them all.
		if msToTime(timestamp).After(msToTime(log.StartMs).AddDate(0, 0, 14)) {
			log.StartMs = timestamp
		}
		if timestamp < log.StartMs {
			// Log timestamps should be in sorted order, but still handle the case where they aren't.
			res.Errs = append(res.Errs, fmt.Errorf("expect log timestamps in sorted order, got section start: %v, event timestamp: %v", log.StartMs, timestamp))
			log.StartMs = timestamp
		}
		// TODO: also consider UID field if present.
		warning, err := p.parseEvent(pkgs, timestamp, result["event"], strings.TrimSpace(result["details"]), result["pid"])
		if err != nil {
			res.Errs = append(res.Errs, err)
		}
		if warning != "" {
			res.Warnings = append(res.Warnings, warning)
		}
	}
	// Reached the end of the logs. Output any pending events.
	if log != nil {
		log.CSV = appendCSVs(log.CSV, p.outputCSV(lastTimestamp))
	}
	return res
}

// msToTime converts milliseconds since Unix Epoch to a time.Time object.
func msToTime(ms int64) time.Time {
	return time.Unix(0, ms*int64(time.Millisecond))
}

func (p *parser) outputCSV(curMs int64) string {
	// Output any partially parsed event if it's valid.
	p.printPartial()

	// If there was no corresponding am_proc_died event, set the end time to unknownTime.
	// This is handled specially by the JS side.
	p.csvState.PrintActiveEvent(amProc, unknownTime)
	// End other active events at the last seen timestamp. Setting the end time to before the start
	// time will cause the JS to explode unless it's handled specially as is the case for amProc.
	p.csvState.PrintAllReset(curMs)
	return p.buf.String()
}

func (p *parser) resetCSVState(outputHeader bool) {
	p.buf = new(bytes.Buffer)
	p.csvState = csv.NewState(p.buf, outputHeader)
}

// procToUID returns the UID for the given process name, or an empty string if no match was found.
func procToUID(process string, pkgs []*usagepb.PackageInfo) (string, error) {
	pkg, err := packageutils.GuessPackage(process, "", pkgs)
	if err == nil && pkg != nil {
		return strconv.Itoa(int(pkg.GetUid())), nil
	}
	return "", err
}

// printPartial prints out the stored partially parsed event if valid, and clears it.
func (p *parser) printPartial() {
	// Can print if there's a valid metric, timestamp and value.
	if e := p.partialEvent; e.Desc != "" && e.Start != 0 && e.Value != "" {
		p.csvState.PrintInstantEvent(p.partialEvent)
	}
	p.partialEvent = csv.Entry{}
}

// parseEvent parses a single event from the log data, and returns any warning or error.
// Logcat lines are of the form:
//   timestamp PID TID log-level log-tag: tag-values.
//   (from: https://source.android.com/source/read-bug-reports.html)
// The event variable contains the log-tag and the details variable contains the tag-values.
func (p *parser) parseEvent(pkgs []*usagepb.PackageInfo, timestamp int64, event, details, pid string) (string, error) {
	// Reset the saved event state if we've moved on to a new event type.
	if p.lastEventType != event {
		p.printPartial()
		p.lastEventType = event
	}

	switch event {
	case "DEBUG":
		if details == nativeCrashStart {
			p.partialEvent.Start = timestamp
			return "", nil
		}
		var err error
		startMs := p.partialEvent.Start
		if m, result := historianutils.SubexpNames(nativeCrashProcessRE, details); m && startMs != 0 {
			var uid string
			uid, err = procToUID(result["process"], pkgs)
			p.csvState.PrintInstantEvent(csv.Entry{
				Desc:  "Native crash",
				Start: startMs, // Use the last seen native crash start time.
				Type:  "service",
				Value: fmt.Sprintf("%s: %s", result["process"], result["thread"]),
				Opt:   uid,
			})
			p.partialEvent = csv.Entry{} // Clear it here in case we encounter another line that matches the regexp in this crash event.
		}
		return "", err
	case "StrictMode":
		// Match the start of a policy violation event.
		if strings.HasPrefix(details, strictModePre) {
			// Possible we have a stored existing policy violation event. Print it out if it exists.
			p.printPartial()
			// Save the event, but don't print it out yet in case we find the process name in
			// the stack trace.
			p.partialEvent = csv.Entry{
				Desc:  "StrictMode policy violation",
				Start: timestamp,
				Type:  "service",
				Value: strings.TrimSpace(strings.TrimPrefix(details, strictModePre)),
			}
			return "", nil
		}
		if p.partialEvent.Start != 0 && strings.HasPrefix(details, "at") {
			// Probably part of the stack trace if it starts with "at".
			// e.g. "at com.android.app.AppSettings.newInstance(AppSettings.java:11418)"
			pkg, err := packageutils.GuessPackage(details, "", pkgs)
			// StrictMode violations will be reported by the "android" package,
			// but this would be useless to display so we wait until we find a
			// meaningful package name.
			if pkg == nil || err != nil || pkg.GetPkgName() == "android" {
				// Don't bother returning the error as we're not sure what line the real package is on.
				return "", nil
			}
			p.partialEvent.Opt = strconv.Itoa(int(pkg.GetUid()))
			p.printPartial()
			return "", nil
		}
		// Not part of a stack trace. Print out any existing StrictMode event.
		p.printPartial()
		return "", nil
	case "dumpstate":
		if strings.Contains(details, "begin") {
			p.csvState.PrintInstantEvent(csv.Entry{
				Desc:  "Logcat misc",
				Start: timestamp,
				Type:  "string",
				Value: "bug report collection triggered",
			})
			return "", nil
		}
	case "BluetoothAdapter":
		if strings.Contains(details, "startLeScan()") {
			appName, uid := p.pidInfo(pid)
			p.csvState.PrintInstantEvent(csv.Entry{
				Desc:  "Bluetooth Scan",
				Start: timestamp,
				Type:  "service",
				Value: fmt.Sprintf("%s (PID: %s)", appName, pid),
				Opt:   uid,
			})
		}
		return "", nil
	case "AndroidRuntime":
		if m, result := historianutils.SubexpNames(crashStartRE, details); m {
			// Don't print out a crash event until we have the process details of what crashed.
			p.partialEvent.Value = result["source"]
			return "", nil
		}
		if m, result := historianutils.SubexpNames(crashProcessRE, details); m && p.partialEvent.Value != "" {
			uid, err := procToUID(result["process"], pkgs)
			p.csvState.PrintInstantEvent(csv.Entry{
				Desc:  crashes,
				Start: timestamp,
				Type:  "service",
				Value: fmt.Sprintf("%s: %s", result["process"], p.partialEvent.Value),
				Opt:   uid,
			})
			p.partialEvent = csv.Entry{}
			return "", err
		}
	case "art":
		if m, result := historianutils.SubexpNames(gcPauseRE, details); m {
			t := ""
			switch result["type"] {
			case "Background partial":
				t = "Background (partial)"
			case "Background sticky":
				t = "Background (sticky)"
			case "Explicit":
				t = "Foreground"
			default:
				return "", fmt.Errorf("got unknown GC Pause type: %s", result["type"])
			}
			dur, err := time.ParseDuration(result["pausedDur"])
			if err != nil {
				return "", err
			}
			p.csvState.PrintInstantEvent(csv.Entry{
				Desc:  fmt.Sprintf("GC Pause - %s", t),
				Start: timestamp,
				Type:  "service",
				Value: strconv.FormatInt(dur.Nanoseconds(), 10),
			})
			return "", nil
		}
	case "Choreographer":
		if m, result := historianutils.SubexpNames(choreographerRE, details); m {
			_, uid := p.pidInfo(pid)
			p.csvState.PrintInstantEvent(csv.Entry{
				Desc:  "Choreographer (skipped frames)",
				Start: timestamp,
				Type:  "service",
				Value: result["numFrames"],
				Opt:   uid,
			})
			return "", nil
		}

	// Format of Activity Manager details is defined at frameworks/base/services/core/java/com/android/server/am/EventLogTags.logtags.
	case amWTFEvent:
		if strings.HasPrefix(details, "[") { // Encountered start of am_wtf event.
			// Possible we have a stored existing am_wtf event. Print it out if it exists.
			p.printPartial()
			// Sometimes the event is multi-line, so save the event for printing later.
			p.partialEvent = csv.Entry{
				Desc:  event,
				Start: timestamp,
				Type:  "service",
				Value: strings.Trim(details, "[]"),
			}
			return "", nil
		} else if p.partialEvent.Desc != amWTFEvent { // No saved am_wtf event, and it's not the start of an am_wtf event.
			return "", fmt.Errorf("am_wtf event with non expected format: %s", amWTFEvent)
		}
		p.partialEvent.Value += "\n" + strings.Trim(details, "]") // Continuation of existing event.
		return "", nil

	case lowMemoryEvent:
		details = strings.Trim(details, "[]")
		p.csvState.PrintInstantEvent(csv.Entry{
			Desc:  "AM Low Memory",
			Start: timestamp,
			Type:  "service",
			Value: details, // The value is the number of processes.
		})
		return "", nil
	case anrEvent:
		details = strings.Trim(details, "[]")
		return p.parseANR(pkgs, timestamp, details)
	case procStartEvent, procDiedEvent:
		details = strings.Trim(details, "[]")
		return p.parseProc(timestamp, details, event)
	case "dvm_lock_sample":
		details = strings.Trim(details, "[]")
		parts := strings.Split(details, ",")
		warning, err := verifyLen("dvm_lock_sample", parts, 9)
		if err != nil {
			return warning, err
		}
		uid, err := procToUID(parts[0], pkgs)
		p.csvState.PrintInstantEvent(csv.Entry{
			Desc:  "Long dvm_lock_sample", // Filtering on duration is done on JS side.
			Start: timestamp,
			Type:  "service",
			Value: details,
			Opt:   uid,
		})
		return warning, err
	default:
		details = strings.Trim(details, "[]")
		p.csvState.PrintInstantEvent(csv.Entry{
			Desc:  event,
			Start: timestamp,
			Type:  "service",
			Value: details,
		})
	}
	return "", nil
}

// pidInfo converts the PID to the corresponding app name/s and UID.
// If there is no available info for the PID, the app name will be unknown,
// and an empty string returned for the UID.
func (p *parser) pidInfo(pid string) (string, string) {
	var appName string
	var uid string
	apps, ok := p.pidMappings[pid]

	if !ok {
		appName = fmt.Sprintf("Unknown PID %s", pid)
	} else {
		// Append the names together in case there's more than one app info.
		var names []string
		for _, app := range apps {
			names = append(names, app.Name)
		}
		sort.Strings(names)
		appName = strings.Join(names, "|")
		// Only use the UID info if there's one mapping.
		if len(apps) == 1 {
			// TODO: consider sharedUserID info.
			uid = apps[0].UID
		}
	}
	return appName, uid
}

// verifyLen returns an error if the number of parts is less than n, a warning if more.
func verifyLen(eventName string, parts []string, n int) (string, error) {
	if len(parts) < n {
		return "", fmt.Errorf("%s: got %d parts, want %d", eventName, len(parts), n)
	}
	if len(parts) > n {
		return fmt.Sprintf("%s: got %d parts, expected %d", eventName, len(parts), n), nil
	}
	return "", nil
}

func (p *parser) parseANR(pkgs []*usagepb.PackageInfo, timestamp int64, v string) (string, error) {
	// Expected format of v is: User,pid,Package Name,Flags,reason.
	parts := strings.Split(v, ",")
	warning, err := verifyLen(anrEvent, parts, 5)
	if err != nil {
		return warning, err
	}

	// ANR event should still be displayed even if uid could not be matched.
	// Any error is returned at end of function.
	uid, err := procToUID(parts[2], pkgs)
	p.csvState.PrintInstantEvent(csv.Entry{
		Desc:  "ANR",
		Start: timestamp,
		Type:  "service",
		Value: v,
		Opt:   uid,
	})
	return warning, err
}

func (p *parser) parseProc(timestamp int64, v string, t string) (string, error) {
	switch t {
	case procStartEvent:
		// Expected format of v is: User,PID,UID,Process Name,Type,Component.
		parts := strings.Split(v, ",")
		warning, err := verifyLen(procStartEvent, parts, 6)
		if err != nil {
			return warning, err
		}
		pid := parts[1]
		if _, err := strconv.Atoi(pid); err != nil {
			return warning, fmt.Errorf("%s: could not parse pid %v: %v", procStartEvent, pid, err)
		}
		uid, err := packageutils.AppIDFromString(parts[2])
		if err != nil {
			return warning, fmt.Errorf("%s: could not parse uid %v: %v", procStartEvent, parts[2], err)
		}
		uidStr := fmt.Sprint(uid)
		p.csvState.StartEvent(csv.Entry{
			Desc:       amProc,
			Start:      timestamp,
			Type:       "service",
			Value:      v,
			Opt:        uidStr,
			Identifier: pid,
		})
		return warning, nil

	case procDiedEvent:
		// Expected format of v is: User,PID,Process Name.
		parts := strings.Split(v, ",")
		warning, err := verifyLen(procDiedEvent, parts, 3)
		if err != nil {
			return warning, err
		}
		pid := parts[1]
		if _, err := strconv.Atoi(pid); err != nil {
			return warning, fmt.Errorf("%s: could not parse pid %v: %v", procDiedEvent, pid, err)
		}
		if !p.csvState.HasEvent(amProc, pid) {
			p.csvState.StartEvent(csv.Entry{
				Desc:       amProc,
				Start:      unknownTime,
				Type:       "service",
				Value:      v,
				Identifier: pid,
			})
		}
		p.csvState.EndEvent(amProc, pid, timestamp)
		return warning, nil

	default:
		return "", fmt.Errorf("unknown transition: %v", t)
	}
}

func validMonth(m int) bool {
	return m >= int(time.January) && m <= int(time.December)
}

// appendCSVs appends a newline character to end of the first CSV if not present and then joins the two CSVs.
func appendCSVs(csv1, csv2 string) string {
	if strings.LastIndex(csv1, "\n") != len(csv1)-1 {
		csv1 += "\n"
	}
	return csv1 + csv2
}

// SystemUIDecoder maps from IDs found in sysui events to the corresponding event name.
// frameworks/base/proto/src/metrics_constants.proto
type SystemUIDecoder map[int32]string

// Decoder returns the decoder map for sysui events.
func Decoder() SystemUIDecoder {
	return metricspb.MetricsEvent_View_name
}

// MarshalJSON implements the json.Marshaler interface to marshal SystemUIDecoder into valid JSON.
func (s SystemUIDecoder) MarshalJSON() ([]byte, error) {
	// JSON can't do int keys, so we must convert the keys to strings.
	sm := make(map[string]string)
	for k, v := range s {
		sm[strconv.Itoa(int(k))] = v
	}
	return json.Marshal(sm)
}
