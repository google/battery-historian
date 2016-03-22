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

goog.provide('historian.LevelLine');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('goog.string');
goog.require('historian.Context');
goog.require('historian.constants');
goog.require('historian.data');
goog.require('historian.levelSummary');
goog.require('historian.levelSummary.Dimensions');
goog.require('historian.time');
goog.require('historian.utils');



/**
 * LevelLine creates the battery level chart line, and the vertical
 * hover line and text showing battery level information.
 *
 * @param {!historian.Context} context The visualisation context.
 * @param {!historian.LevelData} levelData The level data to display.
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @constructor
 * @struct
 */
historian.LevelLine = function(context, levelData, levelSummaryData) {
  /** @private {!historian.Context} */
  this.context_ = context;

  /** @private {!Array<historian.Entry>} */
  this.levelData_ = levelData.getData();

  /** @private {!historian.LevelSummaryData} */
  this.levelSummaryData_ = levelSummaryData;

  /** @private {!historian.LevelConfiguration} */
  this.config_ = levelData.getConfig();

  /**
   * The actual data being displayed.
   * @private {!historian.LevelLine.Data}
   */
  this.displayedLevelData_ = new historian.LevelLine.Data(
      this.levelData_, context, this.config_.enableSampling);

  /** @private {function(!Object)} */
  this.levelLine_ = d3.svg.line()
      .x(function(d) {
        return context.xScale(d.startTime);
      })
      .y(function(d) {
        return context.yScale(d.value);
      })
      .interpolate('linear');
  /**
   * Text information and line highlighter for battery level.
   * @private {!historian.LevelLine.TimeInfo_}
   */
  this.timeInfo_ = new historian.LevelLine.TimeInfo_(
      this.context_, this.displayedLevelData_, this.config_,
      this.levelSummaryData_);

  this.render();
};


/**
 * Size of legend box.
 * @private {number}
 */
historian.LevelLine.LEGEND_SIZE_PX_ = 15;


/**
 * Legend is rendered with this offset to the right of the svg.
 * @const {number}
 */
historian.LevelLine.LEGEND_X_OFFSET = 35;


/**
 * Legend is rendered with this offset to the bottom after rotation
 * so that the center of of the legend is at the vertical middle of the svg.
 * @const {number}
 */
historian.LevelLine.LEGEND_Y_OFFSET = 60;


/**
 * The offset from the left of the SVG to the additional power info display.
 * @private @const {number}
 */
historian.LevelLine.POWER_DISPLAY_X_OFFSET_ = 250;


/**
 * The offset from the top of the SVG to the additional power info display.
 * @private @const {number}
 */
historian.LevelLine.POWER_DISPLAY_Y_OFFSET_ = 10;


/** @private @const {string} */
historian.LevelLine.LEGEND_CLASS_ = 'level-legend';


/** @private @const {string} */
historian.LevelLine.LINE_CLASS_ = 'level-line';


/** @private @const {string} */
historian.LevelLine.VIEW_INFO_CLASS_ = 'level-view-info';


/** @private @const {string} */
historian.LevelLine.LINE_HIGHLIGHTER_CLASS_ = 'level-highlighted';


/** @private @const {string} */
historian.LevelLine.TIME_INFO_CLASS_ = 'level-timeinfo';


/**
 * Removes all level related elemnts from the DOM.
 */
historian.LevelLine.prototype.clear = function() {
  $('.' + historian.LevelLine.VIEW_INFO_CLASS_).remove();
  $('.' + historian.LevelLine.LINE_CLASS_).remove();
  $('.' + historian.LevelLine.LEGEND_CLASS_).remove();
  $('.' + historian.LevelLine.LINE_HIGHLIGHTER_CLASS_).remove();
  $('.' + historian.LevelLine.TIME_INFO_CLASS_).remove();
};



/**
 * Contains the entries for the level data.
 * @param {!Array<historian.Entry>} data The level line data.
 * @param {!historian.Context} context The context for the graph.
 * @param {boolean} enableSampling Whether to enable sampling.
 * @constructor
 * @struct
 */
