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

// Package sliceparts contains routines to parse components of string slices
// into string, int32, and int64 variables.
package sliceparse

import (
	"fmt"
	"strconv"
)

// Consume parses len(output) elements of input into their respective output
// variables.  Each output must be a pointer to a supported type.  What is
// stored to the output depends on its type:
//    *string: input[i] is directly copied
//    *int32: strconv.ParseInt(input[i], 10, 32) is called
//    *int64: strconv.ParseInt(input[i], 10, 64) is called
//
// If an output element is a nil interface{}, the associated input element is
// skipped.  A nil pointer value is also accepted - in that case the input
// element is validated but no attempt to store it is made.
//
// If len(output) > len(input), an error is returned.
//
// If any output has an unsupported type, an error is returned.
//
// If strconv.ParseInt returns an error for any integer output, its error is
// returned.
//
// Otherwise, this function returns (input[len(output):], nil).
func Consume(input []string, output ...interface{}) (remaining []string, err error) {
	if len(input) < len(output) {
		return nil, fmt.Errorf("Input of size %d for %d outputs", len(input), len(output))
	}
	for i, outI := range output {
		if outI == nil {
			continue
		}
		switch out := outI.(type) {
		case *string:
			if out != nil {
				*out = input[i]
			}
		case *int32:
			if n, err := strconv.ParseInt(input[i], 10, 32); err != nil {
				return nil, err
			} else if out != nil {
				*out = int32(n)
			}
		case *int64:
			if n, err := strconv.ParseInt(input[i], 10, 64); err != nil {
				return nil, err
			} else if out != nil {
				*out = n
			}
		case *float32:
			if n, err := strconv.ParseFloat(input[i], 32); err != nil {
				return nil, err
			} else if out != nil {
				*out = float32(n)
			}
		case *float64:
			if n, err := strconv.ParseFloat(input[i], 64); err != nil {
				return nil, err
			} else if out != nil {
				*out = n
			}
		default:
			return nil, fmt.Errorf("Unsupported output type: %T", out)
		}
	}
	return input[len(output):], nil
}
