import { LIVE_AGENT_CLEARANCE } from "../game/live-layout";
import { LIVE_WALK_BOUNDS, liveNavigation } from "../game/live-navigation";
import type { Navigation } from "../game/navigation";
import type { Agent, Point } from "../game/simulation";
import { arrangeObservation, type Member } from "./observation-layout";
import { moveObservationAgent } from "./observation-movement";

export type Departure = { member: Member; agent: Agent; phrase: string; farewellLeft: number };
export type OfficeRoster = { members: Member[]; agents: Agent[]; departures: Departure[] };
export const FAREWELL_SECONDS = 1.8;
// Keep the renderer's retained identities within the read-only API's request bound.
export const MAX_TRACKED_AGENTS = 64;
export const LIVE_EXITS: readonly Point[] = [-1, 1].map(side => ({
  x: side * (LIVE_WALK_BOUNDS.maxX - LIVE_AGENT_CLEARANCE.x - 0.02),
  z: LIVE_WALK_BOUNDS.maxZ - LIVE_AGENT_CLEARANCE.z - 0.02,
}));

function exitRoute(agent: Agent, navigation: Navigation): Point[] | null {
  const choices = LIVE_EXITS.map(exit => navigation.route(agent, exit)).filter(route => route !== null);
  const length = (route: Point[]) => {
    let previous: Point = agent;
    let total = 0;
    for (const point of route) {
      total += Math.hypot(point.x - previous.x, point.z - previous.z);
      previous = point;
    }
    return total;
  };
  choices.sort((a, b) => length(a) - length(b));
  return choices[0] ?? null;
}

export function reconcileOffice(
  previous: OfficeRoster, incoming: readonly Member[], presence: Record<string, boolean> | undefined,
  navigation: Navigation = liveNavigation,
): OfficeRoster {
  const incomingIds = new Set(incoming.map(member => member.id));
  for (const member of [...previous.members, ...previous.departures.map(departure => departure.member)]) {
    if (!incomingIds.has(member.id) && typeof presence?.[member.id] !== "boolean") {
      throw new Error("Missing session presence; keeping the last office state.");
    }
  }
  const departures = previous.departures.filter(departure =>
    !incomingIds.has(departure.member.id) && presence?.[departure.member.id] === false);
  const leaving = previous.members.flatMap((member, index) =>
    !incomingIds.has(member.id) && presence?.[member.id] === false ?
      [{ member, agent: previous.agents[index], phrase: index % 2 ? "See you later!" : "Have a nice day!", farewellLeft: FAREWELL_SECONDS }] : []);
  if (incoming.length + departures.length + leaving.length > MAX_TRACKED_AGENTS) {
    throw new Error("Too many departing agents; waiting for the exits to clear.");
  }
  const reconnecting = previous.departures.filter(departure => incomingIds.has(departure.member.id));
  const arranged = arrangeObservation(
    [...previous.members, ...reconnecting.map(departure => departure.member)],
    [...previous.agents.slice(0, previous.members.length), ...reconnecting.map(departure => departure.agent)],
    incoming,
  );
  for (const departure of leaving) {
    departure.agent.taskId = undefined;
    departure.agent.route = [];
    departure.agent.navigationBlocked = false;
    departure.agent.state = "idle";
  }
  for (const departure of [...departures, ...leaving]) {
    if (departure.farewellLeft < FAREWELL_SECONDS && !departure.agent.navigationBlocked) continue;
    const route = exitRoute(departure.agent, navigation);
    departure.agent.route = route ?? [];
    departure.agent.navigationBlocked = route === null;
    if (route) {
      const target = route.at(-1) ?? departure.agent;
      departure.agent.target = { x: target.x, z: target.z };
    }
  }
  const nextDepartures = [...departures, ...leaving];
  return { ...arranged, agents: [...arranged.agents, ...nextDepartures.map(departure => departure.agent)], departures: nextDepartures };
}

export function advanceDepartures(roster: OfficeRoster, delta: number): boolean {
  const remaining = roster.departures.filter(departure => {
    if (departure.agent.navigationBlocked) return true;
    if (departure.farewellLeft > 0) {
      departure.farewellLeft = Math.max(0, departure.farewellLeft - delta);
      return true;
    }
    moveObservationAgent(departure.agent, delta);
    return departure.agent.route.length > 0 || !!departure.agent.seating;
  });
  if (remaining.length === roster.departures.length) return false;
  roster.departures = remaining;
  roster.agents = [...roster.agents.slice(0, roster.members.length), ...remaining.map(departure => departure.agent)];
  return true;
}
