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

goog.provide('historian.comparison');


/**
 * Class lables used frequently
 * @enum {string}
 */
historian.comparison.Labels = {
  TOP: 'label-top',
  MEDIUM: 'label-medium',
  HIGH: 'label-high'
};


/**
 * String selector tags used frequently
 * @enum {string}
 */
historian.comparison.Selectors = {
  MOBILE_ACTIVE: '#mobile-active',
  MOBILE_TRAFFIC: '#mobile-traffic',
  WIFI_TRAFFIC: '#wifi-traffic',
  USERSPACE_WAKELOCKS: '#userspace-wakelocks',
  SYNCMANAGER: '#syncmanager-syncs',
  KERNEL_WAKESOURCES: '#kernel-wakesources',
  KERNEL_REASONS: '#kernel-reasons',
  DEVICE_POWER_ESTIMATES: '#device-power-estimates',
  GPS_USE: '#gps-use',
  CPU_USE: '#cpu-use',
  WIFI_FULL: '#wifi-full-activity',
  APP_WAKEUPS: '#wakeups',
  CAMERA_USE: '#camera-use',
  FLASHLIGHT_USE: '#flashlight-use',
  ANR_CRASH: '#anr-crash'
};


/**
 * The default threshold percentage(5x or 500%) used for highlighting columns.
 * @const {number}
 */
historian.comparison.DEFAULT_THRESHOLD = 500;


// SELECTORS_X below classifies grouping of tables with common columns to be
// highlighted.


/**
 * List of selector tags with common columns to be highlighted.
 * Columns to be highlighted - 1, 2, 3
 * @const {!Array<string>}
 */
historian.comparison.SELECTORS_1 = [
  historian.comparison.Selectors.MOBILE_TRAFFIC,
  historian.comparison.Selectors.WIFI_TRAFFIC,
  historian.comparison.Selectors.WIFI_FULL
];


/**
 * List of selector tags with common columns to be highlighted.
 * Columns to be highlighted - 1, 2, 3, 6, 7, 8
 * @const {!Array<string>}
 */
historian.comparison.SELECTORS_2 = [
  historian.comparison.Selectors.MOBILE_ACTIVE,
  historian.comparison.Selectors.USERSPACE_WAKELOCKS,
  historian.comparison.Selectors.SYNCMANAGER,
  historian.comparison.Selectors.GPS_USE,
  historian.comparison.Selectors.CAMERA_USE,
  historian.comparison.Selectors.FLASHLIGHT_USE
];


/**
 * List of selector tags with common columns to be highlighted.
 * Columns to be highlighted - 1, 2, 3
 * @const {!Array<string>}
 */
historian.comparison.SELECTORS_3 = [
  historian.comparison.Selectors.DEVICE_POWER_ESTIMATES,
  historian.comparison.Selectors.CPU_USE
];


/**
 * List of selector tags with common columns to be highlighted.
 * Columns to be highlighted - 1, 2, 3, 6, 7, 8
 * @const {!Array<string>}
 */
historian.comparison.SELECTORS_4 = [
  historian.comparison.Selectors.KERNEL_WAKESOURCES,
  historian.comparison.Selectors.KERNEL_REASONS
];


/**
 * Loop over all the tables and call the highlightColumns function.
 * @param {number} threshold The highlight baseline.
 */
