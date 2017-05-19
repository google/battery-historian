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

// Package broadcasts parses historical and active broadcasts in bugreport files and outputs CSV entries for those events.
package broadcasts

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/battery-historian/bugreportutils"
	"github.com/google/battery-historian/csv"
	"github.com/google/battery-historian/historianutils"
)

var (
	// historicalSectionStartRE is a regular expression that matches the start of the historical foreground or background broadcasts summary section.
	// e.g. "Historical broadcasts summary [foreground]"
	historicalSectionStartRE = regexp.MustCompile(`Historical broadcasts summary \[` + `(?P<type>(foreground|background))` + `\]`)

	// historicalFullStartRE is a regular expression that matches the start of the full details of a historical broadcast.
	// These are limited to the top 50 broadcasts.
	// e.g. Historical Broadcast foreground #45:
	historicalFullStartRE = regexp.MustCompile(`Historical Broadcast (?P<type>(foreground|background)) #(?P<id>\d+)`)

	// historicalStartRE is a regular expression that matches the start of a broadcast summary event, and the id of the event.
	// e.g. #0: act=android.intent.action.TIME_TICK flg=0x50000014 (has extras)
	historicalStartRE = regexp.MustCompile(`#(?P<id>\d+): act=`)

	// historicalOffsetsRE is a regular expression that matches the dispatch and finish offset duration of a broadcast event.
	// e.g. +379ms dispatch +43ms finish
	historicalOffsetsRE = regexp.MustCompile(`(?P<dispatchSign>[+-]?)(?P<dispatchOffset>[^\s]+)\s+dispatch` + `\s+` + `(?P<finishSign>[+-]?)(?P<finishOffset>[^\s]+)\s+finish`)

	// historicalEnqueueClockTimeRE is a regular expression that matches the clock time of the enqueue event.
	// The dispatch and finish clock times are also present, but since these times don't include millliseconds, we add the dispatch and finish offset durations to the enqueue time instead to get a slightly more accurate time.
	// e.g. enq=2016-08-28 10:30:00 disp=2016-08-28 10:30:00 fin=2016-08-28 10:30:00
	historicalEnqueueClockTimeRE = regexp.MustCompile(`enq=(?P<enqueueTimeStamp>[\d-]+\s+[\d:]+)`)

	// activeStartRE is a regular expression that matches the start of an active broadcast event, the broadcast type, and the id of the event.
	// e.g. Active Ordered Broadcast foreground #0
	activeStartRE = regexp.MustCompile(`Active Ordered Broadcast (?P<type>(foreground|background)) #(?P<id>\d+)`)

	// activeEnqueueClockTimeRE is a regular expression that matches the clock time of the active broadcast enqueue event.
	// Rather than match the dispatch clock time, we add the parsed offset to the enqueue clock time.
	// e.g. enqueueClockTime=2016-09-27 14:33:16 dispatchClockTime=2016-09-27 14:33:24
	activeEnqueueClockTimeRE = regexp.MustCompile(`enqueueClockTime=(?P<enqueueTimeStamp>[\d-]+\s+[\d:]+)`)

	// activeOffsetRE is a regular expression that matches the dispatch offset duration of an active broadcast event.
	// e.g. dispatchTime=-- (+8003ms since enq) receiverTime=--
	// The dispatch offset may be invalid if it hasn't been dispatched yet.
	// e.g. dispatchTime=-- (-17071d21h36m16s749ms since enq) receiverTime=--
	activeOffsetRE = regexp.MustCompile(`dispatchTime=[^(]*` + `\(` + `(?P<sign>[+-]?)` + `(?P<dispatchOffset>[^\s]+)` + ` since enq`)

	// uidRE is a regular expression that matches the UID of a broadcast event.
	uidRE = regexp.MustCompile(`uid=(?P<uid>\S+)`)

	// maxOffsetMs is the maximum offset in milliseconds considered to be valid.
	maxOffsetMs = (365 * 24 * time.Hour).Nanoseconds() / int64(time.Millisecond)
)

type parser struct {
	lines []string
	idx   int

	curHistoricalSection string // foreground or background

	buf      *bytes.Buffer
	csvState *csv.State

	loc  *time.Location
	errs []error

	// historicalBroadcastsUIDs is a map from broadcast type ("background" or "foreground"),
	// to a map from broadcast ID to UID.
	historicalBroadcastsUIDs map[string]map[string]string
}

