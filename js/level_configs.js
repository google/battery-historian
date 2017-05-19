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
goog.provide('historian.LineGroup');

goog.require('goog.array');
goog.require('goog.string');
goog.require('historian.metrics');
goog.require('historian.time');
goog.require('historian.utils');


/**
 * Specifies which metric is displayed as the level line, graph axes and legend.
 *
 * customDesc, if defined, is a function that can be used to get a custom
 * description to show in the tooltip for the hovered over data. It takes as
 * parameters the index of the line, and then the start and end values.
 *
 * @typedef {{
 *   displayPowerInfo: boolean,
 *   enableSampling: boolean,
 *   formatDischarge: ?(function(number): string),
 *   formatLevel: ?(function(number): string),
 *   showExtraSummary: boolean,
 *   ticksShortForm: (boolean|undefined),
 *   ticksAsFormattedInts: (boolean|undefined),
 *   id: string,
 *   name: string,
 *   legendText: string,
 *   legendTexts: (?Array<string>|undefined),
 *   levelDisplayText: string,
 *   yDomain: {min: number, max: number},
 *   isRateOfChange: boolean,
 *   customDesc: ((function(number,number,number): string)|undefined),
 *   opacity: number
 * }}
 */
historian.LevelConfiguration;


/**
 * A group of lines that will be graphed together.
 *
 * @typedef {{
 *   names: !Array<string>,
 *   desc: (string|undefined)
 * }}
 */
historian.LineGroup;



/**
 * Stores predefined level configurations for battery level, coulomb charge, and
 * power monitor.
 * @param {number} capacity The device capacity in mAh.
 * @param {!Object<!historian.SeriesGroup>} nameToLevelGroup
 * @param {!Object<!historian.LineGroup>=} opt_nameToLineGroups
 * @constructor
 * @struct
 */
