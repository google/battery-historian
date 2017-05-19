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

goog.provide('historian.LevelData');
goog.provide('historian.LevelData.Listener');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('historian.LineGroup');
goog.require('historian.constants');
goog.require('historian.metrics');
goog.require('historian.utils');



/**
 * Holds the currently selected level metric, as well the data and configs for
 * all metrics. Handles the selecting of new metrics and notifying listeners of
 * the change.
 * @param {!Object<!historian.SeriesGroup>} groups All the series groups.
 * @param {string} defaultLevelMetric The level metric to display as default.
 * @param {!historian.LevelConfigs} levelConfigs The level configs.
 * @param {jQuery=} opt_container The graph container this bar data is
 *     rendered in.
 * @param {?Object<!historian.LineGroup>=} opt_nameToLineGroup
 * @constructor
 * @struct
 */
historian.LevelData = function(groups, defaultLevelMetric, levelConfigs,
    opt_container, opt_nameToLineGroup) {
  /** @private {!Array<!historian.LevelData.Listener>} */
  this.listeners_ = [];

  /** @private {!Object<!historian.SeriesGroup>} */
  this.groups_ = groups;

  /** @private {!Object<!historian.LineGroup>} */
  this.lineGroups_ = opt_nameToLineGroup || {};

  /**
   * List of metrics that are displayed.
   * @private {!Array<string>}
   */
  this.levelMetrics_ = [defaultLevelMetric];

  /** @private {string} */
  this.levelMetric_ = defaultLevelMetric;

  /** @private {!historian.LevelConfigs} */
  this.levelConfigs_ = levelConfigs;

  /**
   * Map from group name to rateOfChange data.
   * Generated and cached on request.
   * @private {!Object<!Array<!historian.Entry>>}
   */
  this.rateOfChangeData_ = {};

  /** @private {boolean} */
  this.showRateOfChange_ = false;

  /** @private {boolean} */
  this.prevRateOfChangeState_ = false;

  /** @private {?jQuery} */
  this.container_ = opt_container || null;

  if (this.container_) {
    var rateOfChangeToggle = this.container_.find('.show-rate-of-change');
    rateOfChangeToggle.change(function(event) {
      this.showRateOfChange_ = $(event.target).is(':checked');
      this.callListeners_();
    }.bind(this));

    this.container_.find(historian.constants.Elements.LEVEL_SELECT)
        .change(function(event) {
          var selected = /** @type {string} */ ($(event.target).val() || '');
          this.setLevel(selected);
          // Disable rate of change checkbox if no level metric is selected.
          rateOfChangeToggle.prop('disabled', !selected);
        }.bind(this));
    this.addSeriesSelector_();
  }
};


/**
 * Function that is called on level data change.
 * @typedef {function()}
 */
historian.LevelData.Listener;


/**
 * Returns the rate of change data for the currently displayed level metric.
 * If the rate of change data doesn't exist, it is generated and cached.
 * @return {!Array<!Array<!historian.Entry>>}
 * @private
 */
historian.LevelData.prototype.getRateOfChangeData_ = function() {
  var data = [];
  this.levelMetrics_.forEach(function(metric) {
    if (!(metric in this.rateOfChangeData_)) {
      if (historian.metrics.isScreenOffDischargeMetric(metric)) {
        this.rateOfChangeData_[metric] = this.getOriginalData(metric);
      } else {
        this.rateOfChangeData_[metric] =
            historian.utils.generateDerivative(this.getOriginalData(metric));
      }
    }
    data.push(this.rateOfChangeData_[metric]);
  }, this);
  return data;
};


/**
 * Sets the level metric chosen and notifies registered listeners.
 * If the level metric is already set, no listeners are notified.
 * @param {string} name The name of the level metric to set as chosen.
 */
historian.LevelData.prototype.setLevel = function(name) {
  if (this.levelMetric_ != name) {
    var prevLevelMetric = this.levelMetric_;
    this.levelMetric_ = name;
    if (name in this.lineGroups_) {
      this.levelMetrics_ = this.lineGroups_[name].names;
    } else {
      this.levelMetrics_ = [name];
    }
    if (this.container_) {
      var rateOfChangeToggle = this.container_.find('.show-rate-of-change');
      if (!historian.metrics.isScreenOffDischargeMetric(prevLevelMetric)) {
        this.prevRateOfChangeState_ = rateOfChangeToggle.is(':checked');
      }
      if (historian.metrics.isScreenOffDischargeMetric(this.levelMetric_)) {
        rateOfChangeToggle.prop('checked', true).change();
        rateOfChangeToggle.closest('.settings-section').hide();
      } else {
        rateOfChangeToggle.closest('.settings-section').show();
        rateOfChangeToggle.prop('checked', this.prevRateOfChangeState_)
            .change();
      }
    }
    this.callListeners_();
  }
};


