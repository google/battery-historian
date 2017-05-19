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

/**
 * @fileoverview List the table indices of historian
 */
goog.provide('historian.TableRow');
goog.provide('historian.tables');
goog.provide('historian.tables.Panes');

goog.require('historian.note');
goog.require('historian.time');
goog.require('historian.utils');


/**
 * Row definition of historian table. An array of elements for each column from
 * left to right. If a column element is a string, it is taken as the cell
 * value. Otherwise, it should be an object specifying the cell properties.
 *
 * Note: The row array may optionally contain a title attribute, which
 * is set to be the row's title.
 *
 * @typedef {Array<string|
 *   {
 *     value: string,
 *     title: ?string,
 *     classes: ?string
 *   }>
 * }
 */
historian.TableRow;


/** @const {number} */
historian.tables.JUMP_OFFSET = 30;


/** @const {string} */
historian.tables.CONTAINER_SELECTOR = '#panel-tables .panel-body';


/**
 * @enum {{
 *   container: string,
 *   tab: string,
 *   collapse: string
 * }}
 */
historian.tables.Panes = {
  SYSTEM: {
    container: '#checkin',
    tab: '#tab-system-stats',
    collapseHeader: '#collapse-header-system',
    collapse: '#collapse-system'
  },
  HISTORY: {
    container: '#history',
    tab: '#tab-history-stats',
    collapseHeader: '#collapse-header-history',
    collapse: '#collapse-history'
  },
  APP_STATS: {
    container: '#appstats',
    tab: '#tab-app-stats',
    collapseHeader: '#collapse-header-app',
    collapse: '#collapse-app'
  },
  HISTOGRAM_STATS: {
    container: '#histogramstats',
    tab: '#tab-histogram-stats',
    collapseHeader: '#collapse-header-histogram',
    collapse: '#collapse-histogram'
  }
};


/**
 * Adds a new table row to tElement (thead/tbody).
 * The row data could optionally have a title attribute, which is used as the
 * row's tooltip title.
 *
 * @param {jQuery} tElement The tbody (or thead) to add a row to.
 * @param {!historian.TableRow} data Table row data.
 */
historian.tables.addRow = function(tElement, data) {
  var tr = $('<tr></tr>').appendTo(tElement);
  if (data.title) tr.attr('title', data.title);
  data.forEach(function(d) {
    var td = $('<td></td>').appendTo(tr);
    if (typeof(d) == 'object') {
      td.text(d.value);
      if (d.title) {
        td.attr('title', d.title);
      }
      if (d.classes) {
        td.attr('class', d.classes);
      }
    } else {
      td.text(d);
    }
  });
};


/**
 * Creates a jQuery HTML table.
 * @param {?historian.TableRow} headRow A single row as the table header.
 * @param {!Array<!historian.TableRow>} bodyRows Rows as the table body.
 * @return {!jQuery}
 */
historian.tables.createTable = function(headRow, bodyRows) {
  var table = $('<table></table>');
  if (headRow) {
    var thead = $('<thead></thead>').appendTo(table);
    historian.tables.addRow(thead, headRow);
  }
  var tbody = $('<tbody></tbody>').appendTo(table);
  bodyRows.forEach(goog.bind(historian.tables.addRow, null, tbody));
  return table;
};


/**
 * Converts an HTML table to a DataTable.
 *
 * @param {!jQuery} tables The tables to convert to DataTables.
 *     Tables must have already been added to the HTML.
 */
