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
goog.require('historian.data');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.tables');
goog.require('historian.time');
goog.require('historian.utils');



/**
 * Bars creates the individual lines for each data point of each series,
 * as well as the tooltip displayed when a bar is hovered over.
 * Each series is rendered in a horizontal line.
 *
 * @param {!historian.Context} context The visualisation context.
 * @param {!historian.BarData} barData The bar data used in Historian v2.
 * @param {!historian.LevelData} levelData The level data used in Historian v2.
 * @param {!historian.data.ServiceMapper} serviceMapper
 *     The map from service to uid.
 * @param {!historian.TimeToDelta} timeToDelta The map from timestamp to human
 *     readable format.
 * @param {!historian.State} state Global Historian state.
 * @constructor
 * @struct
 */
historian.Bars = function(
    context, barData, levelData, serviceMapper, timeToDelta, state) {
  /** @private {!historian.BarData} */
  this.barData_ = barData;

  /** @private {!historian.LevelData} */
  this.levelData_ = levelData;

  /** @private {!historian.Context} */
  this.context_ = context;

  /** @private {!Array<!historian.SeriesGroup>} */
  this.groupsToRender_ = this.barData_.getData();

  /** @private {!historian.data.ServiceMapper} */
  this.serviceMapper_ = serviceMapper;

  /** @private {?historian.Tooltip} */
  this.tooltip_;

  /** @private {!Object<boolean>} */
  this.highlightedMetrics_ = {};

  /** @private {!historian.TimeToDelta} */
  this.timeToDelta_ = timeToDelta;

  /** @private {!historian.State} */
  this.state_ = state;

  /**
   * @type {?{
   *   series: !historian.ClusteredSeriesData,
   *   bar: !historian.data.ClusterEntry
   * }}
   */
  this.hovered = null;

  this.addAppSelectorListener_();
  this.barData_.registerListener(this.onSeriesChange.bind(this));
};


/**
 * Height of row label font size.
 * @const {number}
 */
historian.Bars.ROW_LABEL_HEIGHT_PX = 10;


/** @const @private {number} */
historian.Bars.LABEL_OFFSET_PX_ = 10;


/** @const @private {number} */
historian.Bars.LABEL_UNRELIABLE_OFFSET_PX_ = 20;


/**
 * The minimum px width for each bar line.
 * @const @private {number}
 */
historian.Bars.MIN_BAR_WIDTH_PX_ = 2;


/** @const @private {string} */
historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_ = 'unknown';


/** @const @private {string} */
historian.Bars.SELECTABLE_LEVEL_METRIC_CLASS_ = 'selectable-level-metric';


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
  // Horizontal line dividers between rows.
  this.renderDividerLines_();
  // Text labels for each of the series.
  this.renderLabels_();
  // Render the bar series.
  this.renderSeries_(this.getVisibleData_());
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
  this.updateSeries_();

  // Re-render divider lines and labels.
  this.renderDividerLines_();
  this.renderLabels_();
};


/**
 * Renders the labels of the series.
 * @private
 */
