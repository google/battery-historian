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

goog.provide('historian.Context');

goog.require('historian.constants');
goog.require('historian.time');



/**
 * Class containing the outer svg elements, axes, and scales.
 * Manages zoom events, calling redraw on registered objects.
 * @param {!jQuery} container Container containing the graph.
 * @param {{min: number, max: number}} xExtent Min and max startTime value of
 *     the data.
 * @param {{min: number, max: number}} yDomain The input range for the y scale.
 * @param {!historian.BarData} barData The bar data used in Historian v2.
 * @param {!historian.LevelData} levelData The level data used in Historian v2.
 * @param {function()} zoomHandler Handler for zoom events.
 * @param {string} location The IANA time zone associated with the time data.
 *     e.g. 'Europe/London'.
 * @param {!jQuery} panel Panel the timeline is rendered in, has the plot's size
 *     (excluding paddings and margins).
 * @constructor
 * @struct
 */
historian.Context = function(container, xExtent, yDomain, barData, levelData,
    zoomHandler, location, panel) {
  /** @private @const {!jQuery} */
  this.panel_ = panel;
  /** @const {!jQuery} */
  this.graph = container.find('.graph');

  var xDomainSpan = xExtent.max - xExtent.min;
  var xDomainMargin = xDomainSpan * 0.05;

  /** @private {!Array<number>} */
  this.xDomain_ = [xExtent.min - xDomainMargin, xExtent.max + xDomainMargin];

  /** @private {!Array<number>} */
  this.zoomTranslate_ = [0, 0];
  /** @private {number} */
  this.zoomScale_ = 1.0;

  // Saved zooming states so that a zoom operation could be cancelled.
  /** @private {!Array<number>} */
  this.zoomTranslateStart_ = [0, 0];
  /** @private {number} */
  this.zoomScaleStart_ = 1.0;

  // Clear previous rendering.
  this.graph.children().remove();

  // Copy the default SVG contents to the graph div.
  this.graph.append(container.find('.svg-content svg').clone());

  // SVG doesn't seem to like patterns having the same ID, but we can't access
  // a pattern unless it's in the SVG, so append the container name to make it
  // unique.
  var svgPattern = this.graph.find('svg pattern');
  svgPattern.attr('id', svgPattern.attr('id') + '-' + container.attr('id'));

  /**
   * The outer svg element.
   * @type {!Object}
   */
  this.svg = d3.select(this.graph[0]).select('svg');

  /**
   * Width and height of the SVG.
   * @type {!Array<number>}
   */
  this.svgSize = [0, 0];

  /**
   * Width and height of the graph visualization.
   * @type {!Array<number>}
   */
  this.visSize = [0, 0];
  this.getSizes_();

  /** @type {!d3.scaleType} */
  this.xScale = d3.time.scale.utc()
      .domain(this.xDomain_)
      .range([0, this.visSize[historian.constants.WIDTH]]);
  /** @type {!d3.scaleType} */
  this.yScale = d3.scale.linear()
      .domain([yDomain.min, yDomain.max])
      .range([this.visSize[historian.constants.HEIGHT], 0]);

  /** @private {!historian.BarData} */
  this.barData_ = barData;

  /** @private {!historian.LevelData} */
  this.levelData_ = levelData;

  /**
   * IANA time zone.
   * @type {string}
   */
  this.location = location;

  /** @private {!d3.axisType} */
  this.xAxis_ = d3.svg.axis()
      .scale(this.xScale);

  if (this.location) {
    var defaultTickFormatter = this.xScale.tickFormat();
    this.xAxis_.tickFormat(function(date) {
      // Default formatter displays in UTC time. To display time in the bug
      // report time zone, the millisecond difference between the bug report
      // time zone and UTC is added to the time stamp. This needs to be
      // calculated for each date as the offset is variable due to daylight
      // savings.
      var offsetMs = moment(date).tz(this.location).utcOffset() *
          historian.time.SECS_IN_MIN * historian.time.MSECS_IN_SEC;
      return defaultTickFormatter(new Date(date.getTime() + offsetMs));
    }.bind(this));
  }
  /** @private {!d3.axisType} */
  this.yAxis_ = d3.svg.axis()
      .scale(this.yScale)
      .orient('right');

  /**
   * The main chart svg with an offset to the view
   * @type {!d3.selection}
   */
  this.svgChart = this.svg.append('g')
      .attr('class', 'svg-chart')
      .attr('transform', 'translate(' + historian.Context.MARGINS.LEFT + ',' +
            historian.Context.MARGINS.TOP + ')');
  /**
   * The series lines are rendered later on in bars.js, however we want
   * the lines to appear below everything else.
   * @type {!d3.selection}
   */
  this.seriesLinesGroup = this.svgChart.append('g')
      .attr('class', 'svg-divider-lines');

  // Create clip path for restricting region of chart.
  var clip = this.svgChart.append('svg:clipPath')
      .attr('id', 'clip');

  /**
   * @private {!d3.selection}
   */
  this.clipRect_ = clip
      .append('svg:rect')
      .attr('x', 0)
      .attr('y', 0 - historian.Context.MARGINS.TOP)
      .attr('width', this.visSize[historian.constants.WIDTH])
      .attr('height', this.svgSize[historian.constants.HEIGHT]);

  /**
   * The main chart area.
   * @type {!d3.selection}
   */
  this.svgClipped = this.svgChart.append('g')
      .attr('clip-path', 'url(#clip)');

  // Create a group for each type of plot element.
  // The group created first appears at the bottom.

  /**
   * Group for rendering the range boxes of level line.
   * This group needs to appear below the other elements.
   * @type {!d3.selection}
   */
  this.svgLevelBoxes = this.svgClipped.append('g')
      .attr('class', 'level-boxes');
  /**
   * Group for rendering series-level hovering boxes.
   * @type {!d3.selection}
   */
  this.svgSeriesLevel = this.svgClipped.append('g')
      .attr('class', 'series-level');
  /**
   * Group for rendering the bars.
   * @type {!d3.selection}
   */
  this.svgBars = this.svgClipped.append('g')
      .attr('class', 'bars');
  /**
   * Group for rendering the level line.
   * @type {!d3.selection}
   */
  this.svgLevel = this.svgClipped.append('g')
      .attr('class', 'level');
  /**
   * Group for rendering the level summaries.
   * @type {!d3.selection}
   */
  this.svgLevelSummaries = this.svgClipped.append('g')
      .attr('class', 'level-summaries');
  /**
   * Group for rendering level information for the current view.
   * @type {!d3.selection}
   */
  this.svgLevelViewInfo = this.svgClipped.append('g')
      .attr('class', 'level-view-info');

  this.renderAxes_();

  /**
   * Scale that maps each row to its y coordinate.
   * @type {!d3.scaleType}
   */
  this.rowScale = d3.scale.linear()
      .range([this.visSize[historian.constants.HEIGHT], 0]);

  this.onSeriesChange();  // Set the row scale domain.

  /** @type {!d3.zoomType} */
  this.zoom = d3.behavior.zoom()
      .x(this.xScale)
      .scaleExtent([1, 512])
      .on('zoomstart', function() {
        this.zoomTranslateStart_ = this.zoom.translate();
        this.zoomScaleStart_ = this.zoom.scale();
      }.bind(this))
      .on('zoom', zoomHandler);
  this.svg.call(this.zoom.bind(this));
  this.barData_.registerListener(this.onSeriesChange.bind(this));
  this.levelData_.registerListener(this.onLevelSeriesChange.bind(this));
};


