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
 * @fileoverview Class for displaying a tooltip.
 */
goog.provide('historian.Tooltip');



/**
 * Creates a tooltip with the given contents, at the given coordinates.
 * If no coordinates are given, show the tooltip near the mouse cursor.
 *
 * @param {!Array<string>} lines The Html contents to display in tooltip.
 * @param {!historian.State} state Global Historian state.
 * @param {string=} opt_classes One or more space-separated classes to add.
 * @param {number=} opt_x The x coordinate of the tooltip.
 * @param {number=} opt_y The y coordinate of the tooltip.
 * @constructor
 * @struct
 */
historian.Tooltip = function(lines, state, opt_classes, opt_x, opt_y) {

  /**
   * @private {number}
   */
  this.x_ = opt_x || state.mouseX;

  /**
   * @private {number}
   */
  this.y_ = opt_y || state.mouseY;

  /** @private {!jQuery} */
  this.tooltip_ = $('<div></div>');

  this.tooltip_.addClass('historian-tooltip')
      .html(lines.join('<br>'))
      .css({
        left: this.x_ + historian.Tooltip.OFFSET,
        top: this.y_ + historian.Tooltip.OFFSET
      });

  if (opt_classes) {
    this.tooltip_.addClass(opt_classes);
  }

  // Must append to obtain correct width.
  this.tooltip_.hide()
      .appendTo('body');
  this.adjustPosition();
  this.show();
};


/**
 * Sets the tooltip position based on the width and height of its contents.
 */
historian.Tooltip.prototype.adjustPosition = function() {
  var tooltip = this.tooltip_;
  var width = tooltip.innerWidth();
  var height = tooltip.innerHeight();
  if (this.x_ + historian.Tooltip.OFFSET + width > $('body').innerWidth()) {
    var left = this.x_ - historian.Tooltip.OFFSET - width;
    // If the tooltip is going to be cut off in either direction, we'd rather
    // see the start of the tooltip, so only change the tooltip to the right
    // if the whole contents are visible.
    if (left >= 0) {
      this.tooltip_.css('left', left);
    } else {
      // Tooltip is going to be cut off if we display it to the left or right.
      // Show the tooltip below mouse cursor. Start the tooltip as far left as
      // possible.
      this.tooltip_.css('left', 0);
    }
  }
  var windowHeight = $(window.top).height();
  var yOffset = window.pageYOffset || 0;
  // The tooltip is displayed below the mouse cursor. If the tooltip
  // would be off screen, display it above the mouse cursor instead.
  if (this.y_ + historian.Tooltip.OFFSET + height - yOffset > windowHeight) {
    var top = this.y_ - historian.Tooltip.OFFSET - height;
    if (top >= yOffset) {
      this.tooltip_.css('top', top);
    }
  }
};


/**
 * Shows the tooltip.
 */
historian.Tooltip.prototype.show = function() {
  this.tooltip_.appendTo('body').show();
};


/**
 * Removes the tooltip from the screen.
 */
historian.Tooltip.prototype.hide = function() {
  this.tooltip_.remove();
};


/** @const {number} */
historian.Tooltip.OFFSET = 10;
