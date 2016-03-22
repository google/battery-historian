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

goog.provide('historian.BarData');
goog.provide('historian.BarData.Listener');

goog.require('historian.metrics');


/**
 * Function that is called on bar data change.
 * @typedef {function()}
 */
historian.BarData.Listener;



/**
 * Stores all series groups parsed from the Historian v2 CSV, including those
 * which are configured to be ignored by default. Handles adding and removing
 * series groups and notifying listeners.
 * @param {!Object<!historian.SeriesGroup>} groups All the series groups.
 * @param {!Object<boolean>} hiddenMetrics Metrics hidden by default.
 * @param {!Array<string>} order Order for the groups to be displayed in.
 * @param {boolean} createList If true, creates and appends the list
 *     elements representing the bar data to the Historian menu bar.
 * @constructor
 * @struct
 */
historian.BarData = function(groups, hiddenMetrics, order, createList) {
  /** @private {!Array<!historian.BarData.Listener>} */
  this.listeners_ = [];

  /** @private {!Object<!historian.SeriesGroup>} */
  this.groups_ = groups;

  /**
   * Data to display as bars in Historian v2.
   * @private {!Array<!historian.SeriesGroup>}
   */
  this.dataToDisplay_ = [];

  /**
   * Names of the groups in the order they should be displayed.
   * Any groups not present in this array will be displayed after.
   * @private {!Array<string>}
   */
  this.order_ = order;

  this.generateDataToDisplay_(hiddenMetrics);
  // Assign a row index to each series group.
  this.generateIndexes();
  if (createList) {
    this.constructSeriesGroupsList_(hiddenMetrics);
  }
};


/**
 * Adds all non ignored metrics into the array of data to display.
 * @param {!Object<boolean>} hiddenMetrics Metrics hidden by default.
 * @private
 */
historian.BarData.prototype.generateDataToDisplay_ = function(hiddenMetrics) {
  for (var name in this.groups_) {
    if (!(name in hiddenMetrics)) {
      this.dataToDisplay_.push(this.groups_[name]);
    }
  }
};


/**
 * Assigns an index to each series group, some of which are predefined.
 * This determines the order in which the metrics are rendered.
 * The smaller the index, the lower it is rendered in the Historian graph.
 * Indexes will range from 0 to one less than the series data length.
 */
historian.BarData.prototype.generateIndexes = function() {
  var exists = {};
  this.dataToDisplay_.forEach(function(seriesGroup) {
    exists[seriesGroup.name] = true;
  });

  var order = {};
  var index = 0;
  this.order_.forEach(function(groupName) {
    if (groupName in exists) {
      order[groupName] = index;
      index++;
    }
  });

  var numSeries = this.dataToDisplay_.length;
  var nextAvailableIndex = numSeries - Object.keys(order).length - 1;
  this.dataToDisplay_.forEach(function(seriesGroup) {
    var name = seriesGroup.name;
    // Always display charging status last.
    if (name == historian.metrics.Csv.CHARGING_STATUS) {
      seriesGroup.index = 0;
    } else if (name in order) {
      seriesGroup.index = numSeries - order[name] - 1;
    } else {
      seriesGroup.index = nextAvailableIndex;
      nextAvailableIndex--;
    }
  });
};


/** @private @const {string} */
historian.BarData.LIST_CHECKBOX_CLASS_ = '.glyphicon';


/** @private @const {string} */
historian.BarData.METRIC_LIST_ITEM_CLASS_NAME_ = 'group';


/** @private @const {string} */
historian.BarData.METRICS_LIST_ID_ = '#historian-series-groups';


/**
 * Creates the group selection list. Updates the list elements UI on selection
 * and deselection, and adds or removes the selected group based on the state.
 * @param {!Object<boolean>} hidden Metrics hidden by default.
 * @private
 */
historian.BarData.prototype.constructSeriesGroupsList_ = function(hidden) {
  var groupNames = Object.keys(this.groups_).sort();
  var list = $(historian.BarData.METRICS_LIST_ID_ + ' ul');
  groupNames.forEach(function(group) {
    // Create a list item for the group.
    var item = $('<li></li>')
        .appendTo(list);
    var link = $('<a href="#"></a>')
        .appendTo(item);
    // Create the checkbox.
    $('<span></span>')
        .attr('class', 'glyphicon glyphicon-ok glyphicon-inline-left')
        .appendTo(link);
    // Create the group name span.
    $('<span></span')
        .attr('class', historian.BarData.METRIC_LIST_ITEM_CLASS_NAME_)
        .text(group)
        .appendTo(link);

    if (group in hidden) {
      // Default state is unchecked if the series group is not being displayed.
      link.children(historian.BarData.LIST_CHECKBOX_CLASS_).css('opacity', 0);
    }
    link.click(function(element, event) {
      var checkbox = element.children(historian.BarData.LIST_CHECKBOX_CLASS_);
      var metricClicked = element.children(
          '.' + historian.BarData.METRIC_LIST_ITEM_CLASS_NAME_).text();

      var isChecked = checkbox.css('opacity') > 0;
      if (isChecked) {
        this.removeGroup(metricClicked);
      } else {
        this.addGroup(metricClicked);
      }
      // Toggle the state of the checkbox.
      element.children(historian.BarData.LIST_CHECKBOX_CLASS_)
          .css('opacity', isChecked ? 0 : 1);

      // Leave list open so they can select another if desired.
      event.stopPropagation();
    }.bind(this, link));
  }, this);
};


/**
 * Returns the data that should be displayed in the Historian v2 graph.
 * @return {!Array<!historian.SeriesGroup>} The data to be displayed.
 */
historian.BarData.prototype.getData = function() {
  return this.dataToDisplay_;
};


/**
 * Registers a listener for ignored groups changed or index changed events.
 * @param {!historian.BarData.Listener} listener The listener to call.
 */
historian.BarData.prototype.registerListener = function(listener) {
  this.listeners_.push(listener);
};


/**
 * Calls registered listeners sequentially.
 * @private
 */
historian.BarData.prototype.callListeners_ = function() {
  this.listeners_.forEach(function(listener) {
    listener();
  });
};


/**
 * Adds the series group to the data to display. Does nothing if the group name
 * is not in the original groups, or is already in the data to display array.
 * @param {string} name The name of the group to add.
 */
historian.BarData.prototype.addGroup = function(name) {
  if (!(name in this.groups_)) {
    return;
  }
  var found = this.dataToDisplay_.some(function(group) {
    return group.name == name;
  }, this);
  // Only need to add the group if it's not already in the data to display.
  if (!found) {
    this.dataToDisplay_.push(this.groups_[name]);
    this.generateIndexes();
    this.callListeners_();
  }
};


/**
 * Removes the series group from the data to display. Does nothing if the group
 * name is not in the original groups or data to display array.
 * @param {string} name The name of the group to remove.
 */
historian.BarData.prototype.removeGroup = function(name) {
  if (!(name in this.groups_)) {
    return;
  }
  this.dataToDisplay_.some(function(group, i) {
    if (group.name == name) {
      this.dataToDisplay_.splice(i, 1);
      this.generateIndexes();
      this.callListeners_();
      return true;
    }
    return false;
  }, this);
};
