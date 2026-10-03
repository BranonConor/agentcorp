import { isLoungeSeat, LIVE_AGENT_CLEARANCE, walkingDestination } from "./live-layout";
import { LIVE_WALK_BOUNDS, liveNavigation } from "./live-navigation";
import type { Navigation, Obstacle } from "./navigation";
import type { Agent, Point } from "./simulation";
import { agentPosition } from "./animation";
import { moveObservationAgent } from "../src/observation-movement";

export const OFFICE_ENTRANCES: readonly Point[] = [-1, 1].map(side => ({
  x: side * (LIVE_WALK_BOUNDS.maxX - LIVE_AGENT_CLEARANCE.x - 0.02),
  z: LIVE_WALK_BOUNDS.maxZ - LIVE_AGENT_CLEARANCE.z - 0.02,
}));
const GAP = 0.015;
const separation = { x: LIVE_AGENT_CLEARANCE.x * 2 + GAP, z: LIVE_AGENT_CLEARANCE.z * 2 + GAP };
const copy = ({ x, z }: Point): Point => ({ x, z });
const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;

/** Separating axes for two rectangles swept along arbitrary segments, including crossing traffic. */
export function sweptAgentsOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
  const axes = [{ x: 1, z: 0 }, { x: 0, z: 1 },
    { x: a.z - b.z, z: b.x - a.x }, { x: c.z - d.z, z: d.x - c.x }];
  return axes.every(axis => {
    const project = (p: Point) => p.x * axis.x + p.z * axis.z;
    const margin = separation.x * Math.abs(axis.x) + separation.z * Math.abs(axis.z);
    return Math.min(project(a), project(b)) <= Math.max(project(c), project(d)) + margin &&
      Math.min(project(c), project(d)) <= Math.max(project(a), project(b)) + margin;
  });
}

function pathsOverlap(a: readonly Point[], b: readonly Point[]): boolean {
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    if (sweptAgentsOverlap(a[i - 1], a[i], b[j - 1], b[j])) return true;
  }
  return false;
}

const occupiedPath = (agent: Agent): Point[] => {
  const position = agentPosition(agent);
  const mustStand = agent.seating && (agent.seating.blend < 1 || agent.route.length > 0 ||
    agent.taskId !== undefined || !same(agent.seating.position, agent.target));
  // A waiting sitter still owns its way out; another arrival must not block that approach.
  return [position, mustStand ? copy(agent) : position];
};
const body = (agent: Agent): Obstacle => {
  const [from, to] = occupiedPath(agent);
  return {
    id: `agent-${agent.id}`,
    minX: Math.min(from.x, to.x) - LIVE_AGENT_CLEARANCE.x - GAP, maxX: Math.max(from.x, to.x) + LIVE_AGENT_CLEARANCE.x + GAP,
    minZ: Math.min(from.z, to.z) - LIVE_AGENT_CLEARANCE.z - GAP, maxZ: Math.max(from.z, to.z) + LIVE_AGENT_CLEARANCE.z + GAP,
  };
};
const journey = (agent: Agent, route: readonly Point[], seat?: Point) =>
  [agentPosition(agent), copy(agent), ...route, ...(seat ? [seat] : [])];
const seatDestination = (agent: Agent) => agent.taskId === undefined && isLoungeSeat(agent.target) ? copy(agent.target) : undefined;
const interactionComplete = (agent: Agent, seat?: Point) => seat ?
  agent.seating?.blend === 1 && same(agent.seating.position, seat) : !agent.seating;
const atRest = (agent: Agent) => !agent.route.length && same(agent, walkingDestination(agent.target)) &&
  interactionComplete(agent, seatDestination(agent));
const routeLength = (from: Point, route: readonly Point[]) =>
  route.reduce((sum, point, i) => sum + Math.hypot(point.x - (route[i - 1] ?? from).x, point.z - (route[i - 1] ?? from).z), 0);

type Reservation = { target: Point; route: Point[]; seat?: Point };

/** Reserve disjoint swept routes, not just this frame's positions. Conflicting traffic waits its turn. */
export class OfficeTraffic {
  private reservations = new Map<Agent, Reservation>();
  private priority: Agent | undefined;
  private planIn = 0;
  private stalled = 0;
  private bays: Point[];
  error = "";

  constructor(private navigation: Navigation = liveNavigation) {
    this.bays = [];
    for (let x = LIVE_WALK_BOUNDS.minX + 0.6; x < LIVE_WALK_BOUNDS.maxX - 0.6; x += 0.7) {
      for (let z = LIVE_WALK_BOUNDS.minZ + 0.4; z < LIVE_WALK_BOUNDS.maxZ - 0.4; z += 0.5) {
        if (navigation.isWalkable({ x, z })) this.bays.push({ x, z });
      }
    }
  }

