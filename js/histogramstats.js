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

/**
 * @fileoverview Utilities to display histogram charts for system-stats metrics.
 */
goog.provide('historian.FloatLevel');
goog.provide('historian.HistogramStats');
goog.provide('historian.histogramstats');
goog.provide('historian.histogramstats.ABData');
goog.provide('historian.histogramstats.MetricMap');
goog.provide('historian.histogramstats.Series');
goog.provide('historian.histogramstats.TopMetric');

goog.require('goog.array');
goog.require('goog.functions');
goog.require('goog.string');
goog.require('historian.tables');
goog.require('historian.time');


/**
 * Chart formatters used frequently.
 * @enum {string}
 */
historian.histogramstats.Formatters = {
  FONT_FAMILY: 'Verdana, Arial, Helvetica, Tahoma, sans-serif',
  LIGHT_GRAY1: '#f0f0f0',
  LIGHT_GRAY2: '#D1D1D1',
  DARK_GRAY: '#7A7A7A',
  BLUE1: '#80C3FD',
  BLUE2: '#0089FF',
  BLUE3: 'rgba(94, 169, 251, 0.7)',
  RED1: '#F39494',
  RED2: '#f14d4d',
  RED3: 'rgba(251, 98, 94, 0.7)',
  NORTH_EAST: 'ne',
  CENTER: 'center',
  ABSOLUTE: 'absolute',
  NONE: 'none',
  SLOW: 'slow'
};


/**
 * Misc string constants used frequently.
 * @enum {string}
 */
historian.histogramstats.Constants = {
  PERCENTAGE: 'Percentage',
  BLANK: '',
  ANR: 'anr',
  CRASH: 'crash',
  WIFI: 'wifi',
  MOBILE: 'mobile',
  KB_PER_HR: 'KB/Hr',
  MB_PER_HR: 'MB/Hr',
  COUNT_PER_HR: 'Count/Hr',
  SEC_PER_HR: 'Sec/Hr'
};


/**
 * File comparison order options.
 * @enum {number}
 */
historian.histogramstats.Order = {
  FILE1_VS_FILE2: 0,
  FILE2_VS_FILE1: 1
};


// Histogram chart positioning related constants.
/** @private @const {number} */
historian.histogramstats.LEFT1_ = 65;


/** @private  @const {number} */
historian.histogramstats.LEFT2_ = 15;


/** @const {number} */
historian.histogramstats.LEFT_AB = 30;


/** @const {number} */
historian.histogramstats.TOP = 20;


/** @const {number} */
historian.histogramstats.BOTTOM = 5;


/** @const {number} */
historian.histogramstats.FONT_SIZE = 9;


/** @const {number} */
historian.histogramstats.LABEL_WIDTH = 100;


/** @const {number} */
historian.histogramstats.AB_LABEL_WIDTH = 30;


/** @const {number} */
historian.histogramstats.LABEL_PADDING = 5;


/** @const {number} */
historian.histogramstats.BAR_WIDTH = 0.33;


/** @const {number} */
historian.histogramstats.LINE_WIDTH = 1;


/** @const {number} */
historian.histogramstats.MAX_BARS = 9;


/** @const {number} */
historian.histogramstats.AB_MAX_BARS = 15;


/** @const {number} */
historian.histogramstats.LABEL_MARGIN = 8;


/**
 * Singleton for storing file ordering global state.
 * @const {{
 *   getInstance: function(): {
 *     get: function(number): string,
 *     set: function(string, number)
 *   }
 * }}
 */
historian.histogramstats.fileOrdering = (function() {
  var instance;
  var init = function() {
    var file1File2 = '';
    var file2File1 = '';
    // Order represents the file ordering.
    // 0 -> file 1 vs file 2 and 1 -> file 2 vs file 1
    var setStr = function(str, order) {
      order == 0 ? file1File2 = str : file2File1 = str;
    };
    var set = function(newStr, order) {
      setStr(newStr, order);
    };
    var get = function(order) {
      var ret;
      order == 0 ? ret = file1File2 : ret = file2File1;
      return ret;
    };
    return {
      get: get,
      set: set
    };
  };
  return {
    getInstance: function() {
      if (!instance) {
        instance = init();
      }
      return instance;
    }
  };
})();


/** @private {string} */
historian.histogramstats.file1_ = 'File #1';


/** @private {string} */
historian.histogramstats.file2_ = 'File #2';


/**
 * Histogram chart tooltip formatting constants.
 * @enum {number}
 */
historian.histogramstats.Tooltip = {
  FADE_IN_MSEC: 200,
  CHAR_TO_PIXEL_MULTIPLIER: 7,
  SPACE_ADJUST: 5
};


/**
 * Bar Chart name string constants.
 * @enum {string}
 */
historian.histogramstats.Charts = {
  USAGE: '#usagechart',
  WAKELOCK: '#wakelockchart',
  SCREEN: '#screenchart',
  DATA: '#datachart',
  COMM: '#commchart',
  APP: '#appchart',
  AB: '#abchart',
  TOOLTIP: '#chart-tooltip',
  SCREEN_PIE_CHART1: '#screenpiechart1',
  SCREEN_PIE_CHART2: '#screenpiechart2',
  WIFI_PIE_CHART1: '#wifipiechart1',
  WIFI_PIE_CHART2: '#wifipiechart2',
  SIGNAL_PIE_CHART1: '#signalpiechart1',
  SIGNAL_PIE_CHART2: '#signalpiechart2'
};


/**
 * @typedef {{
 *   V: number,
 *   L: string
 * }}
 */
historian.FloatLevel;


/**
 * The SummaryStats data received from server analyzer.
 *
 * @typedef {{
 *   ScreenOffDischargeRatePerHr:   historian.FloatLevel,
 *   ScreenOnDischargeRatePerHr:    historian.FloatLevel,
 *   ScreenOffUptimePercentage:     number,
 *   ScreenOnTimePercentage:        number,
 *   PartialWakelockTimePercentage: number,
 *   KernelOverheadTimePercentage:  number,
 *   SignalScanningTimePercentage:  number,
 *   MobileActiveTimePercentage:    number,
 *   MobileKiloBytesPerHr:          historian.FloatLevel,
 *   WifiKiloBytesPerHr:            historian.FloatLevel,
 *   PhoneCallTimePercentage:       number,
 *   DeviceIdlingTimePercentage:    number,
 *   FullWakelockTimePercentage:    number,
 *   InteractiveTimePercentage:     number,
 *   WifiDischargeRatePerHr:        historian.FloatLevel,
 *   BluetoothDischargeRatePerHr:   historian.FloatLevel,
 *   ModemDischargeRatePerHr:       historian.FloatLevel,
 *   WifiOnTimePercentage:          number,
 *   WifiTransferTimePercentage:    number,
 *   WifiScanTimePercentage:        number,
 *   BluetoothOnTimePercentage:     number,
 *   ModemTransferTimePercentage:   number,
 *   TotalAppGPSUseTimePerHour:     number,
 *   TotalAppANRCount:              number,
 *   TotalAppCrashCount:            number,
 *   TotalAppSyncsPerHr:            number,
 *   TotalAppWakeupsPerHr:           number,
 *   TotalAppCPUPowerPct:           number,
 *   BluetoothTransferTimePercentage:     number,
 *   DeviceIdleModeEnabledTimePercentage: number,
 *   LowPowerModeEnabledTimePercentage: number,
 *   TotalAppFlashlightUsePerHr:    number,
 *   TotalAppCameraUsePerHr:        number,
 *   ConnectivityChanges:           number,
 *   ScreenBrightness:   !Object<number>,
 *   SignalStrength:     !Object<number>,
 *   WifiSignalStrength: !Object<number>,
 *   BluetoothState:     !Object<number>,
 *   DataConnection:     !Object<number>
 * }}
 */
historian.HistogramStats;


/**
 * Bar chart tooltip content.
 * @typedef {{
 *   tip: string,
 *   len: number
 * }}
 * @private
 */
historian.histogramstats.ToolTip_;


/**
 * Returns a dummy empty tooltip object.
 * @return {!historian.histogramstats.ToolTip_}
 */
historian.histogramstats.emptyToolTip = goog.functions.constant({
  tip: historian.histogramstats.Constants.BLANK,
  len: 0
});


/**
 * @typedef {{
 *   series: !Array<!Array<number>>,
 *   ticks: !Array<!Array<number|string>>
 * }}
 */
historian.histogramstats.ABData;


/**
 * @typedef {{
 *   series1: !Array<!Array<number>>,
 *   series2: !Array<!Array<number>>,
 *   ticks: !Array<!Array<number|string>>
 * }}
 */
historian.histogramstats.Series;


/**
 * Map for data metrics.
 * Key - Name of the metric.
 * Value - Combined Checkin object for both the files.
 * @typedef {
 *   !Object<string, !historian.requests.CombinedCheckinData>
 * }
 */
historian.histogramstats.MetricMap;


// Total and normalized values for top metrics.
// These values are only used to populate the top metrics table.
// Not every metric has a count/value, we store (and display) a '-' when no
// count/value is found.
/**
 * @typedef {{
 *   metric: string,
 *   name: string,
 *   value1: string,
 *   nvalue1: string,
 *   count1: string,
 *   ncount1: string,
 *   value2: string,
 *   nvalue2: string,
 *   count2: string,
 *   ncount2: string
 * }}
 */
historian.histogramstats.TopMetric;


/**
 * Color Map for pie charts.
 * @typedef {
 *   !Object.<string, string>
 * }
 */
historian.histogramstats.colorMap = {};


/** @type {!Array<!historian.histogramstats.TopMetric>} */
historian.histogramstats.topMetricTable12 = [];


/** @type {!Array<!historian.histogramstats.TopMetric>} */
historian.histogramstats.topMetricTable21 = [];


/**
 * Bar chart label strings.
 * @enum {string}
 */
