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

/**
 * @fileoverview Utilities to display app specific metrics.
 */

/**
 * Adds a new row to bdy, putting each element in data into a
 * separate column. The objects must have a 'name' field, and can have an
 * optional 'title' field that will be used as the title for the cell.
 *
 * @param {Node} bdy the tbody (or thead) to add a row to
 * @param {Array<{name: string, title: string}>} data the data to put
 *            into each cell
 */
historian.addRowWithDesc = function(bdy, data) {
  var tr = bdy.insertRow();
  for (var i = 0; i < data.length; i++) {
    var td = tr.insertCell();
    if (d = data[i]) {
      td.appendChild(document.createTextNode(d.name));
      if (d.title) {
        td.setAttribute('title', d.title);
      }
    }
  }
};

/**
 * Adds a new row to bdy, putting each element in data into a
 * separate column. If title is set, then it will be used as the title
 * (tooltip) for the row.
 *
 * @param {Node} bdy the tbody (or thead) to add a row to
 * @param {Array<string>} data the data to put into each cell
 * @param {string} title a description of the row contents
 */
historian.addRow = function(bdy, data, title) {
  var tr = bdy.insertRow();
  if (title) {
    tr.setAttribute('title', title);
  }
  for (var i = 0; i < data.length; i++) {
    var td = tr.insertCell();
    if (data[i]) {
      td.appendChild(document.createTextNode(data[i]));
    }
  }
};

/**
 * Displays or hides the section detailing the child field in the app proto.
 *
 * @param {string} appName the saved app proto name
 * @param {Array<Object>} children the list of child elements
 */
historian.displayAppChild = function(appName, children) {
  // Display this section only if there are multiple children or
  // if the single child is under one of our predefined shared UID
  // groupings (ie. com.google.android.gms under GOOGLE_SERVICES).
  if (children && (children.length > 1 ||
                   (children.length == 1 && children[0].name != appName))) {
    var div = document.createElement('div');

    document.getElementById('appChildSection').style.display = 'block';

    // Pre-sort in alphabetical order
    children.sort(function(a, b) {return a.name.localeCompare(b.name)});

    var table = document.createElement('table');
    table.setAttribute('class', 'tablesorter');
    var thead = document.createElement('thead');
    historian.addRow(thead, ['Package Name', 'Version Code', 'Version Name']);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      historian.addRow(tbody,
          [child.name, child.version_code, child.version_name]);
    }
    table.appendChild(tbody);
    div.appendChild(table);
    document.getElementById('appChild').innerHTML = div.innerHTML;

    // The tablesorter function will only work on elements that have
    // been added to the HTML, and even then, using 'table' would not work here.
    historian.activateTablesorter($('#appChild table'), [], false);
  } else {
    document.getElementById('appChildSection').style.display = 'none';
  }
};

/**
 * Displays or hides the section detailing the Apk field in the app proto.
 *
 * @param {Object} apk the apk field of the app proto
 */
historian.displayAppApk = function(apk) {
  if (apk) {
    var div = document.createElement('div');
    document.getElementById('appApkSection').style.display = 'block';
    document.getElementById('appWakeups').innerHTML = apk.wakeups;

    if (apk.service && apk.service.length > 0) {
      // Pre-sort services by descreasing number of launches and starts.
      apk.service.sort(function(a, b) {
        if (a.launches === b.launches) {
          return b.starts - a.starts;
        }
        return b.launches - a.launches;
      });

      var table = document.createElement('table');
      table.setAttribute('class', 'tablesorter');
      var thead = document.createElement('thead');
      historian.addRowWithDesc(thead, [
        {name: 'Service Name'},
        {name: 'Time started'},
        {
          name: '# starts',
          title: 'Total number of times startService() was called',
        },
        {
          name: '# launches',
          title: 'Total number of times the service was launched',
        }
      ]);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      for (var i = 0; i < apk.service.length; i++) {
        var service = apk.service[i];
        historian.addRow(tbody, [
          service.name,
          historian.time.getTime(service.start_time_msec),
          service.starts,
          service.launches
        ]);
      }
      table.appendChild(tbody);
      div.appendChild(table);
    }
    document.getElementById('appServices').innerHTML = div.innerHTML;

    historian.activateTablesorter($('#appServices table'), [], false);
  } else {
    document.getElementById('appApkSection').style.display = 'none';
  }
};

