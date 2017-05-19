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
 * @fileoverview Typedef of the BatteryStats proto.
 */

goog.provide('batterystats.BatteryStats');
goog.provide('batterystats.BatteryStats.AggregationType');
goog.provide('batterystats.BatteryStats.App');
goog.provide('batterystats.BatteryStats.App.Apk');
goog.provide('batterystats.BatteryStats.App.Apk.Service');
goog.provide('batterystats.BatteryStats.App.Audio');
goog.provide('batterystats.BatteryStats.App.BluetoothMisc');
goog.provide('batterystats.BatteryStats.App.Camera');
goog.provide('batterystats.BatteryStats.App.Child');
goog.provide('batterystats.BatteryStats.App.Cpu');
goog.provide('batterystats.BatteryStats.App.Flashlight');
goog.provide('batterystats.BatteryStats.App.Foreground');
goog.provide('batterystats.BatteryStats.App.Network');
goog.provide('batterystats.BatteryStats.App.PowerUseItem');
goog.provide('batterystats.BatteryStats.App.Process');
goog.provide('batterystats.BatteryStats.App.ScheduledJob');
goog.provide('batterystats.BatteryStats.App.Sensor');
goog.provide('batterystats.BatteryStats.App.StateTime');
goog.provide('batterystats.BatteryStats.App.Sync');
goog.provide('batterystats.BatteryStats.App.UserActivity');
goog.provide('batterystats.BatteryStats.App.UserActivity.Name');
goog.provide('batterystats.BatteryStats.App.Vibrator');
goog.provide('batterystats.BatteryStats.App.Video');
goog.provide('batterystats.BatteryStats.App.Wakelock');
goog.provide('batterystats.BatteryStats.App.WakeupAlarm');
goog.provide('batterystats.BatteryStats.App.Wifi');
goog.provide('batterystats.BatteryStats.ControllerActivity');
goog.provide('batterystats.BatteryStats.ControllerActivity.TxLevel');
goog.provide('batterystats.BatteryStats.System');
goog.provide('batterystats.BatteryStats.System.Battery');
goog.provide('batterystats.BatteryStats.System.BatteryDischarge');
goog.provide('batterystats.BatteryStats.System.BatteryLevel');
goog.provide('batterystats.BatteryStats.System.BluetoothState');
goog.provide('batterystats.BatteryStats.System.BluetoothState.Name');
goog.provide('batterystats.BatteryStats.System.ChargeStep');
goog.provide('batterystats.BatteryStats.System.ChargeTimeRemaining');
goog.provide('batterystats.BatteryStats.System.DataConnection');
goog.provide('batterystats.BatteryStats.System.DataConnection.Name');
goog.provide('batterystats.BatteryStats.System.DischargeStep');
goog.provide('batterystats.BatteryStats.System.DischargeTimeRemaining');
goog.provide('batterystats.BatteryStats.System.DisplayState');
goog.provide('batterystats.BatteryStats.System.DisplayState.State');
goog.provide('batterystats.BatteryStats.System.GlobalBluetooth');
goog.provide('batterystats.BatteryStats.System.GlobalNetwork');
goog.provide('batterystats.BatteryStats.System.GlobalWifi');
goog.provide('batterystats.BatteryStats.System.IdleMode');
goog.provide('batterystats.BatteryStats.System.IdleMode.Mode');
goog.provide('batterystats.BatteryStats.System.KernelWakelock');
goog.provide('batterystats.BatteryStats.System.Misc');
goog.provide('batterystats.BatteryStats.System.PowerSaveMode');
goog.provide('batterystats.BatteryStats.System.PowerSaveMode.Mode');
goog.provide('batterystats.BatteryStats.System.PowerUseItem');
goog.provide('batterystats.BatteryStats.System.PowerUseItem.Name');
goog.provide('batterystats.BatteryStats.System.PowerUseSummary');
goog.provide('batterystats.BatteryStats.System.ScreenBrightness');
goog.provide('batterystats.BatteryStats.System.ScreenBrightness.Name');
goog.provide('batterystats.BatteryStats.System.SignalScanningTime');
goog.provide('batterystats.BatteryStats.System.SignalStrength');
goog.provide('batterystats.BatteryStats.System.SignalStrength.Name');
goog.provide('batterystats.BatteryStats.System.WakeupReason');
goog.provide('batterystats.BatteryStats.System.WifiSignalStrength');
goog.provide('batterystats.BatteryStats.System.WifiSignalStrength.Name');
goog.provide('batterystats.BatteryStats.System.WifiState');
goog.provide('batterystats.BatteryStats.System.WifiState.Name');
goog.provide('batterystats.BatteryStats.System.WifiSupplicantState');
goog.provide('batterystats.BatteryStats.System.WifiSupplicantState.Name');
goog.provide('build.Build');