// Returns the current line without advancing the line position.
func (p *parser) peek() string {
	if p.valid() {
		return p.lines[p.idx]
	}
	return ""
}

// Returns the current line and advances the line position.
func (p *parser) line() string {
	if !p.valid() {
		return ""
	}
	l := p.lines[p.idx]
	p.idx++
	return l
}

// Returns whether the current line position corresponds to a valid line.
func (p *parser) valid() bool {
	return p.idx < len(p.lines)
}

// Parse writes a CSV entry for each broadcast summary event found.
// Errors encountered during parsing will be collected into an errors slice and will continue parsing remaining events.
func Parse(f string) (string, []error) {
	loc, err := bugreportutils.TimeZone(f)
	if err != nil {
		return "", []error{err}
	}
	buf := new(bytes.Buffer)
	p := parser{
		lines:    strings.Split(f, "\n"),
		buf:      buf,
		csvState: csv.NewState(buf, true),
		loc:      loc,
		historicalBroadcastsUIDs: make(map[string]map[string]string),
	}

	for p.valid() {
		l := p.line() // Read the current line and advance the line position.
		// Active broadcast parsing.
		if m, result := historianutils.SubexpNames(activeStartRE, l); m {
			if err := p.parseActiveBroadcast(result["type"], result["id"]); err != nil {
				p.errs = append(p.errs, err)
			}
			continue
		}
		// Historical broadcast UID parsing.
		if m, result := historianutils.SubexpNames(historicalFullStartRE, l); m {
			if err := p.parseHistoricalUID(result["type"], result["id"]); err != nil {
				p.errs = append(p.errs, err)
			}
			continue
		}
		// Historical summary broadcast parsing.
		if m, result := historianutils.SubexpNames(historicalSectionStartRE, l); m {
			p.curHistoricalSection = result["type"] // Foreground or background.
			continue
		}
		if p.curHistoricalSection == "" {
			continue // Not currently in the foreground or background section.
		}
		if strings.TrimSpace(l) == "" {
			// Blank line signifies end of broadcast summary section.
			p.curHistoricalSection = ""
			continue
		}
		if m, result := historianutils.SubexpNames(historicalStartRE, l); m {
			if err := p.parseHistoricalBroadcast(result["id"]); err != nil {
				p.errs = append(p.errs, err)
			}
		}
	}
	return p.buf.String(), p.errs
}

// parseHistoricalBroadcast adds an enqueue and a dispatch event for the given id, parsing the next two lines for offset durations and clock times.
// If any error is encountered, the line position is not advanced for that line, and no events are added.
func (p *parser) parseHistoricalBroadcast(id string) error {
	// Next line should have the enqueue and dispatch offsets.
	// We use peek to avoid advancing the line position in case it matches something else.
	// e.g. the start of another event (that normally wouldn't happen).
	m, result := historianutils.SubexpNames(historicalOffsetsRE, p.peek())
	if !m {
		return fmt.Errorf("#%s: missing dispatch and finish offsets", id)
	}
	p.line() // Since it's a valid match, advance the line.
	// TODO: figure out how to handle these cases. Since historical broadcasts
	// should only have finished broadcasts, it doesn't really make sense to have negative offsets.
	if result["dispatchSign"] == "-" || result["finishSign"] == "-" {
		return fmt.Errorf("#%s: negative offset", id)
	}
	dispOff, err := historianutils.ParseDurationWithDays(result["dispatchOffset"])
	if err != nil {
		return fmt.Errorf("#%s: err parsing dispatch offset: %v", id, err)
	}
	finishOff, err := historianutils.ParseDurationWithDays(result["finishOffset"])
	if err != nil {
		return fmt.Errorf("#%s: err parsing finish offset: %v", id, err)
	}
	if dispOff > maxOffsetMs || finishOff > maxOffsetMs {
		return fmt.Errorf("#%s: offset is too large", id)
	}

	// Next line should have the enqueue clock time.
	m, result = historianutils.SubexpNames(historicalEnqueueClockTimeRE, p.peek())
	if !m {
		return fmt.Errorf("#%s: missing broadcast enqueue timestamp", id)
	}
	p.line() // Advance the line position.
	enqMs, err := bugreportutils.TimeStampToMs(result["enqueueTimeStamp"], "", p.loc)
	if err != nil {
		return fmt.Errorf("#%s: err parsing enqueue timestamp: %v", id, err)
	}

	uid := ""
	if uids := p.historicalBroadcastsUIDs[p.curHistoricalSection]; uids != nil {
		uid = uids[id]
	}
	dispMs := enqMs + dispOff
	p.csvState.Print(fmt.Sprintf("Broadcast Enqueue (%s)", p.curHistoricalSection), "string", enqMs, dispMs, id, uid)

	finishMs := dispMs + finishOff
	p.csvState.Print(fmt.Sprintf("Broadcast Dispatch (%s)", p.curHistoricalSection), "string", dispMs, finishMs, id, uid)
	return nil
}