historian.tables.activateDataTable = function(tables) {
  tables.each(function() {
    var table = $(this);
    var colDefs = [];
    var cols = $(table).find('thead > tr > *');
    if (cols.length > 0) {
      cols.each(function(index, col) {
        colDefs[index] = null;
        if ($(col).hasClass('duration'))
          colDefs[index] = {sType: 'duration'};
      });
    } else {
      // Populate colDefs with all null.
      for (var i = 0; i < $(table).find('tr')[0].cells.length; i++) {
        colDefs[i] = null;
      }
    }
    var jqTable = $(table);
    if (jqTable.hasClass('dataTable')) return;

    var noPaging = jqTable.hasClass('no-paging');
    var noOrdering = jqTable.hasClass('no-ordering');
    var noSearching = jqTable.hasClass('no-searching');
    var noInfo = jqTable.hasClass('no-info');
    jqTable.addClass('display').DataTable({
      aoColumns: colDefs,
      lengthMenu: [[5, 10, 25, 50, -1], [5, 10, 25, 50, 'All']],
      order: [],
      paging: !noPaging,
      ordering: !noOrdering,
      orderClasses: false,
      searching: !noSearching,
      info: !noInfo,
      pageLength: 5  // Zero is not a valid page length.
    });
  });
};


/**
 * Adds copy functionality to the tables.
 * @param {!jQuery} tables The tables to be added copy functionality.
 */
historian.tables.makeTablesCopiable = function(tables) {
  tables.each(function() {
    var table = $(this);
    historian.tables.activateTableCopy(table);
  });
};


/**
 * Returns the contents of the table as a string.
 * @param {!jQuery} table The table to return as a string.
 * @param {string=} opt_tableName The name of the table to use as a header.
 * @return {string} The table as a string.
 */
historian.tables.toString = function(table, opt_tableName) {
  var rows = $(table).find('tr').get();
  var maxLengths = rows
      .map(function(curValue, index) {
        var lengths = [];
        $(curValue).find('th, td').each(function() {
          lengths.push($(this).text().trim().length);
        });
        return lengths;
      })
      .reduce(function(curMax, lengths) {
        for (var i = 0; i < lengths.length; i++) {
          if (i >= curMax.length) {
            curMax.push(lengths[i]);
          } else {
            curMax[i] = Math.max(curMax[i], lengths[i]);
          }
        }
        return curMax;
      }, []);
  var tableName = opt_tableName || '';
  var content = rows
      .map(function(curValue, index) {
        var padded = [];
        var x = $(curValue).find('th, td');
        var numEmpty = 0;
        for (var i = 0; i < x.length; i++) {
          var text = /** @type {string} */ ($(x[i]).text().trim());
          if (text.length == 0) {
            numEmpty++;
          }
          padded.push(historian.utils.padString(
              text, maxLengths[i], ' '));
        }
        if (numEmpty != x.length) {
          // Tables without an official header will return an extra row
          // with empty values in this process. We just ignore them so we
          // don't create an extra row that is completely empty.
          return padded;
        }
      })
      .reduce(function(allContents, padded) {
        var addition = padded ? padded.join(' | ') + '\n' : '';
        return allContents + addition;
      }, tableName);
  return content;
};


/**
 * Adds copy functionality to a table.
 * @param {!jQuery} table The table that should have copy functionality enabled.
 */
historian.tables.activateTableCopy = function(table) {
  // Some table names can change (on demand app sorting), so just get a
  // reference to the span now. Pull out the actual table name when the copy
  // button is pressed.
  var tableNameSpan = $(table).parents()
      .prev('.summary-title-inline, .summary-title').find('span');
  $('<div>Copy</div>')
      .addClass('btn btn-default btn-xs table-copy')
      .prependTo($(table).parent())
      .click(function() {
        // Use the table name as a header, if possible.
        var tableName = tableNameSpan && tableNameSpan.text() ?
            tableNameSpan.text() + '\n' : '';
        var content = historian.tables.toString(table, tableName);
        var textArea = $('<textarea></textarea>')
            .val(content)
            .appendTo('body')
            .select();
        try {
          document.execCommand('copy');
          historian.note.show('Table content copied.', true);
        } catch (err) {
          historian.note.show('Unable to copy table content.', err.message);
        }
        textArea.remove();
      });
};


/**
 * Normalizes 'to-norm' table entries w.r.t. the summary duration.
 */
