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
goog.require('historian.historianV2Logs');
goog.require('historian.metrics.Csv');


/**
 * Tests getting a config with data for a non default metric.
 */
var testGetConfigWithData = function() {
  var configs = new historian.LevelConfigs(1000, {});
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
    showExtraSummary: false,
    ticksShortForm: false,
    ticksAsFormattedInts: false,
    id: 'testmetric',
    name: name,
    legendText: name,
    levelDisplayText: name,
    yDomain: {min: 10, max: 200},
    isRateOfChange: false,
    opacity: 1
  };
  var got = configs.getConfig(name, false, data);
  assertObjectEquals(want, got);
};


/**
 * Tests getting a config for rate of change data.
 */
var testGetRateOfChangeConfig = function() {
  var configs = new historian.LevelConfigs(1000, {});
  var data = [
    {
      startTime: 0,
      endTime: 20000,
      value: 100
    },
    {
      startTime: 20000,
      endTime: 40000,
      value: -200
    },
    {
      // Short event which should be ignored when calculating the yDomain.
      startTime: 40000,
      endTime: 41000,
      value: -1200
    },
    {
      startTime: 41000,
      endTime: 52000,
      value: 10
    }
  ];
  var name = 'Test rate of change metric';
  var want = {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge: null,
    formatLevel: null,
    showExtraSummary: false,
    ticksShortForm: false,
    ticksAsFormattedInts: false,
    id: 'testrateofchangemetric',
    name: name,
    legendText: name,
    levelDisplayText: name,
    yDomain: {min: -200, max: 200},
    isRateOfChange: true,
    opacity: 1
  };
  var got = configs.getConfig(name, true, data);
  assertObjectEquals(want, got);
};


/**
 * Tests getting a config without passing in data for a non default metric.
 */
var testGetConfigNoData = function() {
  var configs = new historian.LevelConfigs(1000, {});
  var name = 'Test metric';
  var want = {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge: null,
    formatLevel: null,
    showExtraSummary: false,
    ticksShortForm: false,
    ticksAsFormattedInts: false,
    id: 'testmetric',
    name: name,
    legendText: name,
    levelDisplayText: name,
    yDomain: historian.LevelConfigs.DEFAULT_Y_DOMAIN_,
    isRateOfChange: false,
    opacity: 1
  };
  var got = configs.getConfig(name);
  assertObjectEquals(want, got);
};


/**
 * Tests the battery level config is returned if display power monitor is
 * false.
 */
var testBatteryLevelConfig = function() {
  var data =
      historian.data.processHistorianV2Data([], 2300, {}, '', false, {});
  var want = {
    displayPowerInfo: false,
    enableSampling: false,
    formatDischarge:
        historian.LevelConfigs.formatBatteryDischarge_.bind(undefined, 2300),
    formatLevel:
        historian.LevelConfigs.batteryPercentage_.bind(undefined, 2300),
    showExtraSummary: true,
    id: 'batterylevel',
    name: historian.metrics.Csv.BATTERY_LEVEL,
    legendText: 'Battery Level',
    levelDisplayText: 'Battery Level',
    yDomain: historian.LevelConfigs.DEFAULT_Y_DOMAIN_,
    isRateOfChange: false,
    opacity: 1
  };
  assertObjectEquals(want, data.configs.getConfig(data.defaultLevelMetric));
};


/**
 * Tests the power monitor config is returned if display power monitor is true.
 */
var testPowerMonitorConfig = function() {
  var data =
      historian.data.processHistorianV2Data([], 2300, {}, '', true, {});
  assertObjectEquals(historian.LevelConfigs.powerMonitorConfig_([]),
      data.configs.getConfig(data.defaultLevelMetric));

  var csv = [
    'metric,type,start_time,end_time,value,opt',
    historian.metrics.Csv.POWER_MONITOR + ',int,1000,2000,-10',
    historian.metrics.Csv.POWER_MONITOR + ',int,2000,3000,1001'
  ].join('\n');
  var logs = [{
    source: historian.historianV2Logs.Sources.POWER_MONITOR, csv: csv
  }];
  // Non default y domain.
  data = historian.data.processHistorianV2Data(logs, 2300, {}, '', true, {});
  assertObjectEquals({min: -10, max: 1001},
      data.configs.getConfig(data.defaultLevelMetric).yDomain);
};


/**
 * Tests other predefined configs are set correctly.
 */
var testPredefinedConfigs = function() {
  var csv = [
    'metric,type,start_time,end_time,value,opt',
    'Temperature,int,100,2000,100,',
    'Temperature,int,2000,3000,111,',
    'Temperature,int,3000,5000,193,',
    'Temperature,int,5000,9000,53,'
  ].join('\n');

  var logs = [
    {
      source: historian.historianV2Logs.Sources.BATTERY_HISTORY,
      csv: csv
    }
  ];

  var data =
      historian.data.processHistorianV2Data(logs, 2300, {}, '', true, {});
  assertObjectEquals({min: 5.3, max: 19.3},
      data.configs.getConfig(historian.metrics.Csv.TEMPERATURE).yDomain);
};