/**
 * Displays or hides the section detailing the app's network activity.
 *
 * @param {Object} network the Network field of the app proto
 * @param {Object} wifi the Wifi field of the app proto
 */
historian.displayAppNetworkInfo = function(network, wifi) {
  if (network || wifi) {
    document.getElementById('appNetworkInfoSection').style.display = 'block';

    var div = document.createElement('div');
    var table = document.createElement('table');
    // Don't want to enable sorting for the table, but it needs the blue
    // classification in order to look like the rest of the tables.
    table.setAttribute('class', 'tablesorter-blue');

    var tbody = document.createElement('tbody');
    if (network) {
      var mobileRxKB = network.mobile_bytes_rx / 1024;
      var mobileTxKB = network.mobile_bytes_tx / 1024;
      historian.addRow(tbody, [
        'Mobile KB transferred',
        historian.formatString('%s total (%s received, %s transmitted)',
            (mobileRxKB + mobileTxKB).toFixed(2), mobileRxKB.toFixed(2),
            mobileTxKB.toFixed(2))
      ]);
      var wifiRxKB = network.wifi_bytes_rx / 1024;
      var wifiTxKB = network.wifi_bytes_tx / 1024;
      historian.addRow(tbody, [
        'Wifi KB transferred',
        historian.formatString('%s total (%s received, %s transmitted)',
            (wifiRxKB + wifiTxKB).toFixed(2), wifiRxKB.toFixed(2),
            wifiTxKB.toFixed(2))
      ]);
      historian.addRow(tbody, [
        'Mobile packets transferred',
        historian.formatString('%s total (%s received, %s transmitted)',
            network.mobile_packets_rx + network.mobile_packets_tx,
            network.mobile_packets_rx, network.mobile_packets_tx)
      ]);
      historian.addRow(tbody, [
        'Wifi packets transferred',
        historian.formatString('%s total (%s received, %s transmitted)',
            network.wifi_packets_rx + network.wifi_packets_tx,
            network.wifi_packets_rx, network.wifi_packets_tx)
      ]);
      historian.addRow(tbody, [
        'Mobile active time',
        historian.time.formatDuration(network.mobile_active_time_msec)
      ],
             'Amount of time the app kept the mobile radio active');
      historian.addRow(tbody,
          ['Mobile active count', network.mobile_active_count]);
    }
    if (wifi) {
      historian.addRow(tbody, [
        'Full wifi lock time',
        historian.time.formatDuration(wifi.full_wifi_lock_time_msec)
      ]);
      if (reportVersion >= 12) {
        // This was added during the time when the report version was 12 and
        // the BatteryStatsImpl version was 119 (ag/650841), but some version
        // reports won't have this info.
        // TODO(kwekua): modify our parsing to use BatteryStatsImpl so that
        // we can be smarter about showing this value.
        historian.addRow(tbody, ['Wifi scan time', wifi.scan_count]);
      }
      historian.addRow(tbody, [
        'Wifi scan count',
        historian.time.formatDuration(wifi.scan_time_msec)
      ]);
      if (reportVersion >= 14) {
        historian.addRow(tbody, [
          'Wifi idle time',
          historian.time.formatDuration(wifi.idle_time_msec)
        ]);
        historian.addRow(tbody, [
          'Wifi transfer time',
          historian.formatString('%s total (%s receiving, %s transmitting)',
              historian.time.formatDuration(wifi.rx_time_msec +
                                            wifi.tx_time_msec),
              historian.time.formatDuration(wifi.rx_time_msec),
              historian.time.formatDuration(wifi.tx_time_msec))
        ]);
      }
    }
    table.appendChild(tbody);
    div.appendChild(table);

    document.getElementById('appNetworkInfo').innerHTML = div.innerHTML;
  } else {
    document.getElementById('appNetworkInfoSection').style.display = 'none';
  }
};

/**
 * Displays or hides the section detailing the app's processes.
 *
 * @param {Array<Object>} processes the list of processes in the app proto
 */
