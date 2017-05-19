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

goog.provide('historian.barDataTest');
goog.setTestOnly('historian.barDataTest');

goog.require('goog.testing.FunctionMock');
goog.require('goog.testing.jsunit');
goog.require('historian.BarData');
goog.require('historian.color');
goog.require('historian.data');
goog.require('historian.historianV2Logs');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');



var barData;
var defaultHiddenGroups;

var temperature;
var voltage;
var batteryLevel;
var audio;
var voltageEventLog;


/**
 * Creates an empty historian.SeriesGroup for the given name.
 *
 * @param {!historian.metrics.GroupProperties} groupProperties
 * @param {number=} opt_index Index for the series. Zero if not specified.
 * @return {historian.SeriesGroup} A group with the given name.
 */
var createTestGroup = function(groupProperties, opt_index) {
  return {
    name: groupProperties.name,
    index: opt_index || 0,
    series: [],
    source: groupProperties.source
  };
};


/**
 * Creates the default groups, hidden groups and order for the bar data.
 */
var setUp = function() {
  temperature = {
    source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
    name: historian.metrics.Csv.TEMPERATURE
  };
  voltage = {
    source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
    name: historian.metrics.Csv.VOLTAGE
  };
  batteryLevel = {
    source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
    name: historian.metrics.Csv.BATTERY_LEVEL
  };
  audio = {
    source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
    name: historian.metrics.Csv.AUDIO
  };
  // Same series name, but different log source.
  voltageEventLog = {
    source: historian.historianV2Logs.Sources.EVENT_LOG,
    name: historian.metrics.Csv.VOLTAGE
  };
  [temperature, voltage, batteryLevel, audio, voltageEventLog].forEach(
      function(prop) {
        prop.hash =
            historian.metrics.hash({source: prop.source, name: prop.name});
      });
  var groupOrder = [
    temperature,
    voltage,
    batteryLevel,
    audio,
    voltageEventLog
  ];
  var groups = new historian.metrics.DataHasher();
  groupOrder.forEach(function(groupProperties) {
    groups.add(createTestGroup(groupProperties));
  });

  var hiddenHash = {};
  [voltage, audio, voltageEventLog].forEach(function(group) {
    hiddenHash[historian.metrics.hash(group)] = true;
  });

  barData = new historian.BarData(null, groups, hiddenHash, groupOrder, false);
};


/**
 * Tests adding known groups not already present. Listeners should be notified.
 */
var testAddGroup = function() {
  var listener1 = new goog.testing.FunctionMock();
  var listener2 = new goog.testing.FunctionMock();
  listener1();
  listener2();
  listener1.$times(1);
  listener2.$times(1);
  listener1.$replay();
  listener2.$replay();

  barData.registerListener(listener1);
  barData.registerListener(listener2);
  barData.addGroup(voltage.source, voltage.name);

  listener1.$verify();
  listener2.$verify();

  var expected = [
    createTestGroup(temperature, 2),
    createTestGroup(batteryLevel, 1),
    createTestGroup(voltage, 0)
  ];
  assertArrayEquals(expected, barData.getData());
};


/**
 * Tests removing present groups. Listeners should be notified.
 */
var testRemoveGroup = function() {
  var listener1 = new goog.testing.FunctionMock();
  var listener2 = new goog.testing.FunctionMock();
  listener1();
  listener2();
  listener1.$times(1);
  listener2.$times(1);
  listener1.$replay();
  listener2.$replay();

  barData.registerListener(listener1);
  barData.registerListener(listener2);
  barData.removeGroup(batteryLevel.source, batteryLevel.name);

  listener1.$verify();
  listener2.$verify();

  var expected = [
    createTestGroup(temperature, 0)
  ];
  assertArrayEquals(expected, barData.getData());
};


/**
 * Tests adding unknown groups. Listeners should not be notified.
 */
