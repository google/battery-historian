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
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
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

	// Unique identifier for the event. e.g. The name of the app that triggered the event.
	Identifier string
}

// Functions expected by the EntryState interface.

// GetStartTime returns the start time of the entry.
func (e *Entry) GetStartTime() int64 {
	return e.Start
}

// GetType returns the type of the entry.
func (e *Entry) GetType() string {
	return e.Type
}

// GetValue returns the stored value of the entry.
func (e *Entry) GetValue() string {
	return e.Value
}

// GetKey returns the unique identifier for the entry.
func (e *Entry) GetKey(desc string) Key {
	return Key{
		Metric:     desc,
		Identifier: e.Identifier,
	}
}

// StartEvent marks an event as beginning at the given timestamp.
// Does nothing if the event is already active.
// For events without a duration, PrintInstantEvent should be used instead.
func (s *State) StartEvent(e Entry) {
	if s.HasEvent(e.Desc, e.Identifier) {
		return
	}
	s.AddEntryWithOpt(e.Desc, &e, e.Start, e.Opt)
}

// HasEvent returns whether an event for the metric with the given identifier is currently active.
func (s *State) HasEvent(metric, eventIdentifier string) bool {
	k := Key{
		Metric:     metric,
		Identifier: eventIdentifier,
	}
	_, ok := s.entries[k]
	return ok
}

// EndEvent marks an event as finished at the given timestamp.
// Does nothing if the event is not currently active.
func (s *State) EndEvent(metric, eventIdentifier string, curTime int64) {
	if !s.HasEvent(metric, eventIdentifier) {
		return
	}
	e := Entry{
		Desc:       metric,
		Start:      curTime,
		Identifier: eventIdentifier,
	}
	s.AddEntry(metric, &e, curTime)
}

// RunningEvent contains the details required for printing a running event.
type RunningEvent struct {
	e   Entry
	end int64
}

type wakeupReason struct {
	name  string
	start int64
}

// State holds the csv writer, and the map from metric key to active entry.
type State struct {
	// For printing the CSV entries.
	writer *csv.Writer

	entries map[Key]Entry

	// For storing the last running event if it did not have a wakeup reason set.
	// This is so the wakeup reason can be associated with the event.
	runningEvent *RunningEvent

	// For storing the wakeup reasons for the current running event. Running events never overlap.
	// This is stored separately to the running event as wakeup reasons can arrive after the running
	// event ends, or before the running event if the first seen running transition is negative.
	wakeupReasonBuf bytes.Buffer

	// The current wakeup reason, if there is one; nil if not.
	curWakeupReason *wakeupReason

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
		writer:  csv.NewWriter(csvWriter),
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
		Desc:  Reboot,
		Start: curTime,
		Type:  "bool",
		Value: "true",
	}
}

