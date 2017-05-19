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

goog.provide('historian');
goog.provide('historian.Panel');
goog.provide('historian.formData');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('historian.HistorianV2');
goog.require('historian.State');
goog.require('historian.appstats');
goog.require('historian.comparison');
goog.require('historian.constants');
goog.require('historian.data');
goog.require('historian.histogramstats');
goog.require('historian.historianV2Logs');
goog.require('historian.history');
goog.require('historian.menu');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.note');
goog.forwardDeclare('historian.requests');
goog.require('historian.tables');


/**
 * The properties and states of the panel in historian.
 *
 * selector: The selector string of the panel container.
 * toggleSelector: The selector of the panel's toggler button.
 * show: The current display state (shown/hidden) of the panel.
 * resizable: Whether the panel is vertically resizable.
 * toggable: Whether the panel can be hidden.
 * numCols: The number of columns the panel occupies in its row.
 *     The default is 12 (full width of bootstrap).
 * onResize: The function to call when the panel is resized.
 * onShow: The function to call when the panel begins to show.
 * onShown: The function to call when the panel is completely shown.
 * onHide: The function to call when the panel begins to hide.
 * onHidden: The function to call when the panel is completely hidden.
 * height: The height of the panel. Initially this is the default height.
 *
 * @struct
 * @typedef {{
 *   selector: string,
 *   menuSelector: string,
 *   toggleSelector: string,
 *   show: boolean,
 *   resizable: ?boolean,
 *   toggable: ?boolean,
 *   numCols: ?number,
 *   onResize: ?Function,
 *   onShow: ?Function,
 *   onShown: ?Function,
 *   onHide: ?Function,
 *   onHidden: ?Function,
 *   defaultHeight: ?number
 * }}
 */
historian.Panel;


/**
 * @private @const {!Object<!historian.Panel>}
 */
historian.panels_ = {
  fileinfo: {
    selector: '#panel-fileinfo',
    menuSelector: '#menu-fileinfo',
    toggleSelector: '#toggle-fileinfo',
    show: true,
    toggable: true
  },
  historian: {
    selector: '#panel-historian',
    menuSelector: '#menu-historian',
    toggleSelector: '#toggle-historian',
    show: true,
    resizable: true,
    toggable: true,
    numCols: 8,
    height: 600
  },
  historian2: {
    selector: '#panel-historian2',
    menuSelector: '#menu-historian2',
    toggleSelector: '#toggle-historian2',
    show: true,
    resizable: true,
    toggable: true,
    numCols: 8,
    height: 600
  },
  powerstats: {
    selector: '#panel-powerstats',
    menuSelector: '#menu-powerstats',
    toggleSelector: '#toggle-powerstats',
    show: false,
    resizable: false,
    toggable: true,
    height: 850
  },
  tables: {
    selector: '#panel-tables',
    show: true,
    resizable: true,
    height: 800
  }
};


/** @type {?FormData} */
historian.formData = null;


/** @type {!Array<!FormData>} */
historian.compareFormData = [];


/** @const {number} */
historian.MIN_PANEL_HEIGHT = 250;


/** @private {!historian.State} */
historian.state_;


/**
 * Historian V1 loading has been requested.
 */
historian.historianV1Requested = false;


/**
 * Historian V2 timelines for the default single bug report analysis view.
 * @private @const {!Array<!historian.HistorianV2.Timeline>}
 */
