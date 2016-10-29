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

goog.provide('historian.timeTest');
goog.setTestOnly('historian.timeTest');

goog.require('goog.testing.jsunit');
goog.require('historian.time');


goog.scope(function() {

var MSECS_IN_HOUR = 60 * 60 * 1000;
var MSECS_IN_MIN = 60 * 1000;
var MSECS_IN_SEC = 1000;


/**
 * Tests the parseTimeString function.
 */
window.testParseTimeString = function() {
  var tests = [
    {
      input: '1h',
      expected: MSECS_IN_HOUR
    },
    {
      input: '1m',
      expected: MSECS_IN_MIN
    },
    {
      input: '1s',
      expected: MSECS_IN_SEC
    },
    {
      input: '1ms',
      expected: 1
    },
    {
      input: 'nothing',
      expected: 0
    },
    {
      input: '',
      expected: 0
    },
    {
      input: '0',
      expected: 0
    },
    {
      input: '12.345s',
      expected: 12 * MSECS_IN_SEC + 345
    },
    {
      input: '12.005s',
      expected: 12 * MSECS_IN_SEC + 5
    },
    {
      input: '12.05s',
      expected: 12 * MSECS_IN_SEC + 50
    },
    {
      input: '12.5s',
      expected: 12 * MSECS_IN_SEC + 500
    },
    {
      input: '12.87s',
      expected: 12 * MSECS_IN_SEC + 870
    },
    {
      input: '12.087s',
      expected: 12 * MSECS_IN_SEC + 87
    },
    {
      input: '345ms',
      expected: 345
    },
    {
      input: '345ms  ', // With space at end (after ms)
      expected: 345
    },
    {
      input: '12s345ms',
      expected: 12345
    },
    {
      input: '  12s 345ms  ', // With spaces
      expected: 12345
    },
    {
      input: '1h1m1s1ms',
      expected: MSECS_IN_HOUR + MSECS_IN_MIN + MSECS_IN_SEC + 1
    },
    {
      input: '11h22m33s44ms',
      expected: 11 * MSECS_IN_HOUR + 22 * MSECS_IN_MIN + 33 * MSECS_IN_SEC + 44
    },
    {
      input: '11h 22m 33s 44ms', // With spaces
      expected: 11 * MSECS_IN_HOUR + 22 * MSECS_IN_MIN + 33 * MSECS_IN_SEC + 44
    },
    {
      input: '7h9m',
      expected: 7 * MSECS_IN_HOUR + 9 * MSECS_IN_MIN
    },
    {
      input: '  7h9m', // With space at beginning (before hour)
      expected: 7 * MSECS_IN_HOUR + 9 * MSECS_IN_MIN
    },
    {
      input: '2m57.833s',
      expected: 2 * MSECS_IN_MIN + 57 * MSECS_IN_SEC + 833
    },
    {
      input: '2h 833ms', // With space
      expected: 2 * MSECS_IN_HOUR + 833
    },
    {
      input: '1h4.9s',
      expected: MSECS_IN_HOUR + 4 * MSECS_IN_SEC + 900
    },
    {
      input: '1.234ms',
      expected: 1.234
    },
    {
      input: '1hs',
      expected: 0
    },
    {
      input: '1ma',
      expected: 0
    },
    {
      input: '2.s',
      expected: 0
    },
    {
      input: '3.ms',
      expected: 0
    },
    {
      input: 'h1s',
      expected: 0
    },
    {
      input: '25.334',
      expected: 0
    }
  ];

  tests.forEach(function(t) {
    var output = historian.time.parseTimeString(t.input);
    assertEquals('Parsing \'' + t.input + '\'', t.expected, output);
  });
};

});  // goog.scope
