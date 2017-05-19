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
 * @fileoverview Handles the upload form submission and response.
 */
goog.provide('historian.upload');

goog.require('historian');
goog.require('historian.constants');
goog.require('historian.requests');


/** @private @const {number} */
historian.upload.SUBMIT_BUTTON_WIDTH_ = 100;


/** @private @const {!Array<string>} */
historian.upload.fileEntries_ = [
  'bugreport',
  'bugreport2',
  'kernel',
  'powermonitor'
];


/**
 * Shows the submit button using animation.
 * @private
 */
historian.upload.showSubmitButton_ = function() {
  $('.btn-submit').show()
      .css({
        opacity: 0,
        width: historian.upload.SUBMIT_BUTTON_WIDTH_ * 1.5
      })
      .animate({
        opacity: 1,
        width: historian.upload.SUBMIT_BUTTON_WIDTH_
      }, historian.constants.TRANSITION_DURATION);
};


/**
 * Shows the extra file option for kernel wakesource trace.
 * @private
 */
historian.upload.showKernelOption_ = function() {
  $('#add-kernel').hide();
  $('#kernel-option').show();
  $('#kernel-filename').text('Choose a Kernel Wakesource Trace File');
};


/**
 * Hides the extra file option for kernel wakesource trace.
 * @private
 */
historian.upload.hideKernelOption_ = function() {
  $('#add-kernel').show();
  $('#kernel-option').hide();
  $('#kernel').val('');
};


/**
 * Shows the extra file option for power monitor file.
 * @private
 */
historian.upload.showPowerMonitorOption_ = function() {
  $('#add-powermonitor').hide();
  $('#powermonitor-option').show();
  $('#powermonitor-filename').text('Choose a Power Monitor File');
};


/**
 * Hides the extra file option for power monitor file.
 * @private
 */
historian.upload.hidePowerMonitorOption_ = function() {
  $('#add-powermonitor').show();
  $('#powermonitor-option').hide();
  $('#powermonitor').val('');
};


/**
 * Shows the extra file option for A/B comparison.
 * @private
 */
historian.upload.showComparisonOption_ = function() {
  $('#comparison-option').show();
  $('#add-kernel, #add-powermonitor, #add-comparison').hide();
  $('#kernel-option, #powermonitor-option').hide();
};


/**
 * Hides the extra file option for A/B comparison.
 * @private
 */
historian.upload.hideComparisonOption_ = function() {
  $('#comparison-option').hide();
  $('#add-kernel, #add-powermonitor, #add-comparison').show();
  $('#bugreport2').val('');
};


/**
 * Prepares the file submit buttons and upload responses.
 */
historian.upload.initialize = function() {
  $('body').scrollTop(0);

  $('.form-signin').submit(function() {
    $('.form-signin').hide();
    $('.progress').show();
  });

  $('#bugreport').on('change', function(event) {
    var filename = event.target.files[0].name;
    if (!filename) filename = '';
    $('#bugreport-filename').text(filename);
    $('#processingError').hide();
    historian.upload.showSubmitButton_();
    $('#extra-options').show();
  });

  $('#add-kernel').click(function() {
    historian.upload.showKernelOption_();
  });
  $('#add-powermonitor').click(function() {
    historian.upload.showPowerMonitorOption_();
  });
  $('#add-comparison').click(function() {
    historian.upload.showComparisonOption_();
  });

  $('#remove-kernel').click(function() {
    historian.upload.hideKernelOption_();
  });
  $('#remove-powermonitor').click(function() {
    historian.upload.hidePowerMonitorOption_();
  });
  $('#remove-comparison').click(function() {
    historian.upload.hideComparisonOption_();
  });

  $('#kernel').on('change', function(event) {
    var filename = event.target.files[0].name;
    if (!filename) filename = '';
    $('#kernel-filename').text(filename);
  });
  $('#powermonitor').on('change', function(event) {
    var filename = event.target.files[0].name;
    if (!filename) filename = '';
    $('#powermonitor-filename').text(filename);
  });
  $('#bugreport2').on('change', function(event) {
    var filename = event.target.files[0].name;
    if (filename == null) filename = '';
    $('#bugreport2-filename').text(filename);
  });

  var bar = $('.progress-bar');
  var status = $('#status');

  $('form').ajaxForm({
    beforeSend: function() {
      var formData = new FormData();
      var compareFormData = [new FormData(), new FormData()];
      var index = 0;
      var isComp = ($('#bugreport2')[0].files[0]) != undefined;
      historian.upload.fileEntries_.forEach(function(file) {
        var formFile = $('#' + file)[0].files[0];
        if (formFile) {
          formData.append(file, formFile);
          if (isComp) {
            compareFormData[index].append('bugreport', formFile);
            index++;
          }
        }
      });
      historian.formData = formData;
      historian.compareFormData = compareFormData;

      status.empty();
      var percentVal = '0%';
      bar.css('width', percentVal);
    },
    uploadProgress: function(event, position, total, percentComplete) {
      var percentVal = percentComplete + '%';
      bar.css('width', percentVal);
      bar.text('Uploading:' + percentVal);
      if (percentComplete === 100) {
        setTimeout(function() { bar.text('Uploading Complete!'); }, 1000);
        setTimeout(function() { bar.text('Analyzing...'); }, 3000);
      }
    },
    complete: historian.requests.uploadComplete
  });
};


// Upload is the entry of historian.
// Initialize it when the page is loaded.
$(document).ready(function() {
  historian.upload.initialize();
  $('#file-upload').show();
});