// parseActiveBroadcast adds an event for the given id, parsing until the offset duration and clock time is found.
// If any error is encountered, the line position is not advanced for that line, and no events are added.
func (p *parser) parseActiveBroadcast(broadcastType, id string) error {
	var enqMs int64
	var uid string
	// There are quite a few lines between the start of the active broadcast event and the enqueue clock time, so keep parsing until we find it, or return if we have reached another active event or exited the active broadcasts section.
	for p.valid() {
		cur := p.peek() // Don't advance the line counter in case it matches something else.
		if m, result := historianutils.SubexpNames(uidRE, cur); m {
			p.line() // Advance the line position.
			uid = result["uid"]
			continue // Still expect enqueue timestamp in following lines.
		}
		if m, result := historianutils.SubexpNames(activeEnqueueClockTimeRE, cur); m {
			p.line() // Advance the line position.
			var err error
			enqMs, err = bugreportutils.TimeStampToMs(result["enqueueTimeStamp"], "", p.loc)
			if err != nil {
				return fmt.Errorf("#%s: err parsing enqueue timestamp: %v", id, err)
			}
			break
		}
		if strings.TrimSpace(cur) == "" || activeStartRE.MatchString(cur) {
			// Exited section, or encountered start of next active event.
			return fmt.Errorf("#%s: missing broadcast enqueue timestamp", id)
		}
		p.line()
	}
	if enqMs == 0 {
		return fmt.Errorf("#%s: missing broadcast enqueue timestamp", id)
	}
	// Next line should have the dispatch offset.
	// We use peek to avoid advancing the line position in case it matches something else.
	m, result := historianutils.SubexpNames(activeOffsetRE, p.peek())
	if !m {
		return fmt.Errorf("#%s: missing dispatch offset", id)
	}
	p.line() // Since it's a valid match, advance the line.

	dispMs := int64(-1)        // For identifying events that haven't been dispatched yet.
	if result["sign"] != "-" { // Negative offset means the broadcast hasn't been dispatched yet. e.g. -17000d
		dispOff, err := historianutils.ParseDurationWithDays(result["dispatchOffset"])
		if err != nil {
			return fmt.Errorf("#%s: err parsing dispatch offset: %v", id, err)
		}
		if dispOff > maxOffsetMs {
			return fmt.Errorf("#%s: offset is too large", id)
		}
		dispMs = enqMs + dispOff
	}
	p.csvState.Print(fmt.Sprintf("Active Broadcast (%s)", broadcastType), "string", enqMs, dispMs, id, uid)
	return nil
}

// parseHistoricalUIDs populates the map with the next found historical broadcast UID.
func (p *parser) parseHistoricalUID(broadcastType, id string) error {
	p.line() // Advance the line position.
	for p.valid() {
		cur := p.peek()
		if m, result := historianutils.SubexpNames(uidRE, cur); m {
			p.line() // Advance the line position.
			if p.historicalBroadcastsUIDs[broadcastType] == nil {
				p.historicalBroadcastsUIDs[broadcastType] = make(map[string]string)
			}
			p.historicalBroadcastsUIDs[broadcastType][id] = result["uid"]
			return nil
		} else if strings.TrimSpace(cur) == "" || historicalFullStartRE.MatchString(cur) {
			// Exited section, or encountered start of next active event.
			break
		}
		p.line()
	}
	return fmt.Errorf("#%s (%s): full historical broadcast info missing UID", id, broadcastType)
}
