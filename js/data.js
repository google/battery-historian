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
 * @fileoverview data.js has data specifications for historian and methods
 * for reading and aggregating data.
 *
 * Both historian v2 get data from the historian.data processed here.
 * CSV parsing happens exactly once upon page load, and will not be re-parsed
 * during tab switches.
 */

goog.provide('historian.AMProcValue');
goog.provide('historian.AMValue');
goog.provide('historian.ANRValue');
goog.provide('historian.AggregatedEntry');
goog.provide('historian.AggregatedValue');
goog.provide('historian.ClusteredSeriesData');
goog.provide('historian.Entry');
goog.provide('historian.HistorianV2Data');
goog.provide('historian.KernelUptimeValue');
goog.provide('historian.RunningValue');
goog.provide('historian.SeriesData');
goog.provide('historian.SeriesGroup');
goog.provide('historian.TimeToDelta');
goog.provide('historian.Value');
goog.provide('historian.data');
goog.provide('historian.data.ClusterEntry');
goog.provide('historian.data.ServiceMapper');

goog.require('goog.asserts');
goog.require('historian.LevelConfigs');
goog.require('historian.LevelSummaryData');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.time');


/**
 * A single data point for a series.
 *
 * startTime: The start time in ms for the data point.
 * endTime: The end time in ms for the data point.
 * value: The value of the data point, either
 *     a number (for series of type int),
 *     or a string (for bool, string or service series).
 * @typedef {{
 *   startTime: number,
 *   endTime: number,
 *   value: !historian.Value
 * }}
 */
historian.Entry;


/**
 * A single value for an aggregated entry.
 * Aggregated entries contain values from different csv entries,
 * which overlap the same time period.
 *
 * Each aggregated value has an extra field for the id, which will allow
 * detecting if it was from the same original entry during clustering.
 *
 * This id is a unique number for each entry in the series, generated
 * before aggregation.
 *
 * @typedef {{
 *   id: number,
 *   value: (string | number)
 * }}
 */
historian.AggregatedValue;


/**
 * A single value for a running entry.
 * Running entries can hold multiple wakeup reasons, and each wakeup reason
 * is represented by one of these values.
 * The start time is the start of the CPU_RUNNING period corresponding to the
 * wakeup reason, and the end time is the arrival time of the wakeup reason.
 *
 * @typedef {{
 *   startTime: number,
 *   endTime: number,
 *   value: string
 * }}
 */
historian.RunningValue;


/**
 * A single value for an ANR entry.
 *
 * @typedef {{
 *   pid: number,
 *   packageName: string,
 *   reason: string,
 *   flag: string,
 *   uid: number
 * }}
 */
historian.ANRValue;


/**
 * A single value for an Activity Manager Proc entry, which is either in the
 * AM_PROC_START or AM_PROC_DIED series.
 *
 * Since each start or died event is instant, the entries representing these
 * will have the same start or end time. The start and end time stored here
 * represent the times of the corresponding start and died events for that
 * entry.
 *
 * @typedef {{
 *   startTime: number,
 *   endTime: number,
 *   pid: number,
 *   process: string,
 *   uid: number,
 *   component: string
 * }}
 */
historian.AMProcValue;


/**
 * Activity manager value.
 *
 * @typedef {!historian.ANRValue|!historian.AMProcValue}
 */
historian.AMValue;


/**
 * A cluster entry can hold several values. These are all the possible types
 * those values can be.
 * @typedef {string|number|!historian.KernelUptimeValue|!historian.AMValue}
 */
historian.Value;


/**
 * A single data point created from aggregating the values
 * from a number of data points.
 *
 * value: The count of the number of services.
 * services: The list of values from the original data points.
 *
 * @typedef {{
 *   startTime: number,
 *   endTime: number,
 *   value: number,
 *   services: !Array<!historian.AggregatedValue|!historian.RunningValue>
 * }}
 */
historian.AggregatedEntry;


/**
 * The value for a running entry.
 * Each entry for the running metric requires two values - the wakeup reason,
 * and whether it occurred during a userspace wakelock.
 * @typedef {{
 *   wakeReason: string,
 *   wakelockCategory: number
 * }}
 */
historian.KernelUptimeValue;


/**
 * A group of related series which will be rendered on the same row,
 * but are clustered separately and can have different types or color
 * functions.
 *
 * name: The name of the group which will be displayed in the metric labels.
 * index: The row position to display the series group in.
 * series: The series that are in the group. Can contain 0 or more series.
 *
 * @typedef {{
 *   name: string,
 *   index: ?number,
 *   series: !Array<!historian.SeriesData>
 * }}
 */
historian.SeriesGroup;


/**
 * All the information required to render a series.
 *
 * name: The name of the series.
 * type: The type of data for the series (int, bool, string or service).
 * values: The data points for the series.
 * color: A function that maps a value to a color.
 * cluster: Whether clustering should be applied to the metric.
 *
 * @typedef {{
 *   name: string,
 *   type: string,
 *   values: !Array<(!historian.Entry|!historian.AggregatedEntry)>,
 *   color: (function(string): string | undefined),
 *   cluster: boolean
 * }}
 */
