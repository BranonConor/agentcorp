import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEvent, createState, publicSnapshot, toolKind } from "../.github/extensions/agent-inc-live/state.mjs";
import { agentName, noticeActivityForActor, roomActors } from "./src/room.ts";
import {
  EXTRA_DESKS, LIVE_AISLE_Z, LIVE_COFFEE_COUNTER, LIVE_COFFEE_Z,
  LIVE_DIVIDER_END_Z, LIVE_DIVIDER_PLANTS, LIVE_DIVIDER_START_Z, LIVE_DIVIDER_X,
  LIVE_LOUNGE_SEATS_PER_WING,
  LIVE_LOUNGE_SOFA_X, LIVE_LOUNGE_Z,
  LIVE_ROOM, LIVE_RUG_X, LOUNGE_SPOTS, MAX_LIVE_DESKS, MIN_LIVE_DESKS, MIN_VISIBLE_LIVE_DESKS,
  assignLoungeSpots, deskPropsFor, isLoungeSeat, liveDeskCount, routeAroundDividers,
} from "../agent-inc/game/live-layout.ts";

function session(sessionId, title) {
  return {
    sessionId, title, status: "idle", activity: "At the coffee counter",
    tools: [], subagents: [], updatedAt: 1, seenAt: 1,
  };
}

test("agent identities are human-readable and stable per session", () => {
  assert.match(agentName("session-1"), /^[A-Za-z]+ [A-Za-z]+$/);
  assert.equal(agentName("session-1"), agentName("session-1"));
  assert.notEqual(agentName("session-1"), agentName("session-2"));
});

test("the roster retains session titles and stable desks as activity order changes", () => {
  const parent = session("parent", "Daily work chat");
  parent.subagents = [{ id: "worker-a", status: "thinking", activity: "Research" }];
  const child = session("child", "Fixing shadows");
  const room = { currentSessionId: "parent", sessions: [child, parent] };
  const before = roomActors(room);
  const after = roomActors({ ...room, sessions: [parent, { ...child, updatedAt: 99 }] });
  assert.deepEqual(before.map(({ key }) => key), ["parent", "child", "parent:helper:worker-a"]);
  assert.deepEqual(after.map(({ key, name }) => ({ key, name })),
    before.map(({ key, name }) => ({ key, name })));
  assert.deepEqual(before.map(({ sessionTitle }) => sessionTitle),
    ["Daily work chat", "Fixing shadows", "Daily work chat"]);
  assert.equal(new Set(before.map(({ name }) => name)).size, before.length);
});

test("unavailable titles fall back to an identifiable session label", () => {
  const actor = roomActors({ currentSessionId: "12345678-abc", sessions: [session("12345678-abc")] })[0];
  assert.equal(actor.sessionTitle, "Your session");
  const other = roomActors({ currentSessionId: "current", sessions: [session("12345678-abc")] })[0];
  assert.equal(other.sessionTitle, "Session 12345678");
});

test("four wing desks stay visible while staffing and later desks grow with workers", () => {
  assert.equal(MIN_LIVE_DESKS, 4);
  assert.equal(MIN_VISIBLE_LIVE_DESKS, 8);
  assert.equal(MAX_LIVE_DESKS, 16);
  assert.deepEqual([0, 1, 4, 5, 6, 8, 9, 16, 17, 2].map(liveDeskCount),
    [8, 8, 8, 8, 8, 8, 9, 16, 16, 8]);
  assert.deepEqual(EXTRA_DESKS.slice(0, 4).map(({ x }) => Math.sign(x)), [-1, 1, -1, 1]);
  assert.equal(new Set(EXTRA_DESKS.map(({ x, z }) => `${x},${z}`)).size, 12);
  assert(EXTRA_DESKS.every(({ x, z }) =>
    Math.abs(x) + 0.8 < LIVE_ROOM.halfWidth && z > LIVE_ROOM.back + 1 && z < LIVE_ROOM.front - 1));
  assert(LIVE_COFFEE_Z < LIVE_DIVIDER_START_Z);
});