/**
 * @typedef {{
 *   fingerprint: (string|undefined),
 *   brand: (string|undefined),
 *   product: (string|undefined),
 *   device: (string|undefined),
 *   release: (string|undefined),
 *   build_id: (string|undefined),
 *   incremental: (string|undefined),
 *   type: (string|undefined),
 *   tags: Array.<string>
 * }}
 */
build.Build;


/**
 * @typedef {{
 *   name: (string|undefined),
 *   version_code: (number|undefined),
 *   version_name: (string|undefined),
 *   apk: (batterystats.BatteryStats.App.Apk|undefined)
 * }}
 */
batterystats.BatteryStats.App.Child;


/**
 * @typedef {{
 *   name: (string|undefined),
 *   start_time_msec: (number|undefined),
 *   starts: (number|undefined),
 *   launches: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Apk.Service;


/**
 * @typedef {{
 *   wakeups: (number|undefined),
 *   service: Array.<batterystats.BatteryStats.App.Apk.Service>
 * }}
 */
batterystats.BatteryStats.App.Apk;


/**
 * @typedef {{
 *   total_time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Audio;


/**
 * @typedef {{
 *   ble_scan_time_msec: (number|undefined),
 *   ble_scan_count: (number|undefined),
 *   ble_scan_count_bg: (number|undefined),
 *   ble_scan_actual_time_msec: (number|undefined),
 *   ble_scan_actual_time_msec_bg: (number|undefined),
 *   ble_scan_result_count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.BluetoothMisc;


/**
 * @typedef {{
 *   total_time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Camera;


/**
 * @typedef {{
 *   user_time_ms: (number|undefined),
 *   system_time_ms: (number|undefined),
 *   power_ma_ms: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Cpu;


/**
 * @typedef {{
 *   total_time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Flashlight;


/**
 * @typedef {{
 *   total_time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Foreground;


/**
 * @typedef {{
 *   mobile_bytes_rx: (number|undefined),
 *   mobile_bytes_tx: (number|undefined),
 *   wifi_bytes_rx: (number|undefined),
 *   wifi_bytes_tx: (number|undefined),
 *   mobile_packets_rx: (number|undefined),
 *   mobile_packets_tx: (number|undefined),
 *   wifi_packets_rx: (number|undefined),
 *   wifi_packets_tx: (number|undefined),
 *   mobile_active_time_msec: (number|undefined),
 *   mobile_active_count: (number|undefined),
 *   bt_bytes_rx: (number|undefined),
 *   bt_bytes_tx: (number|undefined),
 *   mobile_wakeup_count: (number|undefined),
 *   wifi_wakeup_count: (number|undefined),
 *   mobile_bytes_bg_rx: (number|undefined),
 *   mobile_bytes_bg_tx: (number|undefined),
 *   wifi_bytes_bg_rx: (number|undefined),
 *   wifi_bytes_bg_tx: (number|undefined),
 *   mobile_packets_bg_rx: (number|undefined),
 *   mobile_packets_bg_tx: (number|undefined),
 *   wifi_packets_bg_rx: (number|undefined),
 *   wifi_packets_bg_tx: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Network;


/**
 * @typedef {{
 *   computed_power_mah: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.PowerUseItem;


/**
 * @typedef {{
 *   name: (string|undefined),
 *   user_time_msec: (number|undefined),
 *   system_time_msec: (number|undefined),
 *   foreground_time_msec: (number|undefined),
 *   starts: (number|undefined),
 *   anrs: (number|undefined),
 *   crashes: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Process;


/**
 * @typedef {{
 *   name: (string|undefined),
 *   total_time_msec: (number|undefined),
 *   count: (number|undefined),
 *   background_time_msec: (number|undefined),
 *   background_count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.ScheduledJob;


/**
 * @typedef {{
 *   number: (number|undefined),
 *   total_time_msec: (number|undefined),
 *   count: (number|undefined),
 *   background_count: (number|undefined),
 *   actual_time_msec: (number|undefined),
 *   background_actual_time_msec: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Sensor;


/**
 * @typedef {{
 *   foreground_time_msec: (number|undefined),
 *   active_time_msec: (number|undefined),
 *   cached_time_msec: (number|undefined),
 *   top_time_msec: (number|undefined),
 *   foreground_service_time_msec: (number|undefined),
 *   top_sleeping_time_msec: (number|undefined),
 *   background_time_msec: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.StateTime;


/**
 * @typedef {{
 *   name: (string|undefined),
 *   total_time_msec: (number|undefined),
 *   count: (number|undefined),
 *   background_time_msec: (number|undefined),
 *   background_count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Sync;


/**
 * @enum {number}
 */