historian.SeriesData;


/**
 * The clustered data for a series.
 *
 * @typedef {{
 *   name: string,
 *   type: string,
 *   values: !Array<(!historian.data.ClusterEntry)>,
 *   index: number,
 *   color: (function(string): string | undefined),
 *   cluster: boolean
 * }}
 */
historian.ClusteredSeriesData;


/**
 * Maps from timestamp to a human readable format.
 * @typedef {!Object<string>}
 */
historian.TimeToDelta;


/**
 * The object for the level line, bar data, graph extent and service mappings.
 * This data object is used by the historian v2 plot.
 *
 * @typedef {{
 *   nameToBarGroup: !Object<!historian.SeriesGroup>,
 *   nameToLevelGroup: !Object<!historian.SeriesGroup>,
 *   extent: !Array<number>,
 *   serviceMapper: !historian.data.ServiceMapper,
 *   configs: !historian.LevelConfigs,
 *   defaultLevelMetric: string,
 *   timeToDelta: !historian.TimeToDelta,
 *   location: string
 * }}
 */
historian.HistorianV2Data;


/**
 * Processes the level summary csv and stores the LevelSummaryData.
 * @param {string} csv Csv input to be processed.
 * @return {!historian.LevelSummaryData}
 */
historian.data.processLevelSummaryData = function(csv) {
  return new historian.LevelSummaryData(csv);
};


/**
 * Parses the given csv data, and stores an object containing the battery level
 * and other series data, as well as aggregating the sync app and
 * wake lock metrics.
 * V2 data processing requires the levelMetric from the level configuration.
 *
 * @param {string} csvText Historian data in CSV format.
 * @param {number} deviceCapacity The capacity of the device in mAh.
 * @param {!historian.TimeToDelta} timeToDelta The map from timestamp to human
 *     readable format.
 * @param {string} location The location of the bug report.
 * @param {boolean} displayPowermonitor Whether to display powermonitor data.
 * @return {historian.HistorianV2Data}
 */
