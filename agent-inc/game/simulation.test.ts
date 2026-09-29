import assert from "node:assert/strict";
import test from "node:test";
import {
  accuracyChance, agentCost, applyOffline, CAPACITY_COST, COFFEE_SPOTS, CONTEXT_COST,
  DESKS, initialProgress, MAX_AGENT_LEVEL, MAX_CAPACITY, MAX_STATION_LEVEL, MAX_WORKFLOW,
  OFFLINE_LIMIT_SECONDS, parseProgress, Simulation, stationCost, stationInterval, workflowCost,
} from "./simulation.ts";
import { DAY_LENGTH_SECONDS, sampleDaylight } from "./lighting.ts";
import { interpolatePosition } from "./animation.ts";

function run(simulation: Simulation, seconds: number) {
  for (let i = 0; i < seconds * 30; i++) simulation.update(1 / 30);
}

test("chat arrives above a station; its agent leaves coffee, answers at the desk and earns tokens", () => {
  const sim = new Simulation(initialProgress(1000));
  assert.deepEqual({ x: sim.agents[0].x, z: sim.agents[0].z }, COFFEE_SPOTS[0]);
  run(sim, 2);
  assert.equal(sim.requests[0]?.stationId, 0);
  assert.equal(sim.requests[0]?.status, "assigned");
  assert.equal(sim.agents[0].state, "walking");
  assert.deepEqual(sim.agents[0].target, DESKS[0]);
  run(sim, 10);
  assert.ok(sim.requests.some((r) => r.status === "working" || r.status === "complete"));
  run(sim, 17);
  assert.ok(sim.progress.completed > 0);
  assert.ok(sim.progress.tokens >= 9);
  assert.ok(sim.requests.some((r) => r.status === "complete"));
});

test("identical initial state and ticks produce identical outcomes", () => {
  const a = new Simulation(initialProgress(1000));
  const b = new Simulation(initialProgress(1000));
  run(a, 80);
  run(b, 80);
  assert.deepEqual(a.progress, b.progress);
  assert.deepEqual(a.agents, b.agents);
  assert.deepEqual(a.requests, b.requests);
});

test("render positions interpolate between fixed steps without changing simulation state", () => {
  const sim = new Simulation(initialProgress(1000));
  run(sim, 2);
  const previous = { x: sim.agents[0].x, z: sim.agents[0].z };
  sim.update(1 / 30);
  const current = { x: previous.x + 1, z: previous.z - 2 };
  const saved = sim.save(1000);
  assert.deepEqual(interpolatePosition(previous, current, 0), previous);
  assert.deepEqual(interpolatePosition(previous, current, 1), current);
  assert.deepEqual(interpolatePosition(previous, current, 0.5), {
    x: (previous.x + current.x) / 2, z: (previous.z + current.z) / 2,
  });
  assert.deepEqual(interpolatePosition(previous, current, -1), previous);
  assert.deepEqual(interpolatePosition(previous, current, 2), current);
  assert.deepEqual(interpolatePosition(undefined, current, 0), current);
  assert.deepEqual(sim.save(1000), saved);
});

test("capacity adds a second agent and processes two requests concurrently", () => {
  const sim = new Simulation(initialProgress(1000));
  assert.equal(sim.buyCapacity(), false);
  sim.progress.tokens = CAPACITY_COST;
  assert.equal(sim.buyCapacity(), true);
  assert.equal(sim.progress.tokens, 0);
  assert.equal(sim.agents.length, 2);
  assert.equal(sim.buyCapacity(), false);
  run(sim, 2);
  assert.equal(sim.agents.filter((agent) => agent.taskId !== undefined).length, 2);
  assert.deepEqual(sim.requests.filter((request) => request.status === "assigned").map((request) => request.stationId).sort(), [0, 1]);
  run(sim, 40);
  assert.ok(sim.progress.completed >= 3);
});

test("all staffed stations receive their own chat work", () => {
  const solo = new Simulation();
  const progress = initialProgress();
  progress.capacity = MAX_CAPACITY;
  const team = new Simulation(progress);
  team.agents.forEach((agent, index) => {
    assert.deepEqual({ x: agent.x, z: agent.z }, COFFEE_SPOTS[index]);
  });
  const usedDesks = new Set<number>();
  for (let i = 0; i < 180 * 30; i++) {
    team.update(1 / 30);
    team.agents.filter((agent) => agent.state === "working").forEach((agent) => usedDesks.add(agent.id));
  }
  run(solo, 180);
  assert.equal(usedDesks.size, MAX_CAPACITY);
  assert.ok(team.requests.every((request) => request.agentId === undefined || request.agentId === request.stationId));
  assert.ok(team.progress.nextId - 1 > (solo.progress.nextId - 1) * 2);
  assert.ok(team.progress.completed > solo.progress.completed * 2);
  assert.ok(team.requests.filter((request) => request.status === "queued").length <= MAX_CAPACITY);
});