historian.histogramstats.Labels = {
  PARTIAL_WL_TIME: 'Partial Wakelock Time',
  KERNEL_WL_TIME: 'Kernel Wakelock Time',
  MOBILE_DATA_USE: 'Mobile Data Use',
  WIFI_DATA_USE: 'Wifi Data Use',
  APP_SYNCS_TIME: 'App Syncs Time',
  APP_GPS_USE_TIME: 'App GPS Use Time',
  APP_ANR_COUNT: 'App ANR Count',
  APP_CRASH_COUNT: 'App Crash Count',
  APP_ALARMS: 'App Alarms',
  PARTIAL_WL_TIME_P: 'Partial Wakelock Time (%)',
  KERNEL_OVERHEAD_TIME_P: 'Kernel Overhead Time (%)',
  WIFI_TRANSFER_RATE: 'Wifi Transfer Rate',
  MOBILE_TRANSFER_RATE: 'Mobile Transfer Rate',
  TOTAL_APP_CRASH_COUNT: 'Total App Crash Count,',
  TOTAL_APP_ANR_COUNT: 'Total App Anr Count',
  TOTAL_APP_CPU_USE: 'Total App CPU Use (% Battery Use)',
  TOTAL_APP_FLASH_USE: 'Total App Flashlight Use (Sec/Hr)',
  TOTAL_APP_CAMERA_USE: 'Total App Camera Use (Sec/Hr)',
  TOTAL_APP_SYNCS: 'Total App Syncs (Sec/Hr)',
  TOTAL_APP_GPS_USE: 'Total App GPS Use (Sec/Hr)',
  TOTAL_APP_ALARMS: 'Total App Alarms (Count/Hr)'
};


/**
 * Generates mapping from metric names to tables.
 */
historian.histogramstats.generateMetricsMap = function() {
  historian.histogramstats.MetricMap = {};
  // AB bar graph labels
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.PARTIAL_WL_TIME] =
      historian.histogramstats.combinedCheckin.UserspaceWakelocksCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.KERNEL_WL_TIME] =
      historian.histogramstats.combinedCheckin.KernelWakelocksCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.MOBILE_DATA_USE] =
      historian.histogramstats.combinedCheckin.TopMobileTrafficAppsCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.WIFI_DATA_USE] =
      historian.histogramstats.combinedCheckin.TopWifiTrafficAppsCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.APP_SYNCS_TIME] =
      historian.histogramstats.combinedCheckin.SyncTasksCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.APP_GPS_USE_TIME] =
      historian.histogramstats.combinedCheckin.GPSUseCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.APP_ANR_COUNT] =
      historian.histogramstats.combinedCheckin.ANRAndCrashCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.APP_CRASH_COUNT] =
      historian.histogramstats.combinedCheckin.ANRAndCrashCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.APP_ALARMS] =
      historian.histogramstats.combinedCheckin.AppWakeupsCombined;

  // Other graph labels
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.PARTIAL_WL_TIME_P] =
      historian.histogramstats.combinedCheckin.UserspaceWakelocksCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.KERNEL_OVERHEAD_TIME_P] =
      historian.histogramstats.combinedCheckin.KernelWakelocksCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.WIFI_TRANSFER_RATE] =
      historian.histogramstats.combinedCheckin.TopWifiTrafficAppsCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.MOBILE_TRANSFER_RATE] =
      historian.histogramstats.combinedCheckin.TopMobileTrafficAppsCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.TOTAL_APP_CPU_USE] =
      historian.histogramstats.combinedCheckin.CPUUsageCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.TOTAL_APP_FLASH_USE] =
      historian.histogramstats.combinedCheckin.FlashlightUseCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.TOTAL_APP_CAMERA_USE] =
      historian.histogramstats.combinedCheckin.CameraUseCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.TOTAL_APP_SYNCS] =
      historian.histogramstats.combinedCheckin.SyncTasksCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.TOTAL_APP_GPS_USE] =
      historian.histogramstats.combinedCheckin.GPSUseCombined;
  historian.histogramstats.MetricMap[
      historian.histogramstats.Labels.TOTAL_APP_ALARMS] =
      historian.histogramstats.combinedCheckin.AppWakeupsCombined;
};


/**
 * Generates color map for the pie chart data.
 */
historian.histogramstats.generateColorMap = function() {
  historian.histogramstats.colorMap['DARK'] = '#686868';
  historian.histogramstats.colorMap['DIM'] = '#808080';
  historian.histogramstats.colorMap['MEDIUM'] = '#D0D0D0 ';
  historian.histogramstats.colorMap['LIGHT'] = '#E8E8E8 ';
  historian.histogramstats.colorMap['BRIGHT'] = '#FFDB58';
  // Wifi Signal colors, SignalStrength colors
  historian.histogramstats.colorMap['NONE'] = '#686868';
  historian.histogramstats.colorMap['POOR'] = '#FF3300';
  historian.histogramstats.colorMap['MODERATE'] = '#FF9900';
  historian.histogramstats.colorMap['GOOD'] = '#669900';
  historian.histogramstats.colorMap['GREAT'] = '#006600';
  historian.histogramstats.colorMap['OTHER'] = '#FF99FF';
};


/**
 * Returns map value for the given key.
 * @param {string} key Item key received.
 * @return {string}
 */
historian.histogramstats.getValue = function(key) {
  return historian.histogramstats.colorMap[key];
};


/**
 * Generates data array for app data bar chart.
 * @param {!historian.HistogramStats} data1 SystemStats for file1.
 * @param {!historian.HistogramStats} data2 SystemStats for file2.
 * @return {!historian.histogramstats.Series}
 */
historian.histogramstats.createAppDataSeries = function(data1, data2) {
  var ticks = [];
  var series1 = [];
  var series2 = [];
  var index = 1;

  if (data1.TotalAppCPUPowerPct != 0 || data2.TotalAppCPUPowerPct != 0) {
    series1.push([index, (data1.TotalAppCPUPowerPct).toFixed(2)]);
    series2.push([index, (data2.TotalAppCPUPowerPct).toFixed(2)]);
    ticks.push([index, 'Total App CPU Use (% Battery Use)']);
    index++;
  }

  if (data1.TotalAppSyncsPerHr != 0 || data2.TotalAppSyncsPerHr != 0) {
    series1.push([index, (data1.TotalAppSyncsPerHr).toFixed(2)]);
    series2.push([index, (data2.TotalAppSyncsPerHr).toFixed(2)]);
    ticks.push([index, 'Total App Syncs (Sec/Hr)']);
    index++;
  }

  if (data1.TotalAppANRCount != 0 || data2.TotalAppANRCount != 0) {
    series1.push([index, (data1.TotalAppANRCount).toFixed(2)]);
    series2.push([index, (data2.TotalAppANRCount).toFixed(2)]);
    ticks.push([index, 'Total App ANR Count']);
    index++;
  }

  if (data1.TotalAppCrashCount != 0 || data2.TotalAppCrashCount != 0) {
    series1.push([index, (data1.TotalAppCrashCount).toFixed(2)]);
    series2.push([index, (data2.TotalAppCrashCount).toFixed(2)]);
    ticks.push([index, 'Total App Crash Count']);
    index++;
  }

  if (data1.TotalAppGPSUseTimePerHour != 0 ||
      data2.TotalAppGPSUseTimePerHour != 0) {
    series1.push([index, (data1.TotalAppGPSUseTimePerHour).toFixed(2)]);
    series2.push([index, (data2.TotalAppGPSUseTimePerHour).toFixed(2)]);
    ticks.push([index, 'Total App GPS Use (Sec/Hr)']);
    index++;
  }

  if (data1.TotalAppWakeupsPerHr != 0 ||
      data2.TotalAppWakeupsPerHr != 0) {
    series1.push([index, (data1.TotalAppWakeupsPerHr).toFixed(2)]);
    series2.push([index, (data2.TotalAppWakeupsPerHr).toFixed(2)]);
    ticks.push([index, 'Total App Alarms (Count/Hr)']);
    index++;
  }

  if (data1.TotalAppFlashlightUsePerHr != 0 ||
      data2.TotalAppFlashlightUsePerHr != 0) {
    series1.push([index, (data1.TotalAppFlashlightUsePerHr).toFixed(2)]);
    series2.push([index, (data2.TotalAppFlashlightUsePerHr).toFixed(2)]);
    ticks.push([index, 'Total App Flashlight Use (Sec/Hr)']);
    index++;
  }

  if (data1.TotalAppCameraUsePerHr != 0 || data2.TotalAppCameraUsePerHr != 0) {
    series1.push([index, (data1.TotalAppCameraUsePerHr).toFixed(2)]);
    series2.push([index, (data2.TotalAppCameraUsePerHr).toFixed(2)]);
    ticks.push([index, 'Total App Camera Use (Sec/Hr)']);
    index++;
  }

  return /** @type {!historian.histogramstats.Series} */ ({
    series1: series1,
    series2: series2,
    ticks: ticks
  });
};


/**
 * Generates data array for data transfer bar chart.
 * @param {!historian.HistogramStats} data1 SystemStats for file1.
 * @param {!historian.HistogramStats} data2 SystemStats for file2.
 * @return {!historian.histogramstats.Series}
 */
historian.histogramstats.createDataTransferSeries = function(data1, data2) {
  var ticks = [];
  var series1 = [];
  var series2 = [];
  var index = 1;

  if (data1.MobileKiloBytesPerHr.V != 0 || data2.MobileKiloBytesPerHr.V != 0) {
    series1.push([index, Math.round(data1.MobileKiloBytesPerHr.V)]);
    series2.push([index, Math.round(data2.MobileKiloBytesPerHr.V)]);
    ticks.push([index, 'Mobile Transfer Rate']);
    index++;
  }

  if (data1.WifiKiloBytesPerHr.V != 0 || data2.WifiKiloBytesPerHr.V != 0) {
    series1.push([index, Math.round(data1.WifiKiloBytesPerHr.V)]);
    series2.push([index, Math.round(data2.WifiKiloBytesPerHr.V)]);
    ticks.push([index, 'Wifi Transfer Rate']);
    index++;
  }

  return /** @type {!historian.histogramstats.Series} */ ({
    series1: series1,
    series2: series2,
    ticks: ticks
  });
};


/**
 * Generates data array for data transfer bar chart.
 * @param {!historian.HistogramStats} data1 SystemStats for file1.
 * @param {!historian.HistogramStats} data2 SystemStats for file2.
 * @return {!historian.histogramstats.Series}
 */
