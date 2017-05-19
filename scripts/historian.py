#!/usr/bin/python
"""Legacy Historian script for analyzing Android bug reports."""

# Copyright 2016 Google Inc. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# TO USE: (see also usage() below)
# adb shell dumpsys batterystats --enable full-wake-history  (post-KitKat only)
# adb shell dumpsys batterystats --reset
# Optionally start powermonitor logging:
#   For example, if using a Monsoon:
#     if device/host clocks are not synced, run historian.py -v
#     cts/tools/utils/monsoon.py --serialno 2294 --hz 1 --samples 100000 \
#     -timestamp | tee monsoon.out
# ...let device run a while...
# stop monsoon.py
# adb bugreport > bugreport.txt
# ./historian.py -p monsoon.out bugreport.txt

import collections
import datetime
import fileinput
import getopt
import re
import StringIO
import subprocess
import sys
import time

POWER_DATA_FILE_TIME_OFFSET = 0  # deal with any clock mismatch.
BLAME_CATEGORY = "wake_lock_in"  # category to assign power blame to.
ROWS_TO_SUMMARIZE = ["wake_lock", "running"]  # -s: summarize these rows

getopt_debug = 0
getopt_bill_extra_secs = 0
getopt_power_quanta = 15        # slice powermonitor data this many seconds,
                                # to avoid crashing visualizer
getopt_power_data_file = False
getopt_proc_name = ""
getopt_highlight_category = ""
getopt_show_all_wakelocks = False
getopt_sort_by_power = True
getopt_summarize_pct = -1
getopt_report_filename = ""

getopt_generate_chart_only = False
getopt_disable_chart_drawing = False


def usage():
  """Print usage of the script."""
  print "\nUsage: %s [OPTIONS] [FILE]\n" % sys.argv[0]
  print "  -a: show all wakelocks (don't abbreviate system wakelocks)"
  print "  -c: disable drawing of chart"
  print "  -d: debug mode, output debugging info for this program"
  print ("  -e TIME: extend billing an extra TIME seconds after each\n"
         "     wakelock, or until the next wakelock is seen.  Useful for\n"
         "     accounting for modem power overhead.")
  print "  -h: print this message."
  print ("  -m: generate output that can be embedded in an existing page.\n"
         "     HTML header and body tags are not outputted.")
  print ("  -n [CATEGORY=]PROC: output another row containing only processes\n"
         "     whose name matches uid of PROC in CATEGORY.\n"
         "     If CATEGORY is not specified, search in wake_lock_in.")
  print ("  -p FILE: analyze FILE containing power data.  Format per\n"
         "     line: <timestamp in epoch seconds> <amps>")
  print ("  -q TIME: quantize data on power row in buckets of TIME\n"
         "     seconds (default %d)" % getopt_power_quanta)
  print "  -r NAME: report input file name as NAME in HTML."
  print ("  -s PCT: summarize certain useful rows with additional rows\n"
         "     showing percent time spent over PCT% in each.")
  print "  -t: sort power report by wakelock duration instead of charge"
  print "  -v: synchronize device time before collecting power data"
  print "\n"
  sys.exit(1)


def parse_time(s, fmt):
  """Parses a human readable duration string into milliseconds.

  Takes a human readable duration string like '1d2h3m4s5ms' and returns
  the equivalent in milliseconds.

  Args:
    s: Duration string
    fmt: A re object to parse the string

  Returns:
    A number indicating the duration in milliseconds.
  """
  if s == "0": return 0.0

  p = re.compile(fmt)
  match = p.search(s)
  try:
    d = match.groupdict()
  except IndexError:
    return -1.0

  ret = 0.0
  if d["day"]: ret += float(d["day"])*60*60*24
  if d["hrs"]: ret += float(d["hrs"])*60*60
  if d["min"]: ret += float(d["min"])*60
  if d["sec"]: ret += float(d["sec"])
  if d["ms"]: ret += float(d["ms"])/1000
  return ret


def time_float_to_human(t, show_complete_time):
  if show_complete_time:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t))
  else:
    return time.strftime("%H:%M:%S", time.localtime(t))


def abbrev_timestr(s):
  """Chop milliseconds off of a time string, if present."""
  arr = s.split("s")
  if len(arr) < 3: return "0s"
  return arr[0]+"s"


def timestr_to_jsdate(timestr):
  return "new Date(%s * 1000)" % timestr


def format_time(delta_time):
  """Return a time string representing time past since initial event."""
  if not delta_time:
    return str(0)

  timestr = "+"
  datet = datetime.datetime.utcfromtimestamp(delta_time)

  if delta_time > 24 * 60 * 60:
    timestr += str(datet.day - 1) + datet.strftime("d%Hh%Mm%Ss")
  elif delta_time > 60 * 60:
    timestr += datet.strftime("%Hh%Mm%Ss").lstrip("0")
  elif delta_time > 60:
    timestr += datet.strftime("%Mm%Ss").lstrip("0")
  elif delta_time > 1:
    timestr += datet.strftime("%Ss").lstrip("0")
  ms = datet.microsecond / 1000.0
  timestr += "%03dms" % ms
  return timestr


def format_duration(dur_ms):
  """Return a time string representing the duration in human readable format."""
  if not dur_ms:
    return "0ms"

  ms = dur_ms % 1000
  dur_ms = (dur_ms - ms) / 1000
  secs = dur_ms % 60
  dur_ms = (dur_ms - secs) / 60
  mins = dur_ms % 60
  hrs = (dur_ms - mins) / 60

  out = ""
  if hrs > 0:
    out += "%dh" % hrs
  if mins > 0:
    out += "%dm" % mins
  if secs > 0:
    out += "%ds" % secs
  if ms > 0 or not out:
    out += "%dms" % ms
  return out


def get_event_category(e):
  e = e.lstrip("+-")
  earr = e.split("=")
  return earr[0]


def get_quoted_region(e):
  e = e.split("\"")[1]
  return e


def get_after_equal(e):
  e = e.split("=")[1]
  return e


def get_wifi_suppl_state(e):
  try:
    e = get_after_equal(e)
    return e.split("(")[0]
  except IndexError:
    return ""


def get_event_subcat(cat, e):
  """Get subcategory of an category from an event string.

  Subcategory can be use to distinguish simultaneous entities
  within one category. To track possible concurrent instances,
  add category name to concurrent_cat. Default is to track
  events using only category name.

  Args:
    cat: Category name
    e: Event name

  Returns:
    A string that is the subcategory of the event. Returns
    the substring after category name if not empty and cat
    is one of the categories tracked by concurrent_cat.
    Default subcategory is the empty string.
  """
  concurrent_cat = {"wake_lock_in", "sync", "top", "job", "conn"}
  if cat in concurrent_cat:
    try:
      return get_after_equal(e)
    except IndexError:
      pass
  return ""


