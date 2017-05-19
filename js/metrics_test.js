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

goog.provide('historian.metricsTest');
goog.setTestOnly('historian.metricsTest');

goog.require('goog.testing.jsunit');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.metrics.DataHasher');


/**
 * Tests there are no duplicated metrics in the metrics definitions.
 */
var testMetricsUnique = function() {
  var arraysToCheck = [
    historian.metrics.BATTERY_HISTORY_ORDER,
    historian.metrics.BATTERY_HISTORY_HIDDEN,
    historian.metrics.METRICS_TO_AGGREGATE_,
    historian.metrics.APP_SPECIFIC_METRICS_
  ];
  var unreliable = [];
  for (var rv in historian.metrics.UNRELIABLE_METRICS_) {
    unreliable = unreliable.concat(historian.metrics.UNRELIABLE_METRICS_[rv]);
  }
  arraysToCheck.push(unreliable);
  arraysToCheck.forEach(function(arr) {
    var seen = {};
    arr.forEach(function(e) {
      var hash = typeof e == 'string' ? e :
          historian.metrics.hash(e);
      assertFalse(arr + ': Duplicated metric in order definition: ' + e,
          seen.hasOwnProperty(hash));
      seen[hash] = true;
    });
  });
};


/**
 * Tests that names for metrics are generated correctly.
 */
var testMetricNames = function() {
  var tests = [
    {
      name: 'Error metric',
      metricType: historian.metrics.ERROR_TYPE,
      want: 'Error metric [Error]'
    },
    {
      name: 'Unavailable metric',
      metricType: historian.metrics.UNAVAILABLE_TYPE,
      want: 'Unavailable metric: no data'
    },
    {
      name: 'Normal metric',
      metricType: 'string',
      want: 'Normal metric'
    }
  ];

  tests.forEach(function(test) {
    var got = historian.metrics.typedMetricName(test.metricType, test.name);
    assertEquals('Modified metric name', test.want, got);
    assertEquals('Original metric name', test.name,
        historian.metrics.baseMetric(test.metricType, got));
  });
};


/**
 * Sorts the array by series log source, then name.
 * @param {!Array<!historian.SeriesData>} series
 */
var sortSeries = function(series) {
  series.sort(function(a, b) {
    var sourceDiff = a.source.localeCompare(b.source);
    return sourceDiff ? sourceDiff : a.name.localeCompare(b.name);
  });
};


/**
 * Tests adding and getting series via the data hasher.
 */
var testDataHasher = function() {
  var allSeries = new historian.metrics.DataHasher();

  var kernelBatteryHistory = {
    name: historian.metrics.Csv.KERNEL_WAKESOURCE,
    source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
    type: 'string',
    values: [{startTime: 0, endTime: 10, value: 'test'}],
    cluster: true
  };
  allSeries.add(kernelBatteryHistory);
  assertObjectEquals(kernelBatteryHistory,
      allSeries.getBatteryHistoryData(kernelBatteryHistory.name));

  // Try adding a series that already exists.
  var kernelBatteryHistoryNew = {
    name: kernelBatteryHistory.name,
    source: kernelBatteryHistory.source,
    type: kernelBatteryHistory.type,
    values: [],  // Different values to original series.
    cluster: kernelBatteryHistory.cluster
  };
  allSeries.add(kernelBatteryHistoryNew);
  assertObjectEquals(kernelBatteryHistory,
      allSeries.getBatteryHistoryData(kernelBatteryHistory.name));

  // Add a series from a different log with the same name.
  var kernelTrace = {
    name: historian.metrics.Csv.KERNEL_WAKESOURCE,
    source: historian.historianV2Logs.Sources.KERNEL_TRACE,
    type: 'string',
    values: [],
    cluster: true
  };
  allSeries.add(kernelTrace);
  assertObjectEquals(kernelTrace,
      allSeries.get(kernelTrace.source, kernelTrace.name));

  var wantSeries = [kernelBatteryHistory, kernelTrace];
  var gotSeries = allSeries.getAll();
  sortSeries(wantSeries);
  sortSeries(gotSeries);
  assertArrayEquals(wantSeries, gotSeries);
};
