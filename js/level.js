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
goog.provide('historian.LevelLine.Data');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('goog.string');
goog.require('historian.Context');
goog.require('historian.color');
goog.require('historian.constants');
goog.require('historian.data');
goog.require('historian.historianV2Logs');
goog.require('historian.levelSummary');
goog.require('historian.levelSummary.Dimensions');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.time');
goog.require('historian.utils');


// TODO: replace with goog.module.
goog.scope(function() {


/** @private @const {string} */
var LINE_CLASS_ = 'level-line';


/** @private @const {string} */
var LINE_CLASS_CONNECTOR_ = 'level-line-connector';



/**
 * LevelLine creates the battery level chart line, and the vertical
 * hover line and text showing battery level information.
 *
 * @param {!historian.Context} context The visualisation context.
 * @param {!historian.LevelData} levelData The level data to display.
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @param {boolean} showReportTaken Whether to render the line showing
 *     when the bug report was taken.
 * @param {?number} overflowMs The unix time in milliseconds of when the
 *     overflow occurred.
 * @param {!Object<!Array<!historian.Entry>>=} opt_levelSummaries
 *     Additional data to display for each level drop.
 * @param {jQuery=} opt_container The container the graph is rendered in.
 * @constructor
 * @struct
 */
historian.LevelLine = function(context, levelData, levelSummaryData,
    showReportTaken, overflowMs, opt_levelSummaries, opt_container) {
  /** @private {!historian.Context} */
  this.context_ = context;

  /** @private {!historian.LevelData} */
  this.allLevelData_ = levelData;

  /** @private {!Array<!Array<historian.Entry>>} */
  this.levelData_ = levelData.getData();

  /** @private {!historian.LevelSummaryData} */
  this.levelSummaryData_ = levelSummaryData;

  /** @private {!historian.LevelConfiguration} */
  this.config_ = levelData.getConfig();

  /** @private {!Object<!Array<!historian.Entry>>|undefined} */
  this.levelDetailSummary_ = opt_levelSummaries;

  /**
   * The actual data being displayed.
   * @private {!historian.LevelLine.Data}
   */
  this.displayedLevelData_ = new historian.LevelLine.Data(
      this.levelData_, context, this.config_.enableSampling);

  /** @private {function(!Object)} */
  this.levelLine_ = d3.line()
      .x(function(d) {
        return context.xScale(d.startTime);
      })
      .y(function(d) {
        return context.yScale(d.value);
      })
      .curve(d3.curveLinear);
  /**
   * Text information and line highlighter for battery level.
   * @private {!historian.LevelLine.TimeInfo_}
   */
  this.timeInfo_ = new historian.LevelLine.TimeInfo_(
      this.context_, this.displayedLevelData_, this.config_,
      this.levelSummaryData_, this.levelDetailSummary_);

  /** @private {boolean} */
  this.showReportTaken_ = showReportTaken;

  /** @private {?number} */
  this.overflowMs_ = overflowMs;

  /** @private {?jQuery} */
  this.container_ = opt_container || null;
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
historian.LevelLine.LEGEND_X_OFFSET = 80;


/**
 * Additional legends are rendered with this offset to the left of the initial
 * one. This must be larger than LEGEND_SIZE_PX_.
 * @const {number}
 */
historian.LevelLine.LEGEND_X_ADDITIONAL_OFFSET = 20;


/**
 * Legends are rendered with this padding from previous legends in the same
 * column.
 * @const {number}
 */
historian.LevelLine.LEGEND_Y_PADDING = 10;


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
historian.LevelLine.VIEW_INFO_CLASS_ = 'level-view-info';


/** @private @const {string} */
historian.LevelLine.LINE_HIGHLIGHTER_CLASS_ = 'level-highlighted';


/** @private @const {string} */
historian.LevelLine.TIME_INFO_CLASS_ = 'level-timeinfo';


/**
 * Removes all level related elements from the DOM.
 */
historian.LevelLine.prototype.clear = function() {
  if (!this.container_) {
    return;
  }
  this.container_.find(historian.LevelLine.VIEW_INFO_CLASS_).remove();
  this.container_.find(LINE_CLASS_).remove();
  this.container_.find(historian.LevelLine.LEGEND_CLASS_).remove();
  this.container_.find(historian.LevelLine.LINE_HIGHLIGHTER_CLASS_).remove();
  this.container_.find(historian.LevelLine.TIME_INFO_CLASS_).remove();
  this.context_.svgLevelEventMarkers.selectAll('*').remove();
};



/**
 * Contains the entries for the level data.
 * @param {!Array<!Array<historian.Entry>>} data The level line data.
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

  /** @private {!Array<!Array<historian.Entry>>} */
  this.initialData_ = data;

  /**
   * Data to display, this has been sampled if the current zoom level
   * is low enough.
   * @private {!Array<!Array<historian.Entry>>}
   */
  this.processedData_ = this.initialData_;

  /**
   * Data that has been filtered with inTimeRange.
   * Invalidated on pan or zoom.
   * @private {!Array<!Array<historian.Entry>>}
   */
  this.filteredData_ = this.initialData_;

  this.processData_(true);
};


/**
 * Renders the level line and legend.
 */
historian.LevelLine.prototype.render = function() {
  this.displayTotalCharge_();
  this.renderLevelLine_();
  this.renderLevelSummaries();
  this.renderLegend_();
  this.renderEventMarkers_();
};


/**
 * Redraws the level related elements on window resize.
 */
historian.LevelLine.prototype.resize = function() {
  this.renderLevelLine_();
  this.renderLevelSummaries();
  this.renderLegend_();
  this.timeInfo_.hide();
  this.renderEventMarkers_();
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
  this.renderEventMarkers_();
};


/**
 * Displays the total charge consumed for the currently visible data points.
 * @private
 */
historian.LevelLine.prototype.displayTotalCharge_ = function() {
  this.context_.svg.selectAll('.' + historian.LevelLine.VIEW_INFO_CLASS_)
      .remove();
  if (!this.config_.displayPowerInfo) {
    return;
  }
  var levelViewInfo = this.context_.svg.append('g')
      .attr('class', historian.LevelLine.VIEW_INFO_CLASS_);

  // Get all the data points visible in the current view.
  // We don't want sampled data, so use the original data points.
  var startTime = this.context_.invertPosition(0);
  var endTime = this.context_.invertPosition(
      this.context_.visSize[historian.constants.WIDTH]);
  var visibleData = historian.utils.inTimeRange(
      startTime, endTime,
      this.allLevelData_.getOriginalData(historian.metrics.Csv.POWER_MONITOR));

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
  var avgMA = data.length == 0 ? 0 : total / data.length;
  return avgMA.toFixed(2);
};


/**
 * Returns the data to be displayed.
 * @return {!Array<!Array<historian.Entry>>} The data to display.
 */
historian.LevelLine.Data.prototype.getDisplayedData = function() {
  var startTime = this.context_.invertPosition(0);
  var endTime = this.context_.invertPosition(
      this.context_.visSize[historian.constants.WIDTH]);

  this.filteredData_ = this.processedData_.map(function(pd) {
    return historian.utils.inTimeRange(startTime, endTime, pd);
  });
  historian.LevelLine.Data.adjustLevelData_(
      this.filteredData_, this.initialData_);
  return this.filteredData_;
};


/**
 * In each array of filtered data, creates an extra entry using the end time of
 * the last entry of the filtered data, and the value of the corresponding next
 * entry from the initial data.
 *
 * Each battery level entry has a start and end time. Since we only use
 * the start time as data points in the line graph, we need to create
 * an extra point for the end time for the very last entry of the filtered
 * data.
 *
 * @param {!Array<!Array<historian.Entry>>} filteredDataArrays The data to
 *     adjust.
 * @param {!Array<!Array<historian.Entry>>} initialDataArrays The original data
 *     before filtering.
 * @private
 */
historian.LevelLine.Data.adjustLevelData_ =
    function(filteredDataArrays, initialDataArrays) {
  if (filteredDataArrays == null || initialDataArrays == null) {
    return;
  }
  goog.asserts.assert(filteredDataArrays.length == initialDataArrays.length,
      'list of filteredData and initialData have different lengths: ' +
      filteredDataArrays.length + ' vs ' + initialDataArrays.length);

  for (var i = 0; i < filteredDataArrays.length; i++) {
    var filtered = filteredDataArrays[i];
    var initial = initialDataArrays[i];
    if (filtered.length == 0 || initial.length == 0) {
      continue;
    }
    var last = filtered[filtered.length - 1];
    // If the filtered data is equal to the initial data, we can just duplicate
    // the value of the last entry.
    var value = last.value;

    // filtered is the visible points from initial, so filtered should always be
    // equal or smaller in length.
    goog.asserts.assert(filtered.length <= initial.length,
        'filtered length: ' + filtered.length +
        ', initial length: ' + initial.length);


    // If entries have been filtered out of initial, we need to find the
    // value that would've come after the last entry in the data array.
    if (filtered.length < initial.length) {
      for (var i = 0; i < initial.length; i++) {
        if (initial[i].startTime == last.endTime) {
          value = initial[i].value;
          break;
        }
      }
    }
    var newEntry = {
      startTime: last.endTime,
      endTime: last.endTime,
      value: value
    };
    filtered.push(newEntry);
  }
};


/**
 * Processes the data depending on the current zoom level.
 * @param {boolean} initialLoad Whether the page is being loaded initially.
 * @private
 */
historian.LevelLine.Data.prototype.processData_ = function(initialLoad) {
  if (this.enableSampling_) {
    var process = this.context_.msPerPixel() > historian.time.MSECS_IN_SEC;
    if (process && !this.processed_) {
      this.processedData_ = this.initialData_.map(historian.data.sampleData);
      this.processed_ = true;
    }
    if (!process && this.processed_) {
      this.processedData_ = this.initialData_;
      this.processed_ = false;
    }
  }
};


/**
 * Renders the level line from the data.
 * @private
 */
historian.LevelLine.prototype.renderLevelLine_ = function() {
  this.context_.svgLevel.selectAll('.' + LINE_CLASS_).remove();

  var displayedData = this.displayedLevelData_.getDisplayedData();
  for (var i = 0; i < displayedData.length; i++) {
    if (historian.metrics.isDiscontinuousLevelGroup(this.config_.name) ||
        this.config_.isRateOfChange) {
      this.renderDiscontinuous_(displayedData[i], i);
    } else {
      this.renderLine_(displayedData[i], i);
    }
  }
};


/**
 * Renders a line with the given data.
 * @param {!Array<historian.Entry>} data The data to display.
 * @param {number} idx The index of the line. Needed to select the correct
 *     color.
 * @param {number=} opt_opacity The opacity to use. If not provided,
 *     the opacity will be retrieved from the config.
 * @private
 */
historian.LevelLine.prototype.renderLine_ = function(data, idx, opt_opacity) {
  var classes = [LINE_CLASS_, this.config_.id];
  this.context_.svgLevel.append('svg:path')
      .attr('d', this.levelLine_(data))
      .attr('class', classes.join(' '))
      .attr('style', 'stroke: ' + historian.color.getLineColor(idx))
      .style('opacity', opt_opacity != null ?  // Not falsy check as could be 0.
          opt_opacity : this.config_.opacity);
};


/**
 * Renders lines for the given discontinuous data.
 * @param {!Array<historian.Entry>} data The data to display.
 * @param {number} idx The index of the line. Needed to select the correct
 *     color.
 * @private
 */
historian.LevelLine.prototype.renderDiscontinuous_ = function(data, idx) {
  data.forEach(function(d, i) {
    // Plot each entry as a separate line.
    // Discontinuous data such as rate of change data is different from
    // the usual level data. Level data represents values at points in
    // time e.g. 99 at 10am, while the rate of change data represents
    // values over a period of time.
    // e.g. the rate of change for the time period 10am - 11am was 3.
    var points = [
      {
        startTime: d.startTime,
        endTime: d.endTime,
        value: d.value
      },
      {
        startTime: d.endTime,
        endTime: d.endTime,
        value: d.value
      }
    ];
    var opacity = this.config_.opacity;
    var fadedOpacity = Math.min(0.2, this.config_.opacity);
    // For screen off discharge rate, we show a faded segment if it is
    // after the battery history overflowed (and hence won't have any screen
    // on events then), or the event was mostly during screen on.
    if (historian.metrics.isScreenOffDischargeMetric(this.config_.name) &&
        ((this.overflowMs_ && d.endTime > this.overflowMs_) ||
        !d.duringScreenOff)) {
      opacity = fadedOpacity;
    }
    this.renderLine_(points, idx, opacity);

    // Render a vertical line connecting adjacent discontinuous data points.
    if (i < data.length - 1) {
      var next = data[i + 1];

      var classes = [LINE_CLASS_, LINE_CLASS_CONNECTOR_, this.config_.id];
      this.context_.svgLevel.append('line')
          .attr('class', classes.join(' '))
          .attr('x1', this.context_.xScale(next.startTime))
          .attr('x2', this.context_.xScale(next.startTime))
          .attr('y1', this.context_.yScale(/** @type {number} */ (d.value)))
          .attr('y2', this.context_.yScale(/** @type {number} */ (next.value)))
          .attr('style', 'stroke: ' + historian.color.getLineColor(idx))
          .style('opacity', fadedOpacity);
    }
  }, this);
};


/**
 * Renders a vertical dotted line for special events, such as when the bug
 * report was taken, or when overflow occurred.
 * @private
 */
historian.LevelLine.prototype.renderEventMarkers_ = function() {
  this.context_.svgLevelEventMarkers.selectAll('*').remove();
  if (!this.showReportTaken_ && !this.overflowMs_) {
    return;
  }
  var renderVerticalMarker = function(unixMs, label, opt_lineClass) {
    var domain = this.context_.xScale.domain();
    // Only render if it falls within the graph's possible domain. Otherwise
    // it will be wrongly rendered at the start or end of the graph (returned
    // by xScale for out of range values).
    if (unixMs < domain[0] || unixMs > domain[1]) {
      return;
    }
    this.context_.svgLevelEventMarkers.append('line')
        .attr('class', 'level-event-marker-line' +
            (opt_lineClass ? ' ' + opt_lineClass : ''))
        .attr('x1', this.context_.xScale(unixMs))
        .attr('x2', this.context_.xScale(unixMs))
        .attr('y1', 0)
        .attr('y2', this.context_.svgSize[1]);
    this.context_.svgLevelEventMarkers.append('text')
        .attr('class', 'level-event-marker-label')
        .attr('x', this.context_.xScale(unixMs) - 5)
        .attr('y', this.context_.svgSize[1] - 34)  // Don't hit time labels.
        .text(label);
  }.bind(this);
  if (this.overflowMs_) {
    renderVerticalMarker(
        this.overflowMs_, 'Battery history overflowed', 'overflow');
  }
  if (!this.showReportTaken_) {
    return;
  }
  var logcatMisc =
      this.allLevelData_.getGroupData(historian.metrics.Csv.LOGCAT_MISC);
  if (!logcatMisc) {
    return;
  }
  // There might be other series in the group such as unavailable or error
  // series, so find the series from the system log.
  var idx = goog.array.findIndex(logcatMisc.series, function(series) {
    return series.source == historian.historianV2Logs.Sources.SYSTEM_LOG;
  });
  if (idx == -1) {
    return;
  }
  // There may be multiple times for when the bug report was taken.
  logcatMisc.series[idx].values.forEach(function(entry) {
    renderVerticalMarker(entry.startTime, 'Report collection triggered');
  }, this);
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
  var context = this.context_;
  context.svg.selectAll('.' + historian.LevelLine.LEGEND_CLASS_).remove();
  if (!this.config_.name) {  // An empty name means no line is displayed.
    return;
  }
  var s = context.svg.node().getBoundingClientRect();
  var maxHeight = context.svgSize[historian.constants.HEIGHT];
  // Only space available is between the axis and the end of the svg.
  var maxWidth = context.svgSize[historian.constants.WIDTH] -
      (historian.Context.MARGINS.LEFT +
       context.visSize[historian.constants.WIDTH]) -
      // Try to leave some space for the axis numbers.
      historian.LevelLine.LEGEND_X_ADDITIONAL_OFFSET;
  var curHeight = 0;
  var curWidth = 0;
  var container = context.svg.append('g')
      .attr('class', historian.LevelLine.LEGEND_CLASS_)
      // We need to append the legend to get the size, but hide it from view
      // while we're working out the exact position.
      .style('visibility', 'hidden');
  var makeLabel = function(text, opt_idx) {
    if (curWidth >= maxWidth) {
      console.log(
          'Too many legends, not enough space. Oh, what is a function to do?');
      // Give up.
      return;
    }
    var legend = container.append('g');

    var startX = context.svgSize[0] - historian.Context.MARGINS.RIGHT +
        historian.LevelLine.LEGEND_X_OFFSET - curWidth;
    var startY = historian.Context.MARGINS.TOP + curHeight;

    legend.append('rect')
        .attr('class', 'child')
        .attr('fill', historian.color.getLineColor(opt_idx || 0))
        .attr('x', startX)
        .attr('y', startY)
        .attr('width', historian.LevelLine.LEGEND_SIZE_PX_)
        .attr('height', historian.LevelLine.LEGEND_SIZE_PX_);

    // The text should be directly below the colored legend square.
    var textCoordY = startY + (historian.LevelLine.LEGEND_SIZE_PX_ * 2);

    legend.append('text')
        .attr('class', 'legend-text')
        .attr('x', startX)
        .attr('y', textCoordY)
        .attr('transform', 'rotate(90 ' + startX + ',' + textCoordY + ')')
        .text(text);

    var legendSize = legend.node().getBoundingClientRect();
    if (legendSize.height >= maxHeight) {
      // The text is so long that it can't fit. There's currently nothing that
      // should trigger this case, but adding it here so we're semi-prepared.
      // TODO: find a way to shorten the text
      curWidth += historian.LevelLine.LEGEND_X_ADDITIONAL_OFFSET;
      if (curHeight != 0) {
        // Put the legend on it's own line.
        curHeight = 0;
        legend.remove();
        makeLabel(text, opt_idx);
      }
      return;
    }
    curHeight =
        startY + legendSize.height + historian.LevelLine.LEGEND_Y_PADDING;
    if (curHeight > maxHeight) {
      curHeight = 0;
      curWidth += historian.LevelLine.LEGEND_X_ADDITIONAL_OFFSET;
      // Recreate legend in better location.
      legend.remove();
      if (curWidth >= maxWidth) {
        console.log(
            'Too many legends, not enough space. ERROR! ERROR! Shutting down.');
        // Give up.
        return;
      }
      makeLabel(text, opt_idx);
    }
  };
  if (this.config_.legendTexts) {
    var textIdx = {};
    // Sort by size to try and fit as many in as possible.
    var legendTexts = this.config_.legendTexts.slice();
    for (var i = 0; i < legendTexts.length; i++) {
      textIdx[legendTexts[i]] = i;
    }
    legendTexts.sort(function(a, b) {return a.length - b.length;});
    legendTexts.forEach(function(t) {
      makeLabel(t, textIdx[t]);
    });
  } else {
    makeLabel(this.config_.legendText);
  }
  if (curWidth == 0) {
    // Only try to center if there's one row of legends, otherwise, it would
    // look a little weird.
    // Since the y coordinate refers to the top edge position, we need to
    // subtract half the container height to position it at the center of the
    // svg.
    var containerSize = container.node().getBoundingClientRect();
    var translateY = goog.string.subs('translate(0,%s)',
        (s.height - containerSize.height) / 2);
    container.attr('transform', translateY);
  }
  container.style('visibility', 'visible');
};


/**
 * Renders the hover line and battery level text on mouse move.
 */
historian.LevelLine.prototype.renderTimeInfo = function() {
  if (!this.config_.name) {
    return;
  }

  // Get coordinates relative to SVG rather than page.
  var coords = d3.mouse(this.context_.graph[0]);
  // Don't render the time info line if the mouse is left of the start of the
  // rendered bar data. e.g. hovering over the series name.
  if (coords[0] < historian.Context.MARGINS.LEFT) {
    return;
  }
  // Position the hoverLine x coordinate to be on the mouse coordinates.
  this.renderTimePoint_(coords[0]);

  // Get the time value of the chart corresponding to the mouse position.
  var xValue = this.context_.invertPosition(
      coords[0] - historian.Context.MARGINS.LEFT);

  // Get the index of the data point corresponding to the time value.
  // The bisector finds where the time value bisects the data array.
  var bisector = d3.bisector(function(d) {
    return d.startTime;
  }).right;

  var displayedData = this.displayedLevelData_.getDisplayedData();
  // Only need to look at the first in displayedData as the rest in the group
  // should have the same number of points.
  var insertionIndex = bisector(displayedData[0], xValue) - 1;

  if (insertionIndex < displayedData[0].length - 1 &&
      xValue >= displayedData[0][0].startTime) {
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
  // Renders a vertical box to make the level drop prominent.
  var boxHeight = this.context_.visSize[historian.constants.HEIGHT];
  var boxes = this.context_.svgLevelBoxes.selectAll('rect')
      .data(levelDrops, function(levelDrop) {
        return levelDrop.startTime;
      });
  boxes.enter().append('rect')
      .attr('class', 'level-summary');
  boxes.style('fill', function(d) { return d.color; })
      .attr('x', function(d) { return d.x1; })
      .attr('width', function(d) { return d.x2 - d.x1; })
      .attr('height', boxHeight);
  boxes.exit().remove();
};



/**
 * Class for displaying information about the time and battery level
 * currently hovered over by the mouse.
 *
 * @param {!historian.Context} context The visualisation context.
 * @param {!historian.LevelLine.Data} levelData
 *     The battery level series to display.
 * @param {!historian.LevelConfiguration} config The config for the metric.
 * @param {!historian.LevelSummaryData} levelSummaryData
 * @param {!Object<!Array<!historian.Entry>>=} opt_levelSummaries
 *     Additional data to display for each level drop.
 * @constructor
 * @struct
 * @private
 */
historian.LevelLine.TimeInfo_ = function(
    context, levelData, config, levelSummaryData, opt_levelSummaries) {
  /** @private {!historian.Context} */
  this.context_ = context;

  /** @private {!historian.LevelLine.Data} */
  this.levelData_ = levelData;

  /** @private {?historian.Entry} */
  this.levelStart_ = null;

  /** @private {?Array<!historian.Entry>} */
  this.levelStarts_ = null;

  /** @private {?historian.Entry} */
  this.levelEnd_ = null;

  /** @private {?Array<!historian.Entry>} */
  this.levelEnds_ = null;

  /** @private (!historian.LevelConfiguration} */
  this.config_ = config;

  /** @private {!historian.LevelSummaryData} */
  this.levelSummaryData_ = levelSummaryData;

  /** @private {!Object<!Array<!historian.Entry>>|undefined} */
  this.levelDetailSummary_ = opt_levelSummaries;

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
 * Formats and adds to the display any extra summary information for a level
 * drop.
 * @param {number} start The start time of the displayed data.
 * @param {number} end The end time of the displayed data.
 * @private
 */
historian.LevelLine.TimeInfo_.prototype.formatExtraSummary_ = function(
    start, end) {
  if (!this.levelDetailSummary_) {
    return;
  }

  for (var group in this.levelDetailSummary_) {
    var displayed = historian.utils.inTimeRangeMulti(
        start, end, this.levelDetailSummary_[group]);
    if (displayed.length == 0) {
      continue;
    }
    this.addLine_('<br><b>' + group + ':</b>');
    displayed.forEach(function(d) {
      var value = d.value;
      switch (group) {
        case historian.metrics.Csv.LOW_POWER_STATE:
          this.addLine_(goog.string.subs('%s: %s times, %s total', value.name,
              value.count, value.time));
          break;
        case historian.metrics.Csv.APP_CPU_USAGE:
          this.addLine_(goog.string.subs('%s: %s user time, %s system time',
              value.name, value.userTime, value.systemTime));
          break;
        default:
          this.addLine_(JSON.stringify(value));
      }
    }, this);
  }
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
  // Calculate details for text display.
  var loc = this.context_.location;
  this.lines_ = [];
  var timeText = 'Current time: ' + historian.time.getTime(time, loc);
  this.addLine_(timeText);

  // Start and end level data points corresponding to index.
  var displayedData = this.levelData_.getDisplayedData();
  this.levelStarts_ = [];
  this.levelEnds_ = [];
  this.levelStart_ = displayedData[0][i];
  this.levelEnd_ = displayedData[0][i + 1];
  var config = this.config_;
  var getText = function(j, startValue, endValue) {
    if (config.customDesc) {
      return config.customDesc(j, startValue, endValue);
    } else if (config.isRateOfChange ||
        historian.metrics.isDiscontinuousLevelGroup(config.name)) {
      var value = config.isRateOfChange ?
          startValue.toFixed(2) :
          historian.color.valueFormatter(
          config.name, startValue).value;
      return goog.string.subs('%s: %s', config.levelDisplayText, value);
    } else {
      var out = goog.string.subs('%s: between %s and %s',
          config.levelDisplayText,
          historian.color.valueFormatter(config.name, startValue).value,
          historian.color.valueFormatter(config.name, endValue).value);

      if (config.formatLevel) {
        out += goog.string.subs(' (%s and %s mAh)',
            config.formatLevel(goog.asserts.assertNumber(startValue)),
            config.formatLevel(goog.asserts.assertNumber(endValue)));
      }

      return out;
    }
  };
  for (var j = 0; j < displayedData.length; j++) {
    var dd = displayedData[j];
    if (dd.length <= i + 1) {
      // Won't be able to index into it properly.
      continue;
    }
    this.levelStarts_.push(dd[i]);
    this.levelEnds_.push(dd[i + 1]);
    this.addLine_(getText(j, dd[i].value, dd[i + 1].value));
  }

  var duration = historian.time.formatDuration(
      this.levelEnd_.startTime - this.levelStart_.startTime);

  var durationText = 'Duration: ' + duration +
      ', from ' + historian.time.getTime(this.levelStart_.startTime, loc) +
      ' to ' + historian.time.getTime(this.levelEnd_.startTime, loc);

  if (this.config_.formatDischarge) {
    var dischargeText = historian.LevelLine.calculateDischarge_(
        this.levelStart_, this.levelEnd_, this.config_);
    this.addLine_(dischargeText);
  }
  this.addLine_(durationText);
  if (this.config_.showExtraSummary) {
    this.formatExtraSummary_(
        this.levelStart_.startTime, this.levelEnd_.startTime);
  }
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
        .html(line)
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
 * Renders the colored line for overlaying on top of displayed level line,
 * for the level currently under mouse over.
 * @private
 */
historian.LevelLine.TimeInfo_.prototype.renderHoveredSegment_ = function() {
  this.context_.svgLevel
      .selectAll('.' + historian.LevelLine.LINE_HIGHLIGHTER_CLASS_).remove();
  if (this.levelStarts_ != null && this.levelEnds_ != null) {
    var length = this.levelStarts_.length;
    goog.asserts.assert(length == this.levelEnds_.length);
    for (var i = 0; i < length; i++) {
      var lStart = this.levelStarts_[i];
      var lEnd = this.levelEnds_[i];
      var xStart = this.context_.xScale(lStart.startTime);
      var xEnd = this.context_.xScale(lEnd.startTime);

      var yStart = this.context_.yScale(
          /** @type {number} */ (lStart.value));
      var yEnd = this.config_.isRateOfChange ||
          historian.metrics.isDiscontinuousLevelGroup(this.config_.name) ?
          yStart :
          this.context_.yScale(/** @type {number} */ (lEnd.value));

      // Use a color other than the line color so that it stands out.
      // TODO: `i` may not always be equal to the line's index, so this
      // could potentially not work at times. Please fix at some point.
      var color = 'red';
      var lineColor = historian.color.getLineColor(i);
      if (color == lineColor) {
        color = historian.color.getLineColor(i + 1);
      }
      // Highlight section of battery level line currently being mouse overed.
      this.context_.svgLevel
          .append('line')
          .attr('class', historian.LevelLine.LINE_HIGHLIGHTER_CLASS_)
          .attr('style', 'stroke: ' + color)
          .attr('x1', xStart)
          .attr('y1', yStart)
          .attr('x2', xEnd)
          .attr('y2', yEnd);
    }
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

});  // goog.scope
