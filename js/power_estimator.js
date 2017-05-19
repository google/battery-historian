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

goog.module('historian.power.Estimator');
goog.module.declareLegacyNamespace();

var Event = goog.require('historian.power.Event');
var array = goog.require('goog.array');
var asserts = goog.require('goog.asserts');
var tables = goog.require('historian.tables');
var time = goog.require('historian.time');
var utils = goog.require('historian.utils');


/**
 * Upper bound for device standby mA current.
 * @const {number}
 */
var MAX_STANDBY_CURRENT = 50;


/**
 * Returns the first wakeup reason that doesn't start with 'Abort'.
 * Each running event can have multiple wakeup reasons.
 * @param {!Array<!historian.Entry>} wakeupReasons
 * @return {string}
 */
var getFirstNonAbort = function(wakeupReasons) {
  var element = wakeupReasons.find(function(element) {
    return !element.value.startsWith('Abort');
  });
  return element ? asserts.assertString(element.value) :
      'No non abort events found';
};


/**
 * Returns whether the two events intersect. Does not include intersection of a
 * single point.
 * @param {!historian.Entry|!historian.AggregatedEntry} e1
 * @param {!historian.Entry|!historian.AggregatedEntry} e2
 * @return {boolean} True if they intersect.
 */
var hasIntersection = function(e1, e2) {
  return (Math.max(e1.startTime, e2.startTime) <
      Math.min(e1.endTime, e2.endTime));
};


/**
 * Returns the average current (mA) formatted to 3 decimal places, calculated
 * from the given total energy (mAh) and time.
 * @param {number} mah Total mAh consumed for the given time period.
 * @param {number} ms Duration in milliseconds.
 * @return {string} The formatted current.
*/
var avgCurrent = function(mah, ms) {
  var avg = (ms == 0) ? 0 : mah * time.MSECS_IN_HOUR / ms;
  return avg.toFixed(3) + ' mA';
};


/**
 * Estimates the power consumed by each wakeup reason.
 *
 * Each running event has one or more wakeup reasons. To get the total power
 * consumed by a wakeup reason, the power consumed by each running event
 * corresponding to the wakeup reason are added together.
 * The power for a single running event is calculated by finding overlapping
 * power monitor events.
 */