/**
 * Margins between svg and visualisation.
 * @const {!Object<number>}
 */
historian.Context.MARGINS = {
  TOP: 10,
  RIGHT: 70,
  BOTTOM: 55,
  LEFT: 180
};


/** @const {!Array<number>} */
historian.Context.MIN_SVG_SIZE = [
  historian.Context.MARGINS.LEFT + historian.Context.MARGINS.RIGHT,
  300
];


/**
 * The minimum space between ticks on the x axis time scale.
 * @private
 */
historian.Context.MIN_TICK_MARGIN_PX_ = 10;


/**
 * The height of the time zone display.
 * @private
 */
historian.Context.TIME_ZONE_DISPLAY_PX_ = 10;


/**
 * Converts the screen position to the corresponding graph time.
 * @param {number} pos Position px.
 * @return {number} Time in unix ms.
 */
historian.Context.prototype.invertPosition = function(pos) {
  return this.xScale.invert(pos);
};


/**
 * Sets the row scale based on the new series data.
 */
historian.Context.prototype.onSeriesChange = function() {
  var d = this.barData_.getData();
  var minNumRows = this.visSize[historian.constants.HEIGHT] / 40;
  this.rowScale.domain([0, Math.max(d.length, minNumRows)]);
};


/**
 * Sets the graph y scale and rerenders the axes based on the new level config.
 */
