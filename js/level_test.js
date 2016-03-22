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

goog.provide('historian.levelTest');
goog.setTestOnly('historian.levelTest');

goog.require('goog.testing.jsunit');
goog.require('historian.LevelLine');


goog.scope(function() {


/**
 * Creates a single entry for a series.
 * @param {!Array<number>} arr
 * @return {!historian.Entry}
 */
var createTestEntry = function(arr) {
  return {startTime: arr[0], endTime: arr[1], value: arr[2]};
};


/**
 * Creates the data for the test series, given an array of arrays,
 * each containing the start time, end time and value of an entry.
 * @param {!Array<!Array<number>>} values
 * @return {!Array<!historian.Entry>}
 */
var createData = function(values) {
  var processedValues = [];
  values.forEach(function(v) {
    processedValues.push(createTestEntry(v));
  });
  return processedValues;
};


/**
 * Tests the adding of an extra level entry to the filtered data.
 */
window.testAdjustLevelData = function() {
  var tests = [
    {
      desc: 'Filtered data includes all the initial data',
      filteredData: [
        [1000, 2000, 100],
        [2000, 3000, 99],
        [3000, 4000, 98]
      ],
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
      desc: 'Filtered data excludes some earlier entries in initial data',
      filteredData: [
        [2000, 3000, 99],
        [3000, 4000, 98]
      ],
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
      desc: 'Filtered data excludes some later entries in initial data',
      filteredData: [
        [1000, 2000, 100],
        [2000, 3000, 99],
      ],
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
      desc: 'Filtered data excludes earlier and later entries in initial data',
      filteredData: [
        [2000, 3000, 99],
      ],
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
    var initial = createData(t.initialData);
    var filtered = createData(t.filteredData);

    historian.LevelLine.Data.adjustLevelData_(filtered, initial);
    var expected = createData(t.expected);

    assertObjectEquals(t.desc + ': Expected ' + JSON.stringify(expected) +
        ', got ' + JSON.stringify(filtered), expected, filtered);
  });
};


/**
 * Tests the filtering of data for the current viewable range.
 */
window.testInViewableRange = function() {
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
      desc: 'Single data point. Start time before entry start time, end time ' +
          ' before entry end time',
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
    }
  ];
  tests.forEach(function(t) {
    var data = createData(t.data);

    var result = historian.LevelLine.Data.inViewableRange(
        t.startTime, t.endTime, data);
    var expected = createData(t.expected);

    assertObjectEquals(t.desc + ': Expected ' + JSON.stringify(expected) +
        ', got ' + JSON.stringify(result), expected, result);
  });
};

});  // goog.scope
