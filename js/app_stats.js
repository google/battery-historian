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
 * @fileoverview Utilities to display app specific metrics.
 */

goog.provide('historian.AppStat');
goog.provide('historian.SensorInfo');
goog.provide('historian.UserActivity');
goog.provide('historian.appstats');

goog.require('goog.array');
goog.require('goog.string');
goog.require('historian.tables');

goog.forwardDeclare('batterystats.BatteryStats');
goog.forwardDeclare('batterystats.BatteryStats.App');
goog.forwardDeclare('batterystats.BatteryStats.App.Apk');
goog.forwardDeclare('batterystats.BatteryStats.App.Child');
goog.forwardDeclare('batterystats.BatteryStats.App.Network');
goog.forwardDeclare('batterystats.BatteryStats.App.Process');
goog.forwardDeclare('batterystats.BatteryStats.App.ScheduledJob');
goog.forwardDeclare('batterystats.BatteryStats.App.StateTime');
goog.forwardDeclare('batterystats.BatteryStats.App.Sync');
goog.forwardDeclare('batterystats.BatteryStats.App.Wakelock');
goog.forwardDeclare('batterystats.BatteryStats.App.Wifi');


/**
 * The AppStat data received from server analyzer.
 *
 * @typedef {{
 *   DevicePowerPrediction: number,
 *   CPUPowerPrediction: number,
 *   RawStats: batterystats.BatteryStats.App,
 *   Sensor: !Array<historian.SensorInfo>,
 *   UserActivity: !Array<historian.UserActivity>
 * }}
 */
historian.AppStat;


/**
 * An object detailing sensor usage information.
 *
 * @typedef {{
 *   Name: string,
 *   Type: string,
 *   Version: number,
 *   Number: number,
 *   TotalTimeMs: number,
 *   Count: number
 * }}
 */
historian.SensorInfo;


/**
 * An object detailing user interaction with an app.
 *
 * @typedef {{
 *   Type: string,
 *   Count: number
 * }}
 */
historian.UserActivity;


/**
 * Displays or hides the section detailing the child field in the app proto.
 *
 * @param {string} appName the saved app proto name
 * @param {!Array<batterystats.BatteryStats.App.Child>} children
 *     the list of child elements
 */
historian.appstats.displayAppChild = function(appName, children) {
  var section = $('#appChildSection');
  // Display this section only if there are multiple children or
  // if the single child is under one of our predefined shared UID
  // groupings (ie. com.google.android.gms under GOOGLE_SERVICES).
  if (children && (children.length > 1 ||
                   (children.length == 1 &&
                    children[0].name != appName))) {
    section.show();
    // Pre-sort in alphabetical order.
    children.sort(function(a, b) {
      if (!b.name) {
        return -1;
      }
      return a.name.localeCompare(b.name);
    });
    var headRow = ['Package Name', 'Version Code', 'Version Name'];
    var bodyRows = [];
    bodyRows = goog.array.map(children, function(child) {
      return [child.name, child.version_code, child.version_name];
    });
    var table = historian.tables.createTable(headRow, bodyRows);
    $('#appChild').empty().append(table);
    historian.tables.activateDataTable(table);
    historian.tables.activateTableCopy(table);
  } else {
    section.hide();
    section.next('.sliding').hide();
  }
};


/**
 * Displays or hides the section detailing the Apk field in the app proto.
 *
 * @param {batterystats.BatteryStats.App.Apk} apk
 *     the apk field of the app proto
 */
