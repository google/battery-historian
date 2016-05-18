// Copyright 2016 Google Inc. All Rights Reserved.
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

// Package wakeupreason provides helper functions to identify the subsystem which
// caused the APSS to wakeup from suspend.
package wakeupreason

import (
	"errors"
	"fmt"
	"strings"
)

const (
	missingSpmi     = "missing-spmi-change"
	ignoreSubsystem = "Ignore"
	reasonFormatErr = "wakeup_reason format error"
)

var (
	errInputParams = errors.New("input parameters not set")
	// ErrDeviceNotFound indicates that the given device does not have a wakeup reason mapping.
	ErrDeviceNotFound = errors.New("device not found")
)

// Wakeup reason Mapping Table.
// Maps the interrupt name to the corresponding subsystem.
// Format: key: <IRQ_NUMBER>$<IRQ_NAME> Value: <Subsystem name>
// Note that: "Ignore" and "Missing-spmi-change" are
// special keywords for <Subsystem name>
// "Ignore": These interrupts should be ignored as they are
//           not the actual ones reponsible for waking up
//           the system.
// "Missing-spmi-change": A change was added recently to
//           track the actual irq line behind spmi bus that
//           made ap to wake up. The kernel build on the device
//           might be missing the device specific change.

// wakeupReasonN6 maps interrupts to their corresponding subsystem for Nexus 6.
var wakeupReasonN6 = map[string]string{
	"104$MDSS":                       "Display-Most_likely_HDMI",
	"165$msm_dwc3":                   "USB",
	"188$qcom,smd-adsp":              "sensors-Mostly_lift_to wake",
	"216$tsens_interrupt":            "Thermal-threshold_exceeded",
	"417$qpnp_kpdpwr_status":         "pwr_button",
	"418$qpnp_resin_status":          "volume_down_button",
	"421$pma8084_tz":                 "thermal-PMIC_temperature_alarm",
	"424$qpnp_adc_tm_high_interrupt": "Thermal-QPNP_therm_high",
	"425$qpnp_adc_tm_low_interrupt":  "Thermal-QPNP_therm_low",
	"426$qpnp_rtc_alarm":             "rtc_alarm",
	"428$wcd9xxx":                    "Audio_codec",
	"429$dwc3_msm_pmic_id":           "USB_OTG-ID_interrupt",
	"430$mxhci_hsic_wakeup":          "Modem",
	"431$mdm errfatal":               "Modem",
	"432$mdm status":                 "Modem",
	"433$mdm pbl ready":              "Modem",
	"436$bluetooth hostwake":         "bluetooth",
	"437$smb135x_chg_stat_irq":       "Charger_irq-_usb_plug_in",
	"438$max170xx_battery":           "Fuel_gauge",
	"440$bcm2079x":                   "NFC",
	"441$msm_pcie_host_wake":         "wifi",
	"582$hs_det":                     "Headset_detection",
	"584$volume_up":                  "volume_up",
	"585$he_north":                   "Hall_effect_sensor-Smart_Cover_state_change",
	"586$he_south":                   "Hall_effect_sensor-Smart_Cover_state_change",
	"200$qcom,smd-rpm":               ignoreSubsystem,
	"222$fc4cf000.qcom,spmi":         missingSpmi,
	"203$fc4281d0.qcom,mpm":          ignoreSubsystem,
	"240$msmgpio":                    ignoreSubsystem,
}

