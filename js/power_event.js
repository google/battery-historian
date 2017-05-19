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


goog.module('historian.power.Event');

var utils = goog.require('historian.utils');


/**
 * Container for a running event and the associated power monitor events.
 */
exports = goog.defineClass(null, {
  /**
   * @param {!historian.AggregatedEntry} runningEvent
   * @constructor
   * @final
   */
  constructor: function(runningEvent) {
    /** @private {!historian.AggregatedEntry} */
    this.runningEvent_ = runningEvent;

    /**
     * The power monitor events which overlap with the running event.
     * Each power monitor event has a power value.
     * @private {!Array<!historian.Entry>}
     */
    this.powerMonitorEvents_ = [];
  },

  /** @return {number} */
  getRunningStartTime: function() {
    return this.runningEvent_.startTime;
  },

  /** @return {!Array<!historian.Entry>} */
  getPowerMonitorEvents: function() {
    return this.powerMonitorEvents_;
  },

  /** @param {!historian.Entry} event */
  addPowerMonitorEvent: function(event) {
    this.powerMonitorEvents_.push(event);
  },

  /** @return {number} */
  getPowerDuration: function() {
    var count = this.powerMonitorEvents_.length;
    return (count == 0) ? 0 : this.powerMonitorEvents_[count - 1].endTime -
        this.powerMonitorEvents_[0].startTime;
  },

  /** @return {number} */
  getAverageCurrent: function() {
    return (this.powerMonitorEvents_.length == 0) ? 0 :
        this.powerMonitorEvents_.reduce(function(total, event) {
          return total + event.value;
        }, 0) / this.powerMonitorEvents_.length;
  },

  /**
   * Returns the total power consumed by this event.
   * @param {?number} lastEndTimeMs End time of last power monitor event for the
   *     preceeding wakeup event.
   * @return {number} Total power in mAh.
   */
  getPower: function(lastEndTimeMs) {
    if (this.powerMonitorEvents_.length == 0) {
      return 0;
    }
    // It's possible multiple running events share the same power monitor event.
    // To avoid double counting for a wakeup type, check whether the first
    // power monitor event is the same event of another wakeup event.
    var events = this.powerMonitorEvents_;
    if (lastEndTimeMs == this.powerMonitorEvents_[0].endTime) {
      events = this.powerMonitorEvents_.slice(1);
    }
    return utils.calculateTotalCharge(events);
  },

  /**
   * Returns the time range over which this event occurs, which is the time
   * range of the power monitor events.
   * @return {?{start: number, end: number}} The start time of the first
   *     power monitor event, and end time of the last power monitor event.
   *     Null if there are no events.
   */
  getTimeRange: function() {
    var numEvents = this.powerMonitorEvents_.length;
    if (numEvents == 0) {
      return null;
    }
    return {
      start: this.powerMonitorEvents_[0].startTime,
      end: this.powerMonitorEvents_[numEvents - 1].endTime
    };
  }
});
