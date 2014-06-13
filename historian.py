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
# adb shell dumpsys batterystats --enable full-wake-history
# adb shell dumpsys batterystats --reset
# (optionally start monsoon/power monitor logging:
#   cts/tools/utils/monsoon.py --serialno 2294 --hz 1 --samples 100000 \
#   -timestamp | tee monsoon.out)
# ...let device run a while...
# stop monsoon.py
# collect bugreport
# ./historian.py -p monsoon.out bugreport.txt

import collections
import fileinput
import getopt
import re
import subprocess
import sys
import time

POWER_DATA_FILE_TIME_OFFSET = 0  # deal with any clock mismatch.
BLAME_CATEGORY = "wake_lock_in"  # category to assign power blame to.

getopt_debug = 0
getopt_stop_delta = 0
getopt_bill_extra_secs = 0
getopt_power_quanta = 15        # slice monsoon data this many seconds,
                                # to avoid crashing visualizer
getopt_power_data_file = False
getopt_sort_by_power = True
getopt_show_all_wakelocks = False
getopt_proc_name = ""


def parse_time(s):
  if s == "0": return 0.0

  p = re.compile(
      r"\+((?P<day>\d+)d)?((?P<hrs>\d+)h)?((?P<min>\d+)m)?((?P<sec>\d+)s)?((?P<ms>\d+)ms)?$")
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


def time_float_to_human(t):
  return time.strftime("%H:%M:%S", time.localtime(t))


def abbrev_timestr(s):
  arr = s.split("s")
  if len(arr) < 3: return "0s"
  return arr[0]+"s"


def str_to_jsdate(t):
  lt = time.localtime(t)
  return time.strftime("new Date(%y,%m,%d,%H,%M,%S)", lt)


def get_event_category(e):
  e = e.lstrip("+-")
  earr = e.split("=")
  return earr[0]


def get_uid(e):
  e = e.split("=")[1]
  return e


def get_quoted_region(e):
  e = e.split("\"")[1]
  return e


def get_after_equal(e):
  e = e.split("=")[1]
  return e


def get_event_subcat(cat, e):
  # category that can have various simultaneous entities
  # use uid to distinguish
  concurrent_cat = {"sync", "top"}
  if "wake_lock_in" in cat:
    try:
      return get_after_equal(e)
    except IndexError:
      pass
  elif cat in concurrent_cat:
    try:
      return get_uid(e)
    except IndexError:
      pass
  return ""

# get proc id and name


def get_proc_pair(e):
  if ":" in e:
    proc_pair = get_after_equal(e)
    return proc_pair.split(":", 1)
  else:
    return ("", "")


def as_to_mah(a):
  return a * 1000 / 60 / 60


def list_within_dict(l, d):
  for i in l:
    if i in d:
      return d[i]
  return False


def apply_fn_over_range(fn, start_time, end_time, arglist):
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


class AttrSum(object):

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
      self.timestr = time_float_to_human(t)

  def get_count(self):
    return len(self._duration_list)

  def get_median_duration(self):
    return sorted(self._duration_list)[int(self.get_count() / 2)]

  def get_total_duration(self):
    return sum(self._duration_list)

  def to_str(self, totalmah):
    if totalmah:
      pct = self.mah * 100 / totalmah
    else:
      pct = 0
    avg = self.get_total_duration() / self.get_count()

    ret = "%.3f mAh (%.1f%%): " % (self.mah, pct)
    ret += "%3s events, " % str(self.get_count())
    ret += "%6.3fs total " % self.get_total_duration()
    ret += "%6.3fs avg " % avg
    ret += "%6.3fs median " % self.get_median_duration()
    ret += self.name
    ret += " (first at %s)" % self.timestr
    return ret


class OverlapRec(object):

  def __init__(self, start_timestr, event_name):
    # starting time currently tracking
    self._start_timestr = start_timestr
    # number of unique events starting at _start_timestr
    self._curr_cnt = 1
    # _curr_cnt and repeated events
    self._curr_overcnt = 1
    self._max_cnt = 1
    self._max_overcnt = 1
    self._events = [event_name]

  def update(self, start_timestr, event_name):
    if self._start_timestr == start_timestr:
      self._curr_overcnt += 1
      if event_name not in self._events:
        self._events.append(event_name)
        self._curr_cnt += 1
    else:
      if self._curr_cnt > self._max_cnt:
        self._max_cnt = self._curr_cnt
      if self._curr_overcnt > self._max_overcnt:
        self._max_overcnt = self._curr_overcnt
      self._start_timestr = start_timestr
      self._curr_cnt = 1
      self._curr_overcnt = 1
      self._events = [event_name]

  def get_avg_max_cnt(self):
    return (self._max_cnt + self._max_overcnt) / 2


