const STATUSES = new Set(["idle", "thinking", "tool", "blocked", "offline"]);
const TOOL_KINDS = new Set(["Terminal", "Checks", "Research", "Editing", "Delegating", "Working"]);
const RECENT_TOOL_MS = 5_000;

function metricCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid session usage ${name}`);
  }
  return value;
}

export function summarizeUsageMetrics(metrics) {
  const startedAt = metrics?.sessionStartTime;
  if (typeof startedAt !== "string" || startedAt.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(startedAt) ||
    !Number.isFinite(Date.parse(startedAt)) ||
    !metrics.modelMetrics || typeof metrics.modelMetrics !== "object" ||
    Array.isArray(metrics.modelMetrics)) {
    throw new Error("Invalid session usage metrics");
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let modelCalls = 0;
  for (const model of Object.values(metrics.modelMetrics)) {
    inputTokens = metricCount(inputTokens + metricCount(model?.usage?.inputTokens, "input tokens"), "input total");
    outputTokens = metricCount(outputTokens + metricCount(model?.usage?.outputTokens, "output tokens"), "output total");
    cachedInputTokens = metricCount(
      cachedInputTokens + metricCount(model?.usage?.cacheReadTokens, "cached tokens"), "cache total");
    modelCalls = metricCount(modelCalls + metricCount(model?.requests?.count, "model calls"), "call total");
  }
  return {
    status: "ready",
    startedAt,
    totalTokens: metricCount(inputTokens + outputTokens, "token total"),
    cachedInputTokens,
    modelCalls,
    filesChanged: metricCount(metrics.codeChanges?.filesModifiedCount, "files changed"),
    linesAdded: metricCount(metrics.codeChanges?.linesAdded, "lines added"),
  };
}

export function normalizeTitle(value) {
  if (value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid session display name");
  const title = value.trim();
  return title.length > 100 ? undefined : title;
}

export function toolKind(name = "") {
  if (/bash|terminal|shell|command/i.test(name)) return "Terminal";
  if (/test|build|lint|typecheck/i.test(name)) return "Checks";
  if (/read|view|search|rg|glob|fetch/i.test(name)) return "Research";
  if (/edit|patch|write|create_file/i.test(name)) return "Editing";
  if (/task|agent|factory/i.test(name)) return "Delegating";
  return "Working";
}

export function createState(sessionId) {
  return {
    sessionId, title: undefined, status: "idle", activity: "At the coffee counter",
    tools: [], recentTool: null, subagents: [], messages: 0, events: [], updatedAt: Date.now(),
  };
}

function recentToolField(tool, now) {
  return tool && now >= tool.at && now - tool.at < RECENT_TOOL_MS ? { recentTool: tool } : {};
}

function isRecentTool(value) {
  return value === undefined || (value && typeof value === "object" &&
    TOOL_KINDS.has(value.kind) && Number.isFinite(value.at) &&
    Object.keys(value).every((key) => ["kind", "at"].includes(key)));
}

function record(state, kind, label, now) {
  state.events.unshift({ kind, label, at: now });
  state.events = state.events.slice(0, 8);
}

export function applyEvent(state, event, now = Date.now()) {
  const { type, data = {}, agentId } = event;
  let changed = true;
  switch (type) {
    case "session.title_changed":
      if (typeof data.title === "string" && data.title.trim()) {
        state.title = normalizeTitle(data.title);
      } else {
        changed = false;
      }
      break;
    case "assistant.turn_start":
      state.status = "thinking";
      state.activity = "Planning the next step";
      state.recentTool = null;
      break;
    case "tool.execution_start": {
      const kind = toolKind(data.toolName);
      if (agentId) {
        const worker = state.subagents.find((agent) => agent.id === agentId);
        if (worker) {
          worker.status = "tool";
          worker.activity = kind;
          worker.recentTool = null;
        }
      } else if (data.toolCallId && !state.tools.some((tool) => tool.id === data.toolCallId)) {
        state.tools.push({ id: data.toolCallId, kind });
        state.tools = state.tools.slice(-12);
        state.status = "tool";
        state.activity = kind;
        state.recentTool = null;
      }
      break;
    }
    case "tool.execution_complete":
      if (agentId) {
        const worker = state.subagents.find((agent) => agent.id === agentId);
        if (worker) {
          worker.recentTool = data.success === false ? null :
            { kind: worker.status === "tool" ? worker.activity : "Working", at: now };
          worker.status = data.success === false ? "blocked" : "thinking";
          worker.activity = data.success === false ? "Tool needs attention" : "Thinking";
        }
      } else {
        const kind = state.tools.find((tool) => tool.id === data.toolCallId)?.kind ?? "Working";
        state.tools = state.tools.filter((tool) => tool.id !== data.toolCallId);
        state.status = data.success === false ? "blocked" : state.tools.length ? "tool" : "thinking";
        state.activity = data.success === false ? "Tool needs attention" :
          state.tools.length ? state.tools.at(-1).kind : "Reviewing the result";
        state.recentTool = data.success === false ? null : { kind, at: now };
        record(state, data.success === false ? "error" : "tool",
          `${kind} ${data.success === false ? "needs attention" : "finished"}`, now);
      }
      break;
    case "assistant.message":
      state.messages++;
      record(state, "message", agentId ? "Helper replied" : "Assistant replied", now);
      break;
    case "subagent.started": {
      const id = agentId || data.toolCallId;
      if (!id) break;
      if (!state.subagents.some((agent) => agent.id === id)) {
        state.subagents.push({
          id, status: "thinking", activity: "Thinking", recentTool: null, finishedAt: null,
        });
        state.subagents = state.subagents.slice(-12);
      }
      record(state, "helper", "Helper joined the room", now);
      break;
    }
    case "subagent.completed":
    case "subagent.failed": {
      const worker = state.subagents.find((agent) => agent.id === (agentId || data.toolCallId));
      if (worker) {
        worker.status = type === "subagent.failed" ? "blocked" : "idle";
        worker.activity = type === "subagent.failed" ? "Needs attention" : "Finished";
        worker.finishedAt = now;
      }
      record(state, type === "subagent.failed" ? "error" : "helper",
        type === "subagent.failed" ? "Helper needs attention" : "Helper finished", now);
      break;
    }
    case "assistant.turn_end":
      if (state.tools.length || state.subagents.some((agent) => !agent.finishedAt)) {
        state.status = state.tools.length ? "tool" : "thinking";
        state.activity = state.tools.length ? state.tools.at(-1).kind : "Helpers at work";
        break;
      }
      state.status = "idle";
      state.activity = "At the coffee counter";
      state.recentTool = null;
      break;
    case "session.idle":
      state.tools = [];
      state.status = "idle";
      state.activity = "At the coffee counter";
      state.recentTool = null;
      break;
    case "session.error":
      state.status = "blocked";
      state.activity = "Needs attention";
      state.recentTool = null;
      record(state, "error", "Session needs attention", now);
      break;
    case "session.shutdown":
      state.status = "offline";
      state.activity = "Away from the office";
      state.recentTool = null;
      break;
    default:
      changed = false;
  }
  if (changed) state.updatedAt = now;
  return changed;
}

export function publicSnapshot(state, now = Date.now()) {
  return {
    sessionId: state.sessionId,
    ...(state.title ? { title: state.title } : {}),
    status: state.status,
    activity: state.activity,
    tools: state.tools.map(({ kind }) => kind),
    ...(state.status === "thinking" ? recentToolField(state.recentTool, now) : {}),
    messages: state.messages,
    events: state.events.map(({ kind, label, at }) => ({ kind, label, at })),
    subagents: state.subagents
      .filter((agent) => !agent.finishedAt || now - agent.finishedAt < 15_000)
      .map(({ id, status, activity, recentTool }) => ({
        id, status, activity,
        ...(status === "thinking" ? recentToolField(recentTool, now) : {}),
      })),
    updatedAt: state.updatedAt,
    seenAt: now,
  };
}

export function isPublicSnapshot(value) {
  return value && typeof value.sessionId === "string" && value.sessionId.length <= 128 &&
    (value.title === undefined || (typeof value.title === "string" &&
      value.title.length > 0 && value.title.length <= 100)) &&
    STATUSES.has(value.status) && typeof value.activity === "string" &&
    value.activity.length <= 80 && Number.isFinite(value.seenAt) &&
    Number.isFinite(value.updatedAt) &&
    isRecentTool(value.recentTool) &&
    Object.keys(value).every((key) =>
      ["sessionId", "title", "status", "activity", "tools", "recentTool", "subagents", "messages", "events", "updatedAt", "seenAt"].includes(key)) &&
    Array.isArray(value.tools) && value.tools.length <= 12 &&
    value.tools.every((tool) => typeof tool === "string" && tool.length <= 80) &&
    (value.messages === undefined || (Number.isSafeInteger(value.messages) && value.messages >= 0)) &&
    (value.events === undefined || (Array.isArray(value.events) && value.events.length <= 8 &&
      value.events.every((event) => ["message", "tool", "helper", "error"].includes(event.kind) &&
        typeof event.label === "string" && event.label.length <= 80 && Number.isFinite(event.at) &&
        Object.keys(event).every((key) => ["kind", "label", "at"].includes(key))))) &&
    Array.isArray(value.subagents) && value.subagents.length <= 12 &&
    value.subagents.every((agent) => STATUSES.has(agent.status) &&
      (agent.id === undefined || (typeof agent.id === "string" && agent.id.length > 0 && agent.id.length <= 128)) &&
      typeof agent.activity === "string" && agent.activity.length <= 80 && isRecentTool(agent.recentTool) &&
      Object.keys(agent).every((key) => ["id", "status", "activity", "recentTool"].includes(key)));
}

export function selectRoom(snapshots, currentSessionId, now = Date.now()) {
  return {
    currentSessionId,
    sessions: snapshots.filter((item) => item && now >= item.seenAt && now - item.seenAt < 35_000)
      .sort((a, b) => Number(b.sessionId === currentSessionId) -
        Number(a.sessionId === currentSessionId) || b.updatedAt - a.updatedAt)
      .slice(0, 32),
  };
}
