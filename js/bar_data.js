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
goog.provide('historian.BarData.Legend');
goog.provide('historian.BarData.LegendEntry');
goog.provide('historian.BarData.Listener');

goog.require('goog.array');
goog.require('goog.asserts');
goog.require('goog.string');
goog.require('historian.color');
goog.require('historian.historianV2Logs');
goog.require('historian.metrics');
goog.require('historian.metrics.Csv');
goog.require('historian.time');
goog.require('historian.utils');



/**
 * Stores all series groups parsed from the Historian v2 CSV, including those
 * which are configured to be ignored by default. Handles adding and removing
 * series groups and notifying listeners.
 * @param {?jQuery} container The graph container this bar data is rendered in.
 * @param {!historian.metrics.DataHasher} groups All the series groups.
 * @param {!Object<boolean>} hidden Groups hidden by default.
 * @param {!Array<!historian.metrics.GroupProperties>} order Order for the
 *     groups to be displayed in.
 * @param {boolean} createList If true, creates and appends the list
 *     elements representing the bar data to the Historian menu bar.
 * @constructor
 * @struct
 */
historian.BarData = function(container, groups, hidden, order, createList) {
  /** @private {?jQuery} */
  this.container_ = container;

  /** @private {!Array<!historian.BarData.Listener>} */
  this.listeners_ = [];

  /**
   * Data before filtering by duration is applied.
   * @private {!historian.metrics.DataHasher}
   */
  this.unfilteredGroups_ = groups;

  /**
   * Data with filtering of unimportant events applied.
   * @private {!historian.metrics.DataHasher}
   */
  this.groups_ = historian.BarData.filterUnimportant_(groups);

  /** @private {!Object<!historian.BarData.Legend>} */
  this.legends_ = this.generateLegends_();

  /**
   * Data to display as bars in Historian v2.
   * @private {!Array<!historian.SeriesGroup>}
   */
  this.dataToDisplay_ = [];

  /**
   * Names of the groups in the order they should be displayed.
   * Any groups not present in this array will be displayed after.
   * @private {!Array<!historian.metrics.GroupProperties>}
   */
  this.order_ = order;

  /** @private {boolean} */
  this.filter_ = true;

  this.generateDataToDisplay_(hidden);
  // Assign a row index to each series group.
  this.generateIndexes();
  if (createList) {
    this.addSeriesSelector_(hidden);
  }

  if (this.container_) {
    var filterElem = this.container_.find('.filter-unimportant');
    filterElem.on('click', function(event) {
      this.filter_ = !this.filter_;
      filterElem.find('.settings-checkbox')
          .css('opacity', this.filter_ ? 1 : 0);
      event.preventDefault();
      this.setFilteredUnimportant(this.filter_);
    }.bind(this));
  }
};


/**
 * Function that is called on bar data change.
 * @typedef {function()}
 */
historian.BarData.Listener;


/**
 * A single row in a legend.
 * @typedef {{
 *   color: string,
 *   value: (string|number),
 *   isCircle: boolean
 * }}
 */
historian.BarData.LegendEntry;


/**
 * The help legend for a series group.
 * @typedef {!Array<!historian.BarData.LegendEntry>}
 */
historian.BarData.Legend;


/**
 * Replaces the data with the filtered or unfiltered versions and notifies
 * any listeners.
 * @param {boolean} enable Whether to enable filtering.
 */
historian.BarData.prototype.setFilteredUnimportant = function(enable) {
  var groups = enable ? this.groups_ : this.unfilteredGroups_;
  this.dataToDisplay_.forEach(function(group, i, arr) {
    var newGroup = groups.get(group.source, group.name);
    // When swapping the group for the filtered / unfiltered
    // version we need to update the index in case it was modified.
    newGroup.index = group.index;
    arr[i] = /** @type {!historian.SeriesGroup} */ (newGroup);
  });
  this.callListeners_();
};


/**
 * Returns the filtered or unfiltered groups depending on whether the
 * 'Filter unimportant' checkbox is checked.
 * @return {!historian.metrics.DataHasher}
 * @private
 */
historian.BarData.prototype.getGroups_ = function() {
  return this.filter_ ? this.groups_ : this.unfilteredGroups_;
};


/**
 * Adds all non ignored metrics into the array of data to display.
 * @param {!Object<boolean>} hidden Groups hidden by default.
 * @private
 */
historian.BarData.prototype.generateDataToDisplay_ = function(hidden) {
  this.order_.forEach(function(groupProp) {
    var group = this.getGroups_().get(groupProp.source, groupProp.name);
    if (group && !(historian.metrics.hash(groupProp) in hidden)) {
      this.dataToDisplay_.push(/** @type {!historian.SeriesGroup} */ (group));
    }
  }, this);
};