historian.tables.normalizeTableEntries = function() {
  var factor = historian.time.MSECS_IN_HOUR /
      historian.time.parseTimeString(
      /** @type {string} */($('#checkin #realtime').text()));
  $('.to-norm-timeval').each(function(key, element) {
    var e = $(element);
    var val = historian.time.parseTimeString(
        /** @type {string} */(e.text()));
    val = parseInt(val * factor, 10);
    e.text(historian.time.formatDuration(val).replace(/\s+/g, ''));
  });
  $('.to-norm-val').each(function(key, element) {
    var e = $(element);
    var val = (+e.text()) * factor;
    e.text(val.toFixed(2));
  });
  $('.to-norm-pctval').each(function(key, element) {
    var cell = $(element);
    var val = parseFloat(cell.text()) * factor;
    cell.text(val.toFixed(2));
  });
};


/**
 * Marks each table row, whose cell in column valuesColNumber contains no non-0
 * numerals, with the 'label-zero-value-row' class. Non-digits are ignored.
 * @param {jQuery} table The table whose rows are to be marked.
 * @param {number} valuesColNumber The column number (0-indexed) whose cells are
 *   searched for non-0 numerals.
 */
historian.tables.determineZeroValueRows = function(table, valuesColNumber) {
  table.find('tbody tr').each(function() {
    var row = this;
    var valueCell = row.cells[valuesColNumber];
    // Mark if valueCell does not contain a non-zero number.
    if (!/[1-9]/.test($(valueCell).html())) {
      $(row).addClass('label-zero-value-row');
    }
  });
};


/**
 * Initializes the tables.
 * Adds custom duration sorting to duration columns.
 * Normalizes some of the duration columns.
 * Converts the tables to DataTables.
 */
historian.tables.initTables = function() {
  // Add a customized sorting function for table durations.
  $.fn.dataTableExt.oSort['duration-asc'] = function(a, b) {
    var ta = historian.time.parseTimeString(a);
    var tb = historian.time.parseTimeString(b);
    return ta - tb;
  };
  $.fn.dataTableExt.oSort['duration-desc'] = function(a, b) {
    var ta = historian.time.parseTimeString(a);
    var tb = historian.time.parseTimeString(b);
    return tb - ta;
  };
  historian.tables.normalizeTableEntries();
  var toDataTables = $('.to-datatable');
  // Convert tables to DataTables.
  historian.tables.activateDataTable(toDataTables);
  // Add copy functionality to each table.
  historian.tables.makeTablesCopiable(toDataTables);

  // Enable showing/hiding breakdown tables.
  // Wakeup alarms by name.
  $('#show-wakeup-breakdown').change(function() {
    if ($(this).prop('checked')) {
      $('#wakeup-breakdown').show();
      $('#wakeup-no-breakdown').hide();
    } else {
      $('#wakeup-breakdown').hide();
      $('#wakeup-no-breakdown').show();
    }
  });
};


/**
 * Hides low metrics from appropriate checkin tables.
 */
historian.tables.initTablesHideLowMetrics = function() {
  var hidableTables = $('table#checkin.hidable-metrics');
  if (hidableTables.length == 0) return;
  // Show aggregated checkin stats with 0 levels only if checkbox checked.
  // 0-Values are determined by looking at Checkin's second column.
  historian.tables.determineZeroValueRows(hidableTables, 1);
  var lowAggCheckinRows = hidableTables.find('.label-zero-value-row');
  lowAggCheckinRows.hide();
  $('#show-low-metrics').change(function() {
    if ($(this).prop('checked')) {
      lowAggCheckinRows.show();
    } else {
      lowAggCheckinRows.hide();
    }
  });
};


/**
 * Generates the table togglers on the table headers.
 */
historian.tables.initTableTogglers = function() {
  // Hide all the tables by default.
  $('.sliding').hide();
  // Add a show-hide indicator button to each sliding element title
  $('<span></span>')
      .addClass('show-hide-inline glyphicon glyphicon-plus ' +
      'btn btn-default btn-xs')
      .prependTo('.summary-title-inline');
  $('.show-hide-inline')
      .addClass('glyphicon glyphicon-plus');
  // The inline titles are the actual "buttons".
  $('.summary-title-inline')
      .click(function() {
        historian.tables.toggleTable($(this));
      });
  $('.show-hide, .show-hide-inline').addClass('btn btn-default btn-xs');
};