historian.displayAppProcess = function(processes) {
  if (processes && processes.length > 0) {
    document.getElementById('appProcessSection').style.display = 'block';

    // Pre-sort in decreasing order of user time, system time, and starts.
    processes.sort(function(a, b) {
      if (a.user_time_msec === b.user_time_msec) {
        if (a.system_time_msec === b.system_time_msec) {
          return b.starts - a.starts;
        }
        return b.system_time_msec - a.system_time_msec;
      }
      return b.user_time_msec - a.user_time_msec;
    });

    var div = document.createElement('div');
    var table = document.createElement('table');
    table.setAttribute('class', 'tablesorter');
    var thead = document.createElement('thead');
    historian.addRowWithDesc(thead, [
      {name: 'Process Name'},
      {
        name: 'User Time',
        title: 'Total time spent executing in user code',
      },
      {
        name: 'System Time',
        title: 'Total time spent executing in system code',
      },
      {
        name: 'Foreground Time',
        title: 'CPU time spent while the process was in the foreground',
      },
      {
        name: '# Starts',
        title: '# times the process has been started',
      },
      {name: '# ANRs'},
      {name: '# Crashes'}
    ]);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var i = 0; i < processes.length; i++) {
      var process = processes[i];
      historian.addRow(tbody, [
        process.name,
        historian.time.formatDuration(process.user_time_msec),
        historian.time.formatDuration(process.system_time_msec),
        historian.time.formatDuration(process.foreground_time_msec),
        process.starts,
        process.anrs,
        process.crashes
      ]);
    }
    table.appendChild(tbody);
    div.appendChild(table);

    document.getElementById('appProcess').innerHTML = div.innerHTML;

    // Apply tablesort 'duration' parser to User Time, System Time,
    // and Foreground Time columns.
    historian.activateTablesorter($('#appProcess table'), [1, 2, 3], false);
  } else {
    document.getElementById('appProcessSection').style.display = 'none';
  }
};

/**
 * Displays or hides the section detailing scheduled jobs used by the app.
 *
 * @param {Array<Object>} scheduledJobs the list of scheduled jobs in the
 *     app proto
 */
historian.displayAppScheduledJob = function(scheduledJobs) {
  if (scheduledJobs && scheduledJobs.length > 0) {
    document.getElementById('appScheduledJobSection').style.display = 'block';

    // Pre-sort by decreasing total time and count.
    scheduledJobs.sort(function(a, b) {
      if (a.total_time_msec === b.total_time_msec) {
        return b.count - a.count;
      }
      return b.total_time_msec;
    });

    var div = document.createElement('div');
    var table = document.createElement('table');
    table.setAttribute('class', 'tablesorter');
    var thead = document.createElement('thead');
    historian.addRow(thead, ['Job Name', 'Total Time', 'Count']);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var i = 0; i < scheduledJobs.length; i++) {
      var j = scheduledJobs[i];
      historian.addRow(
          tbody,
          [j.name, historian.time.formatDuration(j.total_time_msec), j.count]);
    }
    table.appendChild(tbody);
    div.appendChild(table);

    document.getElementById('appScheduledJob').innerHTML = div.innerHTML;

    // Apply tablesort 'duration' parser to Total Time column.
    historian.activateTablesorter($('#appScheduledJob table'), [1], false);
  } else {
    document.getElementById('appScheduledJobSection').style.display = 'none';
  }
};

/**
 * Displays or hides the section detailing the app's sensor activity.
 *
 * @param {Array<Object>} sensors the list of sensor info in the app proto
 */
historian.displayAppSensor = function(sensors) {
  if (sensors && sensors.length > 0) {
    document.getElementById('appSensorSection').style.display = 'block';

    // Pre-sort in decreasing order of total time and count.
    sensors.sort(function(a, b) {
      if (a.total_time_msec === b.total_time_msec) {
        return b.count - a.count;
      }
      return b.total_time_msec - a.total_time_msec;
    });

    var div = document.createElement('div');
    var table = document.createElement('table');
    table.setAttribute('class', 'tablesorter');
    var thead = document.createElement('thead');
    historian.addRow(thead, ['Sensor Number', 'Total Time', 'Count']);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var i = 0; i < sensors.length; i++) {
      var s = sensors[i];
      historian.addRow(tbody, [
        s.number,
        historian.time.formatDuration(s.total_time_msec),
        s.count
      ]);
    }
    table.appendChild(tbody);
    div.appendChild(table);

    document.getElementById('appSensor').innerHTML = div.innerHTML;

    // Apply tablesort 'duration' parser to Total Time column.
    historian.activateTablesorter($('#appSensor table'), [1], false);
  } else {
    document.getElementById('appSensorSection').style.display = 'none';
  }
};

