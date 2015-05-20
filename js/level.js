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

goog.provide('historian.LevelLine');

goog.require('historian.Context');
goog.require('historian.time');



/**
 * LevelLine creates the battery level chart line, and the vertical
 * hover line and text showing battery level information.
 *
 * @param {!historian.Context} context The visualisation context.
 * @param {!historian.SerieData} levelData The battery level series to display.
 * @constructor
 */
historian.LevelLine = function(context, levelData) {
  /** @private {function(number): number} */
  this.xScale_ = context.xScale;

  /** @private {!historian.SerieData} */
  this.levelData_ = levelData;

  this.adjustLevelData_();

  /** @private {function(Object)} */
  this.levelLine_ = d3.svg.line()
      .x(function(d) {
        return context.xScale(d.start_time);
      }.bind(this))
      .y(function(d) {
        return context.yScale(d.value);
      }.bind(this))
      .interpolate('linear');

  /**
   * Battery level line from the data.
   * @private {!d3.selection}
   */
  this.line_ = context.vis.append('svg:path')
      .attr('class', 'battery level')
      .attr('d', this.levelLine_(this.levelData_))
      .attr('stroke', historian.LevelLine.COLOR_)
      .attr('stroke-width', 4)
      .attr('fill', 'none');

  /**
   * Vertical hover line that is shown above the battery level line.
   * @private {!Object}
   */
  this.hoverLine_ = context.svg.append('line')
      .attr('class', 'hover')
      .attr('x1', 0)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', historian.Context.SVG_HEIGHT)
      .attr('stroke', 'black');

  /**
   * Text information and line highlighter for battery level.
   * @private {!historian.LevelLine.LevelDisplay_}
   */
  this.levelDisplay_ =
      new historian.LevelLine.LevelDisplay_(context, this.levelData_);

  this.createLegend_(context);

  context.svg.on('mousemove', this.onMousemove_.bind(this));
  context.registerRedraw(this);
};


/**
 * Color of the battery level line.
 * @private {string}
 */
historian.LevelLine.COLOR_ = 'blue';


/**
 * Size of legend box.
 * @private {number}
 */
historian.LevelLine.LEGEND_SIZE_PX_ = 15;


/**
 * Label to display in the legend box.
 * @private {string}
 */
historian.LevelLine.LEGEND_LABEL_ = 'Battery Level';


/**
 * Redraws the battery level line. Called on zoom.
 */
historian.LevelLine.prototype.redraw = function() {
  this.line_
      .attr('d', this.levelLine_(this.levelData_));
  this.levelDisplay_.redraw_();
};


/**
 * Creates an extra entry using the end time of the last entry.
 *
 * Each battery level entry has a start and end time. Since we only use
 * the start time as data points in the line graph, we need to create
 * an extra point for the end time for the very last entry.
 * @private
 */
historian.LevelLine.prototype.adjustLevelData_ = function() {
  if (this.levelData_.length > 0) {
    var last = this.levelData_[this.levelData_.length - 1];
    var newEntry = {
      start_time: last.end_time,
      end_time: last.end_time,
      value: last.value
    };
    this.levelData_.push(newEntry);
  }
};


/**
 * Renders the legend for the battery level line.
 * @param {!historian.Context} context The visualization context.
 * @private
 */
historian.LevelLine.prototype.createLegend_ = function(context) {
  var startX =
      historian.Context.SVG_WIDTH - historian.Context.margins.RIGHT + 65;
  var startY = historian.Context.SVG_HEIGHT / 2;

  var legend = context.svg.append('g')
      .attr('class', 'level-legend')
      .attr('x', startX)
      .attr('y', startY);

  legend.append('rect')
      .attr('x', startX)
      .attr('y', startY)
      .attr('width', historian.LevelLine.LEGEND_SIZE_PX_)
      .attr('height', historian.LevelLine.LEGEND_SIZE_PX_)
      .style('fill', historian.LevelLine.COLOR_);

  var textCoordY = startY + (historian.LevelLine.LEGEND_SIZE_PX_ * 2);

  legend.append('text')
      .attr('x', startX)
      .attr('y', textCoordY)
      .attr('transform', 'rotate(90 ' + startX + ',' + textCoordY + ')')
      .text(historian.LevelLine.LEGEND_LABEL_);
};


