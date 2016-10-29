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

goog.provide('historian.Bars');

goog.require('goog.string');
goog.require('historian.Context');
goog.require('historian.Tooltip');
goog.require('historian.color');
goog.require('historian.constants');
goog.require('historian.data');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.tables');
goog.require('historian.time');
goog.require('historian.utils');



// TODO: replace with goog.module.
goog.scope(function() {


/** @private @const {string} */
var RENDERED_BAR_ = '.bar';


/** @private @const {string} */
var SHOW_BARS_TOGGLE_ = '.show-bars';



/**
 * Bars creates the individual lines for each data point of each series,
 * as well as the tooltip displayed when a bar is hovered over.
 * Each series is rendered in a horizontal line.
 *
 * @param {!historian.Context} context The visualisation context.
 * @param {!historian.BarData} barData The bar data used in Historian v2.
 * @param {!historian.LevelData} levelData The level data used in Historian v2.
 * @param {!historian.TimeToDelta} timeToDelta The map from timestamp to human
 *     readable format.
 * @param {!historian.State} state Global Historian state.
 * @param {!historian.power.Estimator} powerEstimator
 * @param {jQuery=} opt_container The container the graph is rendered in.
 * @constructor
 * @struct
 */
historian.Bars = function(context, barData, levelData, timeToDelta, state,
    powerEstimator, opt_container) {
  /** @private {!historian.BarData} */
  this.barData_ = barData;

  /** @private {!historian.LevelData} */
  this.levelData_ = levelData;

  /** @private {!historian.Context} */
  this.context_ = context;

  /** @private {!Array<!historian.SeriesGroup>} */
  this.groupsToRender_ = this.barData_.getData();

  /** @private {?historian.Tooltip} */
  this.tooltip_;

  /** @private {!Object<boolean>} */
  this.highlightedMetrics_ = {};

  /** @private {!historian.TimeToDelta} */
  this.timeToDelta_ = timeToDelta;

  /** @private {!historian.State} */
  this.state_ = state;

  /** @private {!historian.power.Estimator} */
  this.powerEstimator_ = powerEstimator;

  /**
   * @type {?{
   *   series: !historian.ClusteredSeriesData,
   *   bar: !historian.data.ClusterEntry
   * }}
   */
  this.hovered = null;

  /** @private {?jQuery} */
  this.container_ = opt_container || null;

  this.addAppSelectorListener_();
  this.barData_.registerListener(this.onSeriesChange.bind(this));

  if (this.container_) {
    this.levelData_.registerListener(function() {
      // Auto toggle bars based on whether we're showing the rate of change.
      this.container_.find(SHOW_BARS_TOGGLE_)
          .prop('checked', this.levelData_.getConfig().isRateOfChange)
          .trigger('click');
    }.bind(this));
    this.container_.find(SHOW_BARS_TOGGLE_).change(function(event) {
      this.container_.find(RENDERED_BAR_)
          .toggle($(event.target).is(':checked'));
    }.bind(this));
  }
};


/**
 * Height of row label font size.
 * @const {number}
 */
historian.Bars.ROW_LABEL_HEIGHT_PX = 10;


/** @const @private {number} */
historian.Bars.LABEL_X_OFFSET_PX_ = 20;


/** @const @private {number} */
historian.Bars.LABEL_Y_OFFSET_PX_ = 20;


/** @const @private {number} */
historian.Bars.REMOVE_OFFSET_PX_ = 15;


/** @const @private {number} */
historian.Bars.HELP_ICON_OFFSET_PX_ = -historian.Context.MARGINS.LEFT + 10;


/**
 * The minimum px width for each bar line.
 * @const @private {number}
 */
historian.Bars.MIN_BAR_WIDTH_PX_ = 2;


/** @const @private {string} */
historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_ = 'unknown';


/** @const @private {string} */
historian.Bars.SELECTABLE_LEVEL_METRIC_CLASS_ = 'selectable-level-metric';


/** @const @private {string} */
historian.Bars.REMOVE_METRIC_CLASS_ = '.remove';


/**
 * Rerenders the series lines with the new data.
 */
historian.Bars.prototype.onSeriesChange = function() {
  this.groupsToRender_ = this.barData_.getData();
  this.render();
};


/**
 * Renders the series.
 */
historian.Bars.prototype.render = function() {
  this.update();
};


/**
 * Highlights the given metrics.
 * @param {!Array<string>} metrics Metrics to be highlighted.
 */
historian.Bars.prototype.highlightMetrics = function(metrics) {
  this.highlightedMetrics_ = {};
  metrics.forEach(function(metric) {
    this.highlightedMetrics_[metric] = true;
  }, this);
  this.groupsToRender_.forEach(function(series) {
    var label = this.context_.svgChart
        .select('.series-label[name="' + series.name + '"]');
    label.classed('highlighted', this.highlightedMetrics_[series.name] != null);
  }, this);
  this.renderLabels_();
};


/**
 * Redraws all the bar lines for the current zoom level.
 */
historian.Bars.prototype.update = function() {
  // Renders the bars and series labels.
  this.updateSeries_();

  // Re-render divider lines.
  this.renderDividerLines_();

  // Hide tooltip on re-render.
  if (this.tooltip_) {
    this.tooltip_.hide();
  }
};


/**
 * Renders the labels and help icons for each group.
 * @private
 */
historian.Bars.prototype.renderLabels_ = function() {
  this.context_.svgChart.selectAll('.series-label-group').remove();

  var labelGroup = this.context_.svgChart.append('g')
      .attr('class', 'series-label-group');

  var enterGroups = labelGroup.selectAll('.series-label')
      .data(this.groupsToRender_)
      .enter()
      .append('g')
      .attr('transform', function(group) {
        // The divider lines are drawn using group index, however contents
        // are one level above them.
        return 'translate(0,' + this.getRowY(group.index + 1) + ')';
      }.bind(this));

  // Render the help icons.
  var rowHeight = this.getRowHeight_();
  // Set to be slightly smaller than row height to avoid looking too crowded.
  // If the icon is small it's hard to tell what it is, so not setting as a
  // static height.
  var iconSize = rowHeight * 0.9;
  var tooltip = null;
  // foreignObject appears to be the only way to include a span in SVG, for the
  // glyphicon help icon.
  enterGroups.append('svg:foreignObject')
      .attr('class', function(group) {
        var hasLegend = this.barData_.getLegend(group.name).length > 0;
        // Only show the help icon if there is a help legend or descriptor
        // for the group.
        return hasLegend || group.name in historian.metrics.descriptors ?
            'help-icon-container' : 'hidden';
      }.bind(this))
      .attr('font-size', iconSize)  // Glyphicon size is set with font size.
      .attr('x', historian.Bars.HELP_ICON_OFFSET_PX_)
      .attr('y', (rowHeight - iconSize) / 2)  // To center it exactly.
      .append('xhtml:span')
      .attr('class', 'help-icon glyphicon glyphicon-info-sign')
      .on('mouseover', function(group) {
        var lines = [group.name];
        var legend = this.barData_.getLegend(group.name);
        var desc = historian.metrics.descriptors[group.name];
        if (legend.length == 0 && !desc) {
          // No legend or descriptor, don't display anything.
          return;
        }
        if (desc) {
          // Text help descriptor.
          lines.push(desc);
        }
        // Display each legend entry on a separate row.
        legend.forEach(function(entry) {
          var rectHtml = $('<div/>', {
            // Build errors if class is not quoted, as it's a reserved keyword.
            'class': 'legend-item',
            css: {
              backgroundColor: entry.color
            }
          }).prop('outerHTML');  // Convert the div to HTML.
          lines.push(rectHtml + entry.value);
        });
        tooltip = new historian.Tooltip(lines, this.state_, 'help-tooltip');
      }.bind(this))
      .on('mouseout', function() {
        if (tooltip) {
          tooltip.hide();
        }
      }.bind(this));

  // Render the group labels.
  enterGroups.append('text')
      .attr('name', function(group) {
        return group.name;
      })
      .attr('class', function(group) {
        var classes = 'series-label';
        if (group.name in historian.metrics.unreliableMetrics) {
          classes += ' unreliable';
        }
        // Currently only groups with a single series, of which is of type 'int'
        // will be selectable to display as the level metric.
        if (group.series.length == 1 && group.series[0].type == 'int') {
          classes += ' ' + historian.Bars.SELECTABLE_LEVEL_METRIC_CLASS_;
        }
        return classes;
      })
      // Note that labels are outside the translated clip rect.
      // So we need to add the offset.
      .attr('x', -historian.Bars.LABEL_X_OFFSET_PX_)
      .attr('y', function(group) {
        // Position of text refers to the bottom of the text.
        return (rowHeight / 2) + (historian.Bars.ROW_LABEL_HEIGHT_PX / 2);
      }.bind(this))
      .text(function(group) {
        if (group.name == historian.metrics.Csv.WAKELOCK_IN) {
          return 'Userspace wakelock (all)';
        } else if (group.name == historian.metrics.Csv.WAKE_LOCK_HELD) {
          return 'Userspace wakelock';
        } else if (group.name == historian.metrics.Csv.BATTERY_LEVEL) {
          return 'Battery level';
        }
        if (group.name in historian.metrics.unreliableMetrics) {
          return group.name + ' * ';
        }
        if (group.name in historian.metrics.logcatMetrics) {
          return group.name + ' (logcat)';
        }
        return group.name;
      });

  // Add buttons allowing users to remove individual series.
  enterGroups.append('svg:foreignObject')
      .attr('x', -historian.Bars.REMOVE_OFFSET_PX_)
      .attr('y', rowHeight / 2)
      .attr('font-size', '1.25em')
      .style('line-height', 0)
      .append('xhtml:span')
      .html('&times')
      .attr('class', historian.Bars.REMOVE_METRIC_CLASS_.slice(1))
      .style('opacity', 0)  // Not shown until the series group is hovered on.
      .on('click', function(group) {
        this.barData_.removeGroup(group.name);
      }.bind(this));

  // Show or hide the remove button depending on whether the series group
  // is being hovered on.
  enterGroups.on('mouseover', function(group) {
    d3.select(this).select(historian.Bars.REMOVE_METRIC_CLASS_)
        .style('opacity', 1);
  }).on('mouseout', function(group) {
    d3.select(this).select(historian.Bars.REMOVE_METRIC_CLASS_)
        .style('opacity', 0);
  });

  labelGroup.selectAll('.' + historian.Bars.SELECTABLE_LEVEL_METRIC_CLASS_)
      .on('click', function(element) {
        this.levelData_.setLevel(element.name);
      }.bind(this));

  var extraLabels = [];
  // Only show if there are metrics that are unreliable in this report version.
  if (Object.keys(historian.metrics.unreliableMetrics).length > 0) {
    extraLabels.push({class: 'unreliable', text: '* unreliable metric'});
  }
  var selectedUid = this.getSelectedUid_();
  if (selectedUid != null) {  // May be zero, so don't use falsy check.
    extraLabels.push({
      class: 'app-specific',
      text: 'filtered for UID ' + selectedUid
    });
  }
  extraLabels.forEach(function(label, idx) {
    labelGroup.append('text')
        .attr('class', 'series-label ' + label.class)
        .text(label.text)
        .attr('x', -historian.Bars.LABEL_X_OFFSET_PX_)
        .attr('y', this.context_.visSize[1] +
            historian.Bars.LABEL_Y_OFFSET_PX_ * (idx + 1));
  }, this);

  this.groupsToRender_.forEach(function(group) {
    var label = this.context_.svgChart
        .select('.series-label[name="' + group.name + '"]');
    label.classed('highlighted', !!this.highlightedMetrics_[group.name]);
    // Add the app-specific label to the class name if any series
    // in the group is app-specific, and the user has chosen an app.
    var hasAppSpecific = group.series.some(function(series) {
      return series.name in historian.metrics.appSpecificMetrics;
    });
    label.classed('app-specific', hasAppSpecific && selectedUid != null);
  }, this);
};


/**
 * Renders the bars for each series.
 * @param {!Array<!historian.SeriesGroup>} data The array of series to render.
 * @private
 */
historian.Bars.prototype.renderSeries_ = function(data) {
  var clusteredSeries = this.cluster(data);
  // Create a SVG group for each series.
  var seriesGroups = this.context_.svgBars.selectAll('.bars-group')
      .data(clusteredSeries, function(series) {
        return series.name;
      });
  seriesGroups.enter().append('g')
      .attr('id', function(series) {
        return 'series' + series.index;
      })
      .attr('class', 'bars-group');
  seriesGroups.exit().remove();

  seriesGroups.selectAll('g')
      .data(function(d) {return d.series;})
      .enter().append('g')
      .attr('id', function(series) {
        // The series hash is used instead of the row index,
        // as multiple series can be rendered on the same row.
        var seriesHash = historian.metrics.hash(series.source, series.name);
        return historian.utils.toValidID('series_' + seriesHash);
      });

  var barHeight = this.getRowY(.3) - this.getRowY(.7);
  var rowHeight = this.getRowHeight_();
  // For each series, draw a bar line for each data point.
  clusteredSeries.forEach(function(seriesGroup) {
    seriesGroup.series.forEach(function(series) {
      var seriesHash = historian.metrics.hash(series.source, series.name);
      var g = this.context_.svgBars.select(
          '#' + historian.utils.toValidID('series_' + seriesHash));
      // Unavailable events simply denote when a log is unavailable, and should
      // be rendered differently from real events.
      var isUnavailable = series.type == historian.metrics.UNAVAILABLE_TYPE;

      var idx = seriesGroup.index;
      // If the data point is to denote that data is unavailable for that
      // period, fill the entire row height to differentiate it.
      var y = isUnavailable ? this.getRowY(idx + 1) : this.getRowY(idx + .7);
      g.attr('transform', 'translate(0,' + y + ')');

      var bars = g.selectAll(RENDERED_BAR_)
          .data(series.values, function(bar) {
            return bar.startTime + '_' + bar.clusteredCount;
          });
      if (series.name in historian.metrics.renderAsCircles ||
          series.type == historian.metrics.ERROR_TYPE) {
        // Don't want the circles getting too big, so the values are capped.
        var maxValue = 20;
        var rowScale = d3.scale.linear()
            .domain([1, maxValue])
            .range([barHeight / 4, barHeight]);
        bars.enter().append('circle')
            .attr('r', function(bar) {
              if (series.type == historian.metrics.ERROR_TYPE) {
                return rowScale(maxValue);
              }
              return rowScale(Math.min(bar.clusteredCount, maxValue));
            });
      } else {
        bars.enter().append('rect');
        bars.attr('width', function(bar) {
          return this.drawAdjustedEndTime_.bind(this, bar)() -
              this.context_.xScale(bar.startTime);
        }.bind(this))
            .attr('height', isUnavailable ? rowHeight : barHeight);
      }
      // Listen to right click events for copying tooltip text.
      bars.on('mousedown', function(bar) {
        if (d3.event.button == 2  /** right click **/) {
          var text = this.tooltipText_(
              series, bar, this.context_.location, false);
          // TODO: make this a multi line window.
          window.prompt('Copy: Ctrl + c (pc), Cmd + c (mac)', text.join('\n'));
          // Don't let this event bubble up, otherwise the graph will think
          // clicking for panning has occurred. Window.prompt prevents
          // the mouseup event from firing, which will lead to the graph
          // in a clicked state when the prompt is closed.
          d3.event.stopPropagation();
        }
      }.bind(this));
      bars.on('mouseover', function(bar) {
            this.hovered = {
              bar: bar,
              series: series
            };
          }.bind(this))
          .on('mouseleave', function() {
            this.hideSeriesInfo();
            this.hovered = null;
          }.bind(this));
      bars.attr('transform', function(bar) {
            return 'translate(' + this.context_.xScale(bar.startTime) + ',0)';
          }.bind(this))
          .attr('class', isUnavailable ? 'bar unavailable' : 'bar');

      var color = function(bar) {
        // Network connectivity is a special case of aggregated metric.
        // We want to show the value of greatest duration.
        if (series.name == historian.metrics.Csv.CONNECTIVITY) {
          var split = bar.getMaxValue().split(':');
          return series.color(split[0]);
        }
        if (series.name == historian.metrics.Csv.FOREGROUND_PROCESS) {
          return series.color(bar.getMaxValue());
        }
        // Use count to determine color for aggregated stats.
        if (historian.metrics.isAggregatedMetric(series.name)) {
          return series.color(bar.clusteredCount);
        }
        // Color based on userspace wakelock classification.
        if (series.name == historian.metrics.KERNEL_UPTIME) {
          return series.color(bar.getMaxValue().wakelockCategory);
        }
        // Color based on wearable RPC event type.
        if (series.name == historian.metrics.Csv.WEARABLE_RPC) {
          var eventType = 'direct';
          for (var value in bar.clusteredValues) {
            var eventTypeCandidate =
                bar.clusteredValues[value].value.split(':')[0];
            if (eventTypeCandidate == 'exception') {
              eventType = 'exception';
              break;
            } else if (eventTypeCandidate == 'cloud') {
              eventType = 'cloud';
            }
          }
          return series.color(eventType);
        }
        return series.color(bar.getMaxValue());
      };
      var showBars = this.container_.find(SHOW_BARS_TOGGLE_).is(':checked');
      // Access the pattern embedded in this svg.
      var hatchPattern = '#' + this.container_.find('svg pattern').attr('id');

      bars.style('fill', isUnavailable ? 'url(' + hatchPattern + ')' : color)
          .attr('stroke', color)
          .style('display', showBars ? 'inline' : 'none');
      bars.exit().remove();
    }.bind(this));
  }.bind(this));
};


/**
 * Renders the horizontal dividers for the series.
 * @private
 */
historian.Bars.prototype.renderDividerLines_ = function() {
  var lines = this.context_.seriesLinesGroup
      .selectAll('.series-divider').data(this.groupsToRender_);
  lines.enter().append('line')
      .attr('class', 'series-divider')
      .attr('x1', -historian.Context.MARGINS.LEFT);
  lines.attr('x2', this.context_.visSize[0])
      .attr('y1', function(series, index) {
        return this.getRowY(index);
      }.bind(this))
      .attr('y2', function(series, index) {
        return this.getRowY(index);
      }.bind(this));
  lines.exit().remove();
};


/**
 * The message to show when full wakelock reporting is not present.
 * @private {!Array<string>}
 */
historian.Bars.WAKE_LOCK_WARNING_MSG_HTML_ = [
  'Only the first app to acquire the wakelock is shown.',
  'Total wakelock duration is not attributed to only those apps listed.',
  'To enable full wakelock reporting, run:',
  'adb shell dumpsys batterystats --enable full-wake-history'
];


/**
 * Adds the event listeners for the app selector.
 * @private
 */
historian.Bars.prototype.addAppSelectorListener_ = function() {
  $('#appSelector').on('change', this.displaySelectedApp_.bind(this));
};


/**
 * Returns the selected uid in the app selector.
 * @return {?number} The uid, or null if none was selected.
 * @private
 */
historian.Bars.prototype.getSelectedUid_ = function() {
  var uid = null;
  var e = $('#appSelector');
  if (e.length) {
    uid = parseInt(e.val(), 10);
  }
  // isNaN(null) is false, but this will return null as expected.
  return isNaN(uid) ? null : uid;
};


/**
 * Updates the data binded to bar elements and redraws all the changed series.
 * @private
 */
historian.Bars.prototype.updateSeries_ = function() {
  this.renderLabels_();

  var uid = this.getSelectedUid_();
  var timeRange = this.context_.getViewableTimeRange();
  var filteredData = [];
  this.groupsToRender_.forEach(function(seriesGroup) {
    var allSeries = [];
    seriesGroup.series.forEach(function(series) {
      var values = historian.utils.inTimeRange(
          timeRange.start, timeRange.end, series.values);
      if (uid != null &&
          (series.name in historian.metrics.appSpecificMetrics)) {
        values = this.filterServices(values, uid);
      }
      allSeries.push({
        name: series.name,
        source: series.source,
        type: series.type,
        color: series.color,
        values: values,
        originalValues: series.originalValues,
        cluster: series.cluster
      });
    }, this);
    filteredData.push({
      name: seriesGroup.name,
      index: seriesGroup.index,
      series: allSeries
    });
  }, this);

  this.renderSeries_(filteredData);
};


/**
 * Update the app-specific metrics of the graph.
 * @private
 */
historian.Bars.prototype.displaySelectedApp_ = function() {
  this.updateSeries_();
};


/**
 * Returns entries that have the given UID.
 * @param {!Array<(!historian.Entry|!historian.AggregatedEntry)>} data
 *     The data to filter.
 * @param {number} uid The uid to match.
 * @return {!Array<!historian.Entry|!historian.AggregatedEntry>} The matching
 *     data.
 */
historian.Bars.prototype.filterServices = function(data, uid) {
  var matching = [];

  data.forEach(function(d) {
    // We handle these entries in 2 distinct cases based on the entry type,
    // as we want the filtered entries to match the original type.

    if (d.services) {
      var filtered = d.services.filter(function(entry) {
        return entry.uid == uid;
      }, this);
      if (filtered.length > 0) {
        matching.push({
          startTime: d.startTime,
          endTime: d.endTime,
          services: filtered
        });
      }
    } else if (d.uid == uid) {
      matching.push(d);
    }
  }, this);
  historian.data.mergeSplitEntries(matching);  // Modifies passed in array.
  return matching;
};


/**
 * Changes the cluster's end time to the start time added to the
 * active duration of the cluster.
 * If this is less than the visible duration for the current
 * zoom level, it is set to the minimum visible.
 * @param {!historian.data.ClusterEntry} d The data point to display.
 * @return {number} value to plot.
 * @private
 */
historian.Bars.prototype.drawAdjustedEndTime_ = function(d) {
  var msPerPixel = this.context_.msPerPixel();
  var adjustedEndTime = d.startTime + d.activeDuration;

  // Check if the duration of the event is long enough that it would
  // reach the minimum px width when rendered.
  var minDuration = historian.Bars.MIN_BAR_WIDTH_PX_ * msPerPixel;
  if (d.activeDuration < minDuration) {
    adjustedEndTime = d.startTime + minDuration;
  }
  return this.context_.xScale(adjustedEndTime);
};


/**
 * Returns only the data that occurs in the currently visible time range.
 * @return {!Array<!historian.SeriesGroup>} The matching data.
 * @private
 */
historian.Bars.prototype.getVisibleData_ = function() {
  var result = [];
  var timeRange = this.context_.getViewableTimeRange();
  this.groupsToRender_.forEach(function(seriesGroup) {
    var allSeries = [];
    seriesGroup.series.forEach(function(series) {
      allSeries.push({
        name: series.name,
        source: series.source,
        type: series.type,
        color: series.color,
        values: historian.utils.inTimeRange(
            timeRange.start, timeRange.end, series.values),
        originalValues: series.originalValues,
        cluster: series.cluster
      });
    }, this);
    result.push({
      name: seriesGroup.name,
      index: seriesGroup.index,
      series: allSeries
    });
  }, this);
  return result;
};


/**
 * Returns the bar data clustered, based on the current zoom level.
 * @param {!Array<!historian.SeriesGroup>} data The data to cluster.
 * @return {!Array<historian.ClusteredSeriesData>} Clustered data.
 */
historian.Bars.prototype.cluster = function(data) {
  var msPerPixel = this.context_.msPerPixel();
  var clustered = historian.data.cluster(data, msPerPixel);
  return clustered;
};


/**
 * Returns the text with HTML bold tags if toHtml is true.
 * @param {string} text Text to format.
 * @param {boolean} toHtml Whether to add HTML bold tags.
 * @return {string} Formatted text if toHtml was true, otherwise the
 *     original text.
 * @private
 */
historian.Bars.prototype.bold_ = function(text, toHtml) {
  return toHtml ? '<b>' + text + '</b>' : text;
};


/**
 * Returns the text to display in the tooltip for the given cluster.
 * @param {!historian.ClusteredSeriesData} series The series the cluster
 *     belongs to.
 * @param {!historian.data.ClusterEntry} cluster The cluster to construct the
 *     tooltip text for.
 * @param {string} loc The location of the bug report. e.g. America/Dawson
 * @param {boolean} toHtml Whether to output HTMl formatting elements.
 * @return {!Array<string>} The lines of text as an array.
 * @private
 */
historian.Bars.prototype.tooltipText_ = function(
    series, cluster, loc, toHtml) {
  var endTime = historian.time.getTime(cluster.endTime, loc);
  // This isn't a real event, so don't show all the usual text.
  if (series.type == historian.metrics.UNAVAILABLE_TYPE) {
    var msg = 'The log containing ' +
        historian.metrics.baseMetric(series.type, series.name) +
        ' events does not begin until ' + endTime + '.';
    return [msg];
  }

  var formattedLines = [
    historian.time.getDate(cluster.startTime),
    historian.time.getTime(cluster.startTime, loc) + ' - ' + endTime
  ];
  var humanReadable = {
    start: this.timeToDelta_[cluster.startTime.toString()] ||
        historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_,
    end: this.timeToDelta_[cluster.endTime.toString()] ||
        historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_
  };
  // If either the human readable start or end time were defined, show them.
  // If both were undefined, don't show anything.
  if (humanReadable.start != historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_ ||
      humanReadable.end != historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_) {
    formattedLines.push(humanReadable.start + ' to ' + humanReadable.end);
  }

  // Instant events have no associated duration.
  if (cluster.activeDuration != 0) {
    formattedLines.push(this.bold_('active duration: ', toHtml) +
        historian.time.formatDuration(cluster.activeDuration));
  }

  var name = series.name;
  if (name == historian.metrics.Csv.WAKE_LOCK_HELD) {
    name = 'Wakelock held by at least 1 app';
  } else if (name == historian.metrics.Csv.WAKELOCK_IN) {
    name = 'Partial wakelock';
  } else if (name == historian.metrics.Csv.BATTERY_LEVEL) {
    name = 'Battery level';
  }

  formattedLines.push(this.bold_(name, toHtml) + ': ' +
      cluster.clusteredCount + ' occurences');

  if (series.name == historian.metrics.Csv.CPU_RUNNING) {
    var powerEvents = cluster.sorted
        .map(function(runningEvent) {
          return this.powerEstimator_.getRunningPowerEvent(runningEvent);
        }, this)
        .filter(function(event) {
          return event != null;
        });
    if (powerEvents.length > 0) {
      var power = this.powerEstimator_.getEventsPower(powerEvents).toFixed(3);
      formattedLines.push(
          this.bold_('Energy consumed: ', toHtml) + power + ' mAh');
    }
  }

  // Create a table for extra information for the cluster, such as the duration
  // and count of each event.
  var table = this.getTable_(series, cluster);
  if (table) {
    formattedLines.push('');
    if (!toHtml) {
      formattedLines.push(historian.tables.toString(table));
    } else {
      // Attach a div that the table can be appended to.
      // The table shouldn't be appended here as we may just want the text
      // output for copying the tooltip.
      formattedLines.push('<div id="values-container"></div>');
    }
  }
  if (series.name == historian.metrics.Csv.WAKE_LOCK_HELD) {
    // WAKE_LOCK_HELD only shows the first wakelock, so show a warning.
    // Clone the array so we don't push a span to the original array each time.
    var warning = historian.Bars.WAKE_LOCK_WARNING_MSG_HTML_.slice();
    if (toHtml) {
      warning.unshift('<span class="series-warning">');
      warning.push('</span>');
    }
    formattedLines.push.apply(formattedLines, warning);
  }
  return formattedLines;
};


/**
 * Displays a tooltip for the bar being hovered over.
 */
historian.Bars.prototype.showSeriesInfo = function() {
  this.hideSeriesInfo();
  if (!this.hovered)
    return;
  var series = this.hovered.series;
  var bar = this.hovered.bar;
  var loc = this.context_.location;

  var formattedLines = this.tooltipText_(series, bar, loc, true);
  this.hideSeriesInfo();
  this.tooltip_ = new historian.Tooltip(formattedLines, this.state_);
  // Create a table for extra information for the cluster, such as the duration
  // and count of each event.
  var table = this.getTable_(series, bar);
  if (table) {
    $(table).addClass('values-table');
    $('#values-container').append(table);
    this.tooltip_.adjustPosition();
  }
};


/**
 * Hides the tooltip from view.
 */
historian.Bars.prototype.hideSeriesInfo = function() {
  if (this.tooltip_) this.tooltip_.hide();
};


/**
 * Returns the table of values for the cluster of the given series.
 * Null for boolean series which are not SCREEN_ON.
 * @param {!historian.ClusteredSeriesData} series
 * @param {!historian.data.ClusterEntry} cluster The cluster to construct the
 *     table of values for.
 * @return {?jQuery} The table of values.
 * @private
 */
historian.Bars.prototype.getTable_ = function(series, cluster) {
  // Boolean entries don't have associated values other than true, except for
  // SCREEN_ON events, which are associated with screen on reasons.
  if (series.type == 'bool' &&
      series.name != historian.metrics.Csv.SCREEN_ON) {
    return null;
  }
  switch (series.name) {
    case historian.metrics.Csv.AM_PROC_START:
    case historian.metrics.Csv.AM_PROC_DIED:
      return this.createAMProcTable_(cluster.sorted);
    case historian.metrics.Csv.AM_ANR:
    case historian.metrics.Csv.AM_LOW_MEMORY:
      return this.createSortedTable_(series.name, cluster);
    default:
      return this.valuesToTable_(
          series, cluster.getSortedValues(), cluster);
  }
};


/**
 * Creates a table to display the given values in a cluster.
 *
 * @param {!historian.ClusteredSeriesData} series The series the cluster
 *     belongs to.
 * @param {!Array<!historian.data.ClusterEntryValue>} values The values to
 *     display.
 * @param {!historian.data.ClusterEntry} cluster The cluster the value belongs
 *     to.
 * @return {!jQuery} The created table.
 * @private
 */
historian.Bars.prototype.valuesToTable_ = function(series, values, cluster) {
  var seriesHeading = series.name;
  switch (series.name) {
    case historian.metrics.Csv.SCREEN_ON:
      seriesHeading = 'Screen first turned on by';
      break;
    case historian.metrics.Csv.WAKE_LOCK_HELD:
      seriesHeading = 'First wakelock acquired by';
      break;
    case historian.metrics.KERNEL_UPTIME:
      seriesHeading = 'Wakeup reason';
      break;
  }
  var headRow = [
    seriesHeading,
    'Number of times'
  ];

  var hasDuration = historian.metrics.hasDuration(series.name);
  if (hasDuration) {
    headRow.push('Total duration');
  }
  var isAggregated = historian.metrics.isAggregatedMetric(series.name);
  var showOriginalTimes = series.originalValues && isAggregated;
  if (showOriginalTimes) {
    headRow.push('Actual start time(s)');
  }

  // CPU_RUNNING and KERNEL_UPTIME have an extra column.
  if (series.name == historian.metrics.Csv.CPU_RUNNING) {
    headRow.push('Timestamps when wakeup reason was recorded');
  } else if (series.name == historian.metrics.KERNEL_UPTIME) {
    headRow.push('Source CPU running event caused by userspace');
  }

  var bodyRows = values.map(function(clusterValue) {
    var value = clusterValue.value;
    if (series.name == historian.metrics.KERNEL_UPTIME) {
      value = value.wakeReason;
    }
    var formattedValue = typeof value == 'string' || typeof value == 'number' ?
        historian.color.valueFormatter(series.name, value) : value;
    var tblRow = [
      formattedValue,
      clusterValue.count
    ];

    if (showOriginalTimes) {
      // Aggregated series may have overlapping entries, which are sliced up
      // into new 'aggregated entries' which are no longer overlapping.
      // This may lead to a long event looking like a series of short events.
      // Instead we show the original event duration and start time
      // (before slicing up) for each sliced up entry.
      var duration = 0;
      var formattedStartTimes = [];
      for (var id in clusterValue.ids) {
        var parsedId = parseInt(id, 10);
        var originalEntry = series.originalValues[parsedId];
        duration += originalEntry.endTime - originalEntry.startTime;
        formattedStartTimes.push(historian.time.getTime(
            originalEntry.startTime, this.context_.location));
      }
      if (hasDuration) {
        tblRow.push(historian.time.formatDuration(duration));
      }
      tblRow.push(formattedStartTimes.join(', '));

    } else if (hasDuration) {
      tblRow.push(historian.time.formatDuration(clusterValue.duration));
    }

    // Populate the extra column if the series is CPU_RUNNING or KERNEL_UPTIME.
    if (series.name == historian.metrics.Csv.CPU_RUNNING) {
      var wakeupReasonTimes = clusterValue.extra;
      var formattedTimes = wakeupReasonTimes.map(function(t) {
        return historian.time.getTime(t.startTime, this.context_.location);
      }.bind(this)).join(', ');  // Comma separated wakeup reason times.
      tblRow.push(formattedTimes);

    } else if (series.name == historian.metrics.KERNEL_UPTIME) {
      var hasUserspace = clusterValue.value.wakelockCategory ==
          historian.metrics.KERNEL_UPTIME_WITH_USERSPACE;
      tblRow.push(hasUserspace ? 'y' : 'n');
    }
    return tblRow;
  }, this);
  return historian.tables.createTable(headRow, bodyRows);
};


/**
 * Width of a timestamp for all the activity manager tooltips.
 * The format is HH:MM:SS.
 * @const {number}
 */
historian.Bars.AM_TIMESTAMP_WIDTH = 14;


/**
 * Creates a table for the activity manager proc start and died values.
 * @param {!Array<!historian.Entry>} entries The entries to display.
 * @return {!jQuery} The created table.
 * @private
 */
historian.Bars.prototype.createAMProcTable_ = function(entries) {
  var headRow = [
    'Time',
    'UID',
    'PID',
    'Process',
    'Component'
  ];
  var empty = goog.string.repeat(' ', historian.Bars.AM_TIMESTAMP_WIDTH);
  var loc = this.context_.location;
  var bodyRows = entries.map(function(e) {
    var v = e.value;
    // The start or end time can be unknown, so we display an empty string
    // instead.
    var start = v.startTime == historian.constants.UNKNOWN_TIME ? empty :
        historian.time.getTime(v.startTime, loc);
    var end = v.endTime == historian.constants.UNKNOWN_TIME ? empty :
        historian.time.getTime(v.endTime, loc);
    var time = goog.string.subs('%s - %s', start, end);
    // There is no uid if a died event has no corresponding start event.
    var uid = (v.uid == 0) ? '' : v.uid.toString();

    return [
      time,
      uid,
      v.pid.toString(),
      v.process,
      v.component
    ];
  });
  return historian.tables.createTable(headRow, bodyRows);
};


/**
 * Creates a table showing events in the given cluster sorted by start time.
 * @param {string} series The name of the series the entries belong to.
 * @param {!historian.data.ClusterEntry} cluster The cluster to display.
 * @return {?jQuery} The created table.
 * @private
 */
historian.Bars.prototype.createSortedTable_ = function(series, cluster) {
  var entries = cluster.sorted;
  var headRow = ['Time'];
  var seriesHasUid =
      entries.some(function(e) { return e.hasOwnProperty('uid'); });
  if (seriesHasUid) {
    // Add the UID column if any entry has a UID.
    headRow.push('UID');
  }
  var entryToRowFn = null;
  // Format of activity manager row:
  // frameworks/base/services/core/java/com/android/server/am/EventLogTags.logtags
  switch (series) {
    case historian.metrics.Csv.AM_ANR:
      headRow = headRow.concat(
          ['User', 'PID', 'Package Name', 'Flags', 'Reason']);
      entryToRowFn = function(entry) { return entry.value.split(','); };
      break;
    case historian.metrics.Csv.AM_LOW_MEMORY:
      headRow = headRow.concat(['Num Processes']);
      entryToRowFn = function(entry) { return entry.value; };
      break;
  }
  if (!entryToRowFn) {
    console.log('No entryToRowFn specified for: ' + series.name);
    return null;
  }
  var bodyRows = entries.map(function(entry) {
    var row =
        [historian.time.getTime(entry.startTime, this.context_.location)];
    if (seriesHasUid) {
      // Some entries might not have a UID, so check per entry.
      row.push(entry.hasOwnProperty('uid') ? entry.uid : '');
    }
    return row.concat(entryToRowFn(entry));
  }.bind(this));
  return historian.tables.createTable(headRow, bodyRows);
};


/**
 * Returns the y coordinate the series row should be rendered on.
 * @param {number} index The index of the series. The highest numbered series
 *   is rendered at the top of the graph.
 * @return {number} The y coordinate corresponding to the index.
 */
historian.Bars.prototype.getRowY = function(index) {
  return this.context_.rowScale(index);
};


/**
 * Returns the height of a single row in the graph.
 * @return {number} The height of a row, zero if there are no rows.
 * @private
 */
historian.Bars.prototype.getRowHeight_ = function() {
  // A higher index number is rendered higher in the graph.
  // The top left of the SVG coordinates is (0,0), so the y position
  // of index 1 would be smaller than the y position of index 0.
  // This guarantees the result to be non-negative.
  return this.getRowY(0) - this.getRowY(1);
};

});  // goog.scope
