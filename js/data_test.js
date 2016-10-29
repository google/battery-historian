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
var historianV2Logs = goog.require('historian.historianV2Logs');
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
          {
            startTime: 0,
            endTime: 100,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          }
        ]
      },
      {
        desc: 'Same interval',
        series: [
          [0, 100, 'service1'],
          [0, 100, 'service2']
        ],
        expected: [
          {
            startTime: 0,
            endTime: 100,
            services: [
              {startTime: 0, endTime: 100, value: 'service1', id: 0},
              {startTime: 0, endTime: 100, value: 'service2', id: 1}
            ]
          }
        ]
      },
      {
        desc: 'Non overlapping intervals',
        series: [
          [0, 100, 'service1'],
          [110, 200, 'service2']
        ],
        expected: [
          {
            startTime: 0,
            endTime: 100,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          },
          {
            startTime: 110,
            endTime: 200,
            services: [{startTime: 110, endTime: 200, value: 'service2', id: 1}]
          }
        ]
      },
      {
        desc: 'End time equals start time of next interval',
        series: [
          [0, 100, 'service1'],
          [100, 200, 'service2']
        ],
        expected: [
          {
            startTime: 0,
            endTime: 100,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          },
          {
            startTime: 100,
            endTime: 200,
            services: [{startTime: 100, endTime: 200, value: 'service2', id: 1}]
          }
        ]
      },
      {
        desc: 'Overlapping interval, same start time, earlier end time',
        series: [
          [0, 100, 'service1'],
          [0, 50, 'service2']
        ],
        expected: [
          {
            startTime: 0,
            endTime: 50,
            services: [
              {startTime: 0, endTime: 100, value: 'service1', id: 0},
              {startTime: 0, endTime: 50, value: 'service2', id: 1}
            ]
          },
          {
            startTime: 50,
            endTime: 100,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          }
        ],
      },
      {
        desc: 'Overlapping interval, same start time, later end time',
        series: [
          [0, 100, 'service1'],
          [0, 150, 'service2']
        ],
        expected: [
          {
            startTime: 0,
            endTime: 100,
            services: [
              {startTime: 0, endTime: 100, value: 'service1', id: 0},
              {startTime: 0, endTime: 150, value: 'service2', id: 1}
            ]
          },
          {
            startTime: 100,
            endTime: 150,
            services: [{startTime: 0, endTime: 150, value: 'service2', id: 1}]
          }
        ]
      },
      {
        desc: 'Overlapping interval, later start time, earlier end time',
        series: [
          [0, 100, 'service1'],
          [25, 50, 'service2']
        ],
        expected: [
          {
            startTime: 0,
            endTime: 25,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          },
          {
            startTime: 25,
            endTime: 50,
            services: [
              {startTime: 0, endTime: 100, value: 'service1', id: 0},
              {startTime: 25, endTime: 50, value: 'service2', id: 1}
            ]
          },
          {
            startTime: 50,
            endTime: 100,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          }
        ]
      },
      {
        desc: 'Overlapping interval, later start time, same end time',
        series: [
          [0, 100, 'service1'],
          [25, 100, 'service2']
        ],
        expected: [
          {
            startTime: 0,
            endTime: 25,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          },
          {
            startTime: 25,
            endTime: 100,
            services: [
              {startTime: 0, endTime: 100, value: 'service1', id: 0},
              {startTime: 25, endTime: 100, value: 'service2', id: 1}
            ]
          }
        ]
      },
      {
        desc: 'Overlapping interval, later start time, later end time',
        series: [
          [0, 100, 'service1'],
          [25, 150, 'service2']
        ],
        expected: [
          {
            startTime: 0,
            endTime: 25,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          },
          {
            startTime: 25,
            endTime: 100,
            services: [
              {startTime: 0, endTime: 100, value: 'service1', id: 0},
              {startTime: 25, endTime: 150, value: 'service2', id: 1}
            ]
          },
          {
            startTime: 100,
            endTime: 150,
            services: [{startTime: 25, endTime: 150, value: 'service2', id: 1}]
          }
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
          {
            startTime: 0,
            endTime: 20,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          },
          {
            startTime: 20,
            endTime: 40,
            services: [
              {startTime: 0, endTime: 100, value: 'service1', id: 0},
              {startTime: 20, endTime: 80, value: 'service2', id: 1}
            ]
          },
          {
            startTime: 40,
            endTime: 60,
            services: [
              {startTime: 0, endTime: 100, value: 'service1', id: 0},
              {startTime: 20, endTime: 80, value: 'service2', id: 1},
              {startTime: 40, endTime: 60, value: 'service3', id: 2}
            ]
          },
          {
            startTime: 60,
            endTime: 80,
            services: [
              {startTime: 0, endTime: 100, value: 'service1', id: 0},
              {startTime: 20, endTime: 80, value: 'service2', id: 1}
            ]
          },
          {
            startTime: 80,
            endTime: 100,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          }
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
          {
            startTime: 0,
            endTime: 75,
            services: [{startTime: 0, endTime: 100, value: 'service1', id: 0}]
          },
          {
            startTime: 75,
            endTime: 100,
            services: [
              {startTime: 0, endTime: 100, value: 'service1', id: 0},
              {startTime: 75, endTime: 150, value: 'service2', id: 1}
            ]
          },
          {
            startTime: 100,
            endTime: 120,
            services: [{startTime: 75, endTime: 150, value: 'service2', id: 1}]
          },
          {
            startTime: 120,
            endTime: 150,
            services: [
              {startTime: 75, endTime: 150, value: 'service2', id: 1},
              {startTime: 120, endTime: 170, value: 'service1', id: 2}
            ]
          },
          {
            startTime: 150,
            endTime: 170,
            services: [
              {startTime: 120, endTime: 170, value: 'service1', id: 2}
            ]
          }
        ]
      },
    ];

    tests.forEach(function(t) {
      var output = data.aggregateData_(testUtils.createData(t.series));
      var expectedValues = t.expected.sort(compareEntries);

      assertEquals(output.length, expectedValues.length);
      output.forEach(function(element, index) {
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
          [0, 100, 's1'],
          [110, 200, 's2'],
          [3000, 10000, 's2'],
          [20000, 30000, 's2'],
          [30100, 30200, 's3'],
          [101000, 102000, 's1']
        ],
        expected: [
          {
            startTime: 0,
            endTime: 10000,
            clusteredCount: 3,
            activeDuration: 7190,
            clusteredValues: {
              [JSON.stringify('s1')]: {
                count: 1, duration: 100, value: 's1', ids: {}, extra: []
              },
              [JSON.stringify('s2')]: {
                count: 2, duration: 7090, value: 's2', ids: {}, extra: []
              }
            }
          },
          // New cluster as entry and previous cluster duration is greater
          // than minDuration
          {
            startTime: 20000,
            endTime: 30200,
            clusteredCount: 2,
            activeDuration: 10100,
            clusteredValues: {
              [JSON.stringify('s2')]: {
                count: 1, duration: 10000, value: 's2', ids: {}, extra: []
              },
              [JSON.stringify('s3')]: {
                count: 1, duration: 100, value: 's3', ids: {}, extra: []
              }
            }
          },
          {
            startTime: 101000,
            endTime: 102000,
            clusteredCount: 1,
            activeDuration: 1000,
            clusteredValues: {
              [JSON.stringify('s1')]: {
                count: 1, duration: 1000, value: 's1', ids: {}, extra: []
              }
            }
          }
        ],
        cluster: true
      },
      {
        desc: 'Clustering disabled',
        values: [
          [0, 100, 's1'],
          [110, 200, 's2'],
          [3000, 10000, 's2'],
          [20000, 30000, 's2'],
          [30100, 30200, 's3']
        ],
        expected: [
          {
            startTime: 0,
            endTime: 100,
            clusteredCount: 1,
            activeDuration: 100,
            clusteredValues: {
              [JSON.stringify('s1')]: {
                count: 1, duration: 100, value: 's1', ids: {}, extra: []
              }
            }
          },
          {
            startTime: 110,
            endTime: 200,
            clusteredCount: 1,
            activeDuration: 90,
            clusteredValues: {
              [JSON.stringify('s2')]: {
                count: 1, duration: 90, value: 's2', ids: {}, extra: []
              }
            }
          },
          {
            startTime: 3000,
            endTime: 10000,
            clusteredCount: 1,
            activeDuration: 7000,
            clusteredValues: {
              [JSON.stringify('s2')]: {
                count: 1, duration: 7000, value: 's2', ids: {}, extra: []
              }
            }
          },
          {
            startTime: 20000,
            endTime: 30000,
            clusteredCount: 1,
            activeDuration: 10000,
            clusteredValues: {
              [JSON.stringify('s2')]: {
                count: 1, duration: 10000, value: 's2', ids: {}, extra: []
              }
            }
          },
          {
            startTime: 30100,
            endTime: 30200,
            clusteredCount: 1,
            activeDuration: 100,
            clusteredValues: {
              [JSON.stringify('s3')]: {
                count: 1, duration: 100, value: 's3', ids: {}, extra: []
              }
            }
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
      {
        startTime: 0,
        endTime: 100,
        services: [{startTime: 0, endTime: 100, value: 's1', id: 1}]
      },
      {
        startTime: 100,
        endTime: 200,
        services: [{startTime: 100, endTime: 200, value: 's1', id: 1}]
      },
      {
        startTime: 100,
        endTime: 300,
        services: [{startTime: 100, endTime: 300, value: 's2', id: 2}]
      }
    ];
    var expected = [
      {
        startTime: 0,
        endTime: 300,
        firstEntryEndTime: 100,
        clusteredCount: 2,
        activeDuration: 400,
        clusteredValues: {
          [JSON.stringify('s1')]: {
            // Since both s1 entries had ID 1, they are only counted once.
            count: 1, duration: 200, value: 's1', ids: {1: true}, extra: []
          },
          [JSON.stringify('s2')]: {
            count: 1, duration: 200, value: 's2', ids: {2: true}, extra: []
          }
        }
      }
    ];
    var aggregated = {
      name: 'test',
      type: 'service',
      values: values,
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
    var logs = [{source: historianV2Logs.Sources.BATTERY_HISTORY, csv: csv}];
    var testData = data.processHistorianV2Data(logs, 2300, {}, '', true);

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
          [100, 200, '200~Unknown']
        ],
        expected: [
          {
            startTime: 100,
            endTime: 200,
            services: [{startTime: 100, endTime: 200, value: 'Unknown'}]
          }
        ]
      },
      {
        desc: 'Empty wakeup reason',
        running: [
          [100, 200, '200~']
        ],
        expected: [
          {
            startTime: 100,
            endTime: 200,
            services: [{startTime: 100, endTime: 200, value: ''}]
          }
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
          {
            startTime: 1000,
            endTime: 4000,
            services: [
              {
                startTime: 1000,
                endTime: 2000,
                value:
                    'Abort:Pending Wakeup Sources: ipc00000177_FLP Service Cal '
              },
              {
                startTime: 2000,
                endTime: 2500,
                value: 'Abort:Pending Wakeup Sources: sh2ap_wakelock '
              },
              {
                startTime: 2500,
                endTime: 3500,
                value: 'Abort:Some devices failed to suspend'
              },
              {
                startTime: 3500,
                endTime: 4500,
                value: 'Abort:Pending Wakeup Sources: sh2ap_wakelock '
              }
            ]
          }
        ]
      }
    ];

    tests.forEach(function(t) {
      var running =
          createTestSeries(t.running, true, Csv.CPU_RUNNING, 'string');

      var output = data.splitRunningValues_(running);
      assertArrayEquals(t.desc, t.expected, output);
    });
  },
  /**
   * Tests the adding of the unavailable series for groups specified in the
   * groupToLogStart, where the first seen log time is later than the bug
   * report time.
   */
  testAddUnavailableSeries: function() {
    // Report start time is 4000.
    var batteryHistory = [
      'metric,type,start_time,end_time,value,opt',
      'Wifi running,bool,4000,10000,true,'
    ].join('\n');

    var eventLog = [
      'metric,type,start_time,end_time,value,opt',
      'AM Low Memory,service,7000,8000,20,',
      'ANR,service,9000,10000,"2103,com.google.test,-flag,reason,",'
    ].join('\n');

    var logcat = [
      'metric,type,start_time,end_time,value,opt',
      'Crashes,service,8000,9000,com.google.test,1'
    ].join('\n');

    var logs = [
      {
        source: historianV2Logs.Sources.BATTERY_HISTORY,
        csv: batteryHistory
      },
      // Begins after report start time.
      {
        source: historianV2Logs.Sources.EVENT_LOG,
        csv: eventLog,
        startMs: 5000
      },
      // Begins before report start time.
      {
        source: historianV2Logs.Sources.LOGCAT,
        csv: logcat,
        startMs: 2000
      }
    ];
    var result = data.processHistorianV2Data(logs, 2300, {}, '', true);

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
  },
  /**
   * Tests whether events of aggregated series are merged correctly.
   */
  testMergeSplitEntries() {
    var tests = [
      {
        desc: 'Event has been split up multiple times',
        eventsToMerge: [
          {
            startTime: 0,
            endTime: 100,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          },
          {
            startTime: 100,
            endTime: 200,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          },
          {
            startTime: 200,
            endTime: 300,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          },
          {
            startTime: 300,
            endTime: 400,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          },
          // This is an event with a different UID shouldn't be merged.
          {
            startTime: 400,
            endTime: 500,
            services: [{startTime: 400, endTime: 500, value: 'service1', id: 1}]
          }
        ],
        expected: [
          {
            startTime: 0,
            endTime: 400,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          },
          {
            startTime: 400,
            endTime: 500,
            services: [{startTime: 400, endTime: 500, value: 'service1', id: 1}]
          }
        ]
      },
      {
        desc: 'Multiple different events',
        eventsToMerge: [
          {
            startTime: 0,
            endTime: 100,
            services: [{startTime: 0, endTime: 200, value: 'service1', id: 0}]
          },
          {
            startTime: 100,
            endTime: 200,
            services: [{startTime: 0, endTime: 200, value: 'service1', id: 0}]
          },
          {
            startTime: 200,
            endTime: 300,
            services: [{startTime: 200, endTime: 400, value: 'service2', id: 1}]
          },
          {
            startTime: 300,
            endTime: 400,
            services: [{startTime: 200, endTime: 400, value: 'service2', id: 1}]
          }
        ],
        expected: [
          {
            startTime: 0,
            endTime: 200,
            services: [{startTime: 0, endTime: 200, value: 'service1', id: 0}]
          },
          {
            startTime: 200,
            endTime: 400,
            services: [{startTime: 200, endTime: 400, value: 'service2', id: 1}]
          }
        ]
      },
      {
        desc: 'Entry with multiple events should not be merged',
        eventsToMerge: [
          {
            startTime: 0,
            endTime: 100,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          },
          {
            startTime: 100,
            endTime: 200,
            services: [
              {startTime: 0, endTime: 400, value: 'service1', id: 0},
              {startTime: 100, endTime: 200, value: 'service2', id: 1}
            ]
          },
          {
            startTime: 200,
            endTime: 300,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          },
          {
            startTime: 300,
            endTime: 400,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          }
        ],
        expected: [
          {
            startTime: 0,
            endTime: 100,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          },
          {
            startTime: 100,
            endTime: 200,
            services: [
              {startTime: 0, endTime: 400, value: 'service1', id: 0},
              {startTime: 100, endTime: 200, value: 'service2', id: 1}
            ]
          },
          {
            startTime: 200,
            endTime: 400,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          }
        ]
      },
      {
        desc: 'Single event',
        eventsToMerge: [
          {
            startTime: 0,
            endTime: 100,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          }
        ],
        expected: [
          {
            startTime: 0,
            endTime: 100,
            services: [{startTime: 0, endTime: 400, value: 'service1', id: 0}]
          }
        ]
      }
    ];
    tests.forEach(function(test) {
      data.mergeSplitEntries(test.eventsToMerge);
      assertArrayEquals(test.desc, test.expected, test.eventsToMerge);
    });
  },
  /**
   * Tests that metrics are aggregated when they have overlapping entries.
   */
  testDetermineAggregate: function() {
    var csv =
        'metric,type,start_time,end_time,value,opt\n' +
        Csv.SYNC_APP + ',service,1000,2000,com.google.example.1\n' +
        'Overlapping,service,3000,4000,com.google.example.2\n' +
        'Overlapping,service,7000,9000,com.google.example.3\n' +
        'Overlapping,service,3500,5000,com.google.example.3\n' +
        'Non overlapping,service,2000,5000,com.google.example.2\n' +
        'Non overlapping,service,5000,7000,com.google.example.3\n';
    var logs = [{source: historianV2Logs.Sources.BATTERY_HISTORY, csv: csv}];
    var wantAggregated = [Csv.SYNC_APP, 'Overlapping'];
    var wantNonAggregated = ['Non overlapping'];

    data.processHistorianV2Data(logs, 2300, {}, '', true);
    wantAggregated.forEach(function(metric) {
      assertTrue(metrics.isAggregatedMetric(metric));
    });
    wantNonAggregated.forEach(function(metric) {
      assertFalse(metrics.isAggregatedMetric(metric));
    });
  }
});
