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

// Package analyzer analyzes the uploaded bugreport and displays the results to the user.
package analyzer

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/golang/protobuf/proto"

	"github.com/google/battery-historian/activity"
	"github.com/google/battery-historian/bugreportutils"
	"github.com/google/battery-historian/checkinparse"
	"github.com/google/battery-historian/checkinutil"
	"github.com/google/battery-historian/historianutils"
	"github.com/google/battery-historian/kernel"
	"github.com/google/battery-historian/packageutils"
	"github.com/google/battery-historian/parseutils"
	"github.com/google/battery-historian/powermonitor"
	"github.com/google/battery-historian/presenter"

	bspb "github.com/google/battery-historian/pb/batterystats_proto"
	sessionpb "github.com/google/battery-historian/pb/session_proto"
	usagepb "github.com/google/battery-historian/pb/usagestats_proto"
)

const (
	// maxFileSize is the maximum file size allowed for uploaded package.
	maxFileSize     = 50 * 1024 * 1024 // 50 MB Limit
	minSupportedSDK = 21               // We only support Lollipop bug reports and above

	numberOfFilesToCompare = 2
)

var (
	// Initialized in InitTemplates()
	uploadTempl  *template.Template
	resultTempl  *template.Template
	compareTempl *template.Template

	// Initialized in SetScriptsDir()
	scriptsDir    string
	isOptimizedJs bool

	// Initialized in SetResVersion()
	resVersion int
)

type historianData struct {
	html string
	err  error
}

type csvData struct {
	csv  string
	errs []error
}

type uploadResponse struct {
	SDKVersion          int                      `json:"sdkVersion"`
	HistorianV2CSV      string                   `json:"historianV2Csv"`
	LevelSummaryCSV     string                   `json:"levelSummaryCsv"`
	DisplayPowermonitor bool                     `json:"displayPowermonitor"`
	ReportVersion       int32                    `json:"reportVersion"`
	AppStats            []presenter.AppStat      `json:"appStats"`
	DeviceCapacity      float32                  `json:"deviceCapacity"`
	HistogramStats      presenter.HistogramStats `json:"histogramStats"`
	TimeToDelta         map[string]string        `json:"timeToDelta"`
	CriticalError       string                   `json:"criticalError"` // Critical errors are ones that cause parsing of important data to abort early and should be shown prominently to the user.
	FileName            string                   `json:"fileName"`
	Location            string                   `json:"location"`
}

type uploadResponseCompare struct {
	UploadResponse  []uploadResponse                 `json:"UploadResponse"`
	HTML            string                           `json:"html"`
	UsingComparison bool                             `json:"usingComparison"`
	CombinedCheckin presenter.CombinedCheckinSummary `json:"combinedCheckin"`
}

type summariesData struct {
	summaries       []parseutils.ActivitySummary
	historianV2CSV  string
	levelSummaryCSV string
	timeToDelta     map[string]string
	errs            []error
	overflow        bool
}

type checkinData struct {
	batterystats *bspb.BatteryStats
	warnings     []string
	err          []error
}

type activityManagerData struct {
	csv      string
	warnings []string
	errs     []error
}

// UploadedFile is a user uploaded bugreport or its associated file to be analyzed.
type UploadedFile struct {
	FileType string
	FileName string
	Contents []byte
}

// ParsedData holds the extracted details from the parsing of each file.
type ParsedData struct {
	// The kernel trace file needs to be processed with a bug report, so we save the file names here to be processed after reading in all the files.
	bugReport string
	// Error if bugreport could not be saved.
	brSaveErr   error
	kernelTrace string
	// Error if kernel trace file could not be saved.
	kernelSaveErr error
	deviceType    string

	responseArr []uploadResponse
	kd          *csvData
	md          *csvData
	data        []presenter.HTMLData
}

// BatteryStatsInfo holds the extracted batterystats details for a bugreport.
type BatteryStatsInfo struct {
	Filename string
	Stats    *bspb.BatteryStats
	Meta     *bugreportutils.MetaInfo
}

