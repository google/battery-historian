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

goog.provide('historian.Historian');

goog.require('historian.Bars');
goog.require('historian.Context');
goog.require('historian.LevelLine');
goog.require('historian.util');


/**
 * A single data point for a serie.
 *
 * @typedef {{
 *   start_time: number,
 *   end_time: number,
 *   value: (string | number)
 * }}
 */
historian.Entry;


/**
 * A single data point for a aggregated serie.
 *
 * @typedef {{
 *   start_time: number,
 *   end_time: number,
 *   value: (string | number),
 *   services: !Array<string>
 * }}
 */
historian.AggregatedEntry;


/**
 * The data for a single serie.
 *
 * @typedef {{
 *   name: string,
 *   type: string,
 *   values: Array<(!historian.Entry|!historian.AggregatedEntry)>,
 *   index: number,
 *   color: (function(string): string | undefined)
 * }}
 */
historian.SerieData;


/**
 * The clustered data for a single serie.
 *
 * @typedef {{
 *   name: string,
 *   type: string,
 *   values: Array<(!historian.util.ClusterEntry)>,
 *   index: number,
 *   color: (function(string): string | undefined)
 * }}
 */
historian.ClusteredSerieData;


/**
 * The data for all the series.
 *
 * @typedef {!Array<!historian.SerieData>}
 */
historian.SeriesData;


/**
 * The object for the level line, bar data, graph extent and service mappings.
 *
 * @typedef {{
 *   barData: !historian.SeriesData,
 *   levelData: !historian.SerieData,
 *   extent: !Array<number>,
 *   serviceMapper: !historian.util.ServiceMapper
 * }}
 */
historian.AllData;


/**
 * Creates the historian graph from the csv data.
 * @export
 */
historian.render = function() {
  var historianCsv = d3.select('#csv-data')
      .text();
  var data = historian.util.readCsv( /** @type {string} */ (historianCsv));

  var context = new historian.Context(data.extent, data.barData.length);
  var bars = new historian.Bars(context, data.barData, data.serviceMapper);
  var levelLine = new historian.LevelLine(context, data.levelData);
};
