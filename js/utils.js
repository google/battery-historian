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
 * @fileoverview Util functions.
 */

goog.module('historian.utils');
goog.module.declareLegacyNamespace();

var asserts = goog.require('goog.asserts');
var googString = goog.require('goog.string');
var time = goog.require('historian.time');


/**
 * Compute the relative coordinate of a jquery selection, corresponding to
 * its parent
 * @param {!Object} event
 * @param {!jQuery} jqThis
 * @return {!Array<number>} the offset computed
 */
exports.getOffset = function(event, jqThis) {
  var parentOffset = jqThis.parent().offset();
  return [event.pageX - parentOffset.left, event.pageY - parentOffset.top];
};


/**
 * Check if line (a, b) intersects segment (c, d).
 *
 * @param {!Array<number>} a
 * @param {!Array<number>} b
 * @param {!Array<number>} c
 * @param {!Array<number>} d
 *     a, b, c, d are endpoints of the segments
 * @return {boolean} Whether the line intersects the segment
 */
exports.intersectLineSeg = function(a, b, c, d) {
  var ab = [b[0] - a[0], b[1] - a[1]],
      ac = [c[0] - a[0], c[1] - a[1]],
      ad = [d[0] - a[0], d[1] - a[1]];
  var crosscb = ac[1] * ab[0] - ac[0] * ab[1],
      crossbd = ab[1] * ad[0] - ab[0] * ad[1];
  var eps = 1E-9;
  if (Math.abs(crosscb) <= eps || Math.abs(crossbd) <= eps) return true;
  return crosscb * crossbd > 0;
};


/**
 * Check if segment (a, b) intersects segment (c, d).
 *
 * @param {!Array<number>} a
 * @param {!Array<number>} b
 * @param {!Array<number>} c
 * @param {!Array<number>} d
 *     a, b, c, d are points of the segments
 * @return {boolean} Whether the two segments intersect
 */
exports.intersectSegSeg = function(a, b, c, d) {
  return exports.intersectLineSeg(a, b, c, d) &&
      exports.intersectLineSeg(c, d, a, b);
};


/**
 * Pads the given string with the desired character.
 *
 * @param {string} str The string to pad
 * @param {number} len The desired length of the string
 * @param {string} chr The character to pad with
 * @return {string} The padded string
 */
exports.padString = function(str, len, chr) {
  var padding = '';
  if (str.length < len) {
    padding = googString.repeat(chr, Math.floor(len - str.length));
  }
  return str + padding;
};


/**
 * Compute the Pearson Correlation of two vectors
 *
 * @param {!Array<number>} x
 * @param {!Array<number>} y
 *     x, y are vectors of the same length
 * @return {number} The correlation value
 */
exports.pearsonCorrelation = function(x, y) {
  var n = x.length;
  var sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (var i = 0; i < n; i++) {
    sx += x[i];
    sx2 += x[i] * x[i];
    sy += y[i];
    sy2 += y[i] * y[i];
    sxy += x[i] * y[i];
  }
  var r = n * sxy - sx * sy;
  r /= Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
  return r;
};


/**
 * Returns a textual description referring to the number of bytes given.
 * Attempts to use the appropriate byte level (KB vs MB vs GB).
 *
 * @param {number} bytes The number of bytes.
 * @return {string} The number of bytes in a better human readable format.
 */
exports.describeBytes = function(bytes) {
  if (bytes < 1024 / 2) { // bytes < 0.5 KB
    return googString.subs('%s bytes', bytes.toFixed(2));
  } else if (bytes < (1024 * 1024) / 2) { // 0.5 KB <= bytes < 0.5 MB
    return googString.subs('%s KB', (bytes / 1024).toFixed(2));
  } else if (bytes < (1024 * 1024 * 1024) / 2) { // 0.5 MB <= bytes < 0.5 GB
    return googString.subs('%s MB', (bytes / (1024 * 1024)).toFixed(2));
  } else { // bytes >= 0.5 GB
    return googString.subs('%s GB', (bytes / (1024 * 1024 * 1024)).toFixed(2));
  }
};


/**
 * Creates a valid HTML ID by removing non alphanumeric and non underscore
 * characters from the string, and converting to lower case.
 * @param {string} str The string to create an ID out of.
 * @return {string} The ID.
 */
exports.toValidID = function(str) {
  return str.replace(/[^a-z0-9_]/ig, '').toLowerCase();
};


/**
 * Returns the total charge (mAh) consumed in the data.
 * @param {!Array<!historian.Entry>} data data.
 * @return {number} The total mAh.
 */
exports.calculateTotalCharge = function(data) {
  var total = 0;
  data.forEach(function(d) {
    var durationMs = d.endTime - d.startTime;
    asserts.assert(durationMs >= 0,
        'Negative duration: start=' + d.startTime + ', end=' + d.endTime);
    // Since we're calculating it for only the visible data points, we might
    // be missing readings from a particular second, so can't use a constant hz.
    var hz = (durationMs != 0) ? time.MSECS_IN_SEC / durationMs : 0;
    total += d.value / hz;
  });
  // After adding the mA readings per second, we calculate the mAh by dividing
  // by the number of seconds in an hour.
  return total / (time.SECS_IN_MIN * time.MINS_IN_HOUR);
};


/**
 * Returns the total charge (mAh) consumed in the data.
 * @param {!Array<!historian.Entry>} data data.
 * @return {string} The mAh rounded to 2 decimal places, as a formatted string.
 */
exports.calculateTotalChargeFormatted = function(data) {
  return exports.calculateTotalCharge(data).toFixed(2);
};