// Cleanup removes all temporary files written by the ParsedData analyzer.
// Should be called after ParsedData is no longer needed.
func (pd *ParsedData) Cleanup() {
	if pd.bugReport != "" {
		os.Remove(pd.bugReport)
	}
	if pd.kernelTrace != "" {
		os.Remove(pd.kernelTrace)
	}
}

// SendAsJSON creates and sends the HTML output and json response from the ParsedData.
func (pd *ParsedData) SendAsJSON(w http.ResponseWriter) {
	if err := pd.processKernelTrace(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Append any parsed kernel or powermonitor CSVs to the Historian V2 CSV.
	if err := pd.appendCSVs(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var buf bytes.Buffer
	var merge presenter.MultiFileHTMLData
	if len(pd.data) == numberOfFilesToCompare {
		merge = presenter.MultiFileData(pd.data)
		if err := compareTempl.Execute(&buf, merge); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		if pd.brSaveErr != nil {
			pd.data[0].Error = strings.Join([]string{pd.data[0].Error, pd.brSaveErr.Error()}, "\n")
		}
		if pd.kernelSaveErr != nil {
			pd.data[0].Error = strings.Join([]string{pd.data[0].Error, pd.kernelSaveErr.Error()}, "\n")
		}
		if err := resultTempl.Execute(&buf, pd.data[0]); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	js, err := json.Marshal(uploadResponseCompare{
		UploadResponse:  pd.responseArr,
		HTML:            buf.String(),
		UsingComparison: (len(pd.data) == numberOfFilesToCompare),
		CombinedCheckin: merge.CombinedCheckinData,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(js)
}

// processKernelTrace converts the kernel trace file with a bug report into a Historian parseable format, and then parses the result into a CSV.
func (pd *ParsedData) processKernelTrace() error {
	// No kernel trace file to process.
	if pd.kernelTrace == "" {
		return nil
	}
	if pd.bugReport == "" {
		return errors.New("no bug report found for the provided kernel trace file")
	}
	if !kernel.IsSupportedDevice(pd.deviceType) {
		return fmt.Errorf("device %v not supported for kernel trace file parsing", pd.deviceType)
	}
	// Call the python script to convert the trace file into a Historian parseable format.
	csv, err := generateKernelCSV(pd.bugReport, pd.kernelTrace, pd.deviceType)
	if strings.TrimSpace(csv) == "" {
		return errors.New("no CSV output was generated from the kernel trace file")
	}
	if err != nil {
		return err
	}
	// Parse the file as a kernel wakesource trace file.
	return pd.parseKernelFile(pd.kernelTrace, csv)
}

// Data returns the data field from ParsedData
func (pd *ParsedData) Data() []presenter.HTMLData {
	return pd.data
}

// appendCSVs appends any parsed kernel or powermonitor CSVs to the Historian V2 CSV.
func (pd *ParsedData) appendCSVs() error {
	// Need to append the kernel and powermonitor CSV entries to the end of the existing CSV.
	if pd.kd != nil {
		if len(pd.data) == 0 {
			return errors.New("no bug report found for the provided kernel trace file")
		}
		if len(pd.data) > 1 {
			return errors.New("kernel trace file uploaded with more than one bug report")
		}
		pd.responseArr[0].HistorianV2CSV = appendCSVs(pd.responseArr[0].HistorianV2CSV, pd.kd.csv)
		pd.data[0].Error += historianutils.ErrorsToString(pd.kd.errs)
	}

	if pd.md != nil {
		if len(pd.data) == 0 {
			return errors.New("no bug report found for the provided powermonitor file")
		}
		if len(pd.data) > 1 {
			return errors.New("powermonitor file uploaded with more than one bug report")
		}
		pd.responseArr[0].DisplayPowermonitor = true
		// Need to append the powermonitor CSV entries to the end of the existing CSV.
		pd.responseArr[0].HistorianV2CSV = appendCSVs(pd.responseArr[0].HistorianV2CSV, pd.md.csv)
		pd.data[0].Error += historianutils.ErrorsToString(pd.md.errs)
	}
	return nil
}

// parseKernelFile processes the kernel file and stores the result in the ParsedData.
func (pd *ParsedData) parseKernelFile(fname, contents string) error {
	// Try to parse the file as a kernel file.
	if valid, output, extraErrs := kernel.Parse(contents); valid {
		pd.kd = &csvData{output, extraErrs}
		return nil
	}
	return fmt.Errorf("%v: invalid kernel wakesource trace file", fname)
}

// parsePowermonitorFile processes the powermonitor file and stores the result in the ParsedData.
func (pd *ParsedData) parsePowermonitorFile(fname, contents string) error {
	if valid, output, extraErrs := powermonitor.Parse(contents); valid {
		pd.md = &csvData{output, extraErrs}
		return nil
	}
	return fmt.Errorf("%v: invalid powermonitor file", fname)
}

// templatePath expands a template filename into a full resource path for that template.
func templatePath(dir, tmpl string) string {
	if len(dir) == 0 {
		dir = "./templates"
	}
	return path.Join(dir, tmpl)
}

// scriptsPath expands the script filename into a full resource path for the script.
func scriptsPath(dir, script string) string {
	if len(dir) == 0 {
		dir = "./scripts"
	}
	return path.Join(dir, script)
}

// InitTemplates initializes the HTML templates after google.Init() is called.
// google.Init() must be called before resources can be accessed.
func InitTemplates(dir string) {
	uploadTempl = template.Must(template.ParseFiles(
		templatePath(dir, "base.html"), templatePath(dir, "body.html"), templatePath(dir, "upload.html"),
	))

	// base.html is intentionally excluded from resultTempl. resultTempl is loaded into the HTML
	// generated by uploadTempl, so attempting to include base.html here causes some of the
	// javascript files to be imported twice, which causes things to start blowing up.
	resultTempl = template.Must(template.ParseFiles(
		templatePath(dir, "body.html"), templatePath(dir, "summaries.html"),
		templatePath(dir, "checkin.html"), templatePath(dir, "history.html"), templatePath(dir, "appstats.html"),
		templatePath(dir, "tables.html"), templatePath(dir, "tablesidebar.html"),
		templatePath(dir, "histogramstats.html"),
	))
	compareTempl = template.Must(template.ParseFiles(
		templatePath(dir, "body.html"), templatePath(dir, "compare_summaries.html"),
		templatePath(dir, "compare_checkin.html"), templatePath(dir, "compare_history.html"),
		templatePath(dir, "tablesidebar.html"), templatePath(dir, "tables.html"),
		templatePath(dir, "appstats.html"), templatePath(dir, "histogramstats.html"),
	))
}

// SetScriptsDir sets the directory of the Historian and kernel trace Python scripts.
func SetScriptsDir(dir string) {
	scriptsDir = dir
}

// SetResVersion sets the current version to force reloading of JS and CSS files.
func SetResVersion(v int) {
	resVersion = v
}

// SetIsOptimized sets whether the JS will be optimized.
func SetIsOptimized(optimized bool) {
	isOptimizedJs = optimized
}

func closeConnection(w http.ResponseWriter, s string) {
	if flusher, ok := w.(http.Flusher); ok {
		w.Header().Set("Connection", "close")
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(s)))
		w.WriteHeader(http.StatusExpectationFailed)
		io.WriteString(w, s)
		flusher.Flush()
	}
	log.Println(s, " Closing connection.")
	conn, _, _ := w.(http.Hijacker).Hijack()
	conn.Close()
}

// UploadHandler serves the upload html page.
func UploadHandler(w http.ResponseWriter, r *http.Request) {
	// If false, the upload template will load closure and js files in the header.
	uploadData := struct {
		IsOptimizedJs bool
		ResVersion    int
	}{
		isOptimizedJs,
		resVersion,
	}

	if err := uploadTempl.Execute(w, uploadData); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// HTTPAnalyzeHandler processes the bugreport package uploaded via an http request's multipart body.
func HTTPAnalyzeHandler(w http.ResponseWriter, r *http.Request) {
	// Do not accept files that are greater than 50 MBs
	if r.ContentLength > maxFileSize {
		closeConnection(w, "File too large (>50MB).")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxFileSize)
	log.Printf("Trace starting reading uploaded file. %d bytes", r.ContentLength)
	defer log.Printf("Trace ended analyzing file.")

	var refCount int
	//get the multipart reader for the request.
	reader, err := r.MultipartReader()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var fs []UploadedFile
	//copy each part to destination.
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}

		// If part.FileName() is empty, skip this iteration.
		if part.FileName() == "" {
			continue
		}

		b, err := ioutil.ReadAll(part)
		if err != nil {
			http.Error(w, "Failed to read file. Please try again.", http.StatusInternalServerError)
			return
		}
		if len(b) == 0 {
			continue
		}

		files, err := bugreportutils.Contents(part.FileName(), b)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to read file contents: %v", err), http.StatusInternalServerError)
			return
		}

		var contents []byte
		valid := false
		fname := ""
	contentLoop:
		for n, f := range files {
			switch part.FormName() {
			case "bugreport", "bugreport2":
				if bugreportutils.IsBugReport(f) {
					// TODO: handle the case of additional kernel and powermonitor files within a single uploaded file
					valid = true
					contents = f
					fname = n
					break contentLoop
				}
			case "kernel":
				if kernel.IsTrace(f) {
					valid = true
					contents = f
					fname = n
					break contentLoop
				}
			case "powermonitor":
				if powermonitor.IsValid(f) {
					valid = true
					contents = f
					fname = n
					break contentLoop
				}
			default:
				valid = true
				contents = f
				fname = n
				break contentLoop
			}
		}

		if !valid {
			http.Error(w, fmt.Sprintf("%s does not contain a valid %s file", part.FileName(), part.FormName()), http.StatusInternalServerError)
			return
		}

		fs = append(fs, UploadedFile{part.FormName(), fname, contents})
	}
	AnalyzeAndResponse(w, fs, refCount)
}

// AnalyzeAndResponse analyzes the uploaded files and sends the HTTP response in JSON.
func AnalyzeAndResponse(w http.ResponseWriter, files []UploadedFile, refCount int) {
	pd := &ParsedData{}
	defer pd.Cleanup()
	if err := pd.AnalyzeFiles(files, refCount); err != nil {
		http.Error(w, fmt.Sprintf("failed to analyze file: %v", err), http.StatusInternalServerError)
		return
	}
	pd.SendAsJSON(w)
}

// AnalyzeFiles processes and analyzes a bugreport package.
func (pd *ParsedData) AnalyzeFiles(files []UploadedFile, refCount int) error {
	hasBugreport := false
	for _, file := range files {
		contents := string(file.Contents)
		switch file.FileType {
		case "bugreport", "bugreport2":
			// Parse the bugreport.
			if err := pd.parseBugReport(file.FileName, contents); err != nil {
				return fmt.Errorf("error parsing bugreport: %v", err)
			}
			if file.FileType == "bugreport" {
				hasBugreport = true
			}
			// Write the bug report to a file in case we need it to process a kernel trace file.
			if len(pd.data) < numberOfFilesToCompare {
				tmpFile, err := writeTempFile(contents)
				if err != nil {
					return fmt.Errorf("could not write bugreport: %v", err)
				}
				pd.bugReport = tmpFile
			}

		case "kernel":
			if !kernel.IsTrace(file.Contents) {
				return fmt.Errorf("invalid kernel trace file: %v", file.FileName)
			}
			if pd.kernelTrace != "" {
				log.Printf("more than one kernel trace file found")
				continue
			}
			// Need bug report to process kernel trace file, so store the file for later processing.
			tmpFile, err := writeTempFile(contents)
			if err != nil {
				return fmt.Errorf("could not write kernel trace file: %v", err)
			}
			pd.kernelTrace = tmpFile

		case "powermonitor":
			// Parse the powermonitor file.
			if err := pd.parsePowermonitorFile(file.FileName, contents); err != nil {
				return fmt.Errorf("error parsing powermonitor file: %v", err)
			}
		default:
			// File does not have a supported file type.
			return fmt.Errorf("invalid file %s of type %s", file.FileName, file.FileType)
		}
	}

	if !hasBugreport {
		return errors.New("missing bugreport file")
	}
	return nil
}

// extractHistogramStats retrieves the data needed to draw the histogram charts.
func extractHistogramStats(data presenter.HTMLData) presenter.HistogramStats {
	return presenter.HistogramStats{
		ScreenOffDischargeRatePerHr:         data.CheckinSummary.ScreenOffDischargeRatePerHr,
		ScreenOnDischargeRatePerHr:          data.CheckinSummary.ScreenOnDischargeRatePerHr,
		ScreenOffUptimePercentage:           data.CheckinSummary.ScreenOffUptimePercentage,
		ScreenOnTimePercentage:              data.CheckinSummary.ScreenOnTimePercentage,
		PartialWakelockTimePercentage:       data.CheckinSummary.PartialWakelockTimePercentage,
		KernelOverheadTimePercentage:        data.CheckinSummary.KernelOverheadTimePercentage,
		SignalScanningTimePercentage:        data.CheckinSummary.SignalScanningTimePercentage,
		MobileActiveTimePercentage:          data.CheckinSummary.MobileActiveTimePercentage,
		MobileKiloBytesPerHr:                data.CheckinSummary.MobileKiloBytesPerHr,
		WifiKiloBytesPerHr:                  data.CheckinSummary.WifiKiloBytesPerHr,
		PhoneCallTimePercentage:             data.CheckinSummary.PhoneCallTimePercentage,
		DeviceIdlingTimePercentage:          data.CheckinSummary.DeviceIdlingTimePercentage,
		FullWakelockTimePercentage:          data.CheckinSummary.FullWakelockTimePercentage,
		InteractiveTimePercentage:           data.CheckinSummary.InteractiveTimePercentage,
		DeviceIdleModeEnabledTimePercentage: data.CheckinSummary.DeviceIdleModeEnabledTimePercentage,
		TotalAppGPSUseTimePerHour:           data.CheckinSummary.TotalAppGPSUseTimePerHour,
		BluetoothOnTimePercentage:           data.CheckinSummary.BluetoothOnTimePercentage,
		LowPowerModeEnabledTimePercentage:   data.CheckinSummary.LowPowerModeEnabledTimePercentage,
		TotalAppANRCount:                    data.CheckinSummary.TotalAppANRCount,
		TotalAppCrashCount:                  data.CheckinSummary.TotalAppCrashCount,
		WifiDischargeRatePerHr:              data.CheckinSummary.WifiDischargeRatePerHr,
		BluetoothDischargeRatePerHr:         data.CheckinSummary.BluetoothDischargeRatePerHr,
		WifiOnTimePercentage:                data.CheckinSummary.WifiOnTimePercentage,
		WifiTransmitTimePercentage:          data.CheckinSummary.WifiTransmitTimePercentage,
		BluetoothTransmitTimePercentage:     data.CheckinSummary.BluetoothTransmitTimePercentage,
		TotalAppSyncsPerHr:                  data.CheckinSummary.TotalAppSyncsPerHr,
		TotalAppWakeupsPerHr:                data.CheckinSummary.TotalAppWakeupsPerHr,
		TotalAppCPUPowerPct:                 data.CheckinSummary.TotalAppCPUPowerPct,
		TotalAppFlashlightUsePerHr:          data.CheckinSummary.TotalAppFlashlightUsePerHr,
		TotalAppCameraUsePerHr:              data.CheckinSummary.TotalAppCameraUsePerHr,
		ScreenBrightness:                    data.CheckinSummary.ScreenBrightness,
		SignalStrength:                      data.CheckinSummary.SignalStrength,
		WifiSignalStrength:                  data.CheckinSummary.WifiSignalStrength,
		BluetoothState:                      data.CheckinSummary.BluetoothState,
		DataConnection:                      data.CheckinSummary.DataConnection,
	}
}

// writeTempFile writes the contents to a temporary file.
func writeTempFile(contents string) (string, error) {
	tmpFile, err := ioutil.TempFile("", "historian")
	if err != nil {
		return "", err
	}
	tmpFile.WriteString(contents)
	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpFile.Name())
		return "", err
	}
	return tmpFile.Name(), nil
}

// parseBugReport analyzes the given bug report contents, and updates the ParsedData object.
func (pd *ParsedData) parseBugReport(fname, contents string) error {
	meta, err := bugreportutils.ParseMetaInfo(contents)
	if err != nil {
		// If there are issues getting the meta info, then the file is most likely not a bug report.
		return errors.New("error parsing the bug report. Please provide a well formed bug report")
	}

	log.Printf("Trace started analyzing file.")
	// Generate the Historian plot and parse batterystats and activity manager simultaneously.
	historianCh := make(chan historianData)
	summariesCh := make(chan summariesData)
	checkinCh := make(chan checkinData)
	activityManagerCh := make(chan activityManagerData)

	// Create a temporary file to save the bug report, for the Historian script.
	brFile, err := writeTempFile(contents)

	historianOutput := historianData{"", err}
	if err == nil {
		// Don't run the Historian script if could not create temporary file.
		defer os.Remove(brFile)
		go func() {
			html, err := generateHistorianPlot(fname, brFile)
			historianCh <- historianData{html, err}
			log.Printf("Trace finished generating Historian plot.")
		}()
	}

	var errs []error
	ce := ""
	if meta.SdkVersion < minSupportedSDK {
		ce = "Unsupported bug report version."
		errs = append(errs, errors.New("unsupported bug report version"))
	} else {
		// No point running these if we don't support the sdk version since we won't get any data from them.
		bs := bugreportutils.ExtractBatterystatsCheckin(contents)

		if strings.Contains(bs, "Exception occurred while dumping") {
			// TODO: Display activity manager events even if battery data is invalid. Currently they will not be displayed.
			ce = "Exception found in battery dump."
			errs = append(errs, errors.New("exception found in battery dump"))
			close(summariesCh)
			close(checkinCh)
		} else {
			pkgs, pkgErrs := packageutils.ExtractAppsFromBugReport(contents)
			errs = append(errs, pkgErrs...)

			// Activity manager events are only parsed for supported sdk versions, even though they are still present in unsupported sdk version reports.
			// This is as the events are rendered with Historian v2, which is not generated for unsupported sdk versions.
			go func() {
				amCSV, warnings, errs := activity.Parse(pkgs, contents)
				activityManagerCh <- activityManagerData{amCSV, warnings, errs}
			}()

			go func() {
				var ctr checkinutil.IntCounter

				s := &sessionpb.Checkin{
					Checkin:          proto.String(bs),
					BuildFingerprint: proto.String(meta.BuildFingerprint),
				}
				stats, warnings, pbsErrs := checkinparse.ParseBatteryStats(&ctr, checkinparse.CreateCheckinReport(s), pkgs)
				checkinCh <- checkinData{stats, warnings, pbsErrs}
				log.Printf("Trace finished processing checkin.")
				if stats == nil {
					ce = "Could not parse aggregated battery stats."
					errs = append(errs, errors.New("could not parse aggregated battery stats"))
					// Only returning from this goroutine.
					return
				}
				pd.deviceType = stats.GetBuild().GetDevice()
			}()

			go func() {
				summariesCh <- analyze(bs, pkgs)
				log.Printf("Trace finished processing summary data.")
			}()
		}
	}

	if historianOutput.err == nil {
		historianOutput = <-historianCh
	}
	if historianOutput.err != nil {
		historianOutput.html = fmt.Sprintf("Error generating historian plot: %v", historianOutput.err)
	}

	var summariesOutput summariesData
	var checkinOutput checkinData
	var activityManagerOutput activityManagerData
	if meta.SdkVersion >= minSupportedSDK {
		summariesOutput = <-summariesCh
		checkinOutput = <-checkinCh
		activityManagerOutput = <-activityManagerCh
		errs = append(errs, append(summariesOutput.errs, append(activityManagerOutput.errs, checkinOutput.err...)...)...)
	}

	log.Printf("Trace finished generating Historian plot and summaries.")
	var loc string
	if d, err := bugreportutils.DumpState(contents); err != nil {
		log.Printf("Failed to extract time information from bugreport dumpstate: %v", err)
	} else {
		loc = d.Location().String()
	}

	warnings := append(checkinOutput.warnings, activityManagerOutput.warnings...)
	data := presenter.Data(meta,
		fname, summariesOutput.summaries,
		checkinOutput.batterystats, historianOutput.html,
		warnings,
		errs, summariesOutput.overflow)

	pd.responseArr = append(pd.responseArr, uploadResponse{
		SDKVersion:      data.SDKVersion,
		HistorianV2CSV:  appendCSVs(summariesOutput.historianV2CSV, activityManagerOutput.csv),
		LevelSummaryCSV: summariesOutput.levelSummaryCSV,
		ReportVersion:   data.CheckinSummary.ReportVersion,
		AppStats:        data.AppStats,
		DeviceCapacity:  checkinOutput.batterystats.GetSystem().GetPowerUseSummary().GetBatteryCapacityMah(),
		HistogramStats:  extractHistogramStats(data),
		TimeToDelta:     summariesOutput.timeToDelta,
		CriticalError:   ce,
		FileName:        data.Filename,
		Location:        loc,
	})
	pd.data = append(pd.data, data)
	return nil
}

