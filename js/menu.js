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

goog.module('historian.menu');
goog.module.declareLegacyNamespace();


/**
 * Sets up the links on the menu bar.
 * @param {string=} opt_show_only_options Only show options corresponding to
 *     this comma separated string of selectors.
 */
exports.initMenu = function(opt_show_only_options) {
  $('.header-link').click(function(event) {
    event.stopPropagation();
  });
  $('#menu-top').show();
  if (opt_show_only_options) {
    $('#menu-top a').not(opt_show_only_options).remove();
  }
  $('#menu-top a').not('#new-report').click(function(event) {
    // Prevent default page scroll.
    event.preventDefault();
  });
};


/**
 * Displays a modal dialog with the given title and html body.
 * @param {string} title The title of the dialog.
 * @param {string} body The html body of the dialog.
 * @param {string=} opt_class Optional extra class to apply to the dialog.
 */
exports.showDialog = function(title, body, opt_class) {
  $('#dialog .modal-title').text(title);
  $('#dialog .modal-body').html(body);
  $('#dialog .modal-body').attr('class', 'modal-body');
  if (opt_class) {
    $('#dialog .modal-body').addClass(opt_class);
  }
};

