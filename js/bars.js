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

goog.require('goog.array');
goog.require('goog.string');
goog.require('historian.Context');
goog.require('historian.Tooltip');
goog.require('historian.appstats');
goog.require('historian.color');
goog.require('historian.constants');
goog.require('historian.data');
goog.require('historian.historianV2Logs');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.sysui');
goog.require('historian.tables');
goog.require('historian.time');
goog.require('historian.utils');



// TODO: replace with goog.module.
goog.scope(function() {


/** @private @const {string} */
var RENDERED_BAR_ = '.bar';


/** @private @const {string} */
var SHOW_BARS_TOGGLE_ = '.show-bars';


/** @private @const {string} */
var REGEXP_FILTER_ = 'input[name="regexp-search"]';


/**
 * Maximum number of rows to display in the tooltip table to avoid lagging.
 * @private @const {number}
 */
var ROW_MAX_ = 100;



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

  /** @private {?historian.Tooltip} */
  this.legendTooltip_ = null;


  /** @private {?jQuery} */
  this.container_ = opt_container || null;

  /** @private {?d3.selection} */
  this.d3Container_ = this.container_ ?
      d3.select(/** @type {Element} */ (this.container_.get(0))) : null;

  /** @private {!d3.Drag} */
  this.drag_ = d3.drag()
      .on('start', this.onDragStart_.bind(this))
      // d3 passes the dragged element via 'this', so we can't bind Bars as it
      // would override the element reference we need in these 2 functions.
      .on('drag', this.createOnDragHandler_(this))
      .on('end', this.createDragEndHandler_(this))
      .subject({x: 0, y: 0});

  /** @private {boolean} */
  this.dragging_ = false;

  this.addAppSelectorListener_();

  if (this.container_) {
    this.levelData_.registerListener(function() {
      // Change opacity of bars based on whether we're showing the rate of
      // change. JQuery can't toggle class on SVG directly, so add it to the
      // graph div.
      this.container_.find('.graph')
          .toggleClass('faded', this.levelData_.getConfig().isRateOfChange);
    }.bind(this));
    this.container_.find(SHOW_BARS_TOGGLE_).change(function(event) {
      this.container_.find(RENDERED_BAR_)
          .toggle($(event.target).is(':checked'));
    }.bind(this));

    this.container_.find(REGEXP_FILTER_).on('input',
        function(event) {
          var input = $(event.target);
          var isValid = historian.utils.isValidRegExp(
              /** @type {string} */ (input.val()));
          input.toggleClass('error', !isValid);
          if (isValid) {
            this.updateSeries_();
          }
        }.bind(this));
  }
};


/**
 * Height of row label font size.
 * @const {number}
 */
historian.Bars.ROW_LABEL_HEIGHT_PX = 10;


/** @const @private {number} */
historian.Bars.LABEL_HEADING_X_OFFSET_PX_ = 0;


/** @const @private {number} */
historian.Bars.LABEL_X_OFFSET_PX_ = historian.Context.MARGINS.LEFT - 20;


/** @const @private {number} */
historian.Bars.LABEL_Y_OFFSET_PX_ = 20;


/** @const @private {number} */
historian.Bars.REMOVE_OFFSET_PX_ = historian.Context.MARGINS.LEFT - 15;


/**
 * The minimum px width for each bar line.
 * @const @private {number}
 */
historian.Bars.MIN_BAR_WIDTH_PX_ = 2;


/** @const @private {string} */
historian.Bars.HUMAN_READABLE_TIME_UNKNOWN_ = 'unknown';


/** @const @private {string} */
historian.Bars.REMOVE_METRIC_CLASS_ = '.remove';


/**
 * Handles drag start events.
 * @private
 */
historian.Bars.prototype.onDragStart_ = function() {
  if (!this.d3Container_) {
    return;
  }
  this.dragging_ = true;
  d3.event.sourceEvent.stopPropagation();
  // Hide the remove icons, otherwise they might flicker while dragging.
  this.d3Container_.selectAll(historian.Bars.REMOVE_METRIC_CLASS_)
      .style('visibility', 'hidden');
};


/**
 * Creates the handler for on drag events.
 * @param {!historian.Bars} bars
 * @return {!Function} Drag handler.
 * @private
 */
historian.Bars.prototype.createOnDragHandler_ = function(bars) {
  return function(d) {
    if (!bars.d3Container_) {
      return;
    }
    // d3.event.y is the y amount the user has dragged from its
    // original position.
    var rowsMoved = bars.rowsToMove_(d.index, d3.event.y);
    // The y-translate to add to the group being dragged.
    var draggedTranslate = rowsMoved * bars.getRowHeight_();
    var destIndex = d.index - rowsMoved;

    var min = Math.min(d.index, destIndex);
    var max = Math.max(d.index, destIndex);

    // Add a y translate to affected rows and reset other rows to 0.
    bars.barData_.getData().forEach(function(group) {
      var yTranslate = 0;

      // If the group is between the source and destination rows of the
      // group being dragged, we need to add a y-translate.
      if (group.index >= min && group.index <= max) {
        if (d.index == group.index) {
          // This is the group being dragged.
          yTranslate = draggedTranslate;
        } else {
          // We need to move this group one row in the opposite direction
          // of the group being dragged.
          yTranslate = bars.getRowHeight_();
          if (draggedTranslate > 0) {
            yTranslate *= -1;
          }
        }
      }

      var transform = 'translate(' + 0 + ',' + yTranslate + ')';
      // Move the bars in the group.
      var groupToMove = bars.d3Container_.selectAll('#series' + group.index);
      groupToMove.attr('transform', transform);
      // Move the group name label.
      bars.d3Container_
          .selectAll('.series-label')
          .filter('.index' + group.index)
          .attr('transform', transform);
    });
  };
};


/**
 * Creates the handler for drag end events.
 * @param {!historian.Bars} bars
 * @return {!Function} Drag handler.
 * @private
 */
historian.Bars.prototype.createDragEndHandler_ = function(bars) {
  return function(d) {
    if (!bars.d3Container_) {
      return;
    }
    // Snap to the closest row to where we finished dragging.
    var rowsMoved = bars.rowsToMove_(d.index, d3.event.y);
    // We need to subtract rowsMoved, as a higher index is rendered higher,
    // but that corresponds to a negative y translate and rowsMoved.
    bars.barData_.modifyIndex(d.source, d.name, d.index - rowsMoved);

    bars.d3Container_.selectAll(historian.Bars.REMOVE_METRIC_CLASS_)
        .style('visibility', 'visible');
    bars.dragging_ = false;
  };
};


/**
 * Returns the number of rows to move by.
 * @param {number} originalIndex The index of a series. The higher the index,
 *     the higher in the graph it is rendered.
 * @param {number} yDragged The amount dragged, negative if dragging up,
 *     positive if dragging down.
 * @return {number} The number of rows to move, negative if to move up,
 *     positive if to move down.
 * @private
 */
historian.Bars.prototype.rowsToMove_ = function(originalIndex, yDragged) {
  var rows = Math.round(yDragged / this.getRowHeight_());
  // A higher index is rendered higher, so we need to subtract the y offset.
  var toIndex = originalIndex - rows;
  // Don't let the user drag beyond the top or bottom rows.
  toIndex = Math.max(0, Math.min(this.barData_.getMaxIndex(), toIndex));
  return originalIndex - toIndex;
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
    var label = this.context_.svg
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
  if (this.legendTooltip_) {
    this.legendTooltip_.hide();
  }
};


/**
 * Renders the labels and help icons for each group.
 * @private
 */
historian.Bars.prototype.renderLabels_ = function() {
  this.context_.svg.selectAll('.series-label-group').remove();

  var labelGroup = this.context_.svg.append('g')
      .attr('class', 'series-label-group')
      .attr('transform', 'translate(0,' + historian.Context.MARGINS.TOP + ')');

  var enterGroups = labelGroup.selectAll('.series-label')
      .data(this.groupsToRender_)
      .enter()
      .append('g')
      .merge(labelGroup)
      .attr('transform', function(group) {
        // The divider lines are drawn using group index, however contents
        // are one level above them.
        return 'translate(0,' + this.getRowY(group.index + 1) + ')';
      }.bind(this));

  var hideLegend = function() {
    if (this.legendTooltip_) {
      this.legendTooltip_.hide();
      this.legendTooltip_ = null;
    }
  }.bind(this);

  var showLegend = function(group) {
    hideLegend();
    if (group.source == historian.historianV2Logs.Sources.HEADING ||
        this.dragging_) {
      return;
    }
    var logSources = {};
    group.series.forEach(function(series) {
      if (series.type != historian.metrics.UNAVAILABLE_TYPE) {
        logSources[series.source] = true;
      }
    });
    var lines = [
      '<b>' + group.name + '</b>',
      'From logs: ' + Object.keys(logSources).join(', ')
    ];
    var desc = historian.metrics.descriptors[group.name];
    if (desc) {
      // Text help descriptor.
      lines.push(desc);
    }
    // Display each legend entry on a separate row.
    this.barData_.getLegend(group.name).forEach(function(entry) {
      var rectHtml = $('<div/>', {
        // We'll get build errors if class isn't in quotes, because it's
        // a reserved keyword.
        'class': entry.isCircle ? 'legend-item circle' : 'legend-item',
        css: {
          backgroundColor: entry.color
        }
      }).prop('outerHTML');  // Convert the div to HTML.
      lines.push(rectHtml + entry.value);
    });
    this.legendTooltip_ =
        new historian.Tooltip(lines, this.state_, 'help-tooltip');
  }.bind(this);

  var rowHeight = this.getRowHeight_();
  // Create an invisible rect below the group labels and remove icons,
  // so the remove icon doesn't disappear as the user mouses between
  // the label and icon.
  enterGroups.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', historian.Context.MARGINS.LEFT)
      .attr('height', rowHeight)
      .attr('fill-opacity', 0);

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
        if (group.source == historian.historianV2Logs.Sources.HEADING) {
          classes += ' heading';
        }
        classes += ' index' + group.index;
        return classes;
      })
      // Note that labels are outside the translated clip rect.
      // So we need to add the offset.
      .attr('x', function(group) {
        return group.source == historian.historianV2Logs.Sources.HEADING ?
            historian.Bars.LABEL_HEADING_X_OFFSET_PX_ :
            historian.Bars.LABEL_X_OFFSET_PX_;
      })
      .attr('y', function(group) {
        // Position of text refers to the bottom of the text.
        return (rowHeight / 2) + (historian.Bars.ROW_LABEL_HEIGHT_PX / 2);
      }.bind(this))
      .text(function(group) {
        switch (group.name) {
          case historian.metrics.Csv.BACKGROUND_COMPILATION:
            return 'Background compilation (dex2oat)';
          case historian.metrics.Csv.WAKELOCK_IN:
            return 'Userspace wakelock (all)';
          case historian.metrics.Csv.WAKE_LOCK_HELD:
            return 'Userspace wakelock';
          case historian.metrics.Csv.ACTIVE_BROADCAST_FOREGROUND:
            return 'Foreground';
          case historian.metrics.Csv.ACTIVE_BROADCAST_BACKGROUND:
            return 'Background';
          case historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND:
          case historian.metrics.Csv.BROADCAST_DISPATCH_FOREGROUND:
          case historian.metrics.Csv.BROADCAST_ENQUEUE_BACKGROUND:
          case historian.metrics.Csv.BROADCAST_DISPATCH_BACKGROUND:
            // Delete 'Broadcast ' as it's already in the timeline heading.
            return group.name.substr(group.name.indexOf(' ') + 1);
        }
        if (group.name in historian.metrics.unreliableMetrics) {
          return group.name + ' * ';
        }
        if (group.name in historian.metrics.logcatMetrics) {
          return group.name + ' (logcat)';
        }
        return group.name;
      })
      .on('mouseover', function(group) { showLegend(group); })
      .on('mouseout', function(group) { hideLegend(); })
      .call(this.drag_);

  if (historian.utils.isForeignObjectSupported()) {
    // Add buttons allowing users to remove individual series. There are some
    // browsers that don't support foreignObject (eg. IE 11 and below), so we
    // have to check that the browser supports it, otherwise, the system will
    // experience a null error if we try to use this on that browser.
    enterGroups.append('svg:foreignObject')
        .attr('x', historian.Bars.REMOVE_OFFSET_PX_)
        .attr('y', rowHeight / 2)
        .attr('font-size', '1.25em')
        .style('line-height', 0)
        .append('xhtml:span')
        .html('&times')
        .attr('class', historian.Bars.REMOVE_METRIC_CLASS_.slice(1))
        .style('opacity', 0)  // Not shown until the series group is hovered on.
        .on('click', function(group) {
          this.barData_.removeGroup(group.source, group.name);
        }.bind(this));
  }

  // Show or hide the remove button depending on whether the series group
  // is being hovered on.
  enterGroups.on('mouseover', function(group) {
    if (group.source == historian.historianV2Logs.Sources.HEADING) {
      return;  // Disable removing headings for now.
    }
    d3.select(this).select(historian.Bars.REMOVE_METRIC_CLASS_)
        .style('opacity', 1);
  }).on('mouseout', function(group) {
    d3.select(this).select(historian.Bars.REMOVE_METRIC_CLASS_)
        .style('opacity', 0);
  });

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
        .attr('x', historian.Bars.LABEL_X_OFFSET_PX_)
        .attr('y', this.context_.visSize[1] +
            historian.Bars.LABEL_Y_OFFSET_PX_ * (idx + 1));
  }, this);

  this.groupsToRender_.forEach(function(group) {
    var label = this.context_.svg
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
        return historian.metrics.hash(series) + series.index;
      });
  var mergedSeriesGroups = seriesGroups.enter().append('g')
      .attr('id', function(series) {
        return 'series' + series.index;
      })
      .attr('class', 'bars-group')
      .merge(seriesGroups);
  seriesGroups.exit().remove();

  var seriesElems = mergedSeriesGroups.selectAll('g')
      .data(function(d) {return d.series;});
  seriesElems.enter().append('g')
      .attr('id', function(series) {
        // The series hash is used instead of the row index,
        // as multiple series can be rendered on the same row.
        var seriesHash = historian.metrics.hash(series);
        return historian.utils.toValidID('series_' + seriesHash);
      })
      .merge(seriesElems);
  seriesElems.exit().remove();

  var barHeight = this.getRowY(.3) - this.getRowY(.7);
  var rowHeight = this.getRowHeight_();
  // For each series, draw a bar line for each data point.
  clusteredSeries.forEach(function(seriesGroup) {
    seriesGroup.series.forEach(function(series) {
      var seriesHash = historian.metrics.hash(series);
      var seriesId = '#' + historian.utils.toValidID('series_' + seriesHash);
      var g = this.context_.svgBars.select(seriesId);
      // Unavailable events simply denote when a log is unavailable, and should
      // be rendered differently from real events.
      var isUnavailable = series.type == historian.metrics.UNAVAILABLE_TYPE;

      var idx = seriesGroup.index;
      var y = this.getSeriesTranslate(series, idx);
      g.attr('transform', 'translate(0,' + y + ')');

      var bars = g.selectAll(RENDERED_BAR_)
          .data(series.values, function(bar) {
            return bar.startTime + '_' + bar.clusteredCount;
          });
      var merged = null;
      if (historian.metrics.renderAsCircles(series)) {
        // Don't want the circles getting too big, so the values are capped.
        var maxValue = 20;
        var rowScale = d3.scaleLinear()
            .domain([1, maxValue])
            .range([barHeight / 4, barHeight]);
        merged = bars.enter().append('circle').merge(bars)
            .attr('r', function(bar) {
              if (series.type == historian.metrics.ERROR_TYPE) {
                return rowScale(maxValue);
              }
              return rowScale(Math.min(bar.clusteredCount, maxValue));
            });
      } else {
        merged = bars.enter().append('rect').merge(bars)
            .attr('width', function(bar) {
              return this.drawAdjustedEndTime_.bind(this, bar)() -
                  this.context_.xScale(bar.startTime);
            }.bind(this))
            .attr('height', isUnavailable ? rowHeight : barHeight);
      }

      // Show custom context menu options.
      var options = { copy: {name: 'Copy Tooltip Contents to Clipboard'} };
      var containerSelector = this.container_ ? this.container_.selector : '';
      var location = this.context_.location;
      // Make a copy of the function bound to 'this', as the contextMenu
      // callback will overwrite 'this'.
      var tooltipTextFn = this.tooltipText_.bind(this);
      // Show custom context menu options.
      $.contextMenu({
        selector: containerSelector + ' ' + seriesId + ' .bar',
        callback: function(key, option) {
          var jQueryElem = $(this).get()[0];
          // Get the cluster data bound by d3.
          var cluster = d3.select(jQueryElem).data()[0];
          switch (key) {
            case 'copy':
              var text = tooltipTextFn(series, cluster, location, false)
                  .join('\n');
              historian.utils.copyToClipboard(text);
              break;
            default:
              console.log('context menu unknown key: ' + key);
          }
        },
        items: options
      });
      merged.on('mouseover', function(bar) {
            this.hovered = {
              bar: bar,
              series: series
            };
          }.bind(this))
          .on('mouseleave', function() {
            this.hideSeriesInfo();
            this.hovered = null;
          }.bind(this));
      merged.attr('transform', function(bar) {
            return 'translate(' + this.context_.xScale(bar.startTime) + ',0)';
          }.bind(this))
          .attr('class', isUnavailable ? 'bar unavailable' : 'bar');

      var color = function(bar) {
        switch (series.name) {
          case historian.metrics.Csv.APP_TRANSITIONS:
            var value = 'Unknown';
            // Color based on whether it is a warm or cold process start.
            // Find the highest duration transition that has PROCESS_RUNNING
            // info.
            bar.getSortedValues().some(function(clusterValue) {
              var transition = clusterValue.value;
              if (historian.sysui.Transition.PROCESS_RUNNING in transition) {
                var event =
                    transition[historian.sysui.Transition.PROCESS_RUNNING];
                value = event.value.split(',')[1];
                return true;
              }
              return false;
            });
            switch (value) {
              case 'true':
                value = 'Warm process start';
                break;
              case 'false':
                value = 'Cold process start';
                break;
              default:
                console.log('got unknown PROCESS_RUNNING value: ' + value);
            }
            return series.color(value);
          // Network connectivity is a special case of aggregated metric.
          // We want to show the value of greatest duration.
          case historian.metrics.Csv.CONNECTIVITY:
            var split = bar.getMaxValue().split(':');
            return series.color(split[0]);

          case historian.metrics.Csv.BACKGROUND_COMPILATION:
            // Color based on whether most of the log messages starts with
            // 'Compilation', 'Verification' or some other log line.
            // We can't use bar.getMaxValue as each log line is counted
            // as a different unique value.
            var typeToCount = {};
            bar.getSortedValues().forEach(function(clusterValue) {
              var type = clusterValue.value.split(' ')[0];
              if (type != 'Compilation' && type != 'Verification') {
                type = 'Other';
              }
              if (!(type in typeToCount)) {
                typeToCount[type] = 1;
              } else {
                typeToCount[type]++;
              }
            });
            var maxType = Object.keys(typeToCount).reduce(function(max, cur) {
              if (!max) {
                return cur;
              }
              return typeToCount[cur] > typeToCount[max] ? cur : max;
            }, null);
            return series.color(maxType);

          case historian.metrics.Csv.FOREGROUND_PROCESS:
            return series.color(bar.getMaxValue());

          case historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND:
          case historian.metrics.Csv.BROADCAST_DISPATCH_FOREGROUND:
          case historian.metrics.Csv.BROADCAST_ENQUEUE_BACKGROUND:
          case historian.metrics.Csv.BROADCAST_DISPATCH_BACKGROUND:
            // Since these events are aggregated, a long event might be sliced
            // up into many small parts, which leads to a small max duration
            // returned by bar.getMaxValue. Instead we get all the original
            // events and calculate the max duration based on that, so any
            // long broadcast event will have all its sliced up parts colored
            // the right color.
            var ids = bar.getIds();
            var maxDur = ids.reduce(function(maxSoFar, id) {
              var entry = series.originalValues[id];
              return Math.max(maxSoFar, entry.endTime - entry.startTime);
            }, 0);
            return series.color(maxDur);

          // Color based on userspace wakelock classification.
          case historian.metrics.KERNEL_UPTIME:
            return series.color(bar.getMaxValue().wakelockCategory);

          // Color based on wearable RPC event type.
          case historian.metrics.Csv.WEARABLE_RPC:
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
        // Use count to determine color for aggregated stats.
        if (historian.metrics.isAggregatedMetric(series.name)) {
          return series.color(bar.clusteredCount);
        }
        return series.color(bar.getMaxValue());
      };
      var showBars = this.container_.find(SHOW_BARS_TOGGLE_).is(':checked');
      // Access the pattern embedded in this svg.
      var hatchPattern = '#' + this.container_.find('svg pattern').attr('id');

      merged.style('fill', isUnavailable ? 'url(' + hatchPattern + ')' : color)
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
      .selectAll('.series-divider').data(this.groupsToRender_.filter(
      function(group) {
        return group.source != historian.historianV2Logs.Sources.HEADING;
      }));  // Don't add a line after headings for aesthetic purposes.
  lines.enter().append('line')
      .attr('class', 'series-divider')
      .merge(lines)
      .attr('x1', 0)
      .attr('x2', historian.Context.MARGINS.LEFT +
          this.context_.visSize[historian.constants.WIDTH])
      .attr('y1', function(group) {
        return this.getRowY(group.index);
      }.bind(this))
      .attr('y2', function(group) {
        return this.getRowY(group.index);
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
  var regexp = /** @type {string} */ (
      this.container_.find(REGEXP_FILTER_).val());

  this.groupsToRender_.forEach(function(seriesGroup) {
    var allSeries = [];
    seriesGroup.series.forEach(function(series) {
      var values = historian.utils.inTimeRange(
          timeRange.min, timeRange.max, series.values);
      if (series.type != historian.metrics.UNAVAILABLE_TYPE && regexp &&
          historian.utils.isValidRegExp(regexp)) {
        values = this.filterByRegexp_(series.name, values, regexp);
      }
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
      series: allSeries,
      source: seriesGroup.source
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
 * Returns entries that pass the given criteria function, preserving the
 * structure of the original array. e.g. if the original array is of
 * AggregatedEntry, the resulting array will also be of AggregatedEntry.
 *
 * @param {!Array<(!historian.Entry|!historian.AggregatedEntry)>} data
 *     The data to filter.
 * @param {function(!historian.Entry) : boolean} callback Function to
 *     call for each value. If true, will be included in the final output.
 * @return {!Array<!historian.Entry|!historian.AggregatedEntry>} The matching
 *     data.
 * @private
 */
historian.Bars.prototype.filter_ = function(data, callback) {
  var matching = [];

  data.forEach(function(d) {
    // We handle these entries in 2 distinct cases based on the entry type,
    // as we want the filtered entries to match the original type.

    if (d.services) {
      var filtered = d.services.filter(callback);
      if (filtered.length > 0) {
        matching.push({
          startTime: d.startTime,
          endTime: d.endTime,
          services: filtered
        });
      }
    } else if (callback(/** @type {!historian.Entry} */(d))) {
      matching.push(d);
    }
  }, this);
  return matching;
};


/**
 * Returns entries that match the given regexp.
 * @param {string} series Name of the series.
 * @param {!Array<(!historian.Entry|!historian.AggregatedEntry)>} data
 *     The data to filter.
 * @param {string} regexp The regexp to match.
 * @return {!Array<!historian.Entry|!historian.AggregatedEntry>} The matching
 *     data.
 * @private
 */
historian.Bars.prototype.filterByRegexp_ = function(series, data, regexp) {
  return this.filter_(data, function(entry) {
    var values = [];
    var value = historian.color.valueFormatter(series, entry.value).value;
    if (typeof value == 'number') {
      value = entry.value.toString();

    // Handle historian.KernelUptimeValue.
    } else if (value.hasOwnProperty('wakeReason')) {
      value = value.wakeReason;

    // Handle historian.AMProcValue.
    } else if (value.hasOwnProperty('logLine')) {
      value = value.logLine;
    }
    if (typeof value != 'string') {
      return false;
    }
    values.push(value);
    // It's possible the user wants to match against the translated text rather
    // than the numerical codes.
    if (series.match(/^sysui/) != null) {
      values.push(entry.value.replace(
          new RegExp(/^\d+/), historian.metrics.decodeSystemUiEvent));
    }
    // Case insensitive matching.
    var matchRegexp = function(value) {
      return value.match(new RegExp(regexp, 'i')) != null;
    };
    return values.some(matchRegexp);
  });
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
  var matching = this.filter_(data, function(entry) {
    return entry.uid == uid;
  });
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
  var minDuration = Math.round(historian.Bars.MIN_BAR_WIDTH_PX_ * msPerPixel);
  if (d.activeDuration < minDuration) {
    adjustedEndTime = d.startTime + minDuration;
  }
  return this.context_.xScale(adjustedEndTime);
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
    // The cluster's max value is a comma delimited string of log names.
    var msg = 'The ' + cluster.getMaxValue() + ' log containing ' +
        historian.metrics.baseMetric(series.type, series.name) +
        ' events does not begin until ' + endTime + '.';
    return [msg];
  }

  var name = series.name;
  switch (name) {
    case historian.metrics.Csv.WAKE_LOCK_HELD:
      name = 'Wakelock held by at least 1 app';
      break;
    case historian.metrics.Csv.WAKELOCK_IN:
      name = 'Partial wakelock';
      break;
  }

  var formattedLines = [
    this.bold_(name, toHtml),
    historian.time.getDate(cluster.startTime, loc),
    historian.time.getTime(cluster.startTime, loc) + ' - ' + endTime
  ];
  var startTime = cluster.startTime;
  // Long wakelock events are modified on the Go side to start a minute earlier
  // than the recorded event start time. We need to add this extra minute
  // to get the correct human readable timestamp.
  if (name == historian.metrics.Csv.LONG_WAKELOCK) {
    startTime += 60 * historian.time.MSECS_IN_SEC;
  }
  var humanReadable = {
    start: this.timeToDelta_[startTime.toString()] ||
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

  formattedLines.push(cluster.clusteredCount + ' occurences');

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
  if (!toHtml) {
    formattedLines.push('');
    var res = this.getTable_(series, cluster);
    if (res) {
      var table = historian.tables.createTable(res.header, res.body);
      formattedLines.push(historian.tables.toString(table));
    }
  } else {
    // Attach a div that the table can be appended to.
    // The table shouldn't be appended here as we may just want the text
    // output for copying the tooltip.
    formattedLines.push('<div id="values-container"></div>');
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
  var res = this.getTable_(series, bar);
  if (res) {
    var tableDiv = $('#values-container');
    $('<div />').html('<br>')  // Force a new line.
        .insertBefore(tableDiv);
    if (res.body.length > ROW_MAX_) {
      // Limit the number of rows displayed in the tooltip to reduce lag.
      // Those rows are probably off screen anyway.
      $('<div />')
          .html('Tooltip contents truncated to first ' + ROW_MAX_ + ' rows')
          .insertBefore(tableDiv);
      res.body = res.body.slice(0, ROW_MAX_);
    }
    var table = historian.tables.createTable(res.header, res.body);
    $(table).addClass('values-table');
    tableDiv.append(table);
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
 * @return {?{header: ?historian.TableRow, body: !Array<!historian.TableRow>}}
 *     The table header and body.
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
    // TODO: modify these to be handled in createSortedTable.
    case historian.metrics.Csv.AM_PROC_START:
    case historian.metrics.Csv.AM_PROC_DIED:
      return this.createAMProcTable_(cluster.sorted);
    case historian.metrics.Csv.APP_TRANSITIONS:
      return this.createTransitionsTable_(series, cluster);
    case historian.metrics.Csv.ACTIVE_BROADCAST_FOREGROUND:
    case historian.metrics.Csv.ACTIVE_BROADCAST_BACKGROUND:
    case historian.metrics.Csv.BROADCAST_ENQUEUE_BACKGROUND:
    case historian.metrics.Csv.BROADCAST_DISPATCH_BACKGROUND:
    case historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND:
    case historian.metrics.Csv.BROADCAST_DISPATCH_FOREGROUND:
      return this.createBroadcastsTable_(series, cluster);
    case historian.metrics.Csv.BACKGROUND_COMPILATION:
    case historian.metrics.Csv.CHOREOGRAPHER_SKIPPED:
    case historian.metrics.Csv.GC_PAUSE_BACKGROUND_PARTIAL:
    case historian.metrics.Csv.GC_PAUSE_BACKGROUND_STICKY:
    case historian.metrics.Csv.GC_PAUSE_FOREGROUND:
    case historian.metrics.Csv.STRICT_MODE_VIOLATION:
      return this.createSortedTable_(series.name, cluster);
    default:
      if (series.source == historian.historianV2Logs.Sources.EVENT_LOG) {
        return this.createSortedTable_(series.name, cluster);
      }
      return this.valuesToTable_(
          series, cluster.getSortedValues(
          series.name == historian.metrics.KERNEL_UPTIME), cluster);
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
 * @return {{header: ?historian.TableRow, body: !Array<!historian.TableRow>}}
 *     The table header and body.
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
    headRow.push('Actual event times');
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
      var formattedTimes = [];
      for (var id in clusterValue.ids) {
        var parsedId = parseInt(id, 10);
        var originalEntry = series.originalValues[parsedId];
        duration += originalEntry.endTime - originalEntry.startTime;
        formattedTimes.push(goog.string.subs('[%s - %s]',
            historian.time.getTime(originalEntry.startTime,
                this.context_.location),
            historian.time.getTime(originalEntry.endTime,
                this.context_.location)));
      }
      if (hasDuration) {
        tblRow.push(historian.time.formatDuration(duration));
      }
      tblRow.push(formattedTimes.join(', '));

    } else if (hasDuration) {
      tblRow.push(historian.time.formatDuration(clusterValue.duration));
    }

    // Populate the extra column if the series is CPU_RUNNING or KERNEL_UPTIME.
    if (series.name == historian.metrics.Csv.CPU_RUNNING) {
      var wakeupReasonTimes = clusterValue.extra;
      var formattedTimes = wakeupReasonTimes.map(function(t) {
        return historian.time.getTime(t.endTime, this.context_.location);
      }.bind(this)).join(', ');  // Comma separated wakeup reason times.
      tblRow.push(formattedTimes);

    } else if (series.name == historian.metrics.KERNEL_UPTIME) {
      var hasUserspace = clusterValue.value.wakelockCategory ==
          historian.metrics.KERNEL_UPTIME_WITH_USERSPACE;
      tblRow.push(hasUserspace ? 'y' : 'n');
    }
    return tblRow;
  }, this);
  return {header: headRow, body: bodyRows};
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
 * @return {{header: ?historian.TableRow, body: !Array<!historian.TableRow>}}
 *     The table header and body.
 * @private
 */
historian.Bars.prototype.createAMProcTable_ = function(entries) {
  var headRow = ['Time', 'UID', 'PID', 'Process', 'Component'];
  var empty = goog.string.repeat(' ', historian.Bars.AM_TIMESTAMP_WIDTH);
  var loc = this.context_.location;
  var bodyRows = entries.map(function(e) {
    var parts = e.value.logLine.split(',');
    // The start or end time can be unknown, so we display an empty string
    // instead.
    var start = e.value.startTime == historian.constants.UNKNOWN_TIME ? empty :
        historian.time.getTime(e.value.startTime, loc);
    var end = e.value.endTime == historian.constants.UNKNOWN_TIME ? empty :
        historian.time.getTime(e.value.endTime, loc);
    var time = goog.string.subs('%s - %s', start, end);

    // am_proc_died log lines have fewer parts than am_proc_start. If an
    // am_proc_died event has a corresponding am_proc_start_event, the value
    // of the log line will be the same as the am_proc_start.
    // Expected format:
    //   am_proc_start: User,PID,UID,Process Name,Type,Component
    //    am_proc_died: User,PID,Process Name
    return parts.length >= 6 ? [time, parts[2], parts[1], parts[3], parts[5]] :
        [time, '' /** no uid */, parts[1], parts[2], '' /** no component */];
  });
  return {header: headRow, body: bodyRows};
};


/**
 * Creates a table showing app transition events.
 * @param {!historian.ClusteredSeriesData} series
 * @param {!historian.data.ClusterEntry} cluster The cluster to display.
 * @return {{header: ?historian.TableRow, body: !Array<!historian.TableRow>}}
 *     The table header and body.
 * @private
 */
historian.Bars.prototype.createTransitionsTable_ = function(series, cluster) {
  var headRow = ['Time', 'Transition type', 'Value'];
  // Each transition may contain any subset of these events.
  var rowOrder = [
    historian.sysui.Transition.COMPONENT_NAME,
    historian.sysui.Transition.REASON,
    historian.sysui.Transition.PROCESS_RUNNING,
    historian.sysui.Transition.DEVICE_UPTIME_SECONDS,
    historian.sysui.Transition.DELAY_MS,
    historian.sysui.Transition.STARTING_WINDOW_DELAY_MS,
    historian.sysui.Transition.WINDOWS_DRAWN_DELAY_MS
  ];

  // Transitions will be aggregated, as they may overlap. Instead of showing
  // details of the potentially sliced up part, get the original unsliced
  // entries. Aggregated ids correspond to the index into the originalValues
  // array.
  var originalEntryIdxs = cluster.getIds();

  var bodyRows = [];
  originalEntryIdxs.forEach(function(origIdx, n) {
    var transition = series.originalValues[origIdx].value;

    rowOrder.forEach(function(transitionId) {
      if (transitionId in transition) {
        var event = transition[transitionId];
        var parts = event.value.split(',');  // e.g. 321,1234
        // e.g. STARTING_WINDOW_DELAY_MS
        var name = historian.metrics.decodeSystemUiEvent(parts[0]);
        var desc = historian.sysui.TransitionDesc[parts[0]];
        var value = transitionId == historian.sysui.Transition.REASON ?
            historian.sysui.TransitionReason[parts[1]] : parts[1];
        bodyRows.push([
          historian.time.getTime(event.startTime, this.context_.location),
          desc ? goog.string.subs('%s\n%s', name, desc) : name,
          value
        ]);
      }
    }, this);
    if (n < originalEntryIdxs.length - 1) {
      bodyRows.push([' ', '', '']);  // Empty row to separate transitions.
    }
  }, this);
  return {header: headRow, body: bodyRows};
};


/**
 * Creates a table showing events in the given cluster sorted by start time.
 * @param {string} series The name of the series the entries belong to.
 * @param {!historian.data.ClusterEntry} cluster The cluster to display.
 * @return {{header: ?historian.TableRow, body: !Array<!historian.TableRow>}}
 *     The table header and body.
 * @private
 */
historian.Bars.prototype.createSortedTable_ = function(series, cluster) {
  var entries = cluster.sorted;
  var customHeadings = [];
  var entryToRowFn = null;
  // Format of activity manager row:
  // frameworks/base/services/core/java/com/android/server/am/EventLogTags.logtags
  switch (series) {
    case historian.metrics.Csv.BACKGROUND_COMPILATION:
      customHeadings = ['Log line'];
      entryToRowFn = function(entry) { return entry.value; };
      break;
    case historian.metrics.Csv.CHOREOGRAPHER_SKIPPED:
      customHeadings = ['Num frames skipped'];
      entryToRowFn = function(entry) { return entry.value; };
      break;
    case historian.metrics.Csv.DVM_LOCK_SAMPLE:
      // Format of a dvm value is:
      // process,is_sensitive,thread,lock_time,filename,line,ownerfile,line,sample_percent
      customHeadings = [
        'Process Name',
        'Is Sensitive Thread',
        'Thread',
        'Lock time',
        'File (line)',  // This is combination of value fields 4 and 5.
        'Owner (line)',  // This is a combination of value fields 6 and 7.
        'Sample percent'
      ];
      entryToRowFn = function(entry) {
        var parts = entry.value.split(',');
        parts[3] = historian.time.formatDuration(parts[3]);
        // Add the line numbers to the file name and owner file name columns.
        parts[4] = goog.string.subs('%s (%s)', parts[4], parts[5]);
        parts[6] = goog.string.subs('%s (%s)', parts[6], parts[7]);
        // Delete the line number columns.
        parts.splice(7, 1);
        parts.splice(5, 1);
        return parts;
      };
      break;
    case historian.metrics.Csv.GC_PAUSE_BACKGROUND_PARTIAL:
    case historian.metrics.Csv.GC_PAUSE_BACKGROUND_STICKY:
    case historian.metrics.Csv.GC_PAUSE_FOREGROUND:
      customHeadings = ['Paused Duration'];
      entryToRowFn = function(entry) {
        var ms = entry.value / historian.time.NANOSECS_IN_MSEC;
        return historian.time.formatDuration(ms);
      };
      break;
    default:
      if (series in historian.metrics.EventLogProperties) {
        var properties = historian.metrics.EventLogProperties[series];
        customHeadings = properties.map(function(prop) {
          return prop.colName;
        });
        // The data unit is a value taken from the following list:
        // 1: Number of objects
        // 2: Number of bytes
        // 3: Number of milliseconds
        // 4: Number of allocations
        // 5: Id
        // 6: Percent
        // s: Number of seconds (monotonic time)
        // system/core/logcat/event.logtags
        entryToRowFn = function(entry) {
          var parts = entry.value.split(',');
          parts.forEach(function(part, i) {
            if (i >= properties.length) {
              return;
            }
            switch (properties[i].unit) {
              case 2:
                parts[i] =
                    historian.utils.describeBytes(parseInt(parts[i], 10));
                break;
              case 3:
                parts[i] =
                    historian.time.formatDuration(parseInt(parts[i], 10));
                break;
              case 5:
                if (series.match(/^sysui/) != null) {
                  parts[i] = historian.metrics.decodeSystemUiEvent(parts[i]);
                }
                break;
              case 6:
                parts[i] = parts[i] + '%';
                break;
              case 's':
                // Can come from something like elapsed_realtime, which is
                // duration since boot. Format for '3' is a similar thing, but
                // in milliseconds resolution
                parts[i] = historian.time.formatDuration(
                    parseInt(parts[i], 10) * 1000);
                break;
            }
          });
          return parts;
        };
      } else {
        customHeadings = ['Details'];
        entryToRowFn = function(entry) { return entry.value; };
      }
  }
  var headRow = ['Time'];
  var seriesHasUid =
      entries.some(function(e) { return e.hasOwnProperty('uid'); });
  if (seriesHasUid) {
    // Add the UID column if any entry has a UID.
    headRow.push('UID');
  }
  // Only add the process name if there isn't already a column for it.
  var showProcess = seriesHasUid &&
      !goog.array.contains(headRow, 'Process Name');
  if (showProcess) {
    headRow.push('Process Name');
  }
  headRow = headRow.concat(customHeadings);

  var bodyRows = entries.map(function(entry) {
    var row =
        [historian.time.getTime(entry.startTime, this.context_.location)];
    if (seriesHasUid) {
      // Some entries might not have a UID, so check per entry.
      var entryHasUid = entry.hasOwnProperty('uid');
      row.push(entryHasUid ? entry.uid : '');
      if (showProcess) {
        var name = entryHasUid && entry.uid in historian.appstats.appStats ?
            historian.appstats.appStats[entry.uid].RawStats.name : '';
        row.push(name);
      }
    }
    return row.concat(entryToRowFn(entry));
  }.bind(this));

  return {header: headRow, body: bodyRows};
};


/**
 * Creates a table to display the broadcast entries in the given cluster.
 *
 * @param {!historian.ClusteredSeriesData} series The series the cluster
 *     belongs to.
 * @param {!historian.data.ClusterEntry} cluster The cluster to display.
 * @return {?{header: ?historian.TableRow, body: !Array<!historian.TableRow>}}
 *     The table header and body.
 * @private
 */
historian.Bars.prototype.createBroadcastsTable_ = function(series, cluster) {
  // The current series either contains all enqueue events, or all dispatch
  // events. We also want to show details from the corresponding series.
  // e.g. for enqueue foreground events, we want to show the corresponding
  // dispatch foreground events. The enqueue column is always shown first.
  var broadcastMapping = {
    // Active broadcasts are unfinished broadcasts, so have no corresponding
    // dispatch -> finish series.
    [historian.metrics.Csv.ACTIVE_BROADCAST_FOREGROUND]: {
      col: 1
    },
    [historian.metrics.Csv.ACTIVE_BROADCAST_BACKGROUND]: {
      col: 1
    },
    [historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND]: {
      corresponding: historian.metrics.Csv.BROADCAST_DISPATCH_FOREGROUND,
      col: 1
    },
    [historian.metrics.Csv.BROADCAST_DISPATCH_FOREGROUND]: {
      corresponding: historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND,
      col: 2
    },
    [historian.metrics.Csv.BROADCAST_ENQUEUE_BACKGROUND]: {
      corresponding: historian.metrics.Csv.BROADCAST_DISPATCH_BACKGROUND,
      col: 1
    },
    [historian.metrics.Csv.BROADCAST_DISPATCH_BACKGROUND]: {
      corresponding: historian.metrics.Csv.BROADCAST_ENQUEUE_BACKGROUND,
      col: 2
    }
  };
  var mapping = broadcastMapping[series.name];
  if (!mapping) {
    console.log('unknown broadcast series ' + series.name);
    return null;
  }

  var headRow = ['Broadcast ID', 'Enqueue -> Dispatch'];
  // Only historical broadcasts have Dispatch -> Finish info.
  if (mapping.corresponding) {
    headRow.push('Dispatch -> Finish');
  }
  headRow.push('UID');
  headRow.push('Package Name');

  // Highlight the heading that corresponds to the current series (enqueue or
  // dispatch).
  headRow[mapping.col] = {
    value: headRow[mapping.col],
    classes: 'highlighted-cell'
  };

  var loc = this.context_.location;
  var formatBroadcastTimes = function(entry) {
    var formattedEndTime = entry.unknownEndTime ? '???' :
        historian.time.getTime(entry.endTime, loc);
    var formattedDur = entry.unknownEndTime ? '???' :
        historian.time.formatDuration(entry.endTime - entry.startTime);
    return goog.string.subs('%s - %s\n(%s)',
        historian.time.getTime(entry.startTime, loc),
        formattedEndTime,
        formattedDur);
  };

  // e.g. If we were given the enqueue background broadcasts, the corresponding
  // series would contain the dispatch background broadcasts.
  var correspondingSeries = mapping.corresponding ?
      this.barData_.getSeries(mapping.corresponding,
      historian.historianV2Logs.Sources.BROADCASTS_LOG) : null;
  var correspondingCol = mapping.corresponding ?
      broadcastMapping[mapping.corresponding].col : null;

  var originalEntryIds = cluster.getIds()
      // It can get laggy with too many entries, and the tooltip will go off
      // screen anyway.
      .filter(function(aggId, idx) { return idx < 100; });
  var bodyRows = originalEntryIds.map(function(aggId) {
    // Broadcast events may be overlapping and sliced up, but we want
    // to show the enqueue / dispatch times based on the original entries.
    var originalEntry = series.originalValues[aggId];
    var broadcastId = originalEntry.value;
    var tblRow = ['#' + broadcastId, ''];
    // Only historical broadcasts have Dispatch -> Finish info.
    if (mapping.corresponding) {
      tblRow.push('');
    }
    tblRow[mapping.col] = formatBroadcastTimes(originalEntry);

    if (correspondingSeries && correspondingSeries.originalValues) {
      var idx = goog.array.findIndex(correspondingSeries.originalValues,
          function(entry) { return entry.value == broadcastId; });
      var entry = correspondingSeries.originalValues[idx];
      tblRow[correspondingCol] = formatBroadcastTimes(entry);
    }
    tblRow.push(originalEntry.uid != null ? originalEntry.uid : '');
    tblRow.push(originalEntry.uid in historian.appstats.appStats ?
        historian.appstats.appStats[originalEntry.uid].RawStats.name : '');
    return tblRow;
  }, this);
  return {header: headRow, body: bodyRows};
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


/**
 * Returns the y offset the series should be translated by.
 * @param {!historian.SeriesData} series
 * @param {number} idx The index for the group the series belongs to.
 *     The higher the index, the higher the series will be rendered
 *     on the page.
 * @return {number}
 */
historian.Bars.prototype.getSeriesTranslate = function(series, idx) {
  if (series.type == historian.metrics.UNAVAILABLE_TYPE) {
    // If the data point is to denote that data is unavailable for that
    // period, fill the entire row height to differentiate it.
    return this.getRowY(idx + 1);
  } else if (historian.metrics.renderAsCircles(series)) {
    // The coordinates for a circle determine its center, rather than the
    // top left corner like for rectangles. A series will never be of
    // UNAVAILABLE_TYPE and also rendered as a circle.
    return this.getRowY(idx + .5);
  } else {
    return this.getRowY(idx + .7);
  }
};

});  // goog.scope
