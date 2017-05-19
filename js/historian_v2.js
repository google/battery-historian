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

goog.provide('historian.HistorianV2');
goog.provide('historian.HistorianV2.Timeline');

goog.require('historian.BarData');
goog.require('historian.Bars');
goog.require('historian.Context');
goog.require('historian.LevelData');
goog.require('historian.LevelLine');
goog.require('historian.SeriesLevel');
goog.require('historian.color');
goog.require('historian.historianV2Logs');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.power.Estimator');
goog.require('historian.power.Overlay');
goog.require('historian.utils');



/**
 * Creates a historian v2 plot.
 * @param {!jQuery} container Container the timeline is rendered in.
 * @param {!historian.HistorianV2Data} data The data for rendering Historian V2.
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @param {!historian.State} state Global Historian state.
 * @param {?jQuery} powerStatsContainer The panel body container for the power
 *     statistics.
 * @param {!jQuery} panel The panel body container of the plot. Used for
 *     calculating rendered sizes.
 * @param {!Object<boolean>} barHidden Groups hidden by default.
 * @param {!Array<!historian.metrics.GroupProperties>} barOrder Order of groups
 *     rendered as bars.
 * @param {boolean} showReportTaken Whether to render the line for when the
 *     bug report was taken.
 * @param {?historian.historianV2Logs.Extent} defaultXExtent Min and max unix
 *     ms timestamps for the x-axis. If null, it will be set to fit the data.
 * @constructor
 * @struct
 */
historian.HistorianV2 = function(container, data, levelSummaryData, state,
    powerStatsContainer, panel, barHidden, barOrder, showReportTaken,
    defaultXExtent) {
  /** @private @const {!jQuery} */
  this.panel_ = panel;

  /** @private @const {!jQuery} */
  this.container_ = container;

  /** @private {!historian.HistorianV2Data} */
  this.data_ = data;

  /** @private {!historian.LevelSummaryData} */
  this.levelSummaryData_ = levelSummaryData;

  /** @private {!Object<!Array<(!historian.Entry)>>} */
  this.summaryData_ = data.nameToSummary;

  /** @private {!historian.State} */
  this.state_ = state;

  /** @private {?number} */
  this.overflowMs_ = data.overflowMs;

  historian.color.generateSeriesColors(this.data_.barGroups);

  /** @private {!historian.BarData} */
  var barData = new historian.BarData(this.container_,
      this.data_.barGroups, barHidden, barOrder, true);

  /** @private {!historian.LevelData} */
  this.levelData_ = new historian.LevelData(
      this.data_.nameToLevelGroup, this.data_.defaultLevelMetric,
      this.data_.configs, this.container_,
      this.data_.nameToLineGroup);

  var config = this.levelData_.getConfig();

  /** @private {!historian.Context} */
  this.context_ = new historian.Context(
      this.container_,
      defaultXExtent || {min: 0, max: 0},
      config.yDomain,
      barData,
      this.levelData_,
      this.zoomHandler_.bind(this),
      this.data_.location,
      this.panel_
      );

  var running = barData.getSeries(historian.metrics.Csv.CPU_RUNNING,
      historian.historianV2Logs.Sources.BATTERY_HISTORY);
  var powerMonitor = barData.getSeries(historian.metrics.Csv.POWER_MONITOR,
      historian.historianV2Logs.Sources.POWER_MONITOR);
  var powerEstimator = new historian.power.Estimator(
      running ? running.values : [], powerMonitor ? powerMonitor.values : [],
      powerStatsContainer);

  /** @private {!historian.Bars} */
  this.bars_ = new historian.Bars(this.context_, barData,
                                  this.levelData_,
                                  this.data_.timeToDelta,
                                  this.state_,
                                  powerEstimator,
                                  this.container_);
  /** @private {!historian.LevelLine} */
  this.levelLine_ = new historian.LevelLine(this.context_, this.levelData_,
      this.levelSummaryData_, showReportTaken, this.overflowMs_,
      this.summaryData_, this.container_);

  /** @private {!historian.SeriesLevel} */
  this.seriesLevel_ = new historian.SeriesLevel(this.container_,
      this.context_, barData, this.levelSummaryData_, this.state_);

  /** @private {!historian.power.Overlay} */
  this.powerOverlay_ = new historian.power.Overlay(
      this.context_, this.levelData_, powerEstimator, this.container_);

  /**
   * Whether Historian v2 is currently being displayed.
   * If false, new mouse events will be ignored.
   * @private {boolean}
  */
  this.displayed_ = true;

  this.handleResize_();
  this.handleMouse_();
  this.handleDataUpdate_();
  this.handleDomainChange_(this.levelData_, barData, defaultXExtent);

  this.container_.find('.settings-button').on('click', function() {
    $(this).find('.settings-overflow').toggleClass('show');
  });

  this.levelData_.registerListener(
      this.onLevelSeriesChange.bind(this, showReportTaken));
};


