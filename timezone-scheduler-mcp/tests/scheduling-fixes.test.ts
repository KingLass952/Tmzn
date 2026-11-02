import assert from "node:assert/strict";
import test from "node:test";
import { convertWindow, dateInTimezone, formatPitchTimes } from "../src/index.js";

test("derives calendar dates in the requested timezone", () => {
  assert.equal(dateInTimezone(new Date("2026-11-02T00:30:00Z"), "America/Los_Angeles"), "2026-11-01");
});

test("uses the sender's working hours for both sides when target hours are omitted", () => {
  const result = convertWindow({
    source_timezone: "Africa/Johannesburg",
    target_timezone: "America/Chicago",
    working_hours: "09:00-17:00",
    date: "2026-11-02",
  });

  assert.equal(result.target_working_hours, "09:00-17:00");
  assert.equal(result.overlaps.length, 0);
  assert.equal(result.overlap, null);
});

test("finds the one-hour overlap on March 10, 2026", () => {
  const result = convertWindow({
    source_timezone: "Africa/Johannesburg",
    target_timezone: "America/Chicago",
    working_hours: "09:00-17:00",
    target_working_hours: "09:00-17:00",
    date: "2026-03-10",
  });

  assert.equal(result.overlap?.duration_minutes, 60);
  assert.equal(result.overlaps.length, 1);
});

test("supports overnight source and target hours with a 540-minute overlap", () => {
  const result = convertWindow({
    source_timezone: "Africa/Johannesburg",
    target_timezone: "America/Chicago",
    working_hours: "16:00-02:00",
    target_working_hours: "09:00-19:00",
    date: "2026-11-02",
  });

  assert.equal(result.overlap?.duration_minutes, 540);
  assert.equal(result.overlaps.length, 1);
});

test("finds two separate Johannesburg-to-Auckland overlaps across target dates", () => {
  const result = convertWindow({
    source_timezone: "Africa/Johannesburg",
    target_timezone: "Pacific/Auckland",
    working_hours: "00:00-15:00",
    target_working_hours: "00:00-13:00",
    date: "2026-11-02",
  });

  assert.deepEqual(result.overlaps.map(({ duration_minutes }) => duration_minutes), [120, 120]);
  assert.deepEqual(result.overlaps.map(({ target_date }) => target_date), ["2026-11-02", "2026-11-03"]);
});

test("keeps the longest overlap in the legacy overlap field", () => {
  const result = convertWindow({
    source_timezone: "Africa/Johannesburg",
    target_timezone: "Pacific/Auckland",
    working_hours: "00:00-15:00",
    target_working_hours: "00:00-13:00",
    date: "2026-11-02",
  });

  assert.equal(result.overlap?.duration_minutes, 120);
  assert.equal(result.overlap?.start_utc, result.overlaps[0].start_utc);
});

test("applies min_overlap_minutes to each candidate overlap", () => {
  const result = convertWindow({
    source_timezone: "Africa/Johannesburg",
    target_timezone: "America/Chicago",
    working_hours: "09:00-17:00",
    target_working_hours: "01:00-09:00",
    date: "2026-01-15",
    min_overlap_minutes: 481,
  });

  assert.equal(result.overlaps.length, 0);
  assert.equal(result.overlap, null);
});

test("rejects a nonexistent local time on the requested target date", () => {
  assert.throws(
    () => convertWindow({
      source_timezone: "UTC",
      target_timezone: "America/Chicago",
      working_hours: "00:00-12:00",
      target_working_hours: "02:00-03:00",
      date: "2026-03-08",
    }),
    /Local time does not exist/,
  );
});

test("skips a neighboring target date with a nonexistent daylight-saving time", () => {
  const result = convertWindow({
    source_timezone: "UTC",
    target_timezone: "America/Chicago",
    working_hours: "00:00-12:00",
    target_working_hours: "02:00-03:00",
    date: "2026-03-07",
  });

  assert.deepEqual(result.overlaps.map(({ target_date }) => target_date), ["2026-03-07"]);
});

test("formats client times with weekday and timezone abbreviation", () => {
  const [slot] = formatPitchTimes({
    slots: ["2026-11-05 16:00"],
    source_timezone: "Africa/Johannesburg",
    target_timezone: "America/Chicago",
    duration_minutes: 30,
    hour_format: "12",
  });

  assert.equal(slot.source_local, "Thu, Nov 5, 4:00 PM CAT");
  assert.equal(slot.target_local, "Thu, Nov 5, 8:00 AM CST");
  assert.equal(slot.target_end_local, "Thu, Nov 5, 8:30 AM CST");
});

test("honors 24-hour output in client timezone labels", () => {
  const [slot] = formatPitchTimes({
    slots: ["2026-11-05 16:00"],
    source_timezone: "Africa/Johannesburg",
    target_timezone: "America/Chicago",
    duration_minutes: 30,
    hour_format: "24",
  });

  assert.equal(slot.target_local, "Thu, Nov 5, 08:00 CST");
});