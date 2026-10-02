import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPosition, interpolatePosition } from "../game/animation";
import {
  LIVE_AGENT_CLEARANCE, LIVE_COFFEE_SPOTS, LIVE_DESKS, LIVE_LOUNGE_APPROACH_Z,
  LIVE_SOFA, LOUNGE_SPOTS, isLoungeSeat, walkingDestination,
} from "../game/live-layout";
import { LIVE_OBSTACLES, LIVE_WALK_BOUNDS, liveNavigation } from "../game/live-navigation";
import { createNavigation, type Obstacle } from "../game/navigation";
import { Simulation, type Agent, type Point } from "../game/simulation";
import { arrangeObservation, newAgent, type Member, type Phase } from "../src/observation-layout";
import { moveObservationScene, updateObservationScene } from "../src/observation-movement";

// Independent separating-axis test of the full segment against each expanded footprint.
function assertSweptClear(from: Point, to: Point) {
  for (const point of [from, to]) {
    assert.ok(point.x >= LIVE_WALK_BOUNDS.minX + LIVE_AGENT_CLEARANCE.x);
    assert.ok(point.x <= LIVE_WALK_BOUNDS.maxX - LIVE_AGENT_CLEARANCE.x);
    assert.ok(point.z >= LIVE_WALK_BOUNDS.minZ + LIVE_AGENT_CLEARANCE.z);
    assert.ok(point.z <= LIVE_WALK_BOUNDS.maxZ - LIVE_AGENT_CLEARANCE.z);
  }
  for (const obstacle of LIVE_OBSTACLES) {
    const halfX = (obstacle.maxX - obstacle.minX) / 2 + LIVE_AGENT_CLEARANCE.x;
    const halfZ = (obstacle.maxZ - obstacle.minZ) / 2 + LIVE_AGENT_CLEARANCE.z;
    const offsetX = (from.x + to.x - obstacle.minX - obstacle.maxX) / 2;
    const offsetZ = (from.z + to.z - obstacle.minZ - obstacle.maxZ) / 2;
    const dx = (to.x - from.x) / 2;
    const dz = (to.z - from.z) / 2;
    const separated = Math.abs(offsetX) > halfX + Math.abs(dx) ||
      Math.abs(offsetZ) > halfZ + Math.abs(dz) ||
      Math.abs(dx * offsetZ - dz * offsetX) > Math.abs(dx) * halfZ + Math.abs(dz) * halfX;
    assert.ok(separated, `Segment ${JSON.stringify([from, to])} intersects ${obstacle.id}`);
  }
}