/**
 * The properties of a Historian v2 timeline.
 *
 * panel: Selector of the panel the timeline container is in.
 *     Used for calculating rendered sizes.
 * tabSelector: Selector of the tab to render in and listen for tab shown
 *     events. Undefined for comparison view timelines.
 * container: Selector of the container the timeline is rendered in. This is
 *     a descendant of the panel and tab containers (if applicable).
 * historian: Reference to the constructed HistorianV2 object.
 * barOrder: Order for the groups to be displayed in.
 * barHidden: Groups hidden by default.
 * logSources: Any other events from these logs not already listed in
 *     barOrder or barHidden will be added to the groups to display. If there
 *     are too many groups to display, the remainder will be added to the
 *     hidden selectable groups.
 * logSourcesHidden: Any other events from these logs not already listed in
 *     barOrder or barHidden will be added to the hidden selectable groups.
 *     logSources takes precedence over logSourcesHidden.
 * defaultLevelMetricOverride: If set, overrides the level metric displayed
 *     by default (default is battery level or power monitor, depending on the data).
 * defaultXExtentLogs: The names of the logs that should be used to calculate
 *     the x-axis extent. If empty, the extent will be set to fit all the data.
 * showReportTaken: Whether to render the line for when the report was taken.
 *
 * @typedef {{
 *   panel: string,
 *   tabSelector: (string|undefined),
 *   container: string,
 *   historian: (!historian.HistorianV2|undefined),
 *   barOrder: !Array<!historian.metrics.GroupProperties>,
 *   barHidden: !Array<!historian.metrics.GroupProperties>,
 *   logSources: !Array<!historian.historianV2Logs.Sources>,
 *   logSourcesHidden: !Array<!historian.historianV2Logs.Sources>,
 *   defaultLevelMetricOverride: (string|undefined),
 *   defaultXExtentLogs: !Array<!historian.historianV2Logs.Sources>,
 *   showReportTaken: boolean
 * }}
 */
historian.HistorianV2.Timeline;


/** @private @const {string} */
historian.HistorianV2.SET_DOMAIN_ = '.set-domain';


/**
 * Options for the domain dropdown.
 * @enum {string}
 */
historian.HistorianV2.DomainOptions = {
  DEFAULT: 'Default',  // The recommended domain.
  FIT_SHOWN_METRICS: 'Shown metrics'
};


/**
 * Clears the rendered level line and replaces it with a new level line created
 * from the level data.
 * @param {boolean} showReportTaken Whether to render the line showing when the
 *     bug report was taken.
 */
historian.HistorianV2.prototype.onLevelSeriesChange =
    function(showReportTaken) {
  this.levelLine_.clear();
  this.levelLine_ = new historian.LevelLine(this.context_, this.levelData_,
      this.levelSummaryData_, showReportTaken, this.overflowMs_,
      this.summaryData_, this.container_);
};


/**
 * Sets whether Historian v2 is currently being displayed.
 * @param {boolean} displayed
 */
historian.HistorianV2.prototype.setDisplayed = function(displayed) {
  this.displayed_ = displayed;
};


/**
 * Enables the resize handler.
 * @private
 */
historian.HistorianV2.prototype.handleResize_ = function() {
  this.panel_.on('historian.resize', this.resize_.bind(this));
};


/**
 * Sets up the update calls when the data changes.
 * @private
 */
