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

goog.module('historian.utilsTest');
goog.setTestOnly('historian.utilsTest');

var jsunit = goog.require('goog.testing.jsunit');
var testSuite = goog.require('goog.testing.testSuite');
var utils = goog.require('historian.utils');
var testUtils = goog.require('historian.testUtils');


testSuite({
  /**
   * Tests the calculating of total mAh for the given data.
   */
  testCalculateTotalCharge: function() {
    var tests = [
      {
        desc: '1 mA total charge.',
        data: [
          [11000, 12000, 1200],
          [12000, 13000, 1200],
          [13000, 14000, 1200]
        ],
        expected: '1.00'
      },
      {
        desc: 'Multiple readings per second.',
        data: [
          [11000, 11333, 800],
          [11333, 11666, 1200],
          [11666, 12000, 1600],
          [12000, 12333, 900],
          [12333, 12666, 300],
          [12666, 13000, 2400],
          [13000, 13333, 900],
          [13333, 13666, 300],
          [13666, 14000, 2400],
          [14000, 15000, 3600],
        ],
        expected: '2.00'
      },
      {
        desc: 'Reading not covering whole second',
        data: [
          [11000, 11500, 7200]
        ],
        expected: '1.00'
      }
    ];
    tests.forEach(function(t) {
      var result =
          utils.calculateTotalChargeFormatted(testUtils.createData(t.data));
      var expected = t.expected;

      assertEquals(t.desc + ': Expected ' + expected +
          ', got ' + result, expected, result);
    });
  },

  /**
   * Tests the filtering of data for the given time range.
   */
  testInTimeRange: function() {
    var tests = [
      {
        desc: 'Start time before start of data array, end time matching ' +
            'second entry end time.',
        data: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 4000, 98]
        ],
        startTime: 0,
        endTime: 3000,
        expected: [
          [1000, 2000, 100],
          [2000, 3000, 99]
        ]
      },
      {
        desc: 'Start time equal to an entry start time, end time after ' +
            'last entry end time.',
        data: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 4000, 98]
        ],
        startTime: 2000,
        endTime: 5000,
        expected: [
          [2000, 3000, 99],
          [3000, 4000, 98]
        ]
      },
      {
        desc: 'Start time after an entry start time, end time between ' +
            'entry start and end time',
        data: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 4000, 98]
        ],
        startTime: 2500,
        endTime: 3500,
        expected: [
          [2000, 3000, 99],
          [3000, 4000, 98]
        ]
      },
      {
        desc: 'Single data point. Start time before entry start time, ' +
            'end time before entry end time',
        data: [
          [1000, 2000, 100],
        ],
        startTime: 500,
        endTime: 1500,
        expected: [
          [1000, 2000, 100],
        ]
      },
      {
        desc: 'Start time matches entry start time, end time between entries',
        data: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 4000, 98],
          [4000, 5000, 97]
        ],
        startTime: 1000,
        endTime: 2500,
        expected: [
          [1000, 2000, 100],
          [2000, 3000, 99]
        ]
      },
      {
        desc: 'Start time equals entry start time, end time equals another ' +
            'entry end time',
        data: [
          [1000, 2000, 100],
          [2000, 3000, 99],
          [3000, 4000, 98],
          [4000, 5000, 97]
        ],
        startTime: 2000,
        endTime: 4000,
        expected: [
          [2000, 3000, 99],
          [3000, 4000, 98]
        ]
      },
      {
        desc: 'Start time and entry before before first entry start time',
        data: [
          [10, 20, 1],
          [20, 30, 2],
          [30, 40, 3]
        ],
        startTime: 1,
        endTime: 2,
        expected: []
      },
      {
        desc: 'Start time and end time after last end time in array',
        data: [
          [10, 20, 1],
          [20, 30, 2],
          [30, 40, 3]
        ],
        startTime: 100,
        endTime: 101,
        expected: []
      },
      {
        desc: 'Times not exactly matching array times',
        data: [
          [10, 20, 1],
          [20, 30, 2],
          [30, 40, 3],
          [40, 50, 4],
          [50, 60, 5]
        ],
        startTime: 29,
        endTime: 41,
        expected: [
          [20, 30, 2],
          [30, 40, 3],
          [40, 50, 4]
        ]
      },
      {
        desc: 'Time range starts after start time of last element and ends ' +
            'before end time of last element',
        data: [
          [10, 20, 1],
          [20, 30, 2],
          [30, 40, 3],
          [40, 50, 4],
          [50, 60, 5]
        ],
        startTime: 55,
        endTime: 58,
        expected: [
          [50, 60, 5]
        ]
      },
      {
        desc: 'Queried start time falls on the end time of an entry ' +
            'and queried end time falls on the start time of the next entry',
        data: [
          [10, 20, 1],
          [20, 30, 2],
          [30, 40, 3]
        ],
        startTime: 20,
        endTime: 20,
        expected: []
      },
      {
        desc: 'Multiple entries with same start and end times',
        multiOnly: true,
        data: [
          [1000, 2000, 'a'],
          [1000, 2000, 'b'],
          [2000, 3000, 'a'],
          [2000, 3000, 'b'],
          [3000, 4000, 'a'],
          [3000, 4000, 'b']
        ],
        startTime: 2000,
        endTime: 3000,
        expected: [
          [2000, 3000, 'a'],
          [2000, 3000, 'b']
        ]
      },
      {
        desc: 'Instant event at domain start time',
        data: [
          [2000, 2000, 'a']
        ],
        startTime: 2000,
        endTime: 10000,
        expected: [
          [2000, 2000, 'a']
        ]
      },
      {
        desc: 'Instant event at domain end time',
        data: [
          [10000, 10000, 'a']
        ],
        startTime: 2000,
        endTime: 10000,
        expected: [
          [10000, 10000, 'a']
        ]
      }
    ];
    tests.forEach(function(t) {
      var data = testUtils.createData(t.data);

      var result = utils.inTimeRangeMulti(t.startTime, t.endTime, data);
      var expected = testUtils.createData(t.expected);

      assertObjectEquals(t.desc +
          '[multi]: Expected ' + JSON.stringify(expected) +
          ', got ' + JSON.stringify(result), expected, result);

      if (!t.multiOnly) {
        result = utils.inTimeRange(t.startTime, t.endTime, data);
        expected = testUtils.createData(t.expected);

        assertObjectEquals(t.desc + ': Expected ' + JSON.stringify(expected) +
            ', got ' + JSON.stringify(result), expected, result);
      }
    });
  },
  // Tests the generating of the first derivative for the given data.
  testGenerativeDerivative: function() {
    var tests = [
      {
        desc: 'Empty array',
        data: [],
        expected: []
      },
      {
        desc: 'One element in array',
        data: [
          [11000, 11333, 800]
        ],
        expected: []
      },
      {
        desc: 'Multiple elements in array',
        data: [
          [0, 60000, 100],
          [60000, 90000, 99],
          [90000, 330000, 97],
          [330000, 330000, 99],
          [330000, 340000, 98]
        ],
        expected: [
          [0, 60000, -60],
          [60000, 90000, -240],
          [90000, 330000, 30],
          [330000, 330000, 0]
        ],
      }
    ];
    tests.forEach(function(t) {
      var result = utils.generateDerivative(testUtils.createData(t.data));
      var expected = testUtils.createData(t.expected);
      assertArrayEquals(t.desc + ': Expected ' + expected +
          ', got ' + result, expected, result);
    });
  },
  /** Tests the classifying of an event as screen on or screen off. */
  testIsMostlyScreenOffEvent: function() {
    var tests = [
      {
        desc: 'No screen on events',
        eventToCheck: [100, 200, 1],
        screenOnEvents: [],
        want: true
      },
      {
        desc: 'Event intersects mostly with screen on event',
        eventToCheck: [1000, 3000, 1],
        screenOnEvents: [
          [400, 800],
          [1500, 3000, true],
          [4000, 5000, true]
        ],
        want: false
      },
      {
        desc: 'Event intersects with start of screen on event',
        eventToCheck: [1000, 2000, 1],
        screenOnEvents: [
          [400, 800],
          [1500, 3000, true],
          [4000, 5000, true]
        ],
        want: true
      },
      {
        desc: 'Event intersects with end of screen on event',
        eventToCheck: [1000, 2000, 1],
        screenOnEvents: [
          [0, 1500, true],
          [2500, 3000, true]
        ],
        want: true
      },
      {
        desc: 'Event intersects mostly with end of screen on event',
        eventToCheck: [1000, 2000, 1],
        screenOnEvents: [
          [0, 1600, true],
          [2500, 3000, true]
        ],
        want: false
      },
      {
        desc: '40s event contains 21s screen on events',
        eventToCheck: [10000, 50000, 1],
        screenOnEvents: [
          [0, 11000, true],
          [12000, 19000, true],
          [22000, 25000, true],
          [40000, 50000, true]
        ],
        want: false
      },
      {
        desc: 'Screen on event contains entire event',
        eventToCheck: [10000, 20000, 1],
        screenOnEvents: [
          [0, 30000, true]
        ],
        want: false
      }
    ];
    tests.forEach(function(t) {
      var result = utils.isMostlyScreenOffEvent(
          testUtils.createTestEntry(t.eventToCheck),
          testUtils.createData(t.screenOnEvents));
      assertEquals(t.desc, t.want, result);
    });
  },
  testAvgByCategory: function() {
    var tests = [
      {
        desc: 'No events',
        events: [],
        getCategory: function(event) { return event.duringScreenOff; },
        want: []
      },
      {
        desc: 'Multiple events',
        events: [
          [1000, 2000, 16, true],
          [2000, 3000, 15, true],
          [3000, 5000, 14, false],
          [5000, 8000, 13, false],
          [6000, 10000, 12, true]
        ],
        getCategory: function(event) { return event.duringScreenOff; },
        want: [
          [1000, 2000, 15.5, true],
          [2000, 3000, 15.5, true],
          [3000, 5000, 13.4, false],
          [5000, 8000, 13.4, false],
          [6000, 10000, 12, true]
        ]
      },
    ];
    tests.forEach(function(t) {
      var arrToEvent = function(arr) {
        var event = testUtils.createTestEntry(arr);
        event.duringScreenOff = arr[3];
        return event;
      };
      var events = t.events.map(arrToEvent);
      var want = t.want.map(arrToEvent);

      utils.avgByCategory(events, t.getCategory);
      assertArrayEquals(t.desc, want, events);
    });
  }
});