historian.appstats.displayAppApk = function(apk) {
  var section = $('#appApkSection');
  if (apk) {
    section.show();
    $('#appWakeups').text(apk.wakeups);
    $('#appServices').empty();

    if (apk.service && apk.service.length > 0) {
      // Pre-sort services in decreasing order of time spent started,
      // # launches, and # starts.
      apk.service.sort(function(a, b) {
        return b.start_time_msec - a.start_time_msec ||
            b.launches - a.launches ||
            b.starts - a.starts;
      });

      var headRow = [
        'Service Name',
        {
          value: 'Time spent started',
          classes: 'duration'
        },
        {
          value: '# starts',
          title: 'Total number of times startService() was called'
        },
        {
          value: '# launches',
          title: 'Total number of times the service was launched'
        }
      ];
      var bodyRows = [];
      for (var i = 0; i < apk.service.length; i++) {
        var service = apk.service[i];
        bodyRows.push([
          service.name,
          service.start_time_msec ?
              historian.time.formatDuration(service.start_time_msec) :
              '',
          service.starts,
          service.launches
        ]);
      }
      var table = historian.tables.createTable(headRow, bodyRows);
      $('#appServices').empty().append(table);
      historian.tables.activateDataTable(table);
      historian.tables.activateTableCopy(table);
    }
  } else {
    section.hide();
    section.next('.sliding').hide();
  }
};


/**
 * Displays or hides the section detailing the app's network activity.
 *
 * @param {batterystats.BatteryStats.App.Network} network
 *     the Network field of the app proto
 * @param {batterystats.BatteryStats.App.Wifi} wifi
 *     the Wifi field of the app proto
 */
historian.appstats.displayAppNetworkInfo = function(network, wifi) {
  var section = $('#appNetworkInfoSection');
  if (network || wifi) {
    section.show();
    var bodyRows = [];
    if (network) {
      // The fields can technically be undefined.
      var mobileRx = network.mobile_bytes_rx || 0;
      var mobileTx = network.mobile_bytes_tx || 0;
      bodyRows.push([
        'Mobile data transferred',
        goog.string.subs('%s total (%s received, %s transmitted)',
            historian.utils.describeBytes(mobileRx + mobileTx),
            historian.utils.describeBytes(mobileRx),
            historian.utils.describeBytes(mobileTx))
      ]);
      var wifiRx = network.wifi_bytes_rx || 0;
      var wifiTx = network.wifi_bytes_tx || 0;
      bodyRows.push([
        'Wifi data transferred',
        goog.string.subs('%s total (%s received, %s transmitted)',
            historian.utils.describeBytes(wifiRx + wifiTx),
            historian.utils.describeBytes(wifiRx),
            historian.utils.describeBytes(wifiTx))
      ]);
      bodyRows.push([
        'Mobile packets transferred',
        goog.string.subs('%s total (%s received, %s transmitted)',
            network.mobile_packets_rx + network.mobile_packets_tx,
            network.mobile_packets_rx, network.mobile_packets_tx)
      ]);
      bodyRows.push([
        'Wifi packets transferred',
        goog.string.subs('%s total (%s received, %s transmitted)',
            network.wifi_packets_rx + network.wifi_packets_tx,
            network.wifi_packets_rx, network.wifi_packets_tx)
      ]);
      var row = [
        'Mobile active time',
        network.mobile_active_time_msec ?
            historian.time.formatDuration(network.mobile_active_time_msec) : ''
      ];
      row.title = 'Amount of time the app kept the mobile radio active';
      bodyRows.push(row);
      bodyRows.push(['Mobile active count', network.mobile_active_count]);
    }
    if (wifi) {
      bodyRows.push([
        'Full wifi lock time',
        wifi.full_wifi_lock_time_msec ?
            historian.time.formatDuration(wifi.full_wifi_lock_time_msec) : ''
      ]);
      if (historian.appstats.reportVersion >= 12) {
        // This was added during the time when the report version was 12 and
        // the BatteryStatsImpl version was 119, but some version
        // reports won't have this info.
        // TODO: modify parsing to use BatteryStatsImpl so that
        // we can be smarter about showing this value.
        bodyRows.push(['Wifi scan count', wifi.scan_count]);
      }
      bodyRows.push([
        'Wifi scan time',
        wifi.scan_time_msec ?
            historian.time.formatDuration(wifi.scan_time_msec) : ''
      ]);
      if (historian.appstats.reportVersion >= 14) {
        bodyRows.push([
          'Wifi idle time',
          wifi.idle_time_msec ?
              historian.time.formatDuration(wifi.idle_time_msec) : ''
        ]);
        var transmit_time_msec = 0;
        if (wifi.rx_time_msec) {
          transmit_time_msec += wifi.rx_time_msec;
        }
        if (wifi.tx_time_msec) {
          transmit_time_msec += wifi.tx_time_msec;
        }
        bodyRows.push([
          'Wifi transfer time',
          goog.string.subs('%s total (%s receiving, %s transmitting)',
              historian.time.formatDuration(transmit_time_msec),
              wifi.rx_time_msec ?
              historian.time.formatDuration(wifi.rx_time_msec) : '',
              wifi.tx_time_msec ?
              historian.time.formatDuration(wifi.tx_time_msec) : ''
          )
        ]);
      }
    }
    var table = historian.tables.createTable(null, bodyRows)
        .addClass('no-paging no-ordering no-info no-header');
    $('#appNetworkInfo').empty().append(table);
    historian.tables.activateDataTable(table);
    historian.tables.activateTableCopy(table);
  } else {
    section.hide();
    section.next('.sliding').hide();
  }
};