def is_emit_event(e):
  return e[0] != "+"


def is_standalone_event(e):
  return not (e[0] == "+" or e[0] == "-")


def is_proc_event(e):
  return e.startswith("+proc")


# returns a multidimensional dict
def autovivify():
  return collections.defaultdict(autovivify)


def swap(swap_list, first, second):
  swap_list[first], swap_list[second] = swap_list[second], swap_list[first]


def add_emit_event(event_dict, cat, name, start, end):
  newevent = (name, int(start), int(end))
  if end < start:
    print "BUG: end time before start time:<br>" % str(newevent)
  else:
    if getopt_debug:
      print "Stored emitted event: %s<br>" % str(newevent)

  if cat in event_dict:
    event_dict[cat].append(newevent)
  else:
    event_dict[cat] = [newevent]


class Printer(object):
  # default color to use if category not in _print_order
  _default_color = "#4070cf"

  _print_order = [
      "battery_level", "top", "status", "health",
      "plug", "wifi_full_lock", "wifi_scan", "wifi_multicast",
      "wifi_running", "phone_scanning", "audio", "screen",
      "plugged", "phone_in_call", "wifi", "bluetooth",
      "data_conn", "phone_state", "signal_strength", "video",
      "low_power", "fg", "sync", "wake_lock",
      "highlight_wake_lock", "gps", "running", "wake_reason",
      "wake_lock_in", "highlight_wake_lock_in", "mobile_radio",
      "activepower", "power"]
  _print_color = [
      "#4070cf", "#dc3912", "#9ac658", "#888888",
      "#888888", "#888888", "#888888", "#888888",
      "#109618", "#dda0dd", "#990099", "#cbb69d",
      "#2e8b57", "#cbb69d", "#119fc8", "#cbb69d",
      "#4070cf", "#dc3912", "#9ac658", "#ff9900",
      "#109618", "#dda0dd", "#990099", "#cbb69d",
      "#4070cf", "#ff9900", "#6fae11", "#b82e2e",
      "#ff33cc", "#dc3912", "#aa0000",
      "#dd4477", "#ff2222"]

  # Combine events with the same name occurring during the same second,
  # to keep visualization from being so noisy.
  def aggregate_events(self, event_dict):
    output_dict = {}
    for cat, events in event_dict.iteritems():
      output_dict[cat] = []
      start_dict = {}
      for event in events:
        start_time = event[1]
        if start_time in start_dict:
          start_dict[start_time].append(event)
        else:
          start_dict[start_time] = [event]
      for start_time, event_list in start_dict.iteritems():
        event_set = set(event_list)      # uniqify
        for event in event_set:
          output_dict[cat].append(event)
    return output_dict

  def print_event_dict(self, cat, event_dict):
    for e in event_dict[cat]:
      print "['%s', '%s', %s, %s]," % (cat, e[0],
                                       str_to_jsdate(e[1]), str_to_jsdate(e[2]))

  def print_highlight_dict(self, cat, highlight_dict):
    catname = cat.replace("highlight_", getopt_proc_name + " ")
    for e in highlight_dict[cat]:
      print "['%s', '%s', %s, %s]," % (catname, e[0],
                                       str_to_jsdate(e[1]), str_to_jsdate(e[2]))

  # print category data in the order of _print_order
  def print_events(self, event_dict, highlight_dict):
    event_dict = self.aggregate_events(event_dict)
    highlight_dict = self.aggregate_events(highlight_dict)
    cat_count = 0

    # remove "wake_lock" if "wake_lock_in" is available
    if("highlight_wake_lock_in" in highlight_dict and
       "highlight_wake_lock" in highlight_dict):
      del highlight_dict["highlight_wake_lock"]

    for i in range(0, len(self._print_order)):
      cat = self._print_order[i]
      if cat in event_dict:
        self.print_event_dict(cat, event_dict)
        cat_count += 1
      if cat in highlight_dict:
        self.print_highlight_dict(cat, highlight_dict)

    # handle category that is not included in _print_order
    if cat_count < len(event_dict):
      for cat in event_dict:
        if cat not in self._print_order:
          if getopt_debug:
            print "event category not found: " + cat
          else:
            self.print_event_dict(cat, event_dict)

  def print_chart_options(self, event_dict, highlight_dict, height, width):
    color_string = ""
    cat_count = 0
    # construct color string following the order of _print_order and
    # _print_color
    for i in range(0, len(self._print_order)):
      cat = self._print_order[i]
      if cat in event_dict:
        color_string += "'%s', " % self._print_color[i]
        cat_count += 1
      if cat in highlight_dict:
        color_string += "'%s', " % self._print_color[i]
        cat_count += 1

      if cat_count % 4 == 0:
        color_string += "\n\t"

    # handle category that is not included in _print_order
    if cat_count < len(event_dict):
      for cat in event_dict:
        if cat not in self._print_order:
          if getopt_debug:
            print "event category not found: " + cat
          else:
            color_string += "'%s', " % self._default_color

    print("\toptions = {\n"
          "\ttimeline: { colorByRowLabel: true},\n"
          "\t'height': %s,\n"
          "\t'width': %s,\n"
          "\tcolors: [%s]\n"
          "\t};" % (height, width, color_string))

  def get_est_height(self, row_count):
    if getopt_power_data_file:
      row_count += 2
    if getopt_proc_name:
      row_count += 2
    row_height = 45
    extra_padding = 0
    return row_count * row_height + extra_padding


