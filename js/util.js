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

goog.provide('historian.util');

goog.require('goog.string');

/**
 * @fileoverview Functions to read in the csv data as series,
 * and aggregate data.
 */


/**
 * Static method to aggregates entries with overlapping times.
 * returning entries with arrays of services.
 * @param {!historian.SerieData} series The series to aggregate.
 * @return {!historian.SerieData} The aggregated series.
 * @private
 */
historian.util.aggregateData_ = function(series) {
  var aggregatedEntries = [];

  // Process the first entry.
  var first = series.values[0];
  aggregatedEntries.push({
    'start_time': first.start_time,
    'end_time': first.end_time,
    'value': 1,
    'services': [first.value]
  });

  for (var i = 1; i < series.values.length; i++) {
    var current = series.values[i];
    var numAggregated = aggregatedEntries.length;
    // If the current entry begins after all the aggregated entries,
    // don't need to aggregate anything, just create a new entry.
    if (current.start_time >= aggregatedEntries[numAggregated - 1].end_time) {
      aggregatedEntries.push({
        'start_time': current.start_time,
        'end_time': current.end_time,
        'value': 1,
        'services': [current.value]
      });
      continue;
    }
    var done = false;
    for (var j = 0; j < aggregatedEntries.length; j++) {
      var entry = aggregatedEntries[j];
      // Skip over all aggregated entries that don't overlap with
      // the current entry.
      if (entry.end_time < current.start_time ||
          entry.start_time > current.end_time) {
        continue;
      }

      if (current.start_time === entry.start_time) {
        if (current.end_time < entry.end_time) {
          // The entry is contained within an existing aggregated entry.
          // Split the aggregated entry into two parts.
          var newEntry = {
            'start_time': current.end_time,
            'end_time': entry.end_time,
            'value': entry.services.length,
            'services': entry.services.slice()
          };
          // Add the current entry to the aggregated entry.
          entry.end_time = current.end_time;
          entry.value = entry.value + 1;
          entry.services.push(current.value);
          aggregatedEntries.splice(j + 1, 0, newEntry);
          done = true;
          break;

        } else if (current.end_time === entry.end_time) {
          // The entries have equal times. Add to existing services array.
          entry.value = entry.value + 1;
          entry.services.push(current.value);
          done = true;
          break;

        } else {
          // The current entry ends after the existing aggregated entry.
          // Add to existing services array, and set a new start
          // point for the current entry for processing in the next
          // iteration.
          entry.value = entry.value + 1;
          entry.services.push(current.value);
          current.start_time = entry.end_time;
        }
      } else if (current.start_time > entry.start_time) {
        // Split the existing aggregated entry into 2 parts,
        // the time occuring before the current entry start time,
        // and the time after.
        var newEntry = {
          'start_time': current.start_time,
          'end_time': entry.end_time,
          'value': entry.services.length,
          'services': entry.services.slice()
        };
        entry.end_time = current.start_time;
        aggregatedEntries.splice(j + 1, 0, newEntry);
      }
    }
    if (!done) {
      aggregatedEntries.push({
        'start_time': current.start_time,
        'end_time': current.end_time,
        'value': 1,
        'services': [current.value]
      });
    }
  }
  return {
    'name': series.name,
    'type': series.type,
    'values': aggregatedEntries,
    'index': series.index
  };
};


/**
 * Comparator function for sorting entries. Sorts by start_time, then end_time.
 * @param {(!historian.Entry | !historian.AggregatedEntry)} e1
 *     The first entry to compare.
 * @param {(!historian.Entry | !historian.AggregatedEntry)} e2
 *     The second entry to compare
 * @return {number} -1 if e1 should be before e2, 0 if equal, 1 otherwise.
 */
function compareEntries(e1, e2) {
  if (e1.start_time < e2.start_time) {
    return -1;
  } else if (e1.start_time === e2.start_time) {
    if (e1.end_time < e2.end_time) {
      return -1;
    } else if (e1.end_time === e2.end_time) {
      return 0;
    }
    return 1;
  }
  return 1;
}


/**
 * Metrics that will not be processed or displayed.
 * @private @const {!Object}
 */
