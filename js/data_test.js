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

goog.module('historian.dataTest');
goog.setTestOnly('historian.dataTest');

var Csv = goog.require('historian.metrics.Csv');
goog.require('goog.testing.jsunit');
var data = goog.require('historian.data');
var metrics = goog.require('historian.metrics');
var testSuite = goog.require('goog.testing.testSuite');
var testUtils = goog.require('historian.testUtils');


/**
 * Creates a SeriesGroup.
 * @param {string} name The name for the group.
 * @param {!historian.SeriesData} series
 * @return {!historian.SeriesGroup}
 */
var createTestGroup = function(name, series) {
  return {
    name: name,
    index: 0,
    series: [
      series
    ]
  };
};


/**
 * Creates the series to be passed to the test, given an array of
 * array of values.
 * @param {!Array<!Array<!historian.Value|!historian.AggregatedValue>>} values
 * @param {boolean} cluster Clustering option set for series.
 * @param {string=} opt_name Optional name for the series.
 * @param {string=} opt_type Optional type for the series.
 * @return {!historian.SeriesData}
 */
var createTestSeries = function(values, cluster, opt_name, opt_type) {
  return {
    name: opt_name || 'test',
    values: testUtils.createData(values),
    type: opt_type || 'service',
    cluster: cluster
  };
};


/**
 * Creates the aggregated series given an array of arrays of values.
 * @param {!Array<!Array<number|!historian.AggregatedEntryValue>>} values
 * @return {!Array<!historian.AggregatedEntry>}
 */
var createAggregatedValues = function(values) {
  return values.map(function(v) {
    var entry = testUtils.createTestEntry(v);
    entry['services'] = v[3];
    return entry;
  });
};


/**
 * Creates the expected values for a cluster.
 * @param {!Array<!Array<number|string|!Object>>} clusterValues Each array
 *     contains details for a value in the cluster: count, duration, key,
 *     value, ids.
 * @return {!Object<!ClusterEntryValue>} Values for the cluster.
 */
var createExpectedClusteredValues = function(clusterValues) {
  var clustered = {};
  clusterValues.forEach(function(value) {
    clustered[data.ClusterEntry.key_(value[2])] = {
      'count': value[0],
      'duration': value[1],
      'value': value[2],
      'ids': value[3],
      'extra': []
    };
  });
  return clustered;
};


/**
 * @typedef {{
 *   startTime: number,
 *   endTime: number,
 *   clusteredCount: number,
 *   activeDuration: number,
 *   clusteredValues: !Object<!ClusterEntryValue>
 * }}
 */
var ExpectedClusterEntry;


/**
 * Compares the clustered entry with the expected entry.
 * @param {string} desc Description for the test case.
 * @param {!ExpectedClusterEntry} expectedEntry
 * @param {!historian.data.ClusterEntry} clusteredEntry
 */
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
 * Creates all the entries for the kernel uptime series.
 * @param {!Array<!Array<string|number>>} values Each array contains
 *     the start time, end time, wakeup reason and wakelock category for
 *     a kernel uptime entry.
 * @return {!Array<!historian.Entry>}
 */
var createExpectedKernelUptimeEntries = function(values) {
  return values.map(function(value) {
    return {
      startTime: value[0],
      endTime: value[1],
      value: {
        wakeReason: value[2],
        wakelockCategory: value[3]
      }
    };
  });
};