/**
 * Filters out entries that aren't considered important.
 * @param {!historian.metrics.DataHasher} groups
 * @return {!historian.metrics.DataHasher} The filtered result. Does not modify
 *     the passed in groups.
 * @private
 */
historian.BarData.filterUnimportant_ = function(groups) {
  var thresholdFilter = function(seriesName, threshold, entry) {
    switch (seriesName) {
      case historian.metrics.Csv.AM_PSS:
        return entry.value.split(',')[3] > threshold;
      case historian.metrics.Csv.DVM_LOCK_SAMPLE:
        // This is an instant event, but the time the lock was held is stored
        // as part of the value.
        return entry.value.split(',')[3] > threshold;
      case historian.metrics.Csv.GC_PAUSE_BACKGROUND_PARTIAL:
      case historian.metrics.Csv.GC_PAUSE_BACKGROUND_STICKY:
      case historian.metrics.Csv.GC_PAUSE_FOREGROUND:
        return entry.value / historian.time.NANOSECS_IN_MSEC > threshold;
      default:
        return entry.endTime - entry.startTime > threshold;
    }
  };

  // We need to make a copy so we don't lose the original unfiltered data.
  // Only deep copy groups with series that have a threshold, otherwise
  // a shallow copy will suffice.
  var groupsCopy = new historian.metrics.DataHasher();

  groups.getAll().forEach(function(group) {
    var hasThreshold = group.series.some(function(series) {
      return series.name in historian.metrics.thresholdImportant;
    });
    if (!hasThreshold) {
      groupsCopy.add(group);  // Shallow copy.
      return;
    }
    var groupCopy = /** @type {!historian.SeriesGroup} */ (
        jQuery.extend(true, {}, group));
    groupCopy.series.forEach(function(series) {
      if (series.type == historian.metrics.UNAVAILABLE_TYPE) {
        return;
      }
      var threshold = historian.metrics.thresholdImportant[series.name];
      series.values = series.values.filter(
          thresholdFilter.bind(null, series.name, threshold));
    });
    groupsCopy.add(groupCopy);
  });
  return groupsCopy;
};


/**
 * Returns the domain of the shown metrics, null if there is no visible data.
 * @return {?{min: number, max: number}} xExtent Min start time and max end
 *     time of the shown metrics.
 */
historian.BarData.prototype.getVisibleDomain = function() {
  var showBars = this.container_ &&
      this.container_.find('.show-bars').is(':checked');
  if (!showBars) {
    return null;
  }
  var entries = [];
  this.getData().forEach(function(group) {
    group.series.forEach(function(series) {
      if (series.type != historian.metrics.UNAVAILABLE_TYPE) {
        entries = entries.concat(series.values);
      }
    });
  });
  if (entries.length == 0) {
    return null;
  }
  var startExtent = d3.extent(entries, function(entry) {
    return entry.startTime;
  });
  var endExtent = d3.extent(entries, function(entry) {
    return entry.endTime;
  });
  return {min: startExtent[0], max: endExtent[1]};
};


/**
 * Returns the legend entries for a given series group.
 * @param {string} group The name of the group.
 * @return {!historian.BarData.Legend}
 */
historian.BarData.prototype.getLegend = function(group) {
  return this.legends_[group] || [];
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
    exists[historian.metrics.hash(seriesGroup)] = true;
  });

  var order = {};
  var index = 0;
  this.order_.forEach(function(groupProperties) {
    var hash = historian.metrics.hash(groupProperties);
    if (hash in exists) {
      order[hash] = index;
      index++;
    }
  });

  var numSeries = this.dataToDisplay_.length;
  var nextAvailableIndex = numSeries - Object.keys(order).length - 1;
  this.dataToDisplay_.forEach(function(group) {
    var hash = historian.metrics.hash(group);
    // Always display charging status last.
    if (group.source == historian.historianV2Logs.Sources.BATTERY_HISTORY &&
        group.name == historian.metrics.Csv.CHARGING_STATUS) {
      group.index = 0;
    } else if (hash in order) {
      group.index = numSeries - order[hash] - 1;
    } else {
      group.index = nextAvailableIndex;
      nextAvailableIndex--;
    }
  });
};


/**
 * Modifies the index of the group with the given name, as well as indexes
 * of affected groups. The index is a unique number which determines the
 * position in the graph where the series is displayed. The higher the index,
 * the higher it is displayed on the graph.
 *
 * @param {!historian.historianV2Logs.Sources} source Log source of the group.
 * @param {string} name Name of the group to set the index of. If the group
 *     is currently not a displayed group, nothing will be done.
 * @param {number} newIndex Index to set for the group. The set index will
 *     be restricted to be between the maximum allowable index and zero.
 */
