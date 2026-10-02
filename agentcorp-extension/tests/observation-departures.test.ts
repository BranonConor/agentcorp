import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PRESENCE_IDS } from "../../.github/extensions/agentcorp-extension/observations.mjs";
import { agentPosition } from "../game/animation";
import { LIVE_AGENT_CLEARANCE, isLoungeSeat, walkingDestination } from "../game/live-layout";
import { LIVE_OBSTACLES, LIVE_WALK_BOUNDS, liveNavigation } from "../game/live-navigation";
import { createNavigation } from "../game/navigation";
import { Simulation, type Point } from "../game/simulation";
import {
  FAREWELL_SECONDS, RECONNECT_GRACE_SECONDS, LIVE_EXITS, MAX_TRACKED_AGENTS, advanceDepartures, reconcileOffice, type OfficeRoster,
} from "../src/observation-departures";
import type { Member, Phase } from "../src/observation-layout";
import { moveObservationScene, updateObservationScene } from "../src/observation-movement";

const member = (id: string, phase: Phase = "idle"): Member => ({ id, phase, present: true });
const empty = (): OfficeRoster => ({ members: [], agents: [], departures: [] });
const sync = (scene: Simulation, roster: OfficeRoster) => {
  scene.agents = roster.agents;
  assert.deepEqual(updateObservationScene(scene, roster.members), []);
  // Settled fixtures isolate departure behavior; traffic tests exercise real arrivals.
  roster.agents.filter(agent => agent.x === 100).forEach(agent => {
    Object.assign(agent, walkingDestination(agent.target));
    agent.arriving = false;
    if (isLoungeSeat(agent.target)) agent.seating = { position: { ...agent.target }, blend: 1 };
  });
};
const position = (point: Point) => ({ x: point.x, z: point.z });
const presenceFor = (roster: OfficeRoster, present: string[] = []) => Object.fromEntries(
  [...roster.members, ...roster.departures.map(departure => departure.member)]
    .map(({ id }) => [id, present.includes(id)]),
);

test("initial load never invents departures; absence waits for a successful explicit presence result", () => {
  const roster = reconcileOffice(empty(), [member("first")], undefined);
  assert.deepEqual(roster.departures, []);
  const original = structuredClone(roster);
  assert.throws(() => reconcileOffice(roster, [], undefined), /Missing session presence/);
  assert.throws(() => reconcileOffice(roster, [], {}), /Missing session presence/);
  assert.deepEqual(roster, original);
  assert.equal(reconcileOffice(empty(), [], undefined).departures.length, 0);
});

test("disconnected agents farewell once, traverse safe exits and are removed without counting as connected", () => {
  const scene = new Simulation();
  const initial = Array.from({ length: 16 }, (_, index) => member(`session-${index}`));
  let roster = reconcileOffice(empty(), initial, undefined);
  sync(scene, roster);
  const originalPositions = roster.agents.map(agentPosition);
  roster = reconcileOffice(roster, [], presenceFor(roster));
  sync(scene, roster);
  assert.equal(scene.progress.capacity, 0);
  assert.equal(roster.members.length, 0);
  assert.equal(roster.departures.length, 16);
  assert.deepEqual(roster.agents.map(agentPosition), originalPositions);
  for (const departure of roster.departures) {
    assert.match(departure.phrase, /^(Have a nice day!|See you later!)$/);
    assert.equal(departure.agent.navigationBlocked, false);
    let previous: Point = departure.agent;
    for (const waypoint of departure.agent.route) {
      assert.ok(liveNavigation.segmentClear(previous, waypoint));
      previous = waypoint;
    }
    assert.ok(LIVE_EXITS.some(exit => exit.x === previous.x && exit.z === previous.z));
  }
  assert.equal(advanceDepartures(roster, RECONNECT_GRACE_SECONDS), true);
  assert.equal(advanceDepartures(roster, FAREWELL_SECONDS / 2), false);
  roster = reconcileOffice(roster, [], presenceFor(roster));
  assert.equal(roster.departures.length, 16);
  assert.equal(roster.departures[0].farewellLeft, FAREWELL_SECONDS / 2);
  assert.deepEqual(roster.agents.map(agentPosition), originalPositions);
  let removed = 0;
  for (let frame = 0; frame < 1800 && roster.departures.length; frame++) {
    const before = new Map(roster.departures.map(departure => [departure.member.id, position(departure.agent)]));
    const count = roster.departures.length;
    const finished = [...roster.departures];
    advanceDepartures(roster, 1 / 30);
    for (const departure of finished) {
      assert.ok(liveNavigation.segmentClear(before.get(departure.member.id)!, departure.agent));
      if (!roster.departures.includes(departure)) {
        assert.ok(LIVE_EXITS.some(exit => exit.x === departure.agent.x && exit.z === departure.agent.z));
        assert.equal(departure.agent.seating, undefined);
      }
    }
    removed += count - roster.departures.length;
    scene.agents = roster.agents;
    assert.equal(scene.progress.capacity, 0);
  }
  assert.equal(removed, 16);
  assert.deepEqual(roster.agents, []);
  assert.deepEqual(reconcileOffice(roster, [], {}).departures, []);
});

