import assert from "node:assert/strict";
import { test } from "node:test";
import { StatusBubbles } from "../src/status-bubbles";
import { newAgent } from "../src/observation-layout";
import { reconcileOffice, advanceDepartures, advanceOffice, type OfficeRoster } from "../src/observation-departures";
import { parsePreferences, reducedMotion } from "../src/motion-preference";
import { OfficeTraffic } from "../game/traffic";

function roster(): OfficeRoster {
  return { members: [{ id: "one", phase: "idle", present: true }],
    agents: [{ ...newAgent(0), x: -2, z: -2.5, target: { x: -2, z: -2.5 }, arriving: false }], departures: [] };
}

test("status messages use only real phases, debounce changes and do not repeat unchanged polls", () => {
  const office = roster(), status = new StatusBubbles();
  assert.deepEqual(status.update(office, 0), []);
  office.members[0].phase = "tool";
  assert.deepEqual(status.update(office, 1), []);
  assert.deepEqual(status.update(office, 1.4), []);
  assert.equal(status.update(office, 1.6)[0].text, "Using a tool");
  assert.deepEqual(status.update(office, 6), []);
  assert.deepEqual(status.update(office, 600), []);
  office.members[0].phase = "thinking";
  assert.deepEqual(status.update(office, 601), []);
  assert.equal(status.update(office, 602)[0].text, "Working...");
  office.members[0].phase = "idle";
  assert.deepEqual(status.update(office, 603), []);
  assert.deepEqual(status.update(office, 604), []);
  assert.equal(status.update(office, 610)[0].text, "Ready");
});

test("waiting-for-user bypasses cooldown, remains visible, and farewell wins over status", () => {
  let office = roster();
  const status = new StatusBubbles();
  status.update(office, 0);
  office.members[0].phase = "tool"; status.update(office, 1); status.update(office, 2);
  office.members[0].phase = "blocked"; status.update(office, 2.1);
  assert.equal(status.update(office, 2.7)[0].text, "Waiting for you");
  assert.equal(status.update(office, 100)[0].text, "Waiting for you");
  office = reconcileOffice(office, [], { one: false });
  assert.deepEqual(status.update(office, 101), [], "Grace must not show a farewell");
  office = reconcileOffice(office, [], { one: false });
  advanceDepartures(office, 4);
  const bubbles = status.update(office, 105);
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].text, "Have a nice day!");
  assert.equal(bubbles[0].farewell, true);
  office = reconcileOffice(office, [{ id: "one", phase: "blocked", present: true }], { one: true });
  assert.equal(status.update(office, 106)[0].text, "Waiting for you");
});

test("arrivals suppress routine chatter, blocked arrivals remain useful, and bubble origins are retained", () => {
  const office = roster(), status = new StatusBubbles();
  office.agents[0].arriving = true;
  status.update(office, 0);
  office.members[0].phase = "tool"; status.update(office, 1);
  assert.equal(status.update(office, 2)[0].text, "Hello!");
  assert.deepEqual(status.update(office, 2.6), []);
  office.members[0].phase = "blocked"; status.update(office, 3);
  const bubble = status.update(office, 4)[0];
  assert.equal(bubble.text, "Waiting for you");
  const anchor = { ...bubble.anchor };
  office.agents[0].x += 1;
  assert.deepEqual(status.update(office, 5)[0].anchor, anchor);
  office.agents[0].x = 100;
  assert.deepEqual(status.update(office, 6), []);
});

test("motion defaults follow the OS and explicit overrides win in both directions", () => {
  assert.equal(reducedMotion("system", true), true);
  assert.equal(reducedMotion("system", false), false);
  assert.equal(reducedMotion("full", true), false);
  assert.equal(reducedMotion("reduced", false), true);
  assert.deepEqual(parsePreferences({ motion: "reduced", autoOpen: true }), { motion: "reduced", autoOpen: true, chatBubbles: true });
  assert.deepEqual(parsePreferences({ motion: "full", autoOpen: false, theme: "dark", chatBubbles: false }),
    { motion: "full", autoOpen: false, theme: "dark", chatBubbles: false });
  for (const value of [null, {}, { motion: "fast", autoOpen: true }, { motion: "system", autoOpen: "yes" },
    { motion: "system", autoOpen: true, chatBubbles: "false" }, { motion: "system", autoOpen: true, theme: "blue" }]) {
    assert.throws(() => parsePreferences(value), /Invalid saved office preferences/);
  }
});

test("disabled bubbles still consume transitions without replaying a backlog when re-enabled", () => {
  const office = roster(), status = new StatusBubbles();
  status.update(office, 0, false);
  office.members[0].phase = "tool"; status.update(office, 1, false);
  assert.deepEqual(status.update(office, 2, false), []);
  assert.deepEqual(status.update(office, 10, true), []);
  office.members[0].phase = "blocked"; status.update(office, 11, false);
  assert.deepEqual(status.update(office, 12, false), []);
  assert.equal(status.update(office, 13, true)[0].text, "Waiting for you");
});

test("hiding chat bubbles never skips reconnect grace, farewell dwell, routing or removal", () => {
  let visible = reconcileOffice(roster(), [], { one: false });
  visible = reconcileOffice(visible, [], { one: false });
  const hidden = structuredClone(visible);
  const traffic = [new OfficeTraffic(), new OfficeTraffic()];
  const statuses = [new StatusBubbles(), new StatusBubbles()];
  let farewellShown = false;
  let finishedAt = 0;
  for (let frame = 0; frame < 2000; frame++) {
    const now = frame / 30;
    advanceOffice(visible, traffic[0], 1 / 30);
    advanceOffice(hidden, traffic[1], 1 / 30);
    farewellShown ||= statuses[0].update(visible, now, true).some(bubble => bubble.farewell);
    assert.deepEqual(statuses[1].update(hidden, now, false), []);
    assert.deepEqual(hidden, visible);
    if (!hidden.agents.length) { finishedAt = now; break; }
  }
  assert.ok(farewellShown);
  assert.ok(finishedAt > 5.8);
  assert.deepEqual(hidden.agents, []);
});
