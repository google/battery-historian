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



/**
 * Creates a historian v2 plot.
 * @param {!jQuery} container The panel body container of the plot.
 * @param {!historian.HistorianV2Data} data The data for rendering Historian V2.
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @param {!historian.State} state Global Historian state.
 * @constructor
 * @struct
 */
historian.HistorianV2 = function(container, data, levelSummaryData, state) {
  /** @private @const {!jQuery} */
  this.container_ = container;

  /** @private {!historian.HistorianV2Data} */
  this.data_ = data;

  /** @private {!historian.LevelSummaryData} */
  this.levelSummaryData_ = levelSummaryData;

  /** @private {!historian.State} */
  this.state_ = state;

  historian.color.generateSeriesColors(this.data_.nameToBarGroup);

  /** @private {!historian.BarData} */
  var barData = new historian.BarData(this.data_.nameToBarGroup,
      historian.metrics.hiddenBarMetrics, historian.metrics.ORDER, true);

  /** @private {!historian.LevelData} */
  this.levelData_ = new historian.LevelData(this.data_.nameToLevelGroup,
      this.data_.defaultLevelMetric, this.data_.configs);

  var config = this.levelData_.getConfig();

  /** @private {!historian.Context} */
  this.context_ = new historian.Context(
      this.container_,
      { min: this.data_.extent[0], max: this.data_.extent[1] },
      config.yDomain,
      barData,
      this.levelData_,
      this.zoomHandler_.bind(this),
      this.data_.location
      );

  /** @private {!historian.Bars} */
  this.bars_ = new historian.Bars(this.context_, barData,
                                  this.levelData_,
                                  this.data_.serviceMapper,
                                  this.data_.timeToDelta,
                                  this.state_);
  /** @private {!historian.LevelLine} */
  this.levelLine_ = new historian.LevelLine(
      this.context_, this.levelData_, this.levelSummaryData_);

  /** @private {!historian.SeriesLevel} */
  this.seriesLevel_ = new historian.SeriesLevel(
      this.context_, barData, this.levelSummaryData_, this.state_);

  this.handleResize_();
  this.handleMouse_();
  this.handleDataUpdate_();

  this.levelData_.registerListener(this.onLevelSeriesChange.bind(this));
};


/**
 * Clears the rendered level line and replaces it with a new level line created
 * from the level data.
 */
historian.HistorianV2.prototype.onLevelSeriesChange = function() {
  this.levelLine_.clear();
  this.levelLine_ = new historian.LevelLine(
      this.context_, this.levelData_, this.levelSummaryData_);
};


/**
 * Enables the resize handler.
 * @private
 */
historian.HistorianV2.prototype.handleResize_ = function() {
  this.container_.on('historian.resize', this.resize_.bind(this));
};


/**
 * Sets up the update calls when the data changes.
 * @private
 */
historian.HistorianV2.prototype.handleDataUpdate_ = function() {
  var updateLevelSummaries = this.levelLine_.renderLevelSummaries
      .bind(this.levelLine_);
  $(this.container_)
      .on('historian.levelSummary.update', updateLevelSummaries)
      .on('historian.levelSummary.metrics', updateLevelSummaries)
      .on('historian.levelSummary.filter', updateLevelSummaries);
};


/**
 * Renders everything under historian.
 */
historian.HistorianV2.prototype.render = function() {
  this.bars_.render();
  this.levelLine_.render();
  this.seriesLevel_.render();
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
};


/**
 * Sets up the handlers for mouse events.
 * @private
 */
historian.HistorianV2.prototype.handleMouse_ = function() {
  this.context_.svg
      .on('mousemove', function() {
        this.seriesLevel_.showSummary();
        this.bars_.showSeriesInfo();
        this.levelLine_.renderTimeInfo();
      }.bind(this))
      .on('mouseout', function() {
        this.levelLine_.hideTimeInfo();
      }.bind(this));
};
