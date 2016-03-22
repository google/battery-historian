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

goog.module('historian.State');
goog.module.declareLegacyNamespace();


exports = goog.defineClass(null, {
  /**
   * Global Historian state.
   * @constructor
   * @final
   */
  constructor: function() {
    /** @type {number} */
    this.mouseX = 0;

    /** @type {number} */
    this.mouseY = 0;

    this.initMouseTracker_();
  },

  /**
   * Sets up the tracker that records the current mouse position.
   * @private
   */
  initMouseTracker_: function() {
    $('body').mousemove(function(event) {
      this.mouseX = event.pageX;
      this.mouseY = event.pageY;
    }.bind(this));
  }
});