historian.LevelLine.Data = function(data, context, enableSampling) {
  /** @private {!historian.Context} */
  this.context_ = context;

  /** @private {boolean} */
  this.enableSampling_ = enableSampling;

  /**
   * Whether the processedData_ has sampling applied.
   * @private {boolean}
   */
  this.processed_ = false;

  /** @private {!Array<historian.Entry>} */
  this.initialData_ = data;

  /**
   * Data to display, this has been sampled if the current zoom level
   * is low enough.
   * @private {!Array<historian.Entry>}
   */
  this.processedData_ = this.initialData_;

  /**
   * Whether the filtered data is valid or has been invalidated.
   * @private {boolean}
   */
  this.filteredValid_ = false;

  /**
   * Data that has been filtered with isInViewableRange.
   * Invalidated on pan or zoom.
   * @private {!Array<historian.Entry>}
   */
  this.filteredData_ = this.initialData_;

  this.processData_(true);
};


/**
 * Renders the level line and legend.
 */
historian.LevelLine.prototype.render = function() {
  this.renderLevelLine_();
  this.renderLevelSummaries();
  this.renderLegend_();
};


/**
 * Redraws the level related elements on window resize.
 */
historian.LevelLine.prototype.resize = function() {
  this.renderLevelLine_();
  this.renderLevelSummaries();
  this.renderLegend_();
  this.timeInfo_.hide();
};


/**
 * Updates the level line upon zoom.
 */
historian.LevelLine.prototype.update = function() {
  if (this.config_.displayPowerInfo) {
    this.displayTotalCharge_();
  }
  this.displayedLevelData_.processData_(false);
  this.renderLevelLine_();
  this.renderLevelSummaries();
  this.renderLegend_();
  this.timeInfo_.hide();
};


/**
 * Displays the total charge consumed for the currently visible data points.
 * @private
 */
historian.LevelLine.prototype.displayTotalCharge_ = function() {
  this.context_.svg.selectAll('.' + historian.LevelLine.VIEW_INFO_CLASS_)
      .remove();
  var levelViewInfo = this.context_.svg.append('g')
      .attr('class', historian.LevelLine.VIEW_INFO_CLASS_);

  // Get all the data points visible in the current view.
  // We don't want sampled data, so use the original data points.
  var startTime = this.context_.xScale.invert(0);
  var endTime = this.context_.xScale.invert(
      this.context_.visSize[historian.constants.WIDTH]);
  var visibleData = historian.LevelLine.Data.inViewableRange(
      startTime, endTime, this.levelData_);

  var total = historian.utils.calculateTotalChargeFormatted(visibleData);
  var avg = historian.LevelLine.calculateAvgCurrent_(visibleData);
  var text = goog.string.subs('Power stats for current view: ' +
      '[ Total charge: %s mAh ]  [ Average current: %s mA ]', total, avg);
  levelViewInfo.append('text')
      .attr('x', historian.LevelLine.POWER_DISPLAY_X_OFFSET_)
      .attr('y', historian.LevelLine.POWER_DISPLAY_Y_OFFSET_)
      .text(text);
};


/**
 * Returns the average current (mA) for the data.
 * @param {!Array<!historian.Entry>} data data.
 * @return {string} The mA rounded to 2 decimal places, as a formatted string.
 * @private
 */
historian.LevelLine.calculateAvgCurrent_ = function(data) {
  var total = 0;
  data.forEach(function(d) {
    total += d.value;
  });
  var avgMA = total / data.length;
  return avgMA.toFixed(2);
};


/**
 * Returns the data to be displayed.
 * @return {!Array<historian.Entry>} The data to display.
 */
historian.LevelLine.Data.prototype.getDisplayedData = function() {
  if (!this.filteredValid_) {
    var startTime = this.context_.xScale.invert(0);
    var endTime = this.context_.xScale.invert(
        this.context_.visSize[historian.constants.WIDTH]);

    this.filteredData_ = historian.LevelLine.Data.inViewableRange(
        startTime, endTime, this.processedData_);
    historian.LevelLine.Data.adjustLevelData_(
        this.filteredData_, this.initialData_);
  }
  return this.filteredData_;
};


