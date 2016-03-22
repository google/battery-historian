#!/usr/bin/python
"""Historian script for converting the timestamps in kernel trace to UTC.

 TO USE:
 kernel_trace.py --bugreport=<path to bugreport> --trace=<path to trace file>
 --device=<device type hammerhead/shamu/flounder/flounder_lte>
"""

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

import csv
import datetime
import getopt
import re
import sys

flag_bugreport = None
flag_trace = None
flag_device = None


def read_dmesg(bugreport, suspend_exit, suspend_enter, device):
  """Extracts the suspend exit/entries times from the bugreport."""
  read_first_suspend_entry = True
  first_jiffy = 0
  first_utc = 0

  if device == "flounder" or device == "flounder_lte":
    device_suspend_pattern = "(.*)tegra124-pinctrl tegra124-pinctrl:(.*)"
  elif device == "shamu" or device == "hammerhead":
    device_suspend_pattern = "(.*)Suspending console(.*)"
  else:
    return (0, 0)

  for line in bugreport:
    m = re.match(r"(.*)\[(.*)\] PM: suspend ([a-z]+) (.*?) UTC", line)
    if m:
      if "exit" in m.group(3):
        jiffy = float(m.group(2))
        utc = m.group(4)
        utc = utc[:-3]
        utc = datetime.datetime.strptime(utc, "%Y-%m-%d %H:%M:%S.%f")
        suspend_exit[jiffy] = utc
      elif read_first_suspend_entry and "entry" in m.group(3):
        jiffy = float(re.search(r"\[([ 0-9.]+)\]", line).group(1))
        utc = re.search("PM: suspend entry (.*) UTC", line).group(1)
        first_jiffy = jiffy
        utc = utc[:-3]
        utc = datetime.datetime.strptime(utc, "%Y-%m-%d %H:%M:%S.%f")
        first_utc = utc
        read_first_suspend_entry = False

    elif re.match(device_suspend_pattern, line):
      jiffy = float(re.search(r"\[([ 0-9.]+)\]", line).group(1))
      suspend_enter.append(jiffy)
  return (first_jiffy, first_utc)


def convert_timestamps(trace_file, file_handle, time_dict, first_jiffy,
                       first_utc):
  """Converts all the valid jiffies to UTC time in the trace file."""
  line_number = 0
  trace_start = 0
  keys = sorted(time_dict)
  # Find the point where the stats for all the cores start.
  for row in trace_file:
    if len(row) > 4 and ("buffer" in row[3]) and ("started" in row[4]):
      trace_start = line_number
    line_number += 1

  file_handle.seek(0)
  line_number = 0
  curr_jiffy = keys[0]
  next_jiffy = keys[1]
  index = 1
  for row in trace_file:
    # Skip trace rows which contain incomplete data.
    if line_number < trace_start:
      line_number += 1
      continue

    row_no = 3
    if "#" in row[0]:
      continue
    for row_no in range(row_no, len(row)):
      if ":" in row[row_no]:
        break
      if row_no == len(row):
        continue

    jiffy = float(row[row_no][:-1])
    # Skip trace points for which we do not have timestamp conversion.
    if ((first_jiffy != 0 and jiffy < first_jiffy) or
        (first_jiffy == 0 and jiffy < keys[0])):
      continue
    elif first_jiffy != 0 and jiffy < keys[0]:
      diff = jiffy - first_jiffy
      us = (diff - int(diff))*1000000
      utc = first_utc + datetime.timedelta(seconds=int(diff),
                                           microseconds=us)
      row[row_no] = str(utc)
    elif jiffy > curr_jiffy and jiffy < next_jiffy:
      diff = jiffy - curr_jiffy
      us = (diff - int(diff))*1000000
      utc = time_dict[curr_jiffy] + datetime.timedelta(seconds=int(diff),
                                                       microseconds=us)
      row[row_no] = str(utc)
    else:
      index += 1
      curr_jiffy = next_jiffy
    if index < len(keys):
      next_jiffy = keys[index]
    else:
      next_jiffy = float("inf")

    while next_jiffy < jiffy and index < len(keys):
      curr_jiffy = next_jiffy
      next_jiffy = keys[index]
      index += 1

    diff = jiffy - curr_jiffy
    us = (diff - int(diff))*1000000
    utc = time_dict[curr_jiffy] + datetime.timedelta(seconds=int(diff),
                                                     microseconds=us)
    row[row_no] = '"' + str(utc) + '"'
    for each_column in row:
      sys.stdout.write(str(each_column) + " ")
    sys.stdout.write("\n")


def usage():
  """Print usage of the script."""
  print ("\nUsage: %s --bugreport=<path to bugreport>"
         " --trace=<path to trace file>"
         " --device=<device type"
         " hammerhead/shamu/flounder/flounder_lte>\n") % sys.argv[0]
  sys.exit(1)


def parse_argv(argv):
  """Parse arguments and set up globals."""
  global flag_bugreport, flag_trace, flag_device

  try:
    opts, unused_args = getopt.getopt(argv,
                                      "", ["bugreport=", "trace=", "device="])
  except getopt.GetoptError:
    usage()
    sys.exit(2)

  for opt, arg in opts:
    if opt == "--bugreport":
      flag_bugreport = arg
    elif opt == "--trace":
      flag_trace = arg
    elif opt == "--device":
      flag_device = arg
    else:
      usage()
      sys.exit(2)


def main(argv):
  parse_argv(argv)
  if not flag_bugreport:
    print "Bug report not valid"
    usage()
    sys.exit(1)
  if not flag_trace:
    print "Trace file not valid"
    usage()
    sys.exit(1)
  if not flag_device:
    print "Device not valid"
    usage()
    sys.exit(1)

  try:
    bugreport = open(flag_bugreport)
  except IOError:
    print "Unable to open bug report"
    sys.exit(1)

  suspend_exit = {}
  suspend_enter = []
  first_jiffy, first_utc = read_dmesg(bugreport, suspend_exit, suspend_enter,
                                      flag_device)
  if not (len(suspend_enter) and len(suspend_exit)):
    return
  if suspend_enter and (first_jiffy > suspend_enter[0]):
    first_jiffy = 0

  time_dict = {}
  timestamp = sorted(suspend_exit)
  index = 0
  for timestamp in timestamp:
    if index >= len(suspend_enter) or timestamp < suspend_enter[index]:
      continue
    utc = suspend_exit[timestamp]
    diff = timestamp - float(suspend_enter[index])
    utc -= datetime.timedelta(seconds=int(diff),
                              microseconds=(diff - int(diff))*1000000)
    time_dict[suspend_enter[index]] = utc
    index += 1

  try:
    file_handle = open(flag_trace, "r")
    trace_file = csv.reader(file_handle, delimiter=" ", skipinitialspace=True)
  except IOError:
    print "Unable to open trace file"
    sys.exit(1)

  convert_timestamps(trace_file, file_handle, time_dict, first_jiffy,
                     first_utc)

if __name__ == "__main__":
  main(sys.argv[1:])