var testAddUnknownGroup = function() {
  var listener = new goog.testing.FunctionMock();
  listener();
  listener.$times(0);
  listener.$replay();

  barData.registerListener(listener);
  barData.addGroup(historian.historianV2Logs.Sources.BATTERY_HISTORY,
      'unknown group name');

  listener.$verify();

  var expected = [
    createTestGroup(temperature, 1),
    createTestGroup(batteryLevel, 0)
  ];
  assertArrayEquals(expected, barData.getData());
};


/**
 * Tests renoving unknown groups. Listeners should not be notified.
 */
var testRemoveUnknownGroup = function() {
  var listener = new goog.testing.FunctionMock();
  listener();
  listener.$times(0);
  listener.$replay();

  barData.registerListener(listener);
  barData.removeGroup(historian.historianV2Logs.Sources.BATTERY_HISTORY,
      'unknown group name');

  listener.$verify();

  var expected = [
    createTestGroup(temperature, 1),
    createTestGroup(batteryLevel, 0)
  ];
  assertArrayEquals(expected, barData.getData());
};


/**
 * Tests the adding of groups already present. Listeners should not be notified.
 */
var testAddAlreadyPresent = function() {
  var listener = new goog.testing.FunctionMock();
  listener();
  listener.$times(0);
  listener.$replay();

  barData.registerListener(listener);
  barData.addGroup(temperature.source, temperature.name);

  listener.$verify();

  var expected = [
    createTestGroup(temperature, 1),
    createTestGroup(batteryLevel, 0)
  ];
  assertArrayEquals(expected, barData.getData());
};


/**
 * Tests the removing of groups not present. Listeners should not be notified.
 */
var testRemoveMissingGroup = function() {
  var listener = new goog.testing.FunctionMock();
  listener();
  listener.$times(0);
  listener.$replay();

  barData.registerListener(listener);
  barData.removeGroup(voltage.source, voltage.name);

  listener.$verify();
  var expected = [
    createTestGroup(temperature, 1),
    createTestGroup(batteryLevel, 0)
  ];
  assertArrayEquals(expected, barData.getData());
};


/**
 * Tests the indexes generated for groups after adding and removing groups.
 */
var testGenerateIndexes = function() {
  // Order for visible groups is set as:
  //   historian.metrics.Csv.TEMPERATURE,
  //   historian.metrics.Csv.VOLTAGE,
  //   historian.metrics.Csv.BATTERY_LEVEL
  // The earlier the group appears in the order array, the higher the index.
  var data = barData.getData();
  assertEquals('default visible groups', 2, data.length);
  assertEquals('default groups: temperature index', 1, data[0].index);
  assertEquals('default groups: battery level index', 0, data[1].index);

  // Adding the voltage group should insert it at the end.
  barData.addGroup(voltage.source, voltage.name);
  var data = barData.getData();
  assertEquals('added voltage group', 3, data.length);
  assertEquals('added voltage: temperature index', 2, data[0].index);
  assertEquals('added voltage: battery level index', 1, data[1].index);
  assertEquals('added voltage: voltage index', 0, data[2].index);

  barData.removeGroup(temperature.source, temperature.name);
  var data = barData.getData();
  // Removing temperature group doesn't affect other groups.
  assertEquals('removed temperature group', 2, data.length);
  assertEquals('removed temperature: battery level index', 1, data[0].index);
  assertEquals('removed temperature: voltage index', 0, data[1].index);

  barData.removeGroup(batteryLevel.source, batteryLevel.name);
  var data = barData.getData();
  assertEquals('removed battery level group', 1, data.length);
  assertEquals('removed battery level: voltage index', 0, data[0].index);
};


/**
 * Tests the generation of help legends.
 */
