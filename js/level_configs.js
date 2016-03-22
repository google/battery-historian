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

goog.provide('historian.LevelConfigs');
goog.provide('historian.LevelConfiguration');

goog.require('goog.string');
goog.require('historian.metrics.Csv');
goog.require('historian.utils');


/**
 * Specifies which metric is displayed as the level line, graph axes and legend.
 *
 * @typedef {{
 *   displayPowerInfo: boolean,
 *   enableSampling: boolean,
 *   formatDischarge: ?(function(number): string),
 *   formatLevel: ?(function(number): string),
 *   id: string,
 *   name: string,
 *   legendText: string,
 *   levelDisplayText: string,
 *   hiddenBarMetrics: !Array<string>,
 *   yDomain: {min: number, max: number}
 * }}
 */
historian.LevelConfiguration;



/**
 * Stores battery level and powermonitor configs and creates configs for other
 * metrics.
 * @param {number} capacity The device capacity in mAh.
 * @param {!Array<!historian.Entry>} powermonitorData
 * @constructor
 * @struct
 */
historian.LevelConfigs = function(capacity, powermonitorData) {
  /** @private {!Object<!historian.LevelConfiguration>} */
  this.configs_ = {};
  // Predefined configurations.
  this.configs_[historian.metrics.Csv.BATTERY_LEVEL] =
      historian.LevelConfigs.batteryLevelConfig_(capacity);
  this.configs_[historian.metrics.Csv.POWERMONITOR] =
      historian.LevelConfigs.powermonitorConfig_(powermonitorData);
};


/**
 * Default Y domain to set for a metric if no data is specified.
 * This corresponds to the y axis in the Historian v2 plot.
 * @private {{min: number, max: number}}
 */
historian.LevelConfigs.DEFAULT_Y_DOMAIN_ = {min: 0, max: 100};


/**
 * Gets the config corresponding to the given name. Creates a default config
 * using the name and data if one does not exist.
 * @param {string} name The metric to get the level config for.
 * @param {!Array<!historian.Entry>=} opt_data The values to calculate
 *     the range for.
 * @return {!historian.LevelConfiguration}
 */
historian.LevelConfigs.prototype.getConfig = function(name, opt_data) {
  if (!(name in this.configs_)) {
    var yDomain = historian.LevelConfigs.DEFAULT_Y_DOMAIN_;
    if (opt_data) {
      var extent = d3.extent(opt_data, function(d) {
        return d.value;
      });
      yDomain = {min: extent[0], max: extent[1]};
    }
    this.configs_[name] = historian.LevelConfigs.createConfig_(name, yDomain);
  }
  return this.configs_[name];
};


/**
 * Creates a config for the given metric.
 * @param {string} name The metric name.
 * @param {{min: number, max: number}} yDomain The extent of metric values.
 * @return {!historian.LevelConfiguration} The config for the metric.
 * @private
 */
historian.LevelConfigs.createConfig_ = function(name, yDomain) {
  return {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge: null,
    formatLevel: null,
    name: name,
    id: historian.utils.toValidID(name),
    legendText: name,
    levelDisplayText: name,
    hiddenBarMetrics: [],
    yDomain: yDomain
  };
};


/**
 * Returns the configuration for showing the battery level as the level line.
 * @param {number} c The device capacity in mAh.
 * @return {!historian.LevelConfiguration}
 * @private
 */
historian.LevelConfigs.batteryLevelConfig_ = function(c) {
  return {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge:
        historian.LevelConfigs.formatBatteryDischarge_.bind(undefined, c),
    formatLevel: historian.LevelConfigs.batteryPercentage_.bind(undefined, c),
    id: 'batterylevel',
    name: historian.metrics.Csv.BATTERY_LEVEL,
    legendText: 'Battery Level',
    levelDisplayText: 'Battery Level',
    hiddenBarMetrics: [],
    yDomain: historian.LevelConfigs.DEFAULT_Y_DOMAIN_
  };
};


/**
 * The configuration for displaying powermonitor level data.
 * @param {!Array<!historian.Entry>} data
 * @return {!historian.LevelConfiguration}
 * @private
 */
historian.LevelConfigs.powermonitorConfig_ = function(data) {
  var extent = d3.extent(data, function(d) {
    return d.value;
  });
  return {
    displayPowerInfo: true,
    enableSampling: true,
    formatDischarge: null,
    formatLevel: null,
    id: 'powermonitor',
    name: 'Powermonitor',
    legendText: 'Powermonitor Reading (mA)',
    levelDisplayText: 'Powermonitor (mA)',
    hiddenBarMetrics: [
      historian.metrics.Csv.BATTERY_LEVEL,
      historian.metrics.Csv.POWERMONITOR
    ],
    yDomain: {
      min: Math.min(0, extent[0] || 0),
      max: Math.max(1000, extent[1] || 1000)
    }  // mA
  };
};


/**
 * Formats the rates of change for the battery level metric.
 * @param {number} capacity The capacity of the device in mAh.
 * @param {number} rate The rate of change.
 * @return {string} The formatted rate.
 * @private
 */
historian.LevelConfigs.formatBatteryDischarge_ = function(capacity, rate) {
  var formatted = rate > 0 ? 'Charge rate: ' : 'Discharge rate: ';
  // Round rate to 2 decimal points.
  var rounded = Math.abs(rate).toFixed(2);
  formatted += goog.string.subs('%s % / hour', rounded);

  if (capacity > 0) {
    // Show the implied mA drain rate next to the % drain.
    var discharged = historian.LevelConfigs.batteryPercentage_(capacity, rate);
    formatted += goog.string.subs(' (%s mA)', discharged);
  }
  return formatted;
};


/**
 * Calculates the percentage value of the device capacity.
 * @param {number} capacity The capacity of the device in mAh.
 * @param {number} percentage The float percentage (0 - 100) to calculate.
 * @return {string} The value rounded to two decimal places.
 * @private
 */
historian.LevelConfigs.batteryPercentage_ = function(capacity, percentage) {
  return parseFloat(Math.abs(percentage) / 100 * capacity).toFixed(2);
};
