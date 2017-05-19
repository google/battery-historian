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

/**
 * @fileoverview Time related helper functions to format time
 * into readable formats, and calculate durations.
 */
goog.provide('historian.time');


/** @const {number} */
historian.time.NANOSECS_IN_MSEC = 1000000;


/** @const {number} */
historian.time.MSECS_IN_SEC = 1000;


/** @const {number} */
historian.time.SECS_IN_MIN = 60;


/** @const {number} */
historian.time.MINS_IN_HOUR = 60;


/** @const {number} */
historian.time.MSECS_IN_MIN =
    historian.time.MSECS_IN_SEC *
    historian.time.SECS_IN_MIN;


/** @const {number} */
historian.time.MSECS_IN_HOUR =
    historian.time.MSECS_IN_MIN *
    historian.time.MINS_IN_HOUR;


/** @const {number} */
historian.time.NSECS_IN_MSEC = 1000000;


/**
 * Returns the date formatted in "Month Day Year".
 * @param {number} t The unix timestamp to format in milliseconds.
 * @param {string} loc The IANA time zone location.
 * @return {string} The formatted date "Month Day Year".
 */
historian.time.getDate = function(t, loc) {
  var m = moment.unix(t / 1000);
  if (loc) {
    m = m.tz(loc);
  }
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[m.month()] + ' ' + m.date() + ' ' + m.year();
};


/**
 * Returns the time formatted in 'HH:mm:ss' (24 hour time).
 * @param {number} t The unix timestamp to format in milliseconds.
 * @param {string} loc The IANA time zone location.
 * @return {string} The formatted time 'hh:mm:ss'.
 */
historian.time.getTime = function(t, loc) {
  var m = moment.unix(t / 1000);
  if (loc) {
    m = m.tz(loc);
  }
  return m.format('HH:mm:ss');
};


/**
 * Returns the time zone in the short format. e.g. PDT UTC-07:00
 * @param {number} t The unix timestamp.
 * @param {string} loc The IANA time zone location.
 * @return {string} The time zone in the short format.
 */
historian.time.getTimeZoneShort = function(t, loc) {
  return moment(t).tz(loc).format('z UTCZ');
};


/**
 * Returns the ms duration formatted as a human readable string.
 * Format is "1h 3m 4s 30.25ms".
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


/**
 * Returns the number of seconds in the ms duration.
 * @param {number} ms The ms to convert.
 * @return {number} The number of seconds.
 */
historian.time.secsFromMs = function(ms) {
  return Math.floor(ms / historian.time.MSECS_IN_SEC);
};


/**
 * Parses a time.Duration format string into its numeric value in milliseconds.
 * @param   {string} s time.Duration format string.
 * @return  {number} The corresponding numeric value of the input time.
 */
historian.time.parseTimeString = function(s) {
  // Format data for normalization.
  // The string which will be parsed can be in the format of
  // '2h2m48.373s' or '53m26.89s' or '58.267s' or '765ms' or '5.75ms' or '0'
  // the function formats all the data into one unified unit milliseconds.
  var m = s.trim()
      .match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?\s*(?:(\d+(?:\.\d+)?)ms)?$/);
  return m ? ((m[1] || 0) * historian.time.MSECS_IN_HOUR +
              (m[2] || 0) * historian.time.MSECS_IN_MIN +
              (m[3] || 0) * historian.time.MSECS_IN_SEC +
              (Number(m[4]) || 0)) : 0;
};
