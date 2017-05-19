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

goog.require('goog.asserts');
goog.require('goog.functions');
goog.require('goog.string');
goog.require('historian.historianV2Logs');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.time');


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
historian.color.colorMap_[historian.metrics.Csv.NATIVE_CRASHES] =
    goog.functions.constant('black');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.DVM_LOCK_SAMPLE] =
    goog.functions.constant('black');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.SELINUX_DENIAL] =
    goog.functions.constant('black');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.STRICT_MODE_VIOLATION] =
    goog.functions.constant('red');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.CHOREOGRAPHER_SKIPPED] =
    goog.functions.constant('red');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.GC_PAUSE_BACKGROUND_PARTIAL] =
    goog.functions.constant('orange');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.GC_PAUSE_BACKGROUND_STICKY] =
    goog.functions.constant('red');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.GC_PAUSE_FOREGROUND] =
    goog.functions.constant('maroon');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND] =
    d3.scaleThreshold()
        .domain([1000, 5000])
        .range(['orange', 'maroon', 'black']);


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.BROADCAST_DISPATCH_FOREGROUND] =
    historian.color.colorMap_[
        historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND];


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.BROADCAST_ENQUEUE_BACKGROUND] =
    historian.color.colorMap_[
        historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND];


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.BROADCAST_DISPATCH_BACKGROUND] =
    historian.color.colorMap_[
        historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND];


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.ACTIVE_BROADCAST_FOREGROUND] =
    historian.color.colorMap_[
        historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND];


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.ACTIVE_BROADCAST_BACKGROUND] =
    historian.color.colorMap_[
        historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND];


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.BRIGHTNESS] = d3.scaleOrdinal()
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
historian.color.colorMap_[historian.metrics.Csv.LOW_MEMORY_KILLER] =
    goog.functions.constant('orange');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.PHONE_SCANNING] =
    goog.functions.constant('#251dcc');


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.APP_TRANSITIONS] =
    d3.scaleOrdinal()
        .domain(['Warm process start', 'Cold process start', 'Unknown'])
        .range(['orange', 'lightblue', 'grey']);


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.BACKGROUND_COMPILATION] =
    d3.scaleOrdinal()
        .domain(['Compilation', 'Verification', 'Other'])
        .range(['red', 'orange', 'grey']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.CONNECTIVITY] = d3.scaleOrdinal()
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
    historian.metrics.Csv.DATA_CONNECTION] = d3.scaleOrdinal()
    .domain([
      'none', '1xrtt', 'cdma', 'edge', 'ehrpd', 'evdo_0',
      'evdo_a', 'evdo_b', 'gprs', 'hsdpa', 'hspa', 'hspap',
      'hsupa', 'iden', 'lte', 'umts', 'other', 'unknown'
    ])
    .range([
      'white', '#a1abe6', '#a1d4e6', '#a1e6cd', '#e6a1ba', '#d7a1e6',
      '#d7a1e6', '#d7a1e6', '#63ff52', '#ff5263', '#ff9d52', '#527aff',
      '#c7e6a1', '#22a369', 'black', '#42b7bd', '#fecdab', '#d15e81'
    ]);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.PHONE_STATE] = d3.scaleOrdinal()
    .domain(['in', 'out', 'off'])
    .range(['black', 'orange', 'darkblue']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.MOBILE_RADIO_ON] = d3.scaleOrdinal()
    .domain(['true'])
    .range(['#fa531b']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.CPU_RUNNING] =
    goog.functions.constant('black');


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.KERNEL_UPTIME] = d3.scaleOrdinal()
    .domain([
      historian.metrics.KERNEL_UPTIME_WITH_USERSPACE,
      historian.metrics.KERNEL_UPTIME_NO_USERSPACE]
    )
    .range(['black', 'red']);


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.SCREEN_ON] = d3.scaleOrdinal()
    .domain(['true'])
    .range(['red']);


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.GPS_ON] = d3.scaleOrdinal()
    .domain(['true'])
    .range(['red']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.IDLE_MODE_ON] = d3.scaleOrdinal()
    .domain(['off', 'light', 'full', '???'])
    .range(['white', 'orange', 'blue', 'black']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.SIGNAL_STRENGTH] = d3.scaleOrdinal()
    .domain(['none', 'poor', 'moderate', 'good', 'great'])
    .range(['white', 'red', 'orange', 'yellow', 'green']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.WIFI_SIGNAL_STRENGTH] = d3.scaleOrdinal()
    .domain(['none', 'poor', 'moderate', 'good', 'great'])
    .range(['white', 'red', 'orange', 'yellow', 'green']);


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.TEMPERATURE] = d3.scaleLinear()
    .domain([0, 20, 30, 45, 100])
    .range(['white', '#ffebcd', '#e2a76f', 'red', 'black']);


