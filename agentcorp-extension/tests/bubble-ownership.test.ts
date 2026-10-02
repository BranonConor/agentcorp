import assert from "node:assert/strict";
import { test } from "node:test";
import { LIVE_DESKS } from "../game/live-layout";
import { OfficeTraffic } from "../game/traffic";
import { Simulation } from "../game/simulation";
import { assertFreshObservation, newAgent, type Member } from "../src/observation-layout";
import { advanceDepartures, advanceOffice, reconcileOffice, type OfficeRoster } from "../src/observation-departures";
import { updateObservationScene } from "../src/observation-movement";
import { bubbleBelongsToRoster, bubbleMatchesView, StatusBubbles } from "../src/status-bubbles";

const member = (id: string, phase: Member["phase"] = "tool"): Member => ({ id, phase, present: true });
const settled = (ids: string[]): OfficeRoster => ({
  members: ids.map(id => member(id)), departures: [],
  agents: ids.map((_, index) => ({ ...newAgent(index), ...LIVE_DESKS[index], target: { ...LIVE_DESKS[index] }, arriving: false })),
});
function update(roster: OfficeRoster) {
  const scene = new Simulation();
  scene.agents = roster.agents;
  assert.deepEqual(updateObservationScene(scene, roster.members), []);
}

test("continuously connected agents never receive farewell text during desk/lounge retargets or slot compaction", () => {
  let roster = settled(["one", "two"]);
  const bubbles = new StatusBubbles(), traffic = new OfficeTraffic();
  for (const phase of ["idle", "tool", "idle", "thinking"] as const) {
    roster = reconcileOffice(roster, [member("one", phase), member("two", phase)], { one: true, two: true });
    update(roster);
    for (let frame = 0; frame < 150; frame++) {
      advanceOffice(roster, traffic, 1 / 30);
      assert.ok(bubbles.update(roster, frame / 30).every(bubble => !bubble.farewell));
    }
  }
  roster = reconcileOffice(roster, [member("two")], { one: true, two: true });
  update(roster);
  assert.deepEqual(roster.departures, [], "Overflow displacement is not disconnection");
  assert.ok(bubbles.update(roster, 20).every(bubble => bubble.id === "two" && !bubble.farewell));
});

test("reconnect immediately invalidates a cached farewell even at the same slot, without erasing waiting status", () => {
  let roster = settled(["leaving", "waiting"]);
  roster.members[1].phase = "blocked";
  const bubbles = new StatusBubbles();
  bubbles.update(roster, 0); bubbles.update(roster, 1);
  roster = reconcileOffice(roster, [member("waiting", "blocked")], { leaving: false, waiting: true });
  roster = reconcileOffice(roster, [member("waiting", "blocked")], { leaving: false, waiting: true });
  advanceDepartures(roster, 4);
  const cached = bubbles.update(roster, 5);
  const farewell = cached.find(bubble => bubble.kind === "departure")!;
  assert.equal(farewell.text, "Have a nice day!");
  assert.ok(bubbleBelongsToRoster(farewell, roster));
  const view = { id: farewell.id, kind: farewell.kind, text: farewell.text };
  roster = reconcileOffice(roster, [member("waiting", "blocked"), member("leaving", "blocked")], { leaving: true, waiting: true });
  update(roster);
  assert.deepEqual(roster.departures, []);
  assert.equal(bubbleMatchesView(farewell, roster, view), false, "A paused renderer must hide the cached goodbye immediately");
  const current = bubbles.update(roster, 5);
  assert.ok(current.some(bubble => bubble.id === "waiting" && bubble.text === "Waiting for you"));
  assert.ok(current.every(bubble => bubble.kind !== "departure"));
  const replaced = bubbles.update(roster, 6).find(bubble => bubble.id === "leaving")!;
  assert.equal(replaced.text, "Waiting for you");
  assert.equal(bubbleMatchesView(replaced, roster, view), false, "Do not unhide old DOM text before React commits its replacement");
});

