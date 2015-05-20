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

goog.provide('historian.Context');



/**
 * Class containing the  outer svg elements, axes, and scales.
 * Manages zoom events, calling redraw on registered objects.
 *
 * @param {!Array.<number>} xExtent Min and max start_time value of the data.
 * @param {number} numSeries The number of series to display as bars.
 *   This is to adjust the height of the svg if necessary.
 * @constructor
 */
historian.Context = function(xExtent, numSeries) {
  // Add a margin on either side of the graph.
  var graphSize =
      historian.Context.VIS_WIDTH - (2 * historian.Context.VIS_MARGIN_);

  var msPerPixel = Math.round((xExtent[1] - xExtent[0]) / graphSize);
  var marginSize = msPerPixel * historian.Context.VIS_MARGIN_;

  /** @type {function(number): number} */
  this.xScale = d3.time.scale()
      .domain([xExtent[0] - marginSize, xExtent[1] + marginSize])
      .range([0, historian.Context.VIS_WIDTH]);

  /** @type {function(number): number} */
  this.yScale = d3.scale.linear()
      .domain([0, 100])
      .range([historian.Context.VIS_HEIGHT, 0]);

  /** @private {Object} */
  this.xAxis_ = d3.svg.axis()
      .scale(this.xScale);

  /** @private {Object} */
  this.yAxis_ = d3.svg.axis()
      .scale(this.yScale)
      .orient('right');

  if (numSeries > 20) {
    var addedHeight = ((numSeries - 20) * (historian.Context.VIS_HEIGHT / 20));
    historian.Context.margins.TOP += addedHeight;
    historian.Context.SVG_HEIGHT += addedHeight;
  }

  /**
   * The outer svg element.
   * @type {!Object}
   */
  this.svg = d3.select('#historian-graph')
      .append('svg')
      .attr('width', historian.Context.SVG_WIDTH)
      .attr('height', historian.Context.SVG_HEIGHT);

  // The series lines are rendered later on in bars.js, however we want
  // the lines to appear below everything else.
  this.seriesLinesGroup = this.svg.append('g');

  // Create clip path for restricting region of chart.
  var clip = this.svg.append('svg:clipPath')
      .attr('id', 'clip')
      .append('svg:rect')
      .attr('x', 0)
      .attr('y', 0 - historian.Context.margins.TOP)
      .attr('width', historian.Context.VIS_WIDTH)
      .attr('height', historian.Context.SVG_HEIGHT);

  /**
   * The main chart area.
   * @type {!Object}
   */
  this.vis = this.svg.append('g')
      .attr('transform',
      'translate(' + historian.Context.margins.LEFT +
      ',' + historian.Context.margins.TOP + ')')
      .attr('clip-path', 'url(#clip)');

  // Add axes.
  this.vis.append('svg:g')
      .attr('class', 'x axis')
      .attr('transform', 'translate(0, ' + historian.Context.VIS_HEIGHT + ')')
      .call(this.xAxis_);

  var yAxisXOffset =
      historian.Context.margins.LEFT + historian.Context.VIS_WIDTH;
  this.svg.append('svg:g')
      .attr('class', 'y axis')
      .attr('transform',
      'translate(' + yAxisXOffset +
      ', ' + historian.Context.margins.TOP + ')')
      .call(this.yAxis_);

  /**
   * For storing objects that need to be redrawn on zoom.
   * @type {!Array.<Object>}
   * @private
   */
  this.zoomObjects_ = [];
  this.zoom = d3.behavior.zoom()
      .x(this.xScale)
      .scaleExtent([1, 512])
      .on('zoom', this.redraw_.bind(this));

  this.svg.call(this.zoom);
};


/**
 * Margins between svg and visualisation.
 */
historian.Context.margins = {
  TOP: 120,
  RIGHT: 100,
  BOTTOM: 50,
  LEFT: 150
};


/**
 * Margin to show on either side of the graph in the zoomed out view.
 * @private
 */
historian.Context.VIS_MARGIN_ = 50;


/** @private {string} */
historian.Context.WINDOW_WIDTH_ = window.getComputedStyle(
    document.getElementsByTagName('body')[0], null).
    getPropertyValue('width');


/** @type {number} */
historian.Context.SVG_WIDTH = parseFloat(historian.Context.WINDOW_WIDTH_) - 50;


/** @type {number} */
historian.Context.SVG_HEIGHT = 800;


/** @const {number} */
historian.Context.VIS_WIDTH =
    historian.Context.SVG_WIDTH -
    historian.Context.margins.LEFT -
    historian.Context.margins.RIGHT;


/** @type {number} */
historian.Context.VIS_HEIGHT =
    historian.Context.SVG_HEIGHT -
    historian.Context.margins.TOP -
    historian.Context.margins.BOTTOM;


/** @const @private {number} */
historian.Context.VERTICAL_SCROLL_ = 0;


/** @const @private {number} */
historian.Context.HORIZONTAL_SCROLL_ = 1;


/**
 * Saves a reference to object that will have redraw called on zoom.
 * @param {!Object} o The object to save.
 */
historian.Context.prototype.registerRedraw = function(o) {
  this.zoomObjects_.push(o);
};


/**
 * Extra px allowed panning before the start and after the end of the graph.
 * @private {number}
 */
historian.Context.PAN_MARGIN_PX_ = 100;


/**
 * Rerenders the graph for the current zoom level.
 * Calls all registered objects to redraw themselves.
 * @private
 */
historian.Context.prototype.redraw_ = function() {
  var translateX = this.zoom.translate()[0];
  var translateY = this.zoom.translate()[1];

  // Don't let the user pan too far right. Any positive value means
  // we're showing white space on the left.
  translateX = Math.min(historian.Context.PAN_MARGIN_PX_, translateX);

  // Limit panning to the left.
  var zoomedWidth = this.zoom.scale() * historian.Context.VIS_WIDTH;
  var limitedPan =
      historian.Context.VIS_WIDTH - zoomedWidth -
      historian.Context.PAN_MARGIN_PX_;
  translateX = Math.max(limitedPan, translateX);

  this.zoom.translate([translateX, translateY]);

  var scrollType = historian.Context.VERTICAL_SCROLL_;
  var sourceEvent = d3.event.sourceEvent;
  if (sourceEvent.type == 'wheel') {
    var x = sourceEvent.wheelDeltaX;
    var y = sourceEvent.wheelDeltaY;
    if (x != 0) {
      if (Math.abs(x) > Math.abs(y)) {
        // Assume trying to scroll horizontally.
        scrollType = historian.Context.HORIZONTAL_SCROLL_;
      }
    }
  }

  if (scrollType == historian.Context.HORIZONTAL_SCROLL_) {
    // Horizontal scrolling over graph doesn't do anything,
    // scroll the page instead.
    window.scrollBy(-sourceEvent.wheelDeltaX * 0.1, 0);
  } else {
    this.svg.select('.x.axis').call(this.xAxis_);
    this.zoomObjects_.forEach(function(o) {
      o.redraw();
    });
  }
};