historian.histogramstats.createCommDataSeries = function(data1, data2) {
  var ticks = [];
  var series1 = [];
  var series2 = [];
  var index = 1;

  if (data1.ConnectivityChanges != 0 || data2.ConnectivityChanges != 0) {
    series1.push([index, (data1.ConnectivityChanges).toFixed(2)]);
    series2.push([index, (data2.ConnectivityChanges).toFixed(2)]);
    ticks.push([index, 'Connectivity Changes']);
    index++;
  }

  if (data1.WifiDischargeRatePerHr.V != 0 ||
      data2.WifiDischargeRatePerHr.V != 0) {
    series1.push([index, (data1.WifiDischargeRatePerHr.V).toFixed(2)]);
    series2.push([index, (data2.WifiDischargeRatePerHr.V).toFixed(2)]);
    ticks.push([index, 'Wifi Discharge Rate Per Hr']);
    index++;
  }

  if (data1.WifiTransferTimePercentage != 0 ||
      data2.WifiTransferTimePercentage != 0) {
    series1.push([index, (data1.WifiTransferTimePercentage).toFixed(2)]);
    series2.push([index, (data2.WifiTransferTimePercentage).toFixed(2)]);
    ticks.push([index, 'Wifi Transfer Time Percentage']);
    index++;
  }

  if (data1.BluetoothDischargeRatePerHr.V != 0 ||
      data2.BluetoothDischargeRatePerHr.V != 0) {
    series1.push([index, (data1.BluetoothDischargeRatePerHr.V).toFixed(2)]);
    series2.push([index, (data2.BluetoothDischargeRatePerHr.V).toFixed(2)]);
    ticks.push([index, 'Bluetooth Discharge Rate Per Hr']);
    index++;
  }

  if (data1.BluetoothOnTimePercentage != 0 ||
      data2.BluetoothOnTimePercentage != 0) {
    series1.push([index, (data1.BluetoothOnTimePercentage).toFixed(2)]);
    series2.push([index, (data2.BluetoothOnTimePercentage).toFixed(2)]);
    ticks.push([index, 'Bluetooth On Time Percentage']);
    index++;
  }

  if (data1.BluetoothTransferTimePercentage != 0 ||
      data2.BluetoothTransferTimePercentage != 0) {
    series1.push([index, (data1.BluetoothTransferTimePercentage).toFixed(2)]);
    series2.push([index, (data2.BluetoothTransferTimePercentage).toFixed(2)]);
    ticks.push([index, 'Bluetooth Transfer Time Percentage']);
    index++;
  }

  if (data1.ModemDischargeRatePerHr.V != 0 ||
      data2.ModemDischargeRatePerHr.V != 0) {
    series1.push([index, (data1.ModemDischargeRatePerHr.V).toFixed(2)]);
    series2.push([index, (data2.ModemDischargeRatePerHr.V).toFixed(2)]);
    ticks.push([index, 'Modem Discharge Rate Per Hr']);
    index++;
  }

  if (data1.ModemTransferTimePercentage != 0 ||
      data2.ModemTransferTimePercentage != 0) {
    series1.push([index, (data1.ModemTransferTimePercentage).toFixed(2)]);
    series2.push([index, (data2.ModemTransferTimePercentage).toFixed(2)]);
    ticks.push([index, 'Modem Transfer Time Percentage']);
    index++;
  }

  return /** @type {!historian.histogramstats.Series} */ ({
    series1: series1,
    series2: series2,
    ticks: ticks
  });
};


/**
 * Returns a relative comparison between a metric for file1 and file2.
 * If both the values are the same, the comparison is empty so null is returned.
 * @param {number} d1 numerator
 * @param {number} d2 denominator
 * @return {?number}
 */
historian.histogramstats.getRatio = function(d1, d2) {
  d1 = Number(d1.toFixed(1));
  d2 = Number(d2.toFixed(1));
  if (d1 == d2) {
    return null;
  }
  if (d1 == 0) {
    return -d2;
  }
  if (d2 == 0) {
    return d1;
  }
  var ratio = (d1 / d2);
  return ratio < 1 ? -((1 / ratio).toFixed(1)) : +(ratio.toFixed(1));
};


/**
 * Generates data array for A/B bar chart.
 * @param {!historian.HistogramStats} data1 SystemStats received
     from the server.
 * @param {!historian.HistogramStats} data2 SystemStats received
     from the server.
 * @return {historian.histogramstats.ABData}
 */
historian.histogramstats.createABDataSeries = function(data1, data2) {
  var res = [];
  var ABticks = [];
  var index = 1;

  var ratio = historian.histogramstats.getRatio(
      data1.ScreenOnDischargeRatePerHr.V,
      data2.ScreenOnDischargeRatePerHr.V);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, 'Screen On Discharge Rate']);
    index++;
  }

  ratio = historian.histogramstats.getRatio(
      data1.ScreenOffDischargeRatePerHr.V,
      data2.ScreenOffDischargeRatePerHr.V);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, 'Screen Off Discharge Rate']);
    index++;
  }

  ratio = historian.histogramstats.getRatio(
      data1.ScreenOffUptimePercentage,
      data2.ScreenOffUptimePercentage);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, 'Screen Off Uptime']);
    index++;
  }

  ratio = historian.histogramstats.getRatio(
      data1.PartialWakelockTimePercentage,
      data2.PartialWakelockTimePercentage);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, historian.histogramstats.Labels.PARTIAL_WL_TIME]);
    index++;
  }

  ratio = historian.histogramstats.getRatio(
      data1.KernelOverheadTimePercentage,
      data2.KernelOverheadTimePercentage);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, historian.histogramstats.Labels.KERNEL_WL_TIME]);
    index++;
  }

  ratio = historian.histogramstats.getRatio(
      data1.MobileKiloBytesPerHr.V,
      data2.MobileKiloBytesPerHr.V);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, historian.histogramstats.Labels.MOBILE_DATA_USE]);
    index++;
  }

  ratio = historian.histogramstats.getRatio(
      data1.WifiKiloBytesPerHr.V,
      data2.WifiKiloBytesPerHr.V);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, historian.histogramstats.Labels.WIFI_DATA_USE]);
    index++;
  }

  var data1SuspendTimePercentage = 100 -
      (data1.ScreenOffUptimePercentage + data1.ScreenOnTimePercentage);
  var data2SuspendTimePercentage = 100 -
      (data2.ScreenOffUptimePercentage + data2.ScreenOnTimePercentage);

  ratio = historian.histogramstats.getRatio(
      data1SuspendTimePercentage,
      data2SuspendTimePercentage);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, 'Suspend Time']);
    index++;
  }

  ratio = historian.histogramstats.getRatio(
      data1.TotalAppSyncsPerHr,
      data2.TotalAppSyncsPerHr);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, historian.histogramstats.Labels.APP_SYNCS_TIME]);
    index++;
  }

  ratio = historian.histogramstats.getRatio(
      data1.TotalAppGPSUseTimePerHour,
      data2.TotalAppGPSUseTimePerHour);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, historian.histogramstats.Labels.APP_GPS_USE_TIME]);
    index++;
  }

  ratio = historian.histogramstats.getRatio(
      data1.InteractiveTimePercentage,
      data2.InteractiveTimePercentage);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, 'Interactive Time']);
    index++;
  }
  ratio = historian.histogramstats.getRatio(
      data1.TotalAppANRCount,
      data2.TotalAppANRCount);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, historian.histogramstats.Labels.APP_ANR_COUNT]);
    index++;
  }
  ratio = historian.histogramstats.getRatio(
      data1.TotalAppCrashCount,
      data2.TotalAppCrashCount);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, historian.histogramstats.Labels.APP_CRASH_COUNT]);
    index++;
  }

  ratio = historian.histogramstats.getRatio(
      data1.TotalAppWakeupsPerHr,
      data2.TotalAppWakeupsPerHr);
  if (ratio != null) {
    res.push([index, ratio]);
    ABticks.push([index, historian.histogramstats.Labels.APP_ALARMS]);
    index++;
  }

  return {
    ticks: ABticks,
    series: res
  };
};


/**
 * Generates data array for device usage bar chart.
 * @param {!historian.HistogramStats} data1 SystemStats for file1.
 * @param {!historian.HistogramStats} data2 SystemStats for file2.
 * @return {!historian.histogramstats.Series}
 */
historian.histogramstats.createUsageDataSeries = function(data1, data2) {
  var ticks = [];
  var series1 = [];
  var series2 = [];
  var index = 1;

  if (data1.MobileActiveTimePercentage != 0 ||
      data2.MobileActiveTimePercentage != 0) {
    series1.push([index, (data1.MobileActiveTimePercentage).toFixed(2)]);
    series2.push([index, (data2.MobileActiveTimePercentage).toFixed(2)]);
    ticks.push([index, 'Mobile Active Time (%)']);
    index++;
  }

  if (data1.PhoneCallTimePercentage != 0 ||
      data2.PhoneCallTimePercentage != 0) {
    series1.push([index, (data1.PhoneCallTimePercentage).toFixed(2)]);
    series2.push([index, (data2.PhoneCallTimePercentage).toFixed(2)]);
    ticks.push([index, 'Phone Call Time (%)']);
    index++;
  }

  if (data1.InteractiveTimePercentage != 0 ||
      data2.InteractiveTimePercentage != 0) {
    series1.push([index, (data1.InteractiveTimePercentage).toFixed(2)]);
    series2.push([index, (data2.InteractiveTimePercentage).toFixed(2)]);
    ticks.push([index, 'Interactive Time (%)']);
    index++;
  }

  if (data1.DeviceIdleModeEnabledTimePercentage != 0 ||
      data2.DeviceIdleModeEnabledTimePercentage != 0) {
    series1.push([index, (data1.DeviceIdleModeEnabledTimePercentage).toFixed(
        2)]);
    series2.push([index, (data2.DeviceIdleModeEnabledTimePercentage).toFixed(
        2)]);
    ticks.push([index, 'Idle Mode Enabled Time (%)']);
    index++;
  }

  if (data1.LowPowerModeEnabledTimePercentage != 0 ||
      data2.LowPowerModeEnabledTimePercentage != 0) {
    series1.push([index, (data1.LowPowerModeEnabledTimePercentage).toFixed(2)]);
    series2.push([index, (data2.LowPowerModeEnabledTimePercentage).toFixed(2)]);
    ticks.push([index, 'Power Save Mode Time (%)']);
    index++;
  }

  if (data1.SignalScanningTimePercentage != 0 ||
      data2.SignalScanningTimePercentage != 0) {
    series1.push([index, (data1.SignalScanningTimePercentage).toFixed(2)]);
    series2.push([index, (data2.SignalScanningTimePercentage).toFixed(2)]);
    ticks.push([index, 'Signal Scanning Time (%)']);
    index++;
  }

  return /** @type {!historian.histogramstats.Series} */ ({
    series1: series1,
    series2: series2,
    ticks: ticks
  });
};


/**
 * Generates data array for screen bar chart.
 * @param {!historian.HistogramStats} data1 SystemStats for file1.
 * @param {!historian.HistogramStats} data2 SystemStats for file2.
 * @return {!historian.histogramstats.Series}
 */