class BHEmitter(object):
  _omit_cats = ["temp", "volt", "brightness", "sensor", "proc"]
  _event_dict = autovivify()
  _proc_dict = {}             # mapping of "proc" uid to human-readable name
  _search_proc_id = 0         # proc id of the getopt_proc_name
  _overlap_dict = {}          # track events starting at the same time
  match_list = []             # list of package names that match search string
  cat_list = []               # BLAME_CATEGORY summary data

  def store_event(self, cat, subcat, e, t, timestr):
    self._event_dict[cat][subcat] = (e, t, timestr)

  def retrieve_event(self, cat, subcat):
    return self._event_dict[cat].pop(subcat)

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

  def track_overlap(self, cat, start_timestr, event_name):
    start_timestr = abbrev_timestr(start_timestr)
    if cat not in self._overlap_dict:
      self._overlap_dict[cat] = OverlapRec(start_timestr, event_name)
    else:
      self._overlap_dict[cat].update(start_timestr, event_name)

  def get_est_total_row(self):
    # use average of max number of unique events starting at the
    # same time and max number of events starting at the same time
    # as an estimate
    total_cnt = 0
    for cat in self._overlap_dict:
      total_cnt += self._overlap_dict[cat].get_avg_max_cnt()
    return total_cnt

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

  def handle_event(self, t, e, timestr, event_dict, time_dict, highlight_dict):
    if getopt_debug: print "<p>handle_event: %s at %s<br>" % (e, timestr)

    cat = get_event_category(e)
    subcat = get_event_subcat(cat, e)
    # events already in progress are treated as starting at time 0
    if timestr == "0" and (cat == "proc" or cat == "wake_lock_in"):
      e = "+" + e
    if is_proc_event(e): self.store_proc(e, highlight_dict)

    if cat in self._omit_cats: return

    if not is_emit_event(e):
      self.store_event(cat, subcat, e, t, timestr)
      if getopt_debug:
        print "stored event: %s in %s/%s<br>" % (e, cat, subcat)
      return
    else:
      start_time = 0.0
      if cat in self._event_dict:
        try:
          (event_name, start_time,
           start_timestr) = self.retrieve_event(cat, subcat)
        except KeyError:
          if getopt_debug:
            print "no match for %s at %s<br>" % (e, timestr)
          return
        if getopt_debug:
          print "found cat event in dict: %s <br>" % event_name
      else:
        start_time = t  # -1.0
        event_name = e
        start_timestr = timestr
        if getopt_debug:
          print "no previous event found in cat %s<br>" % cat

      (start_proc_id, start_proc_name) = get_proc_pair(event_name)
      (end_proc_id, end_proc_name) = get_proc_pair(e)
      (event_name, short_event_name) = self.process_event_name(
          event_name, start_timestr, timestr)

      if "wake_lock" in cat:
        end_event_name = self.process_event_name(e,
                                                 start_timestr, timestr)[0]
        # +wake_lock/+wake_lock_in for -n option
        if start_proc_id == self._search_proc_id:
          add_emit_event(highlight_dict, "highlight_" + cat,
                         event_name, start_time, t)
        # -wake_lock for -n option
        if (end_proc_name and end_proc_name != start_proc_name and
            end_proc_id == self._search_proc_id):
          add_emit_event(highlight_dict, "highlight_" + cat,
                         end_event_name, start_time, t)
        if start_proc_name != end_proc_name:
          if end_proc_name:
            self.track_overlap(cat, start_timestr, end_event_name)
            add_emit_event(event_dict, cat, end_event_name,
                           start_time, t)
          # do not emit +wake_lock event if it does not have
          # an id and we already emit a -wake_lock event
          if cat == "wake_lock" and end_proc_id and not start_proc_id:
            return

      if cat == BLAME_CATEGORY:
        self.cat_list.append((short_event_name, start_time, t))

        end_time = t + getopt_bill_extra_secs
        self.track_event_parallelism(start_time, end_time, time_dict)

      if t - start_time < 1:
        # HACK: gviz library doesn't always render sub-second events
        t += 1

      self.track_overlap(cat, start_timestr, event_name)
      add_emit_event(event_dict, cat, event_name, start_time, t)


