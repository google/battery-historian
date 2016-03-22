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

goog.module('historian.note');
goog.module.declareLegacyNamespace();


/** @const {number} */
var NOTE_HIDE_DELAY = 2000;


/** @const {number} */
var NOTE_HIDE_DURATION = 500;


/**
 * Show a closable note at the top of the page.
 * @param {string} msg The note message to be displayed.
 * @param {boolean=} opt_autoHide If true, hide the note automatically.
 */
exports.show = function(msg, opt_autoHide) {
  var note = $('.historian-note')
      .not('.historian-note-spawn')
      .clone()
      .addClass('historian-note-spawn')
      .prependTo('.navbar-fixed-top')
      .show();
  note.children('span').text(msg);
  if (opt_autoHide) {
    note.delay(NOTE_HIDE_DELAY).animate({
      opacity: 0
    }, NOTE_HIDE_DURATION, function() {
      note.remove();
    });
  }
};
