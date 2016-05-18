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

goog.module('historian.testUtils');
goog.setTestOnly('historian.testUtils');


/**
 * Creates a single entry for a series.
 * @param {!Array<!historian.Value|!historian.AggregatedEntryValue>} arr
 * @return {!historian.Entry}
 */
exports.createTestEntry = function(arr) {
  return {startTime: arr[0], endTime: arr[1], value: arr[2]};
};


/**
 * Creates the data for the test series, given an array of arrays,
 * each containing the start time, end time and value of an entry.
 * @param {!Array<!Array<!historian.Value|!historian.AggregatedEntryValue>>}
 *     values
 * @return {!Array<!historian.Entry>}
 */
exports.createData = function(values) {
  return values.map(function(v) {
    return exports.createTestEntry(v);
  });
};