/**
 * Returns a copy of the data points visible in the current time range using
 * binary search.
 * The data entries should be contiguous and non overlapping. Both the query
 * time ranges and data entry time ranges should have an inclusive start time
 * and exclusive end time.
 * @param {number} startTime The start time of the viewable time range.
 * @param {number} endTime The end time of the viewable time range.
 * @param {!Array<historian.Entry>} data The data to filter.
 * @return {!Array<historian.Entry>} The visible points.
 */
historian.LevelLine.Data.inViewableRange = function(startTime, endTime, data) {
  if (goog.array.isEmpty(data)) {
    return [];
  }
  // Requesting range that comes after last end time of data range or before
  // first start time of data range.
  if (startTime >= data[data.length - 1].endTime ||
      endTime <= data[0].startTime) {
    return [];
  }

  var startObj = {
    startTime: startTime
  };
  var startIndex = goog.array.binarySearch(data, startObj, function(d1, d2) {
    return d1.startTime - d2.startTime;
  });
  if (startIndex < 0) {
    // If the start time was not found in the array, binarySearch returns the
    // index it would have been inserted in, -1.
    startIndex = -(startIndex + 1);

    // We want the element that is right before the insertion point.
    if (startIndex != 0) {
      startIndex--;
    }
  }
  var endObj = {
    endTime: endTime
  };
  var endIndex = goog.array.binarySearch(data, endObj, function(d1, d2) {
    return d1.endTime - d2.endTime;
  });

  if (endIndex < 0) {
    endIndex = -(endIndex + 1);
  }
  return goog.array.slice(data, startIndex, endIndex + 1);
};


/**
 * Creates an extra entry using the end time of the last entry of the
 * filtered data, and the value of the corresponding next entry from the
 * initial data.
 *
 * Each battery level entry has a start and end time. Since we only use
 * the start time as data points in the line graph, we need to create
 * an extra point for the end time for the very last entry of the filtered
 * data.
 *
 * @param {!Array<historian.Entry>} filteredData The data to adjust.
 * @param {!Array<historian.Entry>} initialData The original data before
 *     filtering.
 * @private
 */
historian.LevelLine.Data.adjustLevelData_ =
    function(filteredData, initialData) {
  if (filteredData == null || initialData == null ||
      filteredData.length == 0) {
    return;
  }

  var last = filteredData[filteredData.length - 1];
  // If the filtered data is equal to the initial data, we can just duplicate
  // the value of the last entry.
  var value = last.value;

  // filteredData is the visible points from initialData, so filteredData
  // should always be equal or smaller in length.
  goog.asserts.assert(filteredData.length <= initialData.length,
      'filteredData length: ' + filteredData.length +
      ', initialData length: ' + initialData.length);


  // If entries have been filtered out of initialData, we need to find the value
  // that would've come after the last entry in the data array.
  if (filteredData.length < initialData.length) {
    for (var i = 0; i < initialData.length; i++) {
      if (initialData[i].startTime == last.endTime) {
        value = initialData[i].value;
        break;
      }
    }
  }
  var newEntry = {
    startTime: last.endTime,
    endTime: last.endTime,
    value: value
  };
  filteredData.push(newEntry);
};


/**
 * Processes the data depending on the current zoom level.
 * @param {boolean} initialLoad Whether the page is being loaded initially.
 * @private
 */
historian.LevelLine.Data.prototype.processData_ = function(initialLoad) {
  this.filteredValid_ = false;
  if (this.enableSampling_) {
    var process = initialLoad ||
        (this.context_.msPerPixel() > historian.time.MSECS_IN_SEC);
    if (process && !this.processed_) {
      this.processedData_ = historian.data.sampleData(this.initialData_);
      this.processed_ = true;
    }
    if (!process && this.processed_) {
      this.processedData_ = this.initialData_;
      this.processed_ = false;
    }
  }
};


/**
 * Renders the battery level line from the data.
 * @private
 */
historian.LevelLine.prototype.renderLevelLine_ = function() {
  this.context_.svgLevel.select('.' + historian.LevelLine.LINE_CLASS_).remove();
  var displayedData = this.displayedLevelData_.getDisplayedData();
  this.context_.svgLevel.append('svg:path')
      .attr('d', this.levelLine_(displayedData))
      .attr('class', historian.LevelLine.LINE_CLASS_ + ' ' + this.config_.id);
};


