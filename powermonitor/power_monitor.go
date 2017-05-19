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

// Package powermonitor parses power monitor files in the format of space separated values, and outputs CSV entries for integration with Historian v2.
package powermonitor

import (
	"bytes"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/battery-historian/csv"
	"github.com/google/battery-historian/historianutils"
)

const (
	currentEvent = "Power Monitor (mA)"
	powerEvent   = "Power Monitor (mW)"
	// Expected format of timestamps in each line.
	secondFmt      = "s"
	millisecondFmt = "ms"
)

// powerMonitorRE is a regular expression to match a line in the power monitor file, in the format: unix_timestamp amps .
// The two allowed formats are:
//   1) unix_timestamp_seconds amps optional_volts, where the timestamp can include a fractional component.
//   2) unix_timestamp_milliseconds milliamps optional_millivolts.
var powerMonitorRE = regexp.MustCompile(`^(?P<timeStamp>\d+)(?P<fractional>([.]\d+)?)` + `\s+` +
	`(?P<current>-?(\d*[.])?\d+)` + `\s*` + `(?P<voltage>-?(\d*[.])?\d+)?` + `\s*$`)

// reading stores the milliamps and volts for an event.
type reading struct {
	mA    float64
	volts *float64 // This may be nil if no voltage column is present.
}

type parser struct {
	fractionalTimestamps bool   // Whether the timestamps are expected to include a fractional component.
	expectVolts          bool   // Whether the voltage column is expected.
	timestampFmt         string // secondFmt or millisecondFmt.
}

// Parse writes a CSV entry for each line in the power monitor file, and returns whether the format was valid.
func Parse(f string) (bool, string, []error) {
	p := parser{}
	// We need to detect what format the file is in.
	for _, l := range strings.Split(f, "\n") {
		m, result := historianutils.SubexpNames(powerMonitorRE, l)
		if !m {
			continue
		}
		parsed, err := strconv.ParseInt(result["timeStamp"], 10, 64)
		if err != nil {
			// Any invalid lines will be outputted as errors in the specific parsing code
			// for second or millisecond formatted files.
			continue
		}
		// The voltage column is optional, but should be consistent through the file.
		p.expectVolts = result["voltage"] != ""
		if result["fractional"] != "" {
			// If there are fractional timestamps, it means it's using second formatting.
			p.timestampFmt = secondFmt
			p.fractionalTimestamps = true
			break
		}
		// If the timestamp is in milliseconds, parsing it as seconds will lead to an invalid timestamp many millennia in the future.
		// This check does not work for timestamps near epoch, but this is unlikely to happen as the scripts to generate power monitor files do not use device time.
		if time.Unix(parsed, 0).After(time.Now()) /** whether the timestamp is in the future */ {
			p.timestampFmt = millisecondFmt
		} else {
			p.timestampFmt = secondFmt
		}
		break
	}
	if p.timestampFmt == "" {
		return false, "", nil
	}
	return p.parseFile(f)
}