var Estimator = goog.defineClass(null, {
  /**
   * @param {!Array<!historian.AggregatedEntry>} runningEvents Running events
   *     which are non overlapping and sorted by startTime in ascending order.
   * @param {!Array<!historian.Entry>} powerMonitorEvents Power monitor events
   *     which are non overlapping and sorted by startTime in ascending order.
   * @param {?jQuery} container The panel body container for the power
   *     statistics.
   * @constructor
   * @final
   */
  constructor: function(runningEvents, powerMonitorEvents, container) {

    /**
     * Running events that lie in the range of the power monitor events.
     * @private {!Array<!historian.AggregatedEntry>}
     */
    this.runningEvents_ = powerMonitorEvents.length == 0 ?
        [] : utils.inTimeRange(
            powerMonitorEvents[0].startTime,
            powerMonitorEvents[powerMonitorEvents.length - 1].endTime,
            runningEvents);

    /** @private {!Array<!historian.Entry>} */
    this.powerMonitorEvents_ = powerMonitorEvents;

    /**
     * Map from wakeup reason to an array of power estimator events, sorted
     * by start time.
     * Each power estimator event contains the original running event and
     * power monitor events associated with the running event.
     * Populated in matchPowerMonitorEvents.
     * @private {!Object<!Array<!Event>>}
     */
    this.wakeupReasonToEventsMap_ = {};

    this.matchPowerMonitorEvents_();
    if (container) {
      this.renderStats_(container);
    }
  },

  /**
   * Returns the wakeup reasons present in the mapping, along with power use for
   * each wakeup. Result is sorted in descending order by power use, then in
   * ascending order by wakeup reason name.
   * @return {!Array<{name: string, power: number}>}
   */
  getWakeupReasons: function() {
    var wakeupReasons = Object.keys(this.wakeupReasonToEventsMap_);
    return (wakeupReasons
        .map(function(wakeupReason) {
          return {
            name: wakeupReason,
            power: this.getWakeupPower_(wakeupReason)
          };
        }, this)
        .sort(function(a, b) {
          return (b.power - a.power || a.name.localeCompare(b.name));
        })
    );
  },

  /**
   * Returns the power event corresponding to the running event.
   * @param {!historian.Entry|!historian.AggregatedEntry} runningEvent
   * @return {?historian.power.Event}
   */
  getRunningPowerEvent: function(runningEvent) {
    if (!runningEvent.services) {
      return null;
    }
    var wakeupReason = getFirstNonAbort(runningEvent.services);
    var events = this.getEvents(wakeupReason);
    // Running events have unique start times, and the power events are sorted
    // by start time.
    var i = array.binarySearch(events, runningEvent.startTime, function(a, b) {
      return a - b.getRunningStartTime();
    });
    return i >= 0 ? events[i] : null;
  },

  /**
   * Returns the power events associated with the wakeup reason in the
   * mapping, sorted by start time.
   * @param {string} wakeupReason
   * @return {!Array<!Event>} Power events. Empty array if wakeup reason does
   *     not exist in mapping.
   */
  getEvents: function(wakeupReason) {
    return this.wakeupReasonToEventsMap_[wakeupReason] || [];
  },

  /**
   * Returns the total power consumed by running events belonging to the given
   * wakeup reason.
   * @param {string} wakeupReason The wakeup reason to get the total power for.
   * @return {number} Total power in mAh. Zero if wakeup reason is not present
   *     in mapping.
   * @private
   */
  getWakeupPower_: function(wakeupReason) {
    return this.getEventsPower(this.getEvents(wakeupReason));
  },

  /**
   * Returns the total power consumed by the given power events.
   * @param {!Array<!Event>} events
   * @return {number} Total power in mAh.
   */
  getEventsPower: function(events) {
    return events.reduce(
        function(total, powerEvent, i) {
          // Get the time range of the previous power event.
          var prevTimeRange = i == 0 ? null : events[i - 1].getTimeRange();
          var prevEndTime = prevTimeRange ? prevTimeRange.end : null;
          return total + powerEvent.getPower(prevEndTime);
        }, 0);
  },

  /**
   * Populates the mapping with power events. Each power stat event contains
   * a running event. Power monitor events which overlap in the same time period
   * as the running event are added to the corresponding power stat event.
   * @private
   */
  matchPowerMonitorEvents_: function() {
    if (this.powerMonitorEvents_.length == 0) {
      return;
    }

    var powerMonitorIdx = 0;
    this.runningEvents_.forEach(function(running, runningIdx) {
      // Each running event can have multiple wakeup reasons, only consider the
      // non abort wakeups.
      var entry = new Event(running);
      var wakeupReason = getFirstNonAbort(running.services);
      var powerEvents = this.wakeupReasonToEventsMap_[wakeupReason] =
          this.wakeupReasonToEventsMap_[wakeupReason] || [];
      powerEvents.push(entry);

      // Find the next power monitor event which intersects with the running
      // event.
      var intersects = false;

      // We want to count the rising edge before the start of a running event.
      // Track the start index of the last seen increasing edge that started
      // below the base threshold.
      var risingStartIdx = powerMonitorIdx;
      while (powerMonitorIdx < this.powerMonitorEvents_.length) {
        if (powerMonitorIdx > 0) {
          // If the value of the current power monitor reading is less than the
          // previous and is smaller than the base threshold, this signifies
          // the edge is decreasing. Overwrite the saved index with the current
          // index, as it is potentially the start index of the next rising
          // edge.
          var curValue = this.powerMonitorEvents_[powerMonitorIdx].value;
          var prevValue = this.powerMonitorEvents_[powerMonitorIdx - 1].value;

          if ((curValue < MAX_STANDBY_CURRENT) && (curValue < prevValue)) {
            risingStartIdx = powerMonitorIdx;
          }
        }
        intersects = hasIntersection(running,
            this.powerMonitorEvents_[powerMonitorIdx]);
        // Since the events are sorted in ascending order, there is no point
        // in searching further if the current power monitor event starts after
        // the current running event.
        if (intersects ||
            this.powerMonitorEvents_[powerMonitorIdx]
                .startTime > running.endTime) {
          break;
        }
        powerMonitorIdx++;
      }
      // If no intersecting power monitor event was found, move on to the next
      // running event.
      if (!intersects) {
        return;
      }

      // Add the power monitor events for the rising edge before the running
      // event.
      while (risingStartIdx < powerMonitorIdx) {
        entry.addPowerMonitorEvent(this.powerMonitorEvents_[risingStartIdx]);
        risingStartIdx++;
      }

      // Add all overlapping power monitor events. The current event at index
      // powerMonitorIdx is guaranteed to intersect at this point.
      do {
        entry.addPowerMonitorEvent(this.powerMonitorEvents_[powerMonitorIdx]);
        powerMonitorIdx++;
      } while ((powerMonitorIdx < this.powerMonitorEvents_.length) &&
          hasIntersection(running, this.powerMonitorEvents_[powerMonitorIdx]));

      var nextRunning = (runningIdx + 1 < this.runningEvents_.length) ?
          this.runningEvents_[runningIdx + 1] : null;

      // We want to count the falling edge after the end of a running event.
      // Add all power monitor events that are larger than the base threshold.
      while ((powerMonitorIdx < this.powerMonitorEvents_.length) &&
          (this.powerMonitorEvents_[powerMonitorIdx].value > MAX_STANDBY_CURRENT)) {
        // Stop if an intersection is found with the next wakeup event.
        var curPowerMonitor = this.powerMonitorEvents_[powerMonitorIdx];
        if (nextRunning && hasIntersection(nextRunning, curPowerMonitor)) {
          break;
        }
        entry.addPowerMonitorEvent(curPowerMonitor);
        powerMonitorIdx++;
      }

      // Add all power monitor events until the end of the falling edge.
      // At least one event intersected, so powerMonitorIdx is guaranteed
      // to be at least one.
      while ((powerMonitorIdx < this.powerMonitorEvents_.length) &&
          (this.powerMonitorEvents_[powerMonitorIdx].value <
           this.powerMonitorEvents_[powerMonitorIdx - 1].value)) {
        // Stop if an intersection is found with the next wakeup event.
        var curPowerMonitor = this.powerMonitorEvents_[powerMonitorIdx];
        if (nextRunning && hasIntersection(nextRunning, curPowerMonitor)) {
          break;
        }
        entry.addPowerMonitorEvent(curPowerMonitor);
        powerMonitorIdx++;
      }

      // Multiple running events can overlap with the same power monitor event,
      // so backtrack one index here.
      powerMonitorIdx--;
    }, this);
  },

  /**
   * Calculates the statistics for a metric (such as duration) for all the power
   * events associated with the given wakeup reason.
   *
   * @param {string} wakeupReason The wakeup reason to calculate the stats for.
   * @param {function(!Event): number} accessor Returns the value for the
   *     requested metric of the power event.
   * @return {!Estimator.WakeupPowerStat}
   */
  calculateWakeupStats: function(wakeupReason, accessor) {
    // Calculate the value of the requested metric for each power event.
    var vals = this.getEvents(wakeupReason).map(accessor)
        .sort(function(a, b) {
          return a - b;
        });
    var total = vals.reduce(function(curTotal, b) {
      return curTotal + b;
    }, 0);

    // If vals is empty, add a single zero entry so we don't have to deal with
    // empty array checks in the calculations.
    var nonEmptyVals = vals.length ? vals : [0];
    return {
      wakeup: wakeupReason,
      avg: total / nonEmptyVals.length,
      median: nonEmptyVals[Math.floor(nonEmptyVals.length / 2)],
      min: nonEmptyVals[0],
      max: nonEmptyVals[nonEmptyVals.length - 1],
      total: total
    };
  },

  /**
   * Generates tables for duration, current and energy per wakeup event type.
   * @return {!Object<!Estimator.TableMetric, !Estimator.WakeupStatsTable>}
   *     Map from table metric type to per wakeup stats table.
   */
  generateWakeupTables: function() {
    var tableGenerators = [
      // Generator for the duration table.
      {
        accessor: function(event) {
          return event.getPowerDuration();
        },
        formatter: function(number) {
          return time.formatDuration(number);
        },
        key: Estimator.TableMetric.DURATION
      },
      // Generator for the current table.
      {
        accessor: function(event) {
          return event.getAverageCurrent();
        },
        formatter: function(number) {
          return number.toFixed(3);
        },
        key: Estimator.TableMetric.AVERAGE_CURRENT
      },
      // Generator for the energy table.
      {
        accessor: function(event) {
          return event.getPower();
        },
        formatter: function(number) {
          return number.toFixed(3);
        },
        key: Estimator.TableMetric.ENERGY
      }
    ];

    var tables = {};
    var wakeupReasons = Object.keys(this.wakeupReasonToEventsMap_);
    tableGenerators.forEach(function(generator) {
      // Generate stats for each wakeup reason for the current table type.
      var tableStats = wakeupReasons.map(function(wakeupReason) {
        return this.calculateWakeupStats(wakeupReason, generator.accessor);
      }, this);

      // Sort the table's stats by the average property.
      var sorted = tableStats.sort(function(a, b) {
        return b.avg - a.avg;
      });
      // Convert each stat into table row format.
      tables[generator.key] = sorted.map(function(stat) {
        var row = [
          stat.wakeup,
          generator.formatter(stat.avg),
          generator.formatter(stat.median),
          generator.formatter(stat.min),
          generator.formatter(stat.max)
        ];
        // Total does not make sense for average current.
        if (generator.key != Estimator.TableMetric.AVERAGE_CURRENT) {
          row.push(generator.formatter(stat.total));
        }
        return row;
      });
    }, this);
    return tables;
  },

  /**
   * Calculates wakeup and suspend statistics from all the stored power events.
   * @return {!Estimator.FormattedSummaryStats}
   */
  generateSummaryStats: function() {
    var wakeupEnergy = 0;
    var wakeupTime = 0;
    for (var wakeupReason in this.wakeupReasonToEventsMap_) {
      wakeupEnergy += this.getWakeupPower_(wakeupReason);
      wakeupTime += this.getEvents(wakeupReason).reduce(function(total, event) {
        return total + event.getPowerDuration();
      }, 0);
    }

    var totalEnergy = utils.calculateTotalCharge(this.powerMonitorEvents_);
    var totalTime = (this.powerMonitorEvents_.length == 0) ? 0 :
        this.powerMonitorEvents_[this.powerMonitorEvents_.length - 1].endTime -
        this.powerMonitorEvents_[0].startTime;

    var suspendTime = totalTime - wakeupTime;
    var suspendEnergy = totalEnergy - wakeupEnergy;

    var stats = {
      suspendTime: time.formatDuration(suspendTime),
      wakeupTime: time.formatDuration(wakeupTime),
      suspendEnergy: suspendEnergy.toFixed(3) + ' mAh',
      wakeupEnergy: wakeupEnergy.toFixed(3) + ' mAh',
      avgWakeupCurrent: avgCurrent(wakeupEnergy, wakeupTime),
      avgSuspendCurrent: avgCurrent(suspendEnergy, suspendTime)
    };
    return stats;
  },

  /**
   * Renders wakeup statistics generated from running and power monitor events.
   * @param {!jQuery} container Container to render stats in.
   */
  renderStats_: function(container) {
    // Render wakeup and suspend summary stats table.
    var summaryDiv = container.find('#power-summary-stats');
    var stats = this.generateSummaryStats();
    var summaryHeadRow = ['Metric', 'Wakeup', 'Suspend'];
    var summaryRows = [
      ['Time', stats.wakeupTime, stats.suspendTime],
      ['Energy', stats.wakeupEnergy, stats.suspendEnergy],
      ['Average current', stats.avgWakeupCurrent, stats.avgSuspendCurrent]
    ];
    var summaryTable = tables.createTable(summaryHeadRow, summaryRows);
    summaryDiv.append(summaryTable);
    tables.activateDataTable(summaryTable);
    tables.activateTableCopy(summaryTable);

    // Render per wakeup duration, current and energy tables.
    var tableDiv = container.find('#power-stats-tables');

    var wakeupTables = this.generateWakeupTables();
    for (var name in wakeupTables) {
      $('<div></div>')
          .attr('class', 'summary-title-inline')
          .appendTo(tableDiv)
          .append($('<span></span>'))
          .html(name);

      var headRow = ['Wakeup reason', 'Avg', 'Median', 'Min', 'Max'];
      if (name != Estimator.TableMetric.AVERAGE_CURRENT) {
        headRow.push('Total');
      }
      var table = tables.createTable(headRow, wakeupTables[name]);
      tableDiv.append(table);
      tables.activateDataTable(table);
      tables.activateTableCopy(table);
    }
  }
});