batterystats.BatteryStats.App.UserActivity.Name = {
  OTHER: 0,
  BUTTON: 1,
  TOUCH: 2,
  ACCESSIBILITY: 3
};


/**
 * @typedef {{
 *   name: (batterystats.BatteryStats.App.UserActivity.Name|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.UserActivity;


/**
 * @typedef {{
 *   total_time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Vibrator;


/**
 * @typedef {{
 *   total_time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Video;


/**
 * @typedef {{
 *   name: (string|undefined),
 *   full_time_msec: (number|undefined),
 *   full_count: (number|undefined),
 *   full_current_duration_msec: (number|undefined),
 *   full_max_duration_msec: (number|undefined),
 *   full_total_duration_msec: (number|undefined),
 *   partial_time_msec: (number|undefined),
 *   partial_count: (number|undefined),
 *   partial_current_duration_msec: (number|undefined),
 *   partial_max_duration_msec: (number|undefined),
 *   partial_total_duration_msec: (number|undefined),
 *   window_time_msec: (number|undefined),
 *   window_count: (number|undefined),
 *   window_current_duration_msec: (number|undefined),
 *   window_max_duration_msec: (number|undefined),
 *   window_total_duration_msec: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Wakelock;


/**
 * @typedef {{
 *   name: (string|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.WakeupAlarm;


/**
 * @typedef {{
 *   full_wifi_lock_time_msec: (number|undefined),
 *   scan_time_msec: (number|undefined),
 *   running_time_msec: (number|undefined),
 *   scan_count: (number|undefined),
 *   idle_time_msec: (number|undefined),
 *   rx_time_msec: (number|undefined),
 *   tx_time_msec: (number|undefined),
 *   scan_count_bg: (number|undefined),
 *   scan_actual_time_msec: (number|undefined),
 *   scan_actual_time_msec_bg: (number|undefined)
 * }}
 */
batterystats.BatteryStats.App.Wifi;


