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

goog.provide('historian.Bars');

goog.require('goog.math.Range');
goog.require('historian.Context');
goog.require('historian.color');
goog.require('historian.time');
goog.require('historian.util');



/**
 * Bars creates the individual lines for each data point of each series,
 * as well as the tooltip displayed when a bar is hovered over.
 * Each series is rendered in a horizontal line.
 *
 * @param {!historian.Context} context The visualisation context.
 * @param {!historian.SeriesData} barData The array of series to display.
 * @param {!historian.util.ServiceMapper} serviceMapper
 *     The map from service to uid.
 * @constructor
 */
historian.Bars = function(context, barData, serviceMapper) {
  /** @private {!historian.Context} */
  this.context_ = context;

  /** @private {!historian.SeriesData} */
  this.barData_ = barData;

  /** @private {!historian.util.ServiceMapper} */
  this.serviceMapper_ = serviceMapper;

  /**
   * Tooltip for displaying data point information on mouse hover.
   * @private {!historian.Bars.Tooltip_}
   */
  this.tooltip_ = new historian.Bars.Tooltip_();

  var clustered = this.cluster(this.getVisibleData_());
  // Create a svg group for each series.
  var series = this.context_.vis
      .append('g')
      .attr('class', 'bars-group')
      .selectAll('.series')
      .data(clustered)
      .enter()
      .append('g')
      .attr('class', function(d) {
        return 'series ' + d.name;
      });
  this.drawSeries_(series);

  // Horizontal dividers for each series.
  this.context_.seriesLinesGroup
      .selectAll('.series-line')
      .data(barData)
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('y1', function(d) {
        return historian.Bars.getY(d.index) -
            historian.Bars.DIVIDER_OFFSET_PX_ + historian.Context.margins.TOP;
      })
      .attr('x2', historian.Context.VIS_WIDTH + historian.Context.margins.LEFT)
      .attr('y2', function(d) {
        return (historian.Bars.getY(d.index) -
            historian.Bars.DIVIDER_OFFSET_PX_ + historian.Context.margins.TOP);
      })
      .attr('stroke', 'lightgray');

  // Text labels for each of the series.
  this.context_.svg.append('g')
      .selectAll('.series-label')
      .data(barData)
      .enter()
      .append('text')
      .attr('class', 'vis-label')
      .attr('x', historian.Context.margins.LEFT -
          historian.Bars.LABEL_OFFSET_PX_)
      .attr('y', function(d) {
        return ((historian.Bars.getY(d.index) +
            historian.Context.margins.TOP +
            historian.Bars.TEXT_OFFSET_PX_));
      })
      .text(function(d) {
        if (d.name == 'wakelock_in') {
          return 'Partial wakelock';
        }
        return d.name;
      });

  this.addAppSelectorListener_();

  this.context_.registerRedraw(this);
};


/**
 * Horizontal dividers between series are rendered slightly above the series.
 * @const @private {number}
 */
historian.Bars.DIVIDER_OFFSET_PX_ = 2;


/** @const @private {number} */
historian.Bars.SERIES_OFFSET_PX_ = 12;


/** @const @private {number} */
historian.Bars.TEXT_OFFSET_PX_ = historian.Bars.SERIES_OFFSET_PX_ + 5;


/** @const @private {number} */
historian.Bars.LABEL_OFFSET_PX_ = 10;


/**
 * The minimum px width for each bar line.
 * @const @private {number}
 */
historian.Bars.MIN_BAR_WIDTH_PX_ = 2;


/**
 * Adds the event listeners for the app selector.
 * @private
 */
historian.Bars.prototype.addAppSelectorListener_ = function() {
  var appSelector = document.getElementById('appSelector');
  if (appSelector) {
    appSelector.addEventListener('change', this.displaySelectedApp_.bind(this));
  }
  var clearApp = document.getElementById('clearApp');
  if (clearApp) {
    clearApp.addEventListener('click', this.displaySelectedApp_.bind(this));
  }
};


