import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../app/styles.css";
import "../live.css";
import "../observe.css";
import { Simulation, initialProgress } from "../game/simulation";
import { MAX_LIVE_DESKS, MIN_LIVE_DESKS } from "../game/live-layout";
import { sampleDaylight } from "../game/lighting";
import { AGENTCORP_LETTERS, AGENTCORP_MARK, AGENTCORP_WORDMARK } from "../game/sprite-art";
import { createWorld } from "../game/world";
import { newAgent, type Member } from "./observation-layout";
import { advanceOffice, reconcileOffice, type OfficeRoster } from "./observation-departures";
import { updateObservationScene } from "./observation-movement";
import { OfficeTraffic } from "../game/traffic";
import { StatusBubbles, type OfficeBubble } from "./status-bubbles";
import { parsePreferences, reducedMotion, type PreferenceUpdate, type ViewerPreferences } from "./motion-preference";
import { SettingsMenu } from "./settings-menu";
import { agentName, agentPersona } from "./room";

type Observation = { root: string; sessions: Member[]; overflow: number; presence?: Record<string, boolean> };
const STEP = 1 / 30;
const themeKey = "agentcorp-harness-theme";
const wordmarkPaths = [...AGENTCORP_WORDMARK].map((letter, index) =>
  AGENTCORP_LETTERS[letter].flatMap((row, y) =>
    [...row].flatMap((bit, x) => bit === "1" ? [`M${index * 6 + x} ${y}h1v1h-1z`] : []),
  ).join(""));

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
  const [navigationError, setNavigationError] = useState("");
  const [trafficError, setTrafficError] = useState("");
  const [preferences, setPreferences] = useState<ViewerPreferences | null>(null);
  const [preferenceError, setPreferenceError] = useState("");
  const [savingPreference, setSavingPreference] = useState(false);
  const savingRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chatBubblesRef = useRef(true);
  chatBubblesRef.current = preferences?.chatBubbles ?? true;
  const [systemReduced, setSystemReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const motionReduced = reducedMotion(preferences?.motion ?? "system", systemReduced);
  const reducedRef = useRef(motionReduced);
  reducedRef.current = motionReduced;
  const [selected, setSelected] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const hoverIndex = useRef<number | null>(null);
  const hoverLabel = useRef<HTMLDivElement>(null);
  const farewellLabels = useRef(new Map<string, HTMLDivElement>());
  const [bubbles, setBubbles] = useState<OfficeBubble[]>([]);
  const [previewOffset, setPreviewOffset] = useState(0);
  const previewRef = useRef(0);
  const [legacyTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(themeKey);
      return { theme: saved === "light" || saved === "dark" ? saved : "system", error: "" };
    } catch (cause) {
      return { theme: "system", error: `Previous theme preference unavailable: ${String(cause)}` };
    }
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const selectedRef = useRef("");
  const themePreference = preferences?.theme ?? legacyTheme.theme;
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
    setSettingsOpen(false);
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
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(media.matches);
    media.addEventListener("change", update);
    const controller = new AbortController();
    void fetch("/api/preferences", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(await response.text());
        return parsePreferences(await response.json());
      }).then(saved => { if (!controller.signal.aborted) setPreferences(saved); })
      .catch(cause => { if (!controller.signal.aborted) setPreferenceError(`Preferences unavailable: ${String(cause)}`); });
    return () => { controller.abort(); media.removeEventListener("change", update); };
  }, []);
  useEffect(() => { world.current?.setReducedMotion(motionReduced); }, [motionReduced]);
  const savePreference = async (update: PreferenceUpdate) => {
    if (!preferences || savingRef.current) return;
    savingRef.current = true;
    setSavingPreference(true);
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update),
      });
      if (!response.ok) throw new Error(await response.text());
      setPreferences(parsePreferences(await response.json()));
      setPreferenceError("");
    } catch (cause) {
      setPreferenceError(`Preference not saved: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally { savingRef.current = false; setSavingPreference(false); }
  };
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
    let roster: OfficeRoster = { members: [], agents: [], departures: [] };
    const traffic = new OfficeTraffic();
    const statusBubbles = new StatusBubbles();
    let bubbleSignature = "";
    const syncRoster = () => {
      scene.agents = roster.agents;
      world.current?.capturePositions();
      [...roster.members, ...roster.departures.map(departure => departure.member)]
        .forEach((member, index) => world.current?.setAgentPersona(index, agentPersona(member.id)));
    };
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
      world.current.setReducedMotion(reducedRef.current);
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
        const query = new URLSearchParams();
        [...roster.members, ...roster.departures.map(departure => departure.member)]
          .forEach(member => query.append("presence", member.id));
        const response = await fetch(`/api/observations?${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Office returned ${response.status}`);
        const next = await response.json() as Observation;
        if (!Array.isArray(next.sessions) || next.sessions.length > MAX_LIVE_DESKS ||
          !Number.isSafeInteger(next.overflow) || next.overflow < 0) throw new Error("Invalid office snapshot");
        if (!active) return;
        const hoveredId = hoverIndex.current === null ? "" : members.current[hoverIndex.current]?.id ?? "";
        roster = reconcileOffice(roster, next.sessions, next.presence);
        members.current = roster.members;
        scene.agents = roster.agents;
        const routeErrors = updateObservationScene(scene, roster.members);
        if (roster.departures.some(departure => departure.agent.navigationBlocked)) {
          routeErrors.push("No safe exit route; departing agents stopped. Retrying on the next office update.");
        }
        setNavigationError(routeErrors.join(" "));
        syncRoster();
        setState(next);
        setError("");
        const index = roster.members.findIndex(member => member.id === selectedRef.current);
        if (selectedRef.current && index < 0) {
          const selectedRowHadFocus = document.activeElement?.matches('.observer-agent-row[aria-pressed="true"]');
          clearSelection();
          if (selectedRowHadFocus) closeButton.current?.focus();
        } else world.current?.focusAgent(index >= 0 ? index : null);
        const hoveredIndex = roster.members.findIndex(member => member.id === hoveredId);
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
          if (advanceOffice(roster, traffic, STEP, reducedRef.current)) syncRoster();
          scene.time += STEP;
          remainder -= STEP; advanced = true;
        }
        world.current?.render(now / 1000, previewRef.current, remainder / STEP, advanced);
        const activeBubbles = statusBubbles.update(roster, scene.time, chatBubblesRef.current);
        setTrafficError(traffic.error);
        const signature = activeBubbles.map(bubble => `${bubble.id}/${bubble.text}/${bubble.index}`).join("|");
        if (signature !== bubbleSignature) { bubbleSignature = signature; setBubbles(activeBubbles); }
        activeBubbles.forEach(bubble => {
          const label = farewellLabels.current.get(bubble.id);
          if (!label) return;
          const point = reducedRef.current ? world.current?.projectPosition(bubble.anchor) : world.current?.projectAgent(bubble.index);
          label.hidden = !point;
          if (point) {
            const halfWidth = label.offsetWidth / 2 + 8;
            label.style.left = `${Math.max(halfWidth, Math.min((host.current?.clientWidth ?? 0) - halfWidth, point.x))}px`;
            label.style.top = `${Math.max(label.offsetHeight + 24, point.y)}px`;
          }
        });
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
  const themeError = preferences?.theme ? "" : legacyTheme.error;
  const visualError = error || sceneError || navigationError || trafficError || preferenceError || themeError;
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
          <SettingsMenu open={settingsOpen} onOpenChange={setSettingsOpen} preferences={preferences}
            dark={darkTheme} reduced={motionReduced} saving={savingPreference}
            error={preferenceError || themeError} onSave={update => void savePreference(update)} />
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
          {(preferences?.chatBubbles ?? true) && bubbles.map(bubble => <div key={bubble.id}
            ref={element => {
              if (element) farewellLabels.current.set(bubble.id, element);
              else farewellLabels.current.delete(bubble.id);
            }}
            className="agent-hover agent-farewell" role="status"
            aria-label={`${agentName(bubble.id)} says: ${bubble.text}`}>
            {bubble.text}
          </div>)}
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
            {(navigationError || trafficError) && <div className="activity-row">
              <div className="activity-row-heading"><strong>Office movement</strong>
                <span className="activity-tag activity-tag-warning">Stopped</span></div>
              <p role="alert">{navigationError || trafficError}</p>
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
