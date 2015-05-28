/**
 *
 * Copyright 2015 Google Inc. All Rights Reserved.
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

/**
 * @fileoverview summaries.js contains javascript scripts for summaries.html
 */

/**
 * Applies the customized 'duration' parser to the specified columns.
 *
 * @param {Node} tables the tables to modify. Must already be added to the HTML.
 * @param {Array<number>} durCols a list of column indices to apply the
 *                           'duration' parser to.
 * @param {bool} isScrollable whether the tables is scrollable.
 */
historian.activateTablesorter = function(tables, durCols, isScrollable) {
  tables.each(function(index, table){
    var m = {};
    for (var i = 0; i < durCols.length; i++) {
      m[durCols[i]] = {sorter: 'duration'};
    }

    if (isScrollable && $(table).find('tr').length > 6) {
      $(table).tablesorter({
        theme: 'blue',
        headerTemplate: '{content} {icon}',
        widgets: ['resizable', 'scroller'],
        widgetOptions: {
          scroller_height: 150,
          // scroll tbody to top after sorting
          scroller_upAfterSort: true,
          // pop table header into view while scrolling up the page
          scroller_jumpToHeader: true,
          //scroller_fixedColumns : 2,
          scroller_rowHighlight: 'hover',
          // we control the column width ourselves for scrolling table
          widthFixed: false,
        },
        headers: m
      });
    } else {
      $(table).tablesorter({
        theme: 'blue',
        headers: m
      });
    }
  })
};

/**
 * Loads and displays Historian V1.
 */
historian.loadHistorianV1 = function() {
  // Wait for the tab to finish rendering.
  google.load('visualization', '1', {
    packages: ['timeline'],
    'callback': function() {
      $('#historian-chart').removeClass('hidden');
      drawChart();
      $('#historian').children('.loading')[0].remove();
    }
  });
};

$(document).ready(function() {
  var HISTORY_TAB_INDEX = 2;

  // Add a customized parser for tablesorter.
  $.tablesorter.addParser({
    // Set a unique id 'duration'.
    id: 'duration',
    is: function(s) {
      // Return false so this parser is not auto detected.
      return false;
    },
    format: function(s) {
      // Format data for normalization.
      // The string which will be parsed can be in the format of
      // "2h2m48.373s" or "53m26.89s" or "58.267s" or "765ms" or "0"
      // the function formats all the data into one unified unit 'seconds'.
      if (s === 'MAXINT') {
        return Number.MAX_VALUE;
      }
      var c = 0;
      // If there is hours data existing in the string.
      if (s.indexOf('h') != -1) {
        c += s.substring(0, s.indexOf('h')) * 3600;
        s = s.substring(s.indexOf('h') + 1);
      }
      // If there is minutes data existing in the string.
      if (s.indexOf('m') != -1 && s.indexOf('m') != s.indexOf('ms')) {
        c += s.substring(0, s.indexOf('m')) * 60;
        s = s.substring(s.indexOf('m') + 1);
      }
      // If there is seconds data existing in the string.
      if (s.indexOf('s') != -1 && s.indexOf('s') != s.indexOf('ms') + 1) {
        c += s.substring(0, s.indexOf('s')) * 1;
        s = s.substring(s.indexOf('s') + 1);
      }
      // If there is milliseconds data existing in the string.
      if (s.indexOf('ms') != -1) {
        c += s.substring(0, s.indexOf('ms')) / 1000;
      }

      return c;
    },
    // Set type as numeric.
    type: 'numeric'
  });

  // Apply tablesort 'duration' parser to the Total Duration
  // and Max Duration columns.
  historian.activateTablesorter($('.tablesorter56'), [5, 6], false);
  // Duration columns are in the respective indices for the following.
  historian.activateTablesorter($('.tablesorter2'), [2], true);
  historian.activateTablesorter($('.tablesorter3'), [3], true);
  historian.activateTablesorter($('.tablesorter4'), [4], true);
  // Make sure all .tablesorter tables can sort.
  historian.activateTablesorter($('.tablesorter'), [], false);

  // Hide all the tables by default.
  $('.sliding').hide();
  // Switch between hide and how tables.
  $('.show-hide')
      .click(function(e) {
        var node = this;
        node.currently_showing = !node.currently_showing;
        $(node).text(node.currently_showing ? 'Hide' : 'Show');
        $(node).next('.sliding').slideToggle();
      });

  var requestHistorian = false;

  // Change tablesorter's background color according to level.
  // Change color of one row for checkin table.
  $('table#checkin.tablesorter tbody tr')
      .each(function() {
        var row = this;
        $(row).find('td').each(function() {
          var cell = this;
          switch ($(cell).html()) {
            case 'Top 10%':
              $(row).addClass('label-top');
              break;
            case 'High':
              $(row).addClass('label-high');
              break;
            case 'Medium':
              $(row).addClass('label-medium');
              break;
            default:
          }
        });
      });

  // Change tablesorter's background color according to level.
  // Change color of one cell for non-checkin table, because
  // they may contain multiple level cells in one row.
  $('table#nocheckin.tablesorter tbody tr')
      .each(function() {
        var row = this;
        $(row).find('td').each(function() {
          var cell = this;
          switch ($(cell).html()) {
            case 'Top 10%':
              $(cell).addClass('label-top');
              break;
            case 'High':
              $(cell).addClass('label-high');
              break;
            case 'Medium':
              $(cell).addClass('label-medium');
              break;
            default:
          }
        });
      });

  // Control tabs menu in result page.
  $('#tabs').tabs({
    activate: function(event, ui) {
      if (ui.newTab.index() == HISTORY_TAB_INDEX && !requestHistorian) {
        requestHistorian = true;
        // Wait for the tab to finish rendering.
        historian.loadHistorianV1();
      }
    }
  });
  $('#tabs').removeClass('hidden');
});