historian.Context.prototype.onLevelSeriesChange = function() {
  var domain = this.levelData_.getConfig().yDomain;
  this.yScale
      .domain([domain.min, domain.max])
      .range([this.visSize[historian.constants.HEIGHT], 0]);
  this.renderAxes_();
};


/**
 * Cancels the effect of the last zoom operation.
 * When the user is making time range selection, zoom is still active and its
 * scale and translate would be changed. This is undesired so we add this to
 * allow reverting the zoom state.
 */
historian.Context.prototype.cancelZoom = function() {
  this.zoom.translate(this.zoomTranslateStart_);
  this.zoom.scale(this.zoomScaleStart_);
};


/**
 * Updates the graph for the current zoom level.
 * Calls all registered objects to redraw themselves.
 */
historian.Context.prototype.update = function() {
  var translateX = this.zoom.translate()[historian.constants.WIDTH];
  var translateY = this.zoom.translate()[historian.constants.HEIGHT];

  // Limit panning to the left.
  var scale = this.zoom.scale();
  var limitedPan = this.visSize[historian.constants.WIDTH] * (1.0 - scale);
  translateX = Math.max(limitedPan, translateX);
  translateX = Math.min(0, translateX);

  this.zoomTranslate_ = [translateX, translateY];
  this.zoomScale_ = scale;

  this.zoom.translate(this.zoomTranslate_);

  this.svg.select('.x.axis').call(this.xAxis_.bind(this));
  this.renderAxes_();
  this.redrawTicks_();
};


/**
 * Renders the x and y axes of the plot.
 * X axis is the timeline.
 * Y axis is the battery level.
 * @private
 */
historian.Context.prototype.renderAxes_ = function() {
  this.svgBars.selectAll('.x.axis').remove();
  this.svg.selectAll('.y.axis').remove();
  this.svg.selectAll('.x-legend').remove();

  // Add axes.
  this.svgBars.append('svg:g')
      .attr('class', 'x axis')
      .attr('transform', 'translate(0, ' + this.visSize[1] + ')')
      .call(this.xAxis_);

  var yAxisXOffset = historian.Context.MARGINS.LEFT +
      this.visSize[historian.constants.WIDTH];
  this.svg.append('svg:g')
      .attr('class', 'y axis')
      .attr('transform', 'translate(' + yAxisXOffset +
          ', ' + historian.Context.MARGINS.TOP + ')')
      .call(this.yAxis_);

  // Add text for x axis.
  var xLabel = 'Time';
  if (this.location != '') {
    // Convert the location to the short format time zone. e.g. PDT UTC-07:00
    // The short format also depends on the timestamp. e.g. California uses
    // PST-08:00 in the winter and PDT-07:00 in the summer.
    // If the short format time zone calculated from the start of the bug
    // report differs from that calculated from the end of the bug report,
    // we show both (can happen if the bug report spans over daylight savings).
    var startTimeZone =
        historian.time.getTimeZoneShort(this.xDomain_[0], this.location);
    var endTimeZone =
        historian.time.getTimeZoneShort(this.xDomain_[1], this.location);
    var shortTimeZone = startTimeZone == endTimeZone ? startTimeZone :
        startTimeZone + ' -> ' + endTimeZone;
    xLabel += ' (' + this.location + ' ' + shortTimeZone + ')';
  }
  this.svg.append('text')
      .attr('class', 'x-legend')
      .attr('x', this.svgSize[historian.constants.WIDTH] / 2)
      .attr('y', this.svgSize[historian.constants.HEIGHT] -
          historian.Context.TIME_ZONE_DISPLAY_PX_)
      .style('text-anchor', 'middle')
      .text(xLabel);
};


/**
 * Computes the svg and vis size for the historian plot.
 * @private
 */
