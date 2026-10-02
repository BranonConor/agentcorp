import assert from "node:assert/strict";
import { test } from "node:test";
import { OfficeTraffic, OFFICE_ENTRANCES, sweptAgentsOverlap } from "../game/traffic";
import { liveNavigation } from "../game/live-navigation";
import { LIVE_DESKS, walkingDestination } from "../game/live-layout";
import { agentPosition, interpolatePosition } from "../game/animation";
import { Simulation, type Agent, type Point } from "../game/simulation";
import { newAgent, type Member } from "../src/observation-layout";
import { advanceOffice, reconcileOffice, RECONNECT_GRACE_SECONDS, type OfficeRoster } from "../src/observation-departures";
import { moveObservationAgent, updateObservationScene } from "../src/observation-movement";

const point = ({ x, z }: Point): Point => ({ x, z });
const settled = (agent: Agent) => !agent.arriving && !agent.yielding && !agent.route.length &&
  Math.hypot(agent.x - walkingDestination(agent.target).x, agent.z - walkingDestination(agent.target).z) < 1e-6;
function checkStep(agents: readonly Agent[], before: Map<Agent, Point>, physical = before) {
  const visible = agents.filter(agent => agent.x !== 100);
  for (const agent of visible) {
    const from = before.get(agent);
    if (from && from.x !== 100) {
      assert.ok(liveNavigation.segmentClear(from, agent), `Furniture collision for ${agent.id}`);
      for (const alpha of [0.25, 0.5, 0.75]) assert.ok(liveNavigation.isWalkable(interpolatePosition(from, agent, alpha)));
    } else assert.ok(OFFICE_ENTRANCES.some(entrance => Math.hypot(agent.x - entrance.x, agent.z - entrance.z) < 0.1));
  }
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i], b = visible[j];
    const oldA = physical.get(a), oldB = physical.get(b);
    const nowA = agentPosition(a), nowB = agentPosition(b);
    assert.equal(sweptAgentsOverlap(oldA && oldA.x !== 100 ? oldA : nowA, nowA, oldB && oldB.x !== 100 ? oldB : nowB, nowB), false,
      `Swept collision: ${a.id} and ${b.id}`);
  }
}

function run(agents: Agent[], traffic = new OfficeTraffic(), seconds = 150) {
  let waited = false;
  for (let frame = 0; frame < seconds * 30; frame++) {
    const before = new Map(agents.map(agent => [agent, point(agent)]));
    const physical = new Map(agents.map(agent => [agent, agentPosition(agent)]));
    traffic.step(agents, 1 / 30);
    checkStep(agents, before, physical);
    waited ||= agents.some(agent => agent.yielding);
    if (agents.every(settled)) return { waited, seconds: frame / 30 };
  }
  assert.fail(`Traffic did not progress: ${JSON.stringify(agents.map(agent => ({
    id: agent.id, ...point(agent), target: agent.target, yielding: agent.yielding, arriving: agent.arriving,
  })))}`);
}

function walker(id: number, from: Point, to: Point): Agent {
  const route = liveNavigation.route(from, to);
  assert.ok(route);
  return { ...newAgent(id), ...from, arriving: false, target: to, route };
}

test("opposing agents swap destinations via a pull-over instead of mutual-wait deadlock", () => {
  const left = { x: -2, z: -2.5 }, right = { x: 2, z: -2.5 };
  const agents = [walker(0, left, right), walker(1, right, left)];
  const result = run(agents, undefined, 40);
  assert.equal(result.waited, true);
  assert.deepEqual(point(agents[0]), right);
  assert.deepEqual(point(agents[1]), left);
});

test("crossing traffic reserves swept paths and both agents eventually arrive", () => {
  const agents = [
    walker(0, { x: -2, z: -2.5 }, { x: 2, z: -2.5 }),
    walker(1, { x: 0, z: -3.5 }, { x: 0, z: -1.5 }),
  ];
  assert.equal(run(agents, undefined, 40).waited, true);
});

test("opposing agents in a furnished desk aisle make progress at low and high frame rates", () => {
  for (const hz of [15, 60]) {
    const agents = [walker(0, LIVE_DESKS[4], LIVE_DESKS[6]), walker(1, LIVE_DESKS[6], LIVE_DESKS[4])];
    const traffic = new OfficeTraffic();
    for (let frame = 0; frame < hz * 90 && !agents.every(settled); frame++) {
      const before = new Map(agents.map(agent => [agent, point(agent)]));
      traffic.step(agents, 1 / hz);
      checkStep(agents, before);
    }
    assert.ok(agents.every(settled), `${hz}Hz desk-aisle swap did not complete`);
  }
});

test("sixteen real simultaneous arrivals use both entrances and queue without overlapping", () => {
  const scene = new Simulation();
  scene.agents = LIVE_DESKS.map((_, id) => newAgent(id));
  const members: Member[] = scene.agents.map((agent, i) => ({ id: `member-${i}`, phase: "tool", present: true }));
  updateObservationScene(scene, members);
  assert.ok(scene.agents.every(agent => agent.x === 100));
  const traffic = new OfficeTraffic();
  const before = new Map(scene.agents.map(agent => [agent, point(agent)]));
  assert.equal(traffic.step(scene.agents, 1 / 30), true);
  checkStep(scene.agents, before);
  assert.equal(scene.agents.filter(agent => agent.x !== 100).length, 2);
  assert.ok(scene.agents.some(agent => agent.x < 0));
  assert.ok(scene.agents.some(agent => agent.x > 0 && agent.x !== 100));
  run(scene.agents, traffic);
  const positions = scene.agents.map(point);
  updateObservationScene(scene, members);
  assert.deepEqual(scene.agents.map(point), positions, "Stable polls must not replay entrances");
  assert.ok(scene.agents.every(agent => !agent.arriving));
  updateObservationScene(scene, members.map(member => ({ ...member, phase: "idle" })));
  run(scene.agents, traffic);
});

