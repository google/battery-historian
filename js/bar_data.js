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

goog.require('goog.array');
goog.require('historian.color');
goog.require('historian.metrics.Csv');
goog.require('historian.utils');



/**
 * Stores all series groups parsed from the Historian v2 CSV, including those
 * which are configured to be ignored by default. Handles adding and removing
 * series groups and notifying listeners.
 * @param {?jQuery} container The graph container this bar data is rendered in.
 * @param {!Object<!historian.SeriesGroup>} groups All the series groups.
 * @param {!Object<boolean>} hidden Groups hidden by default.
 * @param {!Array<string>} order Order for the groups to be displayed in.
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

  /** @private {!Object<!historian.SeriesGroup>} */
  this.groups_ = groups;

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
   * @private {!Array<string>}
   */
  this.order_ = order;

  this.generateDataToDisplay_(hidden);
  // Assign a row index to each series group.
  this.generateIndexes();
  if (createList) {
    this.addSeriesSelector_(hidden);
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
 *   value: (string|number)
 * }}
 */
historian.BarData.LegendEntry;


/**
 * The help legend for a series group.
 * @typedef {!Array<!historian.BarData.LegendEntry>}
 */
historian.BarData.Legend;


/**
 * Adds all non ignored metrics into the array of data to display.
 * @param {!Object<boolean>} hidden Groups hidden by default.
 * @private
 */
historian.BarData.prototype.generateDataToDisplay_ = function(hidden) {
  this.order_.forEach(function(group) {
    if ((group in this.groups_) && !(group in hidden)) {
      this.dataToDisplay_.push(this.groups_[group]);
    }
  }, this);
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
  var series = Object.keys(this.groups_).filter(function(elem) {
    return elem in hidden;
  }).sort();
  historian.utils.setupDropdown(select, series, 'Add Metrics');
  select.on('change', function(event) {
    this.addGroup(event.val);
    select.find('option[value="' + event.val + '"]').remove();
    select.select2('val', null);
  }.bind(this));
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
  });
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
  var removed = goog.array.removeIf(this.dataToDisplay_, function(group) {
    return group.name == name;
  });
  if (removed) {
    this.generateIndexes();
    this.callListeners_();

    if (!this.container_) {
      return;
    }
    // Add the removed group to the list of metrics that can be added.
    var dropdown = this.container_.find(historian.BarData.METRICS_SELECTOR_);
    var toInsert = $('<option></option>').val(name).html(name);
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
  }
};


/**
 * Generates help legends for values and corresponding colors per series group.
 * @return {!Object<!historian.BarData.Legend>} Map from group
 *     name to legend entries.
 * @private
 */
historian.BarData.prototype.generateLegends_ = function() {
  var valueToLegendEntry = function(series, value) {
    return {
      color: series.color(value),
      value: historian.color.valueFormatter(series.name, value).value
    };
  };

  var seriesToLegendEntries = function(series) {
    var entries = [];
    if (series.type == 'bool') {
      // Series with only 'true' values. Time during which there is no
      // entry is considered 'false'.
      entries = entries.concat([
        {
          color: 'white',
          value: 'Off'
        },
        {
          color: series.color('true'),
          value: 'On'
        }
      ]);
    } else if (series.color && typeof series.color.domain == 'function' &&
        series.color.domain().length > 0) {
      // Series which have a fixed set of domain values.
      // e.g. PHONE_STATE has domain = ['in', 'out', 'off']
      var domainValues = series.color.domain();
      entries = entries.concat(
          domainValues.map(valueToLegendEntry.bind(null, series)));
    }
    // TODO: handle other series types.
    // TODO: consider prefixing the value with the series name if
    // group has more than one series. e.g. AM Proc Start and Am Proc Died are
    // rendered in the same row.
    return entries;
  };

  var legends = {};
  for (var group in this.groups_) {
    legends[group] = [];
    this.groups_[group].series.forEach(function(series) {
      legends[group] = legends[group].concat(seriesToLegendEntries(series));
    });
  }
  return legends;
};