historian.histogramstats.createScreenDataSeries = function(data1, data2) {
  var ticks = [];
  var series1 = [];
  var series2 = [];
  var index = 1;

  if (data1.ScreenOffDischargeRatePerHr.V != 0 ||
      data2.ScreenOffDischargeRatePerHr.V != 0) {
    series1.push([index, (data1.ScreenOffDischargeRatePerHr.V).toFixed(2)]);
    series2.push([index, (data2.ScreenOffDischargeRatePerHr.V).toFixed(2)]);
    ticks.push([index, 'Screen Off Discharge Rate']);
    index++;
  }

  if (data1.ScreenOnDischargeRatePerHr.V != 0 ||
      data2.ScreenOnDischargeRatePerHr.V != 0) {
    series1.push([index, (data1.ScreenOnDischargeRatePerHr.V).toFixed(2)]);
    series2.push([index, (data2.ScreenOnDischargeRatePerHr.V).toFixed(2)]);
    ticks.push([index, 'Screen On Discharge Rate']);
    index++;
  }

  if (data1.ScreenOnTimePercentage != 0 ||
      data2.ScreenOnTimePercentage != 0) {
    series1.push([index, (data1.ScreenOnTimePercentage).toFixed(2)]);
    series2.push([index, (data2.ScreenOnTimePercentage).toFixed(2)]);
    ticks.push([index, 'Screen On Time (%)']);
    index++;
  }

  if (data1.ScreenOffUptimePercentage != 0 ||
      data2.ScreenOffUptimePercentage != 0) {
    series1.push([index, (data1.ScreenOffUptimePercentage).toFixed(2)]);
    series2.push([index, (data2.ScreenOffUptimePercentage).toFixed(2)]);
    ticks.push([index, 'Screen Off Uptime (%)']);
    index++;
  }

  return /** @type {!historian.histogramstats.Series} */ ({
    series1: series1,
    series2: series2,
    ticks: ticks
  });
};


/**
 * Generates data array for wakelock bar chart.
 * @param {!historian.HistogramStats} data1 SystemStats for file1.
 * @param {!historian.HistogramStats} data2 SystemStats for file2.
 * @return {!historian.histogramstats.Series}
 */
historian.histogramstats.createWakelockDataSeries = function(data1, data2) {
  var ticks = [];
  var series1 = [];
  var series2 = [];
  var index = 1;

  if (data1.ScreenOffUptimePercentage != 0 ||
      data2.ScreenOffUptimePercentage != 0) {
    series1.push([index, (data1.ScreenOffUptimePercentage).toFixed(2)]);
    series2.push([index, (data2.ScreenOffUptimePercentage).toFixed(2)]);
    ticks.push([index, 'Screen Off Uptime (%)']);
    index++;
  }

  if (data1.PartialWakelockTimePercentage != 0 ||
      data2.PartialWakelockTimePercentage != 0) {
    series1.push([index, (data1.PartialWakelockTimePercentage).toFixed(2)]);
    series2.push([index, (data2.PartialWakelockTimePercentage).toFixed(2)]);
    ticks.push([index, 'Partial Wakelock Time (%)']);
    index++;
  }

  if (data1.FullWakelockTimePercentage != 0 ||
      data2.FullWakelockTimePercentage != 0) {
    series1.push([index, (data1.FullWakelockTimePercentage).toFixed(2)]);
    series2.push([index, (data2.FullWakelockTimePercentage).toFixed(2)]);
    ticks.push([index, 'Full Wakelock Time (%)']);
    index++;
  }

  if (data1.KernelOverheadTimePercentage != 0 ||
      data2.KernelOverheadTimePercentage != 0) {
    series1.push([index, (data1.KernelOverheadTimePercentage).toFixed(2)]);
    series2.push([index, (data2.KernelOverheadTimePercentage).toFixed(2)]);
    ticks.push([index, 'Kernel Overhead Time (%)']);
    index++;
  }

  return /** @type {!historian.histogramstats.Series} */ ({
    series1: series1,
    series2: series2,
    ticks: ticks
  });
};


/**
 * Generic function to generate top3 metrics for a table.
 * @param {string} toolTip Tooltip text.
 * @param {!Array} table The table we want to generate the top 3 from.
 * @param {string} dataType Type of the data.
 * @param {function(!historian.requests.CombinedCheckinData, string): string}
 *     mapperFunc The function to be called for the content string.
 * @return {!historian.histogramstats.ToolTip_}
 */
historian.histogramstats.getTopThree = function(toolTip, table, dataType,
    mapperFunc) {
  var maxLen = toolTip.length;
  for (var i = 0, found = 0; found < 3 && i < table.length; ++i) {
    var curr = mapperFunc(table[i], dataType);
    if (curr != historian.histogramstats.Constants.BLANK) {
      toolTip += curr;
      if (curr.length > maxLen) {
        maxLen = curr.length;
      }
      found++;
    }
  }
  return {
    tip: toolTip,
    len: maxLen
  };
};


/**
 * Generates tooltip for the bar with the given label.
 * @param {string} label bar label titles.
 * @return {!historian.histogramstats.ToolTip_}
 */
historian.histogramstats.getToolTipFor = function(label) {
  var dataType = historian.histogramstats.Constants.BLANK;
  var toolTipStart = 'Top Apps sorted by the difference between the files ' +
      '[App Name (Difference)]\n';

  switch (label) {
    case historian.histogramstats.Labels.PARTIAL_WL_TIME_P:
    case historian.histogramstats.Labels.KERNEL_OVERHEAD_TIME_P:
    case historian.histogramstats.Labels.TOTAL_APP_SYNCS:
    case historian.histogramstats.Labels.TOTAL_APP_GPS_USE:
    case historian.histogramstats.Labels.TOTAL_APP_FLASH_USE:
    case historian.histogramstats.Labels.TOTAL_APP_CAMERA_USE:
      return historian.histogramstats.getTopThree(
          toolTipStart,
          historian.histogramstats.MetricMap[label],
          historian.histogramstats.Formatters.NONE,
          function(element, type) {
            var curr = goog.string.subs('%s (%s  %s)\n',
                element.Name,
                element.SecondsPerHrDiff.toFixed(2),
                historian.histogramstats.Constants.SEC_PER_HR);
            return curr;
          });

    case historian.histogramstats.Labels.MOBILE_TRANSFER_RATE:
      dataType = historian.histogramstats.Constants.MOBILE;

    case historian.histogramstats.Labels.WIFI_TRANSFER_RATE:
      if (dataType == historian.histogramstats.Constants.BLANK) {
        dataType = historian.histogramstats.Constants.WIFI;
      }
      return historian.histogramstats.getTopThree(
          toolTipStart,
          historian.histogramstats.MetricMap[label],
          dataType,
          function(element, type) {
            var temp;
            if (type == historian.histogramstats.Constants.MOBILE) {
              temp = element.MobileMegaBytesPerHourDiff.toFixed(2);
            } else {
              temp = element.WifiMegaBytesPerHourDiff.toFixed(2);
            }
            return goog.string.subs('%s (%s %s)\n', element.Name, temp,
                historian.histogramstats.Constants.MB_PER_HR);
          });

    case historian.histogramstats.Labels.TOTAL_APP_ANR_COUNT:
      dataType = historian.histogramstats.Constants.ANR;

    case historian.histogramstats.Labels.TOTAL_APP_CRASH_COUNT:
      if (dataType == historian.histogramstats.Constants.BLANK) {
        dataType = historian.histogramstats.Constants.CRASH;
      }
      return historian.histogramstats.getTopThree(
          toolTipStart,
          historian.histogramstats.MetricMap[label],
          dataType,
          function(element, type) {
            var temp;
            if (type == historian.histogramstats.Constants.ANR) {
              temp = element.ANRCountDiff.toFixed(2);
            } else {
              temp = element.CrashCountDiff.toFixed(2);
            }
            return goog.string.subs('%s (%s %s)\n', element.Name, temp,
                historian.histogramstats.Constants.COUNT_PER_HR);
          });

    case historian.histogramstats.Labels.TOTAL_APP_ALARMS:
      return historian.histogramstats.getTopThree(
          toolTipStart,
          historian.histogramstats.MetricMap[label],
          historian.histogramstats.Formatters.NONE,
          function(element, type) {
            var curr = goog.string.subs('%s (%s  %s)\n',
                element.Name,
                element.CountPerHrDiff.toFixed(2),
                historian.histogramstats.Constants.COUNT_PER_HR);
            return curr;
          });

    case historian.histogramstats.Labels.TOTAL_APP_CPU_USE:
      return historian.histogramstats.getTopThree(
          toolTipStart,
          historian.histogramstats.MetricMap[label],
          historian.histogramstats.Formatters.NONE,
          function(element, type) {
            var curr = goog.string.subs('%s (%s  %Battery Use)\n',
                element.Name,
                element.PowerPctDiff.toFixed(2));
            return curr;
          });
    default:
      return historian.histogramstats.emptyToolTip();
  }
};


/**
 * Generates tooltip for the bar with the given label.
 * @param {string} label Bar label titles.
 * @param {string|undefined} file File to generate the tooltips for.
 * @param {number} yPos Y-axis position of the bar we are trying to get
       a tooltip for.
 * @return {!historian.histogramstats.ToolTip_}
 */
