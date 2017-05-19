/**
 * Copyright 2017 Google Inc. All Rights Reserved.
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

goog.module('historian.history');
goog.module.declareLegacyNamespace();

var data = goog.require('historian.data');
var googarray = goog.require('goog.array');
var googstring = goog.require('goog.string');
var time = goog.require('historian.time');


/**
 * This is to match the original bugbot histogram tool, which tallied
 * counts per 15 minute window.
 * @const {number}
 */
var BUCKET_SIZE = 15 * time.MSECS_IN_MIN;


/**
 * Adds click handlers to the buttons for showing wakeup reason count vs time
 * histograms.
 * @param {!historian.historianV2Logs.Extent} reportExtent Unix start and end
 *     time of the battery history log, in milliseconds.
 * @param {string} location The IANA time zone associated with the time data.
 *     e.g. 'Europe/London'.
 * @param {!historian.SeriesGroup} running Group containing running entries.
 * @param {?historian.SeriesGroup} batteryLevel Group containing battery level
 *     entries.
 * @param {?number} overflowMs The unix time in milliseconds of when the
 *     overflow occurred.
 */
exports.initialize = function(reportExtent, location, running, batteryLevel,
    overflowMs) {
  var bucketted = data.bucketWakeups(reportExtent.min, running, BUCKET_SIZE);

  var showHistogram = function() {
    var plotContainer = $(this).closest('div.sliding')
        .find('.wakeups-histogram');

    // The wakeup reason is in the 2nd column of the row.
    var wrCell = $(this).closest('tr').find('td:nth-child(2)');
    // The strings in the history stats tables have extra quotes.
    // The strings in the checkin tables may have translated names, but the
    // title will be the untranslated text.
    var wakeupReason = $(this).closest('table').is('#nocheckin') ?
        wrCell.text().trim().slice(1, -1).trim() :
        wrCell.attr('title').trim() || wrCell.text().trim();
    if (!(wakeupReason in bucketted)) {
      console.log('Could not find data for wakeup reason: ' + wakeupReason);
      plotContainer.hide();
      return;
    }

    var ticks = [];
    var prevDate = '';
    // Show a time tick label every hour, starting at report start time.
    for (var tickTime = reportExtent.min; tickTime < reportExtent.max;
         tickTime += time.MSECS_IN_HOUR) {
      var momentObj = moment(tickTime).tz(location);
      var formatted = momentObj.format('HH:mm:ss');
      // Leave out the year to save space. They're the same dates as the
      // historian timeline so the user could check there if necessary.
      var date = momentObj.format('MM-DD');
      // Only show the date if it's different from the previous tick.
      if (date != prevDate) {
        formatted = date + ' ' + formatted;
      }
      prevDate = date;
      ticks.push([tickTime, formatted]);
    }
    var options = {
      xaxis: {
        axisLabel: googstring.subs('Time (%s)',
            time.getTimeZoneShort(reportExtent.min, location)),
        labelHeight: 75,
        min: reportExtent.min,
        max: reportExtent.max,
        ticks: ticks
      },
      yaxes: [
        {
          axisLabel: 'Total count per 15m',
          min: 0,
          position: 'left'
        }
      ]
    };
    if (overflowMs) {
      options.grid = {
        markings: [
          {
            color: 'red',
            lineWidth: 1,
            xaxis: { from: overflowMs, to: overflowMs }
          }
        ]
      };
    }
    var runningData = bucketted[wakeupReason].map(function(entry) {
      return [entry.bucketMs, entry.count];
    });
    var seriesToPlot = [{
      data: runningData,
      bars: {
        show: true,
        barWidth: BUCKET_SIZE
      },
    }];
    if (batteryLevel) {
      var batteryLevelSeries =
          googarray.find(batteryLevel.series, function(series) {
            return series.type == 'int';
          });
      var batteryLevelData = batteryLevelSeries.values.map(function(entry) {
        return [entry.startTime, entry.value];
      });
      seriesToPlot.push({
        data: batteryLevelData,
        lines: {show: true},
        yaxis: 2
      });
      options.yaxes.push({
        axisLabel: 'Battery level',
        max: 100,
        min: 0,
        position: 'right'
      });
    }
    plotContainer.show()
        .find('.title').text(/** @type {string} */ (wakeupReason));
    $.plot(plotContainer.find('.plot'), seriesToPlot, options);
  };

  // There can be multiple #nocheckin tables, depending on how many summaries
  // there are. Selecting by attribute will return all matches. If we tried
  // to select $('#nocheckin') it would only return the first match.
  $('table#nocheckin, table#kernel-wakeup-reasons')
      .on('click', '.show-histogram', showHistogram);
};