/**
 * Generate the sidebar indices that jump to the tables upon clicks.
 */
historian.tables.initTableSidebar = function() {
  // Show the collapse hint icons.
  $.each(historian.tables.Panes, function(key, pane) {
    var header = $(pane.collapseHeader);
    header.click(function() {
      historian.tables.jumpToSelector(pane, '*');
    });
    $(pane.tab).click(function() {
      $(historian.tables.CONTAINER_SELECTOR).scrollTop(0);
    });
    $(pane.collapse)
        .on('show.bs.collapse', function() {
          $(pane.collapseHeader).children('.glyphicon')
          .addClass('glyphicon-triangle-bottom')
          .removeClass('glyphicon-triangle-right');
        })
        .on('hide.bs.collapse', function() {
          $(pane.collapseHeader).children('.glyphicon')
          .removeClass('glyphicon-triangle-bottom')
          .addClass('glyphicon-triangle-right');
        });
  });

  // Generate table indices for system stats.
  var ul = $('<ul></ul>')
      .addClass('list-group')
      .appendTo('#collapse-system');
  $('#checkin .summary-title, #checkin .summary-title-inline')
      .each(function() {
        var summary = $(this);
        var id = summary.attr('id');
        var selector = '#' + id;
        var title = summary.children('span:last').text();
        title = title.slice(0, title.length - 1); // Remove the last colon
        var li = $('<li></li>')
            .addClass('list-group-item')
            .text(/** @type {string} */(title))
            .attr('id', historian.utils.toValidID('toc-' + id))
            .click({selector: selector}, function(event) {
              // Prevent the page from going to top by default '#'
              event.preventDefault();
              var titleSelector = event.data.selector;
              historian.tables.jumpToTable(
                  historian.tables.Panes.SYSTEM, titleSelector);
            })
            .appendTo(ul);
        if (summary.css('display') == 'none') {
          li.hide();
        }
        this.listItem = li;
      });

  var wrappers = $('#history .summary-wrapper');
  // Generate table indices for history stats
  var select = $('#collapse-history select')
      .click(function(event) {
        var id = event.target.value;
        $('#collapse-history .summary-group').hide();
        $('#collapse-history #g' + id).show();
        historian.tables.showHistorySummary(id);
      });
  var numSummaries = $('#history').children('a').length;

  if (numSummaries) { // Initially display the first summary.
    $('#history #history-summary-0').show();
  }

  for (var i = 0; i < numSummaries; i++) {
    $('#history #top-link-' + i).click({id: i}, function(event) {
      event.preventDefault();
      historian.tables.showHistorySummary(event.data.id);
    });

    var range = $('#history #tm-range-' + i).children();
    var tmStart = $(range[0]).text(),
        tmEnd = $(range[1]).text();
    tmStart = historian.tables.normalizeTime_(
        /** @type {string} */(tmStart));
    tmEnd = historian.tables.normalizeTime_(
        /** @type {string} */(tmEnd));
    var tmString =
        moment(/** @type {string} */(tmStart)).format('HH:mm') +
        '-' +
        moment(/** @type {string} */(tmEnd)).format('HH:mm, MMM D');
    $('<option/>')
        .val(i + '')
        .text('Summary ' + i + ', ' + tmString)
        .appendTo(select);
    ul = $('<ul></ul>')
        .addClass('list-group summary-group')
        .attr('id', 'g' + i)
        .appendTo('#collapse-history');
    if (i) ul.hide();

    var summaries = $(wrappers[i])
        .find('.summary-title, .summary-title-inline');
    summaries.each(function() {
      var summary = $(this);
      var selector = '#' + summary.attr('id');
      var title = summary.children('span:last').text();
      title = title.slice(0, title.length - 1);
      var li = $('<li></li>')
          .addClass('list-group-item')
          .text(/** @type {string} */(title))
          .click({selector: selector}, function(event) {
            var titleSelector = event.data.selector;
            historian.tables.jumpToTable(historian.tables.Panes.HISTORY,
                titleSelector);
          })
          .appendTo(ul);
      this.listItem = li;
    });
  }

  // Generate the table indices for the app stats
  $('#appSelector').change(function(event) {
    // This is the only place that we call displaySelectedApp().
    // Avoid calling it twice. Sidebar generation shall go after this.
    historian.displaySelectedApp();

    historian.tables.jumpToTable(historian.tables.Panes.APP_STATS,
                                 '#miscSummary');
    // Clear previous list.
    $('#collapse-app').children('ul').remove();
    // Hide the non-existing but expanded tables.
    $('#appstats .summary-title-inline').each(function() {
      if (this.currentlyShowing && $(this).css('display') == 'none') {
        this.currentlyShowing = false;
        $(this).children('.glyphicon')
            .addClass('glyphicon-plus')
            .removeClass('glyphicon-minus');
        $(this).removeClass('summary-title-highlight');
      }
    });
    if ($('#appSelector').val() == '') return;

    var container = $('#appstats #selectedAppStats');
    var ul = $('<ul></ul>')
        .addClass('list-group')
        .appendTo('#collapse-app');
    $('<li></li>')
        .text('Misc Summary')
        .addClass('list-group-item')
        .click(function(event) {
          historian.tables.jumpToTable(
              historian.tables.Panes.APP_STATS, '#miscSummary');
        })
        .appendTo(ul);

    container.children('.summary-title-inline')
        .each(function() {
          var summary = $(this);
          // Ignore hidden empty tables.
          if (summary.css('display') == 'none') return;
          var selector = '#' + $(this).attr('id');
          var title = summary
              .children('span:last')
              .text();
          title = title.slice(0, title.length - 1);
          var li = $('<li></li>')
              .addClass('list-group-item')
              .text(/** @type {string} */(title))
              .click({selector: selector}, function(event) {
                var titleSelector = event.data.selector;
                historian.tables.jumpToTable(
                    historian.tables.Panes.APP_STATS, titleSelector);
              })
              .appendTo(ul);
          this.listItem = li;
        });
  });
};