/**
 * Displays or hides the section detailing the app's processes.
 *
 * @param {!Array<batterystats.BatteryStats.App.Process>} processes
 *     the list of processes in the app proto
 * @param {!Array<batterystats.BatteryStats.App.StateTime>} states
 *     info on the process states for the app
 */
historian.appstats.displayAppProcess = function(processes, states) {
  // State times are not shown for reports < 17 because they're not
  // believed to be reliable.
  var section = $('#appProcessSection');
  if ((processes && processes.length > 0) ||
      (states && historian.appstats.reportVersion >= 17)) {
    section.show();
    $('#appProcess').empty();

    if (states && historian.appstats.reportVersion >= 17) {
      var bodyRows = [];
      bodyRows.push([
        {
          value: 'Time spent running actively in the foreground',
          title: 'This does not include time running as top, top sleeping,' +
              ' or with a service in the foreground'
        },
        historian.time.formatDuration(states.foreground_time_msec)
      ]);
      bodyRows.push([
        {
          value: 'Time spent with a service running in the foreground'
        },
        historian.time.formatDuration(states.foreground_service_time_msec)
      ]);
      bodyRows.push([
        {
          value: 'Time spent on top',
          title: 'The app would be visible to the user'
        },
        historian.time.formatDuration(states.top_time_msec)
      ]);
      bodyRows.push([
        {
          value: 'Time spent on top while the device was sleeping',
          title: 'Sleeping is mostly screen off, but also includes the the' +
              ' time when the screen is on but the device has not yet been' +
              ' unlocked.'
        },
        historian.time.formatDuration(states.top_sleeping_time_msec)
      ]);
      bodyRows.push([
        {
          value: 'Time spent running actively in the background'
        },
        historian.time.formatDuration(states.background_time_msec)
      ]);
      bodyRows.push([
        {
          value: 'Time spent cached',
          title: 'There was some process running'
        },
        historian.time.formatDuration(states.cached_time_msec)
      ]);

      var table = historian.tables.createTable(null, bodyRows)
          .addClass('no-paging no-ordering no-info no-searching no-header');
      $('#appProcess').append(table);
      historian.tables.activateDataTable(table);
      historian.tables.activateTableCopy(table);
    }
    if ((processes && processes.length > 0) &&
        (states && historian.appstats.reportVersion >= 17)) {
      // Add space and identify the process list if both tables are being shown.
      $('#appProcess').append('<br><h4>Processes:</h4>');
    }
    if (processes && processes.length > 0) {
      // Pre-sort in decreasing order of user time, system time, and starts.
      processes.sort(function(a, b) {
        return b.user_time_msec - a.user_time_msec ||
            b.system_time_msec - a.system_time_msec ||
            b.starts - a.starts;
      });

      var headRow = [
        'Process Name',
        {
          value: 'User Time',
          title: 'Total time spent executing in user code',
          classes: 'duration'
        },
        {
          value: 'System Time',
          title: 'Total time spent executing in system code',
          classes: 'duration'
        },
        {
          value: 'Foreground Time',
          title: 'CPU time spent while the process was in the foreground',
          classes: 'duration'
        },
        {
          value: '# Starts',
          title: '# times the process has been started'
        },
        '# ANRs',
        '# Crashes'
      ];
      var bodyRows = goog.array.map(processes, function(process) {
        return [
          process.name,
          process.user_time_msec ?
              historian.time.formatDuration(process.user_time_msec) : '',
          process.system_time_msec ?
              historian.time.formatDuration(process.system_time_msec) : '',
          process.foreground_time_msec ?
              historian.time.formatDuration(process.foreground_time_msec) : '',
          process.starts,
          process.anrs,
          process.crashes
        ];
      });
      var table = historian.tables.createTable(headRow, bodyRows);
      $('#appProcess').append(table);
      historian.tables.activateDataTable(table);
      historian.tables.activateTableCopy(table);
    }
  } else {
    section.hide();
    section.next('.sliding').hide();
  }
};


