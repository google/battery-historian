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

goog.provide('historian.levelConfigsTest');
goog.setTestOnly('historian.levelConfigsTest');

goog.require('goog.testing.jsunit');
goog.require('historian.LevelConfigs');
goog.require('historian.data');


/**
 * Tests getting a config with data for a non default metric.
 */
var testGetConfigWithData = function() {
  var configs = new historian.LevelConfigs(1000, []);
  var data = [
    {
      value: 100
    },
    {
      value: 200
    },
    {
      value: 10
    }
  ];
  var name = 'Test metric';
  var want = {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge: null,
    formatLevel: null,
    id: 'testmetric',
    name: name,
    legendText: name,
    levelDisplayText: name,
    hiddenBarMetrics: [],
    yDomain: {min: 10, max: 200}
  };
  var got = configs.getConfig(name, data);
  assertObjectEquals(want, got);
};


/**
 * Tests getting a config without passing in data for a non default metric.
 */
var testGetConfigNoData = function() {
  var configs = new historian.LevelConfigs(1000, []);
  var name = 'Test metric';
  var want = {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge: null,
    formatLevel: null,
    id: 'testmetric',
    name: name,
    legendText: name,
    levelDisplayText: name,
    hiddenBarMetrics: [],
    yDomain: historian.LevelConfigs.DEFAULT_Y_DOMAIN_
  };
  var got = configs.getConfig(name);
  assertObjectEquals(want, got);
};


/**
 * Tests the battery level config is returned if display powermonitor if false.
 */
var testBatteryLevelConfig = function() {
  var data = historian.data.processHistorianV2Data('', 2300, {}, '', false);
  assertObjectEquals(historian.LevelConfigs.batteryLevelConfig_(2300),
      data.configs.getConfig(data.defaultLevelMetric));
};


/**
 * Tests the powermonitor config is returned if display powermonitor if true.
 */
var testPowermonitorConfig = function() {
  var data = historian.data.processHistorianV2Data('', 2300, {}, '', true);
  assertObjectEquals(historian.LevelConfigs.powermonitorConfig_([]),
      data.configs.getConfig(data.defaultLevelMetric));

  var header = 'metric,type,start_time,end_time,value,opt\n';
  // Non default y domain.
  data = historian.data.processHistorianV2Data(
      header + 'Powermonitor,int,1000,2000,-10,\n' +
      'Powermonitor,int,2000,3000,1001,\n',
      2300, {}, '', true);
  assertObjectEquals({min: -10, max: 1001},
      data.configs.getConfig(data.defaultLevelMetric).yDomain);
};
