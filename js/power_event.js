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
 * Container for a running event and the associated powermonitor events.
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
     * The powermonitor events which overlap with the running event.
     * Each powermonitor event has a power value.
     * @private {!Array<!historian.Entry>}
     */
    this.powermonitorEvents_ = [];
  },

  /** @return {number} */
  getRunningStartTime: function() {
    return this.runningEvent_.startTime;
  },

  /** @return {!Array<!historian.Entry>} */
  getPowermonitorEvents: function() {
    return this.powermonitorEvents_;
  },

  /** @param {!historian.Entry} event */
  addPowermonitorEvent: function(event) {
    this.powermonitorEvents_.push(event);
  },

  /** @return {number} */
  getPowerDuration: function() {
    var count = this.powermonitorEvents_.length;
    return (count == 0) ? 0 : this.powermonitorEvents_[count - 1].endTime -
        this.powermonitorEvents_[0].startTime;
  },

  /** @return {number} */
  getAverageCurrent: function() {
    return (this.powermonitorEvents_.length == 0) ? 0 :
        this.powermonitorEvents_.reduce(function(total, event) {
          return total + event.value;
        }, 0) / this.powermonitorEvents_.length;
  },

  /**
   * Returns the total power consumed by this event.
   * @param {?number} lastEndTimeMs End time of last powermonitor event for the
   *     preceeding wakeup event.
   * @return {number} Total power in mAh.
   */
  getPower: function(lastEndTimeMs) {
    if (this.powermonitorEvents_.length == 0) {
      return 0;
    }
    // It's possible multiple running events share the same powermonitor event.
    // To avoid double counting for a wakeup type, check whether the first
    // powermonitor event is the same event of another wakeup event.
    var events = this.powermonitorEvents_;
    if (lastEndTimeMs == this.powermonitorEvents_[0].endTime) {
      events = this.powermonitorEvents_.slice(1);
    }
    return utils.calculateTotalCharge(events);
  },

  /**
   * Returns the time range over which this event occurs, which is the time
   * range of the powermonitor events.
   * @return {?{start: number, end: number}} The start time of the first
   *     powermonitor event, and end time of the last powermonitor event.
   *     Null if there are no events.
   */
  getTimeRange: function() {
    var numEvents = this.powermonitorEvents_.length;
    if (numEvents == 0) {
      return null;
    }
    return {
      start: this.powermonitorEvents_[0].startTime,
      end: this.powermonitorEvents_[numEvents - 1].endTime
    };
  }
});