historian.data.processHistorianV2Data = function(csvText, deviceCapacity,
    timeToDelta, location, displayPowermonitor) {
  // The metric to overlay as the level line.
  var levelMetric = displayPowermonitor ? historian.metrics.Csv.POWERMONITOR :
      historian.metrics.Csv.BATTERY_LEVEL;

  historian.metrics.initMetrics();

  var data = {};
  data.defaultLevelMetric = levelMetric;
  data.serviceMapper = new historian.data.ServiceMapper();
  data.timeToDelta = timeToDelta;
  data.location = location;

  var csv = d3.csv.parse(csvText, function(d) {
    // Boolean entries will only have true as the value, which is not useful. So
    // use the opt field for bools in case there's extra data attached.
    var v = d.type == 'bool' ? d.opt : d.value;
    var entry = {
      metric: d.metric,
      type: d.type,
      startTime: parseInt(d.start_time, 10),
      endTime: parseInt(d.end_time, 10),
      value: v
    };
    if (d.type == 'service') {
      data.serviceMapper.addService(d.value, d.opt);
    }
    return entry;
  });


  // Find domain of the data.
  data.extent = /** @type {!Array<number>} */ (d3.extent(csv, function(d) {
    // Only consider data overlapping with the battery history time range.
    // Activity manager event log times do not necessarily overlap with
    // the battery history CSV events, so we do not consider these when
    // calculating the data extent to avoid skewing the graph domain.
    // Crash data comes from logcat, which may also span over a different time
    // period to the battery history.
    if (d.metric != historian.metrics.Csv.AM_PROC &&
        d.metric != historian.metrics.Csv.AM_LOW_MEMORY &&
        d.metric != historian.metrics.Csv.AM_ANR &&
        d.metric != historian.metrics.Csv.CRASHES) {
      return d.startTime;
    }
    // d3.extent ignores undefined return values.
  }));

  // Separate data into series - each data value is added as an entry into
  // the value array for that series.
  var allSeries = {};

  csv.forEach(function(d) {
    var name = d.metric;
    if (name == historian.metrics.Csv.AM_PROC) {
      var amValue = historian.data.splitAMProcValue_(
          d.value, parseInt(d.startTime, 10), parseInt(d.endTime, 10));
      // An AM_PROC_START and AM_PROC_DIED event is created for each AM_PROC
      // event. A 0 start or end time means no start or died event respectively.
      if (amValue.startTime != 0) {
        historian.data.addEntry(allSeries, historian.metrics.Csv.AM_PROC_START,
            d.type, amValue.startTime, amValue.startTime, amValue);
      }
      if (amValue.endTime != 0) {
        // AM_PROC_START and AM_PROC_END are instant events. Each pair of START
        // and END events share the same value, so we clone amValue here.
        // The only difference is the time the event occurred - the start
        // and end time for this entry are both set to the AM_PROC end time.
        var endValue =
            /** @type {!historian.AMProcValue} */ (jQuery.extend({}, amValue));
        historian.data.addEntry(allSeries, historian.metrics.Csv.AM_PROC_DIED,
            d.type, endValue.endTime, endValue.endTime, endValue);
      }
      return;
    }
    var value = d.value;
    if (d.metric == historian.metrics.Csv.AM_ANR) {
      value = historian.data.splitANR_(d.value);
    } else if (d.type == 'int') {
      value = parseInt(value, 10);
      goog.asserts.assert(!isNaN(value));
    } else if (d.type == historian.metrics.ERROR_TYPE) {
      name = historian.metrics.errorMetric(name);
    }
    historian.data.addEntry(allSeries, name, d.type,
        parseInt(d.startTime, 10), parseInt(d.endTime, 10), value);
  });

  if (historian.metrics.Csv.CPU_RUNNING in allSeries) {
    var running = allSeries[historian.metrics.Csv.CPU_RUNNING];
    // Each running entry can have multiple wakeup reasons as its value.
    // For each entry, convert the multiple value string into an array.
    running.values =
        historian.data.splitRunningValues_(running);

    var aggregatedWakelocks = historian.data.getWakelockData_(allSeries);

    var kernelUptimeValues =
        historian.data.categorizeRunning(running.values, aggregatedWakelocks);
    var kernelUptimeSeries = {
      name: historian.metrics.KERNEL_UPTIME,
      type: 'string',
      values: kernelUptimeValues,
      cluster: true
    };
    allSeries[historian.metrics.KERNEL_UPTIME] = kernelUptimeSeries;

  }

  /** @type {!Object<!historian.SeriesGroup>} */
  var barGroups = {};
  /** @type {!Object<!historian.SeriesGroup>} */
  var levelGroups = {};

  // Create a group per series. In future some groups will have multiple
  // series, such as for the activity manager metrics.
  for (var seriesName in allSeries) {
    var series = allSeries[seriesName];
    series.values.sort(compareEntries);
    if (seriesName in historian.metrics.metricsToAggregate) {
      series.values = historian.data.aggregateData_(series.values);
    }
    var groupName = seriesName;
    if (series.type == historian.metrics.ERROR_TYPE) {
      groupName = historian.metrics.baseMetric(seriesName);
    }
    switch (seriesName) {
      case historian.metrics.Csv.AM_PROC_START:
      case historian.metrics.Csv.AM_PROC_DIED:
        groupName = historian.metrics.Csv.AM_PROC;
        break;
      case historian.metrics.Csv.AM_LOW_MEMORY:
      case historian.metrics.Csv.AM_ANR:
        groupName = historian.metrics.Csv.AM_LOW_MEMORY_ANR;
        break;
    }
    if (!(groupName in barGroups)) {
      var seriesGroup = {
        name: groupName,
        series: [],
        index: null
      };
      barGroups[groupName] = seriesGroup;
      levelGroups[groupName] = seriesGroup;
    }
    barGroups[groupName].series.push(series);
  }
  if (historian.metrics.Csv.BATTERY_LEVEL in barGroups) {
    // The data to display bar and level is the same, except for battery level
    // data. This needs to be converted to instant non clustered events.
    var series = barGroups[historian.metrics.Csv.BATTERY_LEVEL].series[0];
    var ticks = historian.data.createTicks_(
        historian.metrics.Csv.BATTERY_LEVEL, series, false);

    barGroups[historian.metrics.Csv.BATTERY_LEVEL] = {
      name: series.name,
      index: null,
      series: [ticks]
    };
  }
  var powermonitorData = levelGroups[historian.metrics.Csv.POWERMONITOR] ?
      levelGroups[historian.metrics.Csv.POWERMONITOR].series[0].values : [];

  var configs = new historian.LevelConfigs(deviceCapacity, powermonitorData);
  configs.getConfig(levelMetric).hiddenBarMetrics.forEach(function(metric) {
    historian.metrics.hiddenBarMetrics[metric] = true;
  });

  data.configs = configs;
  data.nameToBarGroup = barGroups;
  data.nameToLevelGroup = levelGroups;
  return data;
};


/**
 * Creates the series if it does not exist and adds an entry to that series.
 * @param {!Object<!historian.SeriesData>} allSeries The existing series.
 * @param {string} name The series name.
 * @param {string} type The series type.
 * @param {number} start The start time.
 * @param {number} end The end time.
 * @param {!historian.Value} value The value for the entry.
 */
historian.data.addEntry = function(allSeries, name, type, start, end, value) {
  if (!(name in allSeries)) {
    var series = /** @type {!historian.SeriesData} */ ({
      name: name,
      type: type,
      values: [],
      cluster: true
    });
    allSeries[name] = series;
  }
  // Add entry into value array for that series.
  var series = allSeries[name];
  var entry = {
    startTime: start,
    endTime: end,
    value: value
  };
  series.values.push(entry);
};