/**
 * @typedef {{
 *   name: (string|undefined),
 *   version_code: (number|undefined),
 *   uid: (number|undefined),
 *   version_name: (string|undefined),
 *   child: Array.<batterystats.BatteryStats.App.Child>,
 *   head_child: (batterystats.BatteryStats.App.Child|undefined),
 *   apk: (batterystats.BatteryStats.App.Apk|undefined),
 *   audio: (batterystats.BatteryStats.App.Audio|undefined),
 *   bluetooth_controller: (batterystats.BatteryStats.ControllerActivity|undefined),
 *   bluetooth_misc: (batterystats.BatteryStats.App.BluetoothMisc|undefined),
 *   camera: (batterystats.BatteryStats.App.Camera|undefined),
 *   cpu: (batterystats.BatteryStats.App.Cpu|undefined),
 *   flashlight: (batterystats.BatteryStats.App.Flashlight|undefined),
 *   foreground: (batterystats.BatteryStats.App.Foreground|undefined),
 *   modem_controller: (batterystats.BatteryStats.ControllerActivity|undefined),
 *   network: (batterystats.BatteryStats.App.Network|undefined),
 *   power_use_item: (batterystats.BatteryStats.App.PowerUseItem|undefined),
 *   process: Array.<batterystats.BatteryStats.App.Process>,
 *   scheduled_job: Array.<batterystats.BatteryStats.App.ScheduledJob>,
 *   sensor: Array.<batterystats.BatteryStats.App.Sensor>,
 *   state_time: (batterystats.BatteryStats.App.StateTime|undefined),
 *   sync: Array.<batterystats.BatteryStats.App.Sync>,
 *   user_activity: Array.<batterystats.BatteryStats.App.UserActivity>,
 *   vibrator: (batterystats.BatteryStats.App.Vibrator|undefined),
 *   video: (batterystats.BatteryStats.App.Video|undefined),
 *   wakelock: Array.<batterystats.BatteryStats.App.Wakelock>,
 *   wakeup_alarm: Array.<batterystats.BatteryStats.App.WakeupAlarm>,
 *   wifi: (batterystats.BatteryStats.App.Wifi|undefined),
 *   wifi_controller: (batterystats.BatteryStats.ControllerActivity|undefined)
 * }}
 */
batterystats.BatteryStats.App;


/**
 * @typedef {{
 *   level: (number|undefined),
 *   time_msec: (number|undefined)
 * }}
 */
batterystats.BatteryStats.ControllerActivity.TxLevel;


/**
 * @typedef {{
 *   idle_time_msec: (number|undefined),
 *   rx_time_msec: (number|undefined),
 *   power_mah: (number|undefined),
 *   tx: Array.<batterystats.BatteryStats.ControllerActivity.TxLevel>
 * }}
 */
batterystats.BatteryStats.ControllerActivity;


/**
 * @typedef {{
 *   start_count: (number|undefined),
 *   battery_realtime_msec: (number|undefined),
 *   battery_uptime_msec: (number|undefined),
 *   total_realtime_msec: (number|undefined),
 *   total_uptime_msec: (number|undefined),
 *   start_clock_time_msec: (number|undefined),
 *   screen_off_realtime_msec: (number|undefined),
 *   screen_off_uptime_msec: (number|undefined),
 *   estimated_battery_capacity_mah: (number|undefined),
 *   min_learned_battery_capacity_uah: (number|undefined),
 *   max_learned_battery_capacity_uah: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.Battery;


/**
 * @typedef {{
 *   lower_bound: (number|undefined),
 *   upper_bound: (number|undefined),
 *   screen_on: (number|undefined),
 *   screen_off: (number|undefined),
 *   total_mah: (number|undefined),
 *   total_mah_screen_off: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.BatteryDischarge;


/**
 * @typedef {{
 *   start_level: (number|undefined),
 *   current_level: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.BatteryLevel;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.BluetoothState.Name = {
  INACTIVE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3
};


/**
 * @typedef {{
 *   name: (batterystats.BatteryStats.System.BluetoothState.Name|undefined),
 *   time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.BluetoothState;


/**
 * @typedef {{
 *   time_msec: (number|undefined),
 *   level: (number|undefined),
 *   display_state: (batterystats.BatteryStats.System.DisplayState.State|undefined),
 *   power_save_mode: (batterystats.BatteryStats.System.PowerSaveMode.Mode|undefined),
 *   idle_mode: (batterystats.BatteryStats.System.IdleMode.Mode|undefined)
 * }}
 */
batterystats.BatteryStats.System.ChargeStep;