historian.HistorianV2.prototype.handleDataUpdate_ = function() {
  var updateLevelSummaries = function() {
    this.levelLine_.renderLevelSummaries();
  }.bind(this);
  // The events are triggered on the panel in historian.js, so it's used
  // instead of this.container_.
  this.panel_
      .on('historian.levelSummary.update', updateLevelSummaries)
      .on('historian.levelSummary.metrics', updateLevelSummaries)
      .on('historian.levelSummary.filter', updateLevelSummaries);
};


/**
 * Re-renders axes and data for the new domain.
 * @param {!historian.LevelData} levelData
 * @param {!historian.BarData} barData
 * @param {?historian.historianV2Logs.Extent} defaultXExtent
 * @private
 */
historian.HistorianV2.prototype.handleDomainChange_ =
    function(levelData, barData, defaultXExtent) {
  var options = [historian.HistorianV2.DomainOptions.FIT_SHOWN_METRICS];
  // There might not be a default x-extent (e.g. for the custom timeline).
  if (defaultXExtent) {
    options.unshift(historian.HistorianV2.DomainOptions.DEFAULT);
  }
  // Allow the user to set the domain to any logs that had data.
  var logs = Object.keys(this.data_.logToExtent).map(function(log) {
    return {val: log, html: log + ' Log'};
  }).sort(function(a, b) {
    return a.val - b.val;
  });
  options = options.concat(logs);
  var select = this.container_.find(historian.HistorianV2.SET_DOMAIN_);
  historian.utils.setupDropdown(select, options);

  var modifyDomain = function() {
    var selectedLog = select.find('option:selected').val();
    var domain = null;
    switch (selectedLog) {
      case historian.HistorianV2.DomainOptions.DEFAULT:
        domain = defaultXExtent;
        break;
      case historian.HistorianV2.DomainOptions.FIT_SHOWN_METRICS:
        var barDomain = barData.getVisibleDomain();
        var levelDomain = levelData.getVisibleDomain();
        domain = barDomain || levelDomain;
        if (barDomain && levelDomain) {
          domain = {
            min: Math.min(barDomain.min, levelDomain.min),
            max: Math.max(barDomain.max, levelDomain.max)
          };
        }
        break;
      default:
        domain = this.data_.logToExtent[selectedLog];
    }
    this.context_.setDomain(domain || {min: 0, max: 0});
    this.zoomHandler_();
  }.bind(this);

  select.on('change', modifyDomain);

  // Handle if the bar or level metrics change. e.g. added a new bar metric.
  barData.registerListener(modifyDomain);
  levelData.registerListener(modifyDomain);

  // Handle if the checkbox to show bars changes. (There is no level checkbox.)
  this.container_.find('.show-bars').change(modifyDomain);
};


/**
 * Renders everything under historian.
 */
historian.HistorianV2.prototype.render = function() {
  this.setDisplayed(true);
  // This will trigger the zoomHandler which will redraw the graph.
  this.container_.find(historian.HistorianV2.SET_DOMAIN_).trigger('change');
};


/**
 * Highlights the given metrics' series labels.
 * @param {!Array<string>} metrics Names of metrics to be highlighted.
 */
historian.HistorianV2.prototype.highlightMetrics = function(metrics) {
  this.bars_.highlightMetrics(metrics);
};


/**
 * Updates (potentially re-renders) everything when the container resizes.
 * @private
 */
historian.HistorianV2.prototype.resize_ = function() {
  this.context_.resize();
  this.bars_.update();
  this.levelLine_.update();
  this.seriesLevel_.update();
  this.powerOverlay_.render();
};


/**
 * Triages zoom events to determine whether to handle it as zoom
 * (otherwise it is handled as select event).
 * @private
 */
historian.HistorianV2.prototype.zoomHandler_ = function() {
  this.context_.update();
  this.bars_.update();
  this.levelLine_.update();
  this.seriesLevel_.update();
  this.powerOverlay_.render();
};


/**
 * Sets up the handlers for mouse events.
 * @private
 */
historian.HistorianV2.prototype.handleMouse_ = function() {
  this.context_.svg
      .on('mousemove', function() {
        if (!this.displayed_) {
          return;
        }
        this.seriesLevel_.showSummary();
        this.bars_.showSeriesInfo();
        this.levelLine_.renderTimeInfo();
      }.bind(this))
      .on('mouseout', function() {
        this.levelLine_.hideTimeInfo();
      }.bind(this));
};