def get_proc_pair(e):
  if ":" in e:
    proc_pair = get_after_equal(e)
    return proc_pair.split(":", 1)
  else:
    return ("", "")


def as_to_mah(a):
  return a * 1000 / 60 / 60


def apply_fn_over_range(fn, start_time, end_time, arglist):
  """Apply a given function per second quanta over a time range.

  Args:
    fn: The function to apply
    start_time: The starting time of the whole duration
    end_time: The ending time of the whole duration
    arglist: Additional argument list

  Returns:
    A list of results generated by applying the function
    over the time range.
  """
  results = []
  cursor = start_time

  while cursor < end_time:
    cursor_int = int(cursor)
    next_cursor = float(cursor_int + 1)
    if next_cursor > end_time: next_cursor = end_time
    time_this_quanta = next_cursor - cursor

    results.append(fn(cursor_int, time_this_quanta, *arglist))

    cursor = next_cursor
  return results


def space_escape(match):
  value = match.group()
  p = re.compile(r"\s+")
  return p.sub("_", value)


def parse_reset_time(line):
  line = line.strip()
  line = line.split("RESET:TIME: ", 1)[1]
  st = time.strptime(line, "%Y-%m-%d-%H-%M-%S")
  return time.mktime(st)


def is_file_legacy_mode(input_file):
  """Autodetect legacy (K and earlier) format."""
  detection_on = False
  for line in fileinput.input(input_file):
    if not detection_on and line.startswith("Battery History"):
      detection_on = True
    if not detection_on:
      continue

    split_line = line.split()
    if not split_line:
      continue
    line_time = split_line[0]
    if "+" not in line_time and "-" not in line_time:
      continue

    fileinput.close()
    return line_time[0] == "-"
  return False


def is_emit_event(e):
  return e[0] != "+"


def is_standalone_event(e):
  return not (e[0] == "+" or e[0] == "-")


def is_proc_event(e):
  return e.startswith("+proc")


def autovivify():
  """Returns a multidimensional dict."""
  return collections.defaultdict(autovivify)


def swap(swap_list, first, second):
  swap_list[first], swap_list[second] = swap_list[second], swap_list[first]


def add_emit_event(emit_dict, cat, name, start, end):
  """Saves a new event into the dictionary that will be visualized."""
  newevent = (name, int(start), int(end))
  if end < start:
    print "BUG: end time before start time: %s %s %s<br>" % (name,
                                                             start,
                                                             end)
  else:
    if getopt_debug:
      print "Stored emitted event: %s<br>" % str(newevent)

  if cat in emit_dict:
    emit_dict[cat].append(newevent)
  else:
    emit_dict[cat] = [newevent]


def sync_time():
  subprocess.call(["adb", "root"])
  subprocess.call(["sleep", "3"])
  start_time = int(time.time())
  while int(time.time()) == start_time:
    pass
  curr_time = time.strftime("%Y%m%d.%H%M%S", time.localtime())
  subprocess.call(["adb", "shell", "date", "-s", curr_time])
  sys.exit(0)


def parse_search_option(cmd):
  global getopt_proc_name, getopt_highlight_category
  if "=" in cmd:
    getopt_highlight_category = cmd.split("=")[0]
    getopt_proc_name = cmd.split("=")[1]
  else:
    getopt_highlight_category = "wake_lock_in"
    getopt_proc_name = cmd


def parse_argv():
  """Parse argument and set up globals."""
  global getopt_debug, getopt_bill_extra_secs, getopt_power_quanta
  global getopt_sort_by_power, getopt_power_data_file
  global getopt_summarize_pct, getopt_show_all_wakelocks
  global getopt_report_filename
  global getopt_generate_chart_only
  global getopt_disable_chart_drawing

  try:
    opts, argv_rest = getopt.getopt(sys.argv[1:],
                                    "acde:hmn:p:q:r:s:tv", ["help"])
  except getopt.GetoptError as err:
    print "<pre>\n"
    print str(err)
    usage()
  try:
    for o, a in opts:
      if o == "-a": getopt_show_all_wakelocks = True
      if o == "-c": getopt_disable_chart_drawing = True
      if o == "-d": getopt_debug = True
      if o == "-e": getopt_bill_extra_secs = int(a)
      if o in ("-h", "--help"): usage()
      if o == "-m": getopt_generate_chart_only = True
      if o == "-n": parse_search_option(a)
      if o == "-p": getopt_power_data_file = a
      if o == "-q": getopt_power_quanta = int(a)
      if o == "-r": getopt_report_filename = str(a)
      if o == "-s": getopt_summarize_pct = int(a)
      if o == "-t": getopt_sort_by_power = False
      if o == "-v": sync_time()
  except ValueError as err:
    print str(err)
    usage()

  if not argv_rest:
    usage()

  return argv_rest


