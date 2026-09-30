import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../app/styles.css";
import "../live.css";
import "../observe.css";
import { Simulation, initialProgress, DESKS, COFFEE_SPOTS, type Agent, type Request } from "../game/simulation";
import { EXTRA_DESKS, LIVE_COFFEE_Z, MAX_LIVE_DESKS, MIN_LIVE_DESKS, assignLoungeSpots, routeAroundDividers } from "../game/live-layout";
import { sampleDaylight } from "../game/lighting";
import { AGENTCORP_LETTERS, AGENTCORP_MARK, AGENTCORP_WORDMARK } from "../game/sprite-art";
import { createWorld } from "../game/world";
import { arrangeObservation, newAgent, type Member } from "./observation-layout";
import { agentName, agentPersona } from "./room";

type Observation = { root: string; sessions: Member[]; overflow: number };
const desks = [...DESKS, ...EXTRA_DESKS];
const coffee = COFFEE_SPOTS.map(({ x }) => ({ x, z: LIVE_COFFEE_Z + 0.75 }));
const STEP = 1 / 30;
const themeKey = "agentcorp-harness-theme";
const wordmarkPaths = [...AGENTCORP_WORDMARK].map((letter, index) =>
  AGENTCORP_LETTERS[letter].flatMap((row, y) =>
    [...row].flatMap((bit, x) => bit === "1" ? [`M${index * 6 + x} ${y}h1v1h-1z`] : []),
  ).join(""));

function updateScene(scene: Simulation, members: Member[]) {
  const count = Math.min(members.length, MAX_LIVE_DESKS);
  scene.progress.capacity = count;
  scene.requests = [];
  const lounge = assignLoungeSpots(members.slice(MIN_LIVE_DESKS, count).map(member => member.phase === "idle"));
  for (let index = 0; index < count; index++) {
    const member = members[index];
    const sprite = scene.agents[index];
    if (!sprite) throw new Error(`Missing office agent for desk ${index + 1}`);
    const busy = member.phase !== "idle";
    const destination = busy ? desks[index] : index < MIN_LIVE_DESKS ? coffee[index] : lounge[index - MIN_LIVE_DESKS];
    if (!destination) throw new Error(`Missing office destination for desk ${index + 1}`);
    if (sprite.x === 100) { sprite.x = destination.x; sprite.z = destination.z; }
    if (sprite.target.x !== destination.x || sprite.target.z !== destination.z) {
      sprite.route = routeAroundDividers(sprite, destination);
    }
    sprite.target = { ...destination };
    sprite.taskId = busy ? index + 1 : undefined;
    if (busy) {
      const status: Request["status"] = member.phase === "blocked" ? "failed" :
        member.phase === "thinking" ? "assigned" : "working";
      scene.requests.push({ id: index + 1, stationId: index, title: member.phase,
        kind: "chat", status, progress: 0, reward: 0,
        ...(status === "failed" ? { resolvedAt: scene.time } : {}) });
    }
  }
}

function move(scene: Simulation) {
  for (let index = 0; index < scene.progress.capacity; index++) {
    const sprite = scene.agents[index];
    if (sprite.x === 100) continue;
    const point = sprite.route[0] ?? sprite.target;
    const distance = Math.hypot(point.x - sprite.x, point.z - sprite.z);
    const busy = sprite.taskId !== undefined;
    if (distance > 0.02) {
      const step = Math.min(distance, 2.05 * STEP);
      sprite.x += (point.x - sprite.x) / distance * step;
      sprite.z += (point.z - sprite.z) / distance * step;
      sprite.state = busy ? "walking" : "returning";
    } else {
      sprite.x = point.x; sprite.z = point.z;
      if (sprite.route.length) sprite.route.shift();
      sprite.state = sprite.route.length ? "returning" : busy ? "working" : "idle";
    }
  }
}