var testGenerateLegends = function() {
  var csv =
      'metric,type,start_time,end_time,value,opt\n' +
      historian.metrics.Csv.MOBILE_RADIO_ON + ',bool,1000,2000,true\n' +
      historian.metrics.Csv.WIFI_SIGNAL_STRENGTH + ',string,1200,3000,good\n';
  var systemLogCsv =
      'metric,type,start_time,end_time,value,opt\n' +
      historian.metrics.Csv.GC_PAUSE_FOREGROUND +
          ',service,2000,2000,true,8900000\n' +
      historian.metrics.Csv.GC_PAUSE_BACKGROUND_PARTIAL +
          ',service,3000,3000,true,12000\n' +
      historian.metrics.Csv.GC_PAUSE_BACKGROUND_STICKY +
          ',service,4000,4000,true,3200000\n';

  var logs = [
    {
      source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
      csv: csv
    },
    {
      source: historian.historianV2Logs.Sources.SYSTEM_LOG,
      csv: systemLogCsv,
    }
  ];

  var wantLegends = {};
  // Colors defined in historian.color.
  wantLegends[historian.metrics.Csv.MOBILE_RADIO_ON] = [
    {color: 'white', value: 'Off', isCircle: false},
    {color: '#fa531b', value: 'On', isCircle: false}
  ];

  wantLegends[historian.metrics.Csv.WIFI_SIGNAL_STRENGTH] = [
    {color: 'white', value: 'none', isCircle: false},
    {color: 'red', value: 'poor', isCircle: false},
    {color: 'orange', value: 'moderate', isCircle: false},
    {color: 'yellow', value: 'good', isCircle: false},
    {color: 'green', value: 'great', isCircle: false}
  ];

  wantLegends[historian.metrics.Csv.GC_PAUSE] = [
    {
      color: 'maroon',
      value: historian.metrics.Csv.GC_PAUSE_FOREGROUND,
      isCircle: true
    },
    {
      color: 'orange',
      value: historian.metrics.Csv.GC_PAUSE_BACKGROUND_PARTIAL,
      isCircle: true
    },
    {
      color: 'red',
      value: historian.metrics.Csv.GC_PAUSE_BACKGROUND_STICKY,
      isCircle: true
    }
  ];

  var historianData =
      historian.data.processHistorianV2Data(logs, 2300, {}, '', true);
  historian.color.generateSeriesColors(historianData.barGroups);
  var barData = new historian.BarData(
      null, historianData.barGroups, {}, [], false);

  for (var group in wantLegends) {
    assertArrayEquals('Legend for group ' + group,
        wantLegends[group], barData.getLegend(group));
  }
};


/**
 * Tests the filtering of entries considered unimportant.
 */
