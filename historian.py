#!/usr/bin/python

# Copyright 2014 Google Inc. All rights reserved.
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
# optionally start monsoon/power monitor logging:
#   if device/host clocks are not synced, run historian.py -v
#   cts/tools/utils/monsoon.py --serialno 2294 --hz 1 --samples 100000 \
#   -timestamp | tee monsoon.out
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
HISTORY_END_STRING = "Per-PID"

getopt_debug = 0
getopt_bill_extra_secs = 0
getopt_power_quanta = 15        # slice monsoon data this many seconds,
                                # to avoid crashing visualizer
getopt_power_data_file = False
getopt_proc_name = ""
getopt_show_all_wakelocks = False
getopt_sort_by_power = True
getopt_summarize_pct = -1
getopt_report_filename = ""


def usage():
  """Print usage of the script."""
  print "\nUsage: %s [OPTIONS] [FILE]\n" % sys.argv[0]
  print "  -a: show all wakelocks (don't abbreviate system wakelocks)"
  print "  -d: debug mode, output debugging info for this program"
  print ("  -e TIME: extend billing an extra TIME seconds after each\n"
         "     wakelock, or until the next wakelock is seen.  Useful for\n"
         "     accounting for modem power overhead.")
  print "  -h: print this message."
  print ("  -n PROC: output another row containing only wakelocks from\n"
         "     processes whose name matches PROC.")
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


def timestr_to_jsdate(t):
  lt = time.localtime(t)
  return time.strftime("new Date(%Y,%m,%d,%H,%M,%S)", lt)


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
  concurrent_cat = {"wake_lock_in", "sync", "top"}
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
    if not detection_on and "Battery History" in line:
      detection_on = True
    if not detection_on:
      continue

    line_time = line.split()[0]
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


