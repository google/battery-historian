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
goog.provide('historian.AggregatedEntry');
goog.provide('historian.CPUUsage');
goog.provide('historian.ClusteredSeriesData');
goog.provide('historian.Entry');
goog.provide('historian.HistorianV2Data');
goog.provide('historian.KernelUptimeValue');
goog.provide('historian.LPSValue');
goog.provide('historian.SeriesData');
goog.provide('historian.SeriesGroup');
goog.provide('historian.TimeToDelta');
goog.provide('historian.Value');
goog.provide('historian.data');
goog.provide('historian.data.ClusterEntry');
goog.provide('historian.data.ClusterEntryValue');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('historian.LevelConfigs');
goog.require('historian.LevelSummaryData');
goog.require('historian.constants');
goog.require('historian.historianV2Logs');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.metrics.DataHasher');
goog.require('historian.sysui');
goog.require('historian.time');
goog.require('historian.utils');


/**
 * A single data point for a series.
 *
 * startTime: The start time in ms for the data point.
 * endTime: The end time in ms for the data point.
 * value: The value of the data point, either
 *     a number (for series of type int),
 *     or a string (for bool, string or service series).
 * id: Unique number corresponding to the original entry.
 *     Only exists for entries which are part of an AggregatedEntry.
 *
 * @typedef {{
 *   startTime: number,
 *   endTime: number,
 *   value: !historian.Value,
 *   id: (number|undefined),
 *   uid: (number|undefined),
 *   opt: (string|undefined),
 *   unknownEndTime: (boolean|undefined),
 *   duringScreenOff: (boolean|undefined)
 * }}
 */
historian.Entry;


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
 *   logLine: string,
 * }}
 */
historian.AMProcValue;


/**
 * A single value for a low power state entry.
 *
 * @typedef {{
 *   name: string,
 *   time: string,
 *   count: number
 * }}
 */
historian.LPSValue;


/**
 * A single value for an app's CPU usage entry.
 *
 * @typedef {{
 *   name: string,
 *   userTime: string,
 *   systemTime: string
 * }}
 */
historian.CPUUsage;


/**
 * A cluster entry can hold several values. These are all the possible types
 * those values can be.
 * @typedef {string|number|!historian.KernelUptimeValue|!historian.AMProcValue|!historian.LPSValue|!historian.CPUUsage|!historian.sysui.AppTransition}
 */
historian.Value;


/**
 * A single data point created from aggregating the values
 * from a number of data points.
 *
 * services: The list of entries from the original data points.
 *
 * @typedef {{
 *   startTime: number,
 *   endTime: number,
 *   services: !Array<!historian.Entry>
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
 *   series: !Array<!historian.SeriesData>,
 *   source: !historian.historianV2Logs.Sources
 * }}
 */
historian.SeriesGroup;


/**
 * All the information required to render a series.
 *
 * name: The name of the series.
 * source: Log source the data in the series originated from.
 * type: The type of data for the series (int, float, bool, string, service,
 *     group or summary).
 * values: The data points for the series.
 * originalValues: The data points before aggregation. Only populated for
 *     aggregated series.
 * color: A function that maps a value to a color.
 * cluster: Whether clustering should be applied to the metric.
 *
 * @typedef {{
 *   name: string,
 *   source: !historian.historianV2Logs.Sources,
 *   type: string,
 *   values: !Array<(!historian.Entry|!historian.AggregatedEntry)>,
 *   originalValues: (Array<!historian.Entry>|undefined),
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
 *   source: !historian.historianV2Logs.Sources,
 *   type: string,
 *   values: !Array<!historian.data.ClusterEntry>,
 *   originalValues: (Array<!historian.Entry>|undefined),
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
 *   barGroups: !historian.metrics.DataHasher,
 *   nameToLevelGroup: !Object<!historian.SeriesGroup>,
 *   nameToLineGroup: !Object<!historian.LineGroup>,
 *   nameToSummary: !Object<!Array<!historian.Entry>>,
 *   logToExtent: !Object<historian.historianV2Logs.Extent>,
 *   configs: !historian.LevelConfigs,
 *   defaultLevelMetric: string,
 *   timeToDelta: !historian.TimeToDelta,
 *   location: string,
 *   overflowMs: ?number
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
 * Details for an entry extracted from a log before being processed and
 * added into the appropriate series group.
 *
 * @typedef {{
 *   seriesName: string,
 *   type: string,
 *   startTime: number,
 *   endTime: number,
 *   value: !historian.Value,
 *   source: !historian.historianV2Logs.Sources,
 *   uid: ?number
 * }}
 */
historian.EntryInfo_;


/**
 * Parses the given csv data, and stores an object containing the battery level
 * and other series data, as well as aggregating the sync app and
 * wake lock metrics.
 * V2 data processing requires the levelMetric from the level configuration.
 *
 * @param {!Array<!historian.historianV2Logs.Log>} logs The Historian v2 logs.
 * @param {number} deviceCapacity The capacity of the device in mAh.
 * @param {!historian.TimeToDelta} timeToDelta The map from timestamp to human
 *     readable format.
 * @param {string} location The location of the bug report.
 * @param {boolean} displayPowerMonitor Whether to display power monitor data.
 * @param {!Object<string>} systemUiDecoder
 * @param {number=} opt_overflowMs Unix milliseconds of when the overflow
 *     occurred.
 * @return {historian.HistorianV2Data}
 */