/**
 * Creates a 0 ms entry for each entry in the given series data.
 * Used to show a series of ticks (e.g. for battery level).
 *
 * @param {string} name The metric name.
 * @param {historian.SeriesData} series The series.
 * @param {boolean} cluster Whether to enable clustering.
 * @return {historian.SeriesData} The series of ticks.
 * @private
 */
historian.data.createTicks_ = function(name, series, cluster) {
  var values = [];
  series.values.forEach(function(v) {
    values.push({
      startTime: v.startTime,
      endTime: v.startTime,
      value: v.value
    });
  });
  return {
    name: name,
    type: 'int',
    values: values,
    cluster: cluster
  };
};


/**
 * Creates an Activity Manager Proc value from the tilde delimited string.
 * @param {string} value The value to split.
 * @param {number} startTime The start time of the proc event.
 * @param {number} endTime The end time of the proc event.
 * @return {!historian.AMProcValue}
 * @private
 */
historian.data.splitAMProcValue_ = function(value, startTime, endTime) {
  var parts = value.split('~');
  goog.asserts.assert(parts.length == 4);
  return {
    startTime: startTime,
    endTime: endTime,
    pid: parseInt(parts[0], 10),
    uid: parts[1] == '' ? 0 : parseInt(parts[1], 10),
    process: parts[2],
    component: parts[3]
  };
};


/**
 * Creates an ANR value from the tilde delimited string.
 * @param {string} value The value to split.
 * @return {!historian.ANRValue} The ANR value.
 * @private
 */
historian.data.splitANR_ = function(value) {
  // TODO: replace with JSON.
  var parts = value.split('~');
  goog.asserts.assert(parts.length == 5);
  return {
    pid: parseInt(parts[0], 10),
    packageName: parts[1],
    reason: parts[3],
    flag: parts[2],
    uid: parts[4] == '' ? 0 : parseInt(parts[4], 10)
  };
};


/**
 * Each entry in the running metric can have multiple wake up reasons.
 * For each entry, convert the pipe delimited string of wake up reasons
 * into an array of wake up reasons.
 *
 * @param {historian.SeriesData} running The running metric.
 * @return {!Array<!historian.AggregatedEntry>} The split running metric values.
 * @private
 */
historian.data.splitRunningValues_ = function(running) {
  var split = [];

  running.values.forEach(function(r) {
    var values = r.value.split('|');
    var processed = [];

    var previousEndTime = r.startTime;
    values.forEach(function(v) {
      // Each value is of the format endTime~wakeupreason.
      var parts = v.split('~');
      goog.asserts.assert(parts.length == 2);
      var endTime = parts[0];
      var reason = parts[1];

      var startTime = previousEndTime;
      previousEndTime = endTime;

      processed.push(historian.data.createRunningValue_(
          parseInt(startTime, 10), parseInt(endTime, 10), reason));
    });
    split.push({
      startTime: r.startTime,
      endTime: r.endTime,
      value: processed.length,
      services: processed
    });
  });
  return split;
};


/**
 * Returns a running value which stores the wake up reason and the time it
 * occurred.
 *
 * @param {number} startTime The time corresponding to the start of the wakeup
 *     reason.
 * @param {number} endTime The time the wake up reason arrived.
 * @param {string} value The value holding the time and wake up reason sets
 *     delimited by pipes.
 * @return {!historian.RunningValue}
 * @private
 */
historian.data.createRunningValue_ = function(startTime, endTime, value) {
  return {
    startTime: startTime,
    endTime: endTime,
    value: value
  };
};


/**
 * Returns an aggregated value which stores the id of the original
 * entry it belonged to.
 *
 * A unique id is assigned to each entry in the series before it is
 * aggregated, and entries created during aggregation will store this
 * id, which will allow differentiating between entries during clustering.
 *
 * @param {number} id The id corresponding to the original entry.
 * @param {number | string} value The value.
 * @return {!historian.AggregatedValue}
 * @private
 */
historian.data.createAggregatedValue_ = function(id, value) {
  return {
    id: id,
    value: value
  };
};


/**
 * Static method to aggregates entries with overlapping times.
 * returning entries with arrays of services.
 * @param {!Array<(!historian.Entry|!historian.AggregatedEntry)>} values
 *     The values to aggregate, should be sorted by start, then end time.
 * @return {!Array<!historian.AggregatedEntry>} The aggregated values.
 * @private
 */
