/**
 *
 * Copyright 2015 Google Inc. All Rights Reserved.
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

/**
 * @fileoverview Time related helper functions to format time
 * into readable formats, and calculate durations.
 */
goog.provide('historian.time');


/** @const {number} */
historian.time.MSECS_IN_SEC = 1000;


/** @const {number} */
historian.time.SECS_IN_MIN = 60;


/** @const {number} */
historian.time.MINS_IN_HOUR = 60;


/**
 * Returns the date formatted in "Month Day Year".
 * @param {number} t The Unix timestamp to format.
 * @return {string} The formatted date "Month Day Year".
 */
historian.time.getDate = function(t) {
  var d = new Date(t);
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ' ' + d.getFullYear();
};


/**
 * Returns the time formatted in 'hh:mm:ss'.
 * @export
 * @param {number} t The Unix timestamp to format.
 * @return {string} The formatted time 'hh:mm:ss'.
 */
historian.time.getTime = function(t) {
  var d = new Date(t);
  return (
      historian.time.padTime_(d.getUTCHours()) + ':' +
      historian.time.padTime_(d.getUTCMinutes()) + ':' +
      historian.time.padTime_(d.getUTCSeconds()));
};


/**
 * Pads the unit to two digits by prepending a 0 if the length is 1.
 * @param {number} u The number to format.
 * @return {string} The formatted number as two digits in a string.
 * @private
 */
historian.time.padTime_ = function(u) {
  if ((u + '').length === 1) {
    return '0' + u;
  }
  return '' + u;
};


/**
 * Returns the ms duration formatted as a human readable string.
 * Format is "1h 3m 4s 30ms".
 * @export
 * @param {number} duration The time duration in ms.
 * @return {string} The formatted duration.
 */
historian.time.formatDuration = function(duration) {
  var ms = duration % historian.time.MSECS_IN_SEC;
  var s = Math.floor(
      (duration / historian.time.MSECS_IN_SEC) % historian.time.SECS_IN_MIN);
  var m = Math.floor((duration /
      (historian.time.MSECS_IN_SEC * historian.time.SECS_IN_MIN)) %
      historian.time.MINS_IN_HOUR);
  var h = Math.floor((duration / (historian.time.MSECS_IN_SEC *
      historian.time.SECS_IN_MIN * historian.time.MINS_IN_HOUR)));

  var formatted = '';
  if (h > 0) {
    formatted += h + 'h ';
  }
  if (m > 0 || h > 0) {
    formatted += m + 'm ';
  }
  if (s > 0 || m > 0 || h > 0) {
    formatted += s + 's ';
  }
  if (ms > 0 || formatted.length === 0) {
    // Some of the ms would have been converted from microseconds and would
    // therefore have fractional components. Only show decimals if there is
    // a fractional component.
    if (Math.round(ms) !== ms) {
      ms = ms.toFixed(2);
    }
    formatted += ms + 'ms';
  }
  return formatted.trim();
};