historian.histogramstats.getABToolTipFor = function(label, file, yPos) {
  // If the bar is below the x-axis on the chart (yPos < 0),
  // this means that this metric was lower for current file and higher for the
  // other file. In this case we need to get the top metrics for the other file.
  // So, we flip the file name if yPos is negative.
  if (yPos < 0) {
    if (file == historian.histogramstats.fileOrdering.getInstance().get(0)) {
      file = historian.histogramstats.fileOrdering.getInstance().get(1);
    } else {
      file = historian.histogramstats.fileOrdering.getInstance().get(0);
    }
  }

  // The sign is used to extract top 3 apps for the correct file.
  // All of the differences are ordered as (File1 - File2) by default.
  // So, positive differences are the values we want to retrieve for File1 and
  // similarly we want to retrieve apps with negative differences for file2.
  var sign =
      (file == historian.histogramstats.fileOrdering.getInstance().get(0)) ?
      1 : -1;
  var dataType = historian.histogramstats.Constants.BLANK;
  var fileInfo =
      (file == historian.histogramstats.fileOrdering.getInstance().get(0)) ?
      historian.histogramstats.file1_ : historian.histogramstats.file2_;
  var toolTipStart = 'Top Apps for ' + fileInfo +
      ' [App Name (Difference)]\n';

  switch (label) {
    case historian.histogramstats.Labels.PARTIAL_WL_TIME:
    case historian.histogramstats.Labels.KERNEL_WL_TIME:
    case historian.histogramstats.Labels.APP_SYNCS_TIME:
    case historian.histogramstats.Labels.APP_GPS_USE_TIME:
      return historian.histogramstats.getTopThree(
          toolTipStart,
          historian.histogramstats.MetricMap[label],
          historian.histogramstats.Formatters.NONE,
          function(element, type) {
            if (sign != Math.sign(element.SecondsPerHrDiff)) {
              return historian.histogramstats.Constants.BLANK;
            }
            return goog.string.subs('%s (%s  %s)\n',
                element.Name,
                Math.abs(element.SecondsPerHrDiff.toFixed(2)),
                historian.histogramstats.Constants.SEC_PER_HR);
          });

    case historian.histogramstats.Labels.MOBILE_DATA_USE:
      dataType = historian.histogramstats.Constants.MOBILE;

    case historian.histogramstats.Labels.WIFI_DATA_USE:
      if (dataType == historian.histogramstats.Constants.BLANK) {
        dataType = historian.histogramstats.Constants.WIFI;
      }
      return historian.histogramstats.getTopThree(
          toolTipStart,
          historian.histogramstats.MetricMap[label],
          dataType,
          function(element, type) {
            if ((type == historian.histogramstats.Constants.MOBILE &&
                sign != Math.sign(element.MobileMegaBytesPerHourDiff)) ||
                (type == historian.histogramstats.Constants.WIFI &&
                sign != Math.sign(element.WifiMegaBytesPerHourDiff))) {
              return historian.histogramstats.Constants.BLANK;
            }
            var temp;
            if (type == historian.histogramstats.Constants.MOBILE) {
              temp = element.MobileMegaBytesPerHourDiff.toFixed(2);
            } else {
              temp = element.WifiMegaBytesPerHourDiff.toFixed(2);
            }
            return goog.string.subs('%s (%s %s)\n', element.Name,
                Math.abs(temp), historian.histogramstats.Constants.KB_PER_HR);
          });

    case historian.histogramstats.Labels.APP_ANR_COUNT:
      dataType = historian.histogramstats.Constants.ANR;

    case historian.histogramstats.Labels.APP_CRASH_COUNT:
      if (dataType == historian.histogramstats.Constants.BLANK) {
        dataType = historian.histogramstats.Constants.CRASH;
      }
      return historian.histogramstats.getTopThree(
          toolTipStart,
          historian.histogramstats.MetricMap[label],
          dataType,
          function(element, type) {
            if ((type == historian.histogramstats.Constants.ANR &&
                sign != Math.sign(element.ANRCountDiff)) ||
                (type == historian.histogramstats.Constants.CRASH &&
                sign != Math.sign(element.CrashCountDiff))) {
              return historian.histogramstats.Constants.BLANK;
            }
            var temp;
            if (type == historian.histogramstats.Constants.ANR) {
              temp = element.ANRCountDiff.toFixed(2);
            } else {
              temp = element.CrashCountDiff.toFixed(2);
            }
            return goog.string.subs('%s (%s %s)\n', element.Name,
                Math.abs(temp),
                historian.histogramstats.Constants.COUNT_PER_HR);
          });

    case historian.histogramstats.Labels.APP_ALARMS:
      return historian.histogramstats.getTopThree(
          toolTipStart,
          historian.histogramstats.MetricMap[label],
          historian.histogramstats.Formatters.NONE,
          function(element, type) {
            if (sign != Math.sign(element.CountPerHrDiff)) {
              return historian.histogramstats.Constants.BLANK;
            }
            return goog.string.subs('%s (%s  %s)\n',
                element.Name,
                Math.abs(element.CountPerHrDiff.toFixed(2)),
                historian.histogramstats.Constants.COUNT_PER_HR);
          });
    default:
      return historian.histogramstats.emptyToolTip();
  }
};


/**
 * Displays tooltips for the bar charts.
 * @param {number} x X-coordinate of the bar.
 * @param {number} y Y-coordinate of the bar.
 * @param {string} contents The tooltip content to be displayed.
 * @param {number} len Maximum length of a tooltip line.
 */
historian.histogramstats.showTooltip = function(x, y, contents, len) {
  $('<div id="chart-tooltip">' + contents + '</div>').css({
    width: len * historian.histogramstats.Tooltip.CHAR_TO_PIXEL_MULTIPLIER,
    top: y + historian.histogramstats.Tooltip.SPACE_ADJUST,
    left: x + historian.histogramstats.Tooltip.SPACE_ADJUST
  }).appendTo('body').fadeIn(historian.histogramstats.Tooltip.FADE_IN_MSEC);
};


/**
 * Generates tool tip content for the given bar chart.
 * @param {string} tag Bar chart tag.
 * @param {string} label bar label
       titles.
 * @param {string|undefined} file File to generate the tooltips for.
 * @param {number} yPos Y-axis position of the bar we are trying to get
       a tooltip for.
 * @return {!historian.histogramstats.ToolTip_}
 */
historian.histogramstats.getTooltip = function(tag, label, file, yPos) {
  switch (tag) {
    case historian.histogramstats.Charts.WAKELOCK:
    case historian.histogramstats.Charts.DATA:
    case historian.histogramstats.Charts.APP:
      return historian.histogramstats.getToolTipFor(label);
    case historian.histogramstats.Charts.AB:
      return historian.histogramstats.getABToolTipFor(label, file, yPos);
    default:
      return historian.histogramstats.emptyToolTip();
  }
};


/**
 * Draws tooltips for the given histogram tag.
 * @param {string} tag String to reference the bar chart.
 * @param {!Array<!Array<number|string>>} ticks Array containing bar
       titles.
 * @param {string|undefined} file File to generate the tooltips for.
 */
historian.histogramstats.drawToolTips = function(tag, ticks, file) {
  var previousPoint;
  $(tag).bind('plothover', function(event, pos, item) {
    if (item) {
      if (previousPoint != item.datapoint) {
        previousPoint = item.datapoint;

        $(historian.histogramstats.Charts.TOOLTIP).remove();
        var y = item.datapoint[1].toFixed(2);
        // Get content for the tooltip.
        var label = item.series.xaxis.ticks[item.dataIndex].label;
        var ret = historian.histogramstats.getTooltip(tag, label, file, y);
        // Display the tooltip on the chart.
        if (ret.len > 0) {
          historian.histogramstats.showTooltip(item.pageX,
              item.pageY, ret.tip, ret.len);
          $(historian.histogramstats.Charts.TOOLTIP).show();
        }
      }
    } else {
      $(historian.histogramstats.Charts.TOOLTIP).remove();
      previousPoint = null;
    }
  });
};


/**
 * Draws a histogram for the provided data series.
 * @param {!Array<!Array<number>>} series Dataset to be drawn.
 * @param {!Array<!Array<number|string>>} ticks Array containing bar
       titles.
 * @param {string} tag String to reference the bar chart.
 * @param {string} yLabel String label for the y-axis.
 * @param {string} legendLabel String label for the legend.
 */
historian.histogramstats.drawSingleSeriesHistogram = function(series, ticks,
    tag, yLabel, legendLabel) {
  if (series.length == 0) {
    $('.AB').remove();
    return;
  }

  $(historian.histogramstats.Charts.AB).show();
  var data = [{
    label: legendLabel,
    data: series,
    bars: {
      show: true,
      barWidth: historian.histogramstats.BAR_WIDTH,
      lineWidth: historian.histogramstats.LINE_WIDTH,
      align: historian.histogramstats.Formatters.CENTER,
      fillColor: {
        colors: [
          historian.histogramstats.Formatters.BLUE1,
          historian.histogramstats.Formatters.BLUE2
        ]
      }
    },
    color: historian.histogramstats.Formatters.BLUE3
  }];

  var options = {
    xaxis: {
      min: 0,
      max: historian.histogramstats.AB_MAX_BARS,
      mode: null,
      ticks: ticks,
      tickLength: 0,
      labelWidth: historian.histogramstats.AB_LABEL_WIDTH,
      axisLabelUseCanvas: true,
      axisLabelFontSizePixels: historian.histogramstats.FONT_SIZE,
      axisLabelFontFamily: historian.histogramstats.Formatters.FONT_FAMILY,
      axisLabelPadding: historian.histogramstats.LABEL_PADDING
    },
    yaxis: {
      axisLabel: yLabel,
      tickDecimals: 0,
      axisLabelFontSizePixels: historian.histogramstats.FONT_SIZE,
      axisLabelFontFamily: historian.histogramstats.Formatters.FONT_FAMILY,
      axisLabelPadding: historian.histogramstats.LABEL_PADDING
    },
    grid: {
      hoverable: true,
      clickable: false,
      autoHighlight: true,
      borderWidth: 0,
      markings: [{ xaxis: { from: 0, to: 2000}, yaxis: { from: 0, to: 0 },
          color: '#000' },
        { xaxis: { from: 0, to: 0 }, yaxis: { from: -2000, to: 2000 },
          color: '#000' }],
      markingsLineWidth: 1.5,
      labelMargin: historian.histogramstats.LABEL_MARGIN
    },
    legend: {
      show: true,
      noColumns: 1,
      backgroundOpacity: 0.85,
      position: historian.histogramstats.Formatters.NORTH_EAST
    },
    series: {
      shadowSize: 1
    }
  };

  var p = $.plot($(tag), data, options);

  $.each(p.getData()[0].data, function(i, el) {
    var o = p.pointOffset({
      x: el[0],
      y: el[1]
    });
    var symbol = el[1] < 0 ? '&#9660;' : '&#9650;';
    var topLoc = el[1] < 0 ? o.top + historian.histogramstats.BOTTOM :
        o.top - historian.histogramstats.TOP;
    $('<div class="data-point-label">' + symbol + Math.abs(el[1]) + 'x' +
      '</div>').css({
      position: historian.histogramstats.Formatters.ABSOLUTE,
      left: o.left - historian.histogramstats.LEFT_AB,
      top: topLoc,
      display: historian.histogramstats.Formatters.NONE
    }).appendTo(p.getPlaceholder()).fadeIn(
        historian.histogramstats.Formatters.SLOW);
  });
  historian.histogramstats.drawToolTips(tag, ticks, legendLabel);
};


/**
 * Generates a pie chart data series.
 * @param {!Object} map Dataset to be drawn.
 * @return {!Array<string|number>}
 */
