import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPosition } from "../game/animation";
import { isLoungeSeat, walkingDestination } from "../game/live-layout";
import { liveNavigation } from "../game/live-navigation";
import { OfficeTraffic, sweptAgentsOverlap } from "../game/traffic";
import { Simulation, type Agent } from "../game/simulation";
import { advanceOffice, reconcileOffice, type OfficeRoster } from "../src/observation-departures";
import { updateObservationScene } from "../src/observation-movement";
import type { Member } from "../src/observation-layout";

const settled = (agent: Agent) => !agent.arriving && !agent.yielding && !agent.route.length &&
  Math.hypot(agent.x - walkingDestination(agent.target).x, agent.z - walkingDestination(agent.target).z) < 1e-6 &&
  (isLoungeSeat(agent.target) ? agent.seating?.blend === 1 : !agent.seating);

function office(count: number) {
  const scene = new Simulation(), traffic = new OfficeTraffic();
  let roster: OfficeRoster = { members: [], agents: [], departures: [] };
  let current: Member[] = Array.from({ length: count }, (_, i) => ({ id: `review-${i}`, phase: "idle", present: true }));
  const sync = () => {
    const ids = new Set(current.map(member => member.id));
    const presence = Object.fromEntries([...roster.members, ...roster.departures.map(departure => departure.member)]
      .map(member => [member.id, ids.has(member.id)]));
    roster = reconcileOffice(roster, current, presence);
    scene.agents = roster.agents;
    assert.deepEqual(updateObservationScene(scene, roster.members), []);
  };
  sync();
  const tick = (hz: number, frame: number, reduced = false) => {
    const before = new Map(roster.agents.map(agent => [agent, { physical: agentPosition(agent), x: agent.x, z: agent.z }]));
    advanceOffice(roster, traffic, 1 / hz, reduced);
    const visible = roster.agents.filter(agent => agent.x !== 100);
    for (const agent of visible) {
      const old = before.get(agent);
      if (old && old.x !== 100) assert.ok(liveNavigation.segmentClear(old, agent));
    }
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j], pa = agentPosition(a), pb = agentPosition(b);
      const oldA = before.get(a), oldB = before.get(b);
      assert.equal(sweptAgentsOverlap(oldA && oldA.x !== 100 ? oldA.physical : pa, pa,
        oldB && oldB.x !== 100 ? oldB.physical : pb, pb), false,
      `Frame ${frame}: physical overlap ${a.id}/${b.id}: ${JSON.stringify({ pa, pb, a: a.target, b: b.target })}`);
    }
  };
  const finish = (hz = 30, reduced = false) => {
    for (let frame = 0; frame < hz * 360; frame++) {
      if (frame % (hz * 3) === 0) sync();
      tick(hz, frame, reduced);
      if (!roster.departures.length && roster.agents.every(settled)) return frame / hz;
    }
    assert.fail(`Seat transfer did not progress: ${JSON.stringify(roster.agents)}`);
  };
  return { sync, tick, finish, get roster() { return roster; }, get current() { return current; }, set current(next) { current = next; } };
}

test("16 idle agents remain physically separated throughout real-polling compaction after the first disconnect", () => {
  const state = office(16);
  state.finish();
  state.current = state.current.slice(1);
  state.sync();
  state.finish();
});

test("occupied-seat transfers and interrupted sitting remain live and separated at 15/60Hz and reduced motion", () => {
  for (const [hz, reduced] of [[15, false], [60, false], [30, true]] as const) {
    const state = office(8);
    state.finish(hz, reduced);
    state.current = state.current.slice(1);
    state.sync();
    for (let frame = 0; frame < hz * 12; frame++) {
      if (frame % (hz * 3) === 0) state.sync();
      state.tick(hz, frame, reduced);
    }
    state.current = state.current.map((member, i) => ({ ...member, phase: i % 2 ? "idle" : "tool" }));
    state.sync();
    state.finish(hz, reduced);
    state.current = state.current.map(member => ({ ...member, phase: "idle" }));
    state.sync();
    state.finish(hz, reduced);
  }
});