historian.singleView_ = [
  {
    panel: historian.panels_.historian.selector,
    tabSelector: '#tab-historian-v2',
    container: '#historian-v2',
    barOrder: historian.metrics.BATTERY_HISTORY_ORDER,
    barHidden: historian.metrics.BATTERY_HISTORY_HIDDEN,
    logSources: [historian.historianV2Logs.Sources.BATTERY_HISTORY],
    logSourcesHidden: [],
    defaultXExtentLogs: [
      historian.historianV2Logs.Sources.BATTERY_HISTORY,
      historian.historianV2Logs.Sources.POWER_MONITOR
    ],
    showReportTaken: false
  },
  {
    // This is shown on the same panel as the default battery history timeline,
    // but in a different tab.
    panel: historian.panels_.historian.selector,
    tabSelector: '#tab-historian-system-health',
    container: '#historian-system-health',
    barOrder: [
      {
        source: historian.historianV2Logs.Sources.HEADING,
        name: historian.metrics.Headings.MEMORY
      },
      {
        source: historian.historianV2Logs.Sources.EVENT_LOG,
        name: historian.metrics.Csv.AM_PSS
      },
      {
        source: historian.historianV2Logs.Sources.CUSTOM,
        name: historian.metrics.Csv.AM_LOW_MEMORY_ANR
      },
      {
        source: historian.historianV2Logs.Sources.KERNEL_DMESG,
        name: historian.metrics.Csv.LOW_MEMORY_KILLER
      },
      {
        source: historian.historianV2Logs.Sources.CUSTOM,
        name: historian.metrics.Csv.GC_PAUSE
      },

      {
        source: historian.historianV2Logs.Sources.HEADING,
        name: historian.metrics.Headings.PERFORMANCE
      },
      {
        source: historian.historianV2Logs.Sources.CUSTOM,
        name: historian.metrics.Csv.AM_PROC
      },
      {
        source: historian.historianV2Logs.Sources.SYSTEM_LOG,
        name: historian.metrics.Csv.CHOREOGRAPHER_SKIPPED
      },
      {
        source: historian.historianV2Logs.Sources.EVENT_LOG,
        name: historian.metrics.Csv.DVM_LOCK_SAMPLE
      },
      {
        source: historian.historianV2Logs.Sources.SYSTEM_LOG,
        name: historian.metrics.Csv.STRICT_MODE_VIOLATION
      },
      {
        source: historian.historianV2Logs.Sources.SYSTEM_LOG,
        name: historian.metrics.Csv.BACKGROUND_COMPILATION
      },

      {
        source: historian.historianV2Logs.Sources.HEADING,
        name: historian.metrics.Headings.ACTIVE_BROADCASTS
      },
      {
        source: historian.historianV2Logs.Sources.BROADCASTS_LOG,
        name: historian.metrics.Csv.ACTIVE_BROADCAST_FOREGROUND
      },
      {
        source: historian.historianV2Logs.Sources.BROADCASTS_LOG,
        name: historian.metrics.Csv.ACTIVE_BROADCAST_BACKGROUND
      },
      {
        source: historian.historianV2Logs.Sources.HEADING,
        name: historian.metrics.Headings.HISTORICAL_BROADCASTS
      },
      {
        source: historian.historianV2Logs.Sources.BROADCASTS_LOG,
        name: historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND
      },
      {
        source: historian.historianV2Logs.Sources.BROADCASTS_LOG,
        name: historian.metrics.Csv.BROADCAST_DISPATCH_FOREGROUND
      },
      {
        source: historian.historianV2Logs.Sources.BROADCASTS_LOG,
        name: historian.metrics.Csv.BROADCAST_ENQUEUE_BACKGROUND
      },
      {
        source: historian.historianV2Logs.Sources.BROADCASTS_LOG,
        name: historian.metrics.Csv.BROADCAST_DISPATCH_BACKGROUND
      },

      {
        source: historian.historianV2Logs.Sources.HEADING,
        name: 'Other'
      },
      {
        source: historian.historianV2Logs.Sources.EVENT_LOG,
        name: historian.metrics.Csv.AM_WTF
      },
      {
        source: historian.historianV2Logs.Sources.CUSTOM,
        name: historian.metrics.Csv.CRASHES
      },
      {
        source: historian.historianV2Logs.Sources.KERNEL_DMESG,
        name: historian.metrics.Csv.SELINUX_DENIAL
      },
      {
        source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
        name: historian.metrics.Csv.SCREEN_ON
      },
      {
        source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
        name: historian.metrics.Csv.TOP_APPLICATION
      }
    ],
    barHidden: [],
    logSources: [],
    logSourcesHidden: [],
    defaultLevelMetricOverride: historian.metrics.Csv.AM_PROC,
    defaultXExtentLogs: [
      historian.historianV2Logs.Sources.BROADCASTS_LOG,
      historian.historianV2Logs.Sources.EVENT_LOG,
      historian.historianV2Logs.Sources.KERNEL_DMESG,
      historian.historianV2Logs.Sources.SYSTEM_LOG
    ],
    showReportTaken: true
  },
  {
    panel: historian.panels_.historian.selector,
    tabSelector: '#tab-historian-event-log',
    container: '#historian-event-log',
    // Prioritize displaying event log groups that have been customized.
    barOrder: [].concat(
        [
          {
            source: historian.historianV2Logs.Sources.CUSTOM,
            name: historian.metrics.Csv.AM_PROC
          },
          {
            source: historian.historianV2Logs.Sources.CUSTOM,
            name: historian.metrics.Csv.AM_LOW_MEMORY_ANR
          },
          {
            source: historian.historianV2Logs.Sources.EVENT_LOG,
            name: historian.metrics.Csv.AM_WTF
          },
          {
            source: historian.historianV2Logs.Sources.EVENT_LOG,
            name: historian.metrics.Csv.DVM_LOCK_SAMPLE
          }
        ],
        historian.metrics.makeGroupProperties(
            historian.historianV2Logs.Sources.EVENT_LOG,
            Object.keys(historian.metrics.EventLogProperties)
        ),
        [
          {
            source: historian.historianV2Logs.Sources.EVENT_LOG,
            name: historian.metrics.Csv.APP_TRANSITIONS
          }
        ]
    ),
    barHidden: [],
    logSources: [historian.historianV2Logs.Sources.EVENT_LOG],
    logSourcesHidden: [historian.historianV2Logs.Sources.BATTERY_HISTORY],
    defaultLevelMetricOverride: '',  // Disable default level metric.
    defaultXExtentLogs: [historian.historianV2Logs.Sources.EVENT_LOG],
    showReportTaken: true
  },
  {
    panel: historian.panels_.historian.selector,
    tabSelector: '#tab-historian-custom',
    container: '#historian-custom',
    barOrder: [],
    barHidden: [],
    logSources: [],
    // Allow the user to add any event.
    logSourcesHidden: Object.keys(historian.historianV2Logs.Sources).map(
        function(source) {
          return historian.historianV2Logs.Sources[source];
        }),
    defaultLevelMetricOverride: '',  // Disable default level metric.
    defaultXExtentLogs: [],  // Fit any shown data.
    showReportTaken: true
  }
];


