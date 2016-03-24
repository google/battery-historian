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
 * @fileoverview Contains color configurations and generateSeriesColors for
 * creating color functions for each series.
 */
goog.provide('historian.color');

goog.require('goog.functions');
goog.require('goog.string');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');


/**
 * Map from series name to color function.
 * @private {!Object<function(string): string>}
 */
historian.color.colorMap_ = {};


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.BATTERY_LEVEL] =
    goog.functions.constant('blue');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.CRASHES] =
    goog.functions.constant('red');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.BRIGHTNESS] = d3.scale.ordinal()
    .domain([0, 1, 2, 3, 4])
    .range(['#addeed', '#415094', '#2c2782', '#060424', 'black']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.AM_PROC_START] = goog.functions.constant('green');


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.AM_PROC_DIED] = goog.functions.constant('red');


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.AM_LOW_MEMORY] = goog.functions.constant('orange');


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.AM_ANR] = goog.functions.constant('black');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.PHONE_SCANNING] =
    goog.functions.constant('#251dcc');


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.CONNECTIVITY] = d3.scale.ordinal()
    .domain([
      'TYPE_NONE', 'TYPE_MOBILE', 'TYPE_WIFI', 'TYPE_MOBILE_MMS',
      'TYPE_MOBILE_SUPL', 'TYPE_MOBILE_DUN', 'TYPE_MOBILE_HIPRI',
      'TYPE_WIMAX', 'TYPE_BLUETOOTH', 'TYPE_DUMMY', 'TYPE_ETHERNET',
      'TYPE_MOBILE_FOTA', 'TYPE_MOBILE_IMS', 'TYPE_MOBILE_CBS',
      'TYPE_WIFI_P2P', 'TYPE_MOBILE_IA', 'TYPE_EMERGENCY',
      'TYPE_PROXY', 'TYPE_VPN'
    ])
    .range([
      '#ffffff', '#1610c4', '#8ac1ff', '#ffd48a',
      '#ff9a8a', '#ff749b', '#99ff74',
      '#6d10c4', '#3dd1ca', '#808080', '#2f3838',
      '#f2ff00', '#99cc66', '#333366',
      '#006666', '#ff3300', '#990033',
      '#ff00ff', '#c99765'
    ]);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.DATA_CONNECTION] = d3.scale.ordinal()
    .domain([
      'none', '1xrtt', 'cdma', 'edge', 'ehrpd', 'evdo_0',
      'evdo_a', 'evdo_b', 'grps', 'hsdpa', 'hspa', 'hspap',
      'hsupa', 'iden', 'lte', 'umts', 'other', 'unknown'
    ])
    .range([
      'white', '#a1abe6', '#a1d4e6', '#a1e6cd', '#e6a1ba', '#d7a1e6',
      '#d7a1e6', '#d7a1e6', '#63ff52', '#ff5263', '#ff9d52', '#527aff',
      '#c7e6a1', '#22a369', 'black', '#42b7bd', '#fecdab', '#d15e81'
    ]);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.PHONE_STATE] = d3.scale.ordinal()
    .domain(['in', 'out', 'off'])
    .range(['black', 'orange', 'darkblue']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.MOBILE_RADIO_ON] = d3.scale.ordinal()
    .domain(['true'])
    .range(['#fa531b']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.CPU_RUNNING] =
    goog.functions.constant('black');


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.KERNEL_UPTIME] = d3.scale.ordinal()
    .domain([
      historian.metrics.KERNEL_UPTIME_WITH_USERSPACE,
      historian.metrics.KERNEL_UPTIME_NO_USERSPACE]
    )
    .range(['black', 'red']);


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.SCREEN_ON] = d3.scale.ordinal()
    .domain(['true'])
    .range(['red']);


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.GPS_ON] = d3.scale.ordinal()
    .domain(['true'])
    .range(['red']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.IDLE_MODE_ON] = d3.scale.ordinal()
    .domain(['off', 'light', 'full', '???'])
    .range(['white', 'orange', 'blue', 'black']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.SIGNAL_STRENGTH] = d3.scale.ordinal()
    .domain(['none', 'poor', 'moderate', 'good', 'great'])
    .range(['white', 'red', 'orange', 'yellow', 'green']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.WIFI_SIGNAL_STRENGTH] = d3.scale.ordinal()
    .domain(['none', 'poor', 'moderate', 'good', 'great'])
    .range(['white', 'red', 'orange', 'yellow', 'green']);


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.TEMPERATURE] = d3.scale.linear()
    .domain([0, 200, 300, 450, 1000])
    .range(['white', '#ffebcd', '#e2a76f', 'red', 'black']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.WIFI_SUPPLICANT] = d3.scale.ordinal()
    .domain([
      'asced', 'ascing', 'auth', 'compl', 'dsc', 'dorm',
      '4-way', 'group', 'inact', 'dis', 'inv', 'scan',
      'uninit'])
    .range([
      '#6AA121', '#5820a1', '#800000', '#008080', '6666664', '#b6b6b4',
      '#79baec', '#2b65ec', '#fbbbbb9', '#7f525D', '#990012', '#e9ab17',
      'red']);


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.SYNC_APP] = function() {
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


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.WAKE_LOCK_HELD] =
    goog.functions.constant('#A4D3EE');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.WAKELOCK_IN] = function() {
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


/** @private {function(string): string} */
historian.color.error_ = goog.functions.constant('red');


/**
 * Maps a value into a string to display.
 * @private {!Object<!Object<(number|string), string>>}
 */
historian.color.valueTextMap_ = {};


/** @private {!Object<number, string>} */
historian.color.valueTextMap_[historian.metrics.Csv.BRIGHTNESS] = {
  0: 'dark',
  1: 'dim',
  2: 'medium',
  3: 'light',
  4: 'bright'
};


/** @private {!Object<string>} */
historian.color.valueTextMap_[historian.metrics.Csv.CHARGING_STATUS] = {
  'c': 'charging',
  'd': 'discharging',
  'n': 'not charging',
  'f': 'full'
};


/** @private {!Object<string>} */
historian.color.valueTextMap_[historian.metrics.Csv.WIFI_SUPPLICANT] = {
  'asced': 'ASSOCIATED',
  'ascing': 'ASSOCIATING',
  'auth': 'AUTHENTICATING',
  'compl': 'COMPLETED',
  'dsc': 'DISCONNECTED',
  'dorm': 'DORMANT',
  '4-way': 'FOUR_WAY_HANDSHAKE',
  'group': 'GROUP_HANDSHAKE',
  'inact': 'INACTIVE',
  'dis': 'INTERFACE_DISABLED',
  'inv': 'INVALID',
  'scan': 'SCANNING',
  'uninit': 'UNINITIALIZED'
};


/**
 * Returns the formatted string for the value if defined in the valueTextMap_
 * above, otherwise returns the original value.
 *
 * @param {string} metric Name of metric.
 * @param {string|number} v Value to format.
 * @return {string|number} Formatted output.
 */
historian.color.valueFormatter = function(metric, v) {
  if (metric == historian.metrics.Csv.TEMPERATURE) {
    // Temperature values are in decaCelcius.
    var celcius = v / 10;
    var fahrenheit = celcius * 9 / 5 + 32;
    return goog.string.subs(
        '<span style="background-color: #ffebcd">%s °C (%s °F)</span>',
        goog.string.htmlEscape(celcius.toFixed(1)),
        goog.string.htmlEscape(fahrenheit.toFixed(1)));
  }

  if (metric in historian.color.valueTextMap_) {
    var formatted = historian.color.valueTextMap_[metric][v];
    if (formatted) {
      return formatted;
    }
  }
  return v;
};


/**
 * Sets the color function for each series in each group.
 * This is either from the config file, or a linear scale if none exists.
 *
 * @param {!Object<!historian.SeriesGroup>} seriesData Map from series
 *     group name to series group object to set the color for.
 */
historian.color.generateSeriesColors = function(seriesData) {
  var color = d3.scale.category20c();

  for (var groupName in seriesData) {
    var seriesGroup = seriesData[groupName];
    seriesGroup.series.forEach(function(s) {
      if (s['type'] == historian.metrics.ERROR_TYPE) {
        s['color'] = historian.color.error_;

      // Predefined color functions from config file.
      } else if (s['name'] in historian.color.colorMap_) {
        s['color'] = historian.color.colorMap_[s['name']];

      // Create a different color for each string name.
      } else if (s.type == 'string' || s.type == 'service') {
        s['color'] = d3.scale.category20c();

      // Bool series only need one color (no entries for 0 values).
      } else if (s.type == 'bool') {
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
  }
};
