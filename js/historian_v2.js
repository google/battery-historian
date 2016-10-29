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

goog.require('historian.BarData');
goog.require('historian.Bars');
goog.require('historian.Context');
goog.require('historian.LevelData');
goog.require('historian.LevelLine');
goog.require('historian.SeriesLevel');
goog.require('historian.color');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.power.Estimator');
goog.require('historian.power.Overlay');



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
 * @param {!Array<string>} barOrder Order of groups rendered as bars.
 * @constructor
 * @struct
 */
historian.HistorianV2 = function(container, data, levelSummaryData, state,
    powerStatsContainer, panel, barHidden, barOrder) {
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

  historian.color.generateSeriesColors(this.data_.nameToBarGroup);

  /** @private {!historian.BarData} */
  var barData = new historian.BarData(this.container_,
      this.data_.nameToBarGroup, barHidden, barOrder, true);

  /** @private {!historian.LevelData} */
  this.levelData_ = new historian.LevelData(
      this.data_.nameToLevelGroup, this.data_.defaultLevelMetric,
      this.data_.configs, this.container_);

  var config = this.levelData_.getConfig();

  /** @private {!historian.Context} */
  this.context_ = new historian.Context(
      this.container_,
      { min: this.data_.extent[0], max: this.data_.extent[1] },
      config.yDomain,
      barData,
      this.levelData_,
      this.zoomHandler_.bind(this),
      this.data_.location,
      this.panel_
      );

  var running = this.data_.nameToBarGroup[historian.metrics.Csv.CPU_RUNNING];
  var powermonitor =
      this.data_.nameToBarGroup[historian.metrics.Csv.POWERMONITOR];
  var powerEstimator = new historian.power.Estimator(
      running ? running.series[0].values : [],
      powermonitor ? powermonitor.series[0].values : [],
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
      this.levelSummaryData_, this.summaryData_, this.container_);

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

  this.levelData_.registerListener(this.onLevelSeriesChange.bind(this));
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
 *
 * @typedef {{
 *   panel: string,
 *   tabSelector: (string|undefined),
 *   container: string,
 *   historian: (!historian.HistorianV2|undefined)
 * }}
 */
historian.HistorianV2.Timeline;


/**
 * Clears the rendered level line and replaces it with a new level line created
 * from the level data.
 */
historian.HistorianV2.prototype.onLevelSeriesChange = function() {
  this.levelLine_.clear();
  this.levelLine_ = new historian.LevelLine(this.context_, this.levelData_,
      this.levelSummaryData_, this.summaryData_, this.container_);
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
  var updateLevelSummaries = this.levelLine_.renderLevelSummaries
      .bind(this.levelLine_);
  // The events are triggered on the panel in historian.js, so it's used
  // instead of this.container_.
  this.panel_
      .on('historian.levelSummary.update', updateLevelSummaries)
      .on('historian.levelSummary.metrics', updateLevelSummaries)
      .on('historian.levelSummary.filter', updateLevelSummaries);
};


/**
 * Renders everything under historian.
 */
historian.HistorianV2.prototype.render = function() {
  this.setDisplayed(true);
  this.bars_.render();
  this.levelLine_.render();
  this.seriesLevel_.render();
  this.powerOverlay_.render();
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