/**
 * Renders a vertical line indicating the current time point hovered.
 * @param {number} x The x screen coordinate of the time point.
 * @private
 */
historian.LevelLine.prototype.renderTimePoint_ = function(x) {
  this.hideTimePoint_();
  this.context_.svg.append('line')
      .attr('class', 'time-point')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', 0)
      .attr('y2', this.context_.svgSize[1]);
};


/**
 * Hides the time point line.
 * @private
 */
historian.LevelLine.prototype.hideTimePoint_ = function() {
  this.context_.svg.select('.time-point').remove();
};


/**
 * Renders the legend for the battery level line.
 * @private
 */
historian.LevelLine.prototype.renderLegend_ = function() {
  this.context_.svg.selectAll('.' + historian.LevelLine.LEGEND_CLASS_).remove();
  var startX =
      this.context_.svgSize[0] - historian.Context.MARGINS.RIGHT +
      historian.LevelLine.LEGEND_X_OFFSET;
  var startY = this.context_.svgSize[1] / 2 -
      historian.LevelLine.LEGEND_Y_OFFSET;

  var legend = this.context_.svg.append('g')
      .attr('class', historian.LevelLine.LEGEND_CLASS_)
      .attr('x', startX)
      .attr('y', startY);

  legend.append('rect')
      .attr('class', 'child')
      .attr('x', startX)
      .attr('y', startY)
      .attr('width', historian.LevelLine.LEGEND_SIZE_PX_)
      .attr('height', historian.LevelLine.LEGEND_SIZE_PX_);

  var textCoordY = startY + (historian.LevelLine.LEGEND_SIZE_PX_ * 2);

  legend.append('text')
      .attr('class', 'legend-text')
      .attr('x', startX)
      .attr('y', textCoordY)
      .attr('transform', 'rotate(90 ' + startX + ',' + textCoordY + ')')
      .text(this.config_.legendText);
};


/**
 * Renders the hover line and battery level text on mouse move.
 */
historian.LevelLine.prototype.renderTimeInfo = function() {
  // Get coordinates relative to SVG rather than page.
  var coords = d3.mouse(this.context_.graph[0]);
  // Position the hoverLine x coordinate to be on the mouse coordinates.
  this.renderTimePoint_(coords[0]);

  // Get the time value of the chart corresponding to the mouse position.
  var xValue =
      this.context_.xScale.invert(coords[0] - historian.Context.MARGINS.LEFT);

  // Get the index of the data point corresponding to the time value.
  // The bisector finds where the time value bisects the data array.
  var bisector = d3.bisector(function(d) {
    return d.startTime;
  }).right;

  var displayedData = this.displayedLevelData_.getDisplayedData();
  var insertionIndex = bisector(displayedData, xValue) - 1;

  if (insertionIndex < displayedData.length - 1 &&
      xValue >= displayedData[0].startTime) {
    this.timeInfo_.render(insertionIndex, coords, xValue);
  } else {
    // Time does not match data point - mouse is too far left
    // or right of chart. Hide battery level text and line highlighter.
    this.timeInfo_.hide();
  }
};


/**
 * Hides the level display.
 */
historian.LevelLine.prototype.hideTimeInfo = function() {
  this.timeInfo_.hide();
  this.hideTimePoint_();
};


/**
 * Renders the selected / colored level drops form the level summary data.
 */
