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

var array = goog.require('goog.array');
var asserts = goog.require('goog.asserts');
var googString = goog.require('goog.string');
var time = goog.require('historian.time');


/**
 * Compute the relative coordinate of a jquery selection, corresponding to
 * its parent.
 * @param {!Object} event
 * @param {!jQuery} jqThis
 * @return {!Array<number>} The offset computed
 */
exports.getOffset = function(event, jqThis) {
  var parentOffset = jqThis.parent().offset();
  return [event.pageX - parentOffset.left, event.pageY - parentOffset.top];
};


/**
 * Checks to see if the browser supports the foreignObject SVG element.
 * @return {boolean} True if the browser supports foreignObject, false otherwise
 */
exports.isForeignObjectSupported = function() {
  return document.implementation.hasFeature(
      'www.http://w3.org/TR/SVG11/feature#Extensibility', '1.1');
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
 * Creates a valid HTML ID by removing non-alphanumeric, underscore, and hyphen
 * characters from the string, and converting to lower case.
 * @param {string} str The string to create an ID out of.
 * @return {string} The ID.
 */
exports.toValidID = function(str) {
  return str.replace(/[^a-z0-9_\-]/ig, '').toLowerCase();
};


/**
 * Returns the total charge (mAh) consumed in the data.
 * @param {!Array<!historian.Entry>} data data.
 * @return {number} The total mAh.
 */
exports.calculateTotalCharge = function(data) {
  var totals = calculateCumulativeChargeEntries(data);
  return totals.length == 0 ? 0 :
      /** @type {number} */ (totals[totals.length - 1].value);
};


/**
 * Returns the cumulative charge (mAh) consumed up to each entry.
 * @param {!Array<!historian.Entry>} data data.
 * @param {number=} opt_precision Truncates the calculated values to the
 *     specified number of decimal places.
 * @return {!Array<!historian.Entry>} The total mAh.
 */
var calculateCumulativeChargeEntries = function(data, opt_precision) {
  var total = 0;
  var res = [];
  data.forEach(function(d) {
    var durationMs = d.endTime - d.startTime;
    asserts.assert(durationMs >= 0,
        'Negative duration: start=' + d.startTime + ', end=' + d.endTime);
    // Since we're calculating it for only the visible data points, we might
    // be missing readings from a particular second, so can't use a constant hz.
    if (durationMs > 0) {
      var hz = (durationMs != 0) ? time.MSECS_IN_SEC / durationMs : 0;
      // Save the total before dividing by 3600, to avoid floating point
      // errors.
      total += d.value / hz;
      var value = total / (time.SECS_IN_MIN * time.MINS_IN_HOUR);
      res.push({
        startTime: d.startTime,
        endTime: d.endTime,
        value: opt_precision ? +value.toFixed(3) : value
      });
    }
  });
  return res;
};


/**
 * Returns the total charge (mAh) consumed in the data.
 * @param {!Array<!historian.Entry>} data data.
 * @return {string} The mAh rounded to 2 decimal places, as a formatted string.
 */
exports.calculateTotalChargeFormatted = function(data) {
  return exports.calculateTotalCharge(data).toFixed(2);
};


/**
 * Returns a shallow copy of the data points that fall in the given time range.
 * The data can have multiple entries with the same start and end times. For
 * performance reasons, this should not be called for large datasets (eg. with
 * 80,000+ points).
 * @param {number} startTime The start of the time range.
 * @param {number} endTime The end of the time range.
 * @param {!Array<historian.Entry|historian.AggregatedEntry>} data
 *     The data to filter.
 * @return {!Array<historian.Entry|historian.AggregatedEntry>} The data
 *     falling in the given time range.
 */
exports.inTimeRangeMulti = function(startTime, endTime, data) {
  return data.filter(function(d) {
    return dataOverlaps(startTime, endTime, [d]);
  });
};


/**
 * Returns whether any data overlaps with the given time range.
 * @param {number} startTime The start of the time range.
 * @param {number} endTime The end of the time range.
 * @param {!Array<historian.Entry|historian.AggregatedEntry>} data The events.
 * @return {boolean}
 */
var dataOverlaps = function(startTime, endTime, data) {
  if (array.isEmpty(data)) {
    return false;
  }
  var first = data[0];
  var last = data[data.length - 1];
  // Requesting range that comes after last end time of data range or before
  // first start time of data range.
  if (startTime > last.endTime || endTime < first.startTime) {
    return false;
  }
  // If an instant event lies on the time boundary it should be included.
  // e.g. Time range is 2pm - 3pm, and a crash occurs at 2pm exactly.
  // If a non instant event starts at the end of the time boundary, or ends
  // at start o the time boundary, it shouldn't be included.
  // e.g. screen on from 1pm - 2pm.
  var isInstant = function(entry) { return entry.startTime == entry.endTime; };
  return (((startTime != last.endTime) || isInstant(last)) &&
      ((endTime != first.startTime) || isInstant(first)));
};


/**
 * Returns a shallow copy of the data points that fall in the given time range.
 * The data entries should be contiguous and non overlapping. Both the query
 * time ranges and data entry time ranges should have an inclusive start time
 * and exclusive end time.
 * @param {number} startTime The start of the time range.
 * @param {number} endTime The end of the time range.
 * @param {!Array<historian.Entry|historian.AggregatedEntry>} data
 *     The data to filter.
 * @return {!Array<historian.Entry|historian.AggregatedEntry>} The data
 *     falling in the given time range.
 */
exports.inTimeRange = function(startTime, endTime, data) {
  if (!dataOverlaps(startTime, endTime, data)) {
    return [];
  }
  var startObj = {
    startTime: startTime
  };
  var startIndex = array.binarySearch(data, startObj, function(d1, d2) {
    return d1.startTime - d2.startTime;
  });
  if (startIndex < 0) {
    // If the start time was not found in the array, binarySearch returns the
    // index it would have been inserted in, -1.
    startIndex = -(startIndex + 1);

    // We want the element that is right before the insertion point.
    if (startIndex != 0) {
      startIndex--;
    }
  }
  var endObj = {
    endTime: endTime
  };
  var endIndex = array.binarySearch(data, endObj, function(d1, d2) {
    return d1.endTime - d2.endTime;
  });

  if (endIndex < 0) {
    endIndex = -(endIndex + 1);
  }
  return array.slice(data, startIndex, endIndex + 1);
};


/**
 * Sets the dropdown options and applies select2 styling. Any existing options
 * are removed.
 * @param {!jQuery} dropdown The jQuery dropdown element to add the options to.
 * @param {!Array<string|{val: string, html: string}>} options
 *     The strings to set as the option values and displayed html,
 *     or objects with the option values and displayed html.
 * @param {string=} opt_placeholder Displayed when no option is selected. If
 *     undefined, no placeholder will be shown.
 */
exports.setupDropdown = function(dropdown, options, opt_placeholder) {
  dropdown.empty();
  if (opt_placeholder) {
    // Append an empty element, required for select2 placeholder to show.
    dropdown.append($('<option></option>'));
  }
  options.forEach(function(option) {
    var isString = typeof option == 'string';
    var val = isString ? option : option.val;
    var html = isString ? option : option.html;
    dropdown.append($('<option></option>')
        .val(asserts.assertString(val))
        .html(asserts.assertString(html))
    );
  });
  dropdown.select2({
    placeholder: opt_placeholder || '',
    allowClear: true,
    dropdownAutoWidth: true
  });
};


/**
 * Generates the first derivative for the given data.
 * @param {!Array<!historian.Entry>} data The data to generate the derivative
 *     for.
 * @return {!Array<!historian.Entry>}
 */
exports.generateDerivative = function(data) {
  var derivative = [];
  data.forEach(function(cur, i) {
    if (i == data.length - 1) {
      return;
    }
    var next = data[i + 1];
    var dy = next.value - cur.value;
    var dx = (next.startTime - cur.startTime) / time.MSECS_IN_HOUR;
    derivative.push({
      startTime: cur.startTime,
      endTime: next.startTime,
      value: (dx == 0) ? 0 : dy / dx
    });
  });
  return derivative;
};


/**
 * Returns whether a regExp is valid.
 * @param {string} regExp to check.
 * @return {boolean} True if the regExp is valid, false otherwise.
 */
exports.isValidRegExp = function(regExp) {
  var r = null;
  try {
    r = new RegExp(regExp);
  } catch (e) {}
  return r != null;
};


/**
 * Copies the given string to the user's clipboard.
 * @param {string} str String to copy.
 */
exports.copyToClipboard = function(str) {
  var onCopy = function(event) {
    event.clipboardData.clearData();
    event.clipboardData.setData('text/plain', str);
    event.preventDefault();
    document.removeEventListener('copy', onCopy);
  };
  document.addEventListener('copy', onCopy);
  document.execCommand('copy');
};


/**
 * Returns the intersection of the two time ranges s1, e1 and s2, e2.
 * @param {number} s1 Start time of the first range.
 * @param {number} e1 End time of the first range.
 * @param {number} s2 Start time of the second range.
 * @param {number} e2 End time of the second range.
 * @return {!Array<number>} The intersection, with at least duration 1 ms.
 *     Returns an empty array if no intersection is found.
 */
var getIntersection = function(s1, e1, s2, e2) {
  var start = Math.max(s1, s2);
  var end = Math.min(e1, e2);
  return start < end ? [start, end] : [];
};


/**
 * Returns whether the event occurred mostly during screen off.
 * @param {!historian.Entry} event The event to check.
 * @param {!Array<!historian.Entry>} screenOnEvents Events indicating when the
 *     screen was on.
 * @return {boolean} True if 50% or more of the event's duration was during
 *     screen off.
 */
exports.isMostlyScreenOffEvent = function(event, screenOnEvents) {
  if (screenOnEvents.length == 0) {
    return true;
  }
  var idx = array.binarySearch(screenOnEvents, event, function(d1, d2) {
    return d1.startTime - d2.startTime;
  });
  // The result from binary search will be the index of the screen on event with
  // the same start time if found, otherwise will be (-(insertion point) - 1).
  var insertionPoint = idx;
  if (insertionPoint < 0) {
    insertionPoint = -(idx + 1);
    if (insertionPoint != 0) {
      // If the event starts when the screen is on, the insertion point will
      // be after that screen on event, and needs to be decremented to point
      // to that screen on event.
      var screenOn = screenOnEvents[insertionPoint - 1];
      if (screenOn.endTime > event.startTime) {
        insertionPoint--;
      }
    }
  }

  var screenOnMs = 0;  // Easier to track screen on time rather than screen off.
  for (var i = insertionPoint; i < screenOnEvents.length; i++) {
    var screenOn = screenOnEvents[i];
    var intersection = getIntersection(
        event.startTime, event.endTime, screenOn.startTime, screenOn.endTime);
    if (intersection.length == 0) {
      break;
    }
    screenOnMs += intersection[1] - intersection[0];
  }
  return screenOnMs <= (event.endTime - event.startTime) / 2;
};


/**
 * Modifies the value of each entry to be the average of its value and all
 * adjacent entries' values from the same category, weighted by entry duration.
 * @param {!Array<!historian.Entry>} entries
 * @param {function(!historian.Entry)} getCategory Returns the category of the
 *     entry. The category can be any type and will be compared with strict
 *     equality.
 */
exports.avgByCategory = function(entries, getCategory) {
  if (entries.length == 0) {
    return;
  }
  // Averages the values of all entries between startIdx and endIdx
  // (inclusive).
  var avg = function(startIdx, endIdx) {
    var totalValue = 0;
    var totalMs = 0;
    for (var i = startIdx; i <= endIdx; i++) {
      var ms = entries[i].endTime - entries[i].startTime;
      totalValue += entries[i].value * ms;
      totalMs += ms;
    }
    var avg = totalValue / totalMs;
    for (var i = startIdx; i <= endIdx; i++) {
      entries[i].value = avg;
    }
  };
  var startIdx = 0;
  entries.forEach(function(entry, idx, arr) {
    if (idx > 0 && getCategory(arr[idx - 1]) !== getCategory(arr[idx])) {
      avg(startIdx, idx - 1);
      startIdx = idx;
    }
  });
  avg(startIdx, entries.length - 1);
};


/** Returns the cumulative charge (mAh) consumed up to each entry. */
exports.calculateCumulativeChargeEntries = calculateCumulativeChargeEntries;


/** Returns the intersection of the two time ranges s1, e1 and s2, e2. */
exports.getIntersection = getIntersection;
