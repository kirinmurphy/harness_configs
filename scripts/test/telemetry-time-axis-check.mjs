#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  clockLabel,
  timeAxisLabel,
  timeAxisScale,
  timeAxisTicks,
} from "../../portal/telemetry/time-axis.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const START = localTime(2026, 6, 1, 12, 34);

testClockLabels();
testScaleSelection();
testOneTickGuard();
testBoundedTicks();
testDayLabels();
testMonthLabels();

console.log("telemetry time-axis checks passed");

function testClockLabels() {
  assert.match(clockLabel(START), /^\d{2}:\d{2}$/);
}

function testScaleSelection() {
  assert.equal(timeAxisScale(36 * HOUR), "time");
  assert.equal(timeAxisScale(2 * DAY), "day");
  assert.equal(timeAxisScale(3 * MONTH), "month");
}

function testOneTickGuard() {
  assert.deepEqual(timeAxisTicks(START, HOUR, 1), [START]);
}

function testBoundedTicks() {
  const ticks = timeAxisTicks(START, 7 * DAY, 4);
  assert(ticks.length > 0);
  assert(ticks.length <= 4);
  assert.equal(ticks[0], START);
  assert(ticks.every((tick) => Number.isFinite(tick)));
}

function testDayLabels() {
  assert.equal(timeAxisLabel(START, "day", { first: true }), "Jul 1");
  assert.equal(timeAxisLabel(localTime(2026, 6, 2), "day"), "2");
  assert.equal(timeAxisLabel(localTime(2026, 7, 1), "day"), "Aug 1");
}

function testMonthLabels() {
  assert.equal(timeAxisLabel(START, "month", { first: true }), "Jul '26");
  assert.equal(timeAxisLabel(localTime(2027, 0, 1), "month"), "Jan '27");
  assert.equal(timeAxisLabel(localTime(2026, 7, 1), "month"), "Aug");
}

function localTime(year, monthIndex, day, hour = 0, minute = 0) {
  return new Date(year, monthIndex, day, hour, minute).getTime();
}