historian.LevelLine.prototype.renderLevelSummaries = function() {
  var data = this.levelSummaryData_;
  var startTimeIndex = data.dimensionToIndex[
      historian.levelSummary.Dimensions.START_TIME];
  var endTimeIndex = data.dimensionToIndex[
      historian.levelSummary.Dimensions.END_TIME];
  var initialBatteryIndex = data.dimensionToIndex[
      historian.levelSummary.Dimensions.INITIAL_BATTERY_LEVEL];
  var finalBatteryIndex = data.dimensionToIndex[
      historian.levelSummary.Dimensions.FINAL_BATTERY_LEVEL];

  var levelDrops = [];
  for (var i = 0; i < data.values.length; i++) {
    var classes = '';
    if (classes) {
      var startTime = data.values[i][startTimeIndex];
      var endTime = data.values[i][endTimeIndex];
      var initialBattery = data.values[i][initialBatteryIndex];
      var finalBattery = data.values[i][finalBatteryIndex];
      levelDrops.push({
        startTime: startTime,
        x1: this.context_.xScale(startTime),
        x2: this.context_.xScale(endTime),
        y1: this.context_.yScale(initialBattery),
        y2: this.context_.yScale(finalBattery),
      });
    }
  }
  var lines = this.context_.svgLevelSummaries.selectAll('.level-summary')
      .data(levelDrops, function(levelDrop) {
        return levelDrop.startTime;
      });
  lines.enter().append('line')
      .attr('class', 'level-summary');
  lines.attr('x1', function(d) { return d.x1; })
      .attr('x2', function(d) { return d.x2; })
      .attr('y1', function(d) { return d.y1; })
      .attr('y2', function(d) { return d.y2; });
  lines.exit().remove();
  // Renders a vertical box to make the level drop prominent.
  var boxHeight = this.context_.visSize[historian.constants.HEIGHT];
  var boxes = this.context_.svgLevelBoxes.selectAll('rect')
      .data(levelDrops, function(levelDrop) {
        return levelDrop.startTime;
      });
  boxes.enter().append('rect')
      .attr('class', 'level-summary');
  boxes.attr('x', function(d) { return d.x1; })
      .attr('width', function(d) { return d.x2 - d.x1; })
      .attr('height', boxHeight);
  boxes.exit().remove();
};



/**
 * Class for displaying information about the time and battery level
 * durrently hovered by the mouse.
 *
 * @param {!historian.Context} context The visualisation context.
 * @param {!historian.LevelLine.Data} levelData
 *     The battery level series to display.
 * @param {!historian.LevelConfiguration} config The config for the metric.
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @constructor
 * @struct
 * @private
 */
historian.LevelLine.TimeInfo_ = function(
    context, levelData, config, levelSummaryData) {
  /** @private {!historian.Context} */
  this.context_ = context;

  /** @private {!historian.LevelLine.Data} */
  this.levelData_ = levelData;

  /** @private {?historian.Entry} */
  this.levelStart_ = null;

  /** @private {?historian.Entry} */
  this.levelEnd_ = null;

  /** @private (!historian.LevelConfiguration} */
  this.config_ = config;

  /** @private {!historian.LevelSummaryData} */
  this.levelSummaryData_ = levelSummaryData;

  /**
   * Contents of time info lines.
   * @private {!Array<string>}
   */
  this.lines_ = [];
};


/**
 * Adds a line to the time info display.
 * @param {string} line The line content.
 * @private
 */
historian.LevelLine.TimeInfo_.prototype.addLine_ = function(line) {
  this.lines_.push(line);
};


/**
 * Updates the battery level display for the given data index.
 * @param {number} i Index of the data point of the start of the duration
 *     to display.
 * @param {!Array<number>} coords The coordinate of the mouse event.
 * @param {number} time The time value corresponding to the mouse position.
 */
historian.LevelLine.TimeInfo_.prototype.render = function(i, coords,
    time) {
  // Start and end level data points corresponding to index.
  this.levelStart_ = this.levelData_.getDisplayedData()[i];
  this.levelEnd_ = this.levelData_.getDisplayedData()[i + 1];

  var startValue = this.levelStart_.value;
  var endValue = this.levelEnd_.value;
  var loc = this.context_.location;
  // Calculate details for text display.
  var timeText = 'Current time: ' + historian.time.getTime(time, loc);
  var batteryLevelText = goog.string.subs('%s: between %s and %s',
      this.config_.levelDisplayText, startValue, endValue);

  if (this.config_.formatLevel) {
    batteryLevelText += goog.string.subs(' (%s and %s mAh)',
        this.config_.formatLevel(goog.asserts.assertNumber(startValue)),
        this.config_.formatLevel(goog.asserts.assertNumber(endValue)));
  }
  var duration = historian.time.formatDuration(
      this.levelEnd_.startTime - this.levelStart_.startTime);

  var durationText = 'Duration: ' + duration +
      ', from ' + historian.time.getTime(this.levelStart_.startTime, loc) +
      ' to ' + historian.time.getTime(this.levelEnd_.startTime, loc);

  this.lines_ = [];
  // Set contents of text display.
  this.addLine_(timeText);
  this.addLine_(batteryLevelText);

  if (this.config_.formatDischarge) {
    var dischargeText = historian.LevelLine.calculateDischarge_(
        this.levelStart_, this.levelEnd_, this.config_);
    this.addLine_(dischargeText);
  }
  this.addLine_(durationText);

  // Set text display to be right of mouse cursor, at top of page.
  this.renderTimeInfo_(coords[0], coords[1]);
  this.renderHoveredSegment_();
  this.show();
};