def parse_argv():
  """Parse argument and set up globals."""
  global getopt_debug, getopt_bill_extra_secs, getopt_power_quanta
  global getopt_sort_by_power, getopt_power_data_file, getopt_proc_name
  global getopt_summarize_pct, getopt_show_all_wakelocks
  global getopt_report_filename

  try:
    opts, argv_rest = getopt.getopt(sys.argv[1:],
                                    "ade:hn:p:q:r:s:tv", ["help"])
  except getopt.GetoptError as err:
    print "<pre>\n"
    print str(err)
    usage()
  try:
    for o, a in opts:
      if o == "-a": getopt_show_all_wakelocks = True
      if o == "-d": getopt_debug = True
      if o == "-e": getopt_bill_extra_secs = int(a)
      if o in ("-h", "--help"): usage()
      if o == "-n": getopt_proc_name = str(a)
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

  # The highlighted wake_lock(_in) for -n option corresponds to
  # highlight_wake_lock(_in). All the other names specified
  # in _print_setting are the same as category names.
  _print_setting = [
      ("battery_level", "#4070cf"),
      ("top", "#dc3912"),
      ("status", "#9ac658"),
      ("health", "#888888"),
      ("plug", "#888888"),
      ("wifi_full_lock", "#888888"),
      ("wifi_scan", "#888888"),
      ("wifi_multicast", "#888888"),
      ("wifi_running", "#109618"),
      ("phone_signal_strength", "#dc3912"),
      ("wifi_suppl", "#119fc8"),
      ("wifi_signal_strength", "#9900aa"),
      ("phone_scanning", "#dda0dd"),
      ("audio", "#990099"),
      ("screen", "#cbb69d"),
      ("plugged", "#2e8b57"),
      ("phone_in_call", "#cbb69d"),
      ("wifi", "#119fc8"),
      ("bluetooth", "#cbb69d"),
      ("data_conn", "#4070cf"),
      ("phone_state", "#dc3912"),
      ("signal_strength", "#119fc8"),
      ("video", "#cbb69d"),
      ("low_power", "#109618"),
      ("fg", "#dda0dd"),
      ("sync", "#9900aa"),
      ("wake_lock_pct", "#6fae11"),
      ("wake_lock", "#cbb69d"),
      ("highlight_wake_lock", "#4070cf"),
      ("gps", "#ff9900"),
      ("running_pct", "#6fae11"),
      ("running", "#990099"),
      ("wake_reason", "#b82e2e"),
      ("wake_lock_in", "#ff33cc"),
      ("highlight_wake_lock_in", "#dc3912"),
      ("mobile_radio", "#aa0000"),
      ("activepower", "#dd4477"),
      ("power", "#ff2222")]

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
      print "['%s', '%s', %s, %s]," % (cat, e[0],
                                       timestr_to_jsdate(e[1]),
                                       timestr_to_jsdate(e[2]))

  def print_highlight_dict(self, cat, highlight_dict):
    catname = cat.replace("highlight_", getopt_proc_name + " ")
    for e in highlight_dict[cat]:
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

    # remove "wake_lock" if "wake_lock_in" is available
    if("highlight_wake_lock_in" in highlight_dict and
       "highlight_wake_lock" in highlight_dict):
      del highlight_dict["highlight_wake_lock"]

    for i in range(0, len(self._print_setting)):
      cat = self._print_setting[i][0]
      if cat in emit_dict:
        self.print_emit_dict(cat, emit_dict)
        cat_count += 1
      if cat in highlight_dict:
        self.print_highlight_dict(cat, highlight_dict)

    # handle category that is not included in _print_setting
    if cat_count < len(emit_dict):
      for cat in emit_dict:
        if cat not in self._print_setting_cats:
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
      if cat in highlight_dict:
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

      if line.isspace(): continue
      if HISTORY_END_STRING in line or not line: break

      line = line.strip()
      arr = line.split()
      if len(arr) < 4: continue

      p = re.compile('"[^"]*')
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

    output_string += HISTORY_END_STRING
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
                        "wifi_scan", "wifi_multicast", "wifi_running",
                        "bluetooth", "audio", "video", "wake_lock_in"]
  _in_progress_dict = autovivify()  # events that are currently in progress
  _proc_dict = {}             # mapping of "proc" uid to human-readable name
  _search_proc_id = 0         # proc id of the getopt_proc_name
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
    return (False, False)

  def store_proc(self, e, highlight_dict):
    proc_pair = get_after_equal(e)
    (proc_id, proc_name) = proc_pair.split(":", 1)
    self._proc_dict[proc_id] = proc_name    # may overwrite
    if getopt_proc_name and getopt_proc_name in proc_name and proc_id:
      if proc_name not in self.match_list:
        self.match_list.append(proc_name)
      if self._search_proc_id == 0:
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
    if "*alarm*" in name:
      proc_pair = get_after_equal(name)
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

  def process_event_name(self, event_name, start_timestr, timestr):
    event_name = self.annotate_event_name(event_name)
    event_name = self.abbreviate_event_name(event_name)
    short_event_name = event_name
    event_name += "(%s-%s)" % (abbrev_timestr(start_timestr),
                               abbrev_timestr(timestr))
    return (event_name, short_event_name)

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
    (start_proc_id, start_proc_name) = get_proc_pair(event_name)
    (end_proc_id, end_proc_name) = get_proc_pair(end_event_name)
    (event_name, short_event_name) = self.process_event_name(event_name,
                                                             start_timestr,
                                                             end_timestr)

    if "wake_lock" in cat:
      end_event_name = self.process_event_name(end_event_name,
                                               start_timestr, end_timestr)[0]
      # +wake_lock/+wake_lock_in for -n option
      if start_proc_id == self._search_proc_id:
        add_emit_event(highlight_dict, "highlight_" + cat,
                       event_name, start_time, end_time)
      # -wake_lock for -n option
      if (end_proc_name and end_proc_name != start_proc_name and
          end_proc_id == self._search_proc_id):
        add_emit_event(highlight_dict, "highlight_" + cat,
                       end_event_name, start_time, end_time)
      if start_proc_name != end_proc_name:
        if end_proc_name:
          add_emit_event(emit_dict, cat, end_event_name,
                         start_time, end_time)
        # do not emit +wake_lock event if it does not have
        # an id and we already emit a -wake_lock event
        if cat == "wake_lock" and end_proc_id and not start_proc_id:
          return

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