class Printer(object):
  """Organize and render the visualizer."""
  _default_color = "#4070cf"

  # -n option is represented by "highlight". All the other names specified
  # in _print_setting are the same as category names.
  _print_setting = [
      ("battery_level", "#4070cf"),
      ("plugged", "#2e8b57"),
      ("screen", "#cbb69d"),
      ("top", "#dc3912"),
      ("sync", "#9900aa"),
      ("wake_lock_pct", "#6fae11"),
      ("wake_lock", "#cbb69d"),
      ("highlight", "#4070cf"),
      ("running_pct", "#6fae11"),
      ("running", "#990099"),
      ("wake_reason", "#b82e2e"),
      ("wake_lock_in", "#ff33cc"),
      ("job", "#cbb69d"),
      ("mobile_radio", "#aa0000"),
      ("data_conn", "#4070cf"),
      ("conn", "#ff6a19"),
      ("activepower", "#dd4477"),
      ("device_idle", "#37ff64"),
      ("motion", "#4070cf"),
      ("active", "#119fc8"),
      ("power_save", "#ff2222"),
      ("wifi", "#119fc8"),
      ("wifi_full_lock", "#888888"),
      ("wifi_scan", "#888888"),
      ("wifi_multicast", "#888888"),
      ("wifi_radio", "#888888"),
      ("wifi_running", "#109618"),
      ("wifi_suppl", "#119fc8"),
      ("wifi_signal_strength", "#9900aa"),
      ("phone_signal_strength", "#dc3912"),
      ("phone_scanning", "#dda0dd"),
      ("audio", "#990099"),
      ("phone_in_call", "#cbb69d"),
      ("bluetooth", "#cbb69d"),
      ("phone_state", "#dc3912"),
      ("signal_strength", "#119fc8"),
      ("video", "#cbb69d"),
      ("flashlight", "#cbb69d"),
      ("low_power", "#109618"),
      ("fg", "#dda0dd"),
      ("gps", "#ff9900"),
      ("reboot", "#ddff77"),
      ("power", "#ff2222"),
      ("status", "#9ac658"),
      ("health", "#888888"),
      ("plug", "#888888"),
      ("charging", "#888888"),
      ("pkginst", "#cbb69d"),
      ("pkgunin", "#cbb69d")]

  _ignore_categories = ["user", "userfg"]

  def __init__(self):
    self._print_setting_cats = set()
    for cat in self._print_setting:
      self._print_setting_cats.add(cat[0])

  def combine_wifi_states(self, event_list, start_time):
    """Discard intermediate states and combine events chronologically."""
    tracking_states = ["disconn", "completed", "disabled", "scanning"]
    selected_event_list = []
    for event in event_list:
      state = get_wifi_suppl_state(event[0])
      if state in tracking_states:
        selected_event_list.append(event)

    if len(selected_event_list) <= 1:
      return set(selected_event_list)

    event_name = "wifi_suppl="
    for e in selected_event_list:
      state = get_wifi_suppl_state(e[0])
      event_name += (state + "->")
    event_name = event_name[:-2]

    sample_event = selected_event_list[0][0]
    timestr_start = sample_event.find("(")
    event_name += sample_event[timestr_start:]
    return set([(event_name, start_time, start_time)])

  def aggregate_events(self, emit_dict):
    """Combine events with the same name occurring during the same second.

    Aggregate events to keep visualization from being so noisy.

    Args:
      emit_dict: A dict containing events.

    Returns:
      A dict with repeated events happening within one sec removed.
    """
    output_dict = {}
    for cat, events in emit_dict.iteritems():
      output_dict[cat] = []
      start_dict = {}
      for event in events:
        start_time = event[1]
        if start_time in start_dict:
          start_dict[start_time].append(event)
        else:
          start_dict[start_time] = [event]
      for start_time, event_list in start_dict.iteritems():
        if cat == "wifi_suppl":
          event_set = self.combine_wifi_states(event_list, start_time)
        else:
          event_set = set(event_list)      # uniqify
        for event in event_set:
          output_dict[cat].append(event)
    return output_dict

  def print_emit_dict(self, cat, emit_dict):
    for e in emit_dict[cat]:
      if cat == "wake_lock":
        cat_name = "wake_lock *"
      else:
        cat_name = cat
      print "['%s', '%s', %s, %s]," % (cat_name, e[0],
                                       timestr_to_jsdate(e[1]),
                                       timestr_to_jsdate(e[2]))

  def print_highlight_dict(self, highlight_dict):
    catname = getopt_proc_name + " " + getopt_highlight_category
    if getopt_highlight_category in highlight_dict:
      for e in highlight_dict[getopt_highlight_category]:
        print "['%s', '%s', %s, %s]," % (catname, e[0],
                                         timestr_to_jsdate(e[1]),
                                         timestr_to_jsdate(e[2]))

  def print_events(self, emit_dict, highlight_dict):
    """print category data in the order of _print_setting.

    Args:
      emit_dict: Major event dict.
      highlight_dict: Additional event information for -n option.
    """
    emit_dict = self.aggregate_events(emit_dict)
    highlight_dict = self.aggregate_events(highlight_dict)
    cat_count = 0

    for i in range(0, len(self._print_setting)):
      cat = self._print_setting[i][0]
      if cat in emit_dict:
        self.print_emit_dict(cat, emit_dict)
        cat_count += 1
      if cat == "highlight":
        self.print_highlight_dict(highlight_dict)

    # handle category that is not included in _print_setting
    if cat_count < len(emit_dict):
      for cat in emit_dict:
        if (cat not in self._print_setting_cats and
            cat not in self._ignore_categories):
          sys.stderr.write("event category not found: %s\n" % cat)
          self.print_emit_dict(cat, emit_dict)

  def print_chart_options(self, emit_dict, highlight_dict, width, height):
    """Print Options provided to the visualizater."""
    color_string = ""
    cat_count = 0
    # construct color string following the order of _print_setting
    for i in range(0, len(self._print_setting)):
      cat = self._print_setting[i][0]
      if cat in emit_dict:
        color_string += "'%s', " % self._print_setting[i][1]
        cat_count += 1
      if cat == "highlight" and highlight_dict:
        color_string += "'%s', " % self._print_setting[i][1]
        cat_count += 1

      if cat_count % 4 == 0:
        color_string += "\n\t"

    # handle category that is not included in _print_setting
    if cat_count < len(emit_dict):
      for cat in emit_dict:
        if cat not in self._print_setting_cats:
          color_string += "'%s', " % self._default_color

    print("\toptions = {\n"
          "\ttimeline: { colorByRowLabel: true},\n"
          "\t'width': %s,\n"
          "\t'height': %s, \n"
          "\tcolors: [%s]\n"
          "\t};" % (width, height, color_string))


class LegacyFormatConverter(object):
  """Convert Kit-Kat bugreport format to latest format support."""
  _TIME_FORMAT = (r"\-((?P<day>\d+)d)?((?P<hrs>\d+)h)?((?P<min>\d+)m)?"
                  r"((?P<sec>\d+)s)?((?P<ms>\d+)ms)?$")

  def __init__(self):
    self._end_time = 0
    self._total_duration = 0

  def parse_end_time(self, line):
    line = line.strip()
    try:
      line = line.split("dumpstate: ", 1)[1]
      st = time.strptime(line, "%Y-%m-%d %H:%M:%S")
      self._end_time = time.mktime(st)
    except IndexError:
      pass

  def get_timestr(self, line_time):
    """Convert backward time string in Kit-Kat to forward time string."""
    delta = self._total_duration - parse_time(line_time, self._TIME_FORMAT)
    datet = datetime.datetime.utcfromtimestamp(delta)

    if delta == 0:
      return "0"

    timestr = "+"
    if delta > 24 * 60 * 60:
      timestr += str(datet.day - 1) + datet.strftime("d%Hh%Mm%Ss")
    elif delta > 60 * 60:
      timestr += datet.strftime("%Hh%Mm%Ss").lstrip("0")
    elif delta > 60:
      timestr += datet.strftime("%Mm%Ss").lstrip("0")
    elif delta > 1:
      timestr += datet.strftime("%Ss").lstrip("0")

    ms = datet.microsecond / 1000.0
    timestr += "%03dms" % ms
    return timestr

  def get_header(self, line_time):
    self._total_duration = parse_time(line_time, self._TIME_FORMAT)
    start_time = self._end_time - self._total_duration
    header = "Battery History\n"
    header += "RESET:TIME: %s\n" % time.strftime("%Y-%m-%d-%H-%M-%S",
                                                 time.localtime(start_time))
    return header

  def convert(self, input_file):
    """Convert legacy format file into string that fits latest format."""
    output_string = ""
    history_start = False

    for line in fileinput.input(input_file):
      if "dumpstate:" in line:
        self.parse_end_time(line)
        if self._end_time:
          break
    fileinput.close()

    if not self._end_time:
      print "cannot find end time"
      sys.exit(1)

    for line in fileinput.input(input_file):
      if not history_start and line.startswith("Battery History"):
        history_start = True
        continue
      elif not history_start:
        continue

      if line.isspace(): break

      line = line.strip()
      arr = line.split()
      if len(arr) < 4: continue

      p = re.compile('"[^"]+"')
      line = p.sub(space_escape, line)

      split_line = line.split()
      (line_time, line_battery_level, line_state) = split_line[:3]
      line_events = split_line[3:]

      if not self._total_duration:
        output_string += self.get_header(line_time)
      timestr = self.get_timestr(line_time)

      event_string = " ".join(line_events)
      newline = "%s _ %s %s %s\n" % (timestr, line_battery_level,
                                     line_state, event_string)
      output_string += newline

    fileinput.close()
    return output_string