test("phase changes and disconnect/reconnect during an arrival preserve one avatar and current position", () => {
  const scene = new Simulation();
  let roster: OfficeRoster = reconcileOffice({ members: [], agents: [], departures: [] },
    [{ id: "arriving", phase: "tool", present: true }], undefined);
  scene.agents = roster.agents; updateObservationScene(scene, roster.members);
  const traffic = new OfficeTraffic();
  for (let i = 0; i < 20; i++) advanceOffice(roster, traffic, 1 / 30);
  const original = roster.agents[0], previous = point(original);
  roster = reconcileOffice(roster, [{ id: "arriving", phase: "idle", present: true }], { arriving: true });
  scene.agents = roster.agents; updateObservationScene(scene, roster.members);
  assert.deepEqual(point(original), previous);
  roster = reconcileOffice(roster, [], { arriving: false });
  assert.equal(roster.departures[0].graceLeft, RECONNECT_GRACE_SECONDS);
  for (let i = 0; i < 90; i++) advanceOffice(roster, traffic, 1 / 30);
  assert.deepEqual(point(original), previous);
  roster = reconcileOffice(roster, [{ id: "arriving", phase: "tool", present: true }], { arriving: true });
  scene.agents = roster.agents; updateObservationScene(scene, roster.members);
  assert.deepEqual(roster.departures, []);
  assert.strictEqual(roster.agents[0], original);
  run(roster.agents, traffic);
});

test("unshown queued arrivals disappear quietly; admitted arrivals complete grace/farewell/exit", () => {
  const scene = new Simulation();
  let roster = reconcileOffice({ members: [], agents: [], departures: [] },
    [0, 1, 2].map(i => ({ id: `arrival-${i}`, phase: "tool", present: true })), undefined);
  scene.agents = roster.agents; updateObservationScene(scene, roster.members);
  const traffic = new OfficeTraffic();
  advanceOffice(roster, traffic, 1 / 30);
  roster = reconcileOffice(roster, [], { "arrival-0": false, "arrival-1": false, "arrival-2": false });
  assert.equal(roster.departures.length, 2);
  for (let i = 0; i < 900 && roster.departures.length; i++) {
    const before = new Map(roster.agents.map(agent => [agent, point(agent)]));
    advanceOffice(roster, traffic, 1 / 30);
    checkStep(roster.agents, before);
  }
  assert.deepEqual(roster.agents, []);
});

test("acceleration, braking and heading use elapsed time at 15/30/60Hz without smoothing through corners", () => {
  const destination = { x: 2, z: -2.5 };
  const endpoints: Point[] = [];
  for (const hz of [15, 30, 60]) {
    const agent = walker(0, { x: -2, z: -2.5 }, destination);
    agent.heading = Math.PI;
    let previousSpeed = 0;
    for (let frame = 0; frame < hz; frame++) {
      const previous = point(agent);
      moveObservationAgent(agent, 1 / hz);
      assert.ok(liveNavigation.segmentClear(previous, agent));
      assert.ok((agent.velocity ?? 0) - previousSpeed <= 3 / hz + 1e-9);
      previousSpeed = agent.velocity ?? 0;
    }
    endpoints.push(point(agent));
    assert.ok(Math.abs(Math.sin(agent.heading!) - 1) < 0.01);
    for (let frame = 0; frame < hz * 10; frame++) moveObservationAgent(agent, 1 / hz);
    assert.deepEqual(point(agent), destination);
    assert.equal(agent.velocity, 0);
  }
  assert.ok(Math.max(...endpoints.map(p => p.x)) - Math.min(...endpoints.map(p => p.x)) < 0.09);
});

test("toggling reduced motion mid-travel, sitting and departure never strands the lifecycle", () => {
  const scene = new Simulation();
  let roster = reconcileOffice({ members: [], agents: [], departures: [] },
    Array.from({ length: 6 }, (_, i) => ({ id: `motion-${i}`, phase: "idle", present: true })), undefined);
  scene.agents = roster.agents; updateObservationScene(scene, roster.members);
  const traffic = new OfficeTraffic();
  for (let i = 0; i < 3000 && !roster.agents.every(settled); i++) {
    const before = new Map(roster.agents.map(agent => [agent, point(agent)]));
    const physical = new Map(roster.agents.map(agent => [agent, agentPosition(agent)]));
    advanceOffice(roster, traffic, 1 / 30, i % 90 < 45);
    checkStep(roster.agents, before, physical);
  }
  assert.ok(roster.agents.every(settled));
  for (let i = 0; i < 20; i++) advanceOffice(roster, traffic, 1 / 30, true);
  assert.deepEqual(agentPosition(roster.agents[4]), roster.agents[4].target);
  roster = reconcileOffice(roster, [], Object.fromEntries(roster.members.map(member => [member.id, false])));
  for (let i = 0; i < 3000 && roster.agents.length; i++) {
    const before = new Map(roster.agents.map(agent => [agent, point(agent)]));
    const physical = new Map(roster.agents.map(agent => [agent, agentPosition(agent)]));
    advanceOffice(roster, traffic, 1 / 30, i % 90 < 45);
    checkStep(roster.agents, before, physical);
  }
  assert.deepEqual(roster.agents, []);
});