historian.comparison.highlightTables = function(threshold) {
  // The numeric arguments in the function call for highlightColumns are indexes
  // of columns which represent the difference column, first column and second
  // column (diff = first-second).
  // For some tables there are 2 such differences so 2 of each for the above
  // explained columns.
  historian.comparison.SELECTORS_1.forEach(function(elem) {
    historian.comparison.highlightColumns(elem,
        threshold, 1, 2, 3, undefined, undefined, undefined);
  });
  historian.comparison.SELECTORS_2.forEach(function(elem) {
    historian.comparison.highlightColumns(elem,
        threshold, 1, 2, 3, 6, 7, 8);
  });
  historian.comparison.SELECTORS_3.forEach(function(elem) {
    historian.comparison.highlightColumns(elem,
        threshold, 1, 2, 3, undefined, undefined, undefined);
  });
  historian.comparison.SELECTORS_4.forEach(function(elem) {
    historian.comparison.highlightColumns(elem,
        threshold, 1, 2, 3, 6, 7, 8);
  });
  historian.comparison.highlightColumns(
      historian.comparison.Selectors.APP_WAKEUPS,
      threshold, 1, 2, 3, undefined, undefined, undefined);
  historian.comparison.highlightColumns(
      historian.comparison.Selectors.ANR_CRASH,
      threshold, 1, 2, 3, 4, 5, 6);
};


/**
 * Applies the new threshold as selected by the user to
 * all the columns
 */
historian.comparison.applyThreshold = function() {
  var threshold = parseInt($('#thresholdSelector').val(), 10);
  historian.comparison.highlightTables(threshold);
};


/**
 * Calculates whether 2 columns differ by threshold amount.
 * @param {number} num1 The first number.
 * @param {number} num2 The second number.
 * @param {number} diff The difference between first and second.
 * @param {number} threshold The new threshold to be applied.
 * @return {boolean}
 */
historian.comparison.satisfiesThreshold =
    function(num1, num2, diff, threshold) {
  return (num1 > num2 && (diff > ((threshold / 100) * num2))) ||
      ((num2 > num1) && (diff > ((threshold / 100) * num1)));
};


/**
 * This function adds the color class to the table cell.
 * @param {number} threshold The cell highlight baseline.
 * @param {number} diff The column representing the diff between first and
       second values.
 * @param {number} first The first data column.
 * @param {number} second The second data column.
 * @param {Object} handler Pointer to the cell.
 */
historian.comparison.addClass = function(threshold, diff, first, second,
    handler) {
  var diffCell = $('td:eq(' + diff + ')', handler);
  var firstCell = $('td:eq(' + first + ')', handler);
  var secondCell = $('td:eq(' + second + ')', handler);
  var enabled = historian.comparison.satisfiesThreshold(
      parseFloat(firstCell.text()), parseFloat(secondCell.text()),
      parseFloat(Math.abs(diffCell.text())), threshold);
  diffCell.toggleClass(historian.comparison.Labels.TOP, enabled);
};


/**
 * This function highlights a column if it satisfies the threshold condition.
 *
 * @param {string} tag The object to be highlighted.
 * @param {number} threshold The new threshold to be applied.
 * @param {number} diff The column representing the diff between first and
       second values.
 * @param {number} first The first data column.
 * @param {number} second The second data column.
 * @param {number|undefined} diff2 The column representing the second diff.
 * @param {number|undefined} first2 The first data column for diff2.
 * @param {number|undefined} second2 The second data column for diff2.
 */
historian.comparison.highlightColumns = function(tag, threshold,
    diff, first, second,
    diff2, first2, second2) {
  $(tag).next().find('tbody tr')
      .each(function() {
        historian.comparison.addClass(threshold, diff, first, second, this);
        if (diff2 != undefined && first2 != undefined && second2 != undefined) {
          historian.comparison.addClass(threshold, diff2, first2, second2,
              this);
        }
      });
};


/**
 * Initializes the onChange listener for the threshold selector
 */
historian.comparison.initialize = function() {
  // Generate the default column highlighting for comparison based output.
  historian.comparison.highlightTables(historian.comparison.DEFAULT_THRESHOLD);
  $('#thresholdSelector').change(historian.comparison.applyThreshold);

  // Remove components which are not required for comparison view.
  $('.non-comparison').remove();
  $('#tab-system-stats').removeClass('active');
  $('#checkin').removeClass('in active');
  $('#tab-histogram-stats').addClass('active');
  $('#histogramstats').addClass('in active');
  $('#tab-historian').hide();
  $('#tab-app-stats').hide();
};