/**
 * Displays or hides the section detailing scheduled jobs used by the app.
 *
 * @param {!Array<batterystats.BatteryStats.App.ScheduledJob>} scheduledJobs
 *     the list of scheduled jobs in the app proto
 */
historian.appstats.displayAppScheduledJob = function(scheduledJobs) {
  var section = $('#appScheduledJobSection');
  if (scheduledJobs && scheduledJobs.length > 0) {
    section.show();

    // Pre-sort by decreasing total time and count.
    scheduledJobs.sort(function(a, b) {
      return b.total_time_msec - a.total_time_msec || b.count - a.count;
    });

    var headRow = [
      'Job Name',
      {
        value: 'Total Time',
        classes: 'duration'
      },
      'Count'
    ];
    var bodyRows = [];
    for (var i = 0; i < scheduledJobs.length; i++) {
      var j = scheduledJobs[i];
      bodyRows.push([
        j.name,
        j.total_time_msec ?
            historian.time.formatDuration(j.total_time_msec) : '',
        j.count
      ]);
    }
    var table = historian.tables.createTable(headRow, bodyRows);
    $('#appScheduledJob').empty().append(table);
    historian.tables.activateDataTable(table);
    historian.tables.activateTableCopy(table);
  } else {
    section.hide();
    section.next('.sliding').hide();
  }
};


/**
 * Displays or hides the section detailing the app's sensor activity.
 *
 * @param {!Array<historian.SensorInfo>} sensors the list of sensor usage
 *     of the app
 */
historian.appstats.displayAppSensor = function(sensors) {
  var section = $('#appSensorSection');
  if (sensors && sensors.length > 0) {
    section.show();

    // Pre-sort in decreasing order of total time and count.
    sensors.sort(function(a, b) {
      return b.TotalTimeMs - a.TotalTimeMs || b.Count - a.Count;
    });
    var headRow = [
      'Sensor',
      {
        value: 'Total Time',
        classes: 'duration'
      },
      'Count'
    ];
    var bodyRows = [];
    for (var i = 0; i < sensors.length; i++) {
      var s = sensors[i];
      var name = s.Name;
      if (s.Type) {
        name += goog.string.subs(' (%s)', s.Type);
      }
      bodyRows.push([
        name,
        s.TotalTimeMs ?
            historian.time.formatDuration(s.TotalTimeMs) : '',
        s.Count
      ]);
    }
    var table = historian.tables.createTable(headRow, bodyRows);
    $('#appSensor').empty().append(table);
    historian.tables.activateDataTable(table);
    historian.tables.activateTableCopy(table);
  } else {
    section.hide();
    section.next('.sliding').hide();
  }
};


/**
 * Displays or hides the section detailing all of the app's sync activity.
 *
 * @param
 * {!Array<batterystats.BatteryStats.App.Sync>}
 *     syncs the list of sync info in the app proto
 */
historian.appstats.displayAppSync = function(syncs) {
  var section = $('#appSyncSection');
  if (syncs && syncs.length > 0) {
    section.show();

    // Pre-sort in decreasing order of total time and count.
    syncs.sort(function(a, b) {
      return b.total_time_msec - a.total_time_msec || b.count - a.count;
    });

    var headRow = [
      'Sync Name',
      {
        value: 'Total Time',
        classes: 'duration'
      },
      'Count'
    ];
    var bodyRows = [];
    for (var i = 0; i < syncs.length; i++) {
      var s = syncs[i];
      bodyRows.push([
        s.name,
        s.total_time_msec ?
            historian.time.formatDuration(s.total_time_msec) : '',
        s.count
      ]);
    }
    var table = historian.tables.createTable(headRow, bodyRows);
    $('#appSync').empty().append(table);
    historian.tables.activateDataTable(table);
    historian.tables.activateTableCopy(table);
  } else {
    section.hide();
    section.next('.sliding').hide();
  }
};