// wakeupReasonN5 maps interrupts to their corresponding subsystem for Nexus 5.
var wakeupReasonN5 = map[string]string{
	"57$qcom,smd-modem":              "modem",
	"58$qcom,smsm-modem":             "modem",
	"104$MDSS":                       "Display-Most_likely_HDMI",
	"165$msm_dwc3":                   "USB",
	"188$qcom,smd-adsp":              "sensors-Mostly_lift_to wake",
	"216$tsens_interrupt":            "Thermal-threshold_exceeded",
	"288$wcd9xxx":                    "Audio_Codec",
	"289$bcmsdh_sdmmc":               "Wifi",
	"290$pm8841_tz":                  "Thermal-qpnp_temperature_alarm",
	"291$pm8941_tz":                  "Thermal-qpnp_temperature_alarm",
	"292$qpnp_kpdpwr_status":         "pwr_button",
	"301$qpnp_rtc_alarm":             "rtc_alarm",
	"304$qpnp_adc_tm_interrupt":      "Thermal-qpnp_temperature_alarm",
	"305$qpnp_adc_tm_high_interrupt": "Thermal-QPNP_therm_high",
	"306$qpnp_adc_tm_low_interrupt":  "Thermal-QPNP_therm_low",
	"310$maxim_max1462x.81":          "Headset_detection",
	"311$maxim_max1462x.81":          "Headset_detection",
	"312$bluetooth hostwake":         "bluetooth",
	"317$earjack_debugger_trigger":   "Audio_jack_cable_state_change",
	"318$volume_up":                  "volume_up",
	"319$volume_down":                "volume_down",
	"329$anx7808":                    "USB_cable_insert-slimport",
	"338$bq24192_irq":                "USB_charger_chip",
	"350$bq51013b":                   "USB_charger_chip",
	"360$bcm2079x":                   "NFC",
	"361$MAX17048_Alert":             "Fuel_gauge",
	"362$s3350":                      "Touch_Screen",
	"587$cover-switch":               "Smart_cover",
	"200$qcom,smd-rpm":               ignoreSubsystem,
	"222$fc4cf000.qcom,spmi":         missingSpmi,
	"203$fc4281d0.qcom,mpm":          ignoreSubsystem,
	"240$msmgpio":                    ignoreSubsystem,
}

var wakeupReasonN5x = map[string]string{
	"1$usbin-uv$USB charger":         "input voltage low",
	"2$usbin-ov$USB charger":         "input voltage high",
	"3$usbin-src-det$USB charger":    "input detection complete",
	"4$otg-fail$USB charger":         "otg fail interrupt",
	"5$otg-oc":                       "USB charger - otg over current",
	"6$aicl-done":                    "USB charger - input current limit detection done",
	"7$batt-missing":                 "USB charger - battery missing",
	"8$chg-rechg-thr":                "USB charger - battery voltage below resume voltage",
	"9$chg-taper-thr":                "USB charger - battery charging transition to taper charge",
	"10$chg-tcc-thr":                 "USB charger - charging completed",
	"11$batt-warm":                   "USB charger - battery warm",
	"12$batt-cold":                   "USB charger - battery cold",
	"13$batt-cool":                   "USB charger - battery cold",
	"15$bcl_vbat_interrupt":          "battery status monitoring - voltage limit interrupt",
	"58$qcom,smsm-modem":             "modem",
	"115$MDSS":                       "Display-Most_likely_HDMI",
	"188$qcom,smd-adsp":              "sensors-Mostly_lift_to wake",
	"212$msm_dwc3":                   "USB",
	"216$tsens_interrupt":            "Thermal-threshold_exceeded",
	"332$sps":                        "modem",
	"448$msm_hs_wakeup":              "bluetooth",
	"449$pm8994_tz":                  "sensors_subsystem - alarm",
	"450$qpnp_kpdpwr_status":         "power button press - qpnp-power-on - AP",
	"451$qpnp_resin_status":          "PMIC reset - qpnp-power-on - AP",
	"452$qpnp_kpdpwr_bark":           "qpnp-power-on - bark interrupt - AP",
	"454$qpnp_kpdpwr_resin_bark":     "qpnp-power-on - bark interrupt - AP",
	"457$qpnp_adc_tm_high_interrupt": "Thermal-QPNP_therm_high",
	"458$qpnp_adc_tm_low_interrupt":  "Thermal-QPNP_therm_low",
	"459$qpnp_rtc_alarm":             "rtc_alarm",
	"460$bcl_ibat_interrupt":         "battery status monitoring - current limit interrupt",
	"464$chg-error":                  "Battery charging error",
	"468$chg-p2f-thr":                "Battery charger interrupt - fast charge threshold",
	"469$batt-hot":                   "Battery charger interrupt - battery temp high",
	"470$batt-low":                   "Battery charger interrupt - battery temp low",
	"473$dcin-uv":                    "Battery charger interrupt - DC input voltage low",
	"475$power-ok":                   "Battery charger interrupt - charger switcher on/off",
	"476$temp-shutdown":              "Battery charger interrupt - charger chip hot",
	"477$safety-timeout":             "Battery charger interrupt - safety-timeout",
	"483$full-soc":                   "fuel gauge - battery full",
	"484$empty-soc":                  "fuel gauge - battery empty",
	"485$delta-soc":                  "fuel gauge - battery level changed",
	"486$first-est-done":             "fuel gauge - battery level first estimation done",
	"491$vbatt-low":                  "fuel gauge - battery voltage low",
	"495$batt-missing":               "fuel gauge - battery missing",
	"497$mem-avail":                  "fuel gauge interrupt",
	"499$qpnp_wled_sc_irq":           "backlight wled short circuit interrupt",
	"500$qpnp_sc_irq":                "backlight short circuit interrupt",
	"502$wcd9xxx":                    "audio codec - earjack insert/remove",
	"504$synaptics_rmi4_i2c":         "touchscreen interrupt",
	"505$fusb301_int_irq":            "USB Type-C controller interrupt",
	"506$pn548":                      "nfc interrupt",
	"507$msm_pcie_wake":              "wifi interrupt",
	"604$spi1.2":                     "finger print sensor",
	"605$spi7.0":                     "nanohub - sensors",
	"670$volume_up":                  "volume_up button",
	"200$qcom,smd-rpm":               ignoreSubsystem,
	"203$fc4281d0.qcom,mpm":          ignoreSubsystem,
	"240$fd510000.pinctrl":           ignoreSubsystem,
	"222$fc4cf000.qcom,spmi":         missingSpmi,
	"57$qcom,smd-modem":              ignoreSubsystem,
	"605$nanohub-irq1":               "nanohub-mostly_lift_to_wake",
}

