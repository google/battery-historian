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

// Package csv contains functions to store battery history events and convert them to and from CSV format.
package csv

import (
	"fmt"
	"io"
	"strings"
)

const (
	// FileHeader is outputted as the first line in csv files.
	FileHeader = "metric,type,start_time,end_time,value,opt"

	// UnknownWakeup is emitted for running events if no wake up reason is set for it.
	UnknownWakeup = "Unknown wakeup reason"

	// CPURunning is the string outputted for CPU Running events.
	CPURunning = "CPU running"

	// Reboot is the string outputted for reboot events.
	Reboot = "Reboot"
)

// Entry contains the details of the start of a state.
type Entry struct {
	Desc  string
	Start int64
	Type  string
	Value string
	// Additional data associated with the entry.
	// Currently this is used to hold the UID (string) of a service (ServiceUID),
	// and is an empty string for other types.
	Opt string
}

// RunningEvent contains the details required for printing a running event.
type RunningEvent struct {
	e   Entry
	end int64
}

// State holds the csv writer, and the map from metric key to active entry.
type State struct {
	// For printing the CSV entries to.
	writer io.Writer

	entries map[Key]Entry

	// For storing the last running event if it did not have a wakeup reason set.
	// This is so the wakeup reason can be associated with the event.
	runningEvent *RunningEvent

	// For storing wake up reasons that occurred when there was no running event.
	// This can happen if the first seen running transition is negative.
	wakeupReason string

	rebootEvent *Entry
}

// Key is the unique identifier for an entry.
type Key struct {
	Metric, Identifier string
}

// NewState returns a new State.
func NewState(csvWriter io.Writer, printHeader bool) *State {
	// Write the csv header.
	if csvWriter != nil && printHeader {
		fmt.Fprintln(csvWriter, FileHeader)
	}
	return &State{
		writer:  csvWriter,
		entries: make(map[Key]Entry),
	}
}

// HasRebootEvent returns true if a reboot event is currently stored, false otherwise.
func (s *State) HasRebootEvent() bool {
	return (s.rebootEvent != nil)
}

// AddRebootEvent stores the entry for the reboot event,
// using the given curTime as the start time.
func (s *State) AddRebootEvent(curTime int64) {
	s.rebootEvent = &Entry{
		Reboot,
		curTime,
		"bool",
		"true",
		"",
	}
}

// PrintRebootEvent prints out the stored reboot event,
// using the given curTime as the end time.
func (s *State) PrintRebootEvent(curTime int64) {
	if e := s.rebootEvent; e != nil {
		s.print(e.Desc, e.Type, e.Start, curTime, e.Value, e.Opt)
		s.rebootEvent = nil
	}
}

// AddEntry adds the given entry into the existing map.
// If the entry already exists, it prints out the entry and deletes it.
func (s *State) AddEntry(desc string, newState EntryState, curTime int64) {
	s.AddEntryWithOpt(desc, newState, curTime, "")
}

// AddEntryWithOpt adds the given entry into the existing map, with the optional value set.
// If the entry already exists, it prints out the entry and deletes it.
func (s *State) AddEntryWithOpt(desc string, newState EntryState, curTime int64, opt string) {
	key := newState.GetKey(desc)

	if e, ok := s.entries[key]; ok {
		if desc == CPURunning {
			// Save the running event, rather than printing it out immediately.
			// This is because wake up reasons can arrive after the running event ends.
			s.assignRunningEvent(&RunningEvent{e, curTime})
		} else {
			s.print(e.Desc, e.Type, e.Start, curTime, e.Value, e.Opt)
		}
		delete(s.entries, key)
		return
	}
	// Running events might not have the wakeup reason set, so we exclude it from the check.
	if newState.GetStartTime() == 0 || (newState.GetValue() == "" && desc != CPURunning) {
		return
	}
	if desc == CPURunning {
		// Print out the previous running event, if any.
		s.assignRunningEvent(nil)
	}
	s.entries[key] = Entry{
		desc,
		curTime,
		newState.GetType(),
		newState.GetValue(),
		opt,
	}
}

// AddOptToEntry adds the given optional value to an existing entry in the map.
// No changes are made if the entry doesn't already exist.
func (s *State) AddOptToEntry(desc string, state EntryState, opt string) {
	key := state.GetKey(desc)
	if e, ok := s.entries[key]; ok {
		e.Opt = opt
		s.entries[key] = e // Modifying the local variable doesn't override the value in the map
	}
}