/**
 * Historian V2 timelines for the comparison analysis view.
 * @private @const {!Array<!historian.HistorianV2.Timeline>}
 */
historian.comparisonView_ = [
  {
    panel: historian.panels_.historian.selector,
    container: '#historian-v2',
    barOrder: historian.metrics.BATTERY_HISTORY_ORDER,
    barHidden: historian.metrics.BATTERY_HISTORY_HIDDEN,
    logSources: [],
    logSourcesHidden: [],
    defaultXExtentLogs: [historian.historianV2Logs.Sources.BATTERY_HISTORY],
    showReportTaken: false
  },
  {
    panel: historian.panels_.historian2.selector,
    container: '#historian-v2-2',
    barOrder: historian.metrics.BATTERY_HISTORY_ORDER,
    barHidden: historian.metrics.BATTERY_HISTORY_HIDDEN,
    logSources: [],
    logSourcesHidden: [],
    defaultXExtentLogs: [historian.historianV2Logs.Sources.BATTERY_HISTORY],
    showReportTaken: false
  }
];


/**
 * Creates and populates the HistorianV2 object for the given timeline.
 * @param {!historian.HistorianV2.Timeline} timeline Timeline properties
 *     to use, and to populate with the constructed HistorianV2 object.
 * @param {!historian.HistorianV2Data} data Data for the timeline.
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @param {boolean} showPowerStats Whether to show power stats for this
 *     timeline.
 * @param {number} startMs Start time for the default domain of the timeline.
 * @param {number} endMs End time for the default domain of the timeline.
 * @private
 */
