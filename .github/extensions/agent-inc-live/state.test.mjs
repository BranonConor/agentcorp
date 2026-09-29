import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEvent, createState, isPublicSnapshot, normalizeTitle, publicSnapshot, selectRoom, summarizeUsageMetrics,
} from "./state.mjs";

test("session lifetime usage is reduced to numeric totals without models or paths", () => {
  const metrics = {
    sessionStartTime: "2026-09-29T15:28:36.298Z",
    modelMetrics: {
      "PRIVATE MODEL": {
        requests: { count: 3 },
        usage: { inputTokens: 120, outputTokens: 40, cacheReadTokens: 80 },
      },
      "other model": {
        requests: { count: 2 },
        usage: { inputTokens: 50, outputTokens: 25, cacheReadTokens: 10 },
      },
    },
    codeChanges: { filesModifiedCount: 2, filesModified: ["PRIVATE/path"], linesAdded: 24 },
  };
  const usage = summarizeUsageMetrics(metrics);
  assert.deepEqual(usage, {
    status: "ready", startedAt: metrics.sessionStartTime,
    totalTokens: 235, cachedInputTokens: 90, modelCalls: 5, filesChanged: 2, linesAdded: 24,
  });
  assert.equal(JSON.stringify(usage).includes("PRIVATE"), false);
  const state = createState("daily-chat");
  state.usage = usage;
  assert.equal(Object.hasOwn(publicSnapshot(state), "usage"), false);
  assert.throws(() => summarizeUsageMetrics({ ...metrics, modelMetrics: {} ,
    codeChanges: { ...metrics.codeChanges, filesModifiedCount: -1 } }), /Invalid session usage/);
  assert.throws(() => summarizeUsageMetrics({ ...metrics, modelMetrics: { bad: {
    requests: { count: 1 }, usage: { inputTokens: Infinity, outputTokens: 1, cacheReadTokens: 0 },
  } } }), /Invalid session usage/);
  assert.throws(() => summarizeUsageMetrics({ ...metrics, sessionStartTime: "not a date" }),
    /Invalid session usage/);
});

test("current session and subagent activity follow live SDK events", () => {
  const state = createState("daily-chat");
  applyEvent(state, { type: "assistant.turn_start" }, 1);
  assert.equal(state.status, "thinking");
  applyEvent(state, {
    type: "tool.execution_start", data: {
      toolCallId: "tool-1", toolName: "functions.bash", arguments: { command: "PRIVATE CODE" },
    },
  }, 2);
  assert.equal(state.activity, "Terminal");
  applyEvent(state, { type: "subagent.started", agentId: "worker-1", data: { agentDescription: "PRIVATE PROMPT" } }, 3);
  applyEvent(state, {
    type: "tool.execution_start", agentId: "worker-1",
    data: { toolCallId: "tool-2", toolName: "functions.rg" },
  }, 4);
  assert.equal(state.tools.length, 1);
  assert.equal(state.subagents[0].activity, "Research");
  applyEvent(state, { type: "assistant.message", data: { content: "PRIVATE RESPONSE" } }, 5);
  const snapshot = publicSnapshot(state, 5);
  assert.equal(isPublicSnapshot(snapshot), true);
  assert.equal(JSON.stringify(snapshot).includes("PRIVATE"), false);
  assert.equal(snapshot.subagents[0].id, "worker-1");
  assert.deepEqual(snapshot.tools, ["Terminal"]);
  assert.equal(snapshot.messages, 1);
  assert.equal(snapshot.events[0].label, "Assistant replied");
  applyEvent(state, { type: "assistant.turn_end" }, 5);
  assert.equal(state.status, "tool");
  applyEvent(state, { type: "tool.execution_complete", data: { toolCallId: "tool-1", success: false } }, 6);
  assert.equal(state.status, "blocked");
  applyEvent(state, { type: "subagent.completed", agentId: "worker-1" }, 7);
  assert.equal(publicSnapshot(state, 15_008).subagents.length, 0);
  applyEvent(state, { type: "assistant.turn_end" }, 7);
  assert.equal(state.status, "idle");
  applyEvent(state, { type: "session.idle" }, 8);
  assert.equal(state.status, "idle");
  applyEvent(state, { type: "session.title_changed", data: { title: "Daily work chat" } }, 9);
  assert.equal(publicSnapshot(state).title, "Daily work chat");
});