class BHEmitter(object):
  """Process battery history section from bugreport.txt."""
  _omit_cats = ["temp", "volt", "brightness", "sensor", "proc"]
  # categories that have "+" and "-" events. If we see an event in these
  # categories starting at time 0 without +/- sign, treat it as a "+" event.
  _transitional_cats = ["plugged", "running", "wake_lock", "gps", "sensor",
                        "phone_in_call", "mobile_radio", "phone_scanning",
                        "proc", "fg", "top", "sync", "wifi", "wifi_full_lock",
                        "wifi_scan", "wifi_multicast", "wifi_running", "conn",
                        "bluetooth", "audio", "video", "wake_lock_in", "job",
                        "device_idle", "wifi_radio"]
  _in_progress_dict = autovivify()  # events that are currently in progress
  _proc_dict = {}             # mapping of "proc" uid to human-readable name
  _search_proc_id = -1        # proc id of the getopt_proc_name
  match_list = []             # list of package names that match search string
  cat_list = []               # BLAME_CATEGORY summary data

  def store_event(self, cat, subcat, event_str, event_time, timestr):
    self._in_progress_dict[cat][subcat] = (event_str, event_time, timestr)
    if getopt_debug:
      print "store_event: %s in %s/%s<br>" % (event_str, cat, subcat)

  def retrieve_event(self, cat, subcat):
    """Pop event from in-progress event dict if match exists."""
    if cat in self._in_progress_dict:
      try:
        result = self._in_progress_dict[cat].pop(subcat)
        if getopt_debug:
          print "retrieve_event: found %s/%s<br>" % (cat, subcat)
        return (True, result)
      except KeyError:
        pass
    if getopt_debug:
      print "retrieve_event: no match for event %s/%s<br>" % (cat, subcat)
    return (False, (None, None, None))

  def store_proc(self, e, highlight_dict):
    proc_pair = get_after_equal(e)
    (proc_id, proc_name) = proc_pair.split(":", 1)
    self._proc_dict[proc_id] = proc_name    # may overwrite
    if getopt_proc_name and getopt_proc_name in proc_name and proc_id:
      if proc_pair not in self.match_list:
        self.match_list.append(proc_pair)
      if self._search_proc_id == -1:
        self._search_proc_id = proc_id
      elif self._search_proc_id != proc_id:
        if (proc_name[1:-1] == getopt_proc_name or
            proc_name == getopt_proc_name):
          # reinitialize
          highlight_dict.clear()
          # replace default match with complete match
          self._search_proc_id = proc_id
          swap(self.match_list, 0, -1)

  def procs_to_str(self):
    l = sorted(self._proc_dict.items(), key=lambda x: x[0])
    result = ""
    for i in l:
      result += "%s: %s\n" % (i[0], i[1])
    return result

  def get_proc_name(self, proc_id):
    if proc_id in self._proc_dict:
      return self._proc_dict[proc_id]
    else:
      return ""

  def annotate_event_name(self, name):
    """Modifies the event name to make it more understandable."""
    if "*alarm*" in name:
      try:
        proc_pair = get_after_equal(name)
      except IndexError:
        return name
      proc_id = proc_pair.split(":", 1)[0]
      name = name + ":" + self.get_proc_name(proc_id)
      if getopt_debug:
        print "annotate_event_name: %s" % name
    return name

  def abbreviate_event_name(self, name):
    """Abbreviate location-related event name."""
    if not getopt_show_all_wakelocks:
      if "wake_lock" in name:
        if "LocationManagerService" in name or "NlpWakeLock" in name:
          return "LOCATION"
        if "UlrDispatching" in name:
          return "LOCATION"
        if "GCoreFlp" in name or "GeofencerStateMachine" in name:
          return "LOCATION"
        if "NlpCollectorWakeLock" in name or "WAKEUP_LOCATOR" in name:
          return "LOCATION"
        if "GCM" in name or "C2DM" in name:
          return "GCM"
    return name

  def process_wakelock_event_name(self, start_name, start_id, end_name, end_id):
    start_name = self.process_event_name(start_name)
    end_name = self.process_event_name(end_name)
    event_name = "first=%s:%s, last=%s:%s" % (start_id, start_name,
                                              end_id, end_name)
    return event_name

  def process_event_timestr(self, start_timestr, end_timestr):
    return "(%s-%s)" % (abbrev_timestr(start_timestr),
                        abbrev_timestr(end_timestr))

  def process_event_name(self, event_name):
    event_name = self.annotate_event_name(event_name)
    event_name = self.abbreviate_event_name(event_name)
    return event_name.replace("'", r"\'")

  def track_event_parallelism_fn(self, start_time, time_this_quanta, time_dict):
    if start_time in time_dict:
      time_dict[start_time] += time_this_quanta
    else:
      time_dict[start_time] = time_this_quanta
    if getopt_debug:
      print "time_dict[%d] now %f added %f" % (start_time,
                                               time_dict[start_time],
                                               time_this_quanta)

  # track total amount of event time held per second quanta
  def track_event_parallelism(self, start_time, end_time, time_dict):
    apply_fn_over_range(self.track_event_parallelism_fn,
                        start_time, end_time, [time_dict])

  def emit_event(self, cat, event_name, start_time, start_timestr,
                 end_event_name, end_time, end_timestr,
                 emit_dict, time_dict, highlight_dict):
    """Saves an event to be later visualized."""
    (start_pid, start_pname) = get_proc_pair(event_name)
    (end_pid, end_pname) = get_proc_pair(end_event_name)

    if cat == "wake_lock" and end_pname and end_pname != start_pname:
      short_event_name = self.process_wakelock_event_name(
          start_pname, start_pid, end_pname, end_pid)
    else:
      short_event_name = self.process_event_name(event_name)
    event_name = short_event_name + self.process_event_timestr(start_timestr,
                                                               end_timestr)

    if getopt_highlight_category == cat:
      if start_pid == self._search_proc_id or end_pid == self._search_proc_id:
        add_emit_event(highlight_dict, cat,
                       event_name, start_time, end_time)

    if cat == BLAME_CATEGORY:
      self.cat_list.append((short_event_name, start_time, end_time))

      end_time += getopt_bill_extra_secs
      self.track_event_parallelism(start_time, end_time, time_dict)

    if end_time - start_time < 1:
      # HACK: visualizer library doesn't always render sub-second events
      end_time += 1

    add_emit_event(emit_dict, cat, event_name, start_time, end_time)

  def handle_event(self, event_time, time_str, event_str,
                   emit_dict, time_dict, highlight_dict):
    """Handle an individual event.

    Args:
      event_time: Event time
      time_str: Event time as string
      event_str: Event string
      emit_dict: A dict tracking events to draw in the timeline, by row
      time_dict: A dict tracking BLAME_CATEGORY duration, by seconds
      highlight_dict: A separate event dict for -n option
    """
    if getopt_debug:
      print "<p>handle_event: %s at %s<br>" % (event_str, time_str)

    cat = get_event_category(event_str)
    subcat = get_event_subcat(cat, event_str)
    # events already in progress are treated as starting at time 0
    if (time_str == "0" and is_standalone_event(event_str)
        and cat in self._transitional_cats):
      event_str = "+" + event_str
    if is_proc_event(event_str): self.store_proc(event_str, highlight_dict)

    if cat in self._omit_cats: return

    if not is_emit_event(event_str):
      # "+" event, save it until we find a matching "-"
      self.store_event(cat, subcat, event_str, event_time, time_str)
      return
    else:
      # "-" or standalone event such as "wake_reason"
      start_time = 0.0
      (found, event) = self.retrieve_event(cat, subcat)
      if found:
        (event_name, start_time, start_timestr) = event
      else:
        event_name = event_str
        start_time = event_time
        start_timestr = time_str

        # Events that were still going on at the time of reboot
        # should be marked as ending at the time of reboot.
        if event_str == "reboot":
          self.emit_remaining_events(event_time, time_str, emit_dict,
                                     time_dict, highlight_dict)

      self.emit_event(cat, event_name, start_time, start_timestr,
                      event_str, event_time, time_str,
                      emit_dict, time_dict, highlight_dict)

  def generate_summary_row(self, row_to_summarize, emit_dict, start_time,
                           end_time):
    """Generate additional data row showing % time covered by another row."""

    summarize_quanta = 60
    row_name = row_to_summarize + "_pct"
    if row_to_summarize not in emit_dict: return
    summarize_list = emit_dict[row_to_summarize]
    seconds_dict = {}

    # Generate dict of seconds where the row to summarize is seen.
    for i in summarize_list:
      self.track_event_parallelism(i[1], i[2], seconds_dict)

    # Traverse entire range of time we care about and generate % events.
    for summary_start_time in range(int(start_time), int(end_time),
                                    summarize_quanta):
      summary_end_time = summary_start_time + summarize_quanta
      found_ctr = 0
      for second_cursor in range(summary_start_time, summary_end_time):
        if second_cursor in seconds_dict:
          found_ctr += 1

      if found_ctr:
        pct = int(found_ctr * 100 / summarize_quanta)
        if pct > getopt_summarize_pct:
          add_emit_event(emit_dict, row_name, "%s=%d" % (row_name, pct),
                         summary_start_time, summary_end_time)

  def generate_summary_rows(self, emit_dict, start_time, end_time):
    if getopt_summarize_pct < 0:
      return

    for i in ROWS_TO_SUMMARIZE:
      self.generate_summary_row(i, emit_dict, start_time, end_time)

  def emit_remaining_events(self, end_time, end_timestr, emit_dict, time_dict,
                            highlight_dict):
    for cat in self._in_progress_dict:
      for subcat in self._in_progress_dict[cat]:
        (event_name, s_time, s_timestr) = self._in_progress_dict[cat][subcat]
        self.emit_event(cat, event_name, s_time, s_timestr,
                        event_name, end_time, end_timestr,
                        emit_dict, time_dict, highlight_dict)