// appendCSVs appends a newline character to end of the first CSV if not present, then joins the two CSVs.
func appendCSVs(csv1, csv2 string) string {
	if strings.LastIndex(csv1, "\n") != len(csv1)-1 {
		csv1 += "\n"
	}
	return csv1 + csv2
}

func analyze(bugReport string, pkgs []*usagepb.PackageInfo) summariesData {
	upm, errs := parseutils.UIDAndPackageNameMapping(bugReport, pkgs)

	var bufTotal, bufLevel bytes.Buffer
	// repTotal contains summaries over discharge intervals
	repTotal := parseutils.AnalyzeHistory(&bufTotal, bugReport, parseutils.FormatTotalTime, upm, false)
	// repLevel contains summaries for each battery level drop.
	// The generated errors would be the exact same as repTotal.Errs so no need to track or add them again.
	parseutils.AnalyzeHistory(&bufLevel, bugReport, parseutils.FormatBatteryLevel, upm, false)

	// Exclude summaries with no change in battery level
	var summariesTotal []parseutils.ActivitySummary
	for _, s := range repTotal.Summaries {
		if s.InitialBatteryLevel != s.FinalBatteryLevel {
			summariesTotal = append(summariesTotal, s)
		}
	}

	errs = append(errs, repTotal.Errs...)
	return summariesData{summariesTotal, bufTotal.String(), bufLevel.String(), repTotal.TimeToDelta, errs, repTotal.Overflow}
}

// generateHistorianPlot calls the Historian python script to generate html charts.
func generateHistorianPlot(reportName, filepath string) (string, error) {
	return historianutils.RunCommand("python", scriptsPath(scriptsDir, "historian.py"), "-c", "-m", "-r", reportName, filepath)
}

// generateKernelCSV calls the python script to convert kernel trace files into a CSV format parseable by kernel.Parse.
func generateKernelCSV(bugReportPath, tracePath, model string) (string, error) {
	return historianutils.RunCommand("python", scriptsPath(scriptsDir, "kernel_trace.py"), "--bugreport", bugReportPath, "--trace", tracePath, "--device", model)
}