/**
 * Renders the floating time info near the hover line.
 * @param {number} x The desired x coordinate of the info box.
 * @param {number} y The desired y coordinate of the info box.
 * @private
 */
historian.LevelLine.TimeInfo_.prototype.renderTimeInfo_ = function(x, y) {
  var container = this.context_.graph;
  container.find('.' + historian.LevelLine.TIME_INFO_CLASS_).remove();
  var info = $('<div></div>')
      .addClass(historian.LevelLine.TIME_INFO_CLASS_)
      .css({
        left: x,
        top: 0
      });
  this.lines_.forEach(function(line, index) {
    $('<div></div>')
        .text(line)
        .appendTo(info);
  });
  info.appendTo(container);
  // If there isn't enough space to the right of the cursor,
  // then show the timeinfo on the cursor's left.
  if (x + info.outerWidth() > container.width()) {
    info.css('left', x - info.outerWidth());
  }
  // If mouse if at the top of the plot, then put the time info
  // near the bottom.
  if (y <= info.outerHeight()) {
    info.css('top', container.height() - info.outerHeight());
  }
};


/**
 * Renders the colored line for overlaying on top of battery level line,
 * for the level currently under mouse over.
 * @private
 */
historian.LevelLine.TimeInfo_.prototype.renderHoveredSegment_ = function() {
  this.context_.svgLevel
      .select('.' + historian.LevelLine.LINE_HIGHLIGHTER_CLASS_).remove();
  if (this.levelStart_ != null && this.levelEnd_ != null) {
    var xStart = this.context_.xScale(this.levelStart_.startTime);
    var yStart = this.context_.yScale(
        /** @type {number} */ (this.levelStart_.value));
    var xEnd = this.context_.xScale(this.levelEnd_.startTime);
    var yEnd = this.context_.yScale(
        /** @type {number} */ (this.levelEnd_.value));

    // Highlight section of battery level line currently being mouse overed.
    this.context_.svgLevel
        .append('line')
        .attr('class', historian.LevelLine.LINE_HIGHLIGHTER_CLASS_)
        .attr('x1', xStart)
        .attr('y1', yStart)
        .attr('x2', xEnd)
        .attr('y2', yEnd);
  }
};


/**
 * Shows the level highlight element.
 */
historian.LevelLine.TimeInfo_.prototype.show = function() {
  this.context_.graph.find('.' + historian.LevelLine.TIME_INFO_CLASS_).show();
  this.context_.graph
      .find('.' + historian.LevelLine.LINE_HIGHLIGHTER_CLASS_).show();
};


/**
 * Hides the level display from view.
 */
historian.LevelLine.TimeInfo_.prototype.hide = function() {
  this.context_.graph.find('.' + historian.LevelLine.TIME_INFO_CLASS_).hide();
  this.context_.graph
      .find('.' + historian.LevelLine.LINE_HIGHLIGHTER_CLASS_).hide();
};


/**
 * Static function for calculating the % discharge / charge rate / hour,
 * given 2 battery level data entries, returning it in string format.
 *
 * @param {historian.Entry} d1 The data point for start.
 * @param {historian.Entry} d2 The data point for end.
 * @param {historian.LevelConfiguration} config The config for the metric.
 * @return {string} Returns the formatted discharge / charge rate information.
 * @private
 */
historian.LevelLine.calculateDischarge_ = function(d1, d2, config) {
  var levelDifference = d2.value - d1.value;
  var timeDiff = d2.startTime - d1.startTime;

  var rate = historian.time.MSECS_IN_HOUR / timeDiff * levelDifference;
  return config.formatDischarge(rate);
};