/**
 * Creates the series selector for selecting a level metric.
 * @private
 */
historian.LevelData.prototype.addSeriesSelector_ = function() {
  var options = [];
  for (let group in this.groups_) {
    if (historian.metrics.isSelectableAsLevel(this.groups_[group])) {
      options.push(group);
    }
  }
  for (let group in this.lineGroups_) {
    options.push(group);
  }
  options.sort();
  var select = this.container_.find(historian.constants.Elements.LEVEL_SELECT);
  historian.utils.setupDropdown(select, options, 'Choose line');
  if (this.levelMetric_) {
    // Set the dropdown to display the default level metric.
    select.val(this.levelMetric_).trigger('change');
  }
};


/**
 * Returns the domain of the shown metrics, null if there is no visible data.
 * @return {?{min: number, max: number}} xExtent Min start time and max end
 *     time of the shown metrics.
 */
historian.LevelData.prototype.getVisibleDomain = function() {
  var entries = this.getData();  // Empty if no level metric selected.
  if (entries.length == 0) {
    return null;
  }
  var flattened = [];
  entries.forEach(function(e) {
    flattened = flattened.concat(e);
  });
  var startExtent = d3.extent(flattened, function(entry) {
    return entry.startTime;
  });
  var endExtent = d3.extent(flattened, function(entry) {
    return entry.endTime;
  });
  return {min: startExtent[0], max: endExtent[1]};
};


/**
 * Returns the data for the given level metric.
 * @param {string} metric The metric to get the data for.
 * @return {!Array<!historian.Entry>}
 */
historian.LevelData.prototype.getOriginalData = function(metric) {
  var group = this.getGroupData(metric);
  // It's possible the selected level metric does not have corresponding data.
  // e.g. by default the battery level metric is displayed for the battery
  // history view regardless of whether it has any data.
  if (!group) {
    return [];
  }
  // Since we currently only support showing one series at once, we need to
  // special case any groups with more than one series that might be displayed
  // as a line.
  if (metric == historian.metrics.Csv.AM_PROC) {
    var idx = goog.array.findIndex(group.series, function(series) {
      return series.name == historian.metrics.Csv.AM_PROC_START;
    });
    return idx == -1 ? [] : group.series[idx].values;
  }
  return group.series[0].values;
};


/**
 * Returns the data for the currently set level metrics, or the rate of
 * change data if the show rate of change checkbox is currently checked.
 * @return {!Array<!Array<!historian.Entry>>}
 */
historian.LevelData.prototype.getData = function() {
  if (this.showRateOfChange_) {
    return this.getRateOfChangeData_();
  }
  var data = [];
  this.levelMetrics_.forEach(function(metric) {
    var group = this.getOriginalData(metric);
    if (group.length > 0) {
      data.push(group);
    }
  },this);
  return data;
};


/**
 * Returns the data for the given group name.
 * @param {string} groupName Name of the group.
 * @return {?historian.SeriesGroup} The entries
 *     for the group, or an empty array if no such data exists.
 */
historian.LevelData.prototype.getGroupData = function(groupName) {
  if (!(groupName in this.groups_)) {
    return null;
  }
  goog.asserts.assert(this.groups_[groupName].series.length > 0,
      'all groups should have at least 1 series');
  return this.groups_[groupName];
};


/**
 * Returns the config for the currently set level metric.
 * @return {!historian.LevelConfiguration}
 */
historian.LevelData.prototype.getConfig = function() {
  var name = this.levelMetric_;
  if (this.showRateOfChange_) {
    name += historian.metrics.ROC_SUFFIX;
  }
  return this.levelConfigs_.getConfig(
      name, this.showRateOfChange_, this.getData());
};


/**
 * Registers a listener for chosen level metric changed events.
 * @param {!historian.LevelData.Listener} listener The listener to call.
 */
historian.LevelData.prototype.registerListener = function(listener) {
  this.listeners_.push(listener);
};


/**
 * Calls registered listeners sequentially.
 * @private
 */
historian.LevelData.prototype.callListeners_ = function() {
  this.listeners_.forEach(function(listener) {
    listener();
  });
};