testSuite({
  /**
   * Tests the aggregating of entries for a series.
   */
  testAggregateData: function() {
    var tests = [
      {
        desc: 'Single interval',
        series: [
          [0, 100, 'service1']
        ],
        expected: [
          [0, 100, 1,
            [
              data.createAggregatedValue_(0, 'service1')
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
              data.createAggregatedValue_(0, 'service1'),
              data.createAggregatedValue_(1, 'service2')
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
             data.createAggregatedValue_(0, 'service1')
            ]
          ],
          [110, 200, 1,
            [
             data.createAggregatedValue_(1, 'service2')
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
             data.createAggregatedValue_(0, 'service1')
            ]
          ],
          [100, 200, 1,
            [
             data.createAggregatedValue_(1, 'service2')
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
             data.createAggregatedValue_(0, 'service1'),
             data.createAggregatedValue_(1, 'service2')
            ]
          ],
          [50, 100, 1,
            [
             data.createAggregatedValue_(0, 'service1')
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
             data.createAggregatedValue_(0, 'service1'),
             data.createAggregatedValue_(1, 'service2')
            ]
          ],
          [100, 150, 1,
            [
             data.createAggregatedValue_(0, 'service2')
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
             data.createAggregatedValue_(0, 'service1')
            ]
          ],
          [25, 50, 2,
            [
             data.createAggregatedValue_(0, 'service1'),
             data.createAggregatedValue_(1, 'service2')
            ]
          ],
          [50, 100, 1,
            [
             data.createAggregatedValue_(0, 'service1')
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
             data.createAggregatedValue_(0, 'service1')
            ]
          ],
          [25, 100, 2,
            [
             data.createAggregatedValue_(1, 'service2')
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
             data.createAggregatedValue_(0, 'service1')
            ]
          ],
          [25, 100, 2,
            [
             data.createAggregatedValue_(0, 'service1'),
             data.createAggregatedValue_(1, 'service2')
            ]
          ],
          [100, 150, 1,
            [
             data.createAggregatedValue_(1, 'service2')
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
             data.createAggregatedValue_(0, 'service1')
            ]
          ],
          [20, 40, 2,
            [
             data.createAggregatedValue_(0, 'service1'),
             data.createAggregatedValue_(1, 'service2')
            ]
          ],
          [40, 60, 3,
            [
             data.createAggregatedValue_(0, 'service1'),
             data.createAggregatedValue_(1, 'service2'),
             data.createAggregatedValue_(3, 'service3')
            ]
          ],
          [60, 80, 2,
            [
             data.createAggregatedValue_(0, 'service1'),
             data.createAggregatedValue_(1, 'service2')
           ]
          ],
          [80, 100, 1,
            [
             data.createAggregatedValue_(0, 'service1')
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
             data.createAggregatedValue_(0, 'service1')
            ]
          ],
          [75, 100, 2,
            [
             data.createAggregatedValue_(0, 'service1'),
             data.createAggregatedValue_(1, 'service2')
            ]
          ],
          [100, 120, 1,
            [
             data.createAggregatedValue_(1, 'service2'),
            ]
          ],
          [120, 150, 2,
            [
             data.createAggregatedValue_(1, 'service2'),
             data.createAggregatedValue_(2, 'service1')
           ]
          ],
          [150, 170, 1,
            [
             data.createAggregatedValue_(2, 'service1')
            ]
          ]
        ]
      },
    ];

    tests.forEach(function(t) {
      var output = data.aggregateData_(testUtils.createData(t.series));
      var expectedSeries = createAggregatedValues(t.expected);
      var expectedValues = expectedSeries.sort(compareEntries);

      assertEquals(output.length, expectedValues.length);
      output.every(function(element, index) {
        var msg = t.desc + ': Expected ' + JSON.stringify(expectedValues) +
            ', got ' + JSON.stringify(output);
        assertObjectEquals(msg, expectedValues[index], element);
      });
    });
  },
  /**
   * Tests the clustering of some entries.
   */
  testClustering: function() {
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
      var clustered = data.cluster(seriesGroups, 6000);
      assertEquals(t.desc, 1, clustered.length);
      var clusteredGroup = clustered[0];
      assertEquals(t.desc, 1, clusteredGroup.series.length);
      var clusteredSeries = clusteredGroup.series[0];
      assertEquals(t.desc, t.expected.length, clusteredSeries.values.length);
      for (var i = 0; i < t.expected.length; i++) {
        verifyCluster(t.desc, clusteredSeries.values[i], t.expected[i]);
      }
    });
  },
  /**
   * Tests the clustering of an aggregated series.
   */
  testClusteringAggregated: function() {
    var values = [
      [0, 100, 1, [
        data.createAggregatedValue_(1, 'service1')]
      ],
      [100, 200, 1, [
        data.createAggregatedValue_(1, 'service1')]
      ],
      [100, 300, 1, [
        data.createAggregatedValue_(2, 'service2')]
      ],
    ];
    var expected = [
      {
        'startTime': 0,
        'endTime': 300,
        'clusteredCount': 2,
        'activeDuration': 400,
        'clusteredValues': createExpectedClusteredValues([
          [1, 200, data.createAggregatedValue_(1, 'service1'), {
            1: true
          }],
          [1, 200, data.createAggregatedValue_(2, 'service2'), {
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
    var clustered = data.cluster([
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
  },
  /**
   * Tests that clustering a running entry increases the cluster count by only
   * one despite having multiple service entries.
   */
  testRunningClusteredCount: function() {
    var csv =
        'metric,type,start_time,end_time,value,opt\n' +
        'CPU running,service,1000,5000,1000~wr1|2000~wr2|3000~wr3,\n';
    var testData = data.processHistorianV2Data(csv, 2300, {}, '', true);

    var runningGroup = testData.nameToBarGroup[Csv.CPU_RUNNING];
    assertNotNull(runningGroup);

    var clustered = data.cluster([runningGroup]);
    assertEquals('expected one cluster group', 1, clustered.length);
    var clusteredGroup = clustered[0];
    assertEquals(
        'expected one cluster in group', 1, clusteredGroup.series.length);
    var clusteredSeries = clusteredGroup.series[0];
    assertEquals('expected one cluster', 1, clusteredSeries.values.length);
    var cluster = clusteredSeries.values[0];
    assertEquals('expected single cluster count', 1, cluster.clusteredCount);
  },
  /**
   * Tests the sampling of entries for a metric.
   */
  testSampleData: function() {
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
      var testData = testUtils.createData(t.values);

      var output = data.sampleData(testData);
      var expected = testUtils.createData(t.expected);

      var same = (output.length === expected.length) &&
          output.every(function(element, index) {
            return element.value == expected[index].value;
          });
      assertTrue(t.desc + ': Expected ' + JSON.stringify(expected) +
          ', got ' + JSON.stringify(output), same);
    });
  },
  /**
   * Tests whether running entries are correctly categorized as
   * "with wakelocks" or "without wakelocks".
   */
  testCategorizeRunning: function() {
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
          [150, 200, none, metrics.KERNEL_UPTIME_WITH_USERSPACE]
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
          [0, 50, 'wr', metrics.KERNEL_UPTIME_WITH_USERSPACE]
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
          [50, 75, 'wr1', metrics.KERNEL_UPTIME_WITH_USERSPACE],
          [250, 300, none, metrics.KERNEL_UPTIME_WITH_USERSPACE]
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
          [25, 60, none, metrics.KERNEL_UPTIME_WITH_USERSPACE],
          [70, 90, none, metrics.KERNEL_UPTIME_WITH_USERSPACE]
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
          [100, 200, 'wr', metrics.KERNEL_UPTIME_NO_USERSPACE]
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
          [200, 300, 'wr2', metrics.KERNEL_UPTIME_WITH_USERSPACE]
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
          [100, 200, 'wr1', metrics.KERNEL_UPTIME_NO_USERSPACE],
          [200, 400, 'wr2', metrics.KERNEL_UPTIME_NO_USERSPACE],
        ]
      }
    ];

    tests.forEach(function(t) {
      var running = createTestSeries(t.running, Csv.CPU_RUNNING, 'string');
      var runningValues = data.splitRunningValues_(running);

      var wakelocks = testUtils.createData(t.wakelocks);

      var aggregatedWakelocks = data.aggregateData_(wakelocks);
      var output =
          data.categorizeRunning(runningValues, aggregatedWakelocks);
      var expectedValues = createExpectedKernelUptimeEntries(t.expected);
      assertArrayEquals(t.desc, expectedValues, output);
    });
  },
  /**
   * Tests whether the wakeup reasons in running entries are split correctly.
   */
  testSplitRunningValues: function() {
    var tests = [
      {
        desc: 'Unknown wakeup reason for running entry',
        running: [
          [100, 200, '200~Unknown wakeup reason']
        ],
        expected: [
          [100, 200, 1,
            [
              data.createRunningValue_(
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
              data.createRunningValue_(
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
              data.createRunningValue_(1000, 2000,
                  'Abort:Pending Wakeup Sources: ipc00000177_FLP Service Cal '),
              data.createRunningValue_(2000, 2500,
                  'Abort:Pending Wakeup Sources: sh2ap_wakelock '),
              data.createRunningValue_(2500, 3500,
                  'Abort:Some devices failed to suspend'),
              data.createRunningValue_(3500, 4500,
                  'Abort:Pending Wakeup Sources: sh2ap_wakelock ')
            ]
          ]
        ]
      }
    ];

    tests.forEach(function(t) {
      var running =
          createTestSeries(t.running, true, Csv.CPU_RUNNING, 'string');

      var expectedValues = createAggregatedValues(t.expected);
      var output = data.splitRunningValues_(running);
      assertArrayEquals(t.desc, expectedValues, output);
    });
  },
  /**
   * Tests the adding of the unavailable series for groups specified in the
   * groupToLogStart, where the first seen log time is later than the bug
   * report time.
   */
  testAddUnavailableSeries: function() {
    // Report start time is 4000.
    var csv = [
      'metric,type,start_time,end_time,value,opt',
      'Wifi running,bool,4000,10000,true,',
      'AM Low Memory,service,7000,8000,20,',
      'ANR,service,9000,10000,2103~com.google.test~-flag~reason~,',
      'Crashes,service,8000,9000,com.google.test,1',
    ].join('\n');

    var groupToLogStart = {};
    groupToLogStart[Csv.CRASHES] = 2000;  // Before report start time.
    groupToLogStart[Csv.AM_LOW_MEMORY_ANR] = 5000;  // After report start time.
    groupToLogStart['Group not in csv'] = 1000;  // Shouldn't actually happen.

    var result =
        data.processHistorianV2Data(csv, 2300, {}, '', true, groupToLogStart);

    var wantGroups = [Csv.AM_LOW_MEMORY_ANR, Csv.CRASHES, Csv.WIFI_RUNNING];
    var gotGroups = Object.keys(result.nameToBarGroup);
    assertArrayEquals(wantGroups.sort(), gotGroups.sort());

    assertEquals('Log start before report start, no UNAVAILABLE series added',
        1, result.nameToBarGroup[Csv.CRASHES].series.length);

    var lowMemoryAnrGroup = result.nameToBarGroup[Csv.AM_LOW_MEMORY_ANR];
    assertEquals('Log start after report start, expected UNAVAILABLE series',
        3, lowMemoryAnrGroup.series.length);

    // Check that the first series in the Low Memory/ANR group matches the
    // expected UNAVAILABLE series.
    var gotSeries = lowMemoryAnrGroup.series[0];
    assertEquals(1, gotSeries.values.length);
    assertEquals(metrics.UNAVAILABLE_TYPE, gotSeries.type);
    assertEquals('Report start time', 4000, gotSeries.values[0].startTime);
    assertEquals('Log start time', 5000, gotSeries.values[0].endTime);
  }
});
