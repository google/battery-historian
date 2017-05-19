#!/bin/bash

#
# Copyright 2015 Google Inc. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

# To regenerate the compiled Go files if the protos are modified.
cd $GOPATH/src
protoc --go_out=. github.com/google/battery-historian/pb/batterystats_proto/*.proto
protoc --go_out=. github.com/google/battery-historian/pb/build_proto/*.proto
protoc --go_out=. github.com/google/battery-historian/pb/metrics_proto/*.proto
protoc --go_out=. github.com/google/battery-historian/pb/session_proto/*.proto
protoc --go_out=. github.com/google/battery-historian/pb/usagestats_proto/*.proto
