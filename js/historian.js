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

goog.require('historian.HistorianV2');
goog.require('historian.State');
goog.require('historian.appstats');
goog.require('historian.comparison');
goog.require('historian.constants');
goog.require('historian.data');
goog.require('historian.histogramstats');
goog.require('historian.note');
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


/** @type {?historian.HistorianV2} */
historian.historianV2_;


/** @type {?historian.HistorianV2} */
historian.historianV2Two_;


/** @private {!historian.State} */
historian.state_;


/**
 * Historian V1 loading has been requested.
 */
historian.historianV1Requested = false;


/**
 * Creates the historian graph from the csv data.
 * If the use case is comparison, calls render for both the files.
 * @param {!Array<!historian.HistorianV2Data>} data
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @export
 */
historian.renderHistorianV2 = function(data, levelSummaryData) {
  if (!historian.historianV2_) {
    historian.historianV2_ = new historian.HistorianV2(
        $(historian.panels_.historian.selector + ' .panel-body'),
        data[0], levelSummaryData, historian.state_);
  }
  historian.historianV2_.render();

  if (historian.usingComparison && data.length > 1) {
    if (!historian.historianV2Two_) {
      historian.historianV2Two_ = new historian.HistorianV2(
          $(historian.panels_.historian2.selector + ' .panel-body'),
          data[1], levelSummaryData, historian.state_);
    }
    historian.historianV2Two_.render();
  }
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
 * @param {!Array<!historian.HistorianV2Data>} data
 * @param {!historian.LevelSummaryData} levelSummaryData
 */
historian.initHistorianTabs = function(data, levelSummaryData) {
  $('#tab-historian-v2').on('shown.bs.tab', function() {
    historian.renderHistorianV2(data, levelSummaryData);
  });
  if (!historian.usingComparison) {
    $('#tab-historian').on('shown.bs.tab', function() {
      if (!historian.historianV1Requested) {
        historian.historianV1Requested = true;
        historian.loadHistorianV1();
      }
    });
  }
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
 * Shows the response error message in the given element.
 * @param {!jQuery} elem The Jquery element to show the error message in.
 * @param {{responseText: string, status: number}} xhr The request object.
 */
historian.showFailedUploadMsg = function(elem, xhr) {
  var errMsg = xhr.responseText;
  if (xhr.status == 0) {
    // Since the POST request failed, responseText will be empty.
    errMsg = 'POST failed: possible causes are renaming / moving' +
        ' the files after upload, or loss of network connection.';
  }
  elem.append('<br>' + errMsg).show();
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
 * @param {!Object} json JSON data object sent back from the server analyzer.
 */
historian.initialize = function(json) {
  var levelSummaryCsv = json.UploadResponse[0].levelSummaryCsv;
  historian.sdkVersion = json.UploadResponse[0].sdkVersion;
  historian.usingComparison = json.usingComparison;
  historian.criticalError = json.UploadResponse[0].criticalError;

  if (historian.usingComparison) {
    if (json.UploadResponse[1].sdkVersion < historian.sdkVersion) {
      historian.sdkVersion = json.UploadResponse[1].sdkVersion;
    }
  } else {
    historian.displayPowermonitor = json.UploadResponse[0].displayPowermonitor;
    historian.appstats.reportVersion = json.UploadResponse[0].reportVersion;
    if (historian.displayPowermonitor) {
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
  if (historian.sdkVersion < 21 || historian.criticalError) {
    historian.showOnlyHistorianV1();
  } else {
    historianV2Data = json.UploadResponse.map(function(data) {
      return historian.data.processHistorianV2Data(
          data.historianV2Csv, parseInt(data.deviceCapacity, 10),
          data.timeToDelta, data.location, data.displayPowermonitor);
    });
    historian.tables.initialize();

    if (!historian.usingComparison) {
      historian.appstats.initialize(json.UploadResponse[0].appStats);

      historian.initAppSelector();

      $('.comparison').remove();
    } else {
      historian.comparison.initialize();
      historian.histogramstats.initialize(
          json.UploadResponse[0].histogramStats,
          json.UploadResponse[1].histogramStats, json.combinedCheckin,
          json.UploadResponse[0].fileName, json.UploadResponse[1].fileName);
      // TODO: Adding / removing metrics in comparison view is not
      // currently handled, since the graphs can have different sets of metrics.
      $('#historian-metrics').remove();
    }
    historian.renderHistorianV2(historianV2Data, levelSummaryData);
  }
  historian.initHistorianTabs(historianV2Data, levelSummaryData);


  // Visibility initialization goes after rendering.
  // Otherwise the plots would have zero size.
  historian.initPanelVisibility();
};
