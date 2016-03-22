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

package parseutils

// human_readable.go maps the adjusted timestamps from the checkin battery history to the cumulative time deltas to match the human readable battery history deltas.

import (
	"fmt"
	"strconv"
)

type deltaMapping struct {
	// Total of deltas read so far.
	cumulativeDelta int64
	// The key is the unix timestamp in ms, value is human readable delta.
	timeToDelta map[string]string
}

func newDeltaMapping() *deltaMapping {
	return &deltaMapping{
		timeToDelta: make(map[string]string),
	}
}

// addMapping adds the delta to the current cumulative delta, and adds a mapping from the timestamp to cumulative delta if the timestamp is non zero.
func (d *deltaMapping) addMapping(timestamp, delta int64) error {
	d.cumulativeDelta += delta

	// If the device state was reset (e.g. for a START statement), then the timestamp will be 0, and should not be added to the map.
	// The delta still needs to be incremented.
	if timestamp != 0 {
		formatted, err := formatDelta(d.cumulativeDelta)
		if err != nil {
			return err
		}
		d.timeToDelta[strconv.FormatInt(timestamp, 10)] = formatted
	}
	return nil
}

// formatDelta returns the human readable format for a numerical non negative delta. This should exactly match the deltas in the human readable battery history.
// Units should be zero padded unless they are the leading unit, and the leading unit should be non zero, except for the special case where the delta is 0.
// e.g. +1d01h33m33s000ms
func formatDelta(delta int64) (string, error) {
	if delta < 0 {
		return "", fmt.Errorf("negative delta %q not allowed", delta)
	}
	if delta == 0 {
		// Special case, no units.
		return "0", nil
	}

	ms := delta % 1000
	delta /= 1000
	// If there is no remainder, return the ms string.
	if delta == 0 {
		return fmt.Sprintf("+%dms", ms), nil
	}
	// Should only be zero padded if it is not the leading unit.
	result := fmt.Sprintf("%03dms", ms)

	s := delta % 60
	delta /= 60
	if delta == 0 {
		return fmt.Sprintf("+%ds%s", s, result), nil
	}
	result = fmt.Sprintf("%02ds%s", s, result)

	m := delta % 60
	delta /= 60
	if delta == 0 {
		return fmt.Sprintf("+%dm%s", m, result), nil
	}
	result = fmt.Sprintf("%02dm%s", m, result)

	h := delta % 24
	delta /= 24
	if delta == 0 {
		return fmt.Sprintf("+%dh%s", h, result), nil
	}
	result = fmt.Sprintf("%02dh%s", h, result)

	// Remainder should be number of days.
	return fmt.Sprintf("+%dd%s", delta, result), nil
}