class BlameSynopsis(object):
  """Summary data of BLAME_CATEGORY instance used for power accounting."""

  def __init__(self):
    self.name = ""
    self.mah = 0
    self.timestr = ""
    self._duration_list = []

  def add(self, name, duration, mah, t):
    self.name = name
    self._duration_list.append(duration)
    self.mah += mah
    if not self.timestr:
      self.timestr = time_float_to_human(t, False)

  def get_count(self):
    return len(self._duration_list)

  def get_median_duration(self):
    return sorted(self._duration_list)[int(self.get_count() / 2)]

  def get_total_duration(self):
    return sum(self._duration_list)

  def to_str(self, total_mah, show_power):
    """Returns a summary string."""
    if total_mah:
      pct = self.mah * 100 / total_mah
    else:
      pct = 0
    avg = self.get_total_duration() / self.get_count()

    ret = ""
    if show_power:
      ret += "%.3f mAh (%.1f%%), " % (self.mah, pct)
    ret += "%3s events, " % str(self.get_count())
    ret += "%6.3fs total " % self.get_total_duration()
    ret += "%6.3fs avg " % avg
    ret += "%6.3fs median: " % self.get_median_duration()
    ret += self.name
    ret += " (first at %s)" % self.timestr
    return ret


class PowerEmitter(object):
  """Give power accounting and bill to wake lock."""

  _total_amps = 0
  _total_top_amps = 0
  _line_ctr = 0
  _TOP_THRESH = .01

  _quanta_amps = 0
  _start_secs = 0
  _power_dict = {}
  _synopsis_dict = {}

  def __init__(self, cat_list):
    self._cat_list = cat_list

  def get_range_power_fn(self, start_time, time_this_quanta, time_dict):
    """Assign proportional share of blame.

    During any second, this event might have been held for
    less than the second, and others might have been held during
    that time.  Here we try to assign the proportional share of the
    blame.

    Args:
      start_time: Starting time of this quanta
      time_this_quanta: Duration of this quanta
      time_dict: A dict tracking total time at different starting time

    Returns:
      A proportional share of blame for the quanta.
    """
    if start_time in self._power_dict:
      total_time_held = time_dict[start_time]
      multiplier = time_this_quanta / total_time_held
      result = self._power_dict[start_time] * multiplier
      if getopt_debug:
        print("get_range_power: distance %f total time %f "
              "base power %f, multiplier %f<br>" %
              (time_this_quanta, total_time_held,
               self._power_dict[start_time], multiplier))
      assert multiplier <= 1.0
    else:
      if getopt_debug:
        print "get_range_power: no power data available"
      result = 0.0
    return result

  def get_range_power(self, start, end, time_dict):
    power_results = apply_fn_over_range(self.get_range_power_fn,
                                        start, end, [time_dict])
    result = 0.0
    for i in power_results:
      result += i
    return result

  def bill(self, time_dict):
    for _, e in enumerate(self._cat_list):
      (event_name, start_time, end_time) = e
      if event_name in self._synopsis_dict:
        sd = self._synopsis_dict[event_name]
      else:
        sd = BlameSynopsis()

      amps = self.get_range_power(start_time,
                                  end_time + getopt_bill_extra_secs,
                                  time_dict)
      mah = as_to_mah(amps)
      sd.add(event_name, end_time - start_time, mah, start_time)
      if getopt_debug:
        print "billed range %f %f at %fAs to %s<br>" % (start_time, end_time,
                                                        amps, event_name)
      self._synopsis_dict[event_name] = sd

  def handle_line(self, secs, amps, emit_dict):
    """Handle a power data file line."""
    self._line_ctr += 1

    if not self._start_secs:
      self._start_secs = secs

    self._quanta_amps += amps
    self._total_amps += amps

    self._power_dict[secs] = amps

    if secs % getopt_power_quanta:
      return
    avg = self._quanta_amps / getopt_power_quanta
    event_name = "%.3f As (%.3f A avg)" % (self._quanta_amps, avg)
    add_emit_event(emit_dict, "power", event_name, self._start_secs, secs)

    if self._quanta_amps > self._TOP_THRESH * getopt_power_quanta:
      self._total_top_amps += self._quanta_amps
      add_emit_event(emit_dict, "activepower", event_name,
                     self._start_secs, secs)

    self._quanta_amps = 0
    self._start_secs = secs

  def report(self):
    """Report bill of BLAME_CATEGORY."""
    mah = as_to_mah(self._total_amps)
    report_power = self._line_ctr

    if report_power:
      avg_ma = self._total_amps/self._line_ctr
      print "<p>Total power: %.3f mAh, avg %.3f" % (mah, avg_ma)
      top_mah = as_to_mah(self._total_top_amps)
      print ("<br>Total power above awake "
             "threshold (%.1fmA): %.3f mAh %.3f As" % (self._TOP_THRESH * 1000,
                                                       top_mah,
                                                       self._total_top_amps))
      print "<br>%d samples, %d min<p>" % (self._line_ctr, self._line_ctr / 60)

    if report_power and getopt_bill_extra_secs:
      print("<b>Power seen during each history event, including %d "
            "seconds after each event:" % getopt_bill_extra_secs)
    elif report_power:
      print "<b>Power seen during each history event:"
    else:
      print "<b>Event summary:"
    print "</b><br><pre>"

    report_list = []
    total_mah = 0.0
    total_count = 0
    for _, v in self._synopsis_dict.iteritems():
      total_mah += v.mah
      total_count += v.get_count()
      if getopt_sort_by_power and report_power:
        sort_term = v.mah
      else:
        sort_term = v.get_total_duration()
      report_list.append((sort_term, v.to_str(mah, report_power)))
    report_list.sort(key=lambda tup: tup[0], reverse=True)
    for i in report_list:
      print i[1]
    print "total: %.3f mAh, %d events" % (total_mah, total_count)
    print "</pre>\n"


