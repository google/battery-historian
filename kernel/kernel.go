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

// Package kernel parses Kernel wakesource files, and outputs CSV entries for integration with Historian v2.
package kernel

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
	// supportedDevice is a mapping from device name to whether it is parseable by the kernel trace python script.
	supportedDevice = map[string]bool{
		"hammerhead":   true,
		"shamu":        true,
		"flounder":     true,
		"flounder_lte": true,
	}

	// TraceFileRE is a regular expression to match the top line in a kernel trace file.
	TraceFileRE = regexp.MustCompile(`^# tracer: nop\n`)

	// WakeSourceRE is a regular expression to match a line in the Kernel wakesource file.
	//   e.g. healthd-188 [001] d..2 "2015-05-28 19:50:27.636636" wakeup_source_activate: eventpoll state=0x176d0004
	WakeSourceRE = regexp.MustCompile(`^` + `[^"]+` + `\s+` + `["]` + `(?P<timeStamp>[^.]+)` + `[.]` + `(?P<remainder>\d+)` + `["]` + `\s+` + `(?P<transitionType>\S+):` + `\s+` + `(?P<value>\S+)`)
)

const (
	// TimeLayout is the layout passed to time.Parse.
	TimeLayout = "2006-01-02 15:04:05"

	// PositiveTransition is the string for positive transitions in the Kernel wakesource file.
	PositiveTransition = "wakeup_source_activate"

	// NegativeTransition is the string for negative transitions in the Kernel wakesource file.
	NegativeTransition = "wakeup_source_deactivate"

	// KernelWakeSource is the csv description for the Kernel wakesource metric.
	KernelWakeSource = "Kernel Wakesource"
)

// entry stores the timestamp and value for the current line in the file.
type entry struct {
	start int64
	value string
}

func (e *entry) GetStartTime() int64 {
	return e.start
}

func (e *entry) GetType() string {
	return "service"
}

func (e *entry) GetValue() string {
	return e.value
}

func (e *entry) GetKey(desc string) csv.Key {
	return csv.Key{
		desc,
		e.value,
	}
}

// Parse writes a csv entry for each line in the kernel log file, and returns whether the format was valid.
func Parse(f string) (bool, string, []error) {
	var errs []error
	var buf bytes.Buffer
	csvState := csv.NewState(&buf, true)

	activeMap := make(map[string]*entry)

	curTime := int64(0)
	startTime := int64(0)
	matched := false

	for _, l := range strings.Split(f, "\n") {
		if matches, result := historianutils.SubexpNames(WakeSourceRE, l); matches {
			timestamp, err := bugreportutils.TimeStampToMs(result["timeStamp"], result["remainder"], time.UTC)
			if err != nil {
				errs = append(errs, err)
				continue
			}
			matched = true
			if startTime == 0 {
				startTime = timestamp
			}
			curTime = timestamp
			t := result["transitionType"]
			v := result["value"]

			e, alreadyActive := activeMap[v]

			switch t {
			case PositiveTransition:
				if !alreadyActive {
					e = &entry{timestamp, v}
					activeMap[v] = e
				} else {
					// Double positive transition. Ignore the event.
					errs = append(errs, fmt.Errorf("two positive transitions for %q, wakesource %q", KernelWakeSource, v))
					continue
				}

			case NegativeTransition:
				if !alreadyActive {
					errs = append(errs, fmt.Errorf("negative transition without positive transition for %q, wakesource %q", KernelWakeSource, v))
					continue
				}

				delete(activeMap, v)

			default:
				errs = append(errs, fmt.Errorf("unknown transition for %q %q", KernelWakeSource, t))
				continue
			}
			csvState.AddEntry(KernelWakeSource, e, curTime)
		}
	}
	csvState.PrintAllReset(curTime)
	return matched, buf.String(), errs
}

// IsSupportedDevice returns true if the kernel trace file is currently parseable for that device.
// 'device' should be device name (eg. hammerhead) and not model name (eg. Nexus 5).
func IsSupportedDevice(device string) bool {
	return supportedDevice[device]
}

// IsTrace returns true if the given contents match a kernel trace file.
func IsTrace(f []byte) bool {
	return TraceFileRE.Match(f)
}