test("station signal upgrades increase arrivals only at that station", () => {
  const base = new Simulation(initialProgress());
  const upgraded = new Simulation(initialProgress());
  upgraded.progress.tokens = 400;
  assert.equal(upgraded.buyStation(1), false);
  assert.equal(upgraded.buyStation(-1), false);
  assert.equal(upgraded.buyStation(0), true);
  assert.equal(upgraded.progress.tokens, 400 - stationCost(0));
  assert.equal(upgraded.buyStation(0), true);
  assert.equal(upgraded.buyStation(0), true);
  assert.equal(upgraded.buyStation(0), false);
  assert.equal(upgraded.progress.stationLevels[0], MAX_STATION_LEVEL);
  assert.ok(stationInterval(MAX_STATION_LEVEL) < stationInterval(0));
  run(base, 80);
  run(upgraded, 80);
  assert.ok(upgraded.progress.nextId > base.progress.nextId);
  assert.deepEqual(parseProgress(JSON.stringify(upgraded.save(2000))), upgraded.save(2000));
});

test("personal training changes speed and accuracy; missed responses deduct bounded tokens", () => {
  const base = new Simulation(initialProgress());
  const trained = new Simulation(initialProgress());
  trained.progress.tokens = 500;
  assert.equal(trained.trainAgent(1, "speed"), false);
  assert.equal(trained.trainAgent(0, "speed"), true);
  assert.equal(trained.progress.tokens, 500 - agentCost("speed", 0));
  for (let i = 0; i < MAX_AGENT_LEVEL; i++) assert.equal(trained.trainAgent(0, "accuracy"), true);
  assert.equal(trained.trainAgent(0, "accuracy"), false);
  assert.ok(accuracyChance(MAX_AGENT_LEVEL) > accuracyChance(0));
  run(base, 2);
  run(trained, 2);
  assert.ok(trained.agents[0].workTotal < base.agents[0].workTotal);

  let failingSeed = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const progress = initialProgress();
    progress.seed = seed;
    progress.tokens = 10;
    const sim = new Simulation(progress);
    run(sim, 15);
    if (sim.requests.find((r) => r.id === 1)?.status !== "failed") continue;
    progress.agentLevels[0].accuracy = MAX_AGENT_LEVEL;
    const accurate = new Simulation(progress);
    run(accurate, 15);
    if (accurate.requests.find((r) => r.id === 1)?.status !== "complete") continue;
    failingSeed = seed;
    assert.equal(sim.progress.tokens, 7);
    assert.equal(sim.progress.errors, 1);
    assert.equal(sim.requests.find((r) => r.id === 1)?.loss, 3);
    assert.equal(accurate.progress.tokens, 10 + accurate.requests.find((r) => r.id === 1)!.reward);
    assert.equal(accurate.progress.errors, 0);
    break;
  }
  assert.ok(failingSeed > 0);
  const empty = initialProgress();
  empty.seed = failingSeed;
  const noTokens = new Simulation(empty);
  run(noTokens, 15);
  assert.equal(noTokens.progress.tokens, 0);
  assert.equal(noTokens.requests.find((r) => r.id === 1)?.loss, 0);
});

