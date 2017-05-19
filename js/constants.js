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

goog.module('historian.constants');
goog.module.declareLegacyNamespace();


/** @enum {string} */
exports.Elements = {
  // Dropdown for selecting a level metric to overlay.
  LEVEL_SELECT: '.line-overlay-metrics'
};


/**
 * @const {number}
 */
exports.NOT_FOUND = -1;


/** @const {number} */
exports.WIDTH = 0;


/** @const {number} */
exports.HEIGHT = 1;


/** @const {number} */
exports.NUM_SCREEN_DIMENSIONS = 2;


/**
 * Default transition duration.
 * @const {number}
 */
exports.TRANSITION_DURATION = 250;


/**
 * Unknown start or end time for an event.
 * @const {number}
 */
exports.UNKNOWN_TIME = -1;
