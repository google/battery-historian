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
 * @fileoverview Renders hoverable boxes per level drop per series to show
 * level summaries.
 */
goog.provide('historian.SeriesLevel');

goog.require('historian.Tooltip');
goog.require('historian.levelSummary.Dimensions');
goog.require('historian.metrics');
goog.require('historian.time');



/**
 * Creates the SeriesLevel boxes to be hovered.
 *
 * @param {!jQuery} container Container for the visualization.
 * @param {!historian.Context} context The visualization context.
 * @param {!historian.BarData} barData The bar data used in historian V2.
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @param {!historian.State} state Global Historian state.
 * @constructor
 * @struct
 */
historian.SeriesLevel = function(
    container, context, barData, levelSummaryData, state) {
  /** @private {!historian.Context} */
  this.context_ = context;

  /** @private {!historian.BarData} */
  this.barData_ = barData;

  /** @private {!Array<!historian.SeriesGroup>} */
  this.groupsToRender_ = this.barData_.getData();

  /** @private {!historian.LevelSummaryData} */
  this.levelSummaryData_ = levelSummaryData;

  /** @private {!historian.State} */
  this.state_ = state;

  /** @type {?{name: string, startTime: number}} */
  this.hovered = null;

  /** @private {?historian.Tooltip} */
  this.tooltip_ = null;

  /** @private {boolean} */
  this.show_ = true;

  this.barData_.registerListener(this.onSeriesChange.bind(this));

  var wasShown = this.show_;
  var levelSummaryElem = container.find('.show-level-summary');
  levelSummaryElem.on('click', function(event) {
    if (event.hasOwnProperty('originalEvent')) {
      // Change here if the user made the change; ignore if it was changed
      // programatically.
      this.show_ = !this.show_;  // Toggle the setting.
      wasShown = this.show_;
    } else {
      event.stopPropagation();  // Don't change the dropdown menu state.
    }
    levelSummaryElem.find('.settings-checkbox')
        .css('opacity', this.show_ ? 1 : 0); // Toggle the setting
    event.preventDefault();

    this.onSeriesChange();
  }.bind(this));

  // The level summary data is confusing without the bars, so
  // hide it automatically if the bars are hidden.
  container.find('.show-bars').change(function(event) {
    this.show_ = $(event.target).is(':checked') ? wasShown : false;
    levelSummaryElem.click();
  }.bind(this));
};


/**
 * Rerenders the series level boxes with the new data.
 */
historian.SeriesLevel.prototype.onSeriesChange = function() {
  this.groupsToRender_ = this.barData_.getData();
  this.context_.svgSeriesLevel.selectAll('g.series-level').remove();
  this.render();
};


/**
 * Renders the series level.
 */
historian.SeriesLevel.prototype.render = function() {
  this.renderSeriesLevel_();
};


/**
 * Updates the series level.
 */
historian.SeriesLevel.prototype.update = function() {
  this.renderSeriesLevel_();
};


/**
 * Renders the SeriesLevel boxes.
 * @private
 */
