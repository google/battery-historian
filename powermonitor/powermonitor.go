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

// Package powermonitor parses powermonitor files in the format of space separated values, and outputs CSV entries for integration with Historian v2.
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

// powermonitorRE is a regular expression to match a line in the powermonitor file, in the format: unix_timestamp amps .
// The timestamp can include a fractional component.
var powermonitorRE = regexp.MustCompile(`^(?P<timeStamp>\d+)(?P<fractional>(.\d+)?)\s+(?P<amps>-?\d*.?\d+)[-?\s.\d]*$`)

// entry stores the timestamp and amps for the current line in the powermonitor file.
type entry struct {
	start int64
	value string
}

// Methods required by csv.EntryState.
func (e *entry) GetStartTime() int64 {
	return e.start
}

func (*entry) GetType() string {
	return "int"
}

func (e *entry) GetValue() string {
	return e.value
}

func (*entry) GetKey(desc string) csv.Key {
	return csv.Key{Metric: desc}
}

// Parse writes a CSV entry for each line in the powermonitor file, and returns whether the format was valid.
func Parse(f string) (bool, string, []error) {
	var errs []error
	var buf bytes.Buffer
	csvState := csv.NewState(&buf, false)

	var e entry

	// The powermonitor file can have multiple readings per second.
	// Timestamps are in unix time (in seconds), so we count the number of readings per second,
	// and then later on convert them to ms.
	timestampCount := 0
	var readings []float64

	var timestamp, prevTimestamp time.Duration
	matched := false
	fractionalMode := false
	for _, l := range strings.Split(f, "\n") {
		// Lines should be in the format: unix_timestamp amps
		// Ignore non matching lines.
		matches, result := historianutils.SubexpNames(powermonitorRE, l)
		if !matches {
			errs = append(errs, fmt.Errorf("line did not match format: unix_timestamp amps : %q", l))
			continue
		}
		hasFractional := result["fractional"] != ""
		// If we've matched a line previously and one line is fractional and the other isn't, flag an error.
		if matched && fractionalMode != hasFractional {
			errs = append(errs, fmt.Errorf("timestamp %q does not match fractional mode %v", l, fractionalMode))
			continue
		}
		fractionalMode = hasFractional
		d := fmt.Sprintf("%s%ss", result["timeStamp"], result["fractional"])
		var err error
		timestamp, err = time.ParseDuration(d)
		if err != nil {
			errs = append(errs, fmt.Errorf("could not parse timestamp %q", l))
			continue
		}
		f64, err := strconv.ParseFloat(result["amps"], 64)
		if err != nil {
			errs = append(errs, fmt.Errorf("could not parse amps %q", l))
			continue
		}
		matched = true
		// If the timestamps are in fractional seconds, we can set the CSV state immediately.
		// Otherwise for duplicated seconds timestamps we need to accumulate all entries for the current second.
		if fractionalMode {
			e.set(csvState, timestamp, f64)
			continue
		}
		if timestamp == 0 || timestamp == prevTimestamp {
			// The same timestamp appeared, increment the count.
			timestampCount++
		} else {
			// New timestamp.
			// Emit entries for the previous time interval.
			if err := emitEntriesForInterval(prevTimestamp, timestamp, timestampCount, readings, csvState, &e); err != nil {
				errs = append(errs, err)
			}
			prevTimestamp = timestamp
			timestampCount = 1
			readings = nil
		}
		readings = append(readings, f64)
	}
	if fractionalMode {
		csvState.PrintAllReset(int64(timestamp / time.Millisecond))
	} else {
		if err := emitEntriesForInterval(prevTimestamp, prevTimestamp+time.Second, timestampCount, readings, csvState, &e); err != nil {
			errs = append(errs, err)
		}
		csvState.PrintAllReset(int64((prevTimestamp + time.Second) / time.Millisecond))
	}
	return matched, buf.String(), errs
}

// emitEntriesForInterval divides the the time interval between end and start by timestampCount,
// then emits a CSV entry for the given timestamp (in seconds) plus the increment.
func emitEntriesForInterval(start, end time.Duration, timestampCount int, readings []float64, state *csv.State, e *entry) error {
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
		e.set(state, start+curIncrement, readings[i])
	}
	return nil
}

func (e *entry) set(state *csv.State, t time.Duration, powermonitorReading float64) {
	timeMs := int64(t / time.Millisecond)
	// Create a closing transition for the last entry.
	state.AddEntry("Powermonitor", e, timeMs)

	e.start = timeMs
	// Convert to milliamperes (mA).
	mA := powermonitorReading * 1000
	e.value = strconv.FormatFloat(mA, 'f', 3, 64)
	state.AddEntry("Powermonitor", e, timeMs)
}

// IsValid tries to determine if the given contents represent a valid powermonitor file.
func IsValid(b []byte) bool {
	return powermonitorRE.Match(b)
}