func (s *State) print(desc, metricType string, start, end int64, value, opt string) {
	if s.writer != nil {
		fmt.Fprintf(s.writer, "%s,%s,%d,%d,%s,%s\n", desc, metricType, start, end, value, opt)
	}
}

// PrintInstantEvent converts the given data to CSV format and writes it to the writer.
func (s *State) PrintInstantEvent(e Entry) {
	s.print(e.Desc, e.Type, e.Start, e.Start, e.Value, e.Opt)
}

// assignRunningEvent replaces the previous running event with the given one.
// Prints out the previous running event if it is non nil.
func (s *State) assignRunningEvent(newEvent *RunningEvent) {
	if s.runningEvent != nil {
		e := s.runningEvent.e
		// No wake up reason exists for the running event.
		if e.Value == "" {
			// Check if a wake up reason was saved.
			if s.wakeupReason != "" {
				e.Value = s.wakeupReason
			} else {
				appendWakeupReason(&e.Value, UnknownWakeup, s.runningEvent.end)
			}
		}
		s.print(e.Desc, e.Type, e.Start, s.runningEvent.end, e.Value, e.Opt)
		// Reset the saved wake up reason.
		s.wakeupReason = ""
	}
	s.runningEvent = newEvent

}

// AddWakeupReason adds the wakeup reason to the value field of the most recent running entry.
func (s *State) AddWakeupReason(service string, curTime int64) {
	key := Key{CPURunning, ""}

	if e, ok := s.entries[key]; ok {
		// CPU running currently is in a + transition.
		appendWakeupReason(&e.Value, service, curTime)
		s.entries[key] = e
	} else if s.runningEvent != nil {
		appendWakeupReason(&s.runningEvent.e.Value, service, curTime)
		s.assignRunningEvent(nil)
	} else {
		// No running event saved, but wakeup reason has arrived. This may occur if the first seen running event has a "-" transition.
		appendWakeupReason(&s.wakeupReason, service, curTime)
	}
}

// appendWakeUpReason appends the time and wakeup reason to the current wakeup reason string.
// Each time and corresponding wakeup reason is separated by a ~, and each of these sets are delimited with pipes.
// It strips out the trailing escaped double quote from the current wakeup reason string, and the leading escaped double quote from the wakeup reason to add.
//    e.g. `"time1~wakeupreason1|time2~wakeupreason2"` -> `"time1~wakeupreason1|time2~wakeupreason2|time3~wakeupreason3"`
//
// The resulting wakeup reason string needs to be quoted, as any wakeup reason may have special characters such as commas.
// d3.csv.parse would parse "time1"wakeupreason1"" as "time1", so the extra quotes are stripped out.
func appendWakeupReason(cur *string, service string, curTime int64) {
	s := *cur
	// Remove the leading double quote in the wakeup reason we're adding.
	service = strings.TrimPrefix(service, `"`)

	// If there is no closing quote, add one.
	if !strings.HasSuffix(service, `"`) {
		service += `"`
	}

	// No wakeup reason exists yet.
	if s == "" {
		*cur = fmt.Sprintf(`"%v~%v`, curTime, service)
		return
	}
	// Remove the trailing double quote in the existing wakeup reason string if it exists.
	s = strings.TrimSuffix(s, `"`)

	// Append the time and wakeup reason with delimiting pipes.
	*cur = fmt.Sprintf(`%v|%v~%v`, s, curTime, service)
}

// PrintAllReset prints all active entries and resets the map.
func (s *State) PrintAllReset(curTime int64) {
	for _, e := range s.entries {
		if e.Desc == CPURunning && e.Value == "" {
			appendWakeupReason(&e.Value, UnknownWakeup, curTime)
		}
		s.print(e.Desc, e.Type, e.Start, curTime, e.Value, e.Opt)
	}
	s.assignRunningEvent(nil)
	s.entries = make(map[Key]Entry)
}

// EntryState is a commmon interface for the various types,
// so the Entries can access them the same way.
type EntryState interface {
	// GetStartTime returns the start time of the entry.
	GetStartTime() int64
	// GetType returns the type of the entry:
	// "string", "bool", "int" or "service".
	GetType() string
	// GetValue returns the stored value of the entry.
	GetValue() string
	// GetKey returns the unique identifier for the entry.
	GetKey(string) Key
}
