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

goog.require('historian.color');
goog.require('historian.constants');
goog.require('historian.historianV2Logs');
goog.require('historian.time');



/**
 * Class containing the outer svg elements, axes, and scales.
 * Manages zoom events, calling redraw on registered objects.
 * @param {!jQuery} container Container containing the graph.
 * @param {!historian.historianV2Logs.Extent} xExtent Min and max unix
 *     millisecond timestamps for the graph extent.
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

  /** @private @const {!jQuery} */
  this.container_ = container;

  /** @const {!jQuery} */
  this.graph = container.find('.graph');

  var xDomainSpan = xExtent.max - xExtent.min;
  var xDomainMargin = xDomainSpan * 0.05;

  /** @private {!historian.historianV2Logs.Extent} */
  this.xExtent_ = xExtent;

  /**
   * Extent with added margins.
   * @private {!Array<number>}
   */
  this.xDomain_ = [xExtent.min - xDomainMargin, xExtent.max + xDomainMargin];

  /** @private {!d3.zoomTransform} */
  this.zoomTransform_ = d3.zoomIdentity;

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
   * @type {!d3.selection}
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

  /**
   * The original scale that transforms can be applied to.
   * @private {!d3.TimeScale}
   */
  this.xScaleUntransformed_ = d3.scaleUtc()
      .domain(this.xDomain_.map(function(unix) { return new Date(unix); }))
      .range([0, this.visSize[historian.constants.WIDTH]]);

  /**
   * This is the above scale but will have transforms applied,
   * and will be used to plot the data.
   * @type {!d3.TimeScale}
   */
  this.xScale = this.xScaleUntransformed_;

  /** @type {!d3.LinearScale} */
  this.yScale = d3.scaleLinear()
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

  /** @private {!d3.Axis} */
  this.xAxis_ = d3.axisBottom(this.xScale);

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
  /** @private {!d3.Axis} */
  this.yAxis_ = d3.axisRight(this.yScale);

  // Only shows the tick if it is of integer value.
  var formattedInts = function(d) {
    var config = this.levelData_.getConfig();
    return Number.isInteger(d) ? historian.color.valueFormatter(
        config.name, d, config.ticksShortForm).value : '';
  }.bind(this);
  this.yAxis_.tickFormat(function(d) {
    var config = this.levelData_.getConfig();
    if (config.ticksAsFormattedInts) {
      return formattedInts(d);
    } else if (Number.isInteger(d)) {
      return d;
    } else {
      return d3.format('.1f')(d);  // Don't need much precision for the axis.
    }
  }.bind(this));

  /**
   * The series lines are rendered later on in bars.js, however we want
   * the lines to appear below everything else.
   * @type {!d3.selection}
   */
  this.seriesLinesGroup = this.svg.append('g')
      .attr('class', 'svg-divider-lines')
      .attr('transform', 'translate(0,' + historian.Context.MARGINS.TOP + ')');

  // We can't apply transform to svg elements directly, so need to have an
  // extra group.
  var transformed = this.svg.append('g')
      .attr('transform', 'translate(' + historian.Context.MARGINS.LEFT + ',' +
          historian.Context.MARGINS.TOP + ')');

  /**
   * The main chart svg displaying the timeline data.
   * @type {!d3.selection}
   */
  this.svgChart = transformed.append('svg')
      .attr('class', 'svg-chart');

  // Ensure the inner svg gets passed mouse events first.
  // Otherwise zooming fails for blank areas.
  this.svgChart.append('rect')
      .attr('width', this.visSize[historian.constants.WIDTH])
      .attr('height', this.visSize[historian.constants.HEIGHT])
      .attr('opacity', 0);

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
      .attr('height', this.visSize[historian.constants.HEIGHT] +
          historian.Context.MARGINS.TOP);

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
   * Group for rendering the report taken line.
   * @type {!d3.selection}
   */
  this.svgLevelEventMarkers = transformed.append('g')
      .attr('class', 'svg-level-event-container');
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
   * @type {!d3.LinearScale}
   */
  this.rowScale = d3.scaleLinear()
      .range([this.visSize[historian.constants.HEIGHT], 0]);

  this.onSeriesChange();  // Set the row scale domain.

  /** @type {!d3.Zoom} */
  this.zoom = d3.zoom()
      .scaleExtent([1, 512])
      .translateExtent([[0, 0], [this.svgSize[historian.constants.WIDTH], 0]])
      .on('zoom', zoomHandler);
  this.svgChart.call(this.zoom.bind(this))
      .on('wheel', function() {
        // d3 v4 ignores mouse wheel events past the scale extent and
        // scrolling too much will scroll the page instead. This isn't
        // desirable as usually to fully zoom out users just scroll a lot.
        d3.event.preventDefault();
      });

  this.barData_.registerListener(this.onSeriesChange.bind(this));
  this.levelData_.registerListener(this.onLevelSeriesChange.bind(this));
};


/**
 * Margins between svg and visualisation.
 * @const {!Object<number>}
 */
