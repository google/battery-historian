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
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

var (
	// ServiceDumpRE is a regular expression to match the beginning of a service dump.
	ServiceDumpRE = regexp.MustCompile(`^DUMP\s+OF\s+SERVICE\s+(?P<service>\S+):`)

	// PIIRE is a regular expression to match any PII string of the form abc@xxx.yyy.
	PIIRE = regexp.MustCompile(`(?P<prefix>\S+/)?` + `(?P<account>\S+)` + `@` + `(?P<suffix>\S+\.\S+)`)
)

// ScrubPII scrubs any part of the string that looks like an email address (@<blah>.com)
// From:
//     com.google.android.apps.plus.content.EsProvider/com.google/john.doe@gmail.com/extra
// To:
//     com.google.android.apps.plus.content.EsProvider/com.google/XXX@gmail.com/extra
func ScrubPII(input string) string {
	if matches, result := SubexpNames(PIIRE, input); matches {
		return fmt.Sprintf("%sXXX@%s", result["prefix"], result["suffix"])
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

// ErrorsToString converts an array of errors into a newline delimited string.
func ErrorsToString(errs []error) string {
	var errorB bytes.Buffer
	for _, e := range errs {
		fmt.Fprintln(&errorB, e.Error())
	}
	return errorB.String()
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
