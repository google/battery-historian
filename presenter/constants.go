// Copyright 2015 Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package presenter

const (
	// Checkin Summary Stats: Prefixed with C
	cUptimeSecsPerHr                = "UptimeSecsPerHr"
	cScreenOffUptimeSecsPerHr       = "ScreenOffUptimeSecsPerHr"
	cScreenOnTimeSecsPerHr          = "ScreenOnTimeSecsPerHr"
	cPartialWakelockTimeSecsPerHr   = "PartialWakelockTimeSecsPerHr"
	cKernelOverheadTimeSecsPerHr    = "KernelOverheadTimeSecsPerHr"
	cSignalScanningTimeSecsPerHr    = "SignalScanningTimeSecsPerHr"
	cMobileActiveTimeSecsPerHr      = "MobileActiveTimeSecsPerHr"
	cWifiOnTimeSecsPerHr            = "WifiOnTimeSecsPerHr"
	cWifiIdleTimeSecsPerHr          = "WifiIdleTimeSecsPerHr"
	cWifiTransmitTimeSecsPerHr      = "WifiTransmitTimeSecsPerHr"
	cBluetoothIdleTimeSecsPerHr     = "BluetoothIdleTimeSecsPerHr"
	cBluetoothTransmitTimeSecsPerHr = "BluetoothTransmitTimeSecsPerHr"

	cScreenOffDichargeRatePerHr  = "ScreenOffDichargeRatePerHr"
	cScreenOnDichargeRatePerHr   = "ScreenOnDichargeRatePerHr"
	cMobileKiloBytesPerHr        = "MobileKiloBytesPerHr"
	cWifiKiloBytesPerHr          = "WifiKiloBytesPerHr"
	cWifiDischargeRatePerHr      = "WifiDischargeRatePerHr"
	cBluetoothDischargeRatePerHr = "BluetoothDischargeRatePerHr"

	// History Summary Stats: Prefixed with H
	hScreenOn          = "ScreenOn"
	hScreenOnNumPerHr  = "ScreenOnNumPerHr"
	hScreenOnSecsPerHr = "ScreenOnSecsPerHr"

	hCPURunning          = "CPURunning"
	hCPURunningNumPerHr  = "CPURunningNumPerHr"
	hCPURunningSecsPerHr = "CPURunningSecsPerHr"

	hRadioOn          = "RadioOn"
	hRadioOnNumPerHr  = "RadioOnNumPerHr"
	hRadioOnSecsPerHr = "RadioOnSecsPerHr"

	hPhoneCall          = "PhoneCall"
	hPhoneCallNumPerHr  = "PhoneCallNumPerHr"
	hPhoneCallSecsPerHr = "PhoneCallSecsPerHr"

	hGpsOn          = "GpsOn"
	hGpsOnNumPerHr  = "GpsOnNumPerHr"
	hGpsOnSecsPerHr = "GpsOnSecsPerHr"

	hWifiFullLock          = "WifiFullLock"
	hWifiFullLockNumPerHr  = "WifiFullLockNumPerHr"
	hWifiFullLockSecsPerHr = "WifiFullLockSecsPerHr"

	hWifiScan          = "WifiScan"
	hWifiScanNumPerHr  = "WifiScanNumPerHr"
	hWifiScanSecsPerHr = "WifiScanSecsPerHr"

	hWifiMulticastOn          = "WifiMulticastOn"
	hWifiMulticastOnNumPerHr  = "WifiMulticastOnNumPerHr"
	hWifiMulticastOnSecsPerHr = "WifiMulticastOnSecsPerHr"

	hWifiOn          = "WifiOn"
	hWifiOnNumPerHr  = "WifiOnNumPerHr"
	hWifiOnSecsPerHr = "WifiOnSecsPerHr"

	hPhoneScan          = "PhoneScan"
	hPhoneScanNumPerHr  = "PhoneScanNumPerHr"
	hPhoneScanSecsPerHr = "PhoneScanSecsPerHr"

	hSensorOn          = "SensorOn"
	hSensorOnNumPerHr  = "SensorOnNumPerHr"
	hSensorOnSecsPerHr = "SensorOnSecsPerHr"

	hPluggedIn          = "PluggedIn"
	hPluggedInNumPerHr  = "PluggedInNumPerHr"
	hPluggedInSecsPerHr = "PluggedInSecsPerHr"

	hTotalSync          = "TotalSync"
	hTotalSyncNumPerHr  = "TotalSyncNumPerHr"
	hTotalSyncSecsPerHr = "TotalSyncSecsPerHr"

	hIdleModeOn          = "IdleModeOn"
	hIdleModeOnNumPerHr  = "IdleModeOnNumPerHr"
	hIdleModeOnSecsPerHr = "IdleModeOnSecsPerHr"

	// Multi variable stats
	hDataConnectionSummary     = "DataConnectionSummary"
	hConnectivitySummary       = "ConnectivitySummary"
	hPerAppSyncSummary         = "PerAppSyncSummary"
	hWakeupReasonSummary       = "WakeupReasonSummary"
	hPhoneStateSummary         = "PhoneStateSummary"
	hForegroundProcessSummary  = "ForegroundProcessSummary"
	hFirstWakelockAfterSuspend = "FirstWakelockAfterSuspend"
	hScheduledJobSummary       = "ScheduledJobSummary"
)