// PrintRebootEvent prints out the stored reboot event,
// using the given curTime as the end time.
func (s *State) PrintRebootEvent(curTime int64) {
	if e := s.rebootEvent; e != nil {
		s.Print(e.Desc, e.Type, e.Start, curTime, e.Value, e.Opt)
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
			s.Print(e.Desc, e.Type, e.Start, curTime, e.Value, e.Opt)
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
		Desc:  desc,
		Start: curTime,
		Type:  newState.GetType(),
		Value: newState.GetValue(),
		Opt:   opt,
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

// stripQuotes removes the first and last quote in the string if both are present.
// e.g. `"com.google.android.gm"` would become `com.google.android.gm`.
func stripQuotes(value string) string {
	// Only remove if both beginning and ending quotes are present,
	// to avoid removing it in strings such as: TYPE_WIFI:"CONNECTED".
	if l := len(value); l >= 2 && strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`) {
		return value[1 : l-1]
	}
	return value
}

// Print directly prints a csv entry to CSV format and writes it to the writer.
func (s *State) Print(desc, metricType string, start, end int64, value, opt string) {
	if s.writer == nil {
		return
	}
	// Strip first and last quote if present. The CSV library will escape any double quotes,
	// leading to strings like `""com.google.android.gm""`.
	// If any quotes are in the middle of the string we still want them escaped.
	// Previously we were just calling Printf and did not escape the quotes, leading to the
	// CSV parsing on the JS side to treat the quotes as a text qualifier rather than part of the value.
	value = stripQuotes(value)
	opt = stripQuotes(opt)
	s.writer.Write([]string{desc, metricType, strconv.FormatInt(start, 10), strconv.FormatInt(end, 10), value, opt})
	s.writer.Flush()
}

// PrintEvent writes an event extracted by ExtractEvents to the writer.
func (s *State) PrintEvent(metric string, e Event) {
	s.Print(metric, e.Type, e.Start, e.End, e.Value, e.Opt)
}

// PrintInstantEvent converts the given data to CSV format and writes it to the writer.
func (s *State) PrintInstantEvent(e Entry) {
	s.Print(e.Desc, e.Type, e.Start, e.Start, e.Value, e.Opt)
}

// assignRunningEvent replaces the previous running event with the given one.
// Prints out the previous running event if it is non nil.
// Only used for CPU running events.
func (s *State) assignRunningEvent(newEvent *RunningEvent) {
	if s.runningEvent != nil {
		e := s.runningEvent.e
		e.Value = s.wakeupReasons(s.runningEvent.end)
		s.wakeupReasonBuf.Reset()
		s.Print(e.Desc, e.Type, e.Start, s.runningEvent.end, e.Value, e.Opt)
	}
	s.runningEvent = newEvent
}

// StartWakeupReason adds the wakeup reason to the wakeup reason buffer.
func (s *State) StartWakeupReason(service string, curTime int64) {
	if s.curWakeupReason != nil {
		s.appendWakeupReason(s.curWakeupReason, curTime)
	}
	// We need to keep track of what the current wakeup reason is so that we can log its start and end times.
	s.curWakeupReason = &wakeupReason{
		name:  service,
		start: curTime,
	}
}

// EndWakeupReason adds the wakeup reason to the wakeup reason buffer.
func (s *State) EndWakeupReason(service string, curTime int64) error {
	if s.curWakeupReason != nil {
		if s.curWakeupReason.name != service {
			return fmt.Errorf("tried to end a different wakeup reason (%q) than was started (%q)", service, s.curWakeupReason.name)
		}
		s.appendWakeupReason(s.curWakeupReason, curTime)
		s.curWakeupReason = nil
		return nil
	}
	// No current wakeup reason. "Start" and end this one.
	s.appendWakeupReason(&wakeupReason{
		name:  service,
		start: curTime,
	}, curTime)
	return nil
}

// appendWakeUpReason appends the wakeup reason and its start time to the current wakeup reason string.
// Each time and corresponding wakeup reason is separated by a ~, and each of these sets are delimited with pipes.
// It strips out the leading and trailing double quotes from the wakeup reason to add.
func (s *State) appendWakeupReason(wr *wakeupReason, curTime int64) {
	// Wakeup reason events can occur before or after the CPU running event they are attributed to,
	// so we store these in a separate buffer until the next CPU running event is encountered.

	// Existing wakeup reason(s). Append a delimiting pipe.
	if s.wakeupReasonBuf.Len() > 0 {
		s.wakeupReasonBuf.WriteString("|")
	}

	// Remove any leading or trailing double quotes in the wakeup reason we're adding for aesthetic purposes.
	// TODO: consider replacing this with JSON.
	n := stripQuotes(wr.name)
	if wr.start == curTime {
		// Instantaneous wakeup reason.
		s.wakeupReasonBuf.WriteString(fmt.Sprintf(`%v~%v`, curTime, n))
	} else {
		s.wakeupReasonBuf.WriteString(fmt.Sprintf(`%v~%v~%v`, wr.start, curTime, n))
	}
}

// wakeupReasons returns the currently stored wakeup reasons. If there are none, it appends an UnknownWakeup before returning.
func (s *State) wakeupReasons(curTime int64) string {
	if s.curWakeupReason != nil {
		s.appendWakeupReason(s.curWakeupReason, curTime)
	}
	if s.wakeupReasonBuf.Len() == 0 {
		t := curTime
		if s.runningEvent != nil {
			// If there's already a running event, mark the wakeup reason as starting when the running event started.
			t = s.runningEvent.e.Start
		}
		s.appendWakeupReason(&wakeupReason{name: UnknownWakeup, start: t}, curTime)
	}
	// Needs to be quoted, as any wakeup reason may have special characters such as commas.
	return fmt.Sprintf(`"%s"`, s.wakeupReasonBuf.String())
}

// PrintAllReset prints all active entries and resets the map.
func (s *State) PrintAllReset(curTime int64) {
	for _, e := range s.entries {
		if e.Desc == CPURunning {
			e.Value = s.wakeupReasons(curTime)
			s.wakeupReasonBuf.Reset()
		}
		s.Print(e.Desc, e.Type, e.Start, curTime, e.Value, e.Opt)
	}
	s.assignRunningEvent(nil)
	s.entries = make(map[Key]Entry)
}

// PrintActiveEvent prints out all active entries for the given metric name with the given end time,
// and deletes those entries from the map.
func (s *State) PrintActiveEvent(metric string, endMs int64) {
	for k, e := range s.entries {
		if e.Desc == metric {
			s.Print(e.Desc, e.Type, e.Start, endMs, e.Value, e.Opt)
			delete(s.entries, k)
		}
	}
}

// EntryState is a commmon interface for the various types,
// so the Entries can access them the same way.
type EntryState interface {
	// GetStartTime returns the start time of the entry.
	GetStartTime() int64
	// GetType returns the type of the entry:
	// "string", "bool", "float", "group", "int", "service", or "summary".
	GetType() string
	// GetValue returns the stored value of the entry.
	GetValue() string
	// GetKey returns the unique identifier for the entry.
	GetKey(string) Key
}