/**
 * Statistics for a given metric, such as duration or current, for all power
 * events associated with the wakeup reason.
 *
 * @typedef {{
 *   wakeup: string,
 *   avg: number,
 *   median: number,
 *   min: number,
 *   max: number,
 *   total: number
 * }}
 */
Estimator.WakeupPowerStat;


/**
 * Metrics to generate tables for.
 * @enum {string}
 */
Estimator.TableMetric = {
  DURATION: 'Duration',
  AVERAGE_CURRENT: 'Current (mA)',
  ENERGY: 'Energy (mAh)'
};


/**
 * Table with rows containing wakeup reason, avg, median, min and max.
 * @typedef {!Array<!historian.TableRow>}
 */
Estimator.WakeupStatsTable;


/**
 * Overall wakeup and suspend statistics.
 *
 * suspendTime:       total duration in suspend with power monitor events.
 * wakeupTime:        total duration for wakeup power events.
 * suspendEnergy:     total energy (mAh) consumed while in suspend.
 * wakeupEnergy:      total energy (mAh) consumed by all wakeup power events.
 * avgWakeupCurrent:  average current (mA) during all wakeup power events.
 * avgSuspendCurrent: average current (mA) when not during a wakeup event.
 *
 * @typedef {{
 *   suspendTime: string,
 *   wakeupTime: string,
 *   suspendEnergy: string,
 *   wakeupEnergy: string,
 *   avgWakeupCurrent: string,
 *   avgSuspendCurrent: string
 * }}
 */
Estimator.FormattedSummaryStats;

exports = Estimator;