/**
 * @typedef {{
 *   usec: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.ChargeTimeRemaining;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.DataConnection.Name = {
  NONE: 0,
  GPRS: 1,
  EDGE: 2,
  UMTS: 3,
  CDMA: 4,
  EVDO_0: 5,
  EVDO_A: 6,
  ONE_X_RTT: 7,
  HSDPA: 8,
  HSUPA: 9,
  HSPA: 10,
  IDEN: 11,
  EVDO_B: 12,
  LTE: 13,
  EHRPD: 14,
  HSPAP: 15,
  OTHER: 16
};


/**
 * @typedef {{
 *   name: (batterystats.BatteryStats.System.DataConnection.Name|undefined),
 *   time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.DataConnection;


/**
 * @typedef {{
 *   time_msec: (number|undefined),
 *   level: (number|undefined),
 *   display_state: (batterystats.BatteryStats.System.DisplayState.State|undefined),
 *   power_save_mode: (batterystats.BatteryStats.System.PowerSaveMode.Mode|undefined),
 *   idle_mode: (batterystats.BatteryStats.System.IdleMode.Mode|undefined)
 * }}
 */
batterystats.BatteryStats.System.DischargeStep;


/**
 * @typedef {{
 *   usec: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.DischargeTimeRemaining;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.DisplayState.State = {
  MIXED: 0,
  ON: 1,
  OFF: 2,
  DOZE: 3,
  DOZE_SUSPEND: 4
};


/**
 * @typedef {Object}
 */
batterystats.BatteryStats.System.DisplayState;


/**
 * @typedef {{
 *   bluetooth_idle_time_msec: (number|undefined),
 *   bluetooth_rx_time_msec: (number|undefined),
 *   bluetooth_tx_time_msec: (number|undefined),
 *   bluetooth_power_mah: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.GlobalBluetooth;


/**
 * @typedef {{
 *   mobile_bytes_rx: (number|undefined),
 *   mobile_bytes_tx: (number|undefined),
 *   wifi_bytes_rx: (number|undefined),
 *   wifi_bytes_tx: (number|undefined),
 *   mobile_packets_rx: (number|undefined),
 *   mobile_packets_tx: (number|undefined),
 *   wifi_packets_rx: (number|undefined),
 *   wifi_packets_tx: (number|undefined),
 *   bt_bytes_rx: (number|undefined),
 *   bt_bytes_tx: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.GlobalNetwork;


/**
 * @typedef {{
 *   wifi_on_time_msec: (number|undefined),
 *   wifi_running_time_msec: (number|undefined),
 *   wifi_idle_time_msec: (number|undefined),
 *   wifi_rx_time_msec: (number|undefined),
 *   wifi_tx_time_msec: (number|undefined),
 *   wifi_power_mah: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.GlobalWifi;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.IdleMode.Mode = {
  NO_DATA: 0,
  MIXED: 1,
  ON: 2,
  OFF: 3
};


/**
 * @typedef {Object}
 */
batterystats.BatteryStats.System.IdleMode;


/**
 * @typedef {{
 *   name: (string|undefined),
 *   time_msec: (number|undefined),
 *   count: (number|undefined),
 *   current_duration_msec: (number|undefined),
 *   max_duration_msec: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.KernelWakelock;


/**
 * @typedef {{
 *   screen_on_time_msec: (number|undefined),
 *   screen_off_time_msec: (number|undefined),
 *   phone_on_time_msec: (number|undefined),
 *   wifi_on_time_msec: (number|undefined),
 *   wifi_running_time_msec: (number|undefined),
 *   bluetooth_on_time_msec: (number|undefined),
 *   mobile_bytes_rx: (number|undefined),
 *   mobile_bytes_tx: (number|undefined),
 *   wifi_bytes_rx: (number|undefined),
 *   wifi_bytes_tx: (number|undefined),
 *   full_wakelock_time_msec: (number|undefined),
 *   partial_wakelock_time_msec: (number|undefined),
 *   mobile_active_time_msec: (number|undefined),
 *   mobile_active_adjusted_time_msec: (number|undefined),
 *   interactive_time_msec: (number|undefined),
 *   low_power_mode_enabled_time_msec: (number|undefined),
 *   connectivity_changes: (number|undefined),
 *   device_idle_mode_enabled_time_msec: (number|undefined),
 *   device_idle_mode_enabled_count: (number|undefined),
 *   device_idling_time_msec: (number|undefined),
 *   device_idling_count: (number|undefined),
 *   mobile_active_count: (number|undefined),
 *   mobile_active_unknown_time: (number|undefined),
 *   device_light_idle_mode_enabled_time_msec: (number|undefined),
 *   device_light_idle_mode_enabled_count: (number|undefined),
 *   device_light_idling_time_msec: (number|undefined),
 *   device_light_idling_count: (number|undefined),
 *   max_device_light_idle_mode_enabled_time_msec: (number|undefined),
 *   max_device_idle_mode_enabled_time_msec: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.Misc;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.PowerSaveMode.Mode = {
  MIXED: 0,
  ON: 1,
  OFF: 2
};


/**
 * @typedef {Object}
 */