test("unrecognized events and malformed shared snapshots do not become office activity", () => {
  const state = createState("daily-chat");
  assert.equal(applyEvent(state, { type: "user.message", data: { content: "PRIVATE" } }), false);
  assert.equal(isPublicSnapshot({ status: "working", sessionId: "s", seenAt: 10, subagents: [] }), false);
  const valid = publicSnapshot(state);
  assert.equal(isPublicSnapshot({ ...valid, content: "PRIVATE" }), false);
  assert.equal(isPublicSnapshot({ ...valid, title: "x".repeat(101) }), false);
  assert.equal(isPublicSnapshot({ ...valid,
    subagents: [{ status: "idle", activity: "x", content: "PRIVATE" }] }), false);
  assert.equal(isPublicSnapshot({ ...valid,
    subagents: [{ id: "x".repeat(129), status: "idle", activity: "x" }] }), false);
  assert.equal(JSON.stringify(publicSnapshot(state)).includes("PRIVATE"), false);
  assert.equal(normalizeTitle("x".repeat(200)), undefined);
  state.title = normalizeTitle("PRIVATE PROMPT ".repeat(40));
  assert.equal(JSON.stringify(publicSnapshot(state)).includes("PRIVATE"), false);
});

test("one local room groups active sessions and their subagents, not stale heartbeats", () => {
  const first = createState("daily-chat");
  applyEvent(first, { type: "subagent.started", agentId: "worker-1" }, 50_000);
  const child = createState("child-session");
  applyEvent(child, { type: "assistant.turn_start" }, 50_000);
  const old = createState("old-session");
  const room = selectRoom([publicSnapshot(child, 60_000), publicSnapshot(old, 20_000),
    publicSnapshot(first, 60_000)], "daily-chat", 60_001);
  assert.deepEqual(room.sessions.map(({ sessionId }) => sessionId), ["daily-chat", "child-session"]);
  assert.equal(room.sessions[0].subagents.length, 1);
});

test("the room includes more than four live sessions without dropping the thirteenth", () => {
  const snapshots = Array.from({ length: 18 }, (_, index) =>
    publicSnapshot(createState(`session-${index}`), 60_000));
  const room = selectRoom(snapshots, "session-0", 60_001);
  assert.equal(room.sessions.length, 18);
  assert.equal(room.sessions[0].sessionId, "session-0");
});

test("brief tool actions remain visible by sanitized category for five seconds", () => {
  const state = createState("daily-chat");
  applyEvent(state, { type: "assistant.turn_start" }, 100);
  for (const [index, toolName, kind] of [
    [0, "functions.bash", "Terminal"],
    [1, "node_test", "Checks"],
    [2, "functions.rg", "Research"],
    [3, "functions.apply_patch", "Editing"],
    [4, "functions.task", "Delegating"],
    [5, "unknown_tool", "Working"],
  ]) {
    const at = 200 + index * 10_000;
    applyEvent(state, {
      type: "tool.execution_start",
      data: { toolCallId: `tool-${index}`, toolName, arguments: { content: "PRIVATE" } },
    }, at);
    assert.equal(state.activity, kind);
    applyEvent(state, {
      type: "tool.execution_complete", data: { toolCallId: `tool-${index}`, success: true },
    }, at + 1);
    assert.deepEqual(publicSnapshot(state, at + 4_999).recentTool, { kind, at: at + 1 });
    assert.equal(publicSnapshot(state, at + 5_001).recentTool, undefined);
    assert.equal(JSON.stringify(publicSnapshot(state, at + 2)).includes("PRIVATE"), false);
  }
  applyEvent(state, { type: "session.idle" }, 60_300);
  assert.equal(publicSnapshot(state, 60_301).recentTool, undefined);
});

test("helper actions keep their own short-lived category without sharing parent activity", () => {
  const state = createState("daily-chat");
  applyEvent(state, { type: "subagent.started", agentId: "helper" }, 100);
  applyEvent(state, {
    type: "tool.execution_start", agentId: "helper",
    data: { toolCallId: "tool", toolName: "functions.apply_patch" },
  }, 101);
  applyEvent(state, {
    type: "tool.execution_complete", agentId: "helper",
    data: { toolCallId: "tool", success: true },
  }, 102);
  assert.deepEqual(publicSnapshot(state, 103).subagents[0].recentTool, { kind: "Editing", at: 102 });
  assert.equal(publicSnapshot(state, 5_102).subagents[0].recentTool, undefined);
  assert.equal(publicSnapshot(state, 103).recentTool, undefined);
  const valid = publicSnapshot(state, 103);
  assert.equal(isPublicSnapshot(valid), true);
  assert.equal(isPublicSnapshot({ ...valid, recentTool: { kind: "PRIVATE", at: 102 } }), false);
  assert.equal(isPublicSnapshot({ ...valid, recentTool: { kind: "Editing", at: 102, content: "PRIVATE" } }), false);
  assert.equal(isPublicSnapshot({ ...valid, subagents: [
    { ...valid.subagents[0], recentTool: { kind: "Editing", at: Infinity } },
  ] }), false);
});
