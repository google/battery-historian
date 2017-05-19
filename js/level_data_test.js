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

goog.provide('historian.levelDataTest');
goog.setTestOnly('historian.levelDataTest');

goog.require('goog.testing.FunctionMock');
goog.require('goog.testing.jsunit');
goog.require('historian.LevelConfigs');
goog.require('historian.LevelData');
goog.require('historian.metrics.Csv');


var levelData;
var levelConfigs;
var groups;
var deviceCapacity;

var voltageData;
var batteryLevelData;


/**
 * Creates a group with only one series.
 * @param {string} name The name of the test series.
 * @param {!Array<!historian.Entry>} data The data to set for the series.
 * @return {!historian.SeriesGroup} The created group.
 */
var createTestGroup = function(name, data) {
  return {
    name: name,
    index: 0,
    series: [
      {
        values: data
      }
    ]
  };
};


/**
 * Creates the default level data.
 */
var setUp = function() {
  voltageData = [
    {
      value: 500
    },
    {
      value: 100
    },
    {
      value: 300
    }
  ];

  batteryLevelData = [
    {
      value: 100
    }
  ];

  groups = {};
  groups[historian.metrics.Csv.VOLTAGE] =
      createTestGroup(historian.metrics.Csv.VOLTAGE, voltageData.slice());
  groups[historian.metrics.Csv.BATTERY_LEVEL] =
      createTestGroup(historian.metrics.Csv.BATTERY_LEVEL,
      batteryLevelData.slice());

  deviceCapacity = 1000;
  levelConfigs = new historian.LevelConfigs(deviceCapacity, []);

  levelData = new historian.LevelData(
      groups, historian.metrics.Csv.BATTERY_LEVEL, levelConfigs);
};


/**
 * Tests getting the default battery level config from the level data.
 */
var testGetDefault = function() {
  var gotArray = levelData.getData();
  assertEquals(gotArray.length, 1);
  assertArrayEquals(batteryLevelData, gotArray[0]);
  assertObjectEquals(historian.LevelConfigs.batteryLevelConfig_(deviceCapacity),
      levelData.getConfig());
};


/**
 * Tests setting the level metric to a new metric. Listeners should be notified.
 */
var testSetLevel = function() {
  var newMetric = 'Test metric';
  var listener = new goog.testing.FunctionMock();
  listener();
  listener.$times(1);
  listener.$replay();

  levelData.registerListener(listener);
  levelData.setLevel(newMetric);

  listener.$verify();

  assertEquals(newMetric, levelData.getConfig().name);
};


/**
 * Tests setting the level metric to the already set level metric. No listeners
 * should be notified.
 */
var testSetLevelAlreadySet = function() {
  var defaultMetric = 'Test metric';
  levelData.setLevel(defaultMetric);

  var listener = new goog.testing.FunctionMock();
  listener();
  listener.$times(0);
  listener.$replay();

  levelData.registerListener(listener);
  levelData.setLevel(defaultMetric);

  listener.$verify();

  assertEquals(defaultMetric, levelData.getConfig().name);
};


/**
 * Tests getData when no data is available for that level metric.
 */
var testNoData = function() {
  var noDataMetric = 'Test metric';
  levelData.setLevel(noDataMetric);
  assertArrayEquals([], levelData.getData());
  assertEquals(noDataMetric, levelData.getConfig().name);
};


/**
 * Tests the generation of configs.
 */
var testConfigGenerated = function() {
  levelData.setLevel(historian.metrics.Csv.VOLTAGE);
  var gotArray = levelData.getData();
  assertEquals(gotArray.length, 1);
  assertArrayEquals(voltageData, gotArray[0]);

  var gotConfig = levelData.getConfig();
  assertObjectEquals({min: 100, max: 500}, gotConfig.yDomain);
  assertEquals(historian.metrics.Csv.VOLTAGE, gotConfig.name);
};
