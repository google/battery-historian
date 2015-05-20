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
 * @fileoverview Contains color configurations and generateSeriesColors for
 * creating color functions for each series.
 */
goog.provide('historian.color');

goog.require('goog.functions');


/**
 * Map from series name to color function.
 * @private {Object}
 */
historian.color.colorMap_ = {};

historian.color.colorMap_['Brightness'] = d3.scale.ordinal()
    .domain([0, 1, 2, 3, 4])
    .range(['white', '#addeed', '#415094', '#2c2782', '#060424']);

historian.color.colorMap_['Phone scanning'] =
    goog.functions.constant('#251dcc');

historian.color.colorMap_['Network connectivity'] = d3.scale.ordinal()
    .domain(['TYPE_MOBILE', 'TYPE_WIFI', 'TYPE_OTHER'])
    .range(['#8ac1ff', '#ffd48a', '#ff9a8a', '#ff749b', '#99ff74']);

historian.color.colorMap_['Data connection'] = d3.scale.ordinal()
    .domain(['none', 'edge', 'hsdpa', 'hspa', 'lte', 'hspap'])
    .range(['white', '#63ff52', '#ff5263', '#ff9d52', '#527aff', 'black']);

historian.color.colorMap_['Phone state'] = d3.scale.ordinal()
    .domain(['in', 'out'])
    .range(['#F0FFFF', 'red']);

historian.color.colorMap_['Mobile radio'] = d3.scale.ordinal()
    .domain(['true'])
    .range(['#fa531b']);

historian.color.colorMap_['CPU running'] = d3.scale.ordinal()
    .domain(['true'])
    .range(['black']);

historian.color.colorMap_['Screen'] = d3.scale.ordinal()
    .domain(['true'])
    .range(['red']);

historian.color.colorMap_['Signal strength'] = d3.scale.ordinal()
    .domain([0, 1, 2, 3, 4])
    .range(['white', 'red', 'orange', 'yellow', 'green']);

historian.color.colorMap_['Foreground process'] = function() {
  var scale = d3.scale.ordinal()
      .domain([0, 1, 2, 3, 4, 5, 6, 7])
      .range(['white', '#b7ff73', '#73b7ff', '#ff73b9',
        '#ffa973', '#ff9673', '#ffef73', '#73faff']);
  return function(value) {
    if (value > 7) {
      return scale(7);
    }
    return scale(value);
  };
}();

historian.color.colorMap_['SyncManager app'] = function() {
  var scale = d3.scale.ordinal()
      .domain([0, 1, 2])
      .range(['white', '#ff6816', '#16a2ff']);
  return function(value) {
    if (value > 2) {
      return scale(2);
    }
    return scale(value);
  };
}();

historian.color.colorMap_['Partial wakelock'] =
    goog.functions.constant('#A4D3EE');

historian.color.colorMap_['wakelock_in'] = function() {
  var scale = d3.scale.ordinal()
      .domain([0, 1, 2, 3, 4, 5])
      .range(['white', 'orange', 'red', 'green', 'blue', 'black']);
  return function(value) {
    if (value > 5) {
      return scale(5);
    }
    return scale(value);
  };
}();


/**
 * Maps a value into a string to display.
 * @private
 */
historian.color.valueTextMap_ = {};

historian.color.valueTextMap_['Brightness'] = {
  0: 'off',
  1: 'dark',
  2: 'dim',
  3: 'moderate',
  4: 'bright'
};

historian.color.valueTextMap_['Signal strength'] = {
  0: 'none',
  1: 'poor',
  2: 'moderate',
  3: 'good',
  4: 'great'
};

historian.color.valueTextMap_['Charging status'] = {
  'c': 'charging',
  'd': 'discharging'
};


/**
 * Returns the formatted string for the value if defined in the valueTextMap_
 * above, otherwise returns the original value.
 *
 * @param {string} metric Name of metric.
 * @param {(string | number)} v Value to format.
 * @return {(string | number)} Formatted output.
 */
historian.color.valueFormatter = function(metric, v) {
  if (metric in historian.color.valueTextMap_) {
    return historian.color.valueTextMap_[metric][v];
  }
  return v;
};


/**
 * Sets the color function for each series.
 * This is either from the config file, or a linear scale if none exists.
 *
 * @param {!historian.SeriesData} seriesData Array of series to set
 *   color functions for.
 */
historian.color.generateSeriesColors = function(seriesData) {
  var color = d3.scale.category20c();

  seriesData.forEach(function(s) {

    // Predefined color functions from config file.
    if (s['name'] in historian.color.colorMap_) {
      s['color'] = historian.color.colorMap_[s['name']];

    // Create a different color for each string name.
    } else if (s.type === 'string' || s.type === 'service') {
      s['color'] = d3.scale.category20c();

    // Bool series only need one color (no entries for 0 values).
    } else if (s.type === 'bool') {
      var seriesColor = color(s['name']);
      s['color'] = function(c) {
        return seriesColor;
      };

    // Create a linear color scale.
    } else {
      var extent = d3.extent(s.values, function(d) {
        return d.value;
      });
      s['color'] = d3.scale.linear()
          .domain([extent[0], extent[1]])
          .range(['#FFFFFF', color(s['name'])]);
    }
  });
};
