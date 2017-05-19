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
var color = goog.require('historian.color');
var data = goog.require('historian.data');
var historianV2Logs = goog.require('historian.historianV2Logs');
var metrics = goog.require('historian.metrics');
var testSuite = goog.require('goog.testing.testSuite');
var testUtils = goog.require('historian.testUtils');
goog.require('goog.testing.jsunit');


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
 * @param {!data.ClusterEntry} clusteredEntry
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
      services: value[2].map(function(wr) {
        return {
          startTime: value[0],
          endTime: value[1],
          value: {
            wakeReason: wr,
            wakelockCategory: value[3]
          }
        };
      })
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
        'CPU running,service,1000,5000,1000~2000~wr1|2000~3000~wr2|3000~5000~wr3,\n';
    var logs = [{source: historianV2Logs.Sources.BATTERY_HISTORY, csv: csv}];
    var testData = data.processHistorianV2Data(logs, 2300, {}, '', true);

    var runningGroup = testData.barGroups.getBatteryHistoryData(
        Csv.CPU_RUNNING);
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

      assertArrayEquals(t.desc + ': Expected ' + JSON.stringify(expected) +
          ', got ' + JSON.stringify(output), expected, output);
    });
  },
  /**
   * Tests whether running entries are correctly categorized as
   * "with wakelocks" or "without wakelocks".
   */
  testCategorizeRunning: function() {
    var tests = [
      {
        desc: 'Wakelock starts before start of running entry',
        running: [
          [100, 200, '100~200~wr']
        ],
        wakelocks: [
          [0, 150, 'service1']
        ],
        expected: [
          [150, 200, ['wr'], metrics.KERNEL_UPTIME_WITH_USERSPACE]
        ]
      },
      {
        desc: 'Wakelock starts in middle of running entry',
        running: [
          [0, 100, '0~50~wr']
        ],
        wakelocks: [
          [50, 100, 'service1']
        ],
        expected: [
          [0, 50, ['wr'], metrics.KERNEL_UPTIME_WITH_USERSPACE]
        ]
      },
      {
        desc: 'Wakelock starts before and ends after running entry.',
        running: [
          [50, 100, '50~100~wr']
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
          [50, 75, ['wr1'], metrics.KERNEL_UPTIME_WITH_USERSPACE],
          [250, 300, ['wr2'], metrics.KERNEL_UPTIME_WITH_USERSPACE]
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
          [25, 60, ['wr'], metrics.KERNEL_UPTIME_WITH_USERSPACE],
          [70, 90, ['No wakeup reason'], metrics.KERNEL_UPTIME_WITH_USERSPACE]
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
          [100, 200, ['wr'], metrics.KERNEL_UPTIME_NO_USERSPACE]
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
          [200, 300, ['wr2'], metrics.KERNEL_UPTIME_WITH_USERSPACE]
        ]
      },
      {
        desc: 'No wakelocks',
        running: [
          [100, 200, '100~wr1|150~wr2'],
          [200, 400, '200~wr2']
        ],
        wakelocks: [
        ],
        expected: [
          [100, 200, ['wr1', 'wr2'], metrics.KERNEL_UPTIME_NO_USERSPACE],
          [200, 400, ['wr2'], metrics.KERNEL_UPTIME_NO_USERSPACE],
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
          [100, 200, '100~200~Unknown']
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
          [100, 200, '100~200~']
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
        desc: 'Instantaneous wakeup reason',
        running: [
          [100, 200, '100~Instantaneous nothing']
        ],
        expected: [
          {
            startTime: 100,
            endTime: 200,
            services: [
              {startTime: 100, endTime: 100, value: 'Instantaneous nothing'}
            ]
          }
        ]
      },
      {
        desc: 'Multiple wakeup reasons',
        running: [
          [
           1000,
           4000,
          '1000~2000~Abort:Pending Wakeup Sources: ipc00000177_FLP Service Cal |' +
          '2000~2500~Abort:Pending Wakeup Sources: sh2ap_wakelock |' +
          '2500~3500~Abort:Some devices failed to suspend|' +
          '3500~4000~Abort:Pending Wakeup Sources: sh2ap_wakelock '
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
                endTime: 4000,
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
        source: historianV2Logs.Sources.SYSTEM_LOG,
        csv: logcat,
        startMs: 2000
      }
    ];
    var result = data.processHistorianV2Data(logs, 2300, {}, '', true);

    var wantGroups = [
      {
        source: historianV2Logs.Sources.CUSTOM,
        name: Csv.AM_LOW_MEMORY_ANR
      },
      {
        source: historianV2Logs.Sources.CUSTOM,
        name: Csv.CRASHES
      },
      {
        source: historianV2Logs.Sources.BATTERY_HISTORY,
        name: Csv.WIFI_RUNNING
      }
    ];
    var gotGroups = result.barGroups.getAll().map(function(group) {
      return {source: group.source, name: group.name};
    });
    var byName = function(a, b) {
      return a.name.localeCompare(b.name);
    };
    assertArrayEquals(wantGroups.sort(byName), gotGroups.sort(byName));

    assertEquals('Log start is report start, no UNAVAILABLE series added',
        1, result.barGroups.get(
            historianV2Logs.Sources.CUSTOM, Csv.CRASHES).series.length);

    var lowMemoryAnrGroup = result.barGroups.get(
        historianV2Logs.Sources.CUSTOM, Csv.AM_LOW_MEMORY_ANR);
    assertEquals('Log start after report start, expected UNAVAILABLE series',
        3, lowMemoryAnrGroup.series.length);

    // Check that the first series in the Low Memory/ANR group matches the
    // expected UNAVAILABLE series.
    var gotSeries = lowMemoryAnrGroup.series[0];
    assertEquals(1, gotSeries.values.length);
    assertEquals(metrics.UNAVAILABLE_TYPE, gotSeries.type);
    assertEquals('Report start time', 2000, gotSeries.values[0].startTime);
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
  },
  /**
   * Tests the bucketting of wakeup reasons.
   */
  testBucketWakeups: function() {
    var csv = 'metric,type,start_time,end_time,value,opt\n' +
        'CPU running,service,1100,3000,1100~1500~wr1|1500~2200~wr2,\n' +
        'CPU running,service,5200,5500,5200~5500~wr2,\n' +
        'CPU running,service,5600,6000,5600~5700~wr2|5700~5800~wr3|5800~6000~wr2,\n';
    var bucketSize = 1000;
    var want = {
      'wr1': [{bucketMs: 1100, count: 1}],
      'wr2': [{bucketMs: 2100, count: 1}, {bucketMs: 5100, count: 3}],
      'wr3': [{bucketMs: 5100, count: 1}]
    };
    var logs = [{source: historianV2Logs.Sources.BATTERY_HISTORY, csv: csv}];
    var historianV2Data =
        data.processHistorianV2Data(logs, 2300, {}, '', true);
    var running = historianV2Data.barGroups.getBatteryHistoryData(
        Csv.CPU_RUNNING);
    var batteryHistoryExtent = historianV2Data
        .logToExtent[historianV2Logs.Sources.BATTERY_HISTORY];
    var bucketted =
        data.bucketWakeups(batteryHistoryExtent.min, running, bucketSize);
    assertObjectEquals(want, bucketted);
  },
  /**
   * Tests the extraction of app transition events from sysui_action events.
   */
  testExtractAppTransitions: function() {
    var csv = 'metric,type,start_time,end_time,value,opt\n' +
        // Transition 1.
        Csv.SYSUI_ACTION +
            ',service,1000,1000,"323,com.google.android.example",\n' +
        Csv.SYSUI_ACTION +
            ',service,1050,1050,"324,true",\n' +
        Csv.SYSUI_ACTION +
            ',service,1100,1100,"320,reason",\n' +
        // Non transition event.
        Csv.SYSUI_ACTION +
            ',service,1200,1200,"100",\n' +
        // Transition 2.
        Csv.SYSUI_ACTION +
            ',service,2000,2000,"323,com.google.android.example",\n' +
        // DELAY_MS event (id = 319) for transition 1. Delay = 1 second.
        Csv.SYSUI_ACTION +
            ',service,2200,2200,"319,1000",\n';
    var logs = [{source: historianV2Logs.Sources.EVENT_LOG, csv: csv}];
    var wantTransitions = [
          {
            startTime: 1000,
            endTime: 2200,
            id: 0,
            value: {
              323: {
                startTime: 1000,
                endTime: 1000,
                value: '323,com.google.android.example'
              },
              324: {
                startTime: 1050,
                endTime: 1050,
                value: '324,true'
              },
              320: {
                startTime: 1100,
                endTime: 1100,
                value: '320,reason'
              },
              319: {
                startTime: 2200,
                endTime: 2200,
                value: '319,1000'
              }
            }
          },
          {
            startTime: 2000,
            endTime: 2000,
            id: 1,
            value: {
              323: {
                startTime: 2000,
                endTime: 2000,
                value: '323,com.google.android.example'
              }
            }
          }
    ];

    var wantAggregatedTransitions = [
      {
        startTime: 1000,
        endTime: 2000,
        services: [wantTransitions[0]]
      },
      {
        startTime: 2000,
        endTime: 2000,
        services: [wantTransitions[0], wantTransitions[1]]
      },
      {
        startTime: 2000,
        endTime: 2200,
        services: [wantTransitions[0]]
      }
    ];
    var wantSysuiActions = [
      {
        startTime: 1200,
        endTime: 1200,
        value: '100'
      }
    ];
    var historianV2Data =
        data.processHistorianV2Data(logs, 2300, {}, '', true);
    assertArrayEquals(wantAggregatedTransitions, historianV2Data.barGroups.get(
        historianV2Logs.Sources.EVENT_LOG, Csv.APP_TRANSITIONS)
            .series[0].values);
    assertArrayEquals(wantSysuiActions, historianV2Data.barGroups.get(
        historianV2Logs.Sources.EVENT_LOG, Csv.SYSUI_ACTION).series[0].values);
  },
  /**
   * Tests the mapping of string to number values for displaying as a level
   * line.
   */
  testStringMetricMapping: function() {
    var csv = 'metric,type,start_time,end_time,value,opt\n' +
        Csv.WIFI_SIGNAL_STRENGTH + ',string,1000,2000,good,\n' +
        Csv.WIFI_SIGNAL_STRENGTH + ',string,2000,5000,poor,\n' +
        Csv.WIFI_SIGNAL_STRENGTH + ',string,5000,6000,great,\n' +
        Csv.WIFI_SIGNAL_STRENGTH + ',string,6000,7000,unknown,\n' +
        Csv.WIFI_SIGNAL_STRENGTH + ',string,7000,10000,great,\n' +
        Csv.WIFI_SIGNAL_STRENGTH + ',string,10000,12000,unknown,\n' +
        Csv.WIFI_SIGNAL_STRENGTH + ',string,12000,14000,another,\n';
    var logs = [{source: historianV2Logs.Sources.BATTERY_HISTORY, csv: csv}];

    var expectedLevelGroup = {
      name: Csv.WIFI_SIGNAL_STRENGTH,
      source: historianV2Logs.Sources.BATTERY_HISTORY,
      index: null,
      series: [{
        name: Csv.WIFI_SIGNAL_STRENGTH,
        source: historianV2Logs.Sources.BATTERY_HISTORY,
        type: 'string',
        // Expected strings are: ['none', 'poor', 'moderate', 'good', 'great'].
        values: [
          {
            startTime: 1000,
            endTime: 2000,
            value: 3
          },
          {
            startTime: 2000,
            endTime: 5000,
            value: 1
          },
          {
            startTime: 5000,
            endTime: 6000,
            value: 4
          },
          {
            startTime: 6000,
            endTime: 7000,
            value: 5
          },
          {
            startTime: 7000,
            endTime: 10000,
            value: 4
          },
          {
            startTime: 10000,
            endTime: 12000,
            value: 5
          },
          {
            startTime: 12000,
            endTime: 14000,
            value: 6
          }
        ],
        cluster: true
      }]
    };

    var historianV2Data =
        data.processHistorianV2Data(logs, 2300, {}, '', true);
    var gotLevelGroup =
        historianV2Data.nameToLevelGroup[Csv.WIFI_SIGNAL_STRENGTH];
    assertObjectEquals(expectedLevelGroup, gotLevelGroup);

    // Try mapping the numbers back to the original strings.
    var originalStrings =
        ['good', 'poor', 'great', 'unknown', 'great', 'unknown', 'another'];
    var gotStrings = gotLevelGroup.series[0].values.map(function(entry) {
      return color.valueFormatter(gotLevelGroup.name, entry.value).value;
    });
    assertArrayEquals(originalStrings, gotStrings);
  }
});