/**
 * Displays or hides the section detailing all of the app's sync activity.
 *
 * @param {Array<Object>} syncs the list of sync info in the app proto
 */
historian.displayAppSync = function(syncs) {
  if (syncs && syncs.length > 0) {
    document.getElementById('appSyncSection').style.display = 'block';

    // Pre-sort in decreasing order of total time and count.
    syncs.sort(function(a, b) {
      if (a.total_time_msec === b.total_time_msec) {
        return b.count - a.count;
      }
      return b.total_time_msec - a.total_time_msec;
    });

    var div = document.createElement('div');
    var table = document.createElement('table');
    table.setAttribute('class', 'tablesorter');
    var thead = document.createElement('thead');
    historian.addRow(thead, ['Sync Name', 'Total Time', 'Count']);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var i = 0; i < syncs.length; i++) {
      var s = syncs[i];
      historian.addRow(
          tbody,
          [s.name, historian.time.formatDuration(s.total_time_msec), s.count]);
    }
    table.appendChild(tbody);
    div.appendChild(table);

    document.getElementById('appSync').innerHTML = div.innerHTML;
    // Apply tablesort 'duration' parser to Total Time column.
    // The tablesorter function will only work on elements that have
    // been added to the HTML, and even then, using 'table' would not work here.
    historian.activateTablesorter($('#appSync table'), [1], false);
  } else {
    document.getElementById('appSyncSection').style.display = 'none';
  }
};

/**
 * Mapping of UserActivity enum value to name.
 * @const
 */
historian.userActivityName = ['OTHER', 'BUTTON', 'TOUCH'];

/**
 * Displays or hides the section detailing user interaction with the app.
 *
 * @param {Array<Object>} ua the list of UserActivity info in the app proto
 */
historian.displayAppUserActivity = function(ua) {
  if (ua && ua.length > 0) {
    document.getElementById('appUserActivitySection').style.display = 'block';

    var div = document.createElement('div');
    var table = document.createElement('table');
    table.setAttribute('class', 'tablesorter');
    var thead = document.createElement('thead');
    historian.addRow(thead, ['Name', 'Count']);
    table.appendChild(thead);

    // Pre-sort by decreasing count.
    ua.sort(function(a, b) {
      return b.count - a.count;
    });

    var tbody = document.createElement('tbody');
    for (var i = 0; i < ua.length; i++) {
      var a = ua[i];
      // Unfortunately the UserActivity.Name gets converted to its int value
      // instead of its string value.
      var name = a.name > historian.userActivityName.length ?
          'UNKNOWN' : historian.userActivityName[a.name];
      historian.addRow(tbody, [name, a.count]);
    }
    table.appendChild(tbody);
    div.appendChild(table);

    document.getElementById('appUserActivity').innerHTML = div.innerHTML;
    historian.activateTablesorter($('#appUserActivity table'), [], false);
  } else {
    document.getElementById('appUserActivitySection').style.display = 'none';
  }
};

/**
 * Displays or hides the section detailing wakelocks held by the app.
 *
 * @param {Array<Object>} wakelocks the list of Wakelock info in the app proto
 */