var wakeupReasonN6p = map[string]string{
	"1$usbin-uv$USB charger":         "input voltage low",
	"2$usbin-ov$USB charger":         "input voltage high",
	"3$usbin-src-det$USB charger":    "input detection complete",
	"4$otg-fail$USB charger":         "otg fail interrupt",
	"5$otg-oc":                       "USB charger - otg over current",
	"6$aicl-done":                    "USB charger - input current limit detection done",
	"7$batt-missing":                 "USB charger - battery missing",
	"8$chg-rechg-thr":                "USB charger - battery voltage below resume voltage",
	"9$chg-taper-thr":                "USB charger - battery charging transition to taper charge",
	"10$chg-tcc-thr":                 "USB charger - charging completed",
	"11$batt-warm":                   "USB charger - battery warm",
	"12$batt-cold":                   "USB charger - battery cold",
	"13$batt-cool":                   "USB charger - battery cold",
	"15$bcl_vbat_interrupt":          "battery status monitoring - voltage limit interrupt",
	"58$qcom,smsm-modem":             "modem",
	"115$MDSS":                       "Display-Most_likely_HDMI",
	"188$qcom,smd-adsp":              "sensors-Mostly_lift_to wake",
	"212$msm_dwc3":                   "USB",
	"216$tsens_interrupt":            "Thermal-threshold_exceeded",
	"332$sps":                        "modem",
	"449$wcd9xxx":                    "audio codec - earjack insert/remove",
	"451$qpnp_kpdpwr_status":         "power button press - qpnp-power-on - AP",
	"452$qpnp_resin_status":          "PMIC reset - qpnp-power-on - AP",
	"454$qpnp_kpdpwr_resin_bark":     "qpnp-power-on - bark interrupt - AP",
	"457$qpnp_adc_tm_high_interrupt": "Thermal-QPNP_therm_high",
	"458$qpnp_adc_tm_low_interrupt":  "Thermal-QPNP_therm_low",
	"459$qpnp_rtc_alarm":             "rtc_alarm",
	"460$bcl_ibat_interrupt":         "battery status monitoring - current limit interrupt",
	"462$qpnp_vadc_high_interrupt":   "QPNP-Voltage_high",
	"463$qpnp_vadc_low_interrupt":    "QPNP-Voltage_low",
	"464$chg-error":                  "Battery charging error",
	"468$chg-p2f-thr":                "Battery charger interrupt - fast charge threshold",
	"469$batt-hot":                   "Battery charger interrupt - battery temp high",
	"470$batt-low":                   "Battery charger interrupt - battery temp low",
	"473$dcin-uv":                    "Battery charger interrupt - DC input voltage low",
	"475$power-ok":                   "Battery charger interrupt - charger switcher on/off",
	"476$temp-shutdown":              "Battery charger interrupt - charger chip hot",
	"477$safety-timeout":             "Battery charger interrupt - safety-timeout",
	"483$full-soc":                   "fuel gauge - battery full",
	"484$empty-soc":                  "fuel gauge - battery empty",
	"485$delta-soc":                  "fuel gauge - battery level changed",
	"486$first-est-done":             "fuel gauge - battery level first estimation done",
	"491$vbatt-low":                  "fuel gauge - battery voltage low",
	"495$batt-missing":               "fuel gauge - battery missing",
	"497$mem-avail":                  "fuel gauge interrupt",
	"499$qpnp_wled_sc_irq":           "backlight wled short circuit interrupt",
	"500$qpnp_sc_irq":                "backlight short circuit interrupt",
	"502$fpc1020.81":                 "fingerprint sensor",
	"504$pn548":                      "nfc interrupt",
	"506$msm_pcie_wake":              "wifi interrupt",
	"603$spi5.0":                     "sensorhub",
	"603$spi12.0":                    "Deprecated interrupt should not be seen in newer kernels",
	"604$tusb320_int":                "USB-Type-c",
	"605$bluetooth hostwake":         "bluetooth",
	"606$f98a4900.sdhci cd":          "sdcard",
	"604$spi1.2":                     "finger print sensor",
	"605$spi7.0":                     "nanohub - sensors",
	"671$volume_up":                  "volume_up button",
	"200$qcom,smd-rpm":               ignoreSubsystem,
	"203$fc4281d0.qcom,mpm":          ignoreSubsystem,
	"240$fd510000.pinctrl":           ignoreSubsystem,
	"222$fc4cf000.qcom,spmi":         missingSpmi,
	"57$qcom,smd-modem":              ignoreSubsystem,
}