historian.data.processHistorianV2Data = function(logs, deviceCapacity,
    timeToDelta, location, displayPowerMonitor, systemUiDecoder, opt_overflowMs) {
  // The metric to overlay as the level line.
  var levelMetric = displayPowerMonitor ? historian.metrics.Csv.POWER_MONITOR :
      historian.metrics.Csv.BATTERY_LEVEL;

  historian.metrics.initMetrics(systemUiDecoder);

  var data = {};
  data.defaultLevelMetric = levelMetric;
  data.timeToDelta = timeToDelta;
  data.location = location;
  data.overflowMs = opt_overflowMs || null;
  data.logToExtent =
      /** @type {!Object<historian.historianV2Logs.Extent>} */({});

  var entries = [];

  logs.forEach(function(log) {
    var newEntries = d3.csvParse(log.csv, function(d) {
      var seriesName = d['type'] == historian.metrics.ERROR_TYPE ?
          historian.metrics.typedMetricName(d['type'], d['metric']) :
          d['metric'];

      var v = d['value'];
      switch (d['type']) {
        case 'bool':
          // Boolean entries will only have true as the value, which is not
          // useful. Use the opt field for bools in case there's extra data.
          v = d['opt'];
          break;
        case 'int':
          v = parseInt(v, 10);
          if (seriesName == historian.metrics.Csv.TEMPERATURE) {
            // Temperature values are in deciCelcius (1/10 of a Celcius), so
            // convert to Celcius.
            v /= 10;
          }
          break;
        case 'float':
          v = parseFloat(v);
          break;
      }
      return {
        seriesName: seriesName,
        type: d['type'],
        startTime: parseInt(d['start_time'], 10),
        endTime: parseInt(d['end_time'], 10),
        value: v,
        source: log.source,
        opt: d['opt'],
        uid: (d['type'] == 'service' ||
            seriesName in historian.metrics.appSpecificMetrics) &&
            d['opt'] != '' ? parseInt(d['opt'], 10) : null
      };
    });
    if (newEntries.length == 0) {
      return;
    }
    entries = entries.concat(newEntries);
    var startExtent = d3.extent(newEntries, function(d) {
      if (d.startTime > 0) {
        return d.startTime;
      }  // Else return undefined so d3.extent ignores it.
    });
    var endExtent = d3.extent(newEntries, function(d) {
      if (d.endTime > 0) {
        return d.endTime;
      }
    });
    data.logToExtent[log.source] = {
      // If a log start time was passed in, it will be more accurate than the
      // calculated start extent, as it will account for events not in the CSV.
      min: log.startMs || startExtent[0] || 0,
      max: endExtent[1] || 0  // TODO: consider passing log endMs.
    };
  });

  // Separate data into series - each data value is added as an entry into
  // the value array for that series.
  var allSeries = new historian.metrics.DataHasher();

  var groupedLines =
      /** @type {!Object<!historian.LineGroup>}} */ ({});
  entries.forEach(function(d) {
    if (d.type == 'group') {
      groupedLines[d.seriesName + ' [group]'] =
          {names: d.value.split('|'), desc: d.opt};
      return;
    }
    switch (d.seriesName) {
      case historian.metrics.Csv.AM_PROC:
        d.value = {
          startTime: d.startTime,  // Time of AM_PROC_START.
          endTime: d.endTime,  // Time of corresponding AM_PROC_DIED.
          logLine: d.value
        };
        // An AM_PROC_START and AM_PROC_DIED event is created for each AM_PROC
        // event. An unknown start or end time means no start or died event
        // respectively.
        if (d.startTime != historian.constants.UNKNOWN_TIME) {
          // AM_PROC_START and AM_PROC_END are instant events. Each pair of
          // START and END events share the same value, so we clone amValue
          // here. The only difference is the series name, and the event time -
          // the start and end time are both set to the AM_PROC start time.
          var startEntry =
              /** @type {!historian.EntryInfo_} */ (jQuery.extend({}, d));
          startEntry.seriesName = historian.metrics.Csv.AM_PROC_START;
          startEntry.endTime = startEntry.startTime;
          historian.data.addEntry(allSeries, startEntry, data.logToExtent);
        }
        if (d.endTime != historian.constants.UNKNOWN_TIME) {
          // No need to clone, as we've already cloned for the start event case.
          d.seriesName = historian.metrics.Csv.AM_PROC_DIED;
          d.startTime = d.endTime;
          historian.data.addEntry(allSeries, d, data.logToExtent);
        }
        return;  // Already added entries, so can return early.
      case historian.metrics.Csv.LOW_POWER_STATE:
        d.value = historian.data.splitLPS_(d.value);
        break;
      case historian.metrics.Csv.APP_CPU_USAGE:
        d.value = historian.data.splitCPUUsage_(d.value);
        break;
    }
    historian.data.addEntry(allSeries, d, data.logToExtent);
  });

  var running = /** @type {!historian.SeriesData} */ (
      allSeries.getBatteryHistoryData(historian.metrics.Csv.CPU_RUNNING));
  if (running) {
    // Each running entry can have multiple wakeup reasons as its value.
    // For each entry, convert the multiple value string into an array.
    running.values = historian.data.splitRunningValues_(running);

    var aggregatedWakelocks = historian.data.getWakelockData_(allSeries);

    var kernelUptimeValues =
        historian.data.categorizeRunning(running.values, aggregatedWakelocks);
    var kernelUptimeSeries = {
      name: historian.metrics.KERNEL_UPTIME,
      source: historian.historianV2Logs.Sources.GENERATED,
      type: 'string',
      values: kernelUptimeValues,
      cluster: true
    };
    allSeries.add(kernelUptimeSeries);
  }

  var sysuiAction = allSeries.get(historian.historianV2Logs.Sources.EVENT_LOG,
      historian.metrics.Csv.SYSUI_ACTION);
  if (sysuiAction) {
    sysuiAction.values.sort(compareEntries);
    var transitions = historian.data.extractAppTransitions(sysuiAction.values);
    if (transitions.length > 0) {
      allSeries.add({
        name: historian.metrics.Csv.APP_TRANSITIONS,
        source: historian.historianV2Logs.Sources.EVENT_LOG,
        type: 'service',
        values: transitions,
        cluster: true
      });
    }
  }

  var powerMonitor = allSeries.get(
      historian.historianV2Logs.Sources.POWER_MONITOR,
      historian.metrics.Csv.POWER_MONITOR);
  if (powerMonitor) {
    var powerEntries = historian.utils.calculateCumulativeChargeEntries(
        powerMonitor.values, 3);
    allSeries.add({
      name: historian.metrics.Csv.POWER_MONITOR_MAH,
      source: historian.historianV2Logs.Sources.GENERATED,
      type: 'float',
      values: powerEntries,
      cluster: true
    });
  }

  var barGroups = new historian.metrics.DataHasher();
  /** @type {!Object<!Array<!historian.Entry>>} */
  var summaries = {};

  // Create a group per series. Some groups have multiple series, such as the
  // activity manager proc metric.
  allSeries.getAll().forEach(function(series) {
    var seriesName = series.name;
    series.values.sort(compareEntries);
    if (series.type == 'summary') {
      summaries[seriesName] =
          /** @type {!Array<!historian.Entry>} */(series.values);
      // Not something we want to show as a bar or aggregate.
      return;
    }
    // Check if a metric should be aggregated (has overlapping entries).
    // We also want to keep the predefined list of metrics to aggregate so
    // coloring will be mostly consistent. e.g. you could have an
    // aggregated metric that happens to not have any overlapping
    // entries in that specific bugreport.
    if (!(seriesName in historian.metrics.metricsToAggregate)) {
      var hasOverlapping = false;
      series.values.forEach(function(cur, i, arr) {
        if (i == arr.length - 1) {
          return;
        }
        var next = arr[i + 1];
        var overlaps = next.startTime < cur.endTime;
        if (!overlaps) {
          return;
        }
        if (series.type == 'int' || series.type == 'float' ||
            series.type == 'string' || series.type == 'bool') {
          // These metrics represent state and should never overlap.
          // Sometimes the data gets mangled and they do, in which
          // case we need to fix it to ensure it displays at all.
          cur.endTime = next.startTime;
          // TODO: add some UI indication that the event
          // is malformed.
          console.log('Modified ' + series.name + ' entry ' + i + ' end time');
        } else {
          hasOverlapping = true;
        }
      });
      if (hasOverlapping) {
        historian.metrics.metricsToAggregate[series.name] = true;
      }
    }
    if (seriesName in historian.metrics.metricsToAggregate) {
      // Save a copy of the original un-sliced values.
      // Deep copy the array as aggregateData_ may change the data.
      series.originalValues = /** @type {!Array<!historian.Entry>} */ (
          jQuery.extend(true, [], series.values));
      switch (series.name) {
        case historian.metrics.Csv.ACTIVE_BROADCAST_BACKGROUND:
        case historian.metrics.Csv.ACTIVE_BROADCAST_FOREGROUND:
          // The number of active broadcasts is unbounded (unlike historical
          // broadcasts which are bounded at 300). Since active broadcasts
          // span until the end of the bugreport, we should just draw
          // a single rectangle for the earliest such broadcast and include
          // all active broadcasts rather than the usual slicing up algorithm.
          // Since they are already sorted, this will be the first entry.
          goog.asserts.assert(series.values.length > 0);
          series.values.forEach(function(entry, i) {
            entry.id = i;
          });
          series.values = [{
            startTime: series.values[0].startTime,
            endTime: series.values[0].endTime,
            services: series.values
          }];
          break;
        default:
          series.values = historian.data.aggregateData_(series.values);
      }
    }
    var groupName = seriesName;
    if (series.type == historian.metrics.ERROR_TYPE) {
      groupName = historian.metrics.baseMetric(series.type, seriesName);
    }
    var customGroupName = historian.data.getCustomGroupName_(series);
    var source = series.source;
    if (customGroupName) {
      groupName = customGroupName;
      // Specially defined group with possibly more than one series.
      source = historian.historianV2Logs.Sources.CUSTOM;
    }
    // Doesn't do anything if the group already exists.
    barGroups.add({
      name: groupName,
      series: [],
      index: null,
      source: source
    });
    barGroups.get(source, groupName).series.push(series);
  });

  if (barGroups.contains(historian.historianV2Logs.Sources.POWER_MONITOR,
      historian.metrics.Csv.POWER_MONITOR)) {
    // If there is power monitor data, battery level and coulomb data are invalid.
    barGroups.delete(historian.historianV2Logs.Sources.BATTERY_HISTORY,
        historian.metrics.Csv.BATTERY_LEVEL);
    barGroups.delete(historian.historianV2Logs.Sources.BATTERY_HISTORY,
        historian.metrics.Csv.COULOMB_CHARGE);

    if (barGroups.contains(historian.historianV2Logs.Sources.POWER_MONITOR,
        historian.metrics.Csv.POWER_MONITOR_MW)) {
      groupedLines[historian.metrics.Csv.POWER_MONITOR_MA_MW_GROUP] = {
        names: [
          historian.metrics.Csv.POWER_MONITOR,
          historian.metrics.Csv.POWER_MONITOR_MW
        ]
      };
    }

    if (barGroups.contains(historian.historianV2Logs.Sources.GENERATED,
        historian.metrics.Csv.POWER_MONITOR_MAH)) {
      groupedLines[historian.metrics.Csv.POWER_MONITOR_MA_MAH_GROUP] = {
        names: [
          historian.metrics.Csv.POWER_MONITOR,
          historian.metrics.Csv.POWER_MONITOR_MAH
        ]
      };
    }
  }

  /** @type {!Object<!historian.SeriesGroup>} */
  var levelGroups = {};
  // Copy the groups that can be displayed as a level overlay from barGroups.
  barGroups.getAll().forEach(function(barGroup) {
    var groupName = barGroup.name;
    if (!historian.metrics.isSelectableAsLevel(barGroup) &&
        groupName != historian.metrics.Csv.LOGCAT_MISC) {
      return;
    }
    // The barGroups holds a reference to the same object, so we should
    // deep clone it so we don't apply barGroup specific processing to it,
    // such as adding unavailable series.
    levelGroups[groupName] = /** @type {!historian.SeriesGroup} */ (
        jQuery.extend(true, {}, barGroup));

    // String metrics can be displayed as a line if we have predefined
    // the expected values.
    if (groupName in historian.metrics.expectedStrings) {
      var expectedValues = historian.metrics.expectedStrings[groupName];
      var mapping = {};
      expectedValues.forEach(function(val, idx) {
        mapping[val] = idx;  // Each string value maps to its array index.
      });
      var nextIdx = expectedValues.length;  // For unexpected values we find.
      levelGroups[groupName].series.forEach(function(series) {
        if (series.type != 'string') {
          return;  // The group may have an UNAVAILABLE type series.
        }
        series.values.forEach(function(entry) {
          if (!(entry.value in mapping)) {  // Non-predefined value.
            console.log(series.name + ' got unknown value: ' + entry.value);
            // Add it to the original array so we can map back from the number
            // to readable string value later on.
            historian.metrics.expectedStrings[groupName].push(
                /** @type {string} */ (entry.value));
            mapping[entry.value] = nextIdx;
            nextIdx++;
          }
          entry.value = mapping[entry.value];
        });
      });
      return;
    }
    // Bucket the data if necessary. This is only required for non 'int'
    // metrics, such as AM_PROC.
    if (!historian.metrics.isBuckettedLevelGroup(groupName)) {
      return;
    }
    var bucketDur = historian.metrics.levelGroupBucketDuration[groupName];
    levelGroups[groupName].series.forEach(function(series) {
      var entryTimes = series.values.map(function(entry) {
        return entry.startTime;
      });
      var bucketted = historian.data.bucket(
          data.logToExtent[series.source].min, entryTimes, bucketDur);
      var newEntries = [];
      bucketted.forEach(function(res, idx) {
        if (idx != 0) {
          // If there is a time period not covered by a bucket,
          // create an entry with count zero.
          var prevEnd = bucketted[idx - 1].bucketMs + bucketDur;
          if (prevEnd != res.bucketMs) {
            newEntries.push({
              startTime: prevEnd,
              endTime: res.bucketMs,
              value: 0
            });
          }
        }
        newEntries.push({
          startTime: res.bucketMs,
          endTime: res.bucketMs + bucketDur,
          value: res.count
        });
      });
      series.values = newEntries;
    });
  });
  var batteryLevelGroup = /** @type {?historian.SeriesGroup} */
      (barGroups.getBatteryHistoryData(historian.metrics.Csv.BATTERY_LEVEL));
  if (batteryLevelGroup) {
    // Create data for the Screen Off Discharge mode.
    var screenOffDischarge = historian.data.copyGroup_(
        batteryLevelGroup, historian.metrics.Csv.SCREEN_OFF_DISCHARGE);
    screenOffDischarge.series[0].values = historian.utils.generateDerivative(
        screenOffDischarge.series[0].values);

    var screenOnGroup = barGroups.getBatteryHistoryData(
        historian.metrics.Csv.SCREEN_ON);
    var screenOnValues = screenOnGroup ? screenOnGroup.series[0].values : [];
    screenOffDischarge.series[0].values.forEach(function(entry) {
      entry.duringScreenOff = historian.utils.isMostlyScreenOffEvent(
          /** @type {!historian.Entry} */ (entry), screenOnValues);
    });
    levelGroups[historian.metrics.Csv.SCREEN_OFF_DISCHARGE] =
        screenOffDischarge;

    var avgGroup = historian.data.copyGroup_(
        screenOffDischarge, historian.metrics.Csv.SCREEN_OFF_DISCHARGE_AVG);
    levelGroups[historian.metrics.Csv.SCREEN_OFF_DISCHARGE_AVG] = avgGroup;

    historian.utils.avgByCategory(avgGroup.series[0].values,
        function(entry) { return entry.duringScreenOff; });

    // Add option to display both metrics at the same time.
    groupedLines[historian.metrics.Csv.SCREEN_OFF_DISCHARGE_GROUP] = {
      names: [
        historian.metrics.Csv.SCREEN_OFF_DISCHARGE,
        historian.metrics.Csv.SCREEN_OFF_DISCHARGE_AVG
      ]
    };

    // The data to display bar and level is the same, except for battery level
    // data. This needs to be converted to instant non clustered events.
    var series = batteryLevelGroup.series[0];
    var ticks = historian.data.createTicks_(
        historian.metrics.Csv.BATTERY_LEVEL, series, false);
    batteryLevelGroup.series = [ticks];
  }
  historian.data.addUnavailableSeries_(data.logToExtent, barGroups);

  data.nameToSummary = summaries;
  data.configs = new historian.LevelConfigs(
      deviceCapacity, levelGroups, groupedLines);
  data.barGroups = barGroups;
  data.nameToLevelGroup = levelGroups;
  data.nameToLineGroup = groupedLines;
  return data;
};