historian.Context.MARGINS = {
  TOP: 10,
  RIGHT: 95,
  BOTTOM: 55,
  LEFT: 222
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
  return this.xScale.invert(pos).getTime();
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
 * Sets the domain.
 * @param {!historian.historianV2Logs.Extent} xExtent
 */
historian.Context.prototype.setDomain = function(xExtent) {
  var xDomainSpan = xExtent.max - xExtent.min;
  var xDomainMargin = xDomainSpan * 0.05;
  var newXDomain = [xExtent.min - xDomainMargin, xExtent.max + xDomainMargin];
  if (newXDomain[0] == this.xDomain_[0] && newXDomain[1] == this.xDomain_[1]) {
    // Don't want to modify zoom or translate if the new domain is the same.
    // This can occur when adding / moving series from the same log, or
    // toggling filter unimportant.
    return;
  }
  this.xDomain_ = newXDomain;
  this.xExtent_ = xExtent;

  // Adjust x-scale to new domain.
  this.xScaleUntransformed_
      .domain(this.xDomain_.map(function(unix) { return new Date(unix); }))
      .range([0, this.visSize[historian.constants.WIDTH]]);
};


/**
 * Updates the graph for the current zoom level.
 * Calls all registered objects to redraw themselves.
 */
historian.Context.prototype.update = function() {
  var svgChartElem = this.svgChart.node();
  if (!svgChartElem) {
    return;
  }
  this.zoomTransform_ = d3.zoomTransform(svgChartElem);
  this.xScale = this.zoomTransform_.rescaleX(this.xScaleUntransformed_);

  this.renderAxes_();
  this.redrawTicks_();
};


/**
 * Renders the y-axis if the level line is currently shown, otherwise it is
 * removed.
 */
historian.Context.prototype.renderYAxis = function() {
  this.svg.selectAll('.y.axis').remove();
  var selected = this.container_.find(
      historian.constants.Elements.LEVEL_SELECT + ' option:selected').val();
  if (!selected) {
    return;
  }
  var yAxisXOffset = historian.Context.MARGINS.LEFT +
      this.visSize[historian.constants.WIDTH];
  this.svg.append('svg:g')
      .attr('class', 'y axis')
      .attr('transform', 'translate(' + yAxisXOffset +
          ', ' + historian.Context.MARGINS.TOP + ')')
      .call(this.yAxis_);
};


/**
 * Renders the x and y axes of the plot.
 * X axis is the timeline.
 * Y axis is the battery level.
 * @private
 */
historian.Context.prototype.renderAxes_ = function() {
  this.svgChart.selectAll('.x.axis').remove();
  this.svg.selectAll('.x-legend').remove();

  var svgElem = this.svg.node();
  if (!svgElem) {
    return;
  }
  // Add axes.
  this.svgChart.append('svg:g')
      .attr('class', 'x axis')
      .attr('transform', 'translate(0, ' + this.visSize[1] + ')')
      .call(this.xAxis_.scale(this.xScale));

  this.renderYAxis();

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
    this.panel_.height() - this.container_.find('.settings').height()
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
  this.svgChart.select('rect')
      .attr('width', this.visSize[historian.constants.WIDTH])
      .attr('height', this.visSize[historian.constants.HEIGHT]);

  this.zoom.translateExtent(
      [[0, 0], [this.svgSize[historian.constants.WIDTH], 0]]);
  // Adjust scales and axis.
  this.xScaleUntransformed_
      .domain(this.xDomain_.map(function(unix) { return new Date(unix); }))
      .range([0, this.visSize[historian.constants.WIDTH]]);

  this.clipRect_
      .attr('width', this.visSize[historian.constants.WIDTH])
      .attr('height', this.svgSize[historian.constants.HEIGHT]);

  this.yScale.range([this.visSize[historian.constants.HEIGHT], 0]);
  this.rowScale.range([this.visSize[historian.constants.HEIGHT], 0]);
  // Need to recalculate the row scale to prevent rows from becoming too tall.
  this.onSeriesChange();
  // Note that the container has different width now.
  // We cannot just re-use our previous scale and translate values.
  // So we have to compute the new scale and translate based on the
  // current width.
  x0 = this.xScaleUntransformed_(x0);
  x1 = this.xScaleUntransformed_(x1);

  // If no data is currently being displayed, it doesn't matter if we reset
  // the zoom translate and scale, and we want to avoid divide by 0 errors.
  // We still want to re-render the axes and ticks, so don't return early.
  if (x1 - x0 != 0) {
    var scale = this.visSize[historian.constants.WIDTH] / (x1 - x0);
    this.zoomTransform_ = d3.zoomIdentity
        .translate(-x0 * scale, this.zoomTransform_.y)
        .scale(scale);

    // This will trigger redrawing the bars, axes and ticks with the
    // correct xScale.
    this.zoom.transform(this.svgChart, this.zoomTransform_);
  }
};


/**
 * Removes any overlapping ticks for the x axis time scale.
 * Overlaps usually happen if the window width is small.
 * @private
 */
historian.Context.prototype.redrawTicks_ = function() {
  var ticks = this.svg.select('.x.axis')
      .selectAll('.tick').nodes();

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
  return ext / this.visSize[historian.constants.WIDTH];
};


/**
 * Returns the start and end time of the currently viewable time range.
 * @return {!historian.historianV2Logs.Extent}
 */
historian.Context.prototype.getViewableTimeRange = function() {
  // The actual domain of the x-axis is the xExtent plus a margin, so ensure
  // we don't include points that solely lie in the margin outside the graph.
  return {
    min: Math.max(this.xExtent_.min, this.xScale.invert(0)),
    max: Math.min(this.xExtent_.max,
        this.xScale.invert(this.visSize[historian.constants.WIDTH]))
  };
};
