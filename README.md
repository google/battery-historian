Battery Historian 2.0
=====================

Battery Historian is a tool to inspect battery related information and events on an Android device (Android 5.0 Lollipop and later: API Level 21+) while the device was on battery. It allows application developers to visualize system and application level events on a timeline and easily see various aggregated statistics since the device was last fully charged.

Introduction
------------
Battery Historian 2.0 is a complete rewrite in Go and uses some JavaScript visualization libraries to display battery related events on a timeline with panning and zooming functionality. In addition, v2.0 allows developers to pick an application and inspect the metrics that impact battery specific to the chosen application.


Getting Started
---------------
If you are new to the Go programming language:

* Follow the instructions available at <http://golang.org/doc/install> for downloading and installing the Go compilers, tools, and libraries.
* Create a workspace directory according to the instructions at
  <http://golang.org/doc/code.html#Organization> and ensure that `GOPATH` and
  `GOBIN` environment variables are appropriately set and added to your `$PATH`
  environment variable. `$GOBIN should be set to $GOPATH/bin`.

Next, install Go support for Protocol Buffers by running go get.

```
# Grab the code from the repository and install the proto package.
$ go get -u github.com/golang/protobuf/proto
$ go get -u github.com/golang/protobuf/protoc-gen-go
```

The compiler plugin, protoc-gen-go, will be installed in $GOBIN, which must be
in your $PATH for the protocol compiler, protoc, to find it.

Next, download the Battery Historian 2.0 code:


```
# Download Battery Historian 2.0
$ go get -u github.com/google/battery-historian

$ cd $GOPATH/src/github.com/google/battery-historian

# Compile Javascript files using the Closure compiler
$ bash setup.sh

# Run Historian on your machine (make sure $PATH contains $GOBIN)
$ go run cmd/battery-historian/battery-historian.go [--port <default:9999>]
```

Remember, you must always run battery-historian from inside the `$GOPATH/src/github.com/google/battery-historian` directory:

```
cd $GOPATH/src/github.com/google/battery-historian
go run cmd/battery-historian/battery-historian.go [--port <default:9999>]
```


#### How to take a bug report

To take a bug report from your Android device, you will need to enable USB debugging under `Settings > System > Developer Options`. On Android 4.2 and higher, the Developer options screen is hidden by default. You can enable this by following the instructions [here](<http://developer.android.com/tools/help/adb.html#Enabling>).

Next, to obtain a bug report from your development device

```
$ adb bugreport > bugreport.txt
```

### Start analyzing!
You are all set now. Run `historian` and visit <http://localhost:9999> and upload the `bugreport.txt` file to start analyzing.

By default, Android does not record timestamps for application-specific
userspace wakelock transitions even though aggregate statistics are maintained
on a running basis. If you want Historian to display detailed information about
each individual wakelock on the timeline, you should enable full wakelock reporting using the following command before starting your experiment:

```
adb shell dumpsys batterystats --enable full-wake-history
```

Note that by enabling full wakelock reporting the battery history log overflows
in a few hours. Use this option for short test runs (3-4 hrs).

To reset aggregated battery stats and timeline at the beginning of a measurement:

```
adb shell dumpsys batterystats --reset
```

Screenshots
-----------
![Visualization](/screenshots/viz.png "Timeline Visualization")

![System](/screenshots/stats.png "Aggregated System statistics since the device was last fully charged")

![App](/screenshots/app.png "Application specific statistics")

Advanced
--------
The following information is for advanced users only who are interested in modifying the code.

##### Modifying the proto files
If you modify the proto files (pb/\*/\*.proto), you will need to regenerate the compiled Go output files using `regen_proto.sh`.

##### Other command line tools
```
# System stats
$ go run exec/local_checkin_parse.go --input=bugreport.txt

# Timeline analysis
$ go run exec/local_history_parse.go --summary=totalTime --input=bugreport.txt
```


Support
-------

- G+ Community (Discussion Thread: Battery Historian): https://plus.google.com/communities/112943340699633396715

If you've found an error in this sample, please file an issue:
<https://github.com/google/battery-historian/issues>

Patches are encouraged, and may be submitted by forking this project and
submitting a pull request through GitHub.

License
-------

Copyright 2015 Google, Inc.

Licensed to the Apache Software Foundation (ASF) under one or more contributor
license agreements.  See the NOTICE file distributed with this work for
additional information regarding copyright ownership.  The ASF licenses this
file to you under the Apache License, Version 2.0 (the "License"); you may not
use this file except in compliance with the License.  You may obtain a copy of
the License at

  <http://www.apache.org/licenses/LICENSE-2.0>

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  See the
License for the specific language governing permissions and limitations under
the License.