/**
 * Returns a copy of the given group, with all name references replaced
 * with the given name.
 * @param {!historian.SeriesGroup} groupToCopy
 * @param {string} newName
 * @return {!historian.SeriesGroup}
 * @private
 */
historian.data.copyGroup_ = function(groupToCopy, newName) {
  var copy = /** @type {!historian.SeriesGroup} */ (
      jQuery.extend(true, {}, groupToCopy));
  copy.name = newName;
  copy.series.forEach(function(series) {
    series.name = newName;
  });
  return copy;
};


/**
 * Returns the custom group name if it exists, null otherwise.
 * @param {!historian.SeriesData} series
 * @return {?string}
 * @private
 */
historian.data.getCustomGroupName_ = function(series) {
  if (series.source == historian.historianV2Logs.Sources.EVENT_LOG) {
    switch (series.name) {
      case historian.metrics.Csv.AM_PROC_START:
      case historian.metrics.Csv.AM_PROC_DIED:
        return historian.metrics.Csv.AM_PROC;
      case historian.metrics.Csv.AM_LOW_MEMORY:
      case historian.metrics.Csv.AM_ANR:
        return historian.metrics.Csv.AM_LOW_MEMORY_ANR;
    }
  } else if (series.source == historian.historianV2Logs.Sources.SYSTEM_LOG) {
    switch (series.name) {
      case historian.metrics.Csv.CRASHES:
      case historian.metrics.Csv.NATIVE_CRASHES:
        return historian.metrics.Csv.CRASHES;
      case historian.metrics.Csv.GC_PAUSE_BACKGROUND_PARTIAL:
      case historian.metrics.Csv.GC_PAUSE_BACKGROUND_STICKY:
      case historian.metrics.Csv.GC_PAUSE_FOREGROUND:
        return historian.metrics.Csv.GC_PAUSE;
    }
  }
  return null;
};