historian.SeriesLevel.prototype.renderSeriesLevel_ = function() {
  if (!this.show_) {
    return;
  }
  var seriesGroups = this.context_.svgSeriesLevel.selectAll('g.series-level')
      .data(this.groupsToRender_, function(series) { return series.name; });
  seriesGroups.enter().append('g')
      .attr('class', 'series-level')
      .attr('id', function(series) {
        return 'series' + series.index;
      })
      .attr('name', function(series) { return series.name; });
  seriesGroups.attr('transform', function(series) {
        return 'translate(0,' + this.context_.rowScale(series.index + 1) + ')';
      }.bind(this));
  seriesGroups.exit().remove();

  var startTimeIndex = this.levelSummaryData_.dimensionToIndex[
      historian.levelSummary.Dimensions.START_TIME];
  var endTimeIndex = this.levelSummaryData_.dimensionToIndex[
      historian.levelSummary.Dimensions.END_TIME];
  var seriesHeight = this.context_.rowScale(0) - this.context_.rowScale(1);
  var values = this.levelSummaryData_.values;

  this.groupsToRender_.forEach(function(series) {
    var g = this.context_.svgSeriesLevel.select('#series' + series.index);
    // Check if no series-level data is available.
    var seriesKey = historian.metrics.getSeriesKey(series.name);
    var dimName = historian.metrics.levelSummaryCsv[seriesKey];
    if (dimName == undefined)
      return;

    // The data for each level drop is stored in each valueRow array.
    // The count data for this particular series is stored in countIndex of the
    // valueRow array.
    var countIndex = this.levelSummaryData_.dimensionToIndex[dimName + '.num'];
    // Get any rows that have a non zero count for the current series.
    var nonZeroCount = values.filter(function(valueRow) {
      return valueRow[countIndex] > 0;
    });
    var rects = g.selectAll('rect').data(nonZeroCount);
    rects.enter().append('rect')
        .on('mouseover', function(valueRow) {
          this.hovered = {
            name: series.name,
            startTime: valueRow[startTimeIndex]
          };
        }.bind(this))
        .on('mouseout', function() {
          this.hovered = null;
        }.bind(this));
    rects.attr('x', function(valueRow) {
      var startTime = valueRow[startTimeIndex];
      return this.context_.xScale(startTime);
    }.bind(this))
        .attr('width', function(valueRow) {
          var startTime = valueRow[startTimeIndex];
          var endTime = valueRow[endTimeIndex];
          return this.context_.xScale(endTime) -
          this.context_.xScale(startTime);
        }.bind(this))
        .attr('height', seriesHeight);
    rects.exit().remove();
  }, this);
};


/**
 * Displays the level summary for the hovered box.
 * startTime is used as identifier to lookup in the level summary data.
 */
historian.SeriesLevel.prototype.showSummary = function() {
  this.hideSummary();
  if (!this.hovered) return;
  var name = this.hovered.name;
  var startTime = this.hovered.startTime;

  var seriesKey = historian.metrics.getSeriesKey(name);
  var dimName = historian.metrics.levelSummaryCsv[seriesKey];

  var startTimeIndex = this.levelSummaryData_.dimensionToIndex[
      historian.levelSummary.Dimensions.START_TIME];
  var bisect = d3.bisector(function(d) {
    return d[startTimeIndex];
  }).left;

  var lines = [];
  var index = bisect(this.levelSummaryData_.values, startTime);
  if (index == this.levelSummaryData_.values.length ||
      this.levelSummaryData_.values[index][startTimeIndex] != startTime) {
    lines.push('No series-level summary available');
  } else {
    var values = this.levelSummaryData_.values[index];
    var valuesNormalized = this.levelSummaryData_.valuesNormalized[index];
    var dimIndexDur =
        this.levelSummaryData_.dimensionToIndex[dimName + '.dur'];
    var dimIndexNum =
        this.levelSummaryData_.dimensionToIndex[dimName + '.num'];
    var duration = values[dimIndexDur];
    var count = values[dimIndexNum];
    var durationNormalized = valuesNormalized[dimIndexDur];
    var countNormalized = valuesNormalized[dimIndexNum];

    lines.push('<b>Duration: </b>' + historian.time.formatDuration(duration));
    lines.push('<b>Count: </b>' + count);
    lines.push('<b>Duration / Hr: </b>' +
               historian.time.formatDuration(durationNormalized));
    lines.push('<b>Count / Hr: </b>' + countNormalized.toFixed(2));
  }
  this.hideSummary();
  this.tooltip_ = new historian.Tooltip(lines, this.state_);
};


/**
 * Hides the level summary for the hovered box.
 */
historian.SeriesLevel.prototype.hideSummary = function() {
  if (this.tooltip_) this.tooltip_.hide();
};
