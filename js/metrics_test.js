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


/**
 * Tests there are no duplicated metrics in the metrics definitions.
 */
var testMetricsUnique = function() {
  var arraysToCheck = [
    historian.metrics.ORDER,
    historian.metrics.HIDDEN_BAR_METRICS_,
    historian.metrics.METRICS_TO_AGGREGATE_,
    historian.metrics.APP_SPECIFIC_METRICS_,
    historian.metrics.UNRELIABLE_METRICS_
  ];
  arraysToCheck.forEach(function(a) {
    var seen = {};
    a.forEach(function(e) {
      assertFalse(a + ': Duplicated metric in order definition: ' + e,
          seen.hasOwnProperty(e));
      seen[e] = true;
    });
  });
};


/**
 * Tests that names for error metrics are generated correctly.
 */
var testErrorMetrics = function() {
  var metric = 'Test metric';
  var expectedErrorMetric = 'Test metric [Error]';
  var gotErrorMetric = historian.metrics.errorMetric(metric);
  assertEquals(gotErrorMetric, expectedErrorMetric);
  assertEquals(historian.metrics.baseMetric(gotErrorMetric), metric);
};
