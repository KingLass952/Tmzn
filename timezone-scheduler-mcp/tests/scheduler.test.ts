import assert from "node:assert/strict";
import test from "node:test";
import { convertWindow, formatPitchTimes } from "../src/index.js";

test("calculates working-hour overlap using the selected date's timezone offsets", () => {
  const result = convertWindow({
    source_timezone: "Africa/Johannesburg",
    target_timezone: "America/Chicago",
    working_hours: "09:00-17:00",
    target_working_hours: "01:00-09:00",
    date: "2026-01-15",
    min_overlap_minutes: 60,
  });

  assert.equal(result.overlap?.duration_minutes, 480);
  assert.equal(result.overlap?.source_local, "Jan 15, 2026, 9:00 AM – Jan 15, 2026, 5:00 PM");
  assert.equal(result.overlap?.target_local, "Jan 15, 2026, 1:00 AM – Jan 15, 2026, 9:00 AM");
});

test("uses daylight saving offsets for summer dates", () => {
  const result = convertWindow({
    source_timezone: "Africa/Johannesburg",
    target_timezone: "America/Chicago",
    working_hours: "09:00-17:00",
    target_working_hours: "02:00-10:00",
    date: "2026-07-15",
    min_overlap_minutes: 30,
  });

  assert.equal(result.overlap?.duration_minutes, 480);
  assert.match(result.overlap?.target_local ?? "", /2:00 AM/);
});

test("formats client slots with Johannesburg time alongside them", () => {
  const [slot] = formatPitchTimes({
    slots: ["2026-01-15 16:00"],
    source_timezone: "Africa/Johannesburg",
    target_timezone: "America/Chicago",
    duration_minutes: 30,
    hour_format: "12",
  });

  assert.match(slot.source_local, /4:00 PM \(CAT\)/);
  assert.match(slot.target_local, /8:00 AM/);
  assert.match(slot.target_end_local, /8:30 AM/);
});