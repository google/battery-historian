/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

goog.module('historian.requests');
goog.module.declareLegacyNamespace();

var historian = goog.require('historian');

goog.forwardDeclare('batterystats.BatteryStats');


/**
 * @typedef {{
 *   sdkVersion: number,
 *   historianV2Logs: ?Array<!historian.historianV2Logs.Log>,
 *   levelSummaryCsv: string,
 *   displayPowerMonitor: boolean,
 *   reportVersion: number,
 *   appStats: !Array<!historian.AppStat>,
 *   batteryStats: !wireless_android_stats_battery_batterystats.BatteryStats,
 *   deviceCapacity: number,
 *   histogramStats: !historian.HistogramStats,
 *   timeToDelta: !Object<string>,
 *   criticalError: string,
 *   note: string,
 *   fileName: string,
 *   location: string,
 *   overflowMs: number,
 *   isDiff: boolean
 * }}
 */
var UploadResponse;


/**
 * JSON data received from the server.
 * @typedef {{
 *   UploadResponse: !Array<!UploadResponse>,
 *   html: string,
 *   usingComparison: boolean,
 *   combinedCheckin: !CombinedCheckinSummary,
 *   systemUiDecoder: !Object<string>
 * }}
 */
var JSONData;


/**
 * @typedef {{
 *   UserspaceWakelocksCombined: !Array<!ActivityDataDiff>,
 *   KernelWakelocksCombined: !Array<!ActivityDataDiff>,
 *   SyncTasksCombined: !Array<!ActivityDataDiff>,
 *   WakeupReasonsCombined: !Array<!ActivityDataDiff>,
 *   TopMobileActiveAppsCombined: !Array<!ActivityDataDiff>,
 *   TopMobileTrafficAppsCombined: !Array<!NetworkTrafficDataDiff>,
 *   TopWifiTrafficAppsCombined: !Array<!NetworkTrafficDataDiff>,
 *   DevicePowerEstimatesCombined: !Array<!PowerUseDataDiff>,
 *   WifiFullLockActivityCombined: !Array<!ActivityDataDiff>,
 *   GPSUseCombined: !Array<!ActivityDataDiff>,
 *   CameraUseCombined: !Array<!ActivityDataDiff>,
 *   FlashlightUseCombined: !Array<!ActivityDataDiff>,
 *   AppWakeupsCombined: !Array<!RateDataDiff>,
 *   ANRAndCrashCombined: !Array<!AnrCrashDataDiff>,
 *   CPUUsageCombined: !Array<!CpuDataDiff>
 * }}
 */
var CombinedCheckinSummary;


/**
 * @typedef {{
 *   Name: string,
 *   Entries:  !Array<!ActivityData>,
 *   CountPerHourDiff: number,
 *   SecondsPerHrDiff: number
 * }}
 */
var ActivityDataDiff;


/**
 * @typedef {{
 *   Name: string,
 *   Title: string,
 *   UID: number,
 *   Count: number,
 *   CountPerHour: number,
 *   CountLevel: string,
 *   Duration: !Object,
 *   SecondsPerHr: number,
 *   DurationLevel: string,
 *   Level: string,
 * }}
 */
var ActivityData;


/**
 * @typedef {{
 *   Name: string,
 *   Entries: !Array<!NetworkTrafficData>,
 *   WifiMegaBytesPerHourDiff: number,
 *   MobileMegaBytesPerHourDiff: number
 * }}
 */
var NetworkTrafficDataDiff;


/**
 * @typedef {{
 *   Name: string,
 *   UID: number,
 *   WifiMegaBytes: number,
 *   MobileMegaBytes: number,
 *   WifiMegaBytesPerHour: number,
 *   MobileMegaBytesPerHour: number,
 *   WifiLevel: string,
 *   MobileLevel: string,
 *   Level: string
 * }}
 */
var NetworkTrafficData;


/**
 * @typedef {{
 *   Name: string,
 *   Entries: !Array<!PowerUseData>,
 *   WifiMegaBytesPerHourDiff: number,
 *   MobileMegaBytesPerHourDiff: number
 * }}
 */
var PowerUseDataDiff;


/**
 * @typedef {{
 *   Name: string,
 *   UID: number,
 *   Percent: number
 * }}
 */
var PowerUseData;


/**
 * @typedef {{
 *   Name: string,
 *   Entries: !Array<!RateData>,
 *   CountPerHrDiff: number
 * }}
 */
var RateDataDiff;


/**
 * @typedef {{
 *   Name: string,
 *   UID: number,
 *   Count: number,
 *   CountPerHr: number,
 *   CountLevel: string
 * }}
 */
var RateData;


/**
 * @typedef {{
 *   Name: string,
 *   Entries: !Array<!AnrCrashData>,
 *   ANRCountDiff: number,
 *   CrashCountDiff: number
 * }}
 */
var AnrCrashDataDiff;


/**
 * @typedef {{
 *   Name: string,
 *   UID: number,
 *   ANRCount: number,
 *   CrashCount: number
 * }}
 */
var AnrCrashData;


/**
 * @typedef {{
 *   Name: string,
 *   Entries: !Array<!CpuData>,
 *   PowerPctDiff: number
 * }}
 */
var CpuDataDiff;


/**
 * @typedef {{
 *   Name: string,
 *   UID: number,
 *   UserTime: !Object,
 *   SystemTime: !Object,
 *   PowerPct: number,
 *   UserTimeLevel: string,
 *   SystemTimeLevel: string,
 *   Level: string
 * }}
 */
var CpuData;


/**
 * @typedef {
 *   !ActivityDataDiff|!NetworkTrafficDataDiff|!PowerUseDataDiff|
 *   !RateDataDiff|!AnrCrashDataDiff|!CpuDataDiff
 * }
 */
exports.CombinedCheckinData;


/**
 * @typedef {{
 *   responseJSON: ?JSONData,
 *   responseText: string
 * }}
 */
var Response;


/**
 * Parses the returned xhr object from the server and initializes the page.
 * @param {!Response} xhr The xhr response returned.
 */
exports.uploadComplete = function(xhr) {
  var json = xhr.responseJSON;
  if (json) {
    historian.initialize(json);
  } else {
    // An error occurred. The error message is saved in responseText.
    $('#processingError').html(xhr.responseText);
    $('#processingError').show();
    $('form').show();
    $('.progress').hide();
  }
};


/** @typedef {JSONData} **/
exports.JSONData = JSONData;


/** @typedef {CombinedCheckinSummary} */
exports.CombinedCheckinSummary = CombinedCheckinSummary;