/** @private {function(string): string} */
historian.color.colorMap_[
    historian.metrics.Csv.WIFI_SUPPLICANT] = d3.scaleOrdinal()
    .domain([
      'asced', 'ascing', 'auth', 'compl', 'dsc', 'dorm',
      '4-way', 'group', 'inact', 'dis', 'inv', 'scan',
      'uninit'])
    .range([
      '#6AA121', '#5820a1', '#800000', '#008080', '#666664', '#b6b6b4',
      '#79baec', '#2b65ec', '#fbbbbb9', '#7f525D', '#990012', '#e9ab17',
      'red']);


/** @private {function(string): string} */
historian.color.colorMap_[historian.metrics.Csv.SYNC_APP] = function() {
  var scale = d3.scaleOrdinal()
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
  var scale = d3.scaleOrdinal()
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
historian.color.colorMap_[historian.metrics.Csv.WEARABLE_RPC] =
    d3.scaleOrdinal().domain(['direct', 'cloud', 'exception']).range([
      'green', 'blue', 'red'
    ]);


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
historian.color.valueTextMap_[historian.metrics.Csv.HEALTH] = {
  '?': 'unknown',
  'c': 'cold',
  'd': 'dead',
  'g': 'good',
  'h': 'overheat',
  'f': 'failure',
  'v': 'over-voltage'
};


/** @private {!Object<string>} */
historian.color.valueTextMap_[historian.metrics.Csv.PLUG_TYPE] = {
  'a': 'ac',
  'n': 'none',
  'u': 'usb',
  'w': 'wireless'
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
 * Returns the formatted string for the value if it's a special case (eg. it's
 * defined in the valueTextMap_ above), otherwise returns the original value.
 *
 * @param {string} metric Name of metric.
 * @param {!historian.Value} v Value to format.
 * @param {boolean=} opt_shortForm Set to true if space is limted.
 * @return {{value: !historian.Value, classes: (string|undefined)}}
 *     Formatted output, along with any HTMl classes to apply.
 */
historian.color.valueFormatter = function(metric, v, opt_shortForm) {
  switch (metric) {
    case historian.metrics.KERNEL_UPTIME:
      // The kernel uptime value can be a string, whereas the type is
      // stored as a number. We only want to format the kernel uptime type.
      if (typeof v == 'number') {
        if (v == historian.metrics.KERNEL_UPTIME_WITH_USERSPACE) {
          v = 'The corresponding CPU running event intersects with' +
              ' a userspace wakelock event';
        } else if (v == historian.metrics.KERNEL_UPTIME_NO_USERSPACE) {
          v = 'The corresponding CPU running event only has kernel uptime';
        }
      }
      return {value: v};
    case historian.metrics.Csv.TEMPERATURE:
      // Temperature values are stored in Celcius.
      var fahrenheit = v * 9 / 5 + 32;
      var text = goog.string.subs('%s °C (%s °F)',
          goog.string.htmlEscape(v.toFixed(1)),
          goog.string.htmlEscape(fahrenheit.toFixed(1)));
      return {value: text, classes: 'temperature'};
    case historian.metrics.Csv.COULOMB_CHARGE:
      // Units are in mAh.
      return {value: goog.string.subs('%s mAh', v)};
    case historian.metrics.Csv.ACTIVE_BROADCAST_BACKGROUND:
    case historian.metrics.Csv.ACTIVE_BROADCAST_FOREGROUND:
    case historian.metrics.Csv.BROADCAST_ENQUEUE_BACKGROUND:
    case historian.metrics.Csv.BROADCAST_DISPATCH_BACKGROUND:
    case historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND:
    case historian.metrics.Csv.BROADCAST_DISPATCH_FOREGROUND:
      return {value: historian.time.formatDuration(/** @type {number} */ (v))};
    default:
      // If the metric originally had string values but was converted to
      // numbers for displaying as a line, we want to convert it back to
      // readable strings.
      if (metric in historian.metrics.expectedStrings &&
          typeof v == 'number') {
        var idx = parseInt(v, 10);
        var values = historian.metrics.expectedStrings[metric];
        if (idx < values.length) {
          // Don't return in case there is a mapping in the valueTextMap.
          // e.g. PLUG_TYPE 'n' maps to 'none'.
          v = values[idx];
        }
      }
      if ((typeof v == 'string' || typeof v == 'number') &&
          metric in historian.color.valueTextMap_ && !opt_shortForm) {
        var formatted = historian.color.valueTextMap_[metric][v];
        if (formatted) {
          return {value: formatted};
        }
      }
  }
  return {value: v};
};


/**
 * List of colors to use for graphed lines.
 * TODO: make it possible to dynamically set the length, and switch to a
 * random color generator
 * @private {!Array<string>}
 */
historian.color.graphLineColors_ = ['black', 'red', 'yellow', 'pink', 'green',
  'orange', 'blue', 'brown', 'silver', 'purple'];


/**
 * Returns a color that can be used for the level line.
 *
 * @param {number} i The index of the line. It should be consistent to have the
 *     same line be colored the same.
 * @return {string} A string that is a color.
 */
historian.color.getLineColor = function(i) {
  goog.asserts.assert(i >= 0);
  return historian.color.graphLineColors_[
      i % historian.color.graphLineColors_.length];
};


/**
 * Sets the color function for each series in each group.
 * This is either from the config file, or a linear scale if none exists.
 *
 * @param {!historian.metrics.DataHasher} groups Groups to generate colors for.
 */
historian.color.generateSeriesColors = function(groups) {
  var color = d3.scaleOrdinal(d3.schemeCategory20c);

  groups.getAll().forEach(function(group) {
    group.series.forEach(function(s) {
      if (s.type == historian.metrics.ERROR_TYPE) {
        s.color = historian.color.error_;

      // Predefined color functions from config file.
      } else if (s.name in historian.color.colorMap_) {
        s.color = historian.color.colorMap_[s.name];

      } else if (s.source == historian.historianV2Logs.Sources.EVENT_LOG) {
        s.color = goog.functions.constant('green');

      // Create a different color for each string name.
      } else if (s.type == 'string' || s.type == 'service') {
        s.color = d3.scaleOrdinal(d3.schemeCategory20c);

      // Bool series only need one color (no entries for 0 values).
      } else if (s.type == 'bool') {
        s.color = goog.functions.constant('green');

      // Create a linear color scale.
      } else if (s.type == 'int' || s.type == 'float') {
        var extent = d3.extent(s.values, function(d) {
          return d.value;
        });
        s.color = d3.scaleLinear()
            .domain([extent[0], extent[1]])
            .range(['#FFFFFF', color(s.name)]);

      // If it's not a default type ('string', 'service', 'bool' or 'int'),
      // and no custom color scale is defined, use a constant color scale.
      } else {
        s.color = goog.functions.constant('black');
      }
    });
  });
};