/**
 * Adds an extra series of UNAVAILABLE_TYPE to log groups where the log start
 * time is after the bug report start time. This signifies that data was not
 * available for that time period.
 * @param {!Object<!historian.historianV2Logs.Extent>} logToExtent
 * @param {!historian.metrics.DataHasher} barGroups Map from group name to
 *     series group data.
 * @private
 */
historian.data.addUnavailableSeries_ = function(logToExtent, barGroups) {
  var reportExtent = historian.historianV2Logs.getExtent(
      logToExtent, Object.keys(logToExtent));
  if (!reportExtent) {
    return;
  }
  var reportStart = reportExtent.min;

  barGroups.getAll().forEach(function(group) {
    var groupName = group.name;

    // Find the log(s) with the earliest start time for the series in the
    // current group.
    var logStart = null;
    var logSources = {};

    // TODO: render time between logs as unavailable too -
    // need to add end time of logs. Currently only uses the earliest
    // log start time.
    group.series.forEach(function(series) {
      if (series.source in logToExtent) {
        var start = logToExtent[series.source].min;
        if (!logStart || start < logStart) {
          logStart = start;
          logSources = { [series.source]: true };
        } else if (start == logStart) {
          logSources[series.source] = true;
        }
      }
    });
    if (!logStart || reportStart >= logStart) {
      return;
    }
    // We want this series to be rendered before any other series in the
    // group, in case it overlaps with any entries rendered as circles.
    group.series.unshift({
      name: historian.metrics.typedMetricName(
          historian.metrics.UNAVAILABLE_TYPE, groupName),
      type: historian.metrics.UNAVAILABLE_TYPE,
      values: [{
        startTime: reportStart,
        endTime: logStart,
        value: Object.keys(logSources).join(', ')
      }],
      cluster: false,
      source: historian.historianV2Logs.Sources.GENERATED
    });
  });
};


/**
 * Creates the series if it does not exist and adds an entry to that series.
 * @param {!historian.metrics.DataHasher} allSeries The existing series.
 * @param {!historian.EntryInfo_} entryInfo Details of the entry to add.
 * @param {!Object<!historian.historianV2Logs.Extent>} logToExtent Map from log
 *     source name to log domain.
 */
historian.data.addEntry = function(allSeries, entryInfo, logToExtent) {
  var series = allSeries.get(entryInfo.source, entryInfo.seriesName);
  if (!series) {
    series = /** @type {!historian.SeriesData} */ ({
      name: entryInfo.seriesName,
      source: entryInfo.source,
      type: entryInfo.type,
      values: [],
      cluster: true
    });
    allSeries.add(series);
  }
  // Add entry into value array for that series.
  var entry = {
    startTime: entryInfo.startTime,
    endTime: entryInfo.endTime,
    value: entryInfo.value
  };
  if (entryInfo.uid != null) {  // Don't use falsy check as may be zero.
    entry.uid = entryInfo.uid;
  }
  switch (entryInfo.seriesName) {
    case historian.metrics.Csv.ACTIVE_BROADCAST_FOREGROUND:
    case historian.metrics.Csv.ACTIVE_BROADCAST_BACKGROUND:
      // If it's unknown when a broadcast was dispatched, replace it with the
      // last known time in the broadcasts log, as we can't render an end time
      // of -1.
      if (entry.endTime == historian.constants.UNKNOWN_TIME) {
        entry.endTime = logToExtent[entryInfo.source].max;
        entry.unknownEndTime = true;
      }
      break;
  }
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
    source: series.source,
    type: 'int',
    values: values,
    cluster: cluster
  };
};


/**
 * Creates a Power State value from the tilde delimited string.
 * @param {string} value The value to split.
 * @return {!historian.LPSValue} The low power state value.
 * @private
 */
historian.data.splitLPS_ = function(value) {
  // TODO: replace with JSON.
  var parts = value.split('~');
  goog.asserts.assert(parts.length == 3);
  return {
    name: parts[0],
    time: parts[1],
    count: Number(parts[2])
  };
};


/**
 * Creates a Power State value from the tilde delimited string.
 * @param {string} value The value to split.
 * @return {!historian.CPUUsage} The low power state value.
 * @private
 */
historian.data.splitCPUUsage_ = function(value) {
  // TODO: replace with JSON.
  var parts = value.split('~');
  goog.asserts.assert(parts.length == 3);
  return {
    name: parts[0],
    userTime: parts[1],
    systemTime: parts[2]
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

    values.forEach(function(v) {
      // Each value is of the format startTime~endTime~wakeupreason OR
      // instantTime~wakeupreason.
      var parts = v.split('~');
      goog.asserts.assert(parts.length == 3 || parts.length == 2);
      var startTime = parts[0];
      if (parts.length == 2) {
        // Instant event.
        var endTime = startTime;
        var reason = parts[1];
      } else {
        var endTime = parts[1];
        var reason = parts[2];
      }

      processed.push({
        startTime: parseInt(startTime, 10),
        endTime: parseInt(endTime, 10),
        value: reason
      });
    });
    split.push({
      startTime: r.startTime,
      endTime: r.endTime,
      services: processed
    });
  });
  return split;
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
  if (values.length == 0) {
    return [];
  }

  // Process the first entry.
  var first = values[0];
  first.id = 0;

  var aggregatedEntries = [{
    startTime: first.startTime,
    endTime: first.endTime,
    services: [first]
  }];

  for (var i = 1, current; (current = values[i]); i++) {
    current.id = i;
    // We want to eventually store the entry with it's original times,
    // so keep track of the current slice's start and end time in separate
    // variables.
    var curStart = current.startTime;
    var curEnd = current.endTime;

    var numAggregated = aggregatedEntries.length;
    // If the current entry begins after all the aggregated entries,
    // don't need to aggregate anything, just create a new entry.
    if (curStart >= aggregatedEntries[numAggregated - 1].endTime) {
      aggregatedEntries.push({
        startTime: curStart,
        endTime: curEnd,
        services: [current]
      });
      continue;
    }
    var done = false;
    for (var j = 0; j < aggregatedEntries.length; j++) {
      var entry = aggregatedEntries[j];
      // Skip over all aggregated entries that don't overlap with
      // the current entry.
      if (entry.endTime < curStart || entry.startTime > curEnd) {
        continue;
      }

      if (curStart == entry.startTime) {
        if (curEnd < entry.endTime) {
          // The entry is contained within an existing aggregated entry.
          // Split the aggregated entry into two parts.
          var newEntry = {
            startTime: curEnd,
            endTime: entry.endTime,
            services: entry.services.slice()
          };
          // Add the current entry to the aggregated entry.
          entry.endTime = curEnd;
          entry.services.push(current);
          aggregatedEntries.splice(j + 1, 0, newEntry);
          done = true;
          break;

        } else if (curEnd == entry.endTime) {
          // The entries have equal times. Add to existing services array.
          entry.services.push(current);
          done = true;
          break;

        } else {
          // The current entry ends after the existing aggregated entry.
          // Add to existing services array, and set a new start
          // point for the current entry for processing in the next
          // iteration.
          entry.services.push(current);
          curStart = entry.endTime;
        }
      } else if (curStart > entry.startTime) {
        // Split the existing aggregated entry into 2 parts,
        // the time occuring before the current entry start time,
        // and the time after.
        var newEntry = {
          startTime: curStart,
          endTime: entry.endTime,
          services: entry.services.slice()
        };
        entry.endTime = curStart;
        aggregatedEntries.splice(j + 1, 0, newEntry);
      }
    }
    if (!done) {
      aggregatedEntries.push({
        startTime: curStart,
        endTime: curEnd,
        services: [current]
      });
    }
  }
  return aggregatedEntries;
};


/**
 * Merges events with the same ID if they are the only events in their entries.
 * Modifies the given array.
 *
 * Overlapping events are split and aggregated together to construct entries so
 * rendered SVG rects do not overlap. This can be confusing when entries of a
 * single UID are chosen to be viewed - e.g. there might be 10 SVG rects for a
 * single sync event that was split up. Since each event in an aggregated
 * series is given a unique ID, original events can be merged together.
 *
 * @param {!Array<!historian.Entry|!historian.AggregatedEntry>} entries Array
 *     of entries to modify.
 */
historian.data.mergeSplitEntries = function(entries) {
  // Iterate backwards so we don't have to deal with indexes shifting as
  // entries are deleted.
  for (var i = entries.length - 1; i >= 1; i--) {
    var curEntry = entries[i];
    var prevEntry = entries[i - 1];

    if (!curEntry.services || !prevEntry.services) {
      // All entries in an aggregated series will have the services property,
      // so can early exit if a single entry doesn't.
      break;
    }

    // Only merge entries if both entries have only one event. It's possible
    // for an entry to have multiple events despite filtering on a single UID.
    if (curEntry.services.length == 1 && prevEntry.services.length == 1) {
      var curEvent = curEntry.services[0];
      var prevEvent = prevEntry.services[0];
      // The ID might be zero, so use hasOwnProperty to check if an ID exists.
      if (curEvent.hasOwnProperty('id') && prevEvent.hasOwnProperty('id') &&
          (curEvent.id == prevEvent.id)) {
        // Since the IDs were the same, they were split from the same original
        // entry. No need to overwrite anything other than the end time.
        prevEntry.endTime = curEntry.endTime;
        // Delete the event as we've merged it with the previous event.
        entries.splice(i, 1);
      }
    }
  }
};


/**
 * Creates an entry for the running metric.
 * @param {number} runningStart The ms timestamp the corresponding
 *     CPU running entry begins.
 * @param {number} start The ms timestamp the entry begins.
 * @param {number} end The ms timestamp the entry ends.
 * @param {!Array<string>} wakeupReasons
 * @param {number} wakelockClassification
 *     Whether the running entry occured during a wakelock.
 * @return {!historian.AggregatedEntry} The created entry.
 * @private
 */
function createKernelUptimeEntry_(
    runningStart, start, end, wakeupReasons, wakelockClassification) {
  return {
    startTime: start,
    endTime: end,
    services: wakeupReasons.map(function(wr) {
      return {
        startTime: start,  // Wakeup times are irrelevant.
        endTime: end,
        value: {
          wakeReason: wr,
          wakelockCategory: wakelockClassification
        }
      };
    })
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
    // Each running entry can have multiple wake reasons. Make a copy of the
    // array so we can modify it.
    var allWakeReasons = r.services.slice();

    var mostRelevantWakeReasons = function(startTime, endTime) {
      if (allWakeReasons.length == 0) {
        return ['No wakeup reason'];
      }
      // Get the next wakeup reason and any that intersect.
      var num = 1;
      for (; num < allWakeReasons.length; num++) {
        var wr = allWakeReasons[num];
        // Check if the time the wakeup reason was reported (start time)
        // intersects with the kernel uptime entry.
        var intersection = historian.utils.inTimeRange(startTime, endTime,
            [
              {startTime: wr.startTime, endTime: wr.startTime, value: wr.value}
            ]);
        if (!intersection.length > 0) {
          break;
        }
      }
      // Copy the relevant wakeup reasons.
      var res = allWakeReasons.slice(0, num).map(function(wr) {
        return wr.value;
      });
      // Delete used wakeup reason so we don't double count.
      allWakeReasons.splice(0, num);
      return res;
    };

    var intersectingUserspaceWakelock = false;

    // Compare the next wakelock with the running entry.
    while (wakelockIndex < wakelocks.length) {
      var w = wakelocks[wakelockIndex];

      // Find out if the userspace wakelock and CPU running entry overlaps.
      var intersection = historian.utils.getIntersection(
          curStartTime, r.endTime, w.startTime, w.endTime);

      // If there is any intersection, we need to split up the running entry.
      if (intersection.length > 0) {
        var intersectStart = intersection[0];
        var intersectEnd = intersection[1];

        if (curStartTime < intersectStart) {
          // Wakelock starts after the current segment of the running entry.
          // Unaccounted for running time with no userspace wakelock.
          var e = createKernelUptimeEntry_(r.startTime, curStartTime,
              intersectStart,
              mostRelevantWakeReasons(curStartTime, intersectStart),
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
          mostRelevantWakeReasons(curStartTime, r.endTime), category);
      categorized.push(e);
    }
  });
  return categorized;
};


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
      series: [],
      source: seriesGroup.source
    };
    clusteredSeriesData.push(clusteredGroup);
    seriesGroup.series.forEach(function(series) {
      var clusteredValues = [];
      clusteredValues = historian.data.clusterSingle_(series, minDuration);
      clusteredGroup.series.push({
        name: series.name,
        type: series.type,
        values: clusteredValues,
        originalValues: series.originalValues,
        color: series.color,
        cluster: series.cluster,
        source: series.source
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
 * Holds the details corresponding to a value in the cluster.
 *
 * count: number of times the value occurred.
 * duration: total duration the value occurred.
 * value: the value from the original entry.
 * ids: map from the original entry IDs to true if present.
 * extra: additional data for the entry.
 *
 * @typedef {{
 *   count: number,
 *   duration: number,
 *   value: !historian.Value,
 *   ids: !Object<boolean>,
 *   extra: !Array<!historian.Entry>,
 * }}
 */
historian.data.ClusterEntryValue;



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
   * @type {!Object<!historian.data.ClusterEntryValue>}
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
 * @param {!historian.Entry|!historian.AggregatedEntry} d
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

  var entries = d.services || [d];

  var totalCount = 0;
  entries.forEach(function(entry) {
    var key = historian.data.ClusterEntry.key_(entry);

    if (!(key in this.clusteredValues)) {
      this.clusteredValues[key] = {
        count: 0,
        duration: 0,
        value: entry.value,
        ids: {},
        extra: []
      };
    }
    // Id can be zero, so don't use falsy check.
    var hasId = entry.hasOwnProperty('id');

    // We don't want to increment the count if part of the split aggregated
    // entry is already a part of this cluster.
    if (!hasId || !(entry.id in this.clusteredValues[key].ids)) {
      this.clusteredValues[key].count++;
      totalCount++;
    }
    if (hasId) {
      this.clusteredValues[key].ids[entry.id] = true;
    }
    var duration = historian.data.duration(d);

    if (d.services && !hasId) {
      // A running entry can have multiple wake up reasons, so we should
      // calculate the duration for the single reason rather than use the
      // running entry duration.
      duration = historian.data.duration(entry);
      this.clusteredValues[key].extra.push(entry);
    }

    this.clusteredValues[key].duration += duration;
  }, this);
  this.clusteredCount += (forceSingleCount) ? 1 : totalCount;
};


/**
 * Returns the key for the value used to index the cluster's values object.
 * @param {!historian.Entry} entry The entry to get the key for.
 * @return {string}
 * @private
 */
historian.data.ClusterEntry.key_ = function(entry) {
  // Use UID as part of the key when available. Some entries
  // may have the same value field but should be displayed as separate rows.
  return entry.hasOwnProperty('uid') ?
      JSON.stringify({value: entry.value, uid: entry.uid}) :
      JSON.stringify(entry.value);
};


/**
 * Returns the value to duration map as an array, sorted by default by duration
 * in descending order.
 * @param {boolean=} opt_byCount Sort by count instead.
 * @return {!Array<!historian.data.ClusterEntryValue>}
 */
historian.data.ClusterEntry.prototype.getSortedValues = function(opt_byCount) {
  var sorted = [];

  for (var key in this.clusteredValues) {
    sorted.push(this.clusteredValues[key]);
  }

  sorted.sort(function(a, b) {
    return opt_byCount ? b.count - a.count : b.duration - a.duration;
  });
  return sorted;
};


/**
 * Returns the value with the maximum duration.
 * @return {!historian.Value}
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
 * Returns all the ids of entries present in the cluster, sorted numerically.
 * These ids can map to the originalValues stored per series.
 * @return {!Array<number>}
 */
historian.data.ClusterEntry.prototype.getIds = function() {
  var ids = {};
  for (var key in this.clusteredValues) {
    for (var id in this.clusteredValues[key].ids) {
      ids[id] = true;
    }
  }
  return Object.keys(ids)
      .map(function(id) { return parseInt(id, 10); })
      .sort(function(a, b) { return a - b; });
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
 * @param {!historian.metrics.DataHasher} allSeries
 * @return {!Array<!historian.AggregatedEntry>} WAKELOCK_IN and WAKE_LOCK_HELD
 *     entries aggregated into a single array and sorted.
 * @private
 */
historian.data.getWakelockData_ = function(allSeries) {
  var values = [];
  var wakelockIn = allSeries.getBatteryHistoryData(
      historian.metrics.Csv.WAKELOCK_IN);
  if (wakelockIn) {
    values = wakelockIn.values;
  }
  var wakelockHeld = allSeries.getBatteryHistoryData(
      historian.metrics.Csv.WAKE_LOCK_HELD);
  if (wakelockHeld) {
    values = values.concat(wakelockHeld.values);
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
 * Returns the ms duration of a data entry.
 * @param {!Object} d Entry to calculate duration of.
 * @return {number} Duration in ms.
 */
historian.data.duration = function(d) {
  return (d.endTime - d.startTime);
};


/**
 * Returns a map of wakeup reason to array of counts for each time interval,
 * determined by the given bucket size.
 * This will be used to plot a histogram of wakeup count over time for a
 * selected wakeup.
 *
 * @param {number} reportStart Start time of the report since epoch in
 *     milliseconds.
 * @param {!historian.SeriesGroup} runningGroup Group containing the battery
 *     history running series. The series should have non-overlapping entries,
 *     sorted by start time. Each entry should contain an array of
 *     non-overlapping wakeup reasons, sorted by start time.
 * @param {number} bucketSize Size of each bucket in milliseconds, greater than
 *     zero.
 * @return {!Object<!Array<{bucketMs: number, count: number}>>} Map from wakeup
 *     reason to bucket start times and corresponding count for the time period
 *     [bucketMs, bucketMs + bucketSize).
 */
historian.data.bucketWakeups =
    function(reportStart, runningGroup, bucketSize) {
  goog.asserts.assert(bucketSize > 0);
  var idx = goog.array.findIndex(runningGroup.series, function(series) {
    return series.name == historian.metrics.Csv.CPU_RUNNING &&
        series.source == historian.historianV2Logs.Sources.BATTERY_HISTORY;
  });
  if (idx == -1) {
    return [];
  }
  var running = runningGroup.series[idx].values;
  // Each running entry can have multiple wakeup reasons. Construct a map from
  // wakeup reason to all entries.
  var wakeupToData = {};
  running.forEach(function(entry) {
    entry.services.forEach(function(wakeupEntry) {
      var wakeupName = wakeupEntry.value.trim();
      if (!(wakeupName in wakeupToData)) {
        // Use the wakeup name as the key.
        wakeupToData[wakeupName] = [];
      }
      wakeupToData[wakeupName].push(wakeupEntry);
    });
  });

  var wakeupToCounts = {};
  for (var wakeup in wakeupToData) {
    // The stored end time is the time the wakeup reason was reported.
    var times = wakeupToData[wakeup].map(function(entry) {
      return entry.endTime;
    });
    wakeupToCounts[wakeup] =
        historian.data.bucket(reportStart, times, bucketSize);
  }
  return wakeupToCounts;
};


/**
 * Returns an array of counts for each time interval, determined by the
 * given bucket size.
 *
 * @param {number} reportStart Start time of the report since epoch in
 *     milliseconds.
 * @param {!Array<number>} times Array of event times.
 * @param {number} bucketSize Size of each bucket in milliseconds, greater than
 *     zero.
 * @return {!Array<{bucketMs: number, count: number}>} Bucket start times and
 *     corresponding count for the time period
 *     [bucketMs, bucketMs + bucketSize).
 */
historian.data.bucket = function(reportStart, times, bucketSize) {
  goog.asserts.assert(bucketSize > 0);
  if (times.length == 0) {
    return [];
  }
  var bucketStart = null;
  var result = [];
  var count = 0;
  times.forEach(function(time) {
    var timeDiff = time - reportStart;
    var bucket = reportStart +
        ((Math.floor(timeDiff / bucketSize)) * bucketSize);
    if (bucketStart && bucket != bucketStart) {
      // Add the previous bucket if we've moved on to a different bucket.
      result.push({bucketMs: bucketStart, count});
      count = 0;
    }
    bucketStart = bucket;
    count++;
  });
  result.push({bucketMs: bucketStart, count: count});
  return result;
};


/**
 * Extracts app transition events from the sysui_action series, and removes
 * transition related events from the input array.
 * @param {!Array<!historian.Entry>} sysuiActions Sorted sysui action events.
 * @return {!Array<!historian.Entry>} Any app transition events.
 */
historian.data.extractAppTransitions = function(sysuiActions) {
  var transitions = [];

  // Returns the transition not containing an event of the given transition id,
  // with the closest time to the given event. If no such transition is found,
  // null is returned and means a new transition should be created.
  var getClosestTransition = function(event) {
    var parts = event.value.split(',');  // e.g. 321,1111
    var transitionId = parts[0];
    var time = event.startTime;
    switch (parseInt(transitionId, 10)) {
      case historian.sysui.Transition.DELAY_MS:
      case historian.sysui.Transition.STARTING_WINDOW_DELAY_MS:
      case historian.sysui.Transition.WINDOWS_DRAWN_DELAY_MS:
        // These events are logged with delay, which is stored as the value.
        var delayMs = parts[1];
        if (isNaN(delayMs)) {
          console.log('encountered NaN delay ms: ' + parts[1]);
        } else {
          time -= delayMs;
        }
    }
    return transitions.reduce(function(curClosest, transition) {
      if (transitionId in transition.value) {
        return curClosest;
      } else if (!curClosest) {
        return transition;
      } else {
        var curClosestDiff = Math.abs(time - curClosest.startTime);
        var tranDiff = Math.abs(time - transition.startTime);
        return curClosestDiff < tranDiff ? curClosest : transition;
      }
    }, null);
  };
  for (var i = 0; i < sysuiActions.length; i++) {
    var curEvent = sysuiActions[i];
    var transitionId = curEvent.value.split(',')[0];  // e.g. 321,1111
    if (!historian.sysui.isTransition(parseInt(transitionId, 10))) {
      continue;
    }
    // The order of app transition events doesn't seem to be fixed, so find
    // the closest event that doesn't already contain that transition type.
    var closestTransition = getClosestTransition(curEvent);
    if (!closestTransition) {
      transitions.push({
        startTime: curEvent.startTime,
        endTime: curEvent.endTime,
        value: {
          [transitionId]: curEvent
        }
      });
    } else {
      closestTransition.value[transitionId] = curEvent;
      // Sysui action events are instant events so they have the same
      // start and end times, and are sorted.
      closestTransition.endTime = curEvent.endTime;
    }
    sysuiActions.splice(i, 1);
    i--;
  }
  return transitions;
};