historian.BarData.prototype.modifyIndex = function(source, name, newIndex) {
  if (!this.getGroups_().contains(source, name)) {
    return;  // No such group exists.
  }
  var groupToMove = this.getGroups_().get(source, name);
  // Restrict the index between the maximum allowable index and zero.
  newIndex = Math.max(Math.min(newIndex, this.getMaxIndex()), 0);
  var oldIndex = groupToMove.index;
  if (oldIndex == newIndex) {
    return;
  }
  var i = goog.array.indexOf(this.dataToDisplay_, groupToMove);
  if (i < 0) {
    // The group is not currently being displayed, so it's index is irrelevant.
    return;
  }
  // If we're increasing a group's index we need to decrement all the indexes
  // of the groups between the old and new index. If we're decreasing a group's
  // index, we need to instead increment the indexes of affected groups.
  var change = newIndex > oldIndex ? -1 : 1;
  // Get the min and max affected indexes.
  var minAffected = Math.min(newIndex, oldIndex);
  var maxAffected = Math.max(newIndex, oldIndex);

  // Modify index of affected groups.
  this.dataToDisplay_.forEach(function(group) {
    if (group.index >= minAffected && group.index <= maxAffected) {
      group.index += change;
    }
  });
  groupToMove.index = newIndex;
  this.callListeners_();
};


/**
 * Returns the maximum index allowable for the bar data.
 * @return {number}
 */
historian.BarData.prototype.getMaxIndex = function() {
  var num = this.getData().length;
  return num == 0 ? 0 : num - 1;
};


/** @private @const {string} */
historian.BarData.METRICS_SELECTOR_ = 'select.configure-metrics';


/**
 * Creates the series selector for adding hidden groups.
 * @param {!Object<boolean>} hidden Groups hidden by default.
 * @private
 */
historian.BarData.prototype.addSeriesSelector_ = function(hidden) {
  if (!this.container_) {
    return;
  }
  var select = this.container_.find(historian.BarData.METRICS_SELECTOR_);
  // Only allow the user to choose metrics that are currently not displayed.
  // We can't just use the hidden metrics map as that may contain metrics
  // not present in the groups data.
  var groups = this.getGroups_().getAll().reduce(function(res, group) {
    return historian.metrics.hash(group) in hidden ? res.concat(group) : res;
  }, []);
  var selectNames = groups.map(this.groupDesc_).sort();
  historian.utils.setupDropdown(select, selectNames, 'Add Metrics');
  select.on('change', function(event) {
    if (!event.val) {
      return;
    }
    // The value will be in the format 'group name (log source)'.
    var matches = event.val.match('(.*) \\(([^(]*)\\)$');
    // The captured groups will be in index 1 and 2.
    goog.asserts.assert(matches.length == 3);
    var source = matches[2];
    var metric = matches[1];
    this.addGroup(source, metric);
    select.find('option[value="' + event.val + '"]').remove();
    select.select2('val', null);
  }.bind(this));
};


/**
 * @param {!historian.metrics.GroupProperties} groupProperties Name and log
 *     source of the group.
 * @return {string} Unique human readable descriptor for the group.
 * @private
 */
historian.BarData.prototype.groupDesc_ = function(groupProperties) {
  return goog.string.subs('%s (%s)',
      groupProperties.name, groupProperties.source);
};


/**
 * Returns the data that should be displayed in the Historian v2 graph.
 * @return {!Array<!historian.SeriesGroup>} The data to be displayed.
 */
historian.BarData.prototype.getData = function() {
  return this.dataToDisplay_;
};


/**
 * Returns the series data corresponding to the name and log source.
 * @param {string} name Name of the series.
 * @param {!historian.historianV2Logs.Sources} source Log source of the series.
 * @return {?historian.SeriesData}
 */
historian.BarData.prototype.getSeries = function(name, source) {
  var groups = this.getGroups_().getAll();
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i];
    var idx = goog.array.findIndex(group.series, function(series) {
      return series.name == name && series.source == source;
    });
    if (idx != -1) {
      return group.series[idx];
    }
  }
  return null;
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
 * @param {!historian.historianV2Logs.Sources} source
 * @param {string} name The name of the group to add.
 */
historian.BarData.prototype.addGroup = function(source, name) {
  if (!this.getGroups_().contains(source, name)) {
    return;
  }
  var found = this.dataToDisplay_.some(function(group) {
    return group.source == source && group.name == name;
  });
  // Only need to add the group if it's not already in the data to display.
  if (!found) {
    // Add group to the bottom of the graph. Since users will be able to modify
    // the order of rows, it doesn't make sense to use the default order
    // to determine the row position.
    this.dataToDisplay_.forEach(function(group) {
      // The higher the index, the higher it is rendered, so to add a row at
      // index 0, all the group indexes need to be incremented.
      group.index++;
    });
    this.getGroups_().get(source, name).index = 0;
    this.dataToDisplay_.push(/** @type {!historian.SeriesGroup} */ (
        this.getGroups_().get(source, name)));
    this.callListeners_();
  }
};


/**
 * Removes the series group from the data to display. Does nothing if the group
 * name is not in the original groups or data to display array.
 * @param {!historian.historianV2Logs.Sources} source Log source of the group.
 * @param {string} name The name of the group to remove.
 */
historian.BarData.prototype.removeGroup = function(source, name) {
  if (!this.getGroups_().contains(source, name)) {
    return;
  }
  var i = goog.array.findIndex(this.dataToDisplay_, function(group) {
    return group.source == source && group.name == name;
  });
  if (i < 0) {
    return;  // Nothing to remove.
  }
  var group = this.dataToDisplay_[i];
  var removedIndex = group.index;
  goog.array.removeAt(this.dataToDisplay_, i);
  // Decrement the indexes of all the groups with index greater than the
  // removed group.
  this.dataToDisplay_.forEach(function(group) {
    if (group.index > removedIndex) {
      group.index--;
    }
  });
  this.callListeners_();

  if (!this.container_) {
    return;
  }
  // Add the removed group to the list of metrics that can be added.
  var dropdown = this.container_.find(historian.BarData.METRICS_SELECTOR_);
  var dropdownVal = this.groupDesc_({name: name, source: source});
  var toInsert = $('<option></option>').val(dropdownVal).html(dropdownVal);
  var inserted = false;
  dropdown.find('option').each(function() {
    // Insert alphabetically, ignoring case.
    var existing = $(this).val();
    if (existing.localeCompare(name, 'en', {'sensitivity': 'base'}) > 0) {
      toInsert.insertBefore($(this));
      inserted = true;
      return false;
    }
  });
  if (!inserted) {
    toInsert.appendTo(dropdown);
  }
  dropdown.trigger('change');
};


/**
 * Generates help legends for values and corresponding colors per series group.
 * @return {!Object<!historian.BarData.Legend>} Map from group
 *     name to legend entries.
 * @private
 */
historian.BarData.prototype.generateLegends_ = function() {
  var valueToLegendEntry = function(series, value) {
    var formatted = historian.color.valueFormatter(series.name, value).value;
    switch (series.name) {
      case historian.metrics.Csv.ACTIVE_BROADCAST_BACKGROUND:
      case historian.metrics.Csv.ACTIVE_BROADCAST_FOREGROUND:
      case historian.metrics.Csv.BROADCAST_ENQUEUE_BACKGROUND:
      case historian.metrics.Csv.BROADCAST_DISPATCH_BACKGROUND:
      case historian.metrics.Csv.BROADCAST_ENQUEUE_FOREGROUND:
      case historian.metrics.Csv.BROADCAST_DISPATCH_FOREGROUND:
        formatted = '> ' + formatted;
    }
    return {
      color: series.color(value),
      value: formatted,
      isCircle: historian.metrics.renderAsCircles(series)
    };
  };

  var seriesToLegendEntries = function(series) {
    var isCircle = historian.metrics.renderAsCircles(series);
    if (series.type == 'bool') {
      // Series with only 'true' values. Time during which there is no
      // entry is considered 'false'.
      return [
        {color: 'white', value: 'Off', isCircle: isCircle},
        {color: series.color('true'), value: 'On', isCircle: isCircle}
      ];
    } else if (series.color && typeof series.color.domain == 'function' &&
        series.color.domain().length > 0) {
      // Series which have a fixed set of domain values.
      // e.g. PHONE_STATE has domain = ['in', 'out', 'off']
      var domainValues = series.color.domain();
      return domainValues.map(valueToLegendEntry.bind(null, series));
    }

    switch (series.name) {
      // Rendered under AM_PROC.
      case historian.metrics.Csv.AM_PROC_START:
      case historian.metrics.Csv.AM_PROC_DIED:
      // Rendered under CRASHES.
      case historian.metrics.Csv.CRASHES:
      case historian.metrics.Csv.NATIVE_CRASHES:
      // Rendered under GC_PAUSE.
      case historian.metrics.Csv.GC_PAUSE_BACKGROUND_PARTIAL:
      case historian.metrics.Csv.GC_PAUSE_BACKGROUND_STICKY:
      case historian.metrics.Csv.GC_PAUSE_FOREGROUND:
        return [
          {color: series.color(), value: series.name, isCircle: isCircle}
        ];
      default:
        // TODO: handle other series types.
        return [];
    }
  };

  // TODO: make legends also log source specific once
  // the color definitions are updated to include the log source.
  var legends = {};
  this.groups_.getAll().forEach(function(group) {
    var name = group.name;
    legends[name] = [];
    group.series.forEach(function(series) {
      legends[name] = legends[name].concat(seriesToLegendEntries(series));
    });
  });
  return legends;
};
