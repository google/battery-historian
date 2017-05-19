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
 * @fileoverview Level summary data processing scripts.
 */
goog.provide('historian.LevelSummaryData');
goog.provide('historian.levelSummary');
goog.provide('historian.levelSummary.DimensionTypes');
goog.provide('historian.levelSummary.Dimensions');

goog.require('goog.array');
goog.require('historian.time');


/** @enum {number} */
historian.levelSummary.DimensionTypes = {
  INT: 0,
  DURATION: 1,
  DATE: 2,
  FLOAT: 3,
  STRING: 4
};


/**
 * Special dimensions used frequently.
 * @enum {string}
 */
historian.levelSummary.Dimensions = {
  DURATION: 'Duration',
  LEVEL_DROP_PER_HOUR: 'LevelDropPerHour',
  START_TIME: 'StartTime',
  END_TIME: 'EndTime',
  INITIAL_BATTERY_LEVEL: 'InitialBatteryLevel',
  FINAL_BATTERY_LEVEL: 'FinalBatteryLevel'
};


/**
 * Parses a token string and determines its type.
 * Convert the string to typed values if the token is int/float.
 * @param {string} token
 * @return {{
 *   type: historian.levelSummary.DimensionTypes,
 *   val: (number|string)
 * }}
 * @private
 */
historian.levelSummary.parseToken_ = function(token) {
  var res = token.match(/^-?[0-9]+/);
  if (res != null && res[0] === token)
    return {
      type: historian.levelSummary.DimensionTypes.INT,
      val: parseInt(res, 10)
    };
  res = token.match(/^-?([0-9]*\.[0-9]+|[0-9]+\.[0-9]*)/);
  if (res != null && res[0] === token)
    return {
      type: historian.levelSummary.DimensionTypes.FLOAT,
      val: parseFloat(res)
    };
  return {
    type: historian.levelSummary.DimensionTypes.STRING,
    val: token
  };
};


/**
 * Checks if a level summary dimension is normalizable.
 * A dimension is normalizable when it has form: {dimension}.dur or
 * {dimension}.num.
 * @private
 * @param {string} dim Dimension name.
 * @return {boolean}
 */
historian.levelSummary.isNormalizableDimension_ = function(dim) {
  var res = dim.match(/.+\.(dur|num)$/);
  return res != null && res[0] === dim;
};



/**
 * LevelSummaryData contains essentially a 2D matrix of which the rows
 * represent battery level drops and columns are the metrics values of
 * the level drops.
 * It also contains auxiliary data structures for lookups.
 * @param {string=} opt_csv The CSV string containing the data.
 * @constructor
 * @struct
 */
historian.LevelSummaryData = function(opt_csv) {
  /** @type {!Array<!Array<number>>} */
  this.values = [];
  /** @type {!Array<!Array<number>>} */
  this.valuesNormalized = [];
  /** @type {!Array<string>} */
  this.dimensionNames = [];
  /** @type {!Array<historian.levelSummary.DimensionTypes>} */
  this.dimensionTypes = [];
  /** @type {!Array<historian.levelSummary.DimensionTypes>} */
  this.dimensionTypesNormalized = [];
  /** @type {!Object<number>} */
  this.dimensionToIndex = {};

  this.items = {};
  /**
   * Size of items.
   * @type {number}
   */
  this.numItems = 0;

  /**
   * Rendering properties of the items
   * @type {!Object<!Object>}
   */
  this.properties = {};

  if (opt_csv) this.parseCsv_(opt_csv);
};


/**
 * Parses an input CSV to generate the level summary data.
 * @param {string} csv
 * @private
 */
historian.LevelSummaryData.prototype.parseCsv_ = function(csv) {
  var lines = d3.csvParseRows(csv);
  if (!lines.length)
    return;
  var dimNames = lines.splice(0, 1)[0]; // Get header line of csv
  var dimTypes = [];
  var values = lines;
  for (var j = 0; j < dimNames.length; j++) {
    var dimType = historian.levelSummary.DimensionTypes.INT;
    for (var i = 0; i < values.length; i++) {
      var e = historian.levelSummary.parseToken_(values[i][j]);
      if (e.type > dimType)
        dimType = e.type;
      values[i][j] = e.val;
    }
    var dimName = dimNames[j];
    if (dimName.indexOf('.dur') != -1 ||
        dimName == 'Duration')
      dimType = historian.levelSummary.DimensionTypes.DURATION;
    if (dimName.indexOf('Time') != -1)
      dimType = historian.levelSummary.DimensionTypes.DATE;
    dimTypes.push(dimType);
  }

  var dimToIndex = {};
  for (var i = 0; i < dimNames.length; i++) {
    // Number the dimensions 0..n-1.
    dimToIndex[dimNames[i]] = i;
  }

  // Creates the normalized version of the values.
  // Also creates a full item list and the items' properties.
  var items = {};
  var properties = {};
  var dimTypesNormalized = [];
  var valuesNormalized = [];
  var durationIndex = dimToIndex[
      historian.levelSummary.Dimensions.DURATION];
  // Make a copy of the values.
  for (var i = 0; i < values.length; i++) {
    items[i] = true;
    properties[i] = {};
    valuesNormalized[i] = $.extend([], values[i]);
  }
  for (var j = 0; j < dimNames.length; j++) {
    var name = dimNames[j];
    var type = dimTypes[j];
    if (type != historian.levelSummary.DimensionTypes.STRING &&
        historian.levelSummary.isNormalizableDimension_(name)) {
      if (type == historian.levelSummary.DimensionTypes.INT) {
        type = historian.levelSummary.DimensionTypes.FLOAT;
      }
      for (var i = 0; i < values.length; i++) {
        var duration = values[i][durationIndex];
        duration /= historian.time.MSECS_IN_HOUR;
        valuesNormalized[i][j] /= duration;
      }
    }
    dimTypesNormalized.push(type);
  }

  this.values = values;
  this.valuesNormalized = valuesNormalized;
  this.dimensionNames = dimNames;
  this.dimensionTypes = dimTypes;
  this.dimensionTypesNormalized = dimTypesNormalized;
  this.dimensionToIndex = dimToIndex;
  this.items = items;
  this.numItems = values.length;
  this.properties = properties;
};


/**
 * Find the items intersecting the given time range.
 * @param {number} startTime The left side of the time range.
 * @param {number} endTime The right side of the time range.
 * @return {!Array<string>} The items satisfying the condition.
 */
historian.LevelSummaryData.prototype.itemsInTimeRange =
    function(startTime, endTime) {
  var startTimeIndex = this.dimensionToIndex[
      historian.levelSummary.Dimensions.START_TIME
      ];
  var endTimeIndex = this.dimensionToIndex[
      historian.levelSummary.Dimensions.END_TIME
      ];
  var time = [];
  time[endTimeIndex] = startTime;
  var s = goog.array.binarySearch(this.values, time, function(a, b) {
    return a[endTimeIndex] - b[endTimeIndex];
  });
  if (s < 0) s = -s - 1;
  time[startTimeIndex] = endTime;
  var t = goog.array.binarySearch(this.values, time, function(a, b) {
    return a[startTimeIndex] - b[startTimeIndex];
  });
  if (t < 0) t = -t - 1;
  return s < t && s < this.values.length ? goog.array.range(s, t) : [];
};