/**
 * Adds click listeners for table jumping.
 */
historian.tables.initTableJumps = function() {
  $('#panel-tables .table-jump').each(function() {
    $(this).click(function() {
      var targetSelector = /** @type {string} */($(this).attr('data-jump'));
      // Table jumpings force expanding the tables.
      historian.tables.jumpToTable(
          historian.tables.Panes.SYSTEM, targetSelector, true);
    });
  });
};


/**
 * Prepares all the tables loaded in the tables panel.
 */
historian.tables.initialize = function() {
  historian.tables.initTables();
  historian.tables.initTablesHideLowMetrics();
  historian.tables.initTableTogglers();
  historian.tables.initTableSidebar();
  historian.tables.initTableJumps();
};


/**
 * Activate a pane in tables.
 * @private
 * @param {Object} pane
 */
historian.tables.activatePane_ = function(pane) {
  $('#panel-tables .tab-pane').removeClass('active in');
  $(pane.container).addClass('active in');
  $('#panel-tables .nav-tabs > li').removeClass('active');
  $(pane.tab).addClass('active');
  // Clear the scroll when pane is changed.
  $(historian.tables.CONTAINER_SELECTOR).scrollTop(0);
};


/**
 * Jump to a specified selector in a given pane.
 * @param {Object} pane Pane
 * @param {string} selector Selector to be jumped to
 */
historian.tables.jumpToSelector = function(pane, selector) {
  historian.tables.activatePane_(pane);
  var top;
  if (selector == '*') {
    // '*' denotes jumping to the top of the pane.
    top = 0;
  } else {
    top = $(pane.container).find(selector).first().position().top -
        historian.tables.JUMP_OFFSET;
  }
  $(historian.tables.CONTAINER_SELECTOR).scrollTop(top);
};


