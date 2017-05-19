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

// Package historianutils is a library of common utility functions for Battery Historian processing.
package historianutils

import (
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	// ServiceDumpRE is a regular expression to match the beginning of a service dump.
	ServiceDumpRE = regexp.MustCompile(`^DUMP\s+OF\s+SERVICE\s+(?P<service>\S+):`)

	// piiEmailRE is a regular expression to match any PII string of the form abc@xxx.yyy.
	piiEmailRE = regexp.MustCompile(`(?P<prefix>\S+/)?` + `(?P<account>\S+)` + `@` + `(?P<suffix>\S+\.\S+)`)

	// piiSyncRE is a regular expression to match any PII string of the form *sync*/blah/blah/pii
	piiSyncRE = regexp.MustCompile(`(?P<prefix>\*sync\*/\S+/)(?P<account>\S+)`)
)

// ScrubPII scrubs any part of the string that looks like PII (eg. an email address).
// From:
//     com.google.android.apps.plus.content.EsProvider/com.google/john.doe@gmail.com/extra
//     or
//     *sync*/com.app.android.conversations/com.app.android.account/Mr. Noogler
// To:
//     com.google.android.apps.plus.content.EsProvider/com.google/XXX@gmail.com/extra
//     or
//     *sync*/com.app.android.conversations/com.app.android.account/XXX
func ScrubPII(input string) string {
	if matches, result := SubexpNames(piiEmailRE, input); matches {
		return fmt.Sprintf("%sXXX@%s", result["prefix"], result["suffix"])
	} else if matches, result := SubexpNames(piiSyncRE, input); matches {
		// Syncs often have the PII at the end, though not always in email form.
		return fmt.Sprintf("%sXXX", result["prefix"])
	}
	return input
}

// SubexpNames returns a mapping of the sub-expression names to values if the Regexp
// successfully matches the string, otherwise, it returns false.
func SubexpNames(r *regexp.Regexp, s string) (bool, map[string]string) {
	if matches := r.FindStringSubmatch(strings.TrimSpace(s)); matches != nil {
		names := r.SubexpNames()
		result := make(map[string]string)
		for i, match := range matches {
			result[names[i]] = strings.TrimSpace(match)
		}
		return true, result
	}
	return false, nil
}

// AbsFloat32 returns the absolute value of a float32 number.
func AbsFloat32(x float32) float32 {
	if x < 0 {
		return -x
	}
	return x
}

// ErrorsToString converts an array of errors into a newline delimited string.
func ErrorsToString(errs []error) string {
	var errorB bytes.Buffer
	for _, e := range errs {
		fmt.Fprintln(&errorB, e.Error())
	}
	return errorB.String()
}

// GzipCompress compresses byte data.
func GzipCompress(uncompressed []byte) ([]byte, error) {
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	_, err := w.Write(uncompressed)
	w.Close() // Must close this first to flush the bytes to the buffer.
	return b.Bytes(), err
}

// MaxInt64 returns the higher of a or b.
func MaxInt64(a int64, b int64) int64 {
	if a >= b {
		return a
	}
	return b
}

// ParseDurationWithDays parses a duration string and returns the milliseconds. e.g. 3d1h2m
// This is the same as Golang's time.ParseDuration, but also handles days. Assumes days are 24 hours, which is not exact but usually good enough for what we care about.
func ParseDurationWithDays(input string) (int64, error) {
	if input == "" {
		return 0, errors.New("cannot parse duration from empty string")
	}
	dur := time.Duration(0)

	dayIdx := strings.Index(input, "d")
	// Golang's time.ParseDuration throws an error on strings containing days,
	// so we need to parse it and remove it from the string.
	if dayIdx >= 0 {
		days, err := strconv.Atoi(input[0:dayIdx])
		if err != nil {
			return 0, err
		}
		dur += 24 * time.Hour * time.Duration(days)
		input = input[dayIdx+1:]
	}
	if input != "" {
		parsed, err := time.ParseDuration(input)
		if err != nil {
			return 0, err
		}
		dur += parsed
	}
	return dur.Nanoseconds() / int64(time.Millisecond), nil
}

// RunCommand executes the given command and returns the output.
func RunCommand(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	// Stdout pipe for reading the generated output.
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	// Run the script.
	if err := cmd.Run(); err != nil {
		c := name
		if len(args) > 0 {
			c += " " + strings.Join(args, " ")
		}
		return "", fmt.Errorf("failed to run command %q:\n  %v\n  %s", c, err, stderr.String())
	}

	return stdout.String(), nil
}