historian.data.aggregateData_ = function(values) {
  var aggregatedEntries = [];

  if (values.length == 0) {
    return aggregatedEntries;
  }

  // Process the first entry.
  var first = values[0];
  var aggregatedValue = historian.data.createAggregatedValue_(
      0, /** @type {string} */ (first.value));

  aggregatedEntries.push({
    startTime: first.startTime,
    endTime: first.endTime,
    value: 1,
    services: [aggregatedValue]
  });

  for (var i = 1, current; (current = values[i]); i++) {
    var current = values[i];
    aggregatedValue = historian.data.createAggregatedValue_(
        i, /** @type {string} */ (current.value));

    var numAggregated = aggregatedEntries.length;
    // If the current entry begins after all the aggregated entries,
    // don't need to aggregate anything, just create a new entry.
    if (current.startTime >= aggregatedEntries[numAggregated - 1].endTime) {
      aggregatedEntries.push({
        startTime: current.startTime,
        endTime: current.endTime,
        value: 1,
        services: [aggregatedValue]
      });
      continue;
    }
    var done = false;
    for (var j = 0; j < aggregatedEntries.length; j++) {
      var entry = aggregatedEntries[j];
      // Skip over all aggregated entries that don't overlap with
      // the current entry.
      if (entry.endTime < current.startTime ||
          entry.startTime > current.endTime) {
        continue;
      }

      if (current.startTime == entry.startTime) {
        if (current.endTime < entry.endTime) {
          // The entry is contained within an existing aggregated entry.
          // Split the aggregated entry into two parts.
          var newEntry = {
            startTime: current.endTime,
            endTime: entry.endTime,
            value: entry.services.length,
            services: entry.services.slice()
          };
          // Add the current entry to the aggregated entry.
          entry.endTime = current.endTime;
          entry.value = entry.value + 1;
          entry.services.push(aggregatedValue);
          aggregatedEntries.splice(j + 1, 0, newEntry);
          done = true;
          break;

        } else if (current.endTime == entry.endTime) {
          // The entries have equal times. Add to existing services array.
          entry.value = entry.value + 1;
          entry.services.push(aggregatedValue);
          done = true;
          break;

        } else {
          // The current entry ends after the existing aggregated entry.
          // Add to existing services array, and set a new start
          // point for the current entry for processing in the next
          // iteration.
          entry.value = entry.value + 1;
          entry.services.push(aggregatedValue);
          current.startTime = entry.endTime;
        }
      } else if (current.startTime > entry.startTime) {
        // Split the existing aggregated entry into 2 parts,
        // the time occuring before the current entry start time,
        // and the time after.
        var newEntry = {
          startTime: current.startTime,
          endTime: entry.endTime,
          value: entry.services.length,
          services: entry.services.slice()
        };
        entry.endTime = current.startTime;
        aggregatedEntries.splice(j + 1, 0, newEntry);
      }
    }
    if (!done) {
      aggregatedEntries.push({
        startTime: current.startTime,
        endTime: current.endTime,
        value: 1,
        services: [aggregatedValue]
      });
    }
  }
  return aggregatedEntries;
};


/**
 * Creates an entry for the running metric.
 * @param {number} runningStart The ms timestamp the corresponding
 *     CPU running entry begins.
 * @param {number} start The ms timestamp the entry begins.
 * @param {number} end The ms timestamp the entry ends.
 * @param {string} value The value of the entry.
 * @param {number} wakelockClassification
 *     Whether the running entry occured during a wakelock.
 * @return {!historian.Entry} The created entry.
 * @private
 */
function createKernelUptimeEntry_(
    runningStart, start, end, value, wakelockClassification) {
  var wakeReason = value;
  // Only show the wakeup reason if the start time corresponds
  // to the running entry start time.
  if (runningStart != start) {
    wakeReason = 'No wakeup reason';
  }
  return {
    startTime: start,
    endTime: end,
    value: {
      wakeReason: wakeReason,
      wakelockCategory: wakelockClassification
    }
  };
}


/**
 * Splits running entries into two types,
 * running entries with userspace wakelocks, and running entries without.
 *
 * @param {!Array<!historian.AggregatedEntry>} running
 *     The CPURunning entries to categorize.
 * @param {!Array<!historian.AggregatedEntry>} wakelocks
 *     The aggregrated Userspace wakelocks series to compare against.
 * @return {!Array<!historian.Entry>} The new categorized running series values.
 */