historian.Context.prototype.getSizes_ = function() {
  // Calculate new sizes of the SVG and visualization.
  this.svgSize = [
    this.panel_.width(),
    this.panel_.height() - this.panel_.find('.settings').height()
  ];
  this.svgSize[historian.constants.WIDTH] = Math.max(
      this.svgSize[historian.constants.WIDTH],
      historian.Context.MIN_SVG_SIZE[historian.constants.WIDTH]
      );
  this.svgSize[historian.constants.HEIGHT] = Math.max(
      this.svgSize[historian.constants.HEIGHT],
      historian.Context.MIN_SVG_SIZE[historian.constants.HEIGHT]
      );
  this.visSize = [
    this.svgSize[historian.constants.WIDTH] -
        historian.Context.MARGINS.LEFT -
        historian.Context.MARGINS.RIGHT,
    this.svgSize[historian.constants.HEIGHT] -
        historian.Context.MARGINS.TOP -
        historian.Context.MARGINS.BOTTOM
  ];
  this.svg
      .attr('width', this.svgSize[historian.constants.WIDTH])
      .attr('height', this.svgSize[historian.constants.HEIGHT]);
};


/**
 * Re-renders the SVG when the window has resized.
 * Calls all registered objects to resize themselves.
 */
historian.Context.prototype.resize = function() {
  // Get the times of the two endpoints currently shown
  // for computing new scale and translate values.
  var x0 = this.xScale.invert(0),
      x1 = this.xScale.invert(this.visSize[historian.constants.WIDTH]);

  this.getSizes_();

  // Adjust scales and axis.
  this.xScale = d3.time.scale()
      .domain(this.xDomain_)
      .range([0, this.visSize[historian.constants.WIDTH]]);
  this.yScale.range([this.visSize[historian.constants.HEIGHT], 0]);
  this.rowScale.range([this.visSize[historian.constants.HEIGHT], 0]);
  // Need to recalculate the row scale to prevent rows from becoming too tall.
  this.onSeriesChange();
  // Because the range is modified programatically,
  // we need to call this.zoom.x again.
  // However this would reset the scale to 1 and translate to [0, 0],
  // which would affect further zooming.
  this.zoom.x(this.xScale);
  // Note that the container has different width now.
  // We cannot just re-use our previous scale and translate values.
  // So we have to compute the new scale and translate based on the
  // current width.
  x0 = this.xScale(x0);
  x1 = this.xScale(x1);
  var scale = this.visSize[historian.constants.WIDTH] / (x1 - x0);
  this.zoomScale_ = scale;
  this.zoomTranslate_ = [-x0 * scale,
                         this.zoomTranslate_[historian.constants.HEIGHT]];
  this.zoom.translate(this.zoomTranslate_);
  this.zoom.scale(this.zoomScale_);

  this.xAxis_.scale(this.xScale);

  this.clipRect_
      .attr('width', this.visSize[historian.constants.WIDTH])
      .attr('height', this.svgSize[historian.constants.HEIGHT]);

  this.renderAxes_();
  this.redrawTicks_();
};


/**
 * Removes any overlapping ticks for the x axis time scale.
 * Overlaps usually happen if the window width is small.
 * @private
 */
historian.Context.prototype.redrawTicks_ = function() {
  var ticks = this.svg.select('.x.axis')
      .selectAll('.tick')[0];

  for (var i = 0; i < ticks.length - 1; i++) {
    var left = ticks[i];
    var right = ticks[i + 1];

    if (left.getBoundingClientRect().right == 0) {
      // Not currently being rendered - Historian v2 tab not clicked.
      return;
    }

    // Check if tick overlaps.
    while (i < ticks.length - 1 &&
        left.getBoundingClientRect().right +
        historian.Context.MIN_TICK_MARGIN_PX_ >=
        right.getBoundingClientRect().left) {
      d3.select(right).remove();
      i++;
      right = ticks[i + 1];
    }
  }
};


/**
 * Returns the duration visible for 1 pixel.
 * @return {number}
 */
historian.Context.prototype.msPerPixel = function() {
  var startTime = this.xScale.invert(0);
  var endTime = this.xScale.invert(this.visSize[historian.constants.WIDTH]);
  var ext = endTime - startTime;
  return Math.round(Number(ext / this.visSize[historian.constants.WIDTH]));
};


/**
 * Returns the start and end time of the currently viewable time range.
 * @return {{start: number, end: number}}
 */
historian.Context.prototype.getViewableTimeRange = function() {
  return {
    start: this.xScale.invert(0),
    end: this.xScale.invert(this.visSize[historian.constants.WIDTH])
  };
};
