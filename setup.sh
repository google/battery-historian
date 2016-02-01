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

CLOSURE_COMPILER_URL="http://dl.google.com/closure-compiler/compiler-latest.zip"
CLOSURE_LIBRARY_URL="https://codeload.github.com/google/closure-library/zip/master"

ERROR="

wget is not installed, could not download the closure compiler. Please install wget and rerun this script.

For downloading the closure compiler without wget,
please manually download the closure compiler code from $CLOSURE_COMPILER_URL
and unzip into the third_party/closure-compiler/ directory, then rerun this script.

"


# To cleanup
# rm -r third_party
# rm -r compiled

mkdir -p third_party
mkdir -p compiled

# Download closure library.
if [ ! -d "third_party/closure-library" ]; then
    wget "$CLOSURE_LIBRARY_URL"
    if [ $? -ne 0 ]; then
      echo "$ERROR"
    else
      unzip master -d third_party/
      rm master
      mv third_party/closure-library-master third_party/closure-library
    fi
fi

# Download closure compiler.
if [ ! -d "third_party/closure-compiler" ]; then
    wget --directory-prefix=third_party/closure-compiler "$CLOSURE_COMPILER_URL"
    if [ $? -ne 0 ]; then
      echo "$ERROR"
    else
      unzip third_party/closure-compiler/compiler-latest.zip -d third_party/closure-compiler
    fi
fi

# Generate compiled Javascript runfiles.
third_party/closure-library/closure/bin/build/depswriter.py --root="third_party/closure-library/closure/goog" --root_with_prefix="js ../../../../js" > compiled/historian_deps-runfiles.js

# Generate optimized version of the Javascript runfiles.
java -jar third_party/closure-compiler/compiler.jar --closure_entry_point historian.Historian \
      --js js/*.js \
      --js third_party/closure-library/closure/goog/base.js \
      --js third_party/closure-library/closure/goog/**/*.js \
      --only_closure_dependencies \
      --generate_exports \
      --js_output_file compiled/historian-optimized.js \
      --compilation_level SIMPLE_OPTIMIZATIONS