historian.constructTimeline_ = function(timeline, data, levelSummaryData,
    showPowerStats, startMs, endMs) {

  // Make sure the specified order of groups only contains unique entries.
  // We want to give priority for the first listed instance.
  var orderHash = {};
  for (var i = 0; i < timeline.barOrder.length;) {
    var entry = timeline.barOrder[i];
    var hash = historian.metrics.hash(entry);
    if (hash in orderHash) {
      timeline.barOrder.splice(i, 1);
    } else {
      orderHash[hash] = true;
      i++;
    }
  }

  var groups = data.barGroups;

  // Creates an empty group so the heading will show up.
  var addHeadingData = function(name) {
    groups.add({
      name: name,
      index: null,
      source: historian.historianV2Logs.Sources.HEADING,
      series: []
    });
  };
  var prevHeading = null;
  var foundSeries = false;
  timeline.barOrder.forEach(function(groupProperties) {
    if (groupProperties.source == historian.historianV2Logs.Sources.HEADING) {
      // Only output the heading if any series were found for it.
      // e.g. 'Historical Broadcasts' heading should only be shown if any
      // historical enqueue or dispatch series exists.
      if (prevHeading && foundSeries) {
        addHeadingData(prevHeading.name);
      }
      prevHeading = groupProperties;
      foundSeries = false;
    } else if (groups.contains(groupProperties.source, groupProperties.name)) {
      foundSeries = true;
    }
  });
  if (prevHeading && foundSeries) {
    addHeadingData(prevHeading.name);
  }

  var hiddenHash = {};
  timeline.barHidden.forEach(function(groupProperties) {
    var hash = historian.metrics.hash(groupProperties);
    hiddenHash[hash] = true;
  });
  var powerStatsContainer = showPowerStats ?
      $(historian.panels_.powerstats.selector + ' .panel-body') : null;

  // Find any groups which are from the specified log sources,
  // and add them to be displayed.
  groups.getAll().forEach(function(group) {
    var hash = historian.metrics.hash(group);
    // Don't add it if it's already specified in the hidden or order maps.
    if (hash in hiddenHash || hash in orderHash) {
      return;
    }
    var matchingLogSource = group.series.filter(function(series) {
      return goog.array.contains(timeline.logSources, series.source);
    });
    if (matchingLogSource.length > 0) {
      // If there are too many groups to display, hide them by default.
      if (timeline.barOrder.length < 30) {
        timeline.barOrder.push({source: group.source, name: group.name});
        orderHash[hash] = true;
      } else {
        hiddenHash[hash] = true;
      }
      return;
    }
    matchingLogSource = group.series.filter(function(series) {
      return goog.array.contains(timeline.logSourcesHidden, series.source);
    });
    if (matchingLogSource.length > 0) {
      hiddenHash[hash] = true;
    }
  });
  // Don't use falsy check as defaultLevelMetricOverride can be an empty
  // string, which means don't display any level metric by default.
  if (typeof timeline.defaultLevelMetricOverride != 'undefined') {
    data.defaultLevelMetric = timeline.defaultLevelMetricOverride;
  }
  var defaultXExtent = startMs && endMs ? {min: startMs, max: endMs} :
      historian.historianV2Logs.getExtent(
          data.logToExtent, timeline.defaultXExtentLogs);

  timeline.historian = new historian.HistorianV2(
      $(timeline.container), data, levelSummaryData, historian.state_,
      powerStatsContainer, $(timeline.panel + ' .panel-body'), hiddenHash,
      timeline.barOrder, timeline.showReportTaken, defaultXExtent);
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


/**
 * Adds event listeners to the menu items.
 */
historian.initPanelControls = function() {
  $.each(historian.panels_, function(name, panel) {
    var jqPanel = $(panel.selector);
    // Add panel toggles.
    if (panel.toggable) {
      var jqMenu = $(panel.menuSelector);
      var jqToggle = $(panel.toggleSelector);
      jqMenu.click(function() {
        jqToggle.trigger('click');
      });
      jqPanel
          .on('hide.bs.collapse', function() {
            jqToggle.hide();
            // Not using jqMenu.children('.glyphicon').hide()
            // because it will move the menu text to the left.
            jqMenu.children('.glyphicon').css('opacity', 0);
            if (panel.onHide) panel.onHide();
          })
          .on('hidden.bs.collapse', function() {
            jqPanel.hide();
            historian.panels_[name].show = false;
            if (panel.onHidden) panel.onHidden();
          })
          .on('show.bs.collapse', function() {
            jqPanel.show();
            jqToggle.show();
            jqMenu.children('.glyphicon').css('opacity', 1);
            historian.panels_[name].show = true;
            if (panel.onShow) panel.onShow();
          })
          .on('shown.bs.collapse', function() {
            if (panel.height) jqPanel.css('height', panel.height);
            jqPanel.find('.panel-body').trigger('historian.resize');
            if (panel.onShown) panel.onShown();
          });
    }

    // Add panel resizers.
    if (panel.resizable) {
      jqPanel.resizable({
        minHeight: historian.MIN_PANEL_HEIGHT,
        handles: 's',
        start: function() {
          $(window).off('resize');
        },
        stop: function() {
          $(window).resize(historian.windowResizeHandler);
        },
        resize: function() {
          jqPanel.find('.panel-body').trigger('historian.resize');
          if (panel.onResize) panel.onResize();
          panel.height = jqPanel.height();
        }
      });

      // Initialize panel heights.
      if (panel.height) {
        jqPanel.css('height', panel.height);
      }
    }
  });
  $(window).resize(historian.windowResizeHandler);
};


/**
 * Hides the panels that are invisible by default.
 */
historian.initPanelVisibility = function() {
  $.each(historian.panels_, function(name, panel) {
    var jqPanel = $(panel.selector);
    if (panel.toggable) {
      var jqMenu = $(panel.menuSelector);
      var jqToggle = $(panel.toggleSelector);
      // Hide the panel if its default visibility is hidden.
      if (!panel.show) {
        jqToggle.hide();
        jqPanel.removeClass('in').hide().css('height', '');
        jqMenu.children('.glyphicon').css('opacity', 0);
        if (panel.onHidden) {
          panel.onHidden();
        }
      }
    }
  });
};


/**
 * Resizes all panels upon window resize.
 * @param {!Object} event The jQuery resize event.
 */
historian.windowResizeHandler = function(event) {
  // First disable window resize handler to avoid resize loop
  // resulting from window getting resized by panel resize.
  $(window).off('resize');
  $.each(historian.panels_, function(name, panel) {
    if (panel.show) {
      $(panel.selector + ' .panel-body').trigger('historian.resize');
    }
  });
  $(window).resize(historian.windowResizeHandler);
};


/**
 * Enables the error and warning dialogs to show the corresponding data.
 */
historian.initErrorAndWarning = function() {
  // Dialog is used to show erros and warnings.
  $('#dialog-message').dialog({
    modal: true,
    buttons: {
      Ok: function() {
        $(this).dialog('close');
      }
    }
  });
  $('#btn-errors').click(function() {
    var content = $('<pre></pre>')
        .text(/** @type {string} */($('#errors').text()));
    historian.menu.showDialog('Errors',
                         /** @type {string} */(content.html()), 'multi-line');
  });
  $('#btn-warnings').click(function() {
    var content = $('<pre></pre>')
        .text(/** @type {string} */($('#warnings').text()));
    historian.menu.showDialog('Warnings',
        /** @type {string} */(content.html()), 'multi-line');
  });
};


/**
 * Displays Historian V1 and removes other panels.
 */
historian.showOnlyHistorianV1 = function() {
  historian.note.show(historian.criticalError);
  $('.sdk-version-21').remove();
  $('.comparison').remove();
  $('#historian').addClass('in active');
  $('#tab-historian').addClass('active');
  historian.loadHistorianV1();
};


/**
 * Sets up the historian page once it is loaded.
 * @param {!Array<!historian.HistorianV2.Timeline>} timelines
 * @param {!historian.HistorianV2Data} data Data which will be cloned for each
 *     timeline.
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @param {boolean} hasPowerMonitorData Whether power monitor data is available
 *     for the report.
 * @param {number} startMs Start time for batterystats.
 * @param {number} endMs End time for batterystats.
 */
historian.initHistorianTabs = function(timelines, data, levelSummaryData,
    hasPowerMonitorData, startMs, endMs) {

  var showTabContents = function(timeline, idx) {
    if (!timeline.historian) {
      // It's much faster to deep clone the data rather than process it again.
      var dataCopy = /** @type {!historian.HistorianV2Data} */ (
          jQuery.extend(true, {}, data));
      // jQuery deep cloning doesn't copy 'prototype',
      // so we have to clone barGroups manually.
      dataCopy.barGroups = new historian.metrics.DataHasher();
      // The group properties (such as index) will be modified but not the
      // series objects themeselves, so we can make a shallow copy of
      // each series.
      data.barGroups.getAll().forEach(function(group) {
        dataCopy.barGroups.add({
          name: group.name,
          source: group.source,
          series: group.series,
          index: null
        });
      });
      // Only want to attach the power stats container if power monitor data is
      // available and only to the first timeline (battery history).
      var showPowerStats = hasPowerMonitorData && idx == 0;
      historian.constructTimeline_(timeline, dataCopy, levelSummaryData,
          showPowerStats, idx == 0 ? startMs : 0,
          idx == 0 ? endMs : 0);
    }
    timeline.historian.render();
  };

  var defaultTabIdx = goog.array.findIndex(timelines, function(timeline) {
    return $(timeline.tabSelector).hasClass('active');
  });
  goog.asserts.assert(defaultTabIdx >= 0);
  var removedFirstTab = false;
  timelines.forEach(function(timeline, idx) {
    if (!timeline.tabSelector) {
      return;
    }
    // Hide tab if there is no data for any of the timeline's expected logs.
    // The custom tab doesn't have expected logs, but should not be hidden.
    if (timeline.defaultXExtentLogs.length > 0) {
      var hasLog = timeline.defaultXExtentLogs.some(function(log) {
        return log in data.logToExtent;
      });
      if (!hasLog) {
        $(timeline.container).remove();
        $(timeline.tabSelector).remove();
        if (idx == 0) {
          removedFirstTab = true;
        }
        return;
      }
    }
    $(timeline.tabSelector)
        .on('shown.bs.tab', showTabContents.bind(null, timeline, idx));
    $(timeline.tabSelector).on('hide.bs.tab', function() {
      // If tab change has been triggered, notify Historian v2 so it will
      // ignore mouseover events that occur in the transitioning period.
      if (timeline.historian) {
        timeline.historian.setDisplayed(false);
      }
    });
  });

  if (removedFirstTab) {
    // We need to set the next available tab as active so the page loads
    // correctly. Battery history tab may not present for some reports.
    for (var i = 0; i < timelines.length; i++) {
      var tab = $(timelines[i].tabSelector);
      if (tab.length > 0) {
        tab.find('a').tab('show');
        break;
      }
    }
  }

  showTabContents(timelines[defaultTabIdx], defaultTabIdx);
  $('#tab-historian').on('shown.bs.tab', function() {
    if (!historian.historianV1Requested) {
      historian.historianV1Requested = true;
      historian.loadHistorianV1();
    }
  });
};


/**
 * Sets up the menu click listeners.
 */
historian.initMenu = function() {
  historian.menu.initMenu();
};


/**
 * Sets up the app selector and its listeners.
 */
historian.initAppSelector = function() {
  var highlightAppSelector = function() {
    $('#app-selector')
        .animate({
          'background-color': '#ffec6b',
          'padding': '10px 0px'
        },
        historian.constants.TRANSITION_DURATION * 2, function() {
          $('#app-selector')
              .animate({
                'background-color': '',
                'padding': ''
              }, historian.constants.TRANSITION_DURATION * 2);
        });
  };
  var chooseAppTimer;
  $('.choose-app')
      .mouseover(function() {
        highlightAppSelector();
        chooseAppTimer = setInterval(function() {
          highlightAppSelector();
        }, historian.constants.TRANSITION_DURATION * 4);
      })
      .mouseout(function() {
        clearInterval(chooseAppTimer);
      });
};


/**
 * Determines the app selected by the user and intitiates the showing of its
 * details, or shows the message that no app has been selected if a user clears
 * the app selection.
 */
historian.displaySelectedApp = function() {
  var val = $('#appSelector').val();
  if (!val) {
    historian.appstats.showNoSelection();
  } else {
    historian.appstats.displayApp(/** @type {string} */(val));
  }
};


/**
 * Initializes all historian components.
 * @param {!historian.requests.JSONData} json JSON data object sent back from
 *     the server analyzer.
 */
historian.initialize = function(json) {
  var data = json.UploadResponse;

  var levelSummaryCsv = data[0].levelSummaryCsv;
  historian.sdkVersion = data[0].sdkVersion;
  historian.usingComparison = json.usingComparison;
  historian.criticalError = data[0].criticalError;
  historian.reportVersion = data[0].reportVersion;
  if (data[0].note) {
    historian.note.show(data[0].note);
  }

  var displayPowerMonitor = false;
  if (historian.usingComparison) {
    if (data[1].sdkVersion < historian.sdkVersion) {
      historian.sdkVersion = data[1].sdkVersion;
    }
  } else {
    historian.deviceCapacity = data[0].deviceCapacity;
    displayPowerMonitor = data[0].displayPowerMonitor;
    if (displayPowerMonitor) {
      levelSummaryCsv = '';
    }
  }

  $('#body-contents').html(json.html);

  historian.state_ = new historian.State();
  historian.initErrorAndWarning();
  historian.initPanelControls();
  // Hide any panels hidden by default, allowing resizing to occur before
  // any rendering happens. This avoids potentially rendering the historian
  // v2 timeline twice. Data for hidden panels isn't created until first shown.
  historian.initPanelVisibility();

  /** @type {!Array<!historian.HistorianV2Data>} */
  var historianV2Data = [];

  var levelSummaryData = historian.data.processLevelSummaryData(
      levelSummaryCsv);
  historian.levelSummaryData_ = levelSummaryData;
  historian.initMenu(levelSummaryData);
  if (historian.sdkVersion < 21) {
    historian.showOnlyHistorianV1();
  } else {
    if (historian.criticalError) {
      historian.note.show(historian.criticalError);
    }
    // Get the devices that are reporting zero battery capacity.
    var badDevices = data.reduce(function(devices, datum, i) {
      return datum.deviceCapacity == 0 ? devices + i + ' ' : devices;
    }, '');
    if (badDevices != '') {
      historian.note.show(
          'Device(s) ' + badDevices + 'reported battery capacity 0.');
    }

    data.forEach(function(datum) {
      if (datum.historianV2Logs) {
        historianV2Data.push(historian.data.processHistorianV2Data(
            datum.historianV2Logs, parseInt(datum.deviceCapacity, 10),
            datum.timeToDelta, datum.location, datum.displayPowerMonitor,
            json.systemUiDecoder, datum.overflowMs));
      }
    });
    historian.tables.initialize();

    if (!historian.usingComparison) {
      historian.appstats.initialize(data[0].appStats);

      historian.initAppSelector();

      if (historianV2Data.length > 0) {
        var timelines = historian.singleView_;

        var hasPowerMonitorData = historianV2Data[0].barGroups.contains(
            historian.historianV2Logs.Sources.POWER_MONITOR,
            historian.metrics.Csv.POWER_MONITOR);

        var bs = data[0].batteryStats;
        var startMs = data[0].isDiff ? bs.start_time_usec / 1000 : 0;
        var endMs = data[0].isDiff && bs.system && bs.system.battery ?
            startMs + bs.system.battery.total_realtime_msec : 0;

        historian.initHistorianTabs(timelines, historianV2Data[0],
            levelSummaryData, hasPowerMonitorData, startMs || 0, endMs || 0);

        var batteryHistory = timelines[0].historian;
        if (batteryHistory) {
          var running = /** @type {?historian.SeriesGroup} */ (
              historianV2Data[0].barGroups.getBatteryHistoryData(
                  historian.metrics.Csv.CPU_RUNNING));
          // Only need to initialize if any wakeup reasons exist.
          if (running) {
            // Battery level data should exist if history is available,
            // but don't need to enforce it.
            var batteryLevel = /** @type {?historian.SeriesGroup} */ (
                historianV2Data[0].barGroups.getBatteryHistoryData(
                    historian.metrics.Csv.BATTERY_LEVEL));
            var batteryHistoryExtent = historianV2Data[0].logToExtent[
                historian.historianV2Logs.Sources.BATTERY_HISTORY];
            historian.history.initialize(batteryHistoryExtent,
                historianV2Data[0].location, running, batteryLevel,
                data[0].overflowMs);
          }
        }
      }

      if (!displayPowerMonitor) {
        // If no power monitor file was uploaded, no power stats will be
        // generated.
        $('#menu-powerstats').remove();
      }
      $('.comparison').remove();
    } else {
      historian.comparison.initialize();
      historian.histogramstats.initialize(
          data[0].histogramStats,
          data[1].histogramStats, json.combinedCheckin,
          data[0].fileName, data[1].fileName);

      historian.comparisonView_.forEach(function(timeline, idx) {
        historian.constructTimeline_(timeline, historianV2Data[idx],
            levelSummaryData, false, 0, 0);
        timeline.historian.render();
      });
    }
  }
};
