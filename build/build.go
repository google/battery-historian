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

// Package build provides functions for dealing with Android build fingerprints.
package build

import (
	"regexp"
	"strings"

	"github.com/golang/protobuf/proto"

	pb "github.com/google/battery-historian/pb/build_proto"
)

var fingerprintRE = regexp.MustCompile(
	`^([^/]+)/([^/]+)/([^:]+):([^/]+)/([^/]+)/([^:]+):([^/]+)/([^/]+)`)

func Build(f string) *pb.Build {
	b := &pb.Build{}
	b.Fingerprint = proto.String(f)
	if m := fingerprintRE.FindStringSubmatch(f); len(m) == 9 {
		b.Brand = proto.String(m[1])
		b.Product = proto.String(m[2])
		b.Device = proto.String(m[3])
		b.Release = proto.String(m[4])
		b.BuildId = proto.String(m[5])
		b.Incremental = proto.String(m[6])
		b.Type = proto.String(m[7])
		b.Tags = strings.Split(m[8], ",")
	}
	return b
}