historian.util.IGNORE_METRICS_ = {
  'health': true,
  'plug': true,
  'plugged': true,
  'temperature': true,
  'voltage': true
};


/**
 * Metrics which will be aggregated.
 */
historian.util.metricsToAggregate = {
  'SyncManager app' : -1,
  'Foreground process' : -1,
  'wakelock_in' : -1
};


/**
 * Metrics which will be filtered by UID.
 */
historian.util.appSpecificMetrics = {
  'SyncManager app' : true,
  'Foreground process' : true,
  'wakelock_in' : true,
  'Top app': true
};


/**
 * Returns whether the metric is aggregated.
 * @param {string} name The metric name.
 * @return {boolean} True if the metric is aggregated, false otherwise.
 */
historian.util.isAggregatedMetric = function(name) {
  return (name in historian.util.metricsToAggregate);
};



/**
 * Class for mapping service names to uids.
 * @constructor
 */
historian.util.ServiceMapper = function() {
  /** @private {!Object} */
  this.mapping_ = {};
};


/**
 * Adds a service to uid mapping, Assumes only one mapping per service exists.
 * However, a uid can correspond to many services.
 * If either service or uid is undefined or empty, the mapping is not added.
 *
 * @param {string} service The service to add.
 * @param {string} uid The uid corresponding to the service.
 */
historian.util.ServiceMapper.prototype.addService = function(service, uid) {
  if (uid && service) {
    this.mapping_[service] = uid;
  }
};


/**
 * Returns the uid for a service.
 * @param {string} service The service to get the UID for.
 * @return {string} The uid for the service, empty string if none found.
 */
historian.util.ServiceMapper.prototype.uid = function(service) {
  if (service in this.mapping_) {
    return this.mapping_[service];
  }
  return '';
};


/**
 * Parses the given csv data, and returns an object containing the battery level
 * and other series data, as well as aggregating the sync app and
 * wake lock metrics.
 * @param {string} csvText Historian data in CSV format.
 * @return {!historian.AllData} Series data.
 */
historian.util.readCsv = function(csvText) {
  var data = {};
  data.serviceMapper = new historian.util.ServiceMapper();

  var csv = d3.csv.parse(csvText, function(d) {
    var entry = {
      metric: d.metric,
      type: d.type,
      start_time: +d.start_time,
      end_time: +d.end_time,
      value: d.value
    };
    if (d.type == 'service') {
      data.serviceMapper.addService(d.value, d.opt);
    }
    return entry;
  });


  // Find domain of the data.
  data.extent = /** @type {!Array<{number}>} */ (d3.extent(csv, function(d) {
    return d.start_time;
  }));

  // Separate data into series - each data value is added as an entry into
  // the value array for that series.
  var seriesData = /** @type {!historian.SeriesData} */ ([]);
  var unique = {};

  var syncAppIndex = 0;
  csv.forEach(function(d) {
    var name = d.metric;

    if (name in historian.util.IGNORE_METRICS_) {
      return;
    }

    // if we haven't seen the metric before, create an entry in the series
    // array.
    if (!unique.hasOwnProperty(name)) {
      var series = {
        'name': name,
        'type': d.type,
        'values': []
      };
      unique[name] = series;
      if (name !== 'level') {
        seriesData.push(series);
      }
      if (name in historian.util.metricsToAggregate) {
        historian.util.metricsToAggregate[name] = seriesData.length - 1;
      }
    }
    // Add entry into value array for that series.
    var series = unique[name];
    var entry = {
      'start_time': +d.start_time,
      'end_time': +d.end_time,
      'value': d.value
    };
    if (d.type === 'int') {
      entry.value = +d.value;
    }
    series.values.push(entry);
  });

  // wakelock_in replaces wake_lock
  // Some wake lock csv entries may still have been generated.
  if ('wakelock_in' in unique) {
    if ('Partial wakelock' in unique) {
      var index = seriesData.indexOf(unique['Partial wakelock']);
      seriesData.splice(index, 1);
      delete unique['Partial wakelock'];
    }
  }

  historian.util.generateIndexes_(seriesData, unique);

  seriesData.forEach(function(serie) {
    serie.values.sort(compareEntries);
  });

  // Aggregate metrics that can have overlapping data points for time values.
  for (var m in historian.util.metricsToAggregate) {
    var index = historian.util.metricsToAggregate[m];;
    if (index !== -1) {
      var aggregated = historian.util.aggregateData_(unique[m]);
      seriesData[index] = aggregated;
    }
  }
  // Create a color function for each series.
  historian.color.generateSeriesColors(seriesData);

  data.barData = seriesData;

  if (!('level' in unique)) {
    unique['level'] = {
      'name': 'level',
      'type': 'int',
      'values': []
    };
  }
  data.levelData = /** @type {!historian.SerieData} */ (unique['level'].values);
  return (data);
};