/**
 * Displays or hides the section detailing user interaction with the app.
 *
 * @param {!Array<historian.UserActivity>} ua the list of UserActivity info
 *     in the app proto
 */
historian.appstats.displayAppUserActivity = function(ua) {
  var section = $('#appUserActivitySection');
  if (ua && ua.length > 0) {
    section.show();

    // Pre-sort by decreasing count.
    ua.sort(function(a, b) {
      return b.Count - a.Count;
    });
    var headRow = ['Name', 'Count'];
    var bodyRows = [];
    for (var i = 0; i < ua.length; i++) {
      var a = ua[i];
      bodyRows.push([a.Type, a.Count]);
    }
    var table = historian.tables.createTable(headRow, bodyRows);
    $('#appUserActivity').empty().append(table);
    historian.tables.activateDataTable(table);
    historian.tables.activateTableCopy(table);
  } else {
    section.hide();
    section.next('.sliding').hide();
  }
};


/**
 * Displays or hides the section detailing wakelocks held by the app.
 *
 * @param
 * {!Array<batterystats.BatteryStats.App.Wakelock>}
 *     wakelocks the list of Wakelock info in the app proto
 */
historian.appstats.displayAppWakelock = function(wakelocks) {
  var section = $('#appWakelockSection');
  if (wakelocks && wakelocks.length > 0) {
    section.show();

    // Pre-sort in decreasing order of full time, partial time, window time,
    // full count, partial count, and window count.
    wakelocks.sort(function(a, b) {
      return b.full_time_msec - a.full_time_msec ||
             b.partial_time_msec - a.partial_time_msec ||
             b.window_time_msec - a.window_time_msec ||
             b.full_count - a.full_count ||
             b.partial_count - a.partial_count ||
             b.window_count - a.window_count;
    });

    var headRow = [
      'Wakelock Name',
      {
        value: 'Full Time',
        title: 'Time held holding a full wake lock',
        classes: 'duration'
      },
      {
        value: 'Full Count',
        title: 'Number of full wake locks held'
      },
      {
        value: 'Partial Time',
        title: 'Time held holding a partial wake lock',
        classes: 'duration'
      },
      {
        value: 'Partial Count',
        title: 'Number of partial wake locks held'
      },
      {
        value: 'Window Time',
        title: 'Time held holding a window wake lock',
        classes: 'duration'
      },
      {
        value: 'Window Count',
        title: 'Number of window wake locks held'
      }
    ];
    var bodyRows = [];
    for (var i = 0; i < wakelocks.length; i++) {
      var w = wakelocks[i];
      bodyRows.push([
        w.name,
        w.full_time_msec ?
            historian.time.formatDuration(w.full_time_msec) : '',
        w.full_count,
        w.partial_time_msec ?
            historian.time.formatDuration(w.partial_time_msec) : '',
        w.partial_count,
        w.window_time_msec ?
            historian.time.formatDuration(w.window_time_msec) : '',
        w.window_count
      ]);
    }
    var table = historian.tables.createTable(headRow, bodyRows);
    $('#appWakelock').empty().append(table);
    historian.tables.activateDataTable(table);
    historian.tables.activateTableCopy(table);
  } else {
    section.hide();
    section.next('.sliding').hide();
  }
};


/**
 * Displays info about the desired app.
 *
 * @param {number|string} appUid the uid of the app to display information about
 */
