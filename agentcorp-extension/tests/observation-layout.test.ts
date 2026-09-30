import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangeObservation, newAgent, type Member, type Phase } from "../src/observation-layout";
import { agentPersona } from "../src/room";

const member = (id: string, phase: Phase = "idle"): Member => ({ id, phase, present: true });

test("activity priority may reorder rows without swapping scene agents or their personas", () => {
  const previous = [member("alpha"), member("beta", "tool")];
  const agents = [newAgent(0), newAgent(1)];
  agents[0].x = 2;
  agents[1].x = -4;
  const arranged = arrangeObservation(previous, agents, [
    member("beta", "blocked"), member("alpha", "thinking"),
  ]);
  assert.deepEqual(arranged.members, [member("alpha", "thinking"), member("beta", "blocked")]);
  assert.strictEqual(arranged.agents[0], agents[0]);
  assert.strictEqual(arranged.agents[1], agents[1]);
  assert.equal(arranged.agents[0].x, 2);
  assert.equal(arranged.agents[1].x, -4);
  assert.equal(agentPersona(arranged.members[0].id), agentPersona(previous[0].id));
  assert.equal(agentPersona(arranged.members[1].id), agentPersona(previous[1].id));
});

test("a removed desk compacts without losing the surviving agent's identity", () => {
  const previous = [member("alpha"), member("beta"), member("gamma")];
  const agents = [newAgent(0), newAgent(1), newAgent(2)];
  agents[2].x = 6;
  const arranged = arrangeObservation(previous, agents, [
    member("delta", "tool"), member("gamma", "thinking"), member("alpha"),
  ]);
  assert.deepEqual(arranged.members.map(({ id }) => id), ["alpha", "gamma", "delta"]);
  assert.strictEqual(arranged.agents[0], agents[0]);
  assert.strictEqual(arranged.agents[1], agents[2]);
  assert.equal(arranged.agents[1].id, 1);
  assert.equal(arranged.agents[1].x, 6);
  assert.equal(arranged.agents[2].x, 100);
  assert.notStrictEqual(arranged.agents[2], agents[1]);
  assert.equal(arranged.members.findIndex(({ id }) => id === "gamma") + 1, 2);
});

test("a selected session displaced from the visible top 16 is no longer focusable", () => {
  const previous = Array.from({ length: 16 }, (_, index) => member(`idle-${index}`));
  const agents = previous.map((_, index) => newAgent(index));
  const incoming = [member("urgent", "blocked"), ...previous.slice(0, 15)];
  const arranged = arrangeObservation(previous, agents, incoming);
  assert.equal(arranged.members.length, 16);
  assert.equal(arranged.members.findIndex(({ id }) => id === "idle-15"), -1);
  assert.equal(arranged.members.findIndex(({ id }) => id === "urgent"), 15);
  assert.strictEqual(arranged.agents[0], agents[0]);
  assert.notStrictEqual(arranged.agents[15], agents[15]);
});

test("duplicate session IDs fail rather than silently merging agents", () => {
  assert.throws(() => arrangeObservation([], [], [
    member("same", "idle"), member("same", "tool"),
  ]), /Duplicate observed session ID/);
});
