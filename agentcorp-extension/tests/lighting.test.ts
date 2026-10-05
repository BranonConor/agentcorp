import assert from "node:assert/strict";
import { test } from "node:test";
import { createOfficeClock, DAY_LENGTH_SECONDS, localDayFraction, previewOfficeClock, sampleDaylight, sampleOfficeClock } from "../game/lighting";
import { Simulation } from "../game/simulation";

test("fresh live clocks use local hours, minutes, seconds and milliseconds, including midnight", () => {
  for (const [hour, minute, second, millisecond] of [[0, 0, 0, 0], [0, 7, 35, 250], [16, 2, 19, 626], [23, 59, 59, 999]]) {
    const now = new Date(2026, 9, 2, hour, minute, second, millisecond);
    const clock = createOfficeClock();
    const light = sampleOfficeClock(clock, now);
    assert.equal(light.label, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    assert.ok(Math.abs(light.time - localDayFraction(now)) < 1e-12);
    assert.equal(clock.previewSteps, 0);
  }
});

test("the same live clock follows runtime timezone changes instead of caching an offset", () => {
  const previous = process.env.TZ;
  const clock = createOfficeClock();
  try {
    for (const [zone, label] of [
      ["UTC", "00:07"], ["America/St_Johns", "21:37"], ["Asia/Kathmandu", "05:52"], ["Pacific/Kiritimati", "14:07"],
    ]) {
      process.env.TZ = zone;
      assert.equal(sampleOfficeClock(clock, new Date("2026-10-03T00:07:35.250Z")).label, label, zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("simulation frames cannot advance the live clock, and resume/system-clock changes catch up immediately", () => {
  const clock = createOfficeClock(), scene = new Simulation();
  const now = new Date(2026, 9, 2, 16, 37, 12, 250);
  const expected = sampleOfficeClock(clock, now);
  for (const simulationSeconds of [0, 1 / 30, 10, 240, 3_600, 1_000_000]) {
    scene.time = simulationSeconds;
    assert.deepEqual(sampleOfficeClock(clock, now), expected);
  }
  for (const resumed of [
    new Date(2026, 9, 2, 16, 38, 45),
    new Date(2026, 9, 3, 0, 2, 1),
    new Date(2026, 9, 2, 8, 17, 9),
  ]) {
    const light = sampleOfficeClock(clock, resumed);
    assert.equal(light.label, `${String(resumed.getHours()).padStart(2, "0")}:${String(resumed.getMinutes()).padStart(2, "0")}`);
    assert.ok(Math.abs(light.time - localDayFraction(resumed)) < 1e-12);
    assert.equal(scene.time, 1_000_000, "Clock sampling must not alter movement simulation");
  }
});

test("daylight-saving jumps follow local wall time in either direction", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const clock = createOfficeClock();
    for (const [instant, label] of [
      ["2026-03-08T06:59:59Z", "01:59"], ["2026-03-08T07:00:01Z", "03:00"],
      ["2026-11-01T05:59:59Z", "01:59"], ["2026-11-01T06:00:01Z", "01:00"],
    ]) assert.equal(sampleOfficeClock(clock, new Date(instant)).label, label);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("six-hour previews track real time and the fourth preview resets to current local time", () => {
  const clock = createOfficeClock();
  const initial = new Date(2026, 9, 2, 23, 45, 30);
  assert.equal(sampleOfficeClock(clock, initial).label, "23:45");
  previewOfficeClock(clock);
  assert.equal(sampleOfficeClock(clock, initial).label, "05:45");
  const later = new Date(2026, 9, 3, 0, 8, 17);
  assert.equal(sampleOfficeClock(clock, later).label, "06:08");
  previewOfficeClock(clock);
  assert.equal(sampleOfficeClock(clock, later).label, "12:08");
  previewOfficeClock(clock);
  assert.equal(sampleOfficeClock(clock, later).label, "18:08");
  previewOfficeClock(clock);
  assert.equal(clock.previewSteps, 0);
  const light = sampleOfficeClock(clock, later);
  assert.equal(light.label, "00:08");
  assert.ok(Math.abs(light.time - localDayFraction(later)) < 1e-12);
});

test("legacy demo lighting retains its independent accelerated day", () => {
  assert.equal(sampleDaylight(0).label, "08:24", "Unrelated game-mode defaults stay unchanged");
  assert.equal(sampleDaylight(DAY_LENGTH_SECONDS / 24).label, "09:24");
  assert.equal(sampleDaylight(DAY_LENGTH_SECONDS).label, "08:24");
});