// parseFile parses power monitor files in the format: unix_timestamp current optional_voltage
func (p *parser) parseFile(f string) (bool, string, []error) {
	var errs []error
	var buf bytes.Buffer
	csvState := csv.NewState(&buf, true)

	// The power monitor file can have multiple readings per second.
	// Timestamps are in unix time (in seconds), so we count the number of readings per second,
	// and then later on convert them to ms.
	timestampCount := 0
	var readings []reading

	var timestamp, prevTimestamp time.Duration
	matched := false
	for _, l := range strings.Split(f, "\n") {
		// Lines should be in the format: unix_timestamp current optional_voltage
		// Ignore non matching lines.
		matches, result := historianutils.SubexpNames(powerMonitorRE, l)
		if !matches {
			errs = append(errs, fmt.Errorf("line did not match format: unix_timestamp current optional_voltage : %q", l))
			continue
		}
		hasFractional := result["fractional"] != ""
		// If fractional timestamps are expected, flag an error if the current timestamp isn't.
		if p.fractionalTimestamps != hasFractional {
			errs = append(errs, fmt.Errorf("timestamp %q does not match fractional mode %v", l, p.fractionalTimestamps))
			continue
		}
		d := fmt.Sprintf("%s%s%s", result["timeStamp"], result["fractional"], p.timestampFmt)
		var err error
		timestamp, err = time.ParseDuration(d)
		if err != nil {
			errs = append(errs, fmt.Errorf("could not parse timestamp %q", l))
			continue
		}
		c, err := strconv.ParseFloat(result["current"], 64)
		if err != nil {
			errs = append(errs, fmt.Errorf("could not parse current %q", l))
			continue
		}
		v, err := p.parseVoltage(result["voltage"])
		if err != nil {
			errs = append(errs, err)
			continue
		}
		switch p.timestampFmt {
		case secondFmt:
			// Lines in secondFmt have their current readings in amps, but we require milliamps.
			c = c * 1000 // Amps to milliamps
		case millisecondFmt:
			// Lines in millisecondFmt have their voltage readings in millivolts, but we require volts.
			if v != nil {
				*v = *v / 1000 // Millivolts to Volts.
			}
		default:
			errs = append(errs, fmt.Errorf("unknown timestamp fmt: %s", p.timestampFmt))
			continue
		}
		matched = true
		// If the timestamps are in fractional seconds or milliseconds, we can set the CSV state immediately.
		// Otherwise for duplicated seconds timestamps we need to accumulate all entries for the current second.
		if p.fractionalTimestamps || p.timestampFmt == millisecondFmt {
			output(csvState, durToMs(timestamp), reading{c, v})
			continue
		}
		if timestamp == 0 || timestamp == prevTimestamp {
			// The same timestamp appeared, increment the count.
			timestampCount++
		} else {
			// New timestamp.
			// Emit entries for the previous time interval.
			if err := emitEntriesForInterval(prevTimestamp, timestamp, timestampCount, readings, csvState); err != nil {
				errs = append(errs, err)
			}
			prevTimestamp = timestamp
			timestampCount = 1
			readings = nil
		}
		readings = append(readings, reading{c, v})
	}
	if p.fractionalTimestamps || p.timestampFmt == millisecondFmt {
		csvState.PrintAllReset(int64(timestamp / time.Millisecond))
	} else {
		if err := emitEntriesForInterval(prevTimestamp, prevTimestamp+time.Second, timestampCount, readings, csvState); err != nil {
			errs = append(errs, err)
		}
		csvState.PrintAllReset(int64((prevTimestamp + time.Second) / time.Millisecond))
	}
	return matched, buf.String(), errs
}

// parseVoltage returns a pointer to the parsed voltage value, or nil if none was found or expected.
func (p *parser) parseVoltage(v string) (*float64, error) {
	if v != "" && p.expectVolts {
		f64, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return nil, fmt.Errorf("could not parse voltage %q, got err: %v", v, err)
		}
		return &f64, nil
	} else if v != "" {
		return nil, fmt.Errorf("found unexpected voltage column")
	} else if p.expectVolts {
		return nil, fmt.Errorf("expected voltage column but was missing")
	}
	return nil, nil
}

// emitEntriesForInterval divides the the time interval between end and start by timestampCount,
// then emits a CSV entry for the given timestamp (in seconds) plus the increment.
func emitEntriesForInterval(start, end time.Duration, timestampCount int, readings []reading, state *csv.State) error {
	if start > end {
		return fmt.Errorf("end (%v) was before start (%v)", end, start)
	}
	if timestampCount != len(readings) || timestampCount == 0 {
		return nil
	}
	// Evenly divide the time interval by the number of readings per second.
	increment := (end - start) / time.Duration(timestampCount)
	for i := 0; i < timestampCount; i++ {
		curIncrement := increment * time.Duration(i)
		output(state, durToMs(start+curIncrement), readings[i])
	}
	return nil
}

func output(state *csv.State, curMs int64, r reading) {
	state.EndEvent(currentEvent, "", curMs)
	state.StartEvent(csv.Entry{
		Desc:  currentEvent,
		Start: curMs,
		Type:  "float",
		Value: strconv.FormatFloat(r.mA, 'f', 3, 64),
	})
	if r.volts != nil {
		state.EndEvent(powerEvent, "", curMs)
		state.StartEvent(csv.Entry{
			Desc:  powerEvent,
			Start: curMs,
			Type:  "float",
			Value: strconv.FormatFloat(r.mA*(*r.volts), 'f', 3, 64),
		})
	}
}

func durToMs(d time.Duration) int64 {
	return int64(d / time.Millisecond)
}

// IsValid tries to determine if the given contents represent a valid power monitor file.
func IsValid(b []byte) bool {
	m := false
	// Require all non-empty lines matching, and at least one match.
	for _, l := range strings.Split(string(b), "\n") {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		if !powerMonitorRE.MatchString(l) {
			return false
		}
		m = true
	}
	return m
}

// ValidLines returns all valid power monitor lines in the given bytes.
func ValidLines(b []byte) []string {
	var valid []string
	for _, l := range strings.Split(string(b), "\n") {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		if powerMonitorRE.MatchString(l) {
			valid = append(valid, l)
		}
	}
	return valid
}