test("a recycled avatar slot cannot inherit a different session's farewell", () => {
  let roster = settled(["old"]);
  roster = reconcileOffice(roster, [], { old: false });
  roster = reconcileOffice(roster, [], { old: false });
  advanceDepartures(roster, 4);
  const farewell = new StatusBubbles().update(roster, 4)[0];
  assert.equal(farewell.index, 0);
  const newRoster = settled(["new"]);
  assert.equal(bubbleBelongsToRoster(farewell, newRoster), false);
});

test("late snapshots and a single missing observation cannot initiate goodbye; a fresh repeat can", () => {
  let roster = settled(["one"]);
  const original = structuredClone(roster);
  assert.throws(() => {
    assertFreshObservation(100, 4_000);
    roster = reconcileOffice(roster, [], { one: false });
  }, /arrived too late/);
  assert.deepEqual(roster, original);
  assertFreshObservation(100, 3_100);
  roster = reconcileOffice(roster, [], { one: false });
  advanceDepartures(roster, 10);
  const bubbles = new StatusBubbles();
  assert.deepEqual(bubbles.update(roster, 10), []);
  assert.equal(roster.departures[0].farewellLeft, 1.8);
  // Reconnection during the wait cancels quietly, even if the next poll had been delayed.
  roster = reconcileOffice(roster, [member("one")], { one: true });
  assert.deepEqual(roster.departures, []);
  roster = reconcileOffice(roster, [], { one: false });
  roster = reconcileOffice(roster, [], { one: false });
  advanceDepartures(roster, 4);
  assert.equal(bubbles.update(roster, 14)[0].text, "Have a nice day!");
});

test("Hello is emitted once at first actual entry, not in the queue or on return/polls/retargets", () => {
  let roster = reconcileOffice({ members: [], agents: [], departures: [] }, [member("one")], undefined);
  update(roster);
  const bubbles = new StatusBubbles(), traffic = new OfficeTraffic();
  assert.deepEqual(bubbles.update(roster, 0), []);
  advanceOffice(roster, traffic, 1 / 30);
  const hello = bubbles.update(roster, 0.1)[0];
  assert.equal(hello.text, "Hello!");
  assert.equal(hello.kind, "arrival");
  const anchor = { ...hello.anchor };
  roster = reconcileOffice(roster, [member("one", "thinking")], { one: true });
  update(roster);
  advanceOffice(roster, traffic, 1 / 30);
  assert.deepEqual(bubbles.update(roster, 1)[0].anchor, anchor, "Reduced-motion greeting uses the fixed entrance anchor");
  assert.ok(bubbles.update(roster, 3).every(bubble => bubble.kind !== "arrival"));
  roster = reconcileOffice(roster, [], { one: false });
  assert.deepEqual(bubbles.update(roster, 3.1), []);
  roster = reconcileOffice(roster, [member("one")], { one: true });
  update(roster);
  assert.ok(bubbles.update(roster, 3.2).every(bubble => bubble.kind !== "arrival"));
  bubbles.update({ members: [], agents: [], departures: [] }, 10);
  roster = reconcileOffice({ members: [], agents: [], departures: [] }, [member("one")], undefined);
  update(roster); advanceOffice(roster, new OfficeTraffic(), 1 / 30);
  assert.ok(bubbles.update(roster, 11).every(bubble => bubble.kind !== "arrival"), "View-lifetime greeting history survives completed removal");
});

test("hidden greetings are consumed, blocking status has priority, and actual departure owns the goodbye", () => {
  let roster = reconcileOffice({ members: [], agents: [], departures: [] }, [member("one")], undefined);
  update(roster); advanceOffice(roster, new OfficeTraffic(), 1 / 30);
  const bubbles = new StatusBubbles();
  assert.deepEqual(bubbles.update(roster, 0, false), []);
  assert.deepEqual(bubbles.update(roster, 3, true), []);
  roster.members[0].phase = "blocked";
  bubbles.update(roster, 4);
  assert.equal(bubbles.update(roster, 5)[0].text, "Waiting for you");
  roster = reconcileOffice(roster, [], { one: false });
  roster = reconcileOffice(roster, [], { one: false });
  advanceDepartures(roster, 4);
  assert.equal(bubbles.update(roster, 9)[0].kind, "departure");
});