  step(agents: readonly Agent[], delta: number, canMove: (agent: Agent) => boolean = () => true, reduced = false) {
    let admitted = false;
    if (this.priority && !agents.includes(this.priority)) this.priority = undefined;
    for (const [agent, reservation] of this.reservations) {
      if (!agents.includes(agent) || !canMove(agent) || !same(agent.target, reservation.target) ||
        agent.route !== reservation.route || (!agent.route.length && interactionComplete(agent, reservation.seat))) {
        this.reservations.delete(agent);
        this.planIn = 0;
      }
    }
    const visible = () => agents.filter(agent => agent.x !== 100);
    for (const agent of agents.filter(agent => this.planIn <= delta && agent.x === 100 && canMove(agent) && !agent.navigationBlocked)) {
      const entrances = OFFICE_ENTRANCES.map(point => ({ point, route: this.navigation.route(point, walkingDestination(agent.target)) }))
        .filter(entry => entry.route !== null)
        .sort((a, b) => routeLength(a.point, a.route!) - routeLength(b.point, b.route!));
      const free = entrances.find(({ point }) =>
        visible().every(other => !pathsOverlap([point, point], occupiedPath(other))) &&
        [...this.reservations].every(([other, reservation]) =>
          !pathsOverlap([point, point], journey(other, other.route, reservation.seat))));
      if (free) {
        admitted = true;
        agent.x = free.point.x; agent.z = free.point.z;
        agent.route = free.route!;
        this.planIn = 0;
      }
    }
    this.planIn -= delta;
    if (this.planIn <= 0) {
      this.planIn = 0.3;
      this.plan(visible(), canMove);
    }
    let progress = false;
    for (const agent of visible()) {
      if (!canMove(agent) || agent.navigationBlocked) { agent.velocity = 0; continue; }
      const reservation = this.reservations.get(agent);
      const resting = atRest(agent);
      agent.yielding = !reservation && !resting;
      if (reservation || resting) {
        if (!reservation) agent.route = [];
        const before = agentPosition(agent);
        moveObservationAgent(agent, delta, reduced);
        progress ||= !same(before, agentPosition(agent));
      } else {
        agent.velocity = 0;
        agent.state = "idle";
      }
    }
    this.stalled = progress ? 0 : this.stalled + delta;
    this.error = this.stalled > 12 && visible().some(agent => agent.yielding && canMove(agent)) ?
      "Office traffic is waiting for a clear route; agents remain stopped safely." : "";
    return admitted;
  }

  private plan(agents: readonly Agent[], canMove: (agent: Agent) => boolean) {
    const pending = agents.filter(agent => canMove(agent) && !agent.navigationBlocked &&
      !this.reservations.has(agent) && !atRest(agent));
    pending.sort((a, b) => Number(b === this.priority) - Number(a === this.priority) || a.id - b.id);
    for (const agent of pending) {
      const others = agents.filter(other => other !== agent);
      const route = this.navigation.route(agent, walkingDestination(agent.target), others.map(body));
      const seat = seatDestination(agent);
      if (!route) continue;
      const path = journey(agent, route, seat);
      if (others.some(other => pathsOverlap(path, occupiedPath(other))) ||
        [...this.reservations].some(([other, reservation]) =>
          pathsOverlap(path, journey(other, other.route, reservation.seat)))) continue;
      agent.route = route;
      this.reservations.set(agent, { target: copy(agent.target), route, seat });
      if (this.priority === agent) this.priority = undefined;
    }
    if (this.reservations.size || !pending.length) return;
    // A head-on pair (or an occupied destination) needs a pull-over, not mutual waiting.
    for (const waiting of pending) {
      const route = this.navigation.route(waiting, walkingDestination(waiting.target));
      if (!route) continue;
      const path = journey(waiting, route, seatDestination(waiting));
      const blockers = agents.filter(other => other !== waiting && canMove(other) &&
        pathsOverlap(path, occupiedPath(other)));
      for (const blocker of blockers) {
        const others = agents.filter(other => other !== blocker);
        const bays = this.bays.filter(point => Math.hypot(point.x - blocker.x, point.z - blocker.z) > 0.7 &&
          !pathsOverlap(path, [point, point]) &&
          others.every(other => !sweptAgentsOverlap(point, point, walkingDestination(other.target), walkingDestination(other.target))));
        bays.sort((a, b) => Math.hypot(a.x - blocker.x, a.z - blocker.z) - Math.hypot(b.x - blocker.x, b.z - blocker.z));
        for (const bay of bays) {
          const detour = this.navigation.route(blocker, bay, others.map(body));
          if (!detour || others.some(other => pathsOverlap(journey(blocker, detour), occupiedPath(other)))) continue;
          blocker.route = detour;
          this.reservations.set(blocker, { target: copy(blocker.target), route: detour });
          this.priority = waiting;
          return;
        }
      }
    }
  }
}