var testFilterUnimportant = function() {
  var batteryHistoryCsv = [
    'metric,type,start_time,end_time,value,opt',
    historian.metrics.Csv.WIFI_SIGNAL_STRENGTH + ',string,1200,1201,good,\n',
  ].join('\n');  // Doesn't add the last newline, so need to manually add.

  // Since dvm events are considered instant, the lock time is extracted
  // from the fourth comma separated field of the value.
  var shortDvm = '"com.google.example,0,t,200,File,57,Owner,-2,98"';  // 200ms.
  var longDvm = '"com.google.example,0,t,10000,File,57,Owner,-2,98"';  // 10s.
  var lowAmPss =
      '"17299,10075,com.google.android.apps.plus,199301,128040"';  // 194 kB.
  var highAmPss =
      '"17299,10075,com.google.example,253301120,12804096"';  // 241 MB.

  var eventLogCsv = [
    'metric,type,start_time,end_time,value,opt',
    historian.metrics.Csv.DVM_LOCK_SAMPLE +
        ',service,2000,2000,' + shortDvm + ',',
    historian.metrics.Csv.DVM_LOCK_SAMPLE +
        ',service,5000,5000,' + longDvm + ',',
    historian.metrics.Csv.AM_PSS + ',service,7000,7000,' + lowAmPss + ',',
    historian.metrics.Csv.AM_PSS + ',service,8000,8000,' + highAmPss + ',\n'
  ].join('\n');

  var logs = [
    {
      source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
      csv: batteryHistoryCsv
    },
    {
      source: historian.historianV2Logs.Sources.EVENT_LOG,
      csv: eventLogCsv,
      startMs: 1200
    }
  ];
  var order = [
    {
      source: historian.historianV2Logs.Sources.EVENT_LOG,
      name: historian.metrics.Csv.AM_PSS
    },
    {
      source: historian.historianV2Logs.Sources.EVENT_LOG,
      name: historian.metrics.Csv.DVM_LOCK_SAMPLE
    },
    {
      source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
      name: historian.metrics.Csv.WIFI_SIGNAL_STRENGTH
    }
  ];

  var allAmPssEvents = [
    {
      startTime: 7000,
      endTime: 7000,
      value: stripQuotes(lowAmPss)  // CSV library strips quotes.
    },
    {
      startTime: 8000,
      endTime: 8000,
      value: stripQuotes(highAmPss)  // CSV library strips quotes.
    }
  ];
  var wantAmPssGroup = {
    name: historian.metrics.Csv.AM_PSS,
    index: 2,
    source: historian.historianV2Logs.Sources.EVENT_LOG,
    series: [
      {
        name: historian.metrics.Csv.AM_PSS,
        source: historian.historianV2Logs.Sources.EVENT_LOG,
        type: 'service',
        values: [allAmPssEvents[1]],  // Filtering is enabled by default.
        cluster: true
      }
    ]
  };

  var allDvmEvents = [
    {
      startTime: 2000,
      endTime: 2000,
      value: stripQuotes(shortDvm)  // CSV library strips quotes.
    },
    {
      startTime: 5000,
      endTime: 5000,
      value: stripQuotes(longDvm)  // CSV library strips quotes.
    }
  ];
  var wantDvmGroup = {
    name: historian.metrics.Csv.DVM_LOCK_SAMPLE,
    index: 1,
    source: historian.historianV2Logs.Sources.EVENT_LOG,
    series: [
      {
        name: historian.metrics.Csv.DVM_LOCK_SAMPLE,
        source: historian.historianV2Logs.Sources.EVENT_LOG,
        type: 'service',
        values: [allDvmEvents[1]],  // Filtering is enabled by default.
        cluster: true
      }
    ]
  };
  var wantWifiGroup = {
    name: historian.metrics.Csv.WIFI_SIGNAL_STRENGTH,
    index: 0,
    source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
    series: [
      {
        name: historian.metrics.Csv.WIFI_SIGNAL_STRENGTH,
        source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
        type: 'string',
        values: [
          {
            // This event is only 1 ms long, but no minimum duration has been
            // specified for this series.
            startTime: 1200,
            endTime: 1201,
            value: 'good'
          }
        ],
        cluster: true
      }
    ]
  };
  var wantGroups = [wantAmPssGroup, wantDvmGroup, wantWifiGroup];

  var historianData =
      historian.data.processHistorianV2Data(logs, 2300, {}, '', true);
  var barData = new historian.BarData(
      null, historianData.barGroups, {}, order, false);
  var data = barData.getData();
  data.sort(function(g1, g2) {
    return g1 < g2;
  });
  assertArrayEquals('Default filtered', wantGroups, data);

  barData.setFilteredUnimportant(false);  // Disable default filtering.
  wantAmPssGroup.series[0].values = allAmPssEvents;
  wantDvmGroup.series[0].values = allDvmEvents;
  data = barData.getData();
  data.sort(function(g1, g2) {
    return g1 < g2;
  });
  assertArrayEquals('Unfiltered', wantGroups, data);
};


/**
 * Returns the string with quotes stripped.
 * @param {string} value
 * @return {string}
 */
var stripQuotes = function(value) {
  return value.replace(/(^")|("$)/g, '');
};


/**
 * Verifies the expected indexes for the given groups.
 * @param {!Object<number>} hashToIndex Map from series hash to expected
 *     index.
 * @param {!Array<!historian.SeriesGroup>} got
 */
var verifyIndexes = function(hashToIndex, got) {
  var expectedNum = Object.keys(hashToIndex).length;
  assertEquals(expectedNum, got.length);

  got.forEach(function(group) {
    var hash = historian.metrics.hash(group);

    assertTrue(hash in hashToIndex);
    var wantIndex = hashToIndex[hash];
    assertEquals(wantIndex, group.index);
  });
};


/**
 * Tests the modifying of a series index.
 */
