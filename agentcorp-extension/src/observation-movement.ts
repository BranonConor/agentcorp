import type { Agent, Point, Request, Simulation } from "../game/simulation";
import {
  LIVE_COFFEE_SPOTS, LIVE_DESKS, MAX_LIVE_DESKS, MIN_LIVE_DESKS,
  assignLoungeSpots, isLoungeSeat, walkingDestination,
} from "../game/live-layout";
import { liveNavigation } from "../game/live-navigation";
import type { Navigation } from "../game/navigation";
import type { Member } from "./observation-layout";

const samePoint = (a: Point, b: Point) => a.x === b.x && a.z === b.z;
const SEAT_SECONDS = 0.3;

export function updateObservationScene(
  scene: Simulation, members: readonly Member[], navigation: Navigation = liveNavigation,
): string[] {
  const count = Math.min(members.length, MAX_LIVE_DESKS);
  scene.progress.capacity = count;
  scene.requests = [];
  const errors: string[] = [];
  const lounge = assignLoungeSpots(members.slice(MIN_LIVE_DESKS, count).map(member => member.phase === "idle"));
  for (let index = 0; index < count; index++) {
    const member = members[index];
    const sprite = scene.agents[index];
    if (!sprite) throw new Error(`Missing office agent for desk ${index + 1}`);
    const busy = member.phase !== "idle";
    const destination = busy ? LIVE_DESKS[index] :
      index < MIN_LIVE_DESKS ? LIVE_COFFEE_SPOTS[index] : lounge[index - MIN_LIVE_DESKS];
    if (!destination) throw new Error(`Missing office destination for desk ${index + 1}`);
    const goal = walkingDestination(destination);
    sprite.taskId = busy ? index + 1 : undefined;
    if (sprite.x === 100) {
      sprite.target = { ...destination };
      sprite.route = [];
      sprite.navigationBlocked = !navigation.isWalkable(goal);
    } else if (!samePoint(sprite.target, destination) || sprite.navigationBlocked) {
      const route = navigation.route(sprite, goal);
      sprite.target = { ...destination };
      sprite.route = route ?? [];
      sprite.navigationBlocked = route === null;
      sprite.state = route?.length ? busy ? "walking" : "returning" : route ? busy ? "working" : "idle" : "idle";
    }
    if (sprite.navigationBlocked) errors.push(`No safe route for desk ${index + 1}; agent stopped. Retrying on the next office update.`);
    if (busy) {
      const status: Request["status"] = member.phase === "blocked" ? "failed" :
        member.phase === "thinking" ? "assigned" : "working";
      scene.requests.push({ id: index + 1, stationId: index, title: member.phase,
        kind: "chat", status, progress: 0, reward: 0,
        ...(status === "failed" ? { resolvedAt: scene.time } : {}) });
    }
  }
  return errors;
}

export function moveObservationAgent(sprite: Agent, delta: number, reducedMotion = false) {
  if (sprite.x === 100 || sprite.navigationBlocked) return;
  const busy = sprite.taskId !== undefined;
  const restingHere = !busy && isLoungeSeat(sprite.target) && sprite.route.length === 0;
  if (sprite.seating && (!restingHere || !samePoint(sprite.seating.position, sprite.target))) {
    // Finish standing at the old seat's approach before following a new route.
    sprite.seating.blend = reducedMotion ? 0 : Math.max(0, sprite.seating.blend - delta / SEAT_SECONDS);
    sprite.state = busy ? "walking" : "returning";
    if (sprite.seating.blend === 0) sprite.seating = undefined;
    return;
  }
  const point = sprite.route[0];
  if (point) {
    const distance = Math.hypot(point.x - sprite.x, point.z - sprite.z);
    const next = sprite.route[1];
    const bend = next && distance > 0 ? 1 - Math.max(-1, Math.min(1,
      ((point.x - sprite.x) * (next.x - point.x) + (point.z - sprite.z) * (next.z - point.z)) /
      (distance * Math.hypot(next.x - point.x, next.z - point.z) || 1))) : 2;
    const cornerSpeed = next ? Math.max(0.35, 2.05 * (1 - bend / 2)) : 0;
    const desired = Math.min(2.05, Math.sqrt(cornerSpeed ** 2 + 6 * distance));
    const oldSpeed = sprite.velocity ?? 0;
    sprite.velocity = oldSpeed + Math.max(-6 * delta, Math.min(3 * delta, desired - oldSpeed));
    const step = sprite.velocity * delta;
    if (distance > 1e-6) {
      const heading = Math.atan2(point.x - sprite.x, point.z - sprite.z);
      const turn = Math.atan2(Math.sin(heading - (sprite.heading ?? heading)), Math.cos(heading - (sprite.heading ?? heading)));
      sprite.heading = (sprite.heading ?? heading) + turn * (1 - Math.exp(-10 * delta));
    }
    if (distance <= step) {
      sprite.x = point.x; sprite.z = point.z;
      sprite.route.shift();
    } else {
      sprite.x += (point.x - sprite.x) / distance * step;
      sprite.z += (point.z - sprite.z) / distance * step;
    }
    // Never spend the remainder on another leg: render interpolation must not cut a corner.
    sprite.state = sprite.route.length ? busy ? "walking" : "returning" : busy ? "working" : "idle";
    return;
  }
  sprite.state = busy ? "working" : "idle";
  sprite.velocity = 0;
  sprite.arriving = false;
  if (restingHere) {
    sprite.seating ??= { position: { ...sprite.target }, blend: 0 };
    sprite.seating.blend = reducedMotion ? 1 : Math.min(1, sprite.seating.blend + delta / SEAT_SECONDS);
  }
}

export function moveObservationScene(scene: Simulation, delta: number) {
  for (let index = 0; index < scene.progress.capacity; index++) moveObservationAgent(scene.agents[index], delta);
}