/**
 * Assigns an index to each metric, some of which are predefined.
 * This determines the order in which the metrics are rendered.
 * @param {!historian.SeriesData}
 *    seriesData The Series to generate indexes for.
 * @param {Object} exists The hashmap of series name to series object.
 * @private
 */
historian.util.generateIndexes_ = function(seriesData, exists) {
  var definedOrder = [
    'Reboot',
    'CPU running',
    'wakelock_in',
    'Partial wakelock',
    'Screen',
    'Brightness',
    'SyncManager app',
    'JobScheduler',
    'Wifi full lock',
    'Wifi scan',
    'Phone scanning',
    'Phone state',
    'GPS',
    'Mobile radio',
    'Data connection',
    'Signal strength',
    'Network connectivity',
    'Video',
    'Power Save Mode',
    'Doze Mode',
    'Phone call',
    'Sensor',
    'Top app',
    'Foreground process'
  ];
  var order = {};
  var index = 0;
  for (var i = 0; i < definedOrder.length; i++) {
    var s = definedOrder[i];
    if (s in exists) {
      order[s] = index;
      index++;
    }
  }

  var numSeries = seriesData.length;
  var nextAvailableIndex = numSeries - Object.keys(order).length - 1;
  seriesData.forEach(function(s) {
    var name = s['name'];
    // Always display charging status last. Allocate index at the end.
    if (name == 'charging status') {
    } else if (name in order) {
      s['index'] = numSeries - order[name] - 1;
    } else {
      s['index'] = nextAvailableIndex;
      nextAvailableIndex--;
    }
  });
  if ('charging status' in exists) {
    exists['charging status']['index'] = nextAvailableIndex;
  }
};


/**
 * How far to cluster based on the given min duration.
 * @private
 */
historian.util.CLUSTER_DISTANCE_MULTIPLE_ = 8;


/**
 * Group together data points close to each other.
 * @param {!historian.SeriesData} seriesData The data to cluster.
 * @param {number} minDuration The smallest duration visible for the
 *   current zoom level.
 * @return {!Array<!historian.ClusteredSerieData>} Clustered data.
 */
historian.util.cluster = function(seriesData, minDuration) {
  var clusteredSeriesData = [];

  seriesData.forEach(function(serie) {
    if (serie.values.length == 0) {
      return;
    }
    var serieData = [];
    clusteredSeriesData.push({
      'name': serie.name,
      'type': serie.type,
      'values': serieData,
      'index': serie.index,
      'color': serie.color
    });

    var startIndex = 0;

    // Skip blank entries.
    while (startIndex < serie.values.length &&
        !historian.util.isNonBlankEntry_(serie, serie.values[startIndex])) {
      startIndex++;
    }

    // No non blank entries to cluster.
    if (startIndex == serie.values.length) {
      return;
    }
    var clusteredEntry =
        new historian.util.ClusterEntry(serie.values[startIndex]);

    for (var i = startIndex + 1; i < serie.values.length; i++) {
      var d = serie.values[i];

      if (!historian.util.isNonBlankEntry_(serie, d)) {
        // Skip entries of value 0 while clustering.
        continue;
      }

      var greatestClusterEndTime =
          clusteredEntry.first_entry_end_time +
          (minDuration * historian.util.CLUSTER_DISTANCE_MULTIPLE_);

      // If the entry is far from the previous cluster, start a new cluster.
      if (d.start_time >= greatestClusterEndTime) {
        serieData.push(clusteredEntry);
        clusteredEntry = new historian.util.ClusterEntry(d);

      // If the current entry and the previous cluster are visible for the
      // current zoom level, don't cluster them together.
      // Create a new cluster for the current entry.
      } else if (historian.util.duration(d) >= minDuration &&
          clusteredEntry.active_duration >= minDuration) {

        serieData.push(clusteredEntry);
        clusteredEntry = new historian.util.ClusterEntry(d);
      } else {
        clusteredEntry.add_(d);
      }
    }
    serieData.push(clusteredEntry);
  });
  return clusteredSeriesData;
};