batterystats.BatteryStats.System.PowerSaveMode;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.PowerUseItem.Name = {
  IDLE: 0,
  CELL: 1,
  PHONE: 2,
  WIFI: 3,
  BLUETOOTH: 4,
  SCREEN: 5,
  APP: 6,
  USER: 7,
  UNACCOUNTED: 8,
  OVERCOUNTED: 9,
  DEFAULT: 10,
  FLASHLIGHT: 11
};


/**
 * @typedef {{
 *   name: (batterystats.BatteryStats.System.PowerUseItem.Name|undefined),
 *   computed_power_mah: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.PowerUseItem;


/**
 * @typedef {{
 *   battery_capacity_mah: (number|undefined),
 *   computed_power_mah: (number|undefined),
 *   min_drained_power_mah: (number|undefined),
 *   max_drained_power_mah: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.PowerUseSummary;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.ScreenBrightness.Name = {
  DARK: 0,
  DIM: 1,
  MEDIUM: 2,
  LIGHT: 3,
  BRIGHT: 4
};


/**
 * @typedef {{
 *   name: (batterystats.BatteryStats.System.ScreenBrightness.Name|undefined),
 *   time_msec: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.ScreenBrightness;


/**
 * @typedef {{
 *   time_msec: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.SignalScanningTime;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.SignalStrength.Name = {
  NONE_OR_UNKNOWN: 0,
  POOR: 1,
  MODERATE: 2,
  GOOD: 3,
  GREAT: 4
};


/**
 * @typedef {{
 *   name: (batterystats.BatteryStats.System.SignalStrength.Name|undefined),
 *   time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.SignalStrength;


/**
 * @typedef {{
 *   name: (string|undefined),
 *   time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.WakeupReason;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.WifiSignalStrength.Name = {
  NONE: 0,
  POOR: 1,
  MODERATE: 2,
  GOOD: 3,
  GREAT: 4
};


/**
 * @typedef {{
 *   name: (batterystats.BatteryStats.System.WifiSignalStrength.Name|undefined),
 *   time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.WifiSignalStrength;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.WifiSupplicantState.Name = {
  INVALID: 0,
  DISCONNECTED: 1,
  INTERFACE_DISABLED: 2,
  INACTIVE: 3,
  SCANNING: 4,
  AUTHENTICATING: 5,
  ASSOCIATING: 6,
  ASSOCIATED: 7,
  FOUR_WAY_HANDSHAKE: 8,
  GROUP_HANDSHAKE: 9,
  COMPLETED: 10,
  DORMANT: 11,
  UNINITIALIZED: 12
};


/**
 * @typedef {{
 *   name: (batterystats.BatteryStats.System.WifiSupplicantState.Name|undefined),
 *   time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.WifiSupplicantState;


/**
 * @enum {number}
 */
batterystats.BatteryStats.System.WifiState.Name = {
  OFF: 0,
  OFF_SCANNING: 1,
  ON_NO_NETWORKS: 2,
  ON_DISCONNECTED: 3,
  ON_CONNECTED_STA: 4,
  ON_CONNECTED_P2P: 5,
  ON_CONNECTED_STA_P2P: 6,
  SOFT_AP: 7
};


/**
 * @typedef {{
 *   name: (batterystats.BatteryStats.System.WifiState.Name|undefined),
 *   time_msec: (number|undefined),
 *   count: (number|undefined)
 * }}
 */
batterystats.BatteryStats.System.WifiState;


