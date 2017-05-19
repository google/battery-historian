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

goog.module('historian.powerOverlayTest');
goog.setTestOnly('historian.powerOverlayTest');

var Context = goog.require('historian.Context');
var Csv = goog.require('historian.metrics.Csv');
var Estimator = goog.require('historian.power.Estimator');
var Event = goog.require('historian.power.Event');
var LevelData = goog.require('historian.LevelData');
var MockControl = goog.require('goog.testing.MockControl');
var Overlay = goog.require('historian.power.Overlay');
var data = goog.require('historian.data');
var mockmatchers = goog.require('goog.testing.mockmatchers');
var testSuite = goog.require('goog.testing.testSuite');


var mockControl;

var overlay;
var mockLevelData;
var mockContext;
var mockEstimator;

// Mocks for power overlay UI methods.
var mockClear;
var mockDraw;
var mockShowSelector;
var mockGetSelected;


testSuite({

  setUp: function() {
    mockControl = new MockControl();

    // Mock UI functions.
    mockControl.createMethodMock(Overlay.prototype, 'renderSelector_')();
    mockClear = mockControl.createMethodMock(Overlay.prototype, 'clear_');
    mockDraw = mockControl.createMethodMock(Overlay.prototype, 'draw_');
    mockShowSelector =
        mockControl.createMethodMock(Overlay.prototype, 'showSelector_');
    mockGetSelected =
        mockControl.createMethodMock(Overlay.prototype, 'getSelected_');

    // Mock power estimator.
    mockContext = mockControl.createStrictMock(Context);
    mockLevelData = mockControl.createStrictMock(LevelData);
    mockLevelData.registerListener(mockmatchers.isFunction);
    mockEstimator = mockControl.createStrictMock(Estimator);
    mockControl.$replayAll();

    overlay = new Overlay(mockContext, mockLevelData, mockEstimator);

    mockControl.$verifyAll();
    mockControl.$resetAll();
  },

  tearDown: function() {
    mockControl.$tearDown();
  },

  /**
   * Tests rendering if power monitor is the current level line overlay, and no
   * wakeup reason has been selected.
   */
  testPowerMonitorOverlaidNoneSelected: function() {
    mockClear();
    mockLevelData.getConfig().$returns({name: Csv.POWER_MONITOR});
    mockGetSelected().$returns('');
    mockShowSelector(true);
    mockControl.$replayAll();

    overlay.render();
    mockControl.$verifyAll();
  },

  /**
   * Tests rendering if power monitor is the current level line overlay, and
   * the selected wakeup reason has no events.
   */
  testPowerMonitorOverlaidSelectedWithNoEvents: function() {
    mockClear();
    mockLevelData.getConfig().$returns({name: Csv.POWER_MONITOR});
    mockGetSelected().$returns('wake_reason');
    mockShowSelector(true);
    mockContext.msPerPixel().$returns(10);
    mockEstimator.getEvents('wake_reason').$returns([]);
    mockControl.$replayAll();

    overlay.render();
    mockControl.$verifyAll();
  },

  /**
   * Tests rendering if power monitor is the current level line overlay, and
   * the current view is zoomed in (msPerPixel is small).
   */
  testPowerMonitorOverlaidZoomedIn: function() {
    mockClear();
    mockLevelData.getConfig().$returns({name: Csv.POWER_MONITOR});
    mockGetSelected().$returns('wake_reason');
    mockShowSelector(true);
    mockContext.msPerPixel().$returns(10);

    var mockPowerEvent1 = mockControl.createStrictMock(Event);
    var powerMonitorEvents1 = [{startTime: 1000}, {startTime: 2000}];
    mockPowerEvent1.getPowerMonitorEvents().$returns(powerMonitorEvents1);

    var mockPowerEvent2 = mockControl.createStrictMock(Event);
    var powerMonitorEvents2 = [{startTime: 300}];
    mockPowerEvent2.getPowerMonitorEvents().$returns(powerMonitorEvents2);

    mockEstimator.getEvents('wake_reason')
        .$returns([mockPowerEvent1, mockPowerEvent2]);
    mockDraw(powerMonitorEvents1);
    mockDraw(powerMonitorEvents2);
    mockControl.$replayAll();

    overlay.render();
    mockControl.$verifyAll();

  },

  /**
   * Tests rendering if power monitor is the current level line overlay, and
   * the current view is zoomed out (msPerPixel is large).
   */
  testPowerMonitorOverlaidZoomedOut: function() {
    mockClear();
    mockLevelData.getConfig().$returns({name: Csv.POWER_MONITOR});
    mockGetSelected().$returns('wake_reason');
    mockShowSelector(true);
    mockContext.msPerPixel().$returns(2000);

    var mockPowerEvent = mockControl.createStrictMock(Event);
    var powerMonitorEvents = [{startTime: 1000}, {startTime: 1100}];
    mockPowerEvent.getPowerMonitorEvents().$returns(powerMonitorEvents);

    mockEstimator.getEvents('wake_reason').$returns([mockPowerEvent]);
    var sampled = [{startTime: 1000}];
    var sampleMock = mockControl.createMethodMock(data, 'sampleData');
    sampleMock(powerMonitorEvents).$returns(sampled);
    mockDraw(sampled);
    mockControl.$replayAll();

    overlay.render();
    mockControl.$verifyAll();
  },

  /**
   * Tests rendering if power monitor is not the current level line overlay.
   */
  testOtherOverlaid: function() {
    mockClear();
    mockLevelData.getConfig().$returns({name: Csv.BATTERY_LEVEL});
    mockGetSelected().$returns('');
    mockShowSelector(false);
    mockControl.$replayAll();

    overlay.render();
    mockControl.$verifyAll();
  }
});
