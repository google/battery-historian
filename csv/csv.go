// Copyright 2015 Google Inc. All Rights Reserved.
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

// Package csv contains functions to store EntryState events,
// and print them in CSV format.
package csv

import (
	"fmt"
	"io"
)

// FileHeader is outputted as the first line in csv files.
const FileHeader = "metric,type,start_time,end_time,value,opt"

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

// State holds the csv writer, and the map from metric key to active entry.
type State struct {
	// For printing the CSV entries to.
	writer io.Writer

	entries map[Key]Entry

	rebootEvent *Entry
}

// Key is the unique identifier for an entry.
type Key struct {
	Metric, Identifier string
}

// NewState returns a new State.
func NewState(csvWriter io.Writer) *State {
	// Write the csv header.
	if csvWriter != nil {
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
		"Reboot",
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

// AddEntryWithOpt adds the given entry into the existing map, with the optional
// value set.
// If the entry already exists, it prints out the entry and deletes it.
func (s *State) AddEntryWithOpt(desc string, newState EntryState, curTime int64, opt string) {
	key := newState.GetKey(desc)

	if e, ok := s.entries[key]; ok {
		s.print(e.Desc, e.Type, e.Start, curTime, e.Value, e.Opt)
		delete(s.entries, key)
		return
	}
	if newState.GetStartTime() == 0 || newState.GetValue() == "" {
		return
	}
	s.entries[key] = Entry{
		desc,
		curTime,
		newState.GetType(),
		newState.GetValue(),
		opt,
	}
}

func (s *State) print(desc, metricType string, start, end int64, value, opt string) {
	if s.writer != nil {
		fmt.Fprintf(s.writer, "%s,%s,%d,%d,%s,%s\n", desc, metricType, start, end, value, opt)
	}
}

// PrintAllReset prints all active entries and resets the map.
func (s *State) PrintAllReset(curTime int64) {
	for _, e := range s.entries {
		s.print(e.Desc, e.Type, e.Start, curTime, e.Value, e.Opt)
	}
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