class PowerEmitter(object):
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

  # During any second, this event might have been held for
  # less than the second, and others might have been held during
  # that time.  Here we try to assign the proportional share of the
  # blame.
  def get_range_power_fn(self, start_time, time_this_quanta, time_dict):
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
    for _, v in enumerate(self._cat_list):
      (v_name, v_start, v_end) = v
      if v_name in self._synopsis_dict:
        sd = self._synopsis_dict[v_name]
      else:
        sd = AttrSum()

      amps = self.get_range_power(v_start,
                                  v_end + getopt_bill_extra_secs,
                                  time_dict)
      mah = as_to_mah(amps)
      sd.add(v_name, v_end - v_start, mah, v_start)
      if getopt_debug:
        print "billed range %f %f at %fAs to %s<br>" % (v_start, v_end,
                                                        amps, v_name)
      self._synopsis_dict[v_name] = sd

  def handle_line(self, secs, amps, event_dict):
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
    add_emit_event(event_dict, "power", event_name, self._start_secs, secs)

    if self._quanta_amps > self._TOP_THRESH * getopt_power_quanta:
      self._total_top_amps += self._quanta_amps
      add_emit_event(event_dict, "activepower", event_name,
                     self._start_secs, secs)

    self._quanta_amps = 0
    self._start_secs = secs

  def report(self):
    mah = as_to_mah(self._total_amps)
    if not self._line_ctr: return
    avg_ma = self._total_amps/self._line_ctr

    print "<p>Total power: %.3f mAh, avg %.3f" % (mah, avg_ma)

    top_mah = as_to_mah(self._total_top_amps)
    print ("<br>Total power above awake "
           "threshold (%.1fmA): %.3f mAh %.3f As" % (self._TOP_THRESH * 1000,
                                                     top_mah,
                                                     self._total_top_amps))
    print "<br>%d samples, %d min<p>" % (self._line_ctr, self._line_ctr / 60)

    if getopt_bill_extra_secs:
      print("<b>Power seen during each history event, including %d "
            "seconds after each event:" % getopt_bill_extra_secs)
    else:
      print "<b>Power seen during each history event:"
    print "</b><br><pre>"

    report_list = []
    total_mah = 0.0
    total_count = 0
    for _, v in self._synopsis_dict.iteritems():
      total_mah += v.mah
      total_count += v.get_count()
      if getopt_sort_by_power and getopt_power_data_file:
        sort_term = v.mah
      else:
        sort_term = v.get_duration()
      report_list.append((sort_term, v.to_str(mah)))
    report_list.sort(key=lambda tup: tup[0], reverse=True)
    for i in report_list:
      print i[1]
    print "total: %.3f mAh, %d events" % (total_mah, total_count)


def space_escape(match):
  value = match.group()
  p = re.compile(r"\s+")
  return p.sub("_", value)


def parse_reset_time(line):
  line = line.strip()
  line = line.split("RESET:TIME: ", 1)[1]
  st = time.strptime(line, "%Y-%m-%d-%H-%M-%S")
  return time.mktime(st)