/**
 * Creates lines for each of the data points in each series.
 * @param {!historian.SeriesData} series The array of series to render.
 * @private
 */
historian.Bars.prototype.drawSeries_ = function(series) {
  var self = this;
  // For each series, draw a bar line for each data point.
  series.each(function(parentDatum) {
    d3.select(this).selectAll('line')
        .data(function(d) {
          return d.values;
        })
        .enter()
        .append('line')
        .attr('class', parentDatum.name + ' line')
        .attr('x1',
        function(d) { return self.context_.xScale(d.start_time); }.bind(this))
        .attr('x2', self.drawAdjustedEndTime_.bind(self))
        .attr('y1', function(d) {
          return historian.Bars.getY(parentDatum.index) +
          historian.Bars.SERIES_OFFSET_PX_;
        })
        .attr('y2', function(d) {
          return historian.Bars.getY(parentDatum.index) +
          historian.Bars.SERIES_OFFSET_PX_;
        })
        .on('mouseover', self.onMouseover_.bind(self, parentDatum))
        .on('mouseout', self.onMouseout_.bind(self))
        .style('stroke', function(d) {
          // Use count to determine color for aggregated stats.
          if (historian.util.isAggregatedMetric(parentDatum.name)) {
            return parentDatum.color(d.clustered_count);
          }
          return parentDatum.color(d.getMaxValue());
        });
  });
};


/**
 * Redraws all the bar lines for the current zoom level.
 */
historian.Bars.prototype.redraw = function() {
  this.updateSeries_();

  // Readjusts all series for panning / zooming.
  this.context_.vis.selectAll('.line')
      .attr('x1', function(d) {
        return this.context_.xScale(d.start_time);
      }.bind(this))
      .attr('x2', this.drawAdjustedEndTime_.bind(this));
};


/**
 * Updates the data binded to bar elements and redraws all the changed series.
 * @private
 */
historian.Bars.prototype.updateSeries_ = function() {
  var uid = null;
  var e = document.getElementById('appSelector');
  if (e) {
    var v = e.options[e.selectedIndex].value;
    if (v != 'none_chosen') {
      uid = v;
    }
  }
  var filteredData = [];
  this.barData_.forEach(function(series) {
    var values = /** @type {!Array<!historian.Entry>} */
        (series.values.filter(this.inViewableRange.bind(this)));
    if (uid && (series.name in historian.util.appSpecificMetrics)) {
      values = this.filterServices(values, uid);
    }
    filteredData.push({
      'name': series.name,
      'type': series.type,
      'color': series.color,
      'index': series.index,
      'values': values
    });
  }, this);

  var clustered = this.cluster(filteredData);

  var series = this.context_.vis
      .select('.bars-group')
      .selectAll('.series')
      .data(clustered, function(d) {
        return d.name + d.values;
      });

  series.exit()
      .remove();

  var newSeries = series.enter()
      .append('g')
      .attr('class', function(d) {
        return 'series ' + d.name;
      });

  // Draws all the changed series.
  this.drawSeries_(newSeries);
};


/**
 * Update the app specific metrics of the graph.
 * @private
 */
historian.Bars.prototype.displaySelectedApp_ = function() {
  this.updateSeries_();
};


/**
 * Removes services not present in servicesMatcher
 * @param {!Array<!historian.Entry>} data The data to filter.
 * @param {number} uid The uid to match.
 * @return {!Array<!historian.AggregatedEntry>} matching data.
 */
historian.Bars.prototype.filterServices = function(data, uid) {
  var matching = [];

  data.forEach(function(d) {
    var values = [];

    var services = [];
    if (d.services != null) {
      services = d.services;
    } else {
      services.push(d.value);
    }

    services.forEach(function(s) {
      if (this.serviceMapper_.uid(s) == uid) {
        values.push(s);
      }
    }, this);
    if (values.length > 0) {
      matching.push({
        'start_time': d.start_time,
        'end_time': d.end_time,
        'value': d.value,
        'services': values
      });
    }
  }, this);
  return matching;
};