test("workstation kits save, speed desk work, and increase earned reward", () => {
  const progress = initialProgress(1000);
  progress.capacity = 2;
  progress.tokens = 500;
  const upgraded = new Simulation(progress);
  assert.equal(upgraded.buyWorkflow(), true);
  assert.equal(upgraded.progress.tokens, 500 - workflowCost(0));
  assert.equal(upgraded.buyWorkflow(), true);
  assert.equal(upgraded.buyWorkflow(), true);
  assert.equal(upgraded.buyWorkflow(), false);
  assert.equal(upgraded.progress.workflow, MAX_WORKFLOW);
  assert.deepEqual(parseProgress(JSON.stringify(upgraded.save(2000))), upgraded.save(2000));

  const basic = new Simulation(progress);
  run(basic, 2);
  run(upgraded, 2);
  assert.ok(upgraded.agents[0].workTotal < basic.agents[0].workTotal);
  assert.equal(upgraded.requests[0].reward, basic.requests[0].reward + MAX_WORKFLOW);
  const legacy = { ...initialProgress(1000) } as Partial<typeof progress>;
  delete legacy.workflow;
  assert.equal(parseProgress(JSON.stringify(legacy))?.workflow, 0);
  assert.equal(parseProgress(JSON.stringify({ ...legacy, workflow: -1 })), null);
  assert.equal(parseProgress(JSON.stringify({ ...legacy, workflow: MAX_WORKFLOW + 1 })), null);
  delete legacy.stationLevels;
  delete legacy.agentLevels;
  delete legacy.errors;
  const migrated = parseProgress(JSON.stringify(legacy));
  assert.deepEqual(migrated?.stationLevels, [0, 0, 0, 0]);
  assert.deepEqual(migrated?.agentLevels, initialProgress().agentLevels);
  assert.equal(migrated?.errors, 0);
  assert.equal(parseProgress(JSON.stringify({ ...legacy, stationLevels: [1, 2] })), null);
  assert.equal(parseProgress(JSON.stringify({ ...legacy, agentLevels: [{ speed: 10, accuracy: 0 }] })), null);
});

test("the context unlock costs tokens and routes requests through its room", () => {
  const sim = new Simulation(initialProgress(1000));
  sim.progress.tokens = CONTEXT_COST + CAPACITY_COST;
  assert.equal(sim.unlockContext(), false);
  assert.equal(sim.buyCapacity(), true);
  assert.equal(sim.unlockContext(), true);
  assert.equal(sim.progress.tokens, 0);
  assert.equal(sim.unlockContext(), false);
  let visited = false;
  for (let i = 0; i < 200 * 30; i++) {
    sim.update(1 / 30);
    if (sim.agents.some((agent) => agent.visitedContext)) visited = true;
  }
  assert.ok(sim.requests.some((request) => request.kind === "context"));
  assert.equal(visited, true);
});

test("saves validate shape, offline progress is bounded and future timestamps do not grant rewards", () => {
  const progress = initialProgress(1000);
  progress.capacity = MAX_CAPACITY;
  progress.context = true;
  const loaded = parseProgress(JSON.stringify(progress));
  assert.deepEqual(loaded, progress);
  assert.equal(parseProgress("{broken"), null);
  assert.equal(parseProgress(JSON.stringify({ ...progress, capacity: 50 })), null);
  assert.equal(parseProgress(JSON.stringify({ ...progress, tokens: -1 })), null);
  const report = applyOffline(progress, 1000 + 24 * 60 * 60 * 1000);
  assert.equal(report.seconds, OFFLINE_LIMIT_SECONDS);
  assert.equal(report.completed, OFFLINE_LIMIT_SECONDS * MAX_CAPACITY / stationInterval(0));
  assert.ok(progress.errors < report.completed / 4);
  assert.ok(report.tokens > 0 && report.tokens < progress.earned);
  assert.equal(applyOffline(progress, progress.savedAt - 1000).tokens, 0);
});

test("queues stay bounded during long single-agent runs without losing in-flight tasks", () => {
  const sim = new Simulation();
  run(sim, 800);
  assert.ok(sim.requests.filter((request) => request.status === "queued").length <= MAX_CAPACITY);
  for (const agent of sim.agents) {
    if (agent.taskId !== undefined) assert.ok(sim.requests.some((request) => request.id === agent.taskId));
  }
});

test("cosmetic daylight is deterministic, cyclical, and independent of the simulation state", () => {
  const morning = sampleDaylight(0);
  assert.deepEqual(morning, sampleDaylight(DAY_LENGTH_SECONDS));
  assert.deepEqual(morning, sampleDaylight(0));
  const night = sampleDaylight(0, 0.5);
  assert.ok(morning.sun > night.sun);
  assert.ok(night.lamp > morning.lamp);
  assert.ok(night.moon > 0 && night.moon < morning.sun);
  assert.equal(sampleDaylight(DAY_LENGTH_SECONDS * 0.15).moon, 0);
  assert.equal(sampleDaylight(0, 0.25).label, "14:24");
  const sim = new Simulation();
  const before = sim.save(1000);
  sampleDaylight(sim.time, 0.75);
  assert.deepEqual(sim.save(1000), before);
});
