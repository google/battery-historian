/**
 *
 * Copyright 2015 Google Inc. All Rights Reserved.
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

goog.provide('historian.utilTest');
goog.setTestOnly('historian.utilTest');

goog.require('goog.testing.MockControl');
goog.require('goog.testing.PropertyReplacer');
goog.require('goog.testing.jsunit');
goog.require('historian.util');


var mockControl;
var mockInNonBlankEntry;
var propertyReplacer = new goog.testing.PropertyReplacer();
var _ = goog.testing.mockmatchers.ignoreArgument;

function setUp() {
  mockControl = new goog.testing.MockControl();
  mockIsNonBlankEntry =
      mockControl.createMethodMock(historian.util, 'isNonBlankEntry_');
}

function tearDown() {
  mockControl.$resetAll();
  mockControl.$tearDown();
}

function createTestEntry(arr) {
  return {start_time: arr[0], end_time: arr[1], value: arr[2]};
}

function createTestSeries(values) {
  var processedValues = [];
  values.forEach(function(v) {
    processedValues.push(createTestEntry(v));
  });
  return {
    name: 'test',
    values: processedValues,
    type: 'service',
    index: '0'
  };
}

function createExpectedSeries(values) {
  var processedValues = [];
  values.forEach(function(v) {
    var entry = createTestEntry(v);
    entry['services'] = v[3];
    processedValues.push(entry);
  });
  return processedValues;
}

function testAggregateData() {
  var tests = [
    // Single interval.
    [
      [0, 100, 'service1']
    ],
    // Same interval.
    [
      [0, 100, 'service1'],
      [0, 100, 'service2']
    ],
    // Non overlapping intervals.
    [
      [0, 100, 'service1'],
      [110, 200, 'service2']
    ],
    // End time equals start time of next interval.
    [
      [0, 100, 'service1'],
      [100, 200, 'service2']
    ],
    // Overlapping interval, same start time, earlier end time.
    [
      [0, 100, 'service1'],
      [0, 50, 'service2']
    ],
    // Overlapping interval, same start time, later end time.
    [
      [0, 100, 'service1'],
      [0, 150, 'service2']
    ],
    // Overlapping interval, later start time, earlier end time.
    [
      [0, 100, 'service1'],
      [25, 50, 'service2']
    ],
    // Overlapping interval, later start time, same end time.
    [
      [0, 100, 'service1'],
      [25, 100, 'service2']
    ],
    // Overlapping interval, later start time, later end time.
    [
      [0, 100, 'service1'],
      [25, 150, 'service2']
    ],
    // Nested intervals.
    [
      [0, 100, 'service1'],
      [20, 80, 'service2'],
      [40, 60, 'service3']
    ],
    // Out of order intervals.
    [
      [200, 300, 'service1'],
      [100, 400, 'service2'],
      [150, 500, 'service3']
    ]
  ];
  var expected = [
    [
      [0, 100, 1, ['service1']]
    ],
    [
      [0, 100, 2, ['service1', 'service2']]
    ],
    [
      [0, 100, 1, ['service1']],
      [110, 200, 1, ['service2']]
    ],
    [
      [0, 100, 1, ['service1']],
      [100, 200, 1, ['service2']]
    ],
    [
      [0, 50, 2, ['service1', 'service2']],
      [50, 100, 1, ['service1']]
    ],
    [
      [0, 100, 2, ['service1', 'service2']],
      [100, 150, 1, ['service2']]
    ],
    [
      [0, 25, 1, ['service1']],
      [25, 50, 2, ['service1', 'service2']],
      [50, 100, 1, ['service1']]
    ],
    [
      [0, 25, 1, ['service1']],
      [25, 100, 2, ['service1', 'service2']]
    ],
    [
      [0, 25, 1, ['service1']],
      [25, 100, 2, ['service1', 'service2']],
      [100, 150, 1, ['service2']]
    ],
    [
      [0, 20, 1, ['service1']],
      [20, 40, 2, ['service1', 'service2']],
      [40, 60, 3, ['service1', 'service2', 'service3']],
      [60, 80, 2, ['service1', 'service2']],
      [80, 100, 1, ['service1']]
    ],
    [
      [100, 150, 1, ['service2']],
      [150, 200, 2, ['service2', 'service3']],
      [200, 300, 3, ['service1', 'service2', 'service3']],
      [300, 400, 2, ['service2', 'service3']],
      [400, 500, 1, ['service3']]
    ]
  ];


  var i = 0;
  tests.forEach(function(t) {
    var output = historian.util.aggregateData_(createTestSeries(t));

    var expectedSeries = createExpectedSeries(expected[i]);
    var expectedValues = expectedSeries.sort(compareEntries);

    var same = (output.values.length === expectedValues.length) &&
        output.values.every(function(element, index) {
          return compareServices(element, expectedValues[index]);
        });
    if (!same) {
      console.log('Test ' + i + ' failed. Output was: ');
      console.log(output.values);
      console.log('Expected ');
      console.log(expectedValues);
    }
    i++;
  });
}

function compareServices(e1, e2) {
  if (e1.services.length !== e2.services.length) {
    return false;
  }
  e1.services.sort();
  e2.services.sort();
  for (var i = 0; i < e1.services.length; i++) {
    if (e1.services[i] !== e2.services[i]) {
      return false;
    }
  }
  return (e1.start_time === e2.start_time &&
      e1.end_time === e2.end_time &&
      e1.value === e2.value);
}

function createExpectedClusteredValue(value, count, duration) {
  return {
    'value': value,
    'count': count,
    'duration': duration
  };
}

function createExpectedClusteredValues(values) {
  var clustered = {};
  values.forEach(function(c) {
    clustered[c[2]] = {
      'count': c[0],
      'duration': c[1]
    };
  });
  return clustered;
}

function verifyCluster(expectedEntry, clusteredEntry) {
  assertEquals(expectedEntry.start_time, clusteredEntry.start_time);
  assertEquals(expectedEntry.end_time, clusteredEntry.end_time);
  assertEquals(expectedEntry.clustered_count, clusteredEntry.clustered_count);
  assertEquals(expectedEntry.active_duration, clusteredEntry.active_duration);
  assertObjectEquals(
      expectedEntry.clustered_values, clusteredEntry.clustered_values);
}

function testSimpleCluster() {
  var values = [
    [0, 100, 'service1'],
    [110, 200, 'service2'],
    [3000, 10000, 'service2'],
    [20000, 30000, 'service2'],
    [30100, 30200, 'service3'],
    [101000, 102000, 'service1']
  ];

  var expected = [
    {
      'start_time': 0,
      'end_time': 10000,
      'clustered_count': 3,
      'active_duration': 7190,
      'clustered_values': createExpectedClusteredValues([
        [1, 100, 'service1'],
        [2, 7090, 'service2']
      ])
    },
    // New cluster as entry and previous cluster duration is greater
    // than minDuration
    {
      'start_time': 20000,
      'end_time': 30200,
      'clustered_count': 2,
      'active_duration': 10100,
      'clustered_values': createExpectedClusteredValues([
        [1, 10000, 'service2'],
        [1, 100, 'service3'],
      ])
    },
    {
      'start_time': 101000,
      'end_time': 102000,
      'clustered_count': 1,
      'active_duration': 1000,
      'clustered_values': createExpectedClusteredValues([
        [1, 1000, 'service1'],
      ])
    }
  ];
  var series = [
    createTestSeries(values)
  ];

  mockIsNonBlankEntry(_, _).$returns(true).$times(values.length);
  mockControl.$replayAll();

  var clustered = historian.util.cluster(series, 6000);
  assertEquals(1, clustered.length);
  var clusteredSerie = clustered[0];
  assertEquals(expected.length, clusteredSerie.values.length);

  for (var i = 0; i < expected.length; i++) {
    verifyCluster(clusteredSerie.values[i], expected[i]);
  }
  mockControl.$verifyAll();
}