/**
 * @typedef {{
 *   battery: (batterystats.BatteryStats.System.Battery|undefined),
 *   battery_discharge: (batterystats.BatteryStats.System.BatteryDischarge|undefined),
 *   battery_level: (batterystats.BatteryStats.System.BatteryLevel|undefined),
 *   bluetooth_state: Array.<batterystats.BatteryStats.System.BluetoothState>,
 *   charge_step: Array.<batterystats.BatteryStats.System.ChargeStep>,
 *   charge_time_remaining: (batterystats.BatteryStats.System.ChargeTimeRemaining|undefined),
 *   data_connection: Array.<batterystats.BatteryStats.System.DataConnection>,
 *   discharge_step: Array.<batterystats.BatteryStats.System.DischargeStep>,
 *   discharge_time_remaining: (batterystats.BatteryStats.System.DischargeTimeRemaining|undefined),
 *   global_bluetooth: (batterystats.BatteryStats.System.GlobalBluetooth|undefined),
 *   global_bluetooth_controller: (batterystats.BatteryStats.ControllerActivity|undefined),
 *   global_modem_controller: (batterystats.BatteryStats.ControllerActivity|undefined),
 *   global_network: (batterystats.BatteryStats.System.GlobalNetwork|undefined),
 *   global_wifi: (batterystats.BatteryStats.System.GlobalWifi|undefined),
 *   global_wifi_controller: (batterystats.BatteryStats.ControllerActivity|undefined),
 *   kernel_wakelock: Array.<batterystats.BatteryStats.System.KernelWakelock>,
 *   misc: (batterystats.BatteryStats.System.Misc|undefined),
 *   power_use_item: Array.<batterystats.BatteryStats.System.PowerUseItem>,
 *   power_use_summary: (batterystats.BatteryStats.System.PowerUseSummary|undefined),
 *   screen_brightness: Array.<batterystats.BatteryStats.System.ScreenBrightness>,
 *   signal_scanning_time: (batterystats.BatteryStats.System.SignalScanningTime|undefined),
 *   signal_strength: Array.<batterystats.BatteryStats.System.SignalStrength>,
 *   wakeup_reason: Array.<batterystats.BatteryStats.System.WakeupReason>,
 *   wifi_signal_strength: Array.<batterystats.BatteryStats.System.WifiSignalStrength>,
 *   wifi_supplicant_state: Array.<batterystats.BatteryStats.System.WifiSupplicantState>,
 *   wifi_state: Array.<batterystats.BatteryStats.System.WifiState>
 * }}
 */
batterystats.BatteryStats.System;


/**
 * @enum {number}
 */
batterystats.BatteryStats.AggregationType = {
  SINCE_CHARGED: 0,
  LAST: 1,
  CURRENT: 2,
  SINCE_UNPLUGGED: 3
};


/**
 * @typedef {{
 *   record_id: (string|undefined),
 *   android_idx: (string|undefined),
 *   start_time_usec: (number|undefined),
 *   end_time_usec: (number|undefined),
 *   start_time_str: (string|undefined),
 *   end_time_str: (string|undefined),
 *   local_start_time_str: (string|undefined),
 *   local_end_time_str: (string|undefined),
 *   device_group: Array.<string>,
 *   checkin_rule: Array.<string>,
 *   is_googler: (boolean|undefined),
 *   is_user_release: (boolean|undefined),
 *   build: (build.Build|undefined),
 *   sdk_version: (number|undefined),
 *   gms_version: (number|undefined),
 *   bootloader: (string|undefined),
 *   radio: (string|undefined),
 *   carrier: (string|undefined),
 *   country_code: (string|undefined),
 *   time_zone: (string|undefined),
 *   report_version: (number|undefined),
 *   is_original: (boolean|undefined),
 *   is_latest: (boolean|undefined),
 *   is_diff: (boolean|undefined),
 *   is_alt_mode: (boolean|undefined),
 *   warning: Array.<string>,
 *   error: Array.<string>,
 *   aggregation_type: (batterystats.BatteryStats.AggregationType|undefined),
 *   app: Array.<batterystats.BatteryStats.App>,
 *   system: (batterystats.BatteryStats.System|undefined)
 * }}
 */
batterystats.BatteryStats;