/**
 * Updates the hover line and battery level text on mouse move.
 * @private
 */
historian.LevelLine.prototype.onMousemove_ = function() {
  // Get coordinates relative to SVG rather than page.
  var coords = d3.mouse(d3.select('#historian-graph').node());
  // Position the hoverLine x coordinate to be on the mouse coordinates.
  this.hoverLine_
      .attr('x1', + (coords[0]) + 'px')
      .attr('x2', + (coords[0]) + 'px')
      .style('opacity', 1);

  // Get the time value of the chart corresponding to the mouse position.
  var xValue =
      this.xScale_.invert(coords[0] - historian.Context.margins.LEFT);

  // Get the index of the data point corresponding to the time value.
  // The bisector finds where the time value bisects the data array.
  var bisector = d3.bisector(function(d) {
    return d.start_time;
  }).right;
  var i = bisector(this.levelData_, xValue) - 1;

  if (i < this.levelData_.length - 1 &&
      xValue >= this.levelData_[0].start_time) {
    this.levelDisplay_.update_(i, coords, xValue);
  } else {
    // Time does not match data point - mouse is too far left
    // or right of chart. Hide battery level text and line highlighter.
    this.levelDisplay_.hide_();
  }
};



/**
 * Class for displaying information about the current battery level
 * the mouse is hovering over, as well as the line highlighter.
 *
 * @param {!historian.Context} context The visualisation context.
 * @param {!historian.SerieData} levelData The battery level series to display.
 * @constructor
 * @private
 */
historian.LevelLine.LevelDisplay_ = function(context, levelData) {
  /** @private {!historian.SerieData} */
  this.levelData_ = levelData;

  /** @private {function(number): number} */
  this.xScale_ = context.xScale;

  /** @private {function(number): number} */
  this.yScale_ = context.yScale;

  /** @private {?historian.Entry} */
  this.levelStart_ = null;

  /** @private {?historian.Entry} */
  this.levelEnd_ = null;

  /**
   * Colored line for overlaying on top of battery level line,
   * for the level currently under mouse over.
   * @private {!Object}
   */
  this.levelHighlighter_ = context.vis
      .append('line')
      .attr('class', 'battery level highlighter')
      .attr('stroke', 'darkorange')
      .attr('stroke-width', 4);

  /**
   * textGroup allows for multi line svg text elements.
   * @private {!Object}
   */
  this.textGroup_ = context.svg.append('text')
      .attr('x', 10)
      .attr('y', 0)
      .style('fill', '#000000')
      .style('stroke', 'none')
      .style('font-size', '18px');

  /** @private {Array.<Object>} */
  this.lines_ = [];
  this.addLines_(historian.LevelLine.LevelDisplay_.NUM_LINES);
};


/** @const {number} */
historian.LevelLine.LevelDisplay_.MAX_VISIBILITY = 1;


/** @const {number} */
historian.LevelLine.LevelDisplay_.MIN_VISIBILITY = 0;


/** @const {number} */
historian.LevelLine.LevelDisplay_.NUM_LINES = 4;


/** @const {number} */
historian.LevelLine.LevelDisplay_.PADDING_PX = 10;


/**
 * Creates the tspan elements.
 * @param {number} numLines Number of tspan elements to create.
 * @private
 */
historian.LevelLine.LevelDisplay_.prototype.addLines_ = function(numLines) {
  for (var i = 0; i < numLines; i++) {
    var line = this.textGroup_.append('tspan')
        .attr('x', 0)
        .attr('dy', 20);
    this.lines_.push(line);
  }
};


/**
 * Sets the contents of the tspan element of the index with the given line.
 * @param {number} i The index of tspan element.
 * @param {string} line The contents to set tspan to.
 * @private
 */
historian.LevelLine.LevelDisplay_.prototype.setLine_ = function(i, line) {
  this.lines_[i].text(line);
};