def usage():
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
  print "  -s TIME: stop processing data occurring after TIME seconds."
  print "  -t: sort power report by wakelock duration instead of charge"
  print "  -v: synchronize device time before collecting power data"
  print "\n"
  sys.exit(1)


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
  global getopt_debug, getopt_bill_extra_secs, getopt_power_quanta
  global getopt_sort_by_power, getopt_power_data_file
  global getopt_show_all_wakelocks, getopt_proc_name
  global getopt_stop_delta

  try:
    opts, argv_rest = getopt.getopt(sys.argv[1:],
                                    "ade:hn:p:q:s:tv", ["help"])
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
      if o == "-s": getopt_stop_delta = int(a)
      if o == "-t": getopt_sort_by_power = False
      if o == "-v": sync_time()
  except ValueError as err:
    print str(err)
    usage()

  return argv_rest


def main():
  stop_request = 0
  data_start_time = 0.0
  data_stop_time = 0

  on_mode = False
  prev_battery_level = -1
  bhemitter = BHEmitter()
  event_dict = {}             # maps event categories to events
  time_dict = {}              # total event time held per second
  highlight_dict = {}        # search result for -n option

  argv_remainder = parse_argv()

  for line in fileinput.input(argv_remainder[0]):
    if not on_mode and line.startswith("Battery History"):
      on_mode = True
      continue
    elif not on_mode:
      continue

    if "RESET:TIME: " in line:
      data_start_time = parse_reset_time(line)
      if getopt_stop_delta:
        stop_request = getopt_stop_delta + data_start_time

    if line.startswith("Per-PID"): break
    if not line or line.isspace(): continue
    arr = line.split()
    if len(arr) < 5: continue

    # escape spaces within quoted regions
    p = re.compile('"[^"]*"')
    line = p.sub(space_escape, line)

    # pull apart input line by spaces
    split_line = line.split()
    (line_time, _, line_battery_level, _) = split_line[:4]
    line_events = split_line[4:]

    time_delta_s = parse_time(line_time)
    if time_delta_s < 0:
      continue
    event_time = data_start_time + time_delta_s

    if stop_request and event_time > stop_request:
      break

    if line_battery_level != prev_battery_level:
      # battery_level is not an actual event, it's on every line
      bhemitter.handle_event(event_time,
                             "battery_level=" + line_battery_level,
                             line_time, event_dict, time_dict,
                             highlight_dict)
    for event in line_events:
      bhemitter.handle_event(event_time, event,
                             line_time, event_dict, time_dict,
                             highlight_dict)

    prev_battery_level = line_battery_level
    data_stop_time = event_time

  fileinput.close()

  power_emitter = PowerEmitter(bhemitter.cat_list)
  if getopt_power_data_file:
    for line in fileinput.input(getopt_power_data_file):

      data = line.split(" ")
      secs = float(data[0]) + POWER_DATA_FILE_TIME_OFFSET
      amps = float(data[1])
      if stop_request and secs > stop_request:
        break

      power_emitter.handle_line(secs, amps, event_dict)

  power_emitter.bill(time_dict)

  printer = Printer()

  print """
<!DOCTYLE html>
<html>
<head>
"""
  print "Battery historian analysis for %s :<p>" % argv_remainder[0]
  print """
<script type="text/javascript" src="https://www.google.com/jsapi?autoload={'modules':[{'name':'visualization',
       'version':'1','packages':['timeline']}]}"></script>
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
  printer.print_events(event_dict, highlight_dict)
  print "]);"

  height = printer.get_est_height(bhemitter.get_est_total_row())
  width = 3000  # default width
  printer.print_chart_options(event_dict, highlight_dict, height, width)
  print """

    chart.draw(dataTable, options);
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
  start_localtime = time_float_to_human(data_start_time)
  stop_localtime = time_float_to_human(data_stop_time)
  print '<div id="chart"></div>'

  if "wake_lock_in" not in event_dict and (getopt_power_data_file
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
            (data_stop_time-data_start_time)/60))

  print ("<p>\n"
         "Zoom: <input id=\"scale\" type=\"text\" value=\"100%\"></input>"
         "<button type=\"button\" id=\"redrawButton\""
         "onclick=\"redrawChart()\">redraw</button></p>\n"
         "</p>\n</body>\n</html>")
  power_emitter.report()

if __name__ == "__main__":
  main()
