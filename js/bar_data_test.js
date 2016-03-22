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
goog.require('historian.metrics.Csv');



var barData;
var groups;


/**
 * Creates an empty historian.SeriesGroup for the given name.
 *
 * @param {string} name The name to give the group.
 * @return {historian.SeriesGroup} A group with the given name.
 */
var createTestGroup = function(name) {
  return {
    name: name,
    index: 0,
    series: []
  };
};


/**
 * Creates the default groups, hidden groups and order for the bar data.
 */
var setUp = function() {
  groups = {};
  groups[historian.metrics.Csv.TEMPERATURE] =
      createTestGroup(historian.metrics.Csv.TEMPERATURE);
  groups[historian.metrics.Csv.VOLTAGE] =
      createTestGroup(historian.metrics.Csv.VOLTAGE);
  groups[historian.metrics.Csv.BATTERY_LEVEL] =
      createTestGroup(historian.metrics.Csv.BATTERY_LEVEL);

  var defaultHiddenGroups = {};
  defaultHiddenGroups[historian.metrics.Csv.VOLTAGE] = true;
  var order = [
    historian.metrics.Csv.TEMPERATURE,
    historian.metrics.Csv.VOLTAGE,
    historian.metrics.Csv.BATTERY_LEVEL
  ];

  barData = new historian.BarData(groups, defaultHiddenGroups, order, false);
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
  barData.addGroup(historian.metrics.Csv.VOLTAGE);

  listener1.$verify();
  listener2.$verify();

  var expected = [
    groups[historian.metrics.Csv.TEMPERATURE],
    groups[historian.metrics.Csv.BATTERY_LEVEL],
    groups[historian.metrics.Csv.VOLTAGE]
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
  barData.removeGroup(historian.metrics.Csv.BATTERY_LEVEL);

  listener1.$verify();
  listener2.$verify();

  var expected = [
    groups[historian.metrics.Csv.TEMPERATURE]
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
  barData.addGroup('unknown group name');

  listener.$verify();

  var expected = [
    groups[historian.metrics.Csv.TEMPERATURE],
    groups[historian.metrics.Csv.BATTERY_LEVEL]
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
  barData.removeGroup('unknown group name');

  listener.$verify();

  var expected = [
    groups[historian.metrics.Csv.TEMPERATURE],
    groups[historian.metrics.Csv.BATTERY_LEVEL]
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
  barData.addGroup(historian.metrics.Csv.TEMPERATURE);

  listener.$verify();

  var expected = [
    groups[historian.metrics.Csv.TEMPERATURE],
    groups[historian.metrics.Csv.BATTERY_LEVEL]
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
  barData.removeGroup(historian.metrics.Csv.VOLTAGE);

  listener.$verify();
  var expected = [
    groups[historian.metrics.Csv.TEMPERATURE],
    groups[historian.metrics.Csv.BATTERY_LEVEL]
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
  assertTrue('default visible groups', data.length == 2);
  assertEquals('default groups: temperature index', 1, data[0].index);
  assertEquals('default groups: battery level index', 0, data[1].index);

  barData.addGroup(historian.metrics.Csv.VOLTAGE);
  var data = barData.getData();
  assertTrue('added voltage group', data.length == 3);
  assertEquals('added voltage: temperature index', 2, data[0].index);
  assertEquals('added voltage: battery level index', 0, data[1].index);
  assertEquals('added voltage: voltage index', 1, data[2].index);

  barData.removeGroup(historian.metrics.Csv.TEMPERATURE);
  var data = barData.getData();
  assertTrue('removed temperature group', data.length == 2);
  assertEquals('removed temperature: battery level index', 0, data[0].index);
  assertEquals('removed temperature: voltage index', 1, data[1].index);

  barData.removeGroup(historian.metrics.Csv.BATTERY_LEVEL);
  var data = barData.getData();
  assertTrue('removed battery level group', data.length == 1);
  assertEquals('removed battery level: voltage index', 0, data[0].index);
};