historian.histogramstats.createPieSeries = function(map) {
  var output = [];
  for (var curr in map) {
    if (map[curr] == 0) {
      continue;
    }
    var item = {};
    item.data = map[curr].toFixed(2);
    if (curr == 'NONE_OR_UNKNOWN') {
      curr = 'NONE';
    }
    item.label = curr;
    item.color = historian.histogramstats.getValue(curr);
    output.push(item);
  }
  return output;
};


/**
 * Draws a pie chart for the provided data series.
 * @param {string} tag Pie chart tag.
 * @param {Array<string|number>} series Dataset to be drawn.
 */
historian.histogramstats.drawPie = function(tag, series) {
  $.plot($(tag), series, {
    series: {
      pie: {
        show: true,
        radius: 1,
        combine: {
          color: '#33FFFF',
          threshold: 0.08
        },
        label: {
          show: true,
          radius: 3 / 4,
          formatter: function(label, series) {
            return ('<div style="font-size:8pt ;text-align:center;' +
                ' padding:2px; color:black;">' + label + '<br/>' +
                Math.round(series.percent) + '%</div>');
          }
        }
      }
    },
    legend: {
      show: false
    }
  });
};


/**
 * Draws a histogram for the provided data series.
 * @param {!Array<!Array<number>>} series1 First dataset
       to be drawn.
 * @param {!Array<!Array<number>>} series2 Second dataset
       to be drawn.
 * @param {!Array<!Array<number|string>>} ticks Array containing
       bar titles.
 * @param {string} tag String to reference the bar chart.
 * @param {string} yLabel String label for the y-axis.
 */
historian.histogramstats.drawHistogram = function(series1, series2, ticks,
    tag, yLabel) {
  var data = [{
    label: historian.histogramstats.file1_,
    data: series1,
    bars: {
      show: true,
      barWidth: historian.histogramstats.BAR_WIDTH,
      order: 1,
      lineWidth: historian.histogramstats.LINE_WIDTH,
      align: historian.histogramstats.Formatters.CENTER,
      fillColor: {
        colors: [
          historian.histogramstats.Formatters.BLUE1,
          historian.histogramstats.Formatters.BLUE2
        ]
      }
    },
    color: historian.histogramstats.Formatters.BLUE3
  }, {
    label: historian.histogramstats.file2_,
    data: series2,
    bars: {
      show: true,
      barWidth: historian.histogramstats.BAR_WIDTH,
      order: 2,
      lineWidth: historian.histogramstats.LINE_WIDTH,
      align: historian.histogramstats.Formatters.CENTER,
      fillColor: {
        colors: [
          historian.histogramstats.Formatters.RED1,
          historian.histogramstats.Formatters.RED2
        ]
      }
    },
    color: historian.histogramstats.Formatters.RED3
  }];

  var options = {
    xaxis: {
      min: 0,
      max: historian.histogramstats.MAX_BARS,
      mode: null,
      ticks: ticks,
      tickLength: 0,
      axisLabelUseCanvas: true,
      axisLabelFontSizePixels: historian.histogramstats.FONT_SIZE,
      axisLabelFontFamily: historian.histogramstats.Formatters.FONT_FAMILY,
      axisLabelPadding: historian.histogramstats.LABEL_PADDING,
      labelWidth: historian.histogramstats.LABEL_WIDTH
    },
    yaxis: {
      axisLabel: yLabel,
      tickDecimals: 0,
      axisLabelFontSizePixels: historian.histogramstats.FONT_SIZE,
      axisLabelFontFamily: historian.histogramstats.Formatters.FONT_FAMILY,
      axisLabelPadding: historian.histogramstats.LABEL_PADDING
    },
    grid: {
      hoverable: true,
      clickable: false,
      borderWidth: 0,
      borderColor: historian.histogramstats.Formatters.LIGHT_GRAY1,
      labelMargin: historian.histogramstats.LABEL_MARGIN,
      backgroundColor: {
        colors: [
          historian.histogramstats.Formatters.LIGHT_GRAY2,
          historian.histogramstats.Formatters.DARK_GRAY
        ]
      }
    },
    legend: {
      position: historian.histogramstats.Formatters.NORTH_EAST,
      labelBoxBorderColor: {
        colors: [
          historian.histogramstats.Formatters.LIGHT_GRAY2,
          historian.histogramstats.Formatters.DARK_GRAY
        ]
      },
      backgroundColor: {
        colors: [
          historian.histogramstats.Formatters.LIGHT_GRAY2,
          historian.histogramstats.Formatters.DARK_GRAY
        ]
      }
    },
    series: {
      shadowSize: 1
    }
  };
  var p = $.plot($(tag), data, options);

  // Adding bar labels to each of the bars
  $.each(p.getData()[0].data, function(i, el) {
    var o = p.pointOffset({
      x: el[0],
      y: el[1]
    });
    $('<div class="data-point-label">' + el[1] + '</div>').css({
      position: historian.histogramstats.Formatters.ABSOLUTE,
      left: o.left - historian.histogramstats.LEFT1_,
      top: o.top - historian.histogramstats.TOP,
      display: historian.histogramstats.Formatters.NONE
    }).appendTo(p.getPlaceholder()).fadeIn(
        historian.histogramstats.Formatters.SLOW);
  });

  $.each(p.getData()[1].data, function(i, el) {
    var o = p.pointOffset({
      x: el[0],
      y: el[1]
    });
    $('<div class="data-point-label">' + el[1] + '</div>').css({
      position: historian.histogramstats.Formatters.ABSOLUTE,
      left: o.left - historian.histogramstats.LEFT2_,
      top: o.top - historian.histogramstats.TOP,
      display: historian.histogramstats.Formatters.NONE
    }).appendTo(p.getPlaceholder()).fadeIn(
        historian.histogramstats.Formatters.SLOW);
  });
  historian.histogramstats.drawToolTips(tag, ticks, undefined);
};


/**
 * Draws tooltips for the given histogram tag.
 * @param {!Array<!historian.histogramstats.TopMetric>} array String to
       reference the bar chart.
* @param {number} index1 File1 table index.
* @param {number} index2 File2 table index.
 */
historian.histogramstats.createTopMetricsTable = function(
    array, index1, index2) {
  if (array.length == 0) {
    $('.ABtable').hide();
    return;
  }

  $('.ABtable').show();
  // Attaching file titles based on indexes.
  var file1 = (index1 == 1) ?
      historian.histogramstats.file1_ : historian.histogramstats.file2_;
  var file2 = (index2 == 1) ?
      historian.histogramstats.file1_ : historian.histogramstats.file2_;
  var headRow = ['Metric', 'Name',
    'Total Value (' + file1 + ')', 'Total Value (' + file2 + ')',
    'Value/Hr (' + file1 + ')', 'Value/Hr (' + file2 + ')',
    'Count (' + file1 + ')', 'Count (' + file2 + ')',
    'Count/Hr (' + file1 + ')', 'Count/Hr (' + file2 + ')'];

  var bodyRows = goog.array.map(array, function(data) {
    return [
      data.metric, data.name,
      data.value1, data.value2,
      data.nvalue1, data.nvalue2,
      data.count1, data.count2,
      data.ncount1, data.ncount2
    ];
  });
  var table = historian.tables.createTable(headRow, bodyRows)
      .addClass('summary-content to-datatable no-paging')
      .addClass('no-ordering no-searching no-info');
  $('#topmetric').empty().append('<span>Top metrics for ' +
      file1 + ' as compared with ' + file2 + ':</span>').append(table);
  historian.tables.activateDataTable(table);
  historian.tables.activateTableCopy(table);
};


/**
 * Generates table for the top diff metrics.
 * @param {!Array<!Array<number>>} series Dataset.
 * @param {!Array<!Array<number|string>>} metrics Array containing bar labels.
 * @param {number} sign Indicates whether data is positive or negative.
 * @param {number} index File1 index.
 * @param {number} index2 File2 index.
 * @return {!Array<!historian.histogramstats.TopMetric>}
 */