historian.data.categorizeRunning = function(running, wakelocks) {
  var categorized = [];

  // Running and wakelocks are sorted, so we keep track of which
  // wakelock we're currently looking at to keep this algorithm linear.
  var wakelockIndex = 0;

  running.forEach(function(r) {
    // We process each running entry in segments. curStartTime keeps track
    // of where in the running entry we're up to.
    var curStartTime = r.startTime;
    // Each running entry can have multiple wake reasons. We take the first.
    var allWakeReasons = r.services;
    var wakeReason = 'No wakeup reason';
    if (allWakeReasons.length > 0) {
      wakeReason = /** @type {string} */ (allWakeReasons[0].value);
    }

    var intersectingUserspaceWakelock = false;

    // Compare the next wakelock with the running entry.
    while (wakelockIndex < wakelocks.length) {
      var w = wakelocks[wakelockIndex];

      // Find out if the userspace wakelock and CPU running entry overlaps.
      var intersection = getIntersection(
          curStartTime, r.endTime, w.startTime, w.endTime);

      // If there is any intersection, we need to split up the running entry.
      if (intersection.length > 0) {
        var intersectStart = intersection[0];
        var intersectEnd = intersection[1];

        if (curStartTime < intersectStart) {
          // Wakelock starts after the current segment of the running entry.
          // Unaccounted for running time with no userspace wakelock.
          var e = createKernelUptimeEntry_(r.startTime, curStartTime,
              intersectStart, wakeReason,
              historian.metrics.KERNEL_UPTIME_WITH_USERSPACE);
          categorized.push(e);
          curStartTime = intersectStart;
        }
        intersectingUserspaceWakelock = true;
        // Skip time that there was a userspace wakelock.
        curStartTime = intersectEnd;
      }

      if (w.endTime <= r.endTime) {
        // The wakelock entry ends before the current running entry,
        // so can start looking at next wakelock.
        wakelockIndex++;
      } else {
        // Ran out of wakelocks to look at for this running entry.
        break;
      }
    }
    if (curStartTime != r.endTime) {
      var category = historian.metrics.KERNEL_UPTIME_WITH_USERSPACE;
      if (!intersectingUserspaceWakelock) {
        category = historian.metrics.KERNEL_UPTIME_NO_USERSPACE;
      }
      var e = createKernelUptimeEntry_(r.startTime, curStartTime, r.endTime,
          wakeReason, category);
      categorized.push(e);
    }
  });
  return categorized;
};


/**
 * Returns the intersection of the two time ranges s1, e1 and s2, e2.
 * @param {number} s1 Start time of the first range.
 * @param {number} e1 End time of the first range.
 * @param {number} s2 Start time of the second range.
 * @param {number} e2 End time of the second range.
 * @return {!Array<number>} The intersection, with at least duration 1 ms.
 *     Returns an empty array if no intersection is found.
 */
function getIntersection(s1, e1, s2, e2) {
  var start = Math.max(s1, s2);
  var end = Math.min(e1, e2);
  if (start <= end && start != end) {
    return [start, end];
  }
  return [];
}


/**
 * Comparator function for sorting entries. Sorts by startTime, then endTime.
 * @param {(historian.Entry | historian.AggregatedEntry)} e1
 *     The first entry to compare.
 * @param {(historian.Entry | historian.AggregatedEntry)} e2
 *     The second entry to compare
 * @return {number} < 0 if e1 should be before e2, 0 if equal, > 0 otherwise.
 */
function compareEntries(e1, e2) {
  return e1.startTime - e2.startTime || e1.endTime - e2.endTime;
}


/**
 * How far to cluster based on the given min duration.
 * @private
 */
historian.data.CLUSTER_DISTANCE_MULTIPLE_ = 8;


/**
 * Group together data points close to each other.
 * @param {!Array<!historian.SeriesGroup>} seriesData The data to cluster.
 * @param {number} minDuration The smallest duration visible for the
 *   current zoom level.
 * @return {!Array<historian.ClusteredSeriesData>} Clustered data.
 */
historian.data.cluster = function(seriesData, minDuration) {
  var clusteredSeriesData = [];

  seriesData.forEach(function(seriesGroup) {
    var clusteredGroup = {
      name: seriesGroup.name,
      index: seriesGroup.index,
      series: []
    };
    clusteredSeriesData.push(clusteredGroup);
    seriesGroup.series.forEach(function(series) {
      var clusteredValues = [];
      clusteredValues = historian.data.clusterSingle_(series, minDuration);
      clusteredGroup.series.push({
        name: series.name,
        type: series.type,
        values: clusteredValues,
        color: series.color,
        cluster: series.cluster
      });
    });
  });
  return clusteredSeriesData;
};


/**
 * Clusters a single series.
 * @param {!historian.SeriesData} series The series to cluster.
 * @param {number} minDuration The smallest duration visible for the
 *   current zoom level.
 * @return {!Array<!historian.data.ClusterEntry>} The clustered series.
 * @private
 */
