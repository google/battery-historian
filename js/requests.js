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


/**
 * @typedef {{
 *   sdkVersion: number,
 *   historianV2Csv: string,
 *   levelSummaryCsv: string,
 *   displayPowermonitor: boolean,
 *   reportVersion: number,
 *   appStats: !Array<!historian.AppStat>,
 *   deviceCapacity: number,
 *   histogramStats: !historian.HistogramStats,
 *   timeToDelta: !Object<string>,
 *   criticalError: string,
 *   fileName: string,
 *   location: string,
 *   groupToLogStart: !Object<number>
 * }}
 */
var UploadResponse;


/**
 * JSON data received from the server.
 * @typedef {{
 *   UploadResponse: !Array<!UploadResponse>,
 *   html: string,
 *   usingComparison: boolean,
 *   combinedCheckin: !Array<!Object>,
 * }}
 */
var JSONData;


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