historian.displayAppWakelock = function(wakelocks) {
  if (wakelocks && wakelocks.length > 0) {
    document.getElementById('appWakelockSection').style.display = 'block';

    // Pre-sort in decreasing order of full time, partial time, window time,
    // full count, partial count, and window count.
    wakelocks.sort(function(a, b) {
      if (a.full_time_msec === b.full_time_msec) {
        if (a.partial_time_msec === b.partial_time_msec) {
          if (a.window_time_msec === b.window_time_msec) {
            if (a.full_count === b.full_count) {
              if (a.partial_count === b.partial_count) {
                return b.window_count - a.window_count;
              }
              return b.partial_count - a.partial_count;
            }
            return b.full_count - a.full_count;
          }
          return b.window_time_msec - a.window_time_msec;
        }
        return b.partial_time_msec - a.partial_time_msec;
      }
      return b.full_time_msec - a.partial_time_msec;
    });

    var div = document.createElement('div');
    var table = document.createElement('table');
    table.setAttribute('class', 'tablesorter');
    var thead = document.createElement('thead');
    historian.addRowWithDesc(thead, [
      {name: 'Wakelock Name'},
      {name: 'Full Time', title: 'Time held holding a full wake lock'},
      {name: 'Full Count', title: 'Number of full wake locks held'},
      {name: 'Partial Time', title: 'Time held holding a partial wake lock'},
      {name: 'Partial Count', title: 'Number of partial wake locks held'},
      {name: 'Window Time', title: 'Time held holding a window wake lock'},
      {name: 'Window Count', title: 'Number of window wake locks held'}
    ]);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var i = 0; i < wakelocks.length; i++) {
      var w = wakelocks[i];
      historian.addRow(tbody, [
        w.name,
        historian.time.formatDuration(w.full_time_msec),
        w.full_count,
        historian.time.formatDuration(w.partial_time_msec),
        w.partial_count,
        historian.time.formatDuration(w.window_time_msec),
        w.window_count
      ]);
    }
    table.appendChild(tbody);
    div.appendChild(table);

    document.getElementById('appWakelock').innerHTML = div.innerHTML;

    // Apply tablesort 'duration' parser to Full Time, Partial Time,
    // and Window Time columns.
    historian.activateTablesorter($('#appWakelock table'), [1, 3, 5], false);
  } else {
    document.getElementById('appWakelockSection').style.display = 'none';
  }
};

/**
 * Displays info about the desired app.
 *
 * @param {number} appUid the uid of the app to display information about
 */
historian.displayApp = function(appUid) {
  document.getElementById('noAppSelected').style.display = 'none';
  document.getElementById('selectedAppStats').style.display = 'block';

  app = appStats[appUid];
  var div = document.createElement('div');
  var table = document.createElement('table');
  // Don't want to enable sorting for the table, but it needs the blue
  // classification in order to look like the rest of the tables.
  table.setAttribute('class', 'tablesorter-blue');
  var tbody = document.createElement('tbody');
  historian.addRow(tbody, ['Application', app.name]);
  historian.addRow(tbody, ['Version Code', app.version_code]);
  historian.addRow(tbody, ['UID', app.uid]);
  if (app.power_use_item) {
    historian.addRow(tbody, [
      'Computed power drain',
      historian.formatString('%s %',
          ((100 * app.power_use_item.computed_power_mah) / batteryCapacity)
              .toFixed(2))
    ]);
  }
  if (app.foreground) {
    historian.addRow(tbody, [
      'Foreground',
      historian.formatString('%s times over %s',
          app.foreground.count,
          historian.time.formatDuration(app.foreground.total_time_msec))
    ]);
  }
  // Foreground, Active, and Running times are excluded because they're not
  // believed to be useful.
  if (app.vibrator) {
    historian.addRow(tbody, [
      'Vibrator use',
      historian.formatString('%s times over %s',
          app.vibrator.count,
          historian.time.formatDuration(app.vibrator.total_time_msec))
    ]);
  }
  table.appendChild(tbody);
  div.appendChild(table);
  document.getElementById('miscSummary').innerHTML = div.innerHTML;

  historian.displayAppChild(app.name, app.child);

  historian.displayAppApk(app.apk);

  historian.displayAppNetworkInfo(app.network, app.wifi);

  historian.displayAppProcess(app.process);

  historian.displayAppScheduledJob(app.scheduled_job);

  historian.displayAppSensor(app.sensor);

  historian.displayAppSync(app.sync);

  historian.displayAppUserActivity(app.user_activity);

  historian.displayAppWakelock(app.wakelock);
};

/**
 * Displays text to let the user know that no app has been selected.
 */
historian.showNoSelection = function() {
  document.getElementById('noAppSelected').style.display = 'block';
  document.getElementById('selectedAppStats').style.display = 'none';
};

/**
 * Determines the app selected by the user and intitiates the showing of its
 * details, or shows the message that no app has been selected if a user clears
 * the app selection.
 */
historian.displaySelectedApp = function() {
  var e = document.getElementById('appSelector');
  var v = e.options[e.selectedIndex].value;
  if (v == 'none_chosen') {
    historian.showNoSelection();
  } else {
    historian.displayApp(v);
  }
};