/** @const {number} */
historian.tables.ANIMATE_TIME = 400;


/** @const {number} */
historian.tables.ANIMATE_STEP = 20;


/** @const {number} */
historian.tables.FAST_ANIMATE_TIME = 100;


/**
 * Jump to a specified table
 * @param {Object} pane Pane containing the table.
 * @param {string} selector Selector of table title to be jumped to.
 * @param {boolean=} opt_expandState Optionally set an expand state.
 */
historian.tables.jumpToTable = function(pane, selector, opt_expandState) {
  var container = $(pane.container);
  var title = container.find(selector);
  if (title.length == 0) {
    // If the element was not found, we shouldn't try jumping to it.
    return;
  }
  var height = title.next('.sliding').height();
  var toggable = title.hasClass('summary-title-inline');

  var toExpand = toggable && !title[0].currentlyShowing &&
      opt_expandState != false;
  var toCollapse = toggable && title[0].currentlyShowing &&
      opt_expandState != true;

  historian.tables.activatePane_(pane);
  if (toExpand || toCollapse) {
    historian.tables.toggleTable(title);
    if (toExpand) {
      title.addClass('summary-title-highlight');
    }
    if (toCollapse) {
      title.removeClass('summary-title-highlight');
    }
  }

  // Show a smooth scrollTo animation.
  var timeElapsed = 0;
  var tableContainer = $(historian.tables.CONTAINER_SELECTOR);
  var interval = setInterval(function() {
    // Clear the scroll value to correctly obtain top offset.
    tableContainer.scrollTop(0);
    var top = title.position().top - historian.tables.JUMP_OFFSET;
    tableContainer.scrollTop(top);
    timeElapsed += historian.tables.ANIMATE_STEP;
    if (timeElapsed >= historian.tables.ANIMATE_TIME)
      clearInterval(interval);
  }, historian.tables.ANIMATE_STEP);
};


/**
 * Toggles a table after the given summary-title-inline.
 * @param {jQuery} table
 */
historian.tables.toggleTable = function(table) {
  var node = table[0];
  var state = !node.currentlyShowing;
  node.currentlyShowing = state;
  var sliding = table.next('.sliding');
  if (state) {
    table.children('.glyphicon')
        .addClass('glyphicon-minus')
        .removeClass('glyphicon-plus');
    sliding.slideDown(state != undefined ?
                      historian.tables.FAST_ANIMATE_TIME :
                      historian.tables.ANIMATE_TIME);
    table.addClass('summary-title-highlight');
    node.listItem.addClass('list-item-active');
  } else {
    table.children('.glyphicon')
        .addClass('glyphicon-plus')
        .removeClass('glyphicon-minus');
    sliding.slideUp(state != undefined ?
                    historian.tables.FAST_ANIMATE_TIME :
                    historian.tables.ANIMATE_TIME);
    table.removeClass('summary-title-highlight');
    node.listItem.removeClass('list-item-active');
  }
};


/**
 * Show a history summary and jump to it.
 * @param {string|number} id Summary id
 */
historian.tables.showHistorySummary = function(id) {
  var pane = historian.tables.Panes.HISTORY;
  $(pane.container).find('.summary-wrapper').hide();
  $(pane.container).find('#history-summary-' + id).show();
  historian.tables.jumpToSelector(pane, '#history-summary-' + id);
};


/**
 * Convert a string received from server in go unix format
 * to non-deprecated format accepted by moment.js.
 * @private
 * @param {string} time
 *   Format: YYYY-MM-DD HH:mm:ss.SSS ZZ zone
 * @return {string}
 *   Format: YYYY-MM-DD HH:mm:ss.SSSZZ
 */
historian.tables.normalizeTime_ = function(time) {
  var len = time.length;
  return time.substr(0, len - 10) + time.substr(len - 8, 4);
};