def main():
  data_start_time = 0.0
  data_stop_time = 0
  data_stop_timestr = ""

  on_mode = False
  prev_battery_level = -1
  bhemitter = BHEmitter()
  emit_dict = {}              # maps event categories to events
  time_dict = {}              # total event time held per second
  highlight_dict = {}         # search result for -n option

  argv_remainder = parse_argv()
  input_file = argv_remainder[0]
  legacy_mode = is_file_legacy_mode(input_file)

  if legacy_mode:
    input_string = LegacyFormatConverter().convert(input_file)
    input_file = StringIO.StringIO(input_string)
  else:
    input_file = open(input_file, "r")

  while True:
    line = input_file.readline()

    if not on_mode and line.startswith("Battery History"):
      on_mode = True
      continue
    elif not on_mode:
      continue

    if "RESET:TIME: " in line:
      data_start_time = parse_reset_time(line)
      continue

    if line.isspace(): continue
    if HISTORY_END_STRING in line or not line: break

    # escape spaces within quoted regions
    p = re.compile('"[^"]*"')
    line = p.sub(space_escape, line)

    # pull apart input line by spaces
    split_line = line.split()
    if len(split_line) < 4: continue
    (line_time, _, line_battery_level, _) = split_line[:4]
    line_events = split_line[4:]

    fmt = (r"\+((?P<day>\d+)d)?((?P<hrs>\d+)h)?((?P<min>\d+)m)?"
           r"((?P<sec>\d+)s)?((?P<ms>\d+)ms)?$")
    time_delta_s = parse_time(line_time, fmt)
    if time_delta_s < 0:
      continue
    event_time = data_start_time + time_delta_s

    if line_battery_level != prev_battery_level:
      # battery_level is not an actual event, it's on every line
      bhemitter.handle_event(event_time, line_time,
                             "battery_level=" + line_battery_level,
                             emit_dict, time_dict, highlight_dict)
    for event in line_events:
      bhemitter.handle_event(event_time, line_time, event,
                             emit_dict, time_dict, highlight_dict)

    prev_battery_level = line_battery_level
    data_stop_time = event_time
    data_stop_timestr = line_time

  bhemitter.emit_remaining_events(data_stop_time, data_stop_timestr,
                                  emit_dict, time_dict, highlight_dict)
  input_file.close()

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

  print "<!DOCTYPE html>\n<html><head>\n"
  report_filename = argv_remainder[0]
  if getopt_report_filename:
    report_filename = getopt_report_filename
  header = "Battery Historian analysis for %s" % report_filename
  print "<title>" + header + "</title>"
  print "<p>" + header + "</p>"

  if legacy_mode:
    print("<p><b>WARNING:</b> legacy format detected; "
          "history information is limited</p>\n")

  print """
<script type="text/javascript" src="https://www.google.com/jsapi?autoload={'modules':[{'name':'visualization',
       'version':'1','packages':['timeline']}]}"></script>
<script src="https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js"></script>
<script type="text/javascript">

google.setOnLoadCallback(drawChart);

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
  var svg = document.getElementsByTagName('svg')[0];
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
</head>
<body>
"""
  show_complete_time = False
  if data_stop_time - data_start_time > 24 * 60 * 60:
    show_complete_time = True
  start_localtime = time_float_to_human(data_start_time, show_complete_time)
  stop_localtime = time_float_to_human(data_stop_time, show_complete_time)
  print ('<div id="chart"><b>WARNING: Visualizer disabled. '
         'If you see this message, download the HTML then open it.</b></div>')
  if "wake_lock_in" not in emit_dict and (getopt_power_data_file
                                          or getopt_proc_name):
    print("<p><b>WARNING:</b>\n"
          "<br>No information available about wake_lock_in.\n"
          "<br>To enable full wakelock reporting: \n"
          "<br>adb shell dumpsys batterystats"
          "--enable full-wake-history</p>")

  if getopt_proc_name and len(bhemitter.match_list) > 1:
    print("<p><b>WARNING:</b>\n"
          "<br>Multiple match found on -n option <em>%s</em>"
          "<ul>" % getopt_proc_name)
    for match in bhemitter.match_list:
      print "<li>%s</li>" % match
    print "</ul>Showing result for %s" % bhemitter.match_list[0]
  print ("<pre>(Local time %s - %s, %dm elapsed)</pre>"
         % (start_localtime, stop_localtime,
            (data_stop_time-data_start_time) / 60))

  print ("<p>\n"
         "Zoom: <input id=\"scale\" type=\"text\" value=\"100%\"></input>"
         "<button type=\"button\" id=\"redrawButton\""
         "onclick=\"redrawChart()\">redraw</button></p>\n"
         "</p>\n")

  power_emitter.report()

  print "<pre>Process table:"
  print bhemitter.procs_to_str()

  print "</body>\n</html>"


if __name__ == "__main__":
  main()