historian.Bars.prototype.renderLabels_ = function() {
  this.context_.svgChart.selectAll('.series-label-group').remove();

  var labelGroup = this.context_.svgChart.append('g')
      .attr('class', 'series-label-group')
      .attr('transform', 'translate(' +
            (-historian.Bars.LABEL_OFFSET_PX_) + ',0)');

  labelGroup.selectAll('.series-label')
      .data(this.groupsToRender_)
      .enter()
      .append('text')
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
      .attr('y', function(group) {
        // Note that labels are outside the translated clip rect.
        // So we need to add the offset.
        return this.getRowY(group.index + 0.5) +
            historian.Bars.ROW_LABEL_HEIGHT_PX / 2;
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

  labelGroup.selectAll('.' + historian.Bars.SELECTABLE_LEVEL_METRIC_CLASS_)
      .on('click', function(element) {
        this.levelData_.setLevel(element.name);
      }.bind(this));

  labelGroup.append('text')
      .attr('class', 'series-label unreliable')
      .text('* unreliable metric')
      .attr('y', this.context_.visSize[1] +
            historian.Bars.LABEL_UNRELIABLE_OFFSET_PX_);

  this.groupsToRender_.forEach(function(series) {
    var label = this.context_.svgChart
        .select('.series-label[name="' + series.name + '"]');
    label.classed('highlighted', !!this.highlightedMetrics_[series.name]);
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
  seriesGroups.attr('transform', function(series) {
        return 'translate(0,' + this.getRowY(series.index + .7) + ')';
      }.bind(this));
  seriesGroups.exit().remove();

  seriesGroups.selectAll('g')
      .data(function(d) {return d.series;})
      .enter().append('g')
      .attr('id', function(series) {
        // The series name is used instead of the row index,
        // as multiple series can be rendered on the same row.
        return historian.utils.toValidID('series_' + series.name);
      });

  var barHeight = this.getRowY(.3) - this.getRowY(.7);
  // For each series, draw a bar line for each data point.
  clusteredSeries.forEach(function(seriesGroup) {
    seriesGroup.series.forEach(function(series) {
      var g = this.context_.svgBars.select(
          '#' + historian.utils.toValidID('series_' + series.name));
      var bars = g.selectAll('.bar')
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
            .attr('height', barHeight);
      }
      bars.on('mouseover', function(bar) {
            this.hovered = {
              bar: bar,
              series: series
            };
          }.bind(this))
          .on('mouseleave', function() {
            this.hovered = null;
          }.bind(this));
      bars.attr('transform', function(bar) {
            return 'translate(' + this.context_.xScale(bar.startTime) + ',0)';
          }.bind(this))
          .attr('class', 'bar');

      var color = function(bar) {
        // Network connectivity is a special case of aggregated metric.
        // We want to show the value of greatest duration.
        if (series.name == historian.metrics.Csv.CONNECTIVITY) {
          var maxBar = bar.getMaxValue();
          var split = maxBar.value.split(':');
          return series.color(split[0]);
        }
        if (series.name == historian.metrics.Csv.FOREGROUND_PROCESS) {
          return series.color(bar.getMaxValue().value);
        }
        // Use count to determine color for aggregated stats.
        if (historian.metrics.isAggregatedMetric(series.name)) {
          return series.color(bar.clusteredCount);
        }
        // Color based on userspace wakelock classification.
        if (series.name == historian.metrics.KERNEL_UPTIME) {
          return series.color(bar.getMaxValue().wakelockCategory);
        }
        return series.color(bar.getMaxValue());
      };
      bars.style('fill', color)
          .attr('stroke', color);
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
  '<span style="color: darkred">',
  'Only the first app to acquire the wakelock is shown.',
  'Total wakelock duration is not attributed to only those apps listed.',
  'To enable full wakelock reporting, run:',
  'adb shell dumpsys batterystats --enable full-wake-history</span>'
];


/**
 * Adds the event listeners for the app selector.
 * @private
 */
historian.Bars.prototype.addAppSelectorListener_ = function() {
  $('#appSelector').on('change', this.displaySelectedApp_.bind(this));
};


/**
 * Updates the data binded to bar elements and redraws all the changed series.
 * @private
 */
historian.Bars.prototype.updateSeries_ = function() {
  var uid = null;
  var e = $('#appSelector');
  if (e.length) {
    var v = e.val();
    if (v) {
      uid = v;
    }
  }
  var filteredData = [];
  this.groupsToRender_.forEach(function(seriesGroup) {
    var allSeries = [];
    seriesGroup.series.forEach(function(series) {
      var values = /** @type {!Array<!historian.Entry>} */
          (series.values.filter(
              this.context_.inViewableRange.bind(this.context_)));
      if (uid && (series.name in historian.metrics.appSpecificMetrics)) {
        values = this.filterServices(values, /** @type {number} */(uid));
      }
      allSeries.push({
        'name': series.name,
        'type': series.type,
        'color': series.color,
        'values': values,
        'cluster': series.cluster
      });
    }, this);
    filteredData.push({
      'name': seriesGroup.name,
      'index': seriesGroup.index,
      'series': allSeries
    });
  }, this);

  this.renderSeries_(filteredData);
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
 * @param {!Array<historian.Entry>} data The data to filter.
 * @param {number} uid The uid to match.
 * @return {!Array<historian.AggregatedEntry>} matching data.
 */
historian.Bars.prototype.filterServices = function(data, uid) {
  var matching = [];

  data.forEach(function(d) {
    var values = [];

    var services = [];
    if (d.services) {
      services = d.services;
    } else {
      services.push(d.value);
    }

    services.forEach(function(s) {
      // Some entry types may have a stored UID (e.g. activity manager proc).
      if (s.uid == uid) {
        values.push(s);
        return;
      }
      // The value could be an AggregatedValue, which has both an ID and a
      // value, so check if the field exists. Otherwise just use the value.
      var serviceName = s.value || s;
      if (this.serviceMapper_.uid(serviceName) == uid) {
        // Keep the aggregated value with the ID for consistency.
        values.push(s);
      }
    }, this);
    if (values.length > 0) {
      matching.push({
        'startTime': d.startTime,
        'endTime': d.endTime,
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
  this.groupsToRender_.forEach(function(seriesGroup) {
    var allSeries = [];
    seriesGroup.series.forEach(function(series) {
      allSeries.push({
        'name': series.name,
        'type': series.type,
        'color': series.color,
        'values': series.values.filter(
            this.context_.inViewableRange.bind(this.context_)),
        'cluster': series.cluster
      });
    }, this);
    result.push({
      'name': seriesGroup.name,
      'index': seriesGroup.index,
      'series': allSeries
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
 * Displays a tooltip for the bar being hovered over.
 */
historian.Bars.prototype.showSeriesInfo = function() {
  this.hideSeriesInfo();
  if (!this.hovered)
    return;
  var series = this.hovered.series;
  var bar = this.hovered.bar;
  var loc = this.context_.location;
  var formattedLines = [
    historian.time.getDate(bar.startTime),
    historian.time.getTime(bar.startTime, loc) + ' - ' +
        historian.time.getTime(bar.endTime, loc)
  ];
  var humanReadable = {
    start: this.timeToDelta_[bar.startTime.toString()] ||
        historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_,
    end: this.timeToDelta_[bar.endTime.toString()] ||
        historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_
  };
  // If either the human readable start or end time were defined, show them.
  // If both were undefined, don't show anything.
  if (humanReadable.start != historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_ ||
      humanReadable.end != historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_) {
    formattedLines.push(humanReadable.start + ' to ' + humanReadable.end);
  }

  // Instant events have no associated duration.
  if (bar.activeDuration != 0) {
    formattedLines.push('<b>active duration:</b> ' +
        historian.time.formatDuration(bar.activeDuration));
  }

  var name = series.name;
  if (name == historian.metrics.Csv.WAKE_LOCK_HELD) {
    name = 'Wakelock held by at least 1 app';
  } else if (name == historian.metrics.Csv.WAKELOCK_IN) {
    name = 'Partial wakelock';
  } else if (name == historian.metrics.Csv.BATTERY_LEVEL) {
    name = 'Battery level';
  }

  formattedLines.push('<b>' + name + '</b>' + ': ' +
      bar.clusteredCount + ' occurences');

  // Boolean entries don't have associated values other than true.
  // Don't display values for wakelocks as it's only the
  // first wakelock acquired.
  if (series.type != 'bool' ||
      series.name == historian.metrics.Csv.SCREEN_ON) {
    formattedLines.push('');
    if (series.name == historian.metrics.Csv.CPU_RUNNING) {
      formattedLines.push('<b>' + 'Wakeup reason' + '</b>');
    } else if (series.name == historian.metrics.Csv.SCREEN_ON) {
      formattedLines.push('<b>' + 'Screen first turned on by' + '</b>');
    } else if (series.name == historian.metrics.Csv.WAKE_LOCK_HELD) {
      formattedLines.push('<b>' + 'Wakelock first acquired by' + '</b>');
    }

    // Display the values in order of duration.
    var sorted = bar.getSortedValues();
    switch (series.name) {
      case historian.metrics.KERNEL_UPTIME:
        this.displayKernelUptimeValues_(sorted, formattedLines);
        break;
      case historian.metrics.Csv.CPU_RUNNING:
        this.displayRunningValues_(sorted, formattedLines, bar);
        break;
      case historian.metrics.Csv.AM_PROC_START:
      case historian.metrics.Csv.AM_PROC_DIED:
      case historian.metrics.Csv.AM_LOW_MEMORY:
      case historian.metrics.Csv.AM_ANR:
        // Attach a div that the table can be appended to.
        formattedLines.push('<div id="values-container"></div>');
        break;
      default:
        this.displayValues_(series.name, sorted, formattedLines);
        break;
    }
  }

  this.hideSeriesInfo();
  this.tooltip_ = new historian.Tooltip(formattedLines, this.state_);
  var table;
  switch (series.name) {
    case historian.metrics.Csv.AM_PROC_START:
    case historian.metrics.Csv.AM_PROC_DIED:
      table = this.createAMProcTable_(bar.sorted);
      break;
    case historian.metrics.Csv.AM_LOW_MEMORY:
      table = this.createAMLowMemoryTable_(bar.sorted);
      break;
    case historian.metrics.Csv.AM_ANR:
      table = this.createAMANRTable_(bar.sorted);
      break;
  }
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
 * Creates a formatted line for each value and adds it to the given array.
 * @param {string} metricName Name of the metric the value belongs to.
 * @param {!Array<!historian.Value>} values
 *     The values to display, will be processed and added to the array of lines.
 * @param {!Array<string>} formattedLines The array of lines to add to.
 * @private
 */
historian.Bars.prototype.displayValues_ =
    function(metricName, values, formattedLines) {

  values.forEach(function(clusterValue) {
    var value = clusterValue.value;
    if (historian.metrics.isAggregatedMetric(metricName)) {
      value = value.value;
    }
    var formattedValue = historian.color.valueFormatter(metricName, value);
    var duration = historian.time.formatDuration(clusterValue.duration);
    var count = clusterValue.count + ' count';

    if (metricName == historian.metrics.Csv.WAKE_LOCK_HELD ||
        metricName == historian.metrics.Csv.SCREEN_ON ||
        metricName == historian.metrics.Csv.BATTERY_LEVEL) {
      // Don't show durations for userspace partial wakelocks or screen on
      // reasons since they will confuse people.
      // Battery level ticks also don't have durations.
      formattedLines.push(formattedValue + ': ' + count);
    } else {
      formattedLines.push(formattedValue + ': ' + duration + ', ' + count);
    }
  });

  if (metricName == historian.metrics.Csv.WAKE_LOCK_HELD) {
    formattedLines.push.apply(
        formattedLines, historian.Bars.WAKE_LOCK_WARNING_MSG_HTML_);
  }
};


/**
 * Displays the values for the running metric.
 *
 * It also displays the start time for each value (wakeup reason) in the
 * cluster.
 *
 * @param {!Array<!historian.Value>} values
 *     The values to display, will be processed and added to the array of lines.
 * @param {!Array<string>} formattedLines The array of lines to add to.
 * @param {!historian.data.ClusterEntry} cluster The cluster the value belongs
 *     to.
 * @private
 */
historian.Bars.prototype.displayRunningValues_ =
    function(values, formattedLines, cluster) {

  values.forEach(function(clusterValue) {
    var value = clusterValue.value.value;
    var formattedValue = historian.color.valueFormatter(
        historian.metrics.Csv.CPU_RUNNING, value);
    var duration = historian.time.formatDuration(clusterValue.duration);
    var count = clusterValue.count + ' count';

    formattedLines.push(formattedValue + ': ' + duration + ', ' + count);

    // Show the times for the wakeup reason.
    var times = cluster.getExtraInfo(value);
    formattedLines.push(times.map(function(t) {
      return historian.time.getTime(t.startTime, this.context_.location);
    }.bind(this)).join(', '));
  }, this);
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
    // The start or end time can be 0, so we display an empty string instead.
    var start = (v.startTime == 0) ? empty :
        historian.time.getTime(v.startTime, loc);
    var end = (v.endTime == 0) ? empty : historian.time.getTime(v.endTime, loc);
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
 * Creates a table for the activity manager ANR values.
 * @param {!Array<!historian.Entry>} entries The entries to display.
 * @return {!jQuery} The created table.
 * @private
 */
historian.Bars.prototype.createAMANRTable_ = function(entries) {
  var headRow = [
    'Time',
    'UID',
    'PID',
    'Flag',
    'Package Name',
    'Reason'
  ];
  var bodyRows = entries.map(function(e) {
    var v = e.value;
    var uid = (v.uid == 0) ? '' : v.uid.toString();
    return [
      historian.time.getTime(e.startTime, this.context_.location),
      uid,
      v.pid.toString(),
      v.flag,
      v.packageName,
      v.reason
    ];
  }.bind(this));
  return historian.tables.createTable(headRow, bodyRows);
};


/**
 * Creates a table for the activity manager low memory values.
 * @param {!Array<!historian.Entry>} entries The entries to display.
 * @return {!jQuery} The created table.
 * @private
 */
historian.Bars.prototype.createAMLowMemoryTable_ = function(entries) {
  var headRow = [
    'Time',
    'Num Processes'
  ];
  var bodyRows = entries.map(function(e) {
    return [
      historian.time.getTime(e.startTime, this.context_.location),
      e.value
    ];
  }.bind(this));
  return historian.tables.createTable(headRow, bodyRows);
};


/**
 * Kernel Uptime values are split into two categories - if they are cpu running
 * events with no intersection with any userspace wakelock, or those with
 * intersection.
 *
 * Displays each category separately.
 *
 * @param {!Array<!historian.Value>} values
 *     The values to display, will be processed and added to the array of lines.
 * @param {!Array<string>} formattedLines The array of lines to add to.
 * @private
 */
historian.Bars.prototype.displayKernelUptimeValues_ =
    function(values, formattedLines) {

  var withUserspace = [];
  var withoutUserspace = [];

  // Split the kernel uptime values into those with userspace wakelock,
  // and those without, keeping the order.
  values.forEach(function(v) {
    var category = v.value.wakelockCategory;
    var formattedValue = {
      'count': v.count,
      'duration': v.duration,
      'value': v.value.wakeReason
    };
    if (category == historian.metrics.KERNEL_UPTIME_WITH_USERSPACE) {
      withUserspace.push(formattedValue);
    } else {
      withoutUserspace.push(formattedValue);
    }
  });
  if (withUserspace.length > 0) {
    formattedLines.push(
        '<b>' +
        'Kernel only uptime during CPU running with ' +
        'userspace wakelocks (wakeup reasons)' +
        '</b>'
    );
  }
  this.displayValues_(
      historian.metrics.Csv.CPU_RUNNING, withUserspace, formattedLines);

  if (withoutUserspace.length > 0) {
    formattedLines.push(
        '<b>' +
        'Kernel only uptime during CPU running with ' +
        'no userspace wakelocks acquired (wakeup reason)' +
        '</b>'
    );
  }
  this.displayValues_(
      historian.metrics.Csv.CPU_RUNNING, withoutUserspace, formattedLines);
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