var testModifyIndex = function() {
  // Add VOLTAGE and AUDIO groups.
  barData.addGroup(voltage.source, voltage.name);
  barData.addGroup(audio.source, audio.name);
  var expectedIndexes = {
    [temperature.hash]: 3,
    [batteryLevel.hash]: 2,
    [voltage.hash]: 1,
    [audio.hash]: 0
  };
  verifyIndexes(expectedIndexes, barData.getData());

  // Move VOLTAGE up.
  barData.modifyIndex(voltage.source, voltage.name, 3);
  var expectedIndexes = {
    [voltage.hash]: 3,
    [temperature.hash]: 2,
    [batteryLevel.hash]: 1,
    [audio.hash]: 0
  };
  verifyIndexes(expectedIndexes, barData.getData());

  // Move TEMPERATURE down.
  barData.modifyIndex(temperature.source, temperature.name, 0);
  var expectedIndexes = {
    [voltage.hash]: 3,
    [batteryLevel.hash]: 2,
    [audio.hash]: 1,
    [temperature.hash]: 0
  };
  verifyIndexes(expectedIndexes, barData.getData());

  // Move non-rendered series.
  barData.modifyIndex(voltageEventLog.source, voltageEventLog.name, 0);
  verifyIndexes(expectedIndexes, barData.getData());

  // Move series to same index.
  barData.modifyIndex(voltage.source, voltage.name, 3);
  verifyIndexes(expectedIndexes, barData.getData());

  // Move series above maximum index - should move to max index.
  barData.modifyIndex(audio.source, audio.name, 10);
  var expectedIndexes = {
    [audio.hash]: 3,
    [voltage.hash]: 2,
    [batteryLevel.hash]: 1,
    [temperature.hash]: 0
  };
  verifyIndexes(expectedIndexes, barData.getData());

  // Move series below minimum index - should move to index 0.
  barData.modifyIndex(batteryLevel.source, batteryLevel.name, -1);
  var expectedIndexes = {
    [audio.hash]: 3,
    [voltage.hash]: 2,
    [temperature.hash]: 1,
    [batteryLevel.hash]: 0
  };
  verifyIndexes(expectedIndexes, barData.getData());

  // Move the other voltage series that is currently hidden - nothing should
  // happen.
  barData.modifyIndex(voltageEventLog.source, voltageEventLog.name, 2);
  verifyIndexes(expectedIndexes, barData.getData());
};


/**
 * Tests the retrieving of a series by name and log source.
 */
var testGetSeries = function() {
  var createIntSeries = function(name, source) {
    return {
      name: name,
      source: source,
      type: 'int',
      values: [],
      cluster: false
    };
  };

  var batteryVoltageSeries = createIntSeries(
      historian.metrics.Csv.VOLTAGE,
      historian.historianV2Logs.Sources.BATTERY_HISTORY);
  var eventVoltageSeries = createIntSeries(
      historian.metrics.Csv.VOLTAGE,
      historian.historianV2Logs.Sources.EVENT_LOG);
  var voltageGroup = createTestGroup({
    name: historian.metrics.Csv.VOLTAGE,
    source: historian.historianV2Logs.Sources.CUSTOM
  });
  voltageGroup.series = [batteryVoltageSeries, eventVoltageSeries];

  var batteryLevelSeries = createIntSeries(
      historian.metrics.Csv.BATTERY_LEVEL,
      historian.historianV2Logs.Sources.BATTERY_HISTORY);
  var batteryGroup = createTestGroup({
    name: historian.metrics.Csv.BATTERY_LEVEL,
    source: historian.historianV2Logs.Sources.CUSTOM
  });
  batteryGroup.series = [batteryLevelSeries];

  var groups = new historian.metrics.DataHasher();
  groups.add(batteryGroup);
  groups.add(voltageGroup);
  barData = new historian.BarData(null, groups, {}, [], false);

  [batteryLevelSeries, batteryVoltageSeries, eventVoltageSeries].forEach(
      function(series) {
        assertObjectEquals(
            series, barData.getSeries(series.name, series.source));
      }
  );
  assertObjectEquals(null, barData.getSeries(historian.metrics.Csv.CAMERA,
      historian.historianV2Logs.Sources.BATTERY_HISTORY));
};