function assertRoute(from: Point, to: Point, path = liveNavigation.route(from, to)) {
  assert.notEqual(path, null, `No route from ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
  let previous = from;
  for (const point of path!) {
    assertSweptClear(previous, point);
    previous = point;
  }
  assert.deepEqual(previous, to);
}

test("every actual desk, coffee spot and sofa approach is mutually reachable with full body clearance", () => {
  const destinations = [...LIVE_DESKS, ...LIVE_COFFEE_SPOTS, ...LOUNGE_SPOTS.map(walkingDestination)];
  for (const from of destinations) for (const to of destinations) assertRoute(from, to);
});

test("couch routes use the front approach and go around the sofa, not through its back", () => {
  for (const seat of LOUNGE_SPOTS.filter(isLoungeSeat)) {
    const approach = walkingDestination(seat);
    assert.equal(approach.z, LIVE_LOUNGE_APPROACH_Z);
    assert.ok(approach.z > LIVE_SOFA.footprintZ + LIVE_SOFA.depth / 2 + LIVE_AGENT_CLEARANCE.z);
    assert.equal(liveNavigation.isWalkable(seat), false);
    for (const desk of LIVE_DESKS) {
      assertRoute(approach, desk);
      assertRoute(desk, approach);
    }
    const desk = LIVE_DESKS.find(point => Math.sign(point.x) === Math.sign(seat.x) && Math.abs(point.x) > 4)!;
    assert.equal(liveNavigation.segmentClear(approach, desk), false, "Old straight route crossed sofa/desks");
    assert.ok(liveNavigation.route(approach, desk)!.length > 1);
  }
});

test("desks are reached in the gap in front of the monitor, not from inside a desk or chair", () => {
  LIVE_DESKS.forEach((desk, index) => {
    const table = LIVE_OBSTACLES.find(obstacle => obstacle.id === `desk-${index}`)!;
    const chair = LIVE_OBSTACLES.find(obstacle => obstacle.id === `chair-${index}`)!;
    assert.ok(desk.z > table.maxZ + LIVE_AGENT_CLEARANCE.z);
    assert.ok(desk.z < chair.minZ - LIVE_AGENT_CLEARANCE.z);
    assertSweptClear(desk, desk);
  });
});

test("closed corridors, touching corners, invalid positions and obstacles never get a direct fallback", () => {
  const room = { minX: 0, maxX: 4, minZ: 0, maxZ: 4 };
  const barrier: Obstacle = { id: "wall", minX: 1.9, maxX: 2.1, minZ: 0, maxZ: 4 };
  const nav = createNavigation([barrier], room, { x: 0.2, z: 0.2 });
  assert.equal(nav.route({ x: 1, z: 1 }, { x: 3, z: 3 }), null);
  assert.equal(nav.route({ x: 1, z: 1 }, { x: 2, z: 2 }), null);
  assert.equal(nav.route({ x: NaN, z: 1 }, { x: 1, z: 1 }), null);
  assert.equal(nav.route({ x: 1, z: 1 }, { x: Infinity, z: 1 }), null);
  assert.equal(nav.route({ x: -1, z: 1 }, { x: 1, z: 1 }), null);
  assert.deepEqual(nav.route({ x: 1, z: 1 }, { x: 1, z: 1 }), []);
  const corners = createNavigation([
    { id: "top", minX: 0, maxX: 2, minZ: 2, maxZ: 4 },
    { id: "bottom", minX: 2, maxX: 4, minZ: 0, maxZ: 2 },
  ], room, { x: 0, z: 0 });
  assert.equal(corners.route({ x: 1, z: 1 }, { x: 3, z: 3 }), null);
  const doorway = [
    { ...barrier, maxZ: 1.8 },
    { ...barrier, id: "other-wall", minZ: 2.2 },
  ];
  assert.equal(createNavigation(doorway, room, { x: 0.1, z: 0.21 }).route({ x: 1, z: 2 }, { x: 3, z: 2 }), null);
  assert.deepEqual(createNavigation(doorway, room, { x: 0.1, z: 0.1 }).route({ x: 1, z: 2 }, { x: 3, z: 2 }), [{ x: 3, z: 2 }]);
});

const members = (phase: Phase): Member[] => LIVE_DESKS.map((_, index) => ({ id: `session-${index}`, phase, present: true }));
const position = (agent: Agent): Point => ({ x: agent.x, z: agent.z });
const newScene = () => {
  const scene = new Simulation();
  scene.agents = LIVE_DESKS.map((_, index) => newAgent(index));
  return scene;
};

function tick(scene: Simulation, delta = 1 / 30) {
  const previous = scene.agents.map(position);
  moveObservationScene(scene, delta);
  scene.agents.forEach((agent, index) => {
    assertSweptClear(previous[index], agent);
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
      const render = interpolatePosition(previous[index], agent, alpha);
      assertSweptClear(render, render);
    }
  });
}

function finish(scene: Simulation) {
  for (let frame = 0; frame < 1800; frame++) {
    tick(scene);
    if (scene.agents.every(agent => agent.route.length === 0 &&
      (isLoungeSeat(agent.target) ? agent.seating?.blend === 1 : !agent.seating))) return;
  }
  assert.fail("Agents did not finish their routes");
}

test("full idle -> work -> idle cycles preserve walking, working and seating with safe interpolated steps", () => {
  const scene = newScene();
  assert.deepEqual(updateObservationScene(scene, members("idle")), []);
  scene.agents.slice(4, 10).forEach(agent => {
    assert.deepEqual(agentPosition(agent), agent.target, "Original seated artwork position preserved");
    assert.equal(agent.seating?.blend, 1);
  });
  assert.deepEqual(updateObservationScene(scene, members("tool")), []);
  finish(scene);
  scene.agents.forEach((agent, index) => {
    assert.deepEqual(position(agent), LIVE_DESKS[index]);
    assert.equal(agent.state, "working");
  });
  assert.deepEqual(updateObservationScene(scene, members("idle")), []);
  finish(scene);
  scene.agents.forEach(agent => {
    assert.deepEqual(position(agent), walkingDestination(agent.target));
    assert.equal(agent.state, "idle");
    assert.deepEqual(agentPosition(agent), agent.target);
  });
});

test("mid-walk destination and desk-slot changes replan from current positions without teleporting", () => {
  const scene = newScene();
  const idle = members("idle");
  updateObservationScene(scene, idle);
  updateObservationScene(scene, members("tool"));
  for (let frame = 0; frame < 80; frame++) tick(scene);
  const before = scene.agents.map(position);
  const visualBefore = scene.agents.map(agentPosition);
  assert.deepEqual(updateObservationScene(scene, idle), []);
  assert.deepEqual(scene.agents.map(position), before);
  assert.deepEqual(scene.agents.map(agentPosition), visualBefore);
  scene.agents.forEach(agent => assertRoute(position(agent), walkingDestination(agent.target), agent.route));
  for (let frame = 0; frame < 12; frame++) tick(scene);
  const incoming = members("blocked").slice(1);
  const arranged = arrangeObservation(idle, scene.agents, incoming);
  scene.agents = arranged.agents;
  const compacted = scene.agents.map(position);
  updateObservationScene(scene, arranged.members);
  assert.deepEqual(scene.agents.map(position), compacted);
  finish(scene);
  scene.agents.forEach(agent => assert.equal(agent.state, "working"));
});

test("interrupted sit/stand blends remain continuous and finish standing before walking", () => {
  const scene = newScene();
  updateObservationScene(scene, members("idle"));
  const sitter = scene.agents[4];
  updateObservationScene(scene, members("tool"));
  for (let i = 0; i < 3; i++) tick(scene);
  assert.ok(sitter.seating!.blend > 0 && sitter.seating!.blend < 1);
  const visual = agentPosition(sitter);
  updateObservationScene(scene, members("idle"));
  assert.deepEqual(agentPosition(sitter), visual);
  tick(scene);
  assert.ok(sitter.seating!.blend > 2 / 3);
  finish(scene);
  updateObservationScene(scene, members("tool"));
  const approach = position(sitter);
  for (let i = 0; i < 9; i++) {
    tick(scene);
    assert.deepEqual(position(sitter), approach);
  }
  finish(scene);
  assert.equal(sitter.seating, undefined);
});

test("unreachable destinations stop safely, report an error, and retry on the next update", () => {
  const scene = newScene();
  updateObservationScene(scene, members("tool"));
  const positions = scene.agents.map(position);
  const blocked = createNavigation([{
    id: "closed-office", minX: -10, maxX: 10, minZ: -8, maxZ: 8,
  }], LIVE_WALK_BOUNDS, LIVE_AGENT_CLEARANCE);
  assert.equal(updateObservationScene(scene, members("idle"), blocked).length, 16);
  for (let frame = 0; frame < 30; frame++) moveObservationScene(scene, 1 / 30);
  assert.deepEqual(scene.agents.map(position), positions);
  scene.agents.forEach(agent => {
    assert.equal(agent.navigationBlocked, true);
    assert.deepEqual(agent.route, []);
    assert.notEqual(agent.state, "working");
  });
  assert.deepEqual(updateObservationScene(scene, members("idle")), []);
  finish(scene);
});
