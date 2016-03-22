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

goog.require('goog.asserts');


/**
 * Function that is called on level data change.
 * @typedef {function()}
 */
historian.LevelData.Listener;



/**
 * Holds the currently selected level metric, as well the data and configs for
 * all metrics. Handles the selecting of new metrics and notifying listeners of
 * the change.
 * @param {!Object<!historian.SeriesGroup>} groups All the series groups.
 * @param {string} defaultLevelMetric The level metric to display as default.
 * @param {!historian.LevelConfigs} levelConfigs The level configs.
 * @constructor
 * @struct
 */
historian.LevelData = function(groups, defaultLevelMetric, levelConfigs) {
  /** @private {!Array<!historian.LevelData.Listener>} */
  this.listeners_ = [];

  /** @private {!Object<!historian.SeriesGroup>} */
  this.groups_ = groups;

  /** @private {string} */
  this.levelMetric_ = defaultLevelMetric;

  /** @private {!historian.LevelConfigs} */
  this.levelConfigs_ = levelConfigs;
};


/**
 * Sets the level metric chosen and notifies registered listeners.
 * If the level metric is already set, no listeners are notified.
 * @param {string} name The name of the level metric to set as chosen.
 */
historian.LevelData.prototype.setLevel = function(name) {
  if (this.levelMetric_ != name) {
    this.levelMetric_ = name;
    this.callListeners_();
  }
};


/**
 * Returns the data for the currently set level metric.
 * @return {!Array<!historian.Entry>}
 */
historian.LevelData.prototype.getData = function() {
  if (!(this.levelMetric_ in this.groups_)) {
    // It's possible the selected level metric does not have corresponding data.
    // e.g. by default the battery level metric is displayed regardless of
    // whether it has any data.
    return [];
  }
  goog.asserts.assert(this.groups_[this.levelMetric_].series.length > 0,
      'all groups should have at least 1 series');
  return this.groups_[this.levelMetric_].series[0].values;
};


/**
 * Returns the config for the currently set level metric.
 * @return {!historian.LevelConfiguration}
 */
historian.LevelData.prototype.getConfig = function() {
  return this.levelConfigs_.getConfig(this.levelMetric_, this.getData());
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