historian.histogramstats.generateTopMetrics = function(series, metrics, sign,
    index, index2) {
  var topMetricTable = [];
  var count = 0;
  for (var i = 0; i < metrics.length; ++i) {
    if (metrics[i].length < 2 || series[i][1] < 0) {
      continue;
    }
    switch (metrics[i][1]) {
      case historian.histogramstats.Labels.PARTIAL_WL_TIME:
        var tbl =
            historian.histogramstats.combinedCheckin.UserspaceWakelocksCombined;
        if (!tbl) {
          continue;
        }
        for (var j = 0; j < tbl.length; ++j) {
          if (Math.sign(tbl[j].SecondsPerHrDiff) == sign) {
            topMetricTable[count++] = {
              metric: 'Userspace Wakelock',
              name: tbl[j].Name,
              value1: historian.time.formatDuration(
                  // Entries should have valid data at this point since we
                  // have already checked for the difference between the
                  // entries being greater than 0 at the beginning of the for
                  // loop.
                  tbl[j].Entries[index].Duration /
                  historian.time.NSECS_IN_MSEC),  // Nanosecond to msec.
              nvalue1: tbl[j].Entries[index].SecondsPerHr.toFixed(1) +
                  ' Sec/Hr',
              count1: tbl[j].Entries[index].Count.toString(),
              ncount1: tbl[j].Entries[index].CountPerHour.toFixed(1),
              // Adding the above information for the second file.
              value2: historian.time.formatDuration(
                  tbl[j].Entries[index2].Duration /
                  historian.time.NSECS_IN_MSEC),  // Nanosecond to msec.
              nvalue2: tbl[j].Entries[index2].SecondsPerHr.toFixed(1) +
                  ' Sec/Hr',
              count2: tbl[j].Entries[index2].Count.toString(),
              ncount2: tbl[j].Entries[index2].CountPerHour.toFixed(1)
            };
            break;
          }
        }
        break;

      case historian.histogramstats.Labels.KERNEL_WL_TIME:
        var tbl =
            historian.histogramstats.combinedCheckin.KernelWakelocksCombined;
        if (!tbl) {
          continue;
        }
        for (var j = 0; j < tbl.length; ++j) {
          if (Math.sign(tbl[j].SecondsPerHrDiff) == sign) {
            topMetricTable[count++] = {
              metric: 'Kernel Wakelock',
              name: tbl[j].Name,
              value1: historian.time.formatDuration(
                  tbl[j].Entries[index].Duration /
                  historian.time.NSECS_IN_MSEC),  // Nanosec to msec.
              nvalue1: tbl[j].Entries[index].SecondsPerHr.toFixed(1) +
                  ' Sec/Hr',
              count1: tbl[j].Entries[index].Count.toString(),
              ncount1: tbl[j].Entries[index].CountPerHour.toFixed(1),
              value2: historian.time.formatDuration(
                  tbl[j].Entries[index2].Duration /
                  historian.time.NSECS_IN_MSEC),  // Nanosec to msec.
              nvalue2: tbl[j].Entries[index2].SecondsPerHr.toFixed(1) +
                  ' Sec/Hr',
              count2: tbl[j].Entries[index2].Count.toString(),
              ncount2: tbl[j].Entries[index2].CountPerHour.toFixed(1)
            };
            break;
          }
        }
        break;
      case historian.histogramstats.Labels.MOBILE_DATA_USE:
        var tbl = historian.histogramstats.combinedCheckin
            .TopMobileTrafficAppsCombined;
        if (!tbl) {
          continue;
        }
        for (var j = 0; j < tbl.length; ++j) {
          if (Math.sign(tbl[j].MobileMegaBytesPerHourDiff) == sign) {
            topMetricTable[count++] = {
              metric: 'Mobile Data (MB)',
              name: tbl[j].Name,
              value1:
                  tbl[j].Entries[index].MobileMegaBytes.toFixed(2).toString(),
              nvalue1:
                  tbl[j].Entries[index].MobileMegaBytesPerHour.toFixed(1) +
                  ' MB/Hr',
              count1: '-',
              ncount1: '-',
              value2:
                  tbl[j].Entries[index2].MobileMegaBytes.toFixed(2).toString(),
              nvalue2:
                  tbl[j].Entries[index2].MobileMegaBytesPerHour.toFixed(1) +
                  ' MB/Hr',
              count2: '-',
              ncount2: '-'
            };
            break;
          }
        }
        break;

      case historian.histogramstats.Labels.WIFI_DATA_USE:
        var tbl =
            historian.histogramstats.combinedCheckin.TopWifiTrafficAppsCombined;
        if (!tbl) {
          continue;
        }
        for (var j = 0; j < tbl.length; ++j) {
          if (Math.sign(tbl[j].WifiMegaBytesPerHourDiff) == sign) {
            topMetricTable[count++] = {
              metric: 'Wifi Data (MB)',
              name: tbl[j].Name,
              value1:
                  tbl[j].Entries[index].WifiMegaBytes.toFixed(2).toString(),
              nvalue1: tbl[j].Entries[index].WifiMegaBytesPerHour.toFixed(1) +
                  ' MB/Hr',
              count1: '-',
              ncount1: '-',
              value2:
                  tbl[j].Entries[index2].WifiMegaBytes.toFixed(2).toString(),
              nvalue2:
                  tbl[j].Entries[index2].WifiMegaBytesPerHour.toFixed(1) +
                  ' MB/Hr',
              count2: '-',
              ncount2: '-'
            };
            break;
          }
        }
        break;

      case historian.histogramstats.Labels.APP_SYNCS_TIME:
        var tbl = historian.histogramstats.combinedCheckin.SyncTasksCombined;
        if (!tbl) {
          continue;
        }
        for (var j = 0; j < tbl.length; ++j) {
          if (Math.sign(tbl[j].SecondsPerHrDiff) == sign) {
            topMetricTable[count++] = {
              metric: 'App Syncs',
              name: tbl[j].Name,
              value1: historian.time.formatDuration(
                  tbl[j].Entries[index].Duration /
                  historian.time.NSECS_IN_MSEC),  // Nanosec to msec.
              nvalue1:
                  tbl[j].Entries[index].SecondsPerHr.toFixed(1) + ' Sec/Hr',
              count1: tbl[j].Entries[index].Count.toString(),
              ncount1: tbl[j].Entries[index].CountPerHour.toFixed(1),
              value2: historian.time.formatDuration(
                  tbl[j].Entries[index2].Duration /
                  historian.time.NSECS_IN_MSEC),  // Nanosec to msec.
              nvalue2:
                  tbl[j].Entries[index2].SecondsPerHr.toFixed(1) + ' Sec/Hr',
              count2: tbl[j].Entries[index2].Count.toString(),
              ncount2: tbl[j].Entries[index2].CountPerHour.toFixed(1)
            };
            break;
          }
        }
        break;

      case historian.histogramstats.Labels.APP_GPS_USE_TIME:
        var tbl = historian.histogramstats.combinedCheckin.GPSUseCombined;
        if (!tbl) {
          continue;
        }
        for (var j = 0; j < tbl.length; ++j) {
          // If the diff is positive - file1 value is larger than file2
          if (Math.sign(tbl[j].SecondsPerHrDiff) == sign) {
            topMetricTable[count++] = {
              metric: 'GPS Use',
              name: tbl[j].Name,
              value1: historian.time.formatDuration(
                  tbl[j].Entries[index].Duration /
                  historian.time.NSECS_IN_MSEC), // Nanosec to msec.
              nvalue1:
                  tbl[j].Entries[index].SecondsPerHr.toFixed(1) + ' Sec/Hr',
              count1: tbl[j].Entries[index].Count.toString(),
              ncount1: tbl[j].Entries[index].CountPerHour.toFixed(1),
              value2:
                  historian.time.formatDuration(
                  tbl[j].Entries[index2].Duration /
                  historian.time.NSECS_IN_MSEC), // Nanosec to msec.
              nvalue2:
                  tbl[j].Entries[index2].SecondsPerHr.toFixed(1) + ' Sec/Hr',
              count2: tbl[j].Entries[index2].Count.toString(),
              ncount2: tbl[j].Entries[index2].CountPerHour.toFixed(1)
            };
            break;
          }
        }
        break;

      case historian.histogramstats.Labels.APP_ANR_COUNT:
        var tbl =
            historian.histogramstats.combinedCheckin.ANRAndCrashCombined;
        if (!tbl) {
          continue;
        }
        for (var j = 0; j < tbl.length; ++j) {
          if (Math.sign(tbl[j].ANRCountDiff) == sign) {
            topMetricTable[count++] = {
              metric: 'ANR Count',
              name: tbl[j].Name,
              value1: '-',
              nvalue1: '-',
              count1: tbl[j].Entries[index].ANRCount.toString(),
              ncount1: '-',
              value2: '-',
              nvalue2: '-',
              count2: tbl[j].Entries[index2].ANRCount.toString(),
              ncount2: '-'
            };
            break;
          }
        }
        break;

      case historian.histogramstats.Labels.APP_CRASH_COUNT:
        var tbl =
            historian.histogramstats.combinedCheckin.ANRAndCrashCombined;
        if (!tbl) {
          continue;
        }
        for (var j = 0; j < tbl.length; ++j) {
          if (Math.sign(tbl[j].CrashCountDiff) == sign) {
            topMetricTable[count++] = {
              metric: 'Crash Count',
              name: tbl[j].Name,
              value1: '-',
              nvalue1: '-',
              count1: tbl[j].Entries[index].CrashCount.toString(),
              ncount1: '-',
              value2: '-',
              nvalue2: '-',
              count2: tbl[j].Entries[index2].CrashCount.toString(),
              ncount2: '-'
            };
            break;
          }
        }
        break;

      case historian.histogramstats.Labels.APP_ALARMS:
        var tbl = historian.histogramstats.combinedCheckin.AppWakeupsCombined;
        if (!tbl) {
          continue;
        }
        for (var j = 0; j < tbl.length; ++j) {
          if (Math.sign(tbl[j].CountPerHrDiff) == sign) {
            topMetricTable[count++] = {
              metric: 'App Alarms Count',
              name: tbl[j].Name,
              value1: '-',
              nvalue1: '-',
              count1: tbl[j].Entries[index].Count.toFixed(2).toString(),
              ncount1: tbl[j].Entries[index].CountPerHr.toFixed(1),
              value2: '-',
              nvalue2: '-',
              count2: tbl[j].Entries[index2].Count.toFixed(2).toString(),
              ncount2: tbl[j].Entries[index2].CountPerHr.toFixed(1)
            };
            break;
          }
        }
        break;

      default:
        continue;
    }
  }
  return topMetricTable;
};


/**
 * Generates histogram for app related data.
 * @param {!historian.HistogramStats} stats1 Histogramstats received
 *     from the server.
 * @param {!historian.HistogramStats} stats2 Histogramstats received
 *     from the server.
 */
historian.histogramstats.drawAppHistogram = function(stats1, stats2) {
  var series = historian.histogramstats.createAppDataSeries(stats1, stats2);
  if (series.ticks.length > 0) {
    historian.histogramstats.drawHistogram(series.series1, series.series2,
        series.ticks,
        historian.histogramstats.Charts.APP,
        historian.histogramstats.Constants.BLANK);
  } else {
    $('#appdata').remove();
  }
};


/**
 * Generates histogram for wakelock related data.
 * @param {!historian.HistogramStats} stats1 Histogramstats received
 *     from the server.
 * @param {!historian.HistogramStats} stats2 Histogramstats received
 *     from the server.
 */
historian.histogramstats.drawWakelockHistogram = function(stats1, stats2) {
  var series = historian.histogramstats.createWakelockDataSeries(stats1,
      stats2);
  if (series.ticks.length > 0) {
    historian.histogramstats.drawHistogram(series.series1, series.series2,
        series.ticks,
        historian.histogramstats.Charts.WAKELOCK,
        historian.histogramstats.Constants.PERCENTAGE);
  } else {
    $('#wakelockdata').remove();
  }
};


/**
* Removes any pie elements when the corresponding data is not found.
* @param {string} pie_label Label for the pie chart div.
* @param {string} chart_label1 Label for file1's pie.
* @param {string} chart_label2 Label for file2's pie.
* @param {!Array<string|number>} series1 Data series for pie1.
* @param {!Array<string|number>} series2 Data series for pie2.
*/
historian.histogramstats.cleanUpPies = function(pie_label, chart_label1,
    chart_label2, series1, series2) {
  if (goog.array.isEmpty(series1) && goog.array.isEmpty(series2)) {
    $(pie_label).remove();
    return;
  }
  if (goog.array.isEmpty(series1)) {
    $(chart_label1).text('No data found for ' +
        historian.histogramstats.file1_);
  } else {
    historian.histogramstats.drawPie(chart_label1, series1);
  }
  if (goog.array.isEmpty(series2)) {
    $(chart_label2).text('No data found for ' +
        historian.histogramstats.file2_);
  } else {
    historian.histogramstats.drawPie(chart_label2, series2);
  }
};


/**
 * Generates histogram for screen related data.
 * @param {!historian.HistogramStats} stats1 Histogramstats received
 *     from the server.
 * @param {!historian.HistogramStats} stats2 Histogramstats received
 *     from the server.
 */
