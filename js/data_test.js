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

goog.provide('historian.dataTest');
goog.setTestOnly('historian.dataTest');

goog.require('goog.testing.jsunit');
goog.require('historian.data');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');


goog.scope(function() {


// Creates a single entry for a series.
var createTestEntry = function(arr) {
  return {startTime: arr[0], endTime: arr[1], value: arr[2]};
};

// Creates the data for the test series, given an array of arrays,
// each containing the start time, end time and value of an entry.
var createData = function(values) {
  var processedValues = [];
  values.forEach(function(v) {
    processedValues.push(createTestEntry(v));
  });
  return processedValues;
};

var createTestGroup = function(name, series) {
  return {
    name: name,
    index: 0,
    series: [
      series
    ]
  };
};

// Creates the series to be passed to the test, given an array of
// array of values.
var createTestSeries = function(values, cluster) {
  return {
    name: 'test',
    values: createData(values),
    type: 'service',
    cluster: cluster
  };
};

// Creates the aggregated series given an array of arrays of values.
var createAggregatedValues = function(values) {
  var processedValues = [];
  values.forEach(function(v) {
    var entry = createTestEntry(v);
    entry['services'] = v[3];
    processedValues.push(entry);
  });
  return processedValues;
};


/**
 * Tests the aggregating of entries for a series.
 */
window.testAggregateData = function() {
  var tests = [
    {
      desc: 'Single interval',
      series: [
        [0, 100, 'service1']
      ],
      expected: [
        [0, 100, 1,
          [
            historian.data.createAggregatedValue_(0, 'service1')
          ]
        ]
      ]
    },
    {
      desc: 'Same interval',
      series: [
        [0, 100, 'service1'],
        [0, 100, 'service2']
      ],
      expected: [
        [0, 100, 2,
          [
            historian.data.createAggregatedValue_(0, 'service1'),
            historian.data.createAggregatedValue_(1, 'service2')
          ]
        ]
      ]
    },
    {
      desc: 'Non overlapping intervals',
      series: [
        [0, 100, 'service1'],
        [110, 200, 'service2']
      ],
      expected: [
        [0, 100, 1,
          [
           historian.data.createAggregatedValue_(0, 'service1')
          ]
        ],
        [110, 200, 1,
          [
           historian.data.createAggregatedValue_(1, 'service2')
          ]
        ]
      ]
    },
    {
      desc: 'End time equals start time of next interval',
      series: [
        [0, 100, 'service1'],
        [100, 200, 'service2']
      ],
      expected: [
        [0, 100, 1,
          [
           historian.data.createAggregatedValue_(0, 'service1')
          ]
        ],
        [100, 200, 1,
          [
           historian.data.createAggregatedValue_(1, 'service2')
          ]
        ]
      ]
    },
    {
      desc: 'Overlapping interval, same start time, earlier end time',
      series: [
        [0, 100, 'service1'],
        [0, 50, 'service2']
      ],
      expected: [
        [0, 50, 2,
          [
           historian.data.createAggregatedValue_(0, 'service1'),
           historian.data.createAggregatedValue_(1, 'service2')
          ]
        ],
        [50, 100, 1,
          [
           historian.data.createAggregatedValue_(0, 'service1')
          ]
        ]
      ],
    },
    {
      desc: 'Overlapping interval, same start time, later end time',
      series: [
        [0, 100, 'service1'],
        [0, 150, 'service2']
      ],
      expected: [
        [0, 100, 2,
          [
           historian.data.createAggregatedValue_(0, 'service1'),
           historian.data.createAggregatedValue_(1, 'service2')
          ]
        ],
        [100, 150, 1,
          [
           historian.data.createAggregatedValue_(0, 'service2')
          ]
        ]
      ]
    },
    {
      desc: 'Overlapping interval, later start time, earlier end time',
      series: [
        [0, 100, 'service1'],
        [25, 50, 'service2']
      ],
      expected: [
        [0, 25, 1,
          [
           historian.data.createAggregatedValue_(0, 'service1')
          ]
        ],
        [25, 50, 2,
          [
           historian.data.createAggregatedValue_(0, 'service1'),
           historian.data.createAggregatedValue_(1, 'service2')
          ]
        ],
        [50, 100, 1,
          [
           historian.data.createAggregatedValue_(0, 'service1')
          ]
        ]
      ]
    },
    {
      desc: 'Overlapping interval, later start time, same end time',
      series: [
        [0, 100, 'service1'],
        [25, 100, 'service2']
      ],
      expected: [
        [0, 25, 1,
          [
           historian.data.createAggregatedValue_(0, 'service1')
          ]
        ],
        [25, 100, 2,
          [
           historian.data.createAggregatedValue_(1, 'service2')
          ]
        ]
      ]
    },
    {
      desc: 'Overlapping interval, later start time, later end time',
      series: [
        [0, 100, 'service1'],
        [25, 150, 'service2']
      ],
      expected: [
        [0, 25, 1,
          [
           historian.data.createAggregatedValue_(0, 'service1')
          ]
        ],
        [25, 100, 2,
          [
           historian.data.createAggregatedValue_(0, 'service1'),
           historian.data.createAggregatedValue_(1, 'service2')
          ]
        ],
        [100, 150, 1,
          [
           historian.data.createAggregatedValue_(1, 'service2')
          ]
        ]
      ]
    },
    {
      desc: 'Nested intervals',
      series: [
        [0, 100, 'service1'],
        [20, 80, 'service2'],
        [40, 60, 'service3']
      ],
      expected: [
        [0, 20, 1,
          [
           historian.data.createAggregatedValue_(0, 'service1')
          ]
        ],
        [20, 40, 2,
          [
           historian.data.createAggregatedValue_(0, 'service1'),
           historian.data.createAggregatedValue_(1, 'service2')
          ]
        ],
        [40, 60, 3,
          [
           historian.data.createAggregatedValue_(0, 'service1'),
           historian.data.createAggregatedValue_(1, 'service2'),
           historian.data.createAggregatedValue_(3, 'service3')
          ]
        ],
        [60, 80, 2,
          [
           historian.data.createAggregatedValue_(0, 'service1'),
           historian.data.createAggregatedValue_(1, 'service2')
         ]
        ],
        [80, 100, 1,
          [
           historian.data.createAggregatedValue_(0, 'service1')
          ]
        ]
      ]
    },
    {
      desc: 'Duplicate ids, same value for original entries',
      series: [
        [0, 100, 'service1'],
        [75, 150, 'service2'],
        [120, 170, 'service1']
      ],
      expected: [
        [0, 75, 1,
          [
           historian.data.createAggregatedValue_(0, 'service1')
          ]
        ],
        [75, 100, 2,
          [
           historian.data.createAggregatedValue_(0, 'service1'),
           historian.data.createAggregatedValue_(1, 'service2')
          ]
        ],
        [100, 120, 1,
          [
           historian.data.createAggregatedValue_(1, 'service2'),
          ]
        ],
        [120, 150, 2,
          [
           historian.data.createAggregatedValue_(1, 'service2'),
           historian.data.createAggregatedValue_(2, 'service1')
         ]
        ],
        [150, 170, 1,
          [
           historian.data.createAggregatedValue_(2, 'service1')
          ]
        ]
      ]
    },
  ];

  tests.forEach(function(t) {
    var output = historian.data.aggregateData_(createData(t.series));
    var expectedSeries = createAggregatedValues(t.expected);
    var expectedValues = expectedSeries.sort(compareEntries);

    assertEquals(output.length, expectedValues.length);
    output.every(function(element, index) {
      var msg = t.desc + ': Expected ' + JSON.stringify(expectedValues) +
          ', got ' + JSON.stringify(output);
      assertObjectEquals(msg, expectedValues[index], element);
    });
  });
};

var createExpectedClusteredValues = function(values) {
  var clustered = {};
  values.forEach(function(c) {

    clustered[historian.data.ClusterEntry.key_(c[2])] = {
      'count': c[0],
      'duration': c[1],
      'value': c[2],
      'ids': c[3],
      'extra': []
    };
  });
  return clustered;
};

// Compares two clustered entries.
var verifyCluster = function(desc, expectedEntry, clusteredEntry) {
  var expectedText = 'Expected\n' + JSON.stringify(expectedEntry) +
      ' got\n' + JSON.stringify(clusteredEntry) + '\n';
  assertEquals(desc + ' - start time\n' + expectedText,
      expectedEntry.startTime, clusteredEntry.startTime);
  assertEquals(desc + ' - end time\n' + expectedText,
      expectedEntry.endTime, clusteredEntry.endTime);
  assertEquals(desc + ' - clustered count\n' + expectedText,
      expectedEntry.clusteredCount, clusteredEntry.clusteredCount);
  assertEquals(desc + ' - active duration\n' + expectedText,
      expectedEntry.activeDuration, clusteredEntry.activeDuration);
  assertObjectEquals(desc + ' - clustered values\n' + expectedText,
      expectedEntry.clusteredValues, clusteredEntry.clusteredValues);
};


/**
 * Tests the clustering of some entries.
 */
window.testClustering = function() {
  var tests = [
    {
      desc: 'Simple cluster',
      values: [
        [0, 100, 'service1'],
        [110, 200, 'service2'],
        [3000, 10000, 'service2'],
        [20000, 30000, 'service2'],
        [30100, 30200, 'service3'],
        [101000, 102000, 'service1']
      ],
      expected: [
        {
          'startTime': 0,
          'endTime': 10000,
          'clusteredCount': 3,
          'activeDuration': 7190,
          'clusteredValues': createExpectedClusteredValues([
            [1, 100, 'service1', {}],
            [2, 7090, 'service2', {}]
          ])
        },
        // New cluster as entry and previous cluster duration is greater
        // than minDuration
        {
          'startTime': 20000,
          'endTime': 30200,
          'clusteredCount': 2,
          'activeDuration': 10100,
          'clusteredValues': createExpectedClusteredValues([
            [1, 10000, 'service2', {}],
            [1, 100, 'service3', {}],
          ])
        },
        {
          'startTime': 101000,
          'endTime': 102000,
          'clusteredCount': 1,
          'activeDuration': 1000,
          'clusteredValues': createExpectedClusteredValues([
            [1, 1000, 'service1', {}],
          ])
        }
      ],
      cluster: true
    },
    {
      desc: 'Clustering disabled',
      values: [
        [0, 100, 'service1'],
        [110, 200, 'service2'],
        [3000, 10000, 'service2'],
        [20000, 30000, 'service2'],
        [30100, 30200, 'service3']
      ],
      expected: [
        {
          'startTime': 0,
          'endTime': 100,
          'clusteredCount': 1,
          'activeDuration': 100,
          'clusteredValues': createExpectedClusteredValues([
            [1, 100, 'service1', {}]
          ])
        },
        {
          'startTime': 110,
          'endTime': 200,
          'clusteredCount': 1,
          'activeDuration': 90,
          'clusteredValues': createExpectedClusteredValues([
            [1, 90, 'service2', {}]
          ])
        },
        {
          'startTime': 3000,
          'endTime': 10000,
          'clusteredCount': 1,
          'activeDuration': 7000,
          'clusteredValues': createExpectedClusteredValues([
            [1, 7000, 'service2', {}]
          ])
        },
        {
          'startTime': 20000,
          'endTime': 30000,
          'clusteredCount': 1,
          'activeDuration': 10000,
          'clusteredValues': createExpectedClusteredValues([
            [1, 10000, 'service2', {}]
          ])
        },
        {
          'startTime': 30100,
          'endTime': 30200,
          'clusteredCount': 1,
          'activeDuration': 100,
          'clusteredValues': createExpectedClusteredValues([
            [1, 100, 'service3', {}]
          ])
        }
      ],
      cluster: false
    }
  ];
  tests.forEach(function(t) {
    var seriesGroups = [
      createTestGroup('test', createTestSeries(t.values, t.cluster))
    ];
    var clustered = historian.data.cluster(seriesGroups, 6000);
    assertEquals(t.desc, 1, clustered.length);
    var clusteredGroup = clustered[0];
    assertEquals(t.desc, 1, clusteredGroup.series.length);
    var clusteredSeries = clusteredGroup.series[0];
    assertEquals(t.desc, t.expected.length, clusteredSeries.values.length);
    for (var i = 0; i < t.expected.length; i++) {
      verifyCluster(t.desc, clusteredSeries.values[i], t.expected[i]);
    }
  });
};


/**
 * Tests the clustering of an aggregated series.
 */
window.testClusteringAggregated = function() {
  var values = [
    [0, 100, 1, [
      historian.data.createAggregatedValue_(1, 'service1')]
    ],
    [100, 200, 1, [
      historian.data.createAggregatedValue_(1, 'service1')]
    ],
    [100, 300, 1, [
      historian.data.createAggregatedValue_(2, 'service2')]
    ],
  ];
  var expected = [
    {
      'startTime': 0,
      'endTime': 300,
      'clusteredCount': 2,
      'activeDuration': 400,
      'clusteredValues': createExpectedClusteredValues([
        [1, 200, historian.data.createAggregatedValue_(1, 'service1'), {
          1: true
        }],
        [1, 200, historian.data.createAggregatedValue_(2, 'service2'), {
          2: true
        }]
      ])
    }
  ];
  var aggregated = {
    name: 'test',
    type: 'service',
    values: createAggregatedValues(values),
    cluster: true
  };
  var clustered = historian.data.cluster([
    createTestGroup('test', aggregated)
  ], 1000);

  var desc = 'Clustering aggregated values';
  assertEquals(desc, 1, clustered.length);
  var clusteredGroup = clustered[0];
  assertEquals(desc, 1, clusteredGroup.series.length);
  var clusteredSeries = clusteredGroup.series[0];
  assertEquals(desc, expected.length, clusteredSeries.values.length);

  for (var i = 0; i < expected.length; i++) {
    verifyCluster(desc, expected[i], clusteredSeries.values[i]);
  }
};


/**
 * Tests the sampling of entries for a metric.
 */
window.testSampleData = function() {
  var tests = [
    {
      desc: '1 reading per second, should stay the same.',
      values: [
        [1000, 2000, 1],
        [2000, 3000, 2],
        [3000, 4000, 3]
      ],
      expected: [
        [1000, 2000, 1],
        [2000, 3000, 2],
        [3000, 4000, 3]
      ]
    },
    {
      desc: '5 readings per second.',
      values: [
        [1000, 1200, 1],
        [1200, 1400, 2],
        [1400, 1600, 3],
        [1600, 1800, 2],
        [1800, 2000, 1],
        [2000, 2200, 12]
      ],
      expected: [
        [1000, 2000, 3],
        [2000, 2200, 12]
      ]
    }
  ];

  tests.forEach(function(t) {
    var data = createData(t.values);

    var output = historian.data.sampleData(data);
    var expected = createData(t.expected);

    var same = (output.length === expected.length) &&
        output.every(function(element, index) {
          return element.value == expected[index].value;
        });
    assertTrue(t.desc + ': Expected ' + JSON.stringify(expected) +
        ', got ' + JSON.stringify(output), same);
  });
};

// Creates all the entries for the running series,
// given an array of arrays of values.
var createExpectedKernelUptimeEntries = function(values) {
  var processedValues = [];
  values.forEach(function(v) {
    var entry = createKernelUptimeTestEntry(v);
    processedValues.push(entry);
  });
  return processedValues;
};

// Creates a single entry for the running series,
// given an array of values.
var createKernelUptimeTestEntry = function(arr) {
  return {
    startTime: arr[0],
    endTime: arr[1],
    value: {
      wakeReason: arr[2],
      wakelockCategory: arr[3]
    }
  };
};


/**
 * Tests whether running entries are correctly categorized as with wakelocks or
 * without wakelocks.
 */
window.testCategorizeRunning = function() {
  var none = 'No wakeup reason';
  var tests = [
    {
      desc: 'Wakelock starts before start of running entry',
      running: [
        [100, 200, '100~wr']
      ],
      wakelocks: [
        [0, 150, 'service1']
      ],
      expected: [
        [150, 200, none, historian.metrics.KERNEL_UPTIME_WITH_USERSPACE]
      ]
    },
    {
      desc: 'Wakelock starts in middle of running entry',
      running: [
        [0, 100, '0~wr']
      ],
      wakelocks: [
        [50, 100, 'service1']
      ],
      expected: [
        [0, 50, 'wr', historian.metrics.KERNEL_UPTIME_WITH_USERSPACE]
      ]
    },
    {
      desc: 'Wakelock starts before and ends after running entry.',
      running: [
        [50, 100, '50~wr']
      ],
      wakelocks: [
        [0, 200, 'service1']
      ],
      expected: [
      ]
    },
    {
      desc: 'Wakelock intersects with multiple running entries',
      running: [
        [50, 100, '50~wr1'],
        [200, 300, '200~wr2']
      ],
      wakelocks: [
        [75, 250, 'service1']
      ],
      expected: [
        [50, 75, 'wr1', historian.metrics.KERNEL_UPTIME_WITH_USERSPACE],
        [250, 300, none, historian.metrics.KERNEL_UPTIME_WITH_USERSPACE]
      ]
    },
    {
      desc: 'Multiple intersecting wakelocks',
      running: [
        [0, 100, '0~wr']
      ],
      wakelocks: [
        [0, 25, 'service1'],
        [60, 70, 'service2'],
        [90, 300, 'service3'],
      ],
      expected: [
        [25, 60, none, historian.metrics.KERNEL_UPTIME_WITH_USERSPACE],
        [70, 90, none, historian.metrics.KERNEL_UPTIME_WITH_USERSPACE]
      ]
    },
    {
      desc: 'Non intersecting wakelocks',
      running: [
        [100, 200, '100~wr']
      ],
      wakelocks: [
        [0, 100, 'service1'],
        [50, 100, 'service2'],
        [200, 300, 'service3']
      ],
      expected: [
        [100, 200, 'wr', historian.metrics.KERNEL_UPTIME_NO_USERSPACE]
      ]
    },
    {
      desc: 'Edge case - wakelock ends at same time as running entry',
      running: [
        [100, 200, '100~wr1'],
        [200, 400, '200~wr2']
      ],
      wakelocks: [
        [100, 200, 'service1'],
        [300, 400, 'service2']
      ],
      expected: [
        [200, 300, 'wr2', historian.metrics.KERNEL_UPTIME_WITH_USERSPACE]
      ]
    },
    {
      desc: 'No wakelocks',
      running: [
        [100, 200, '100~wr1|15~wr2'],
        [200, 400, '200~wr2']
      ],
      wakelocks: [
      ],
      expected: [
        [100, 200, 'wr1', historian.metrics.KERNEL_UPTIME_NO_USERSPACE],
        [200, 400, 'wr2', historian.metrics.KERNEL_UPTIME_NO_USERSPACE],
      ]
    }
  ];

  tests.forEach(function(t) {
    var running = createTestSeries(t.running);
    running.name = historian.metrics.Csv.CPU_RUNNING;
    running.type = 'string';
    var runningValues = historian.data.splitRunningValues_(running);

    var wakelocks = createData(t.wakelocks);

    var aggregatedWakelocks = historian.data.aggregateData_(wakelocks);
    var output =
        historian.data.categorizeRunning(runningValues, aggregatedWakelocks);
    var expectedValues = createExpectedKernelUptimeEntries(t.expected);

    var same = (output.length === expectedValues.length) &&
        output.every(function(element, index) {
          return compareKernelUptimeEntries(element, expectedValues[index]);
        });

    assertTrue(t.desc + ': Expected ' + JSON.stringify(expectedValues) +
        ', got ' + JSON.stringify(output), same);
  });
};

// Compares whether two entries for the kernel uptime metric are equal.
var compareKernelUptimeEntries = function(e1, e2) {
  return (e1.startTime == e2.startTime) &&
      (e1.endTime == e2.endTime) &&
      (e1.value.wakeReason == e2.value.wakeReason) &&
      (e1.value.wakelockCategory == e2.value.wakelockCategory);
};


/**
 * Tests whether running entries are correctly categorized as with wakelocks or
 * without wakelocks.
 */
window.testSplitRunningValues = function() {
  var tests = [
    {
      desc: 'Unknown wakeup reason for running entry',
      running: [
        [100, 200, '200~Unknown wakeup reason']
      ],
      expected: [
        [100, 200, 1,
          [
            historian.data.createRunningValue_(
                100, 200, 'Unknown wakeup reason')
          ]
        ]
      ]
    },
    {
      desc: 'Empty wakeup reason',
      running: [
        [100, 200, '200~']
      ],
      expected: [
        [100, 200, 1,
          [
            historian.data.createRunningValue_(
                100, 200, '')
          ]
        ]
      ]
    },
    {
      desc: 'Multiple wakeup reasons',
      running: [
        [
         1000,
         4000,
         '2000~Abort:Pending Wakeup Sources: ipc00000177_FLP Service Cal |' +
         '2500~Abort:Pending Wakeup Sources: sh2ap_wakelock |' +
         '3500~Abort:Some devices failed to suspend|' +
         '4500~Abort:Pending Wakeup Sources: sh2ap_wakelock '
        ]
      ],
      expected: [
        [1000, 4000, 4,
          [
            historian.data.createRunningValue_(1000, 2000,
                'Abort:Pending Wakeup Sources: ipc00000177_FLP Service Cal '),
            historian.data.createRunningValue_(2000, 2500,
                'Abort:Pending Wakeup Sources: sh2ap_wakelock '),
            historian.data.createRunningValue_(2500, 3500,
                'Abort:Some devices failed to suspend'),
            historian.data.createRunningValue_(3500, 4500,
                'Abort:Pending Wakeup Sources: sh2ap_wakelock ')
          ]
        ]
      ]
    }
  ];

  tests.forEach(function(t) {
    var running = createTestSeries(t.running, true);
    running.name = historian.metrics.Csv.CPU_RUNNING;
    running.type = 'string';

    var expectedValues = createAggregatedValues(t.expected);

    var output = historian.data.splitRunningValues_(running);
    assertEquals(output.length, expectedValues.length);
    output.every(function(element, index) {
      var msg = t.desc + ': Expected ' + JSON.stringify(expectedValues) +
          ', got ' + JSON.stringify(output);
      assertObjectEquals(msg, expectedValues[index], element);
    });
  });
};
});  // goog.scope