/**
 * Updates the battery level display for the given data index.
 * @param {number} i Index of the data point of the start of the duration
 *   to display,
 * @param {Object} coords The coordinate of the mouse event.
 * @param {number} time The time value corresponding to the mouse position.
 * @private
 */
historian.LevelLine.LevelDisplay_.prototype.update_ =
    function(i, coords, time) {
  // Set text display to be right of mouse cursor, at top of page.
  var x = coords[0] + historian.LevelLine.LevelDisplay_.PADDING_PX;
  this.textGroup_.attr('transform', 'translate(' + x + ', 20)');

  // Start and end level data points corresponding to index.
  this.levelStart_ = this.levelData_[i];
  this.levelEnd_ = this.levelData_[i + 1];

  // Calculate details for text display.
  var timeText = 'Current time: ' + historian.time.getTime(time);
  var batteryLevelText =
      'Battery level: between ' + this.levelStart_.value +
      ' and ' + this.levelEnd_.value;
  var dischargeText =
      historian.LevelLine.calculateDischarge_(this.levelStart_, this.levelEnd_);

  var duration = historian.time.formatDuration(
      this.levelEnd_.start_time - this.levelStart_.start_time);

  var durationText = 'Duration: ' + duration +
      ', from ' + historian.time.getTime(this.levelStart_.start_time) +
      ' to ' + historian.time.getTime(this.levelEnd_.start_time);

  // Set contents of text display.
  this.setLine_(0, timeText);
  this.setLine_(1, batteryLevelText);
  this.setLine_(2, dischargeText);
  this.setLine_(3, durationText);

  this.redraw_();

  this.setVisibility_(historian.LevelLine.LevelDisplay_.MAX_VISIBILITY);
};


/**
 * Redraws all the battery level display for the currnet zoom level.
 * @private
 */
historian.LevelLine.LevelDisplay_.prototype.redraw_ = function() {
  if (this.levelStart_ != null && this.levelEnd_ != null) {
    var xStart = this.xScale_(this.levelStart_.start_time);
    var yStart = this.yScale_(/** @type {number} */ (this.levelStart_.value));
    var xEnd = this.xScale_(this.levelEnd_.start_time);
    var yEnd = this.yScale_(/** @type {number} */ (this.levelEnd_.value));

    // Highlight section of battery level line currently being mouse overed.
    this.levelHighlighter_
        .attr('x1', xStart)
        .attr('y1', yStart)
        .attr('x2', xEnd)
        .attr('y2', yEnd);
  }
};


/**
 * Sets the opacity of the level display elements.
 * @param {number} opacity The opacity to set elements to.
 * @private
 */

historian.LevelLine.LevelDisplay_.prototype.setVisibility_ = function(opacity) {
  this.textGroup_.style('fill-opacity', opacity);
  this.levelHighlighter_.style('stroke-opacity', opacity);
};


/**
 * Hides the level display from view.
 * @private
 */
historian.LevelLine.LevelDisplay_.prototype.hide_ = function() {
  this.setVisibility_(historian.LevelLine.LevelDisplay_.MIN_VISIBILITY);
};


/**
 * Static function for calculating the % discharge / charge rate / hour,
 * given 2 battery level data entries, returning it in string format.
 *
 * @param {!historian.Entry} d1 The data point for start.
 * @param {!historian.Entry} d2 The data point for end.
 * @return {string} Returns the formatted discharge / charge rate information.
 * @private
 */
historian.LevelLine.calculateDischarge_ = function(d1, d2) {
  var levelDifference = d2.value - d1.value;
  var timeDiff = d2.start_time - d1.start_time;

  var rate = (historian.time.MSECS_IN_SEC * historian.time.SECS_IN_MIN *
      historian.time.MINS_IN_HOUR) /
      timeDiff * levelDifference;

  // Round rate to 2 decimal points.
  var formatted = parseFloat(Math.abs(rate)).toFixed(2) + ' % / hour';
  if (rate > 0) {
    formatted = 'Charge rate: ' + formatted;
  } else {
    formatted = 'Discharge rate: ' + formatted;
  }
  return formatted;
};