function Office() {
  const host = useRef<HTMLDivElement>(null);
  const manageButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panelOpener = useRef<HTMLButtonElement | null>(null);
  const restorePanelFocus = useRef(false);
  const world = useRef<ReturnType<typeof createWorld> | null>(null);
  const members = useRef<Member[]>([]);
  const [state, setState] = useState<Observation | null>(null);
  const [error, setError] = useState("");
  const [sceneError, setSceneError] = useState("");
  const [themeError, setThemeError] = useState("");
  const [selected, setSelected] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const hoverIndex = useRef<number | null>(null);
  const hoverLabel = useRef<HTMLDivElement>(null);
  const [previewOffset, setPreviewOffset] = useState(0);
  const previewRef = useRef(0);
  const [themePreference, setThemePreference] = useState<"system" | "light" | "dark">(() => {
    const saved = localStorage.getItem(themeKey);
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const selectedRef = useRef("");
  const darkTheme = themePreference === "system" ? systemDark : themePreference === "dark";
  useLayoutEffect(() => { document.documentElement.dataset.officeTheme = darkTheme ? "dark" : "light"; }, [darkTheme]);
  useLayoutEffect(() => {
    if (!panelOpen && restorePanelFocus.current) {
      restorePanelFocus.current = false;
      (panelOpener.current ?? manageButton.current)?.focus();
    }
  }, [panelOpen]);
  const clearSelection = () => {
    selectedRef.current = "";
    setSelected("");
    hoverIndex.current = null;
    setHover(null);
    world.current?.focusAgent(null);
  };
  const openPanel = (opener?: HTMLButtonElement) => {
    panelOpener.current = opener ?? null;
    setPanelOpen(true);
  };
  const closePanel = () => {
    restorePanelFocus.current = true;
    clearSelection();
    setPanelOpen(false);
  };
  const focusMember = (index: number, showPanel = false) => {
    const member = members.current[index];
    if (!member) {
      setError("Selected agent is no longer visible. The office will retry on the next update.");
      return;
    }
    selectedRef.current = member.id;
    setSelected(member.id);
    hoverIndex.current = null;
    setHover(null);
    world.current?.focusAgent(index);
    if (showPanel) openPanel();
  };
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelOpen]);
  const toggleTheme = () => {
    const next = darkTheme ? "light" : "dark";
    try {
      localStorage.setItem(themeKey, next);
      setThemePreference(next);
      setThemeError("");
    } catch (cause) {
      setThemeError(`Theme preference could not be saved: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  const previewLight = () => {
    previewRef.current = (previewRef.current + 0.25) % 1;
    setPreviewOffset(previewRef.current);
  };
  useEffect(() => {
    if (!host.current) return;
    const scene = new Simulation(initialProgress());
    scene.agents = Array.from({ length: MIN_LIVE_DESKS }, (_, i) => newAgent(i));
    scene.progress.capacity = 0;
    scene.progress.context = false;
    scene.progress.workflow = 1;
    try {
      world.current = createWorld(host.current, scene, "live", {
        onAgentHover(index) {
          if (selectedRef.current) {
            const focused = members.current.findIndex(member => member.id === selectedRef.current);
            index = focused < 0 ? null : focused;
          }
          if (hoverIndex.current === index) return;
          hoverIndex.current = index;
          const member = index === null ? undefined : members.current[index];
          const point = index === null ? null : world.current?.projectAgent(index);
          setHover(member && point ? { name: agentName(member.id), ...point } : null);
        },
        noticeActivityForStation(index) {
          const member = members.current[index];
          return member?.phase === "thinking" ? "thinking" :
            member?.phase === "tool" ? "working" :
            member?.phase === "blocked" ? "blocked" : null;
        },
        onAgentSelect(index) {
          focusMember(index, true);
        },
        onFocusCleared() {
          selectedRef.current = "";
          setSelected("");
          hoverIndex.current = null;
          setHover(null);
        },
      });
    } catch (cause) {
      host.current.classList.add("static-fallback");
      setSceneError(`3D office unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const response = await fetch("/api/observations", { cache: "no-store" });
        if (!response.ok) throw new Error(`Office returned ${response.status}`);
        const next = await response.json() as Observation;
        if (!Array.isArray(next.sessions) || next.sessions.length > MAX_LIVE_DESKS ||
          !Number.isSafeInteger(next.overflow) || next.overflow < 0) throw new Error("Invalid office snapshot");
        if (!active) return;
        const hoveredId = hoverIndex.current === null ? "" : members.current[hoverIndex.current]?.id ?? "";
        const arranged = arrangeObservation(members.current, scene.agents, next.sessions);
        members.current = arranged.members;
        scene.agents = arranged.agents;
        updateScene(scene, arranged.members);
        world.current?.capturePositions();
        arranged.members.forEach((member, index) => world.current?.setAgentPersona(index, agentPersona(member.id)));
        setState(next);
        setError("");
        const index = arranged.members.findIndex(member => member.id === selectedRef.current);
        if (selectedRef.current && index < 0) {
          const selectedRowHadFocus = document.activeElement?.matches('.observer-agent-row[aria-pressed="true"]');
          clearSelection();
          if (selectedRowHadFocus) closeButton.current?.focus();
        } else world.current?.focusAgent(index >= 0 ? index : null);
        const hoveredIndex = arranged.members.findIndex(member => member.id === hoveredId);
        hoverIndex.current = hoveredId && hoveredIndex >= 0 ? hoveredIndex : null;
        if (hoverIndex.current === null) setHover(null);
        else {
          const point = world.current?.projectAgent(hoveredIndex);
          setHover(point ? { name: agentName(hoveredId), ...point } : null);
        }
      } catch (cause) {
        if (active) setError(`Office update failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const poll = window.setInterval(() => void refresh(), 3_000);
    let frameId = 0;
    let last = performance.now();
    let remainder = 0;
    const frame = (now: number) => {
      remainder += Math.min((now - last) / 1000, 0.2);
      last = now;
      let advanced = false;
      if (!document.hidden) {
        while (remainder >= STEP) {
          world.current?.capturePositions();
          move(scene); scene.time += STEP;
          remainder -= STEP; advanced = true;
        }
        world.current?.render(now / 1000, previewRef.current, remainder / STEP, advanced);
        if (hoverIndex.current !== null && hoverLabel.current) {
          const point = world.current?.projectAgent(hoverIndex.current);
          hoverLabel.current.hidden = !point;
          if (point) {
            hoverLabel.current.style.left = `${point.x}px`;
            hoverLabel.current.style.top = `${point.y}px`;
          }
        }
      } else remainder = 0;
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => {
      active = false;
      window.clearInterval(poll);
      cancelAnimationFrame(frameId);
      world.current?.dispose();
      world.current = null;
    };
  }, []);
  const sessions = state?.sessions ?? [];
  const live = sessions.length;
  const working = sessions.filter(member => member.phase === "thinking" || member.phase === "tool").length;
  const idle = sessions.filter(member => member.phase === "idle").length;
  const blocked = sessions.filter(member => member.phase === "blocked").length;
  const overflow = state?.overflow ?? 0;
  const moreLabel = `${overflow} more session${overflow === 1 ? "" : "s"}`;
  const visualError = error || sceneError || themeError;
  const connected = !error && state !== null;
  const statusKind = visualError ? "error" : !state || !live ? "connecting" : "online";
  const statusLabel = visualError ? "Error" : !state ? "Connecting" : live ? "Live" : "No sessions";
  const daylight = sampleDaylight(0, previewOffset);
  return <main className={`shell live-shell observer-shell ${panelOpen ? "activity-visible" : ""}`}>
    <header className="topbar">
      <div className="identity">
        <span className="brand-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" shapeRendering="crispEdges" focusable="false">
            {AGENTCORP_MARK.flatMap(({ color, rects }, layer) =>
              rects.map(([x, y, width, height], index) =>
                <rect key={`${layer}-${index}`} x={x} y={y} width={width} height={height} fill={color} />))}
          </svg>
        </span>
        <svg className="brand-wordmark" viewBox={`0 0 ${AGENTCORP_WORDMARK.length * 6 - 1} 7`}
          role="img" aria-label="agentcorp" shapeRendering="crispEdges">
          {wordmarkPaths.map((path, index) =>
            <path key={index} d={path} fill={index < 5 ? "var(--office-text)" : "var(--office-purple)"} />)}
        </svg>
        <div className="identity-controls">
          <button type="button" className="time-preview" onClick={previewLight}
            title="Preview the next six hours of decorative office lighting"
            aria-label={`Office lighting ${daylight.label}; preview next six hours`}>
            <span className="time-icon" aria-hidden="true">{daylight.sun > 1 ? "☼" : daylight.moon > 0.2 ? "☾" : "◑"}</span>
            <span className="time-value">{daylight.label}</span>
            <span className="time-arrow" aria-hidden="true">↻</span>
          </button>
          <button type="button" className="theme-toggle" onClick={toggleTheme}
            aria-label={`Switch to ${darkTheme ? "light" : "dark"} theme`}
            title={`HUD appearance: ${themePreference === "system" ? "system" : themePreference}`}>
            <span aria-hidden="true">{darkTheme ? "☼" : "☾"}</span>
          </button>
        </div>
      </div>
      <div className="top-stats" aria-hidden={panelOpen} inert={panelOpen}>
        <span className="observer-count">{live} observed{overflow > 0 && ` · ${moreLabel}`}</span>
        <button type="button" ref={manageButton} className="system-toggle" aria-expanded={panelOpen} aria-controls="system-panel"
          aria-label={`Manage agents${blocked ? `: ${blocked} need attention` : ""}`}
          onClick={event => openPanel(event.currentTarget)}>Manage agents
          {blocked > 0 && <span className="activity-attention" aria-hidden="true">{blocked}</span>}
          <span className="toggle-chevron" aria-hidden="true" /></button>
      </div>
    </header>
    <div className="layout">
      <section className="world-panel" aria-label="Live Copilot office">
        <div className="world-host" ref={host}>
          {hover && <div ref={hoverLabel} className="agent-hover" style={{ left: hover.x, top: hover.y }}>{hover.name}</div>}
          <div className="world-callout live-callout" role="status" aria-live="polite">
            <button type="button" className={`office-status-link sdk-${statusKind}`}
              aria-label={`Observation status: ${statusLabel}. Open office overview`}
              title={visualError || "Read-only session activity"}
              onClick={event => openPanel(event.currentTarget)}>
              <span className="sdk-status-dot" aria-hidden="true" /> {statusLabel}
            </button>
            <span className="callout-separator" aria-hidden="true" />
            <span>{visualError || (!state ? "Connecting to local sessions…" : !live ?
              "No recent local AgentCorp heartbeats." :
              `${working} working · ${idle} idle${blocked ? ` · ${blocked} need attention` : ""}${overflow ? ` · ${moreLabel} not shown` : ""}`)}</span>
          </div>
        </div>
      </section>
      <aside id="system-panel" className={`sidebar activity-panel ${panelOpen ? "sidebar-open" : ""}`}
        aria-label="Office overview" aria-hidden={!panelOpen} inert={!panelOpen}>
        <div className="activity-header">
          <div className="activity-title-row">
            <h2>Overview</h2>
            <button type="button" ref={closeButton} className="sidebar-close" onClick={closePanel} aria-label="Close overview">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
            </button>
          </div>
        </div>
        <div className="activity-scroll activity-list-scroll">
          <section className="activity-view overview-list" aria-label="Office overview status">
            <div className="activity-row activity-row-first">
              <div className="activity-row-heading"><strong>Connection</strong>
                <span className={`activity-tag ${connected ? "activity-tag-live" : error ? "activity-tag-warning" : ""}`}>
                  {error ? "Needs attention" : !state ? "Connecting" : "Connected"}</span></div>
              {error && <p role="alert">{error}</p>}
              <div className="activity-chips"><span>{working} active</span><span>{idle} idle</span>
                <span className={blocked ? "attention" : ""}>{blocked} need attention</span></div>
            </div>
            {sceneError && <div className="activity-row">
              <div className="activity-row-heading"><strong>3D scene</strong>
                <span className="activity-tag activity-tag-warning">Unavailable</span></div>
              <p>{sceneError} Session observations remain available below.</p>
            </div>}
            {themeError && <div className="activity-row">
              <div className="activity-row-heading"><strong>HUD preference</strong>
                <span className="activity-tag activity-tag-warning">Not saved</span></div>
              <p>{themeError}</p>
            </div>}
            <div className="activity-row">
              <div className="activity-row-heading"><strong>Observed agents</strong>
                <span className="activity-tag">{sessions.length} shown</span></div>
              {overflow > 0 && <p>{moreLabel} not shown (16-desk limit).</p>}
              {sessions.length ? <div className="activity-list">
                {sessions.map(member => <button key={member.id} type="button"
                  className={`activity-worker-row observer-agent-row ${selected === member.id ? "worker-selected" : ""}`}
                  aria-pressed={selected === member.id} disabled={!!sceneError}
                  onClick={() => {
                    if (selectedRef.current === member.id) clearSelection();
                    else focusMember(members.current.findIndex(current => current.id === member.id));
                  }}>
                  <span className="worker-avatar" aria-hidden="true">{agentName(member.id).split(" ").map(part => part[0]).join("")}</span>
                  <span className="activity-worker-info">
                    <span className="activity-worker-title"><strong>{agentName(member.id)}</strong></span>
                    <span className="activity-worker-meta">{member.id === state?.root ? "This session" : "Local session"} · desk {members.current.findIndex(current => current.id === member.id) + 1}</span>
                  </span>
                  <span className={`activity-tag status-${member.phase}`}>{member.phase}</span>
                </button>)}
              </div> : <p className="activity-empty">{!state ? "Finding local sessions…" :
                "No recent local heartbeats. Sessions appear when they run the AgentCorp extension; resume or reload older sessions to start publishing."}</p>}
            </div>
            <div className="activity-row">
              <div className="activity-row-heading"><strong>Local observation</strong>
                <span className="activity-tag">Read only</span></div>
              <p>Fresh heartbeats from this Copilot home appear automatically across repositories and unrelated sessions. Only session IDs and activity phases are shared, never prompts, code, or titles. Offline sessions are hidden; missing heartbeats expire after 45 seconds.</p>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Office />);