historian.data.clusterSingle_ = function(series, minDuration) {
  var seriesData = [];
  if (!series.cluster) {
    series.values.forEach(function(v) {
      // If clustering is disabled, a new cluster is created per entry.
      seriesData.push(new historian.data.ClusterEntry(v, forceSingleCount));
    });
    return seriesData;
  }

  var startIndex = 0;
  // Entries in the CPU_RUNNING metric can have multiple wake up reasons
  // per entry stored in a services array. This will increase the cluster
  // count by the number of wake up reasons, but we only want to count each
  // entry as one instance of CPU_RUNNING.
  var forceSingleCount = (series.name == historian.metrics.Csv.CPU_RUNNING);

  // Skip blank entries.
  while (startIndex < series.values.length &&
      !historian.data.isNonBlankEntry_(series, series.values[startIndex])) {
    startIndex++;
  }

  // No non blank entries to cluster.
  if (startIndex == series.values.length) {
    return seriesData;
  }
  var clusteredEntry = new historian.data.ClusterEntry(
      series.values[startIndex], forceSingleCount);

  for (var i = startIndex + 1; i < series.values.length; i++) {
    var d = series.values[i];

    if (!historian.data.isNonBlankEntry_(series, d)) {
      // Skip entries of value 0 while clustering.
      continue;
    }

    var greatestClusterEndTime =
        clusteredEntry.firstEntryEndTime +
        (minDuration * historian.data.CLUSTER_DISTANCE_MULTIPLE_);

    // If the entry is far from the previous cluster, start a new cluster.
    if (d.startTime >= greatestClusterEndTime) {
      seriesData.push(clusteredEntry);
      clusteredEntry = new historian.data.ClusterEntry(d, forceSingleCount);

      // If the current entry and the previous cluster are visible for the
      // current zoom level, don't cluster them together.
      // Create a new cluster for the current entry.
    } else if (historian.data.duration(d) >= minDuration &&
        clusteredEntry.activeDuration >= minDuration) {

      seriesData.push(clusteredEntry);
      clusteredEntry = new historian.data.ClusterEntry(d, forceSingleCount);
    } else {
      clusteredEntry.add_(d, forceSingleCount);
    }
  }
  seriesData.push(clusteredEntry);
  return seriesData;
};



/**
 * Class for holding entries belonging to a cluster.
 * @param {(historian.Entry | historian.AggregatedEntry)} d
 *     The data entry to start cluster with.
 * @param {boolean} forceSingleCount If true, will add one to the cluster count.
 * @constructor
 * @struct
 */
historian.data.ClusterEntry = function(d, forceSingleCount) {
  /**
   * Map from value to count and duration.
   * @type {!Object}
   */
  this.clusteredValues = {};

  /** @type {number} */
  this.startTime = d.startTime;

  /** @type {number} */
  this.endTime = d.endTime;

  /** @type {number} */
  this.firstEntryEndTime = d.endTime;

  /** @type {number} */
  this.clusteredCount = 0;

  /** @type {number} */
  this.activeDuration = 0;

  /**
   * Stores original entries in sorted order.
   * @type {!Array<!historian.Entry|!historian.AggregatedEntry>}
   */
  this.sorted = [];

  this.add_(d, forceSingleCount);
};


/**
 * Adds entry to the cluster.
 * @param {(historian.Entry | historian.AggregatedEntry)} d
 *     The data entry to add.
 * @param {boolean} forceSingleCount If true, adds one to the cluster count.
 * @private
 */
historian.data.ClusterEntry.prototype.add_ = function(d, forceSingleCount) {
  // Data is sorted when first processed, so when clustering it will be added
  // in order.
  this.sorted.push(d);
  if (this.endTime < d.endTime) {
    this.endTime = d.endTime;
  }

  this.activeDuration += historian.data.duration(d);

  var values = [];
  if (d.services) {
    // Aggregated entry, more than 1 service exists.
    values = d.services;
  } else {
    values.push(d.value);
  }

  var totalCount = 0;
  values.forEach(function(v) {
    var key = historian.data.ClusterEntry.key_(v);

    if (!(key in this.clusteredValues)) {
      this.clusteredValues[key] = {
        count: 0,
        duration: 0,
        value: v,
        ids: {},
        extra: []
      };
    }

    // We don't want to increment the count if part of the split aggregated
    // entry is already a part of this cluster.
    if (!v.id || !(v.id in this.clusteredValues[key].ids)) {
      this.clusteredValues[key].count++;
      totalCount++;
    }
    if (v.id) {
      this.clusteredValues[key].ids[v.id] = true;
    }
    var duration = historian.data.duration(d);

    if (v.startTime) {
      // A running entry can have multiple wake up reasons, so we should
      // calculate the duration for the single reason rather than use the
      // running entry duration.
      duration = historian.data.duration(v);
      this.clusteredValues[key].extra.push(v);
    }
    this.clusteredValues[key].duration += duration;
  }, this);
  this.clusteredCount += totalCount;
};


/**
 * Returns the key for the value used to index the cluster's values object.
 * @param {!historian.Value} v The value to get the key for.
 * @return {string}
 * @private
 */
historian.data.ClusterEntry.key_ = function(v) {
  var isComplexType = v.id || v.startTime;

  // Other properties of an AggregatedValue or a RunningValue should not affect
  // the mapping; in this case only use the value property.
  return isComplexType ? JSON.stringify(v.value) : JSON.stringify(v);
};


/**
 * Returns the value to duration map as an array, sorted by duration
 * in descending order.
 * @return {!Array<(string|number|historian.KernelUptimeValue)>}
 */
historian.data.ClusterEntry.prototype.getSortedValues = function() {
  var sorted = [];

  for (var key in this.clusteredValues) {
    sorted.push({
      value: this.clusteredValues[key].value,
      count: this.clusteredValues[key].count,
      duration: this.clusteredValues[key].duration
    });
  }

  sorted.sort(function(a, b) {
    return b.duration - a.duration;
  });
  return sorted;
};