/**
 * Changes the cluster's end time to the start time added to the
 * active duration of the cluster.
 * If this is less than the visible duration for the current
 * zoom level, it is set to the minimum visible.
 * @param {!historian.util.ClusterEntry} d The data point to display.
 * @return {number} value to plot.
 * @private
 */
historian.Bars.prototype.drawAdjustedEndTime_ = function(d) {
  var msPerPixel = this.msPerPixel_();
  var adjustedEndTime = d.start_time + d.active_duration;

  // Check if the duration of the event is long enough that it would
  // reach the minimum px width when rendered.
  var minDuration = historian.Bars.MIN_BAR_WIDTH_PX_ * msPerPixel;
  if (d.active_duration < minDuration) {
    adjustedEndTime = d.start_time + minDuration;
  }
  return this.context_.xScale(adjustedEndTime);
};


/**
 * Returns only the data that occurs in the currently visible time range.
 * @return {!historian.SeriesData} The matching data.
 * @private
 */
historian.Bars.prototype.getVisibleData_ = function() {
  var result = [];
  this.barData_.forEach(function(series) {
    result.push({
      'name': series.name,
      'type': series.type,
      'color': series.color,
      'index': series.index,
      'values': series.values.filter(this.inViewableRange.bind(this))
    });
  }, this);
  return result;
};


/**
 * Returns whether a data point is visible in the current time range.
 * @param {(!historian.Entry|!historian.AggregatedEntry)} v The data point.
 * @return {boolean} true if visible, false otherwise.
 */
historian.Bars.prototype.inViewableRange = function(v) {
  var startTime = this.context_.xScale.invert(0);
  var endTime = this.context_.xScale.invert(historian.Context.VIS_WIDTH);

  var dataRange = new goog.math.Range(v['start_time'], v['end_time']);
  var extent = new goog.math.Range(startTime, endTime);
  return goog.math.Range.hasIntersection(dataRange, extent);
};


/**
 * Returns the bar data clustered, based on the current zoom level.
 * @param {!historian.SeriesData} data The data to cluster.
 * @return {!Array<!historian.ClusteredSerieData>} Clustered data.
 */
historian.Bars.prototype.cluster = function(data) {
  var msPerPixel = this.msPerPixel_();
  var clustered = historian.util.cluster(data, msPerPixel);
  return clustered;
};


/**
 * Returns the duration visible for 1 pixel.
 * @return {number}
 * @private
 */
historian.Bars.prototype.msPerPixel_ = function() {
  var startTime = this.context_.xScale.invert(0);
  var endTime = this.context_.xScale.invert(historian.Context.VIS_WIDTH);
  var ext = endTime - startTime;
  return Math.round(Number(ext / historian.Context.VIS_WIDTH));
};


/**
 * Displays a tooltip for the bar being hovered over.
 * @param {!historian.ClusteredSerieData} parentDatum
 *     The series data for the datum being hovered over.
 * @param {!historian.util.ClusterEntry} d The datum point being hovered on.
 * @private
 */
historian.Bars.prototype.onMouseover_ = function(parentDatum, d) {
  var formattedLines = [
    historian.time.getDate(d.start_time),
    historian.time.getTime(d.start_time) + ' - ' +
        historian.time.getTime(d.end_time)
  ];

  formattedLines.push('<b>active duration:</b> ' +
      historian.time.formatDuration(d.active_duration));

  var name = parentDatum.name;
  if (parentDatum.name == 'Partial wakelock') {
    name = 'First wakelock acquired';
  } else if (parentDatum.name == 'wakelock_in') {
    name = 'Partial wakelock';
  }
  formattedLines.push('<b>' + name + '</b>' + ': ' +
      d.clustered_count + ' occurences');

  // Boolean entries don't have associated values other than true.
  // Don't display values for wakelocks as it's only the
  // first wakelock acquired.
  if (parentDatum.type != 'bool') {
    formattedLines.push('');

    // Display the values in order of duration.
    var sorted = d.getSortedValues();

    sorted.forEach(function(s) {
      var value =
          historian.color.valueFormatter(parentDatum.name, s['value']);

      var duration = historian.time.formatDuration(s['duration']);
      var count = s['count'] + ' count';

      formattedLines.push(value + ': ' + duration + ', ' + count);
    });
  }

  this.tooltip_.update_(d3.event.pageX, d3.event.pageY, formattedLines);
};


/**
 * Hides the tooltip from view.
 * @private
 */
historian.Bars.prototype.onMouseout_ = function() {
  this.tooltip_.hide_();
};


/**
 * Returns the y coordinate the series line should be rendered on.
 * @param {number} index The index of the series. The highest numbered series
 *   is rendered at the top of the graph.
 * @return {number} The y coordinate corresponding to the index.
 */
historian.Bars.getY = function(index) {
  return ((historian.Context.VIS_HEIGHT / 20) * (20 - index - 1));
};



/**
 * Class for displaying a tooltip when hovering over a bar line.
 * @constructor
 * @private
 */
historian.Bars.Tooltip_ = function() {
  /** @private {!d3.selection} */
  this.tooltip_ = d3.select('body')
      .append('div')
      .attr('class', 'tooltip')
      .style('opacity', historian.Bars.Tooltip_.MIN_VISIBILITY);
};


/** @const {number} */
historian.Bars.Tooltip_.MAX_VISIBILITY = 0.9;


/** @const {number} */
historian.Bars.Tooltip_.MIN_VISIBILITY = 0;


/** @const {number} */
historian.Bars.Tooltip_.TRANSITION_MS = 300;


/** @const {number} */
historian.Bars.Tooltip_.LEFT_OFFSET_PX = 5;


/** @const {number} */
historian.Bars.Tooltip_.LETTER_WIDTH_PX = 8;


/** @const {number} */
historian.Bars.Tooltip_.TEXT_HEIGHT_PX = 20;


/** @const {number} */
historian.Bars.Tooltip_.MAX_WIDTH_PX = 600;


/**
 * Updates the contents, position, size, and visibility of the tooltip.
 * @param {number} x The x coordinate of the event.
 * @param {number} y The y coordinate of the event.
 * @param {!Array.<string>} lines The Html contents to display in tooltip.
 * @private
 */
historian.Bars.Tooltip_.prototype.update_ = function(x, y, lines) {
  this.tooltip_.html(lines.join('<br>'))
      .style('left', + (x + historian.Bars.Tooltip_.LEFT_OFFSET_PX) + 'px')
      .style('top', + y + 'px');

  // Find the length of the longest line, so we can set the width of the box.
  var maxLength = 0;
  lines.forEach(function(line) {
    if (line.length > maxLength) {
      maxLength = line.length;
    }
  });
  var width = maxLength * historian.Bars.Tooltip_.LETTER_WIDTH_PX;

  // Increase height of tooltip display for each extra line.
  var height = lines.length * historian.Bars.Tooltip_.TEXT_HEIGHT_PX;

  this.tooltip_
      .style('width', width + 'px')
      .style('height', height + 'px');

  this.setVisibility_(historian.Bars.Tooltip_.MAX_VISIBILITY);
};


/**
 * Sets the opacity of the tooltip.
 * @param {number} v The visibility value.
 * @private
 */
historian.Bars.Tooltip_.prototype.setVisibility_ = function(v) {
  this.tooltip_.transition()
      .duration(historian.Bars.Tooltip_.TRANSITION_MS)
      .style('opacity', v);
};


/**
 * Hides the tooltip from view.
 * @private
 */
historian.Bars.Tooltip_.prototype.hide_ = function() {
  this.setVisibility_(historian.Bars.Tooltip_.MIN_VISIBILITY);
};
