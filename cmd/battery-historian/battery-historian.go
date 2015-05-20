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

// Historian v2 analyzes bugreports and outputs battery analysis results.
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"

	"github.com/google/battery-historian/analyzer"
)

var (
	optimized = flag.Bool("optimized", true, "Whether to output optimized js files. Disable for local debugging.")
	port      = flag.Int("port", 9999, "service port")
)

type analysisServer struct{}

func (*analysisServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	log.Printf("Starting processing for: %s", r.Method)

	analyzer.UploadHandler(w, r)
}

func initFrontend() {
	http.HandleFunc("/", analyzer.UploadHandler)
	http.Handle("/static/", http.FileServer(http.Dir(".")))
	http.Handle("/compiled/", http.FileServer(http.Dir(".")))

	if *optimized == false {
		http.Handle("/third_party/", http.FileServer(http.Dir(".")))
		http.Handle("/js/", http.FileServer(http.Dir(".")))
	}
}

func main() {
	flag.Parse()

	initFrontend()
	analyzer.InitTemplates()
	analyzer.SetIsOptimized(*optimized)
	log.Println("Listening on port: ", *port)
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", *port), nil))
}