def adjust_reboot_time(line, event_time):
  # Line delta time is not reset after reboot, but wall time will
  # be printed after reboot finishes. This function returns how much
  # we are off and actual reboot event time.
  line = line.strip()
  line = line.split("TIME: ", 1)[1]
  st = time.strptime(line, "%Y-%m-%d-%H-%M-%S")
  wall_time = time.mktime(st)
  return wall_time - event_time, wall_time


def get_app_id(uid):
  """Returns the app ID from a string.

  Reverses and uses the methods defined in UserHandle.java to get
  only the app ID.

  Args:
    uid: a string representing the uid printed in the history output

  Returns:
    An integer representing the specific app ID.
  """
  abr_uid_re = re.compile(r"u(?P<userId>\d+)(?P<aidType>[ias])(?P<appId>\d+)")
  if not uid:
    return 0
  if uid.isdigit():
    # 100000 is the range of uids allocated for a user.
    return int(uid) % 100000
  if abr_uid_re.match(uid):
    match = abr_uid_re.search(uid)
    try:
      d = match.groupdict()
      if d["aidType"] == "i":  # first isolated uid
        return int(d["appId"]) + 99000
      if d["aidType"] == "a":  # first application uid
        return int(d["appId"]) + 10000
      return int(d["appId"])  # app id wasn't modified
    except IndexError:
      sys.stderr.write("Abbreviated app UID didn't match properly")
  return uid


usr_time = "usrTime"
sys_time = "sysTime"
# A map of app uid to their total CPU usage in terms of user
# and system time (in ms).
app_cpu_usage = {}


def save_app_cpu_usage(uid, usr_cpu_time, sys_cpu_time):
  uid = get_app_id(uid)
  if uid in app_cpu_usage:
    app_cpu_usage[uid][usr_time] += usr_cpu_time
    app_cpu_usage[uid][sys_time] += sys_cpu_time
  else:
    app_cpu_usage[uid] = {usr_time: usr_cpu_time, sys_time: sys_cpu_time}

# Constants defined in android.net.ConnectivityManager
conn_constants = {
    "0": "TYPE_MOBILE",
    "1": "TYPE_WIFI",
    "2": "TYPE_MOBILE_MMS",
    "3": "TYPE_MOBILE_SUPL",
    "4": "TYPE_MOBILE_DUN",
    "5": "TYPE_MOBILE_HIPRI",
    "6": "TYPE_WIMAX",
    "7": "TYPE_BLUETOOTH",
    "8": "TYPE_DUMMY",
    "9": "TYPE_ETHERNET",
    "17": "TYPE_VPN",
    }


