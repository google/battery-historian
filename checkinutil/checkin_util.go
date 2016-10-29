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

// Package checkinutil contains common/utility functions and data structures
// that are used in parsing of checkin format.
package checkinutil

import (
	"encoding/csv"
	"fmt"
	"strings"
)

// ChildInfo contains linkage information for App.Child.
type ChildInfo struct {
	// predefined parent name (e.g., GOOGLE_SERVICES for gms and gsf)
	Parent string
	// true if the app is HeadChild
	Head bool
}

// BatteryReport is a lightweight struct (compared to BatteryStats proto) to store Android checkin
// reports including batterystats and package manager dumps.
type BatteryReport struct {
	TimeUsec          int64 // End time, therefore, the time this report was taken.
	TimeZone          string
	AndroidID         int64
	DeviceGroup       []string
	CheckinRule       []string
	BuildID           string // aka. Build Fingerprint
	Product           string
	Radio             string
	Bootloader        string
	SDKVersion        int32
	IsAltMode         bool // True if the android wear device is paired to an ALT mode companion
	CellOperator      string
	CountryCode       string
	RawBatteryStats   [][]string
	RawPackageManager [][]string
}

// Counter is a wrapper for mapreduce counter. (e.g., mr.MapIO and mr.ReduceIO)
type Counter interface {
	Count(name string, inc int)
}

// IntCounter implements Counter.
type IntCounter int

// Count increments the underlying int by inc.
func (c *IntCounter) Count(_ string, inc int) {
	*c += IntCounter(inc)
}

// PrefixCounter is a wrapper that allows including a prefix to counted names.
type PrefixCounter struct {
	Prefix  string
	Counter Counter
}

// Count increments the named counter by inc.
func (c *PrefixCounter) Count(name string, inc int) {
	// Replace null character in counter name by "null" to avoid the "Counter name contains embedded
	// null" error.
	counterName := strings.Replace(c.Prefix+"-"+name, "\x00", "null", -1)
	c.Counter.Count(counterName, inc)
}

// ParseCSV parses the content of a CSV file into a two-dimensional slice of strings.
func ParseCSV(content string) [][]string {
	reader := csv.NewReader(strings.NewReader(content))
	reader.FieldsPerRecord = -1 // allow a variable number of fields
	reader.LazyQuotes = true    // A bug report might include bare quotes
	reader.TrimLeadingSpace = true
	records, err := reader.ReadAll()
	if err != nil {
		fmt.Println(err)
		return nil
	}
	for i := range records {
		for j := range records[i] {
			records[i][j] = strings.TrimSpace(records[i][j])
		}
	}
	return records
}
