/**
 *
 * Copyright 2015 Google Inc. All Rights Reserved.
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

// upload.js file contains all the javascript scripts for upload.html
(function() {
  var bar = $('.bar');
  var percent = $('.percent');
  var status = $('#status');

  $('form').ajaxForm({
    beforeSend: function() {
      status.empty();
      var percentVal = '0%';
      bar.width(percentVal);
      percent.html(percentVal);
    },
    uploadProgress: function(event, position, total, percentComplete) {
      var percentVal = percentComplete + '%';
      bar.width(percentVal);
      percent.html('Uploading:' + percentVal);
      if (percentComplete === 100) {
        setTimeout(function() { percent.html('Uploading Complete!')}, 1000);
        setTimeout(function() { percent.html('Analyzing...')}, 3000);
      }
    },
    complete: function(xhr) {
      $('body').html(xhr.responseText);
    }
  });
})();

$(document).ready(function() {
  $('.progress').hide();
  $('.bar').hide();
  $('.percent').hide();
  $('form').submit(function() {
    $('.progress').show();
    $('.bar').show();
    $('.percent').show();
  });
});