def main():
  details_re = re.compile(r"^Details:\scpu=\d+u\+\d+s\s*(\((?P<appCpu>.*)\))?")
  app_cpu_usage_re = re.compile(
      r"(?P<uid>\S+)=(?P<userTime>\d+)u\+(?P<sysTime>\d+)s")
  proc_stat_re = re.compile((r"^/proc/stat=(?P<usrTime>-?\d+)\s+usr,\s+"
                             r"(?P<sysTime>-?\d+)\s+sys,\s+"
                             r"(?P<ioTime>-?\d+)\s+io,\s+"
                             r"(?P<irqTime>-?\d+)\s+irq,\s+"
                             r"(?P<sirqTime>-?\d+)\s+sirq,\s+"
                             r"(?P<idleTime>-?\d+)\s+idle.*")
                           )

  data_start_time = 0.0
  data_stop_time = 0
  data_stop_timestr = ""

  on_mode = False
  time_offset = 0.0
  overflowed = False
  reboot = False
  prev_battery_level = -1
  bhemitter = BHEmitter()
  emit_dict = {}              # maps event categories to events
  time_dict = {}              # total event time held per second
  highlight_dict = {}         # search result for -n option
  is_first_data_line = True
  is_dumpsys_format = False
  argv_remainder = parse_argv()
  input_file = argv_remainder[0]
  legacy_mode = is_file_legacy_mode(input_file)
  # A map of /proc/stat names to total times (in ms).
  proc_stat_summary = {
      "usr": 0,
      "sys": 0,
      "io": 0,
      "irq": 0,
      "sirq": 0,
      "idle": 0,
      }

  if legacy_mode:
    input_string = LegacyFormatConverter().convert(input_file)
    input_file = StringIO.StringIO(input_string)
  else:
    input_file = open(input_file, "r")

  while True:
    line = input_file.readline()
    if not line: break

    if not on_mode and line.startswith("Battery History"):
      on_mode = True
      continue
    elif not on_mode:
      continue

    if line.isspace(): break

    line = line.strip()

    if "RESET:TIME: " in line:
      data_start_time = parse_reset_time(line)
      continue
    if "OVERFLOW" in line:
      overflowed = True
      break
    if "START" in line:
      reboot = True
      continue
    if "TIME: " in line:
      continue

    # escape spaces within quoted regions
    p = re.compile('"[^"]+"')
    line = p.sub(space_escape, line)

    if details_re.match(line):
      match = details_re.search(line)
      try:
        d = match.groupdict()
        if d["appCpu"]:
          for app in d["appCpu"].split(", "):
            app_match = app_cpu_usage_re.search(app)
            try:
              a = app_match.groupdict()
              save_app_cpu_usage(a["uid"],
                                 int(a["userTime"]), int(a["sysTime"]))
            except IndexError:
              sys.stderr.write("App CPU usage line didn't match properly")
      except IndexError:
        sys.stderr.write("Details line didn't match properly")

      continue
    elif proc_stat_re.match(line):
      match = proc_stat_re.search(line)
      try:
        d = match.groupdict()
        if d["usrTime"]:
          proc_stat_summary["usr"] += int(d["usrTime"])
        if d["sysTime"]:
          proc_stat_summary["sys"] += int(d["sysTime"])
        if d["ioTime"]:
          proc_stat_summary["io"] += int(d["ioTime"])
        if d["irqTime"]:
          proc_stat_summary["irq"] += int(d["irqTime"])
        if d["sirqTime"]:
          proc_stat_summary["sirq"] += int(d["sirqTime"])
        if d["idleTime"]:
          proc_stat_summary["idle"] += int(d["idleTime"])
      except IndexError:
        sys.stderr.write("proc/stat line didn't match properly")
      continue

    # pull apart input line by spaces
    split_line = line.split()
    if len(split_line) < 4: continue
    (line_time, _, line_battery_level, fourth_field) = split_line[:4]

    # "bugreport" output has an extra hex field vs "dumpsys", detect here.
    if is_first_data_line:
      is_first_data_line = False
      try:
        int(fourth_field, 16)
      except ValueError:
        is_dumpsys_format = True

    if is_dumpsys_format:
      line_events = split_line[3:]
    else:
      line_events = split_line[4:]

    fmt = (r"\+((?P<day>\d+)d)?((?P<hrs>\d+)h)?((?P<min>\d+)m)?"
           r"((?P<sec>\d+)s)?((?P<ms>\d+)ms)?$")
    time_delta_s = parse_time(line_time, fmt) + time_offset
    if time_delta_s < 0:
      print "Warning: time went backwards: %s" % line
      continue

    event_time = data_start_time + time_delta_s
    if reboot and "TIME:" in line:
      # adjust offset using wall time
      offset, event_time = adjust_reboot_time(line, event_time)
      if offset < 0:
        print "Warning: time went backwards: %s" % line
        continue
      time_offset += offset
      time_delta_s = event_time - data_start_time
      reboot = False
      line_events = {"reboot"}

    if line_battery_level != prev_battery_level:
      # battery_level is not an actual event, it's on every line
      if line_battery_level.isdigit():
        bhemitter.handle_event(event_time, format_time(time_delta_s),
                               "battery_level=" + line_battery_level,
                               emit_dict, time_dict, highlight_dict)

    for event in line_events:
      # conn events need to be parsed in order to be useful
      if event.startswith("conn"):
        num, ev = get_after_equal(event).split(":")
        if ev == "\"CONNECTED\"":
          event = "+conn="
        else:
          event = "-conn="

        if num in conn_constants:
          event += conn_constants[num]
        else:
          event += "UNKNOWN"

      bhemitter.handle_event(event_time, format_time(time_delta_s), event,
                             emit_dict, time_dict, highlight_dict)

    prev_battery_level = line_battery_level
    data_stop_time = event_time
    data_stop_timestr = format_time(time_delta_s)

  input_file.close()
  if not on_mode:
    print "Battery history not present in bugreport."
    return

  bhemitter.emit_remaining_events(data_stop_time, data_stop_timestr,
                                  emit_dict, time_dict, highlight_dict)

  bhemitter.generate_summary_rows(emit_dict, data_start_time,
                                  data_stop_time)

  power_emitter = PowerEmitter(bhemitter.cat_list)
  if getopt_power_data_file:
    for line in fileinput.input(getopt_power_data_file):

      data = line.split(" ")
      secs = float(data[0]) + POWER_DATA_FILE_TIME_OFFSET
      amps = float(data[1])

      power_emitter.handle_line(secs, amps, emit_dict)

  power_emitter.bill(time_dict)

  printer = Printer()

  if not getopt_generate_chart_only:
    print "<!DOCTYPE html>\n<html><head>\n"
  report_filename = argv_remainder[0]
  if getopt_report_filename:
    report_filename = getopt_report_filename
  header = "Battery Historian analysis for %s" % report_filename
  print "<title>" + header + "</title>"
  if overflowed:
    print ('<font size="5" color="red">Warning: History overflowed at %s, '
           'many events may be missing.</font>' %
           time_float_to_human(data_stop_time, True))
  print "<p>" + header + "</p>"

  if legacy_mode:
    print("<p><b>WARNING:</b> legacy format detected; "
          "history information is limited</p>\n")

  if not getopt_generate_chart_only:
    print """
      <script src="https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js"></script>
      <script type="text/javascript" src="https://www.google.com/jsapi?autoload={'modules':[{'name':'visualization','version':'1','packages':['timeline']}]}"></script>
    """

  print "<script type=\"text/javascript\">"

  if not getopt_disable_chart_drawing:
    print "google.setOnLoadCallback(drawChart);\n"

  print """
    var dataTable;
    var chart;
    var options;
    var default_width = 3000
function drawChart() {

    container = document.getElementById('chart');
    chart = new google.visualization.Timeline(container);

    dataTable = new google.visualization.DataTable();
    dataTable.addColumn({ type: 'string', id: 'Position' });
    dataTable.addColumn({ type: 'string', id: 'Name' });
    dataTable.addColumn({ type: 'date', id: 'Start' });
    dataTable.addColumn({ type: 'date', id: 'End' });
    dataTable.addRows([
"""
  printer.print_events(emit_dict, highlight_dict)
  print "]);"

  width = 3000      # default width
  height = 3000     # intial height
  printer.print_chart_options(emit_dict, highlight_dict, width, height)
  print """

  //make sure allocate enough vertical space
  options['height'] = dataTable.getNumberOfRows() * 40;
  chart.draw(dataTable, options);

  //get vertical coordinate of scale bar
  var svg = document.getElementById('chart').getElementsByTagName('svg')[0];
  var label = svg.children[2].children[0];
  var y = label.getAttribute('y');
  //plus height of scale bar
  var chart_div_height = parseInt(y) + 50;
  var chart_height = chart_div_height;

  //set chart height to exact height
  options['height'] = chart_height;
  $('#chart').css('height', chart_div_height);
  svg.setAttribute('height', chart_height);
  var content = $('#chart').children()[0];
  $(content).css('height', chart_height);
  var inner = $(content).children()[0];
  $(inner).css('height', chart_height);
}


function redrawChart() {
    var scale = document.getElementById("scale").value;
    scale = scale.replace('%', '') / 100
    options['width'] = scale * default_width;
    chart.draw(dataTable, options);
}

</script>
<style>
#redrawButton{
width:100px;
}
</style>
"""
  if not getopt_generate_chart_only:
    print "</head>\n<body>\n"

  show_complete_time = False
  if data_stop_time - data_start_time > 24 * 60 * 60:
    show_complete_time = True
  start_localtime = time_float_to_human(data_start_time, show_complete_time)
  stop_localtime = time_float_to_human(data_stop_time, show_complete_time)

  print "<div id=\"chart\">"
  if not getopt_generate_chart_only:
    print ("<b>WARNING: Visualizer disabled. "
           "If you see this message, download the HTML then open it.</b>")
  print "</div>"
  print("<p><b>WARNING:</b>\n"
        "<br>*: wake_lock field only shows the first/last wakelock held \n"
        "when the system is awake. For more detail, use wake_lock_in."
        "<br>To enable full wakelock reporting (post-KitKat only) : \n"
        "<br>adb shell dumpsys batterystats "
        "--enable full-wake-history</p>")

  if getopt_proc_name:
    if len(bhemitter.match_list) > 1:
      print("<p><b>WARNING:</b>\n"
            "<br>Multiple match found on -n option <b>%s</b>"
            "<ul>" % getopt_proc_name)
      for match in bhemitter.match_list:
        print "<li>%s</li>" % match
      print ("</ul>Showing search result for %s</p>"
             % bhemitter.match_list[0].split(":", 1)[0])
    elif not bhemitter.match_list:
      print("<p><b>WARNING:</b>\n"
            "<br>No match on -n option <b>%s</b></p>" % getopt_proc_name)

    if not highlight_dict:
      print ("Search - <b>%s</b> in <b>%s</b> - did not match any event"
             % (getopt_proc_name, getopt_highlight_category))

  print ("<pre>(Local time %s - %s, %dm elapsed)</pre>"
         % (start_localtime, stop_localtime,
            (data_stop_time-data_start_time) / 60))

  print ("<p>\n"
         "Zoom: <input id=\"scale\" type=\"text\" value=\"100%\"></input>"
         "<button type=\"button\" id=\"redrawButton\""
         "onclick=\"redrawChart()\">redraw</button></p>\n"
         "</p>\n")

  power_emitter.report()

  if app_cpu_usage:
    print "<b>App CPU usage:</b><br />"
    print "In user time:<br />"
    print "<table border=\"1\"><tr><td>UID</td><td>Duration</td></tr>"
    for (uid, use) in sorted(app_cpu_usage.items(),
                             key=lambda x: -x[1][usr_time]):
      print "<tr><td>%s</td>" % uid
      print "<td>%s</td></tr>" % format_duration(use[usr_time])
    print "</table>"
    print "<br />In system time:<br />"
    print "<table border=\"1\"><tr><td>UID</td><td>Duration</td></tr>"
    for (uid, use) in sorted(app_cpu_usage.items(),
                             key=lambda x: -x[1][sys_time]):
      print "<tr><td>%s</td>" % uid
      print "<td>%s</td></tr>" % format_duration(use[sys_time])
    print "</table>"

  print "<br /><b>Proc/stat summary</b><ul>"
  print "<li>Total User Time: %s</li>" % format_duration(
      proc_stat_summary["usr"])
  print "<li>Total System Time: %s</li>" % format_duration(
      proc_stat_summary["sys"])
  print "<li>Total IO Time: %s</li>" % format_duration(
      proc_stat_summary["io"])
  print "<li>Total Irq Time: %s</li>" % format_duration(
      proc_stat_summary["irq"])
  print "<li>Total Soft Irq Time: %s</li>" % format_duration(
      proc_stat_summary["sirq"])
  print "<li>Total Idle Time: %s</li>" % format_duration(
      proc_stat_summary["idle"])
  print "</ul>"

  print "<pre>Process table:"
  print bhemitter.procs_to_str()
  print "</pre>\n"

  if not getopt_generate_chart_only:
    print "</body>\n</html>"


if __name__ == "__main__":
  main()