historian.appstats.displayApp = function(appUid) {
  $('.noAppSelected').css('display', 'none');
  $('#selectedAppStats').css('display', '');

  var app = historian.appstats.appStats[appUid];

  var bodyRows = [];
  bodyRows.push(['Application', app.RawStats.name]);
  bodyRows.push(['Version Code', app.RawStats.version_code]);
  bodyRows.push(['UID', app.RawStats.uid]);

  if (app.DevicePowerPrediction) {
    bodyRows.push([
      'Device estimated power use',
      goog.string.subs('%s%', app.DevicePowerPrediction.toFixed(2))
    ]);
  }
  if (app.RawStats.foreground) {
    bodyRows.push([
      'Foreground',
      goog.string.subs('%s times over %s',
          app.RawStats.foreground.count,
          historian.time.formatDuration(
              app.RawStats.foreground.total_time_msec))
    ]);
  }
  if (app.RawStats.vibrator) {
    bodyRows.push([
      'Vibrator use',
      goog.string.subs('%s times over %s',
          app.RawStats.vibrator.count,
          historian.time.formatDuration(app.RawStats.vibrator.total_time_msec))
    ]);
  }
  if (app.RawStats.cpu) {
    bodyRows.push([
      'CPU user time',
      historian.time.formatDuration(app.RawStats.cpu.user_time_ms)
    ]);
    bodyRows.push([
      'CPU system time',
      historian.time.formatDuration(app.RawStats.cpu.system_time_ms)
    ]);
    bodyRows.push([
      'Device estimated power use due to CPU usage',
      goog.string.subs('%s%', app.CPUPowerPrediction.toFixed(2))
    ]);
  }
  if (app.RawStats.audio) {
    bodyRows.push([
      'Audio',
      goog.string.subs('%s times for a total duration of %s',
          app.RawStats.audio.count,
          historian.time.formatDuration(
              app.RawStats.audio.total_time_msec))
    ]);
  }
  if (app.RawStats.camera) {
    bodyRows.push([
      'Camera',
      goog.string.subs('%s times for a total duration of %s',
          app.RawStats.camera.count,
          historian.time.formatDuration(
              app.RawStats.camera.total_time_msec))
    ]);
  }
  if (app.RawStats.flashlight) {
    bodyRows.push([
      'Flashlight',
      goog.string.subs('%s times for a total duration of %s',
          app.RawStats.flashlight.count,
          historian.time.formatDuration(
              app.RawStats.flashlight.total_time_msec))
    ]);
  }
  if (app.RawStats.video) {
    bodyRows.push([
      'Video',
      goog.string.subs('%s times for a total duration of %s',
          app.RawStats.video.count,
          historian.time.formatDuration(
              app.RawStats.video.total_time_msec))
    ]);
  }
  var table = historian.tables.createTable(null, bodyRows)
      .addClass('no-paging no-ordering no-info no-searching no-header');
  $('#miscSummary').empty().append(table);
  historian.tables.activateDataTable(table);
  historian.tables.activateTableCopy(table);

  historian.appstats.displayAppChild(app.RawStats.name, app.RawStats.child);

  historian.appstats.displayAppApk(app.RawStats.apk);

  historian.appstats.displayAppNetworkInfo(app.RawStats.network,
      app.RawStats.wifi);

  historian.appstats.displayAppProcess(app.RawStats.process,
      app.RawStats.state_time);

  historian.appstats.displayAppScheduledJob(app.RawStats.scheduled_job);

  historian.appstats.displayAppSensor(app.Sensor);

  historian.appstats.displayAppSync(app.RawStats.sync);

  historian.appstats.displayAppUserActivity(app.UserActivity);

  historian.appstats.displayAppWakelock(app.RawStats.wakelock);
};


/**
 * Displays text to let the user know that no app has been selected.
 */
historian.appstats.showNoSelection = function() {
  $('.noAppSelected').css('display', 'block');
  $('#selectedAppStats').css('display', 'none');
};


/**
 * Fetches data, and creates event listeners once the page is loaded.
 * @param {!historian.AppStat} stats AppStat received from the server.
 */
historian.appstats.initialize = function(stats) {
  // Convert appStats to a map with app.uid as key.
  var appStats = {};
  for (var i = 0; i < stats.length; i++) {
    appStats[stats[i].RawStats.uid] = stats[i];
  }
  historian.appstats.appStats = appStats;

  $('#appSelector').select2({
    placeholder: 'Choose an application',
    allowClear: true,
    dropdownAutoWidth: true
  });
  historian.displaySelectedApp();
};