var deviceMap = map[string]map[string]string{
	"angler":     wakeupReasonN6p,
	"bullhead":   wakeupReasonN5x,
	"hammerhead": wakeupReasonN5,
	"shamu":      wakeupReasonN6,
}

// IsSupportedDevice identifies whether the given device has a wakeup reason mapping or not.
// The input should be device name (eg. hammerhead) and not model name (eg. Nexus 5).
func IsSupportedDevice(device string) bool {
	return deviceMap[device] != nil
}

// FindSubsystem parses the "input" string against the device specific mapping table.
// Example: FindSubsystem("hammerhead",
// "200:qcom,smd-rpm:203:fc4281d0.qcom,mpm:304:qpnp_adc_tm_interrupt:338:bq24192_irq")
func FindSubsystem(device string, input string) (string, []string, error) {
	if device == "" || input == "" {
		return "", nil, errInputParams
	}

	reasonMap, ok := deviceMap[device]
	if !ok {
		return "", nil, ErrDeviceNotFound
	}

	wakeup := false
	spmi := false
	var output, unknown []string

	// Splits the input string delimited by ":".
	// Builds the key (<IRQ_NUMBER>$<IRQ_NAME>) and performs
	// a lookup against the Mapping table passed.
	// The reason and the subsystem splices hold the interrupt
	// name and corresponding subsystem.
	// Sets flags based on lookup results.
	reasons := strings.Split(input, ":")
	for i := range reasons {
		if (i % 2) != 0 {
			if ss, ok := reasonMap[fmt.Sprint(reasons[i-1], "$", reasons[i])]; ok {
				if ss == missingSpmi {
					spmi = true
				} else if ss != ignoreSubsystem {
					wakeup = true
					output = append(output, ss)
				}
			} else {
				// Original string had a colon between the two.
				r := fmt.Sprint(reasons[i-1], ":", reasons[i])
				unknown = append(unknown, r)
				output = append(output, r)
			}
		}
	}

	var err error
	if len(unknown) == 0 && !wakeup {
		if spmi {
			err = errors.New(missingSpmi)
		} else {
			// Only ignoreSubsystem reasons were encountered.
			err = fmt.Errorf("%s: %q", reasonFormatErr, input)
		}
	}

	return strings.Join(output, ", "), unknown, err
}
