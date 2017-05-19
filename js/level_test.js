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

goog.module('historian.levelTest');
goog.setTestOnly('historian.levelTest');

var Context = goog.require('historian.Context');
var Data = goog.require('historian.LevelLine.Data');
var MockControl = goog.require('goog.testing.MockControl');
var PropertyReplacer = goog.require('goog.testing.PropertyReplacer');
var mockmatchers = goog.require('goog.testing.mockmatchers');
var testSuite = goog.require('goog.testing.testSuite');
var testUtils = goog.require('historian.testUtils');


/**
 * Creates a single entry for a series.
 * @param {!Array<number>} arr
 * @return {!historian.Entry}
 */
var createTestEntry = function(arr) {
  return {startTime: arr[0], endTime: arr[1], value: arr[2]};
};


testSuite({
  /**
   * Tests the fetching of data to display.
   */
  testGetDisplayedData: function() {
    var tests = [
      {
        desc: 'Time range includes all the initial data',
        timeRange: [0, 4000],
        initialData: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 4000, 98]
        ],
        expected: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 4000, 98],
          [4000, 4000, 98]
        ]
      },
      {
        desc: 'Time range excludes some earlier entries in initial data',
        timeRange: [2000, 4000],
        initialData: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 4000, 98]
        ],
        expected: [
          [2000, 3000, 99],
          [3000, 4000, 98],
          [4000, 4000, 98]
        ]
      },
      {
        desc: 'Time range excludes some later entries in initial data',
        timeRange: [1000, 3000],
        initialData: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 4000, 98],
          [4000, 5000, 97]
        ],
        expected: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 3000, 98],
        ]
      },
      {
        desc: 'Time range excludes earlier and later entries in initial data',
        timeRange: [2000, 3000],
        initialData: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 4000, 98],
          [4000, 5000, 97]
        ],
        expected: [
          [2000, 3000, 99],
          [3000, 3000, 98],
        ]
      }
    ];
    tests.forEach(function(t) {
      var mockControl = new MockControl();
      var stub = new PropertyReplacer();

      var mockContext = mockControl.createStrictMock(Context);
      stub.set(mockContext, 'visSize', [200, 100]);
      mockContext.invertPosition(mockmatchers.isNumber)
          .$returns(t.timeRange[0]);
      mockContext.invertPosition(mockmatchers.isNumber)
          .$returns(t.timeRange[1]);
      mockControl.$replayAll();

      var levelData =
          new Data([testUtils.createData(t.initialData)], mockContext, false);

      var expected = testUtils.createData(t.expected);
      var gotArray = levelData.getDisplayedData();
      assertEquals(gotArray.length, 1);
      var gotData = gotArray[0];
      assertObjectEquals(t.desc + ': Expected ' + JSON.stringify(expected) +
          ', got ' + JSON.stringify(gotData), expected, gotData);

      mockControl.$verifyAll();
      mockControl.$tearDown();
    });
  }
});
