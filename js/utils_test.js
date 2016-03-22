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

goog.module('historian.utilsTest');
goog.setTestOnly('historian.utilsTest');

var jsunit = goog.require('goog.testing.jsunit');
var testSuite = goog.require('goog.testing.testSuite');
var utils = goog.require('historian.utils');


/**
 * Creates a single entry for a series.
 * @param {!Array<number>} arr
 * @return {!historian.Entry}
 */
var createTestEntry = function(arr) {
  return {startTime: arr[0], endTime: arr[1], value: arr[2]};
};


/**
 * Creates the data for the test series, given an array of arrays,
 * each containing the start time, end time and value of an entry.
 * @param {!Array<!Array<number>>} values
 * @return {!Array<!historian.Entry>}
 */
var createData = function(values) {
  var processedValues = [];
  values.forEach(function(v) {
    processedValues.push(createTestEntry(v));
  });
  return processedValues;
};


testSuite({
  /**
   * Tests the calculating of total mAh for the given data.
   */
  testCalculateTotalCharge: function() {
    var tests = [
      {
        desc: '1 mA total charge.',
        data: [
          [11000, 12000, 1200],
          [12000, 13000, 1200],
          [13000, 14000, 1200]
        ],
        expected: '1.00'
      },
      {
        desc: 'Multiple readings per second.',
        data: [
          [11000, 11333, 800],
          [11333, 11666, 1200],
          [11666, 12000, 1600],
          [12000, 12333, 900],
          [12333, 12666, 300],
          [12666, 13000, 2400],
          [13000, 13333, 900],
          [13333, 13666, 300],
          [13666, 14000, 2400],
          [14000, 15000, 3600],
        ],
        expected: '2.00'
      },
      {
        desc: 'Reading not covering whole second',
        data: [
          [11000, 11500, 7200]
        ],
        expected: '1.00'
      }
    ];
    tests.forEach(function(t) {
      var result = utils.calculateTotalChargeFormatted(createData(t.data));
      var expected = t.expected;

      assertEquals(t.desc + ': Expected ' + expected +
          ', got ' + result, expected, result);
    });
  }
});