historian.LevelConfigs = function(capacity, nameToLevelGroup,
    opt_nameToLineGroups) {
  /** @private {!Object<!historian.LevelConfiguration>} */
  this.configs_ = {};
  /** @private {!Object<!Array<string>>} */
  this.chartGroup_ = {};
  // Predefined configurations.
  this.configs_[historian.metrics.Csv.BATTERY_LEVEL] =
      historian.LevelConfigs.batteryLevelConfig_(capacity);
  this.configs_[historian.metrics.Csv.COULOMB_CHARGE] =
      historian.LevelConfigs.coulombChargeConfig_(capacity);

  [
    {
      group: historian.metrics.Csv.AM_PROC,
      series: historian.metrics.Csv.AM_PROC_START,  // AM_PROC has 2 series.
      configFunc: historian.LevelConfigs.amProcConfig_
    },
    {
      group: historian.metrics.Csv.BRIGHTNESS,
      configFunc: historian.LevelConfigs.brightnessConfig_
    },
    {
      group: historian.metrics.Csv.POWER_MONITOR,
      configFunc: historian.LevelConfigs.powerMonitorConfig_
    },
    {
      group: historian.metrics.Csv.POWER_MONITOR_MW,
      configFunc: historian.LevelConfigs.powerMonitorMWConfig_
    },
    {
      group: historian.metrics.Csv.POWER_MONITOR_MAH,
      configFunc: historian.LevelConfigs.powerMonitorMAHConfig_
    },
    {
      group: historian.metrics.Csv.TEMPERATURE,
      configFunc: historian.LevelConfigs.temperatureConfig_
    },
    {
      group: historian.metrics.Csv.WIFI_SUPPLICANT,
      configFunc: historian.LevelConfigs.wifiSupplicantConfig_
    }
  ].forEach(function(desc) {
    var data = [];
    if (desc.group in nameToLevelGroup) {
      var series = nameToLevelGroup[desc.group].series;
      var wantSeriesName = desc.series || desc.group;
      var idx = goog.array.findIndex(series, function(series) {
        return series.name == wantSeriesName;
      });
      if (idx >= 0) {
        data = series[idx].values;
      } else {
        console.log('could not find data for group: ' + desc.group +
            ', series: ' + desc.series);
      }
    }
    this.configs_[desc.group] = desc.configFunc(data);
  }, this);

  if (opt_nameToLineGroups) {
    Object.keys(opt_nameToLineGroups).forEach(function(groupName) {
      var group = opt_nameToLineGroups[groupName];
      var names = group.names;
      this.chartGroup_[groupName] = names;
      var groupValues = [];
      var displayPowerInfo = false;
      var opacity = 1;
      var enableSampling = false;

      // Get the range of the y-axis by looking at all of the data in the group.
      names.forEach(function(name) {
        if (name in nameToLevelGroup) {
          groupValues = groupValues.concat(
              nameToLevelGroup[name].series[0].values);
        }
        // This currently only affects rendering of power monitor data.
        if (name in this.configs_) {
          var config = this.configs_[name];
          displayPowerInfo |= config.displayPowerInfo;
          opacity = Math.min(opacity, config.opacity);
          enableSampling |= config.enableSampling;
        }
      }, this);
      if (groupValues.length == 0) {
        // There's no data for the group.
        return;
      }
      var extent = d3.extent(groupValues, function(d) { return d.value; });
      var config = historian.LevelConfigs.createConfig_(
          groupName, {min: extent[0], max: extent[1]}, false);
      config.legendTexts = names;
      config.customDesc = function(idx, start, end) {
        return goog.string.subs('%s: between %s and %s %s',
            names[idx], start, end, group.desc || '');
      };
      config.displayPowerInfo = displayPowerInfo;
      config.opacity = opacity;
      config.enableSampling = enableSampling;
      this.configs_[groupName] = config;
    }, this);
  }
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
 * @param {boolean=} opt_isRateOfChange True if the data to display is the
 *     rate of change for the series.
 * @param {!Array<!Array<!historian.Entry>>=} opt_data The values to calculate
 *     the range for.
 * @return {!historian.LevelConfiguration}
 */
historian.LevelConfigs.prototype.getConfig =
    function(name, opt_isRateOfChange, opt_data) {
  var isRateOfChange = opt_isRateOfChange || false;
  var altName = name;
  if (isRateOfChange) {
    altName = altName.replace(historian.metrics.ROC_SUFFIX, '');
  }

  if (!(name in this.configs_)) {
    var concatData = [];
    if (opt_data && opt_data.length > 0) {
      opt_data.forEach(function(data) {
        concatData = concatData.concat(data);
      });
    }
    var config = historian.LevelConfigs.createConfig_(
        name, this.getYDomain_(altName, isRateOfChange, concatData),
        isRateOfChange);

    if (historian.metrics.isScreenOffDischargeMetric(altName)) {
      config.customDesc = function(idx, start, end) {
        var label = this.chartGroup_[altName] ?
            this.chartGroup_[altName][idx] : altName;
        return goog.string.subs('%s: %s % / hr', label, start.toFixed(2));
      }.bind(this);
    }
    if (isRateOfChange && altName in this.chartGroup_) {
      // Set the legendTexts field with the list of lines in the group.
      config.legendTexts = this.chartGroup_[altName].map(function(g) {
        // Abbreviating 'Rate of Change' since adding the full text to every
        // line in the group will make it hard to fit them all in the small
        // legend space.
        return altName == historian.metrics.Csv.SCREEN_OFF_DISCHARGE_GROUP ?
            g : g + ' (RoC)';
      });
    }
    this.configs_[name] = config;
  }
  return this.configs_[name];
};


/**
 * Returns the y domain for the given data.
 * @param {string} seriesName
 * @param {boolean} isRateOfChange
 * @param {!Array<!historian.Entry>} data
 * @return {{min: number, max: number}}
 * @private
 */
historian.LevelConfigs.prototype.getYDomain_ =
    function(seriesName, isRateOfChange, data) {
  if (data.length == 0) {
    return historian.LevelConfigs.DEFAULT_Y_DOMAIN_;
  }
  var isRelevantROCEntry = function(d) {
    // If it is rate of change data, only consider entries that are longer
    // than 10 seconds, as the shorter entries are usually not important and
    // may extremely skew the graph.
    return d.endTime - d.startTime > 10 * historian.time.MSECS_IN_SEC;
  };
  if (historian.metrics.isScreenOffDischargeMetric(seriesName)) {
    var extent = d3.extent(data, function(d) {
      if (d.duringScreenOff && isRelevantROCEntry(d)) {
        return d.value;
      }
      // Return undefined so d3 will ignore the value.
    });
    return {min: extent[0], max: 0};
  }
  if (isRateOfChange) {
    var extent = d3.extent(data, function(d) {
      if (isRelevantROCEntry(d)) {
        return d.value;
      }
      // Return undefined so d3 will ignore the value.
    });
    // When displaying rate of change data, we want 0 to be in the middle
    // of the y-axis, so set the min and max range using the larger of
    // two absolute values.
    var maxAbsVal = Math.max(Math.abs(extent[0]), Math.abs(extent[1]));
    return {min: -maxAbsVal, max: maxAbsVal};
  }
  var extent = d3.extent(data, function(d) { return d.value; });
  return {min: extent[0], max: extent[1]};
};


/**
 * Creates a config for the given metric.
 * @param {string} name The metric name.
 * @param {{min: number, max: number}} yDomain The extent of metric values.
 * @param {boolean} isRateOfChange True if the data to display is the
 *     rate of change for the series.
 * @return {!historian.LevelConfiguration} The config for the metric.
 * @private
 */
historian.LevelConfigs.createConfig_ =
    function(name, yDomain, isRateOfChange) {
  var isStringMetric = name in historian.metrics.expectedStrings;
  if (isStringMetric) {
    // We want to show all values as ticks even if they don't appear in
    // the data.
    yDomain = {
      min: 0,
      max: historian.metrics.expectedStrings[name].length - 1
    };
  }
  return {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge: null,
    formatLevel: null,
    showExtraSummary: false,
    ticksShortForm: false,
    // Metrics which have values converted from strings to numbers.
    ticksAsFormattedInts: isStringMetric,
    name: name,
    id: historian.utils.toValidID(name),
    legendText: name,
    levelDisplayText: name,
    yDomain: yDomain,
    isRateOfChange: isRateOfChange,
    opacity: isStringMetric ? 0.3 : 1
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
    showExtraSummary: true,
    id: 'batterylevel',
    name: historian.metrics.Csv.BATTERY_LEVEL,
    legendText: 'Battery Level',
    levelDisplayText: 'Battery Level',
    yDomain: historian.LevelConfigs.DEFAULT_Y_DOMAIN_,
    isRateOfChange: false,
    opacity: 1
  };
};


/**
 * Returns the configuration for showing the coulomb charge as the level line.
 * @param {number} c The device capacity in mAh.
 * @return {!historian.LevelConfiguration}
 * @private
 */
historian.LevelConfigs.coulombChargeConfig_ = function(c) {
  return {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge: function(delta) {
      // The input will be the delta in absolute mAh. Need to multiply by 100 to
      // make it a percentage and divide by the capacity to get the discharge
      // rate.
      return historian.LevelConfigs.formatBatteryDischarge_(c, 100 * delta / c);
    },
    // Coulomb charge is already in mAh.
    formatLevel: function(n) {return n.toString();},
    showExtraSummary: true,
    id: 'coulombcharge',
    name: historian.metrics.Csv.COULOMB_CHARGE,
    legendText: 'Coulomb Charge',
    levelDisplayText: 'Coulomb Charge',
    yDomain: {min: 0, max: c},
    isRateOfChange: false,
    opacity: 1
  };
};


/**
 * The configuration for displaying power monitor level data.
 * @param {!Array<!historian.Entry>} data
 * @return {!historian.LevelConfiguration}
 * @private
 */
historian.LevelConfigs.powerMonitorConfig_ = function(data) {
  var extent = d3.extent(data, function(d) {
    return d.value;
  });
  return {
    displayPowerInfo: true,
    enableSampling: true,
    formatDischarge: null,
    formatLevel: null,
    showExtraSummary: false,
    id: 'powermonitor',
    name: historian.metrics.Csv.POWER_MONITOR,
    legendText: 'Power Monitor Reading (mA)',
    levelDisplayText: 'Power Monitor (mA)',
    yDomain: {
      min: Math.min(0, extent[0] || 0),
      max: Math.max(1000, extent[1] || 1000)
    },  // mA
    isRateOfChange: false,
    opacity: 0.3
  };
};


/**
 * The configuration for displaying power monitor milliwatts data.
 * @param {!Array<!historian.Entry>} data
 * @return {!historian.LevelConfiguration}
 * @private
 */
historian.LevelConfigs.powerMonitorMWConfig_ = function(data) {
  var extent = d3.extent(data, function(d) { return d.value; });
  var config = historian.LevelConfigs.createConfig_(
      historian.metrics.Csv.POWER_MONITOR_MW,
      {min: extent[0], max: extent[1]}, false);
  config.displayPowerInfo = true;
  config.enableSampling = true;
  config.opacity = 0.3;
  return config;
};


/**
 * The configuration for displaying power monitor mAh data.
 * @param {!Array<!historian.Entry>} data
 * @return {!historian.LevelConfiguration}
 * @private
 */
historian.LevelConfigs.powerMonitorMAHConfig_ = function(data) {
  var extent = d3.extent(data, function(d) { return d.value; });
  var config = historian.LevelConfigs.createConfig_(
      historian.metrics.Csv.POWER_MONITOR_MAH,
      {min: extent[0], max: extent[1]}, false);
  config.enableSampling = true;
  config.displayPowerInfo = true;
  config.opacity = 0.3;
  return config;
};


/**
 * The configuration for displaying temperature level data.
 * @param {!Array<!historian.Entry>} data
 * @return {!historian.LevelConfiguration}
 * @private
 */
historian.LevelConfigs.temperatureConfig_ = function(data) {
  var extent = d3.extent(data, function(d) {
    return d.value;
  });
  return {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge: null,
    formatLevel: null,
    showExtraSummary: false,
    id: 'temperature',
    name: historian.metrics.Csv.TEMPERATURE,
    legendText: 'Temperature (°C)',
    levelDisplayText: 'Temperature',
    yDomain: {
      min: extent[0],
      max: extent[1],
    },
    isRateOfChange: false,
    opacity: 1
  };
};


/**
 * The configuration for displaying brightness data.
 * @param {!Array<!historian.Entry>} data
 * @return {!historian.LevelConfiguration}
 * @private
 */
historian.LevelConfigs.brightnessConfig_ = function(data) {
  var extent = d3.extent(data, function(d) { return d.value; });
  var config = historian.LevelConfigs.createConfig_(
      historian.metrics.Csv.BRIGHTNESS, {min: extent[0], max: extent[1]},
      false);
  // Brightness values are only integer, so don't show in-between ticks.
  config.ticksAsFormattedInts = true;
  return config;
};


/**
 * The configuration for displaying wifi supplicant data.
 * @param {!Array<!historian.Entry>} data
 * @return {!historian.LevelConfiguration}
 * @private
 */
historian.LevelConfigs.wifiSupplicantConfig_ = function(data) {
  var extent = d3.extent(data, function(d) { return d.value; });
  var config = historian.LevelConfigs.createConfig_(
      historian.metrics.Csv.WIFI_SUPPLICANT, {min: extent[0], max: extent[1]},
      false);
  // The formatted values are too long to display in the y-axis.
  config.ticksShortForm = true;
  return config;
};


/**
 * The configuration for displaying AM Proc data.
 * @param {!Array<!historian.Entry>} data
 * @return {!historian.LevelConfiguration}
 * @private
 */
historian.LevelConfigs.amProcConfig_ = function(data) {
  var extent = d3.extent(data, function(d) {
    return d.value;
  });
  return {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge: null,
    formatLevel: null,
    showExtraSummary: false,
    id: 'amproc',
    name: historian.metrics.Csv.AM_PROC,
    legendText: 'Activity Manager Process Starts per minute',
    levelDisplayText: 'Activity Manager Process Starts',
    yDomain: {
      min: extent[0],
      max: extent[1],
    },
    isRateOfChange: false,
    opacity: 0.3
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