/**
 * Returns the value with the maximum duration.
 * @return {(number|string|historian.KernelUptimeValue)}
 */
historian.data.ClusterEntry.prototype.getMaxValue = function() {
  var maxValue = '';
  for (var v in this.clusteredValues) {
    var duration = this.clusteredValues[v].duration;
    if (maxValue == '') {
      maxValue = v;
    } else {
      var curMaxDuration = this.clusteredValues[maxValue].duration;
      if (duration > curMaxDuration) {
        maxValue = v;
      }
    }
  }
  return this.clusteredValues[maxValue].value;
};


/**
 * Returns the extra info associated with a value in the cluster.
 * @param {string} value The value to get the info for.
 * @return {!Array<!historian.Entry>}
 */
historian.data.ClusterEntry.prototype.getExtraInfo = function(value) {
  var key = historian.data.ClusterEntry.key_(value);
  return this.clusteredValues[key].extra;
};


/**
 * Values for a metric that won't be displayed as colored lines.
 * @private @const {!Object}
 */
historian.data.BLANK_VALUES_ = {};

historian.data.BLANK_VALUES_[historian.metrics.Csv.DATA_CONNECTION] = 'none';


/**
 * Returns true if the entry would be rendered as a non blank line.
 * @param {!historian.SeriesData} serie The series the data entry belongs to.
 * @param {(!historian.Entry | !historian.AggregatedEntry)} d Entry.
 * @return {boolean} True if non empty, false otherwise.
 * @private
 */
historian.data.isNonBlankEntry_ = function(serie, d) {
  if (serie.type == 'int' && d.value == 0 &&
      serie.name != historian.metrics.Csv.BRIGHTNESS) {
    return false;
  }
  if (serie.name in historian.data.BLANK_VALUES_) {
    if (historian.data.BLANK_VALUES_[serie.name] == d.value) {
      return false;
    }
  }
  return true;
};


/**
 * @param {!Object<!historian.SeriesData>} unique Map from series
 *     name to series data.
 * @return {!Array<!historian.AggregatedEntry>} WAKELOCK_IN and WAKE_LOCK_HELD
 *     entries aggregated into a single array and sorted.
 * @private
 */
historian.data.getWakelockData_ = function(unique) {
  var values = [];
  if (historian.metrics.Csv.WAKELOCK_IN in unique) {
    values = unique[historian.metrics.Csv.WAKELOCK_IN].values;
  }
  if (historian.metrics.Csv.WAKE_LOCK_HELD in unique) {
    values = values.concat(unique[historian.metrics.Csv.WAKE_LOCK_HELD].values);
  }
  return historian.data.aggregateData_(values.sort(compareEntries));
};


/**
 * Takes the max of all the readings for each second and
 * outputs a data point per second.
 * @param {!Array<!historian.Entry>} data The data to filter.
 * @return {!Array<!historian.Entry>} The filtered data.
 */
historian.data.sampleData = function(data) {
  var values = [];

  var max = 0;
  var numReadings = 0;

  var startTime = 0;
  var endTime = 0;

  var pushValue = function() {
    if (numReadings) {
      values.push({
        startTime: startTime,
        endTime: endTime,
        value: max
      });
    }
  };

  data.forEach(function(d) {
    var secs = historian.time.secsFromMs(d.startTime);

    if (secs != historian.time.secsFromMs(startTime)) {
      // Need to output previous second data.
      pushValue();
      // Reset the number of readings and start time.
      numReadings = 0;
      max = 0;
      startTime = d.startTime;
    }
    endTime = d.endTime;
    max = Math.max(d.value, max);
    numReadings++;
  });

  pushValue();

  return values;
};



/**
 * Class for mapping service names to uids.
 * @constructor
 * @struct
 */
historian.data.ServiceMapper = function() {
  /** @private {!Object} */
  this.mapping_ = {};
};


/**
 * Adds a service to uid mapping, Assumes only one mapping per service exists.
 * However, a uid can correspond to many services.
 * If either service or uid is undefined or empty, the mapping is not added.
 *
 * @param {string} service The service to add.
 * @param {string} uid The uid corresponding to the service.
 */
historian.data.ServiceMapper.prototype.addService = function(service, uid) {
  if (uid && service) {
    this.mapping_[service] = uid;
  }
};


/**
 * Returns the uid for a service.
 * @param {string} service The service to get the UID for.
 * @return {string} The uid for the service, empty string if none found.
 */
historian.data.ServiceMapper.prototype.uid = function(service) {
  if (service in this.mapping_) {
    return this.mapping_[service];
  }
  return '';
};


/**
 * Returns the ms duration of a data entry.
 * @param {!Object} d Entry to calculate duration of.
 * @return {number} Duration in ms.
 */
historian.data.duration = function(d) {
  return (d.endTime - d.startTime);
};