historian.histogramstats.drawScreenHistogram = function(stats1, stats2) {
  var series = historian.histogramstats.createScreenDataSeries(stats1, stats2);
  if (series.ticks.length > 0) {
    historian.histogramstats.drawHistogram(series.series1, series.series2,
        series.ticks,
        historian.histogramstats.Charts.SCREEN,
        historian.histogramstats.Constants.BLANK);
  } else {
    $('#screendata').remove();
  }

  // Draw screen pie charts.
  var pieSeries1 = historian.histogramstats.createPieSeries(
      stats1.ScreenBrightness);
  var pieSeries2 = historian.histogramstats.createPieSeries(
      stats2.ScreenBrightness);
  $('#screen-pie-label').text('Screen Brigthness (' +
      historian.histogramstats.file1_ + ' - ' +
      historian.histogramstats.file2_ + ')');

  // Make sure we don't draw pie charts if no data is available.
  historian.histogramstats.cleanUpPies('.screen-brightness-pie',
      historian.histogramstats.Charts.SCREEN_PIE_CHART1,
      historian.histogramstats.Charts.SCREEN_PIE_CHART2,
      pieSeries1, pieSeries2);
};


/**
 * Generates histogram for data transfer.
 * @param {!historian.HistogramStats} stats1 Histogramstats received
 *     from the server.
 * @param {!historian.HistogramStats} stats2 Histogramstats received
 *     from the server.
 */
historian.histogramstats.drawDataTransferHistogram = function(stats1, stats2) {
  var series = historian.histogramstats.createDataTransferSeries(stats1,
      stats2);
  if (series.ticks.length > 0) {
    historian.histogramstats.drawHistogram(series.series1, series.series2,
        series.ticks,
        historian.histogramstats.Charts.DATA,
        historian.histogramstats.Constants.KB_PER_HR);
  } else {
    $('#transferdata').remove();
  }
};


/**
 * Generates histogram for device usage data.
 * @param {!historian.HistogramStats} stats1 Histogramstats received
 *     from the server.
 * @param {!historian.HistogramStats} stats2 Histogramstats received
 *     from the server.
 */
historian.histogramstats.drawUsageHistogram = function(stats1, stats2) {
  var series = historian.histogramstats.createUsageDataSeries(stats1, stats2);
  if (series.ticks.length > 0) {
    historian.histogramstats.drawHistogram(series.series1, series.series2,
        series.ticks,
        historian.histogramstats.Charts.USAGE,
        historian.histogramstats.Constants.PERCENTAGE);
  } else {
    $('#usagedata').remove();
  }

  // Draw signal strength pie charts.
  var pieSeries1 = historian.histogramstats.createPieSeries(
      stats1.SignalStrength);
  var pieSeries2 = historian.histogramstats.createPieSeries(
      stats2.SignalStrength);
  $('#signal-pie-label').text('Device Signal Strength (' +
      historian.histogramstats.file1_ + ' - ' +
      historian.histogramstats.file2_ + ')');
  // Make sure we don't draw pie charts if no data is available.
  historian.histogramstats.cleanUpPies('.phone-signal-strength-pie',
      historian.histogramstats.Charts.SIGNAL_PIE_CHART1,
      historian.histogramstats.Charts.SIGNAL_PIE_CHART2,
      pieSeries1, pieSeries2);
};


/**
 * Generates histogram for wifi/BT usage data.
 * @param {!historian.HistogramStats} stats1 Histogramstats received
 *     from the server.
 * @param {!historian.HistogramStats} stats2 Histogramstats received
 *     from the server.
 */
historian.histogramstats.drawCommHistogram = function(stats1, stats2) {
  var series = historian.histogramstats.createCommDataSeries(stats1, stats2);
  if (series.ticks.length > 0) {
    historian.histogramstats.drawHistogram(series.series1, series.series2,
        series.ticks,
        historian.histogramstats.Charts.COMM,
        historian.histogramstats.Constants.BLANK);
  } else {
    $('#commdata').remove();
  }

  // Draw WifiSignalStrength pie charts.
  var pieSeries1 = historian.histogramstats.createPieSeries(
      stats1.WifiSignalStrength);
  var pieSeries2 = historian.histogramstats.createPieSeries(
      stats2.WifiSignalStrength);
  $('#wifi-pie-label').text('Wifi Signal Strength (' +
      historian.histogramstats.file1_ + ' - ' +
      historian.histogramstats.file2_ + ')');
  // Make sure we don't draw pie charts if no data is available.
  historian.histogramstats.cleanUpPies('.wifi-signal-strength-pie',
      historian.histogramstats.Charts.WIFI_PIE_CHART1,
      historian.histogramstats.Charts.WIFI_PIE_CHART2,
      pieSeries1, pieSeries2);
};


/**
 * Generates histogram for A/B comparison.
 * @param {!historian.histogramstats.ABData} file1VsFile2
 *     Metrics for File 1 as compared with metrics of File 2.
 * @param {!historian.histogramstats.ABData} file2VsFile1
 *     Metrics for File 2 as compared with metrics of File 1.
 */
historian.histogramstats.drawABHistogram = function(
    file1VsFile2, file2VsFile1) {
  historian.histogramstats.drawSingleSeriesHistogram(
      file1VsFile2.series,
      file1VsFile2.ticks,
      historian.histogramstats.Charts.AB,
      historian.histogramstats.Constants.BLANK,
      historian.histogramstats.fileOrdering.getInstance().get(0));

  historian.histogramstats.topMetricTable12 =
      historian.histogramstats.generateTopMetrics(
      file1VsFile2.series,
      file1VsFile2.ticks, 1, 0, 1);

  historian.histogramstats.topMetricTable21 =
      historian.histogramstats.generateTopMetrics(
      file2VsFile1.series,
      file2VsFile1.ticks, -1, 1, 0);

  historian.histogramstats.createTopMetricsTable(
      historian.histogramstats.topMetricTable12, 1, 2);
};


/**
 * Applies the new threshold as selected by the user to all the columns.
 * @param {number} order File order selected by the user.
 * @param {!historian.histogramstats.ABData} file1VsFile2 Metrics for File 1 as
 *      compared with metrics of File 2.
 * @param {!historian.histogramstats.ABData} file2VsFile1 Metrics for File 2 as
 *      compared with metrics of File 1.
 */
historian.histogramstats.refreshAB = function(order,
    file1VsFile2, file2VsFile1) {
  var data;
  var tbl, lbl, index1, index2;
  if (order == historian.histogramstats.Order.FILE1_VS_FILE2) {
    data = file1VsFile2;
    lbl = historian.histogramstats.fileOrdering.getInstance().get(0);
    tbl = historian.histogramstats.topMetricTable12;
    index1 = 1;
    index2 = 2;
  } else {
    data = file2VsFile1;
    lbl = historian.histogramstats.fileOrdering.getInstance().get(1);
    tbl = historian.histogramstats.topMetricTable21;
    index1 = 2;
    index2 = 1;
  }

  historian.histogramstats.drawSingleSeriesHistogram(
      data.series,
      data.ticks,
      historian.histogramstats.Charts.AB,
      historian.histogramstats.Constants.BLANK, lbl);
  historian.histogramstats.createTopMetricsTable(tbl, index1, index2);
};


/**
 * Combines the individual file name strings.
 * @param {string} fileName1 File name of the first file.
 * @param {string} fileName2 File name of the second file.
 * @return {string}
 * @private
 */
historian.histogramstats.combineFileNames_ = function(fileName1, fileName2) {
  return fileName1 + ' vs ' + fileName2;
};


/**
 * Initializes file names based on the comparison entities.
 * @param {string} fileName1 File name of the first file.
 * @param {string} fileName2 File name of the second file.
 * @private
 */
historian.histogramstats.setFileNames_ = function(fileName1, fileName2) {
  historian.histogramstats.fileOrdering.getInstance().set(
      historian.histogramstats.combineFileNames_(
      historian.histogramstats.file1_,
      historian.histogramstats.file2_), 0);
  historian.histogramstats.fileOrdering.getInstance().set(
      historian.histogramstats.combineFileNames_(
      historian.histogramstats.file2_,
      historian.histogramstats.file1_), 1);
};


/**
 * Adding the dropdown list entries.
 */
historian.histogramstats.addSelectOptions = function() {
  var select = document.getElementById('ABSelector');
  var option = document.createElement('option');
  option.text = historian.histogramstats.fileOrdering.getInstance().get(0);
  option.value = historian.histogramstats.Order.FILE1_VS_FILE2;
  select.add(option);
  option = document.createElement('option');
  option.text = historian.histogramstats.fileOrdering.getInstance().get(1);
  option.value = historian.histogramstats.Order.FILE2_VS_FILE1;
  select.add(option);
};


/**
 * Generates the summary stats page.
 * @param {!historian.HistogramStats} stats1 Histogramstats received
 *     from the server.
 * @param {!historian.HistogramStats} stats2 Histogramstats received
 *     from the server.
 * @param {!historian.requests.CombinedCheckinSummary} combinedCheckin
 *     Combined checkin data received from the server.
 * @param {string} fileName1 File name of the first file.
 * @param {string} fileName2 File name of the second file.
 */
historian.histogramstats.initialize = function(stats1, stats2,
    combinedCheckin, fileName1, fileName2) {
  historian.histogramstats.setFileNames_(fileName1, fileName2);
  // Set the dropdown options.
  historian.histogramstats.addSelectOptions();
  historian.histogramstats.combinedCheckin = combinedCheckin;
  historian.histogramstats.generateColorMap();
  historian.histogramstats.generateMetricsMap();
  // Create the file comparison metrics content.
  var file1VsFile2 =
      historian.histogramstats.createABDataSeries(stats1, stats2);
  var file2VsFile1 =
      historian.histogramstats.createABDataSeries(stats2, stats1);
  historian.histogramstats.drawABHistogram(file1VsFile2, file2VsFile1);
  $('#ABSelector').on('change', function() {
    var order = parseInt($(this).val(), 10);
    historian.histogramstats.refreshAB(order, file1VsFile2, file2VsFile1);
  });
  historian.histogramstats.drawUsageHistogram(stats1, stats2);
  historian.histogramstats.drawScreenHistogram(stats1, stats2);
  historian.histogramstats.drawWakelockHistogram(stats1, stats2);
  historian.histogramstats.drawAppHistogram(stats1, stats2);
  historian.histogramstats.drawDataTransferHistogram(stats1, stats2);
  historian.histogramstats.drawCommHistogram(stats1, stats2);
};