test("each wing centers a three-seat sofa at the rug edge, with three clear standing spots", () => {
  assert.equal(LOUNGE_SPOTS.length, EXTRA_DESKS.length);
  assert.equal(new Set(LOUNGE_SPOTS.map(({ x, z }) => `${x},${z}`)).size, EXTRA_DESKS.length);
  assert.deepEqual(LOUNGE_SPOTS.slice(0, 6).map(({ x }) => Math.sign(x)), [-1, 1, -1, 1, -1, 1]);
  assert.equal(LIVE_LOUNGE_SEATS_PER_WING, 3);
  assert.equal(LIVE_LOUNGE_SOFA_X, LIVE_RUG_X);
  assert(LIVE_LOUNGE_SOFA_X - 3.08 / 2 > LIVE_DIVIDER_X + 0.15);
  assert(LIVE_LOUNGE_SOFA_X + 3.08 / 2 < LIVE_ROOM.halfWidth - 0.5);
  assert(LIVE_LOUNGE_Z - 0.23 > 5.35 && LIVE_LOUNGE_Z - 0.23 < 5.55);
  assert(LIVE_LOUNGE_Z - 0.44 > Math.max(...EXTRA_DESKS.map(({ z }) => z)) + 0.52);
  for (const [index, spot] of LOUNGE_SPOTS.entries()) {
    assert.equal(Math.sign(spot.x), Math.sign(EXTRA_DESKS[index].x));
    assert(Math.abs(spot.x) > LIVE_DIVIDER_X);
    assert(Math.abs(spot.x) < LIVE_ROOM.halfWidth - 0.5);
    assert.equal(isLoungeSeat(spot), index < LIVE_LOUNGE_SEATS_PER_WING * 2);
    if (isLoungeSeat(spot)) {
      assert.equal(spot.z, LIVE_LOUNGE_Z);
    } else {
      const clearsSofaX = Math.abs(Math.abs(spot.x) - LIVE_LOUNGE_SOFA_X) > 3.08 / 2 + 0.95 / 2;
      const clearsSofaZ = Math.abs(spot.z - (LIVE_LOUNGE_Z - 0.08)) > (0.72 + 0.38) / 2;
      assert(clearsSofaX || clearsSofaZ);
      assert(spot.z < LIVE_ROOM.front - 0.5);
    }
  }
  assert.deepEqual(LOUNGE_SPOTS.filter(({ x }) => x < 0).map(({ x }) => -x),
    [LIVE_LOUNGE_SOFA_X + 0.92, LIVE_LOUNGE_SOFA_X, LIVE_LOUNGE_SOFA_X - 0.92, 8.8, 4.18, 8.7]);
});

test("idle wing workers fill the sofa before standing, regardless of busy desks", () => {
  assert.deepEqual(assignLoungeSpots(Array(12).fill(true)), LOUNGE_SPOTS);
  const idle = Array(12).fill(true);
  idle[0] = false;
  idle[5] = false;
  const assigned = assignLoungeSpots(idle);
  assert.equal(assigned[0], null);
  assert.equal(assigned[5], null);
  assert.deepEqual(assigned[2], LOUNGE_SPOTS[0]);
  assert.deepEqual(assigned[7], LOUNGE_SPOTS[5]);
  assert.deepEqual(assigned[8], LOUNGE_SPOTS[6]);
  assert.deepEqual(assigned[11], LOUNGE_SPOTS[9]);
  assert.equal(isLoungeSeat(assigned[8]), false);
  assert.equal(isLoungeSeat(assigned[11]), false);
  assert.throws(() => assignLoungeSpots(Array(14).fill(true)), RangeError);
});

test("divider monsteras grow beyond the wall posts without crowding the lounge", () => {
  assert.deepEqual(LIVE_DIVIDER_PLANTS.map(({ x }) => x), [-3, 3]);
  assert(LIVE_DIVIDER_PLANTS.every(({ z, size }) =>
    z - 0.42 * size / 2 > LIVE_DIVIDER_END_Z + 0.17 / 2));
  assert(LOUNGE_SPOTS[9].x - LIVE_DIVIDER_PLANTS[1].x >
    (0.95 + 1.2 * LIVE_DIVIDER_PLANTS[1].size) / 2);
});

test("the live counter matches the coffee sprite's proportions", () => {
  assert(Math.abs(LIVE_COFFEE_COUNTER.width / LIVE_COFFEE_COUNTER.height - 96 / 56) < 0.02);
  assert(LIVE_COFFEE_COUNTER.width < 3.5);
  assert(LIVE_COFFEE_COUNTER.y - LIVE_COFFEE_COUNTER.height / 2 >= 0);
});