test("overflow-displaced live agents do not farewell, but true disconnects with overflow do", () => {
  const scene = new Simulation();
  let roster = reconcileOffice(empty(), [member("displaced"), member("disconnected")], undefined);
  sync(scene, roster);
  const incoming = Array.from({ length: 16 }, (_, index) => member(`busy-${index}`, "tool"));
  roster = reconcileOffice(roster, incoming, { displaced: true, disconnected: false });
  sync(scene, roster);
  assert.equal(roster.members.length, 16);
  assert.deepEqual(roster.departures.map(departure => departure.member.id), ["disconnected"]);
  assert.equal(scene.progress.capacity, 16);
  assert.equal(roster.agents.length, 17);
  const fresh = reconcileOffice(roster, incoming, presenceFor(roster, incoming.map(({ id }) => id)));
  assert.equal(fresh.departures.length, 1);
});

test("reconnection during farewell, standing or exit walking cancels departure without losing position or identity", () => {
  for (const ticks of [0, 177, 195]) {
    const scene = new Simulation();
    const incoming = Array.from({ length: 6 }, (_, index) => member(`session-${index}`));
    let roster = reconcileOffice(empty(), incoming, undefined);
    sync(scene, roster);
    const original = roster.agents[4];
    const remaining = incoming.filter(({ id }) => id !== "session-4");
    roster = reconcileOffice(roster, remaining, presenceFor(roster, remaining.map(({ id }) => id)));
    sync(scene, roster);
    for (let frame = 0; frame < ticks; frame++) advanceDepartures(roster, 1 / 30);
    const current = agentPosition(original);
    const logical = position(original);
    assert.equal(roster.departures.length, 1);
    roster = reconcileOffice(roster, incoming, presenceFor(roster, incoming.map(({ id }) => id)));
    sync(scene, roster);
    assert.deepEqual(roster.departures, []);
    const recovered = roster.agents[roster.members.findIndex(({ id }) => id === "session-4")];
    assert.strictEqual(recovered, original);
    assert.deepEqual(agentPosition(recovered), current);
    assert.deepEqual(position(recovered), logical);
    for (let frame = 0; frame < 1200; frame++) moveObservationScene(scene, 1 / 30);
    assert.equal(recovered.state, "idle");
    assert.equal(recovered.seating?.blend, 1);
  }
});

test("an overflowed reconnection cancels the departing avatar without occupying a desk", () => {
  const scene = new Simulation();
  let roster = reconcileOffice(empty(), [member("returning")], undefined);
  sync(scene, roster);
  roster = reconcileOffice(roster, [], { returning: false });
  roster = reconcileOffice(roster, [], { returning: true });
  assert.deepEqual(roster.departures, []);
  assert.deepEqual(roster.agents, []);
  assert.deepEqual(roster.members, []);
});

test("departures try the other exit when necessary and stop/report rather than crossing a blocked exit", () => {
  const scene = new Simulation();
  let roster = reconcileOffice(empty(), [member("leaving")], undefined);
  sync(scene, roster);
  const closedRight = createNavigation([...LIVE_OBSTACLES, {
    id: "closed-right-exit", minX: 8, maxX: 10, minZ: 6.2, maxZ: 8,
  }], LIVE_WALK_BOUNDS, LIVE_AGENT_CLEARANCE);
  roster = reconcileOffice(roster, [], { leaving: false }, closedRight);
  assert.deepEqual(roster.departures[0].agent.target, LIVE_EXITS[0]);
  const blocked = createNavigation([...LIVE_OBSTACLES, {
    id: "closed-exits", minX: -10, maxX: 10, minZ: 6.2, maxZ: 8,
  }], LIVE_WALK_BOUNDS, LIVE_AGENT_CLEARANCE);
  roster = reconcileOffice(roster, [], { leaving: false }, blocked);
  const departure = roster.departures[0];
  assert.equal(departure.agent.navigationBlocked, true);
  const current = position(departure.agent);
  for (let i = 0; i < 1000; i++) advanceDepartures(roster, 1 / 30);
  assert.equal(roster.departures.length, 1);
  assert.deepEqual(position(departure.agent), current);
  roster = reconcileOffice(roster, [], { leaving: false });
  assert.equal(roster.departures[0].agent.navigationBlocked, false);
});

test("tracked identities stay within the presence API bound without dropping departures silently", () => {
  assert.equal(MAX_TRACKED_AGENTS, MAX_PRESENCE_IDS);
  const scene = new Simulation();
  let roster = empty();
  for (let batch = 0; batch < 4; batch++) {
    const incoming = Array.from({ length: 16 }, (_, i) => member(`batch-${batch}-${i}`));
    roster = reconcileOffice(roster, incoming, presenceFor(roster));
    sync(scene, roster);
  }
  assert.equal(roster.agents.length, 64);
  assert.throws(() => reconcileOffice(roster, [member("overflow")], presenceFor(roster)), /Too many departing agents/);
  assert.equal(roster.agents.length, 64);
});
