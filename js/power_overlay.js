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

goog.module('historian.power.Overlay');
goog.module.declareLegacyNamespace();

var Csv = goog.require('historian.metrics.Csv');
var data = goog.require('historian.data');
var time = goog.require('historian.time');


/** @const {string} */
var OVERLAY_CLASS = 'powermonitor-overlay';


/** @const {string} */
var DROPDOWN_ID = '#power-selector';


/** @const {string} */
var DROPDOWN_CONTAINER_ID = '#power-selector-container';


/**
 * Renders the power monitor overlay, showing the power monitor events
 * corresponding to the selected wakeup reason.
 */
exports = goog.defineClass(null, {
  /**
   * Renders the wakeup reason selector and registers listeners.
   * @param {!historian.Context} context The context for the visualization.
   * @param {!historian.LevelData} levelData The Historian v2 level data.
   * @param {!historian.power.Estimator} powerEstimator
   * @param {!jQuery} container Container the timeline is rendered in.
   * @constructor
   * @final
   */
  constructor: function(context, levelData, powerEstimator, container) {
    /** @private {!historian.Context} */
    this.context_ = context;

    /** @private {!historian.LevelData} */
    this.levelData_ = levelData;

    /** @private {!historian.power.Estimator} */
    this.powerEstimator_ = powerEstimator;

    /**
     * Line generator.
     * @private {function(this:Node, !Array<!historian.Entry>): string}
     */
    this.levelLine_ = d3.line()
        .x(function(d) {
          return context.xScale(d.startTime);
        })
        .y(function(d) {
          return context.yScale(d.value);
        })
        .curve(d3.curveLinear);

    /** @private {!jQuery} */
    this.container_ = container;

    this.renderSelector_();
    this.levelData_.registerListener(this.render.bind(this));
  },


  /**
   * Renders the options for the dropdown selector.
   */
  renderSelector_: function() {
    var dropdown = this.container_.find(DROPDOWN_ID);
    dropdown.append($('<option></option>'));
    this.powerEstimator_.getWakeupReasons().forEach(function(wakeupReason) {
      dropdown.append($('<option></option>')
          .val(wakeupReason.name)
          .html(wakeupReason.power.toFixed(2) + 'mAh: ' + wakeupReason.name));
    });
    dropdown.select2({
      placeholder: 'Select a wakeup reason',
      allowClear: true,
      width: 'resolve'
    }).on('change', this.render.bind(this));
  },


  /**
   * Renders the power monitor events corresponding to the selected wakeup
   * reason. If power monitor is not the currently overlaid level metric, the
   * wakeup reason dropdown is hidden.
   */
  render: function() {
    this.clear_();
    var powerMonitorDisplayed =
        this.levelData_.getConfig().name == Csv.POWER_MONITOR;
    // Hide the dropdown if the currently overlaid metric is not power monitor.
    this.showSelector_(powerMonitorDisplayed);

    var selected = this.getSelected_();
    if (!selected || !powerMonitorDisplayed) {
      return;
    }
    var msPerPixel = this.context_.msPerPixel();
    this.powerEstimator_.getEvents(selected).forEach(function(event) {
      var powerMonitorEvents = event.getPowerMonitorEvents();
      if (msPerPixel > time.MSECS_IN_SEC) {
        // Apply sampling to match the underlying power monitor events.
        powerMonitorEvents = data.sampleData(powerMonitorEvents);
      }
      this.draw_(powerMonitorEvents);
    }, this);
  },

  /**
   * Removes any rendered lines.
   * @private
   */
  clear_: function() {
    this.container_.find('.' + OVERLAY_CLASS).remove();
  },

  /**
   * Draws a line for the given events.
   * @param {!Array<!historian.Entry>} events
   * @private
   */
  draw_: function(events) {
    this.context_.svgLevel.append('svg:path')
        .attr('d', this.levelLine_(events))
        .attr('class', OVERLAY_CLASS);
  },

  /**
   * Shows / hides the power selector dropdown.
   * @param {boolean} show Whether the selector should be shown.
   * @private
   */
  showSelector_: function(show) {
    this.container_.find(DROPDOWN_CONTAINER_ID).toggle(show);
  },

  /**
   * Returns the currently selected wakeup reason in the power dropdown.
   * @return {string}
   * @private
   */
  getSelected_: function() {
    return String(
        this.container_.find(DROPDOWN_ID + ' option:selected').val());
  }
});
