import assert from "node:assert/strict";
import { test } from "node:test";
import { createOfficeClock, DAY_LENGTH_SECONDS, localDayFraction, previewOfficeClock, sampleDaylight } from "../game/lighting";

test("fresh live clocks use local hours, minutes, seconds and milliseconds, including midnight", () => {
  for (const [hour, minute, second, millisecond] of [[0, 0, 0, 0], [0, 7, 35, 250], [16, 2, 19, 626], [23, 59, 59, 999]]) {
    const now = new Date(2026, 9, 2, hour, minute, second, millisecond);
    const clock = createOfficeClock(now);
    const light = sampleDaylight(clock.simulationSeconds, clock.offset);
    assert.equal(light.label, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    assert.ok(Math.abs(light.time - localDayFraction(now)) < 1e-12);
    assert.equal(clock.previewSteps, 0);
  }
});

test("the same instant initializes from the machine timezone, not UTC or a fixed offset", () => {
  const previous = process.env.TZ;
  try {
    for (const [zone, label] of [
      ["UTC", "00:07"], ["America/St_Johns", "21:37"], ["Asia/Kathmandu", "05:52"], ["Pacific/Kiritimati", "14:07"],
    ]) {
      process.env.TZ = zone;
      const clock = createOfficeClock(new Date("2026-10-03T00:07:35.250Z"));
      assert.equal(sampleDaylight(0, clock.offset).label, label, zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("the decorative day speed is preserved and four six-hour previews reset to a fresh local sample", () => {
  const clock = createOfficeClock(new Date(2026, 9, 2, 23, 45, 30));
  const initial = sampleDaylight(0, clock.offset);
  clock.simulationSeconds = DAY_LENGTH_SECONDS / 24;
  assert.equal(sampleDaylight(clock.simulationSeconds, clock.offset).label, "00:45");
  previewOfficeClock(clock);
  assert.equal(sampleDaylight(clock.simulationSeconds, clock.offset).label, "06:45");
  previewOfficeClock(clock);
  previewOfficeClock(clock);
  const reset = new Date(2026, 9, 3, 0, 8, 17);
  previewOfficeClock(clock, reset);
  assert.equal(clock.previewSteps, 0);
  const light = sampleDaylight(clock.simulationSeconds, clock.offset);
  assert.equal(light.label, "00:08");
  assert.ok(Math.abs(light.time - localDayFraction(reset)) < 1e-12);
  assert.notEqual(light.time, initial.time);
  assert.equal(sampleDaylight(0).label, "08:24", "Unrelated game-mode defaults stay unchanged");
});