/**
 * Class for holding entries belonging to a cluster.
 * @param {(!historian.Entry | !historian.AggregatedEntry)} d
 *     The data entry to start cluster with.
 * @constructor
 */
historian.util.ClusterEntry = function(d) {
  /**
   * Map from value to count and duration.
   * @type {Object}
   */
  this.clustered_values = {};

  /** @type {number} */
  this.start_time = d.start_time;

  /** @type {number} */
  this.end_time = d.end_time;

  /** @type {number} */
  this.first_entry_end_time = d.end_time;

  /** @type {number} */
  this.clustered_count = 0;

  /** @type {number} */
  this.active_duration = 0;

  this.add_(d);
};


/**
 * Adds entry to the cluster.
 * @param {(!historian.Entry | !historian.AggregatedEntry)} d
 *     The data entry to add.
 * @private
 */
historian.util.ClusterEntry.prototype.add_ = function(d) {
  if (this.end_time < d.end_time) {
    this.end_time = d.end_time;
  }

  this.active_duration += historian.util.duration(d);

  var values = [];
  if (d.services != null) {
    // Aggregated entry, more than 1 service exists.
    values = d.services;
  } else {
    values.push(d.value);
  }

  this.clustered_count += values.length;

  values.forEach(function(v) {
    if (!(this.clustered_values.hasOwnProperty(v))) {
      this.clustered_values[v] = {'count': 0, 'duration': 0};
    }
    this.clustered_values[v]['count']++;
    this.clustered_values[v]['duration'] += historian.util.duration(d);
  }, this);
};


/**
 * Returns the value to duration map as an array, sorted by duration
 * in descending order.
 * @return {Array.<!Object>}
 */
historian.util.ClusterEntry.prototype.getSortedValues = function() {
  var sorted = [];

  for (var key in this.clustered_values) {
    sorted.push({
      'value': key,
      'count': this.clustered_values[key]['count'],
      'duration': this.clustered_values[key]['duration']
    });
  }

  sorted.sort(function(a, b) {
    if (a['duration'] < b['duration']) {
      return 1;
    } else if (a['duration'] > b['duration']) {
      return -1;
    }
    return 0;
  });
  return sorted;
};


/**
 * Returns the value with the maximum duration.
 * @return {(number | string)}
 */
historian.util.ClusterEntry.prototype.getMaxValue = function() {
  var maxValue = '';
  for (var v in this.clustered_values) {
    var duration = this.clustered_values[v]['duration'];
    if (maxValue == '') {
      maxValue = v;
    } else {
      var curMaxDuration = this.clustered_values[maxValue]['duration'];
      if (duration > curMaxDuration) {
        maxValue = v;
      }
    }
  }
  return maxValue;
};


/**
 * Values for a metric that won't be displayed as colored lines.
 * @private @const {!Object}
 */
historian.util.BLANK_VALUES_ = {
  'data conn': 'none'
};


/**
 * Returns true if the entry would be rendered as a non blank line.
 * @param {!historian.SerieData} serie The series the data entry belongs to.
 * @param {(!historian.Entry | !historian.AggregatedEntry)} d Entry.
 * @return {boolean} True if non empty, false otherwise.
 * @private
 */
historian.util.isNonBlankEntry_ = function(serie, d) {
  if (serie.type === 'int' && d.value == 0) {
    return false;
  }
  if (serie.name in historian.util.BLANK_VALUES_) {
    if (historian.util.BLANK_VALUES_[serie.name] == d.value) {
      return false;
    }
  }

  return true;
};


/**
 * Returns the ms duration of a data entry.
 * @param {Object} d Entry to calculate duration of.
 * @return {number} Duration in ms.
 */
historian.util.duration = function(d) {
  return (d.end_time - d.start_time);
};

goog.exportSymbol('historian.formatString', goog.string.subs);
