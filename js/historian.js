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

goog.require('goog.asserts');
goog.require('historian.HistorianV2');
goog.require('historian.State');
goog.require('historian.appstats');
goog.require('historian.comparison');
goog.require('historian.constants');
goog.require('historian.data');
goog.require('historian.histogramstats');
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
    barHidden: historian.metrics.BATTERY_HISTORY_HIDDEN
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
    barHidden: historian.metrics.BATTERY_HISTORY_HIDDEN
  },
  {
    panel: historian.panels_.historian2.selector,
    container: '#historian-v2-2',
    barOrder: historian.metrics.BATTERY_HISTORY_ORDER,
    barHidden: historian.metrics.BATTERY_HISTORY_HIDDEN
  }
];


/**
 * Creates and populates the HistorianV2 objects for each timeline.
 * @param {!Array<!historian.HistorianV2.Timeline>} timelines Timeline
 *     properties to use, and to populate with constructed HistorianV2 objects.
 * @param {!Array<!historian.HistorianV2Data>} data Data for each timeline.
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @param {boolean} hasPowermonitorData Whether powermonitor data is available
 *     in the current report.
 * @private
 */
historian.constructTimelines_ = function(
    timelines, data, levelSummaryData, hasPowermonitorData) {
  goog.asserts.assert(timelines.length == data.length);
  timelines.forEach(function(timeline, idx) {
    if (idx >= data.length) {
      console.log('No data provided for timeline no. ' + idx);
      return;
    }
    var isHidden = {};
    timeline.barHidden.forEach(function(group) {
      isHidden[group] = true;
    });
    // Only want to attach the power stats container to the first battery view,
    // and only if powermonitor data is avaiable.
    var powerStatsContainer = idx == 0 && hasPowermonitorData ?
        $(historian.panels_.powerstats.selector + ' .panel-body') : null;

    timeline.historian = new historian.HistorianV2(
        $(timeline.container), data[idx], levelSummaryData,
        historian.state_, powerStatsContainer,
        $(timeline.panel + ' .panel-body'), isHidden, timeline.barOrder);
  });
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
 * Toggles a panel width between numCols/12 window width and full window width.
 * @param {string} name The name of the panel.
 */
historian.togglePanelRowWidth = function(name) {
  if (!historian.usingComparison) {
    $('#panel-' + name).parent()
        .toggleClass('col-xs-12')
        .toggleClass('col-xs-' + historian.panels_[name].numCols);
    $('#panel-' + name + ' .graph').trigger('historian.resize');
  }
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
 * Displays a modal dialog with the given title and html body.
 * @param {string} title The title of the dialog.
 * @param {string} body The html body of the dialog.
 * @param {string=} opt_class Optional extra class to apply to the dialog.
 */
historian.showDialog = function(title, body, opt_class) {
  $('#dialog .modal-title').text(title);
  $('#dialog .modal-body').html(body);
  $('#dialog .modal-body').attr('class', 'modal-body');
  if (opt_class) {
    $('#dialog .modal-body').addClass(opt_class);
  }
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
    historian.showDialog('Errors',
                         /** @type {string} */(content.html()), 'multi-line');
  });
  $('#btn-warnings').click(function() {
    var content = $('<pre></pre>')
        .text(/** @type {string} */($('#warnings').text()));
    historian.showDialog('Warnings',
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
 */
historian.initHistorianTabs = function(timelines) {
  timelines.forEach(function(timeline) {
    if (!timeline.historian || !timeline.tabSelector) {
      return;
    }
    $(timeline.tabSelector).on('shown.bs.tab', function() {
      timeline.historian.render();
    });
    // The tabs will already have their shown/hidden status by the time this
    // function is called because they're shown/hidden immediately when the page
    // loads, so we must manually call render() or setDisplayed(false) here.
    if ($(timeline.tabSelector).hasClass('active')) {
      timeline.historian.render();
    } else {
      timeline.historian.setDisplayed(false);
    }
    $(timeline.tabSelector).on('hide.bs.tab', function() {
      // If tab change has been triggered, notify Historian v2 so it will
      // ignore mouseover events that occur in the transitioning period.
      timeline.historian.setDisplayed(false);
    });
  });
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
  $('.header-link').click(function(event) {
    event.stopPropagation();
  });
  $('#menu-top').show();
  $('#menu-top a').not('#new-report').click(function(event) {
    // Prevent default page scroll.
    event.preventDefault();
  });
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

  var displayPowermonitor = false;
  if (historian.usingComparison) {
    if (data[1].sdkVersion < historian.sdkVersion) {
      historian.sdkVersion = data[1].sdkVersion;
    }
  } else {
    historian.deviceCapacity = data[0].deviceCapacity;
    displayPowermonitor = data[0].displayPowermonitor;
    if (displayPowermonitor) {
      levelSummaryCsv = '';
    }
  }

  $('#body-contents').html(json.html);

  historian.state_ = new historian.State();
  historian.initErrorAndWarning();
  historian.initPanelControls();

  /** @type {!Array<!historian.HistorianV2Data>} */
  var historianV2Data = [];

  var levelSummaryData = historian.data.processLevelSummaryData(
      levelSummaryCsv);
  historian.initMenu();
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
            datum.timeToDelta, datum.location, datum.displayPowermonitor));
      }
    });
    historian.tables.initialize();

    if (!historian.usingComparison) {
      historian.appstats.initialize(data[0].appStats);

      historian.initAppSelector();

      var timelines = historian.singleView_;

      var hasPowermonitorData =
          historian.metrics.Csv.POWERMONITOR in historianV2Data[0].nameToBarGroup;

      historian.constructTimelines_(
          timelines, historianV2Data, levelSummaryData, hasPowermonitorData);
      historian.initHistorianTabs(timelines);

      if (!displayPowermonitor) {
        // If no powermonitor file was uploaded, no power stats will be
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

      historian.constructTimelines_(
          historian.comparisonView_, historianV2Data, levelSummaryData, false);
      historian.comparisonView_.forEach(function(timeline) {
        if (timeline.historian) {
          timeline.historian.render();
        }
      });
    }
  }

  // Visibility initialization goes after rendering.
  // Otherwise the plots would have zero size.
  historian.initPanelVisibility();
};