test("each workstation has stable, distinct desk accessories", () => {
  const pairs = Array.from({ length: MAX_LIVE_DESKS }, (_, index) => deskPropsFor(index));
  assert(pairs.every(([left, right]) => left !== right));
  assert.deepEqual(pairs, Array.from({ length: MAX_LIVE_DESKS }, (_, index) => deskPropsFor(index)));
  assert(new Set(pairs.map((pair) => pair.join(","))).size >= 10);
  assert(new Set(pairs.flat()).size >= 5);
});

test("workers cross the dividers through the back aisle and stay in their desk section", () => {
  assert(LIVE_DIVIDER_END_Z > 3.65);
  assert(LIVE_AISLE_Z < LIVE_DIVIDER_START_Z);
  assert(EXTRA_DESKS.every(({ x }) => Math.abs(x) > LIVE_DIVIDER_X + 0.8));
  const from = { x: -1, z: 1.75 };
  const to = { x: 4.7, z: 3.65 };
  assert.deepEqual(routeAroundDividers(from, to), [
    { x: from.x, z: LIVE_AISLE_Z }, { x: to.x, z: LIVE_AISLE_Z },
  ]);
  assert.deepEqual(routeAroundDividers(to, from), [
    { x: to.x, z: LIVE_AISLE_Z }, { x: from.x, z: LIVE_AISLE_Z },
  ]);
  assert.deepEqual(routeAroundDividers(from, LOUNGE_SPOTS[1]), [
    { x: from.x, z: LIVE_AISLE_Z }, { x: LOUNGE_SPOTS[1].x, z: LIVE_AISLE_Z },
  ]);
  assert.deepEqual(routeAroundDividers({ x: -6.8, z: -0.35 }, { x: -4.7, z: 3.65 }), []);
});

test("notice icons follow sanitized live activity, not tool names or response text", () => {
  const icon = (status, activity) => noticeActivityForActor({ status, activity });
  assert.equal(icon("thinking", "Planning the next step"), "thinking");
  assert.equal(icon("thinking", "Helpers at work"), "delegating");
  assert.equal(icon("blocked", "Tool needs attention"), "blocked");
  assert.equal(icon("idle", "At the coffee counter"), null);
  assert.equal(icon("offline", "Away from the office"), null);
  for (const [tool, expected] of [
    ["functions.bash", "terminal"],
    ["node_test", "checks"],
    ["functions.rg", "research"],
    ["functions.apply_patch", "editing"],
    ["functions.task", "delegating"],
    ["unknown_tool", "working"],
  ]) {
    assert.equal(icon("tool", toolKind(tool)), expected);
  }
  assert.equal(icon("tool", "Unexpected metadata"), "working");
});

test("short parent and helper actions remain visible after their tool completes", () => {
  const state = createState("parent");
  applyEvent(state, { type: "assistant.turn_start" }, 100);
  applyEvent(state, {
    type: "tool.execution_start", data: { toolCallId: "edit", toolName: "functions.apply_patch" },
  }, 101);
  applyEvent(state, {
    type: "tool.execution_complete", data: { toolCallId: "edit", success: true },
  }, 102);
  applyEvent(state, { type: "subagent.started", agentId: "helper" }, 103);
  applyEvent(state, {
    type: "tool.execution_start", agentId: "helper",
    data: { toolCallId: "search", toolName: "functions.rg" },
  }, 104);
  applyEvent(state, {
    type: "tool.execution_complete", agentId: "helper",
    data: { toolCallId: "search", success: true },
  }, 105);
  const actors = roomActors({ currentSessionId: "parent",
    sessions: [publicSnapshot(state, 106)] });
  assert.equal(noticeActivityForActor(actors[0], 106), "editing");
  assert.equal(noticeActivityForActor(actors[1], 106), "research");
  assert.equal(noticeActivityForActor(actors[0], 5_102), "thinking");
  assert.equal(noticeActivityForActor(actors[1], 5_105), "thinking");
  applyEvent(state, { type: "assistant.turn_end" }, 107);
  const delegating = roomActors({ currentSessionId: "parent",
    sessions: [publicSnapshot(state, 108)] });
  assert.equal(noticeActivityForActor(delegating[0], 108), "delegating");
});
