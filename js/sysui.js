/**
 * Copyright 2017 Google Inc. All Rights Reserved.
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

goog.module('historian.sysui');
goog.module.declareLegacyNamespace();


/**
 * Map from transition id (e.g. APP_TRANSITION_REASON) to the original entry.
 * @typedef {!Object<!historian.Entry>}
 */
exports.AppTransition;


/**
 * App transition ids (from frameworks/base/proto/src/metrics_constants.proto).
 * @enum {number}
 */
var Transition = {
  DELAY_MS: 319,
  REASON: 320,
  STARTING_WINDOW_DELAY_MS: 321,
  WINDOWS_DRAWN_DELAY_MS: 322,
  COMPONENT_NAME: 323,
  PROCESS_RUNNING: 324,
  DEVICE_UPTIME_SECONDS: 325
};


/**
 * Map from transition id to human readable description.
 * @const {!Object<string>}
 */
exports.TransitionDesc = {
  [Transition.DELAY_MS]:
      'Ms from startActivity until app transition starts to animate',
  [Transition.STARTING_WINDOW_DELAY_MS]:
      'Ms from startActivity until starting window was drawn',
  [Transition.WINDOWS_DRAWN_DELAY_MS]:
      'Ms from startActivity until all windows are drawn',
  [Transition.PROCESS_RUNNING]:
      'Whether the process was already running'
};


/**
 * Map from transition reason value to human readable description.
 * (from frameworks/base/core/java/android/app/ActivityManagerInternal.java)
 * @const {!Object<string>}
 */
exports.TransitionReason = {
  0: 'APP_TRANSITION_SAVED_SURFACE',
  1: 'APP_TRANSITION_STARTING_WINDOW',
  2: 'APP_TRANSITION_WINDOWS_DRAWN',
  3: 'APP_TRANSITION_TIMEOUT'
};


/**
 * @param {number} id The transition id to check.
 * @return {boolean} Whether the id is a transition id.
 */
exports.isTransition = function(id) {
  return id >= Transition.DELAY_MS && id <= Transition.DEVICE_UPTIME_SECONDS;
};


/** @enum {number} */
exports.Transition = Transition;
