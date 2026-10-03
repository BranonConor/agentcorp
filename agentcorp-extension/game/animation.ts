import type { Agent, Point } from "./simulation";
import { walkingDestination } from "./live-layout";

/** Seating is a visual interaction from a walkable approach, never a walk through the sofa. */
export function agentPosition(agent: Agent): Point {
  const seat = agent.seating;
  if (!seat) return { x: agent.x, z: agent.z };
  const approach = walkingDestination(seat.position);
  return {
    x: agent.x + (seat.position.x - approach.x) * seat.blend,
    z: agent.z + (seat.position.z - approach.z) * seat.blend,
  };
}

export function interpolatePosition(previous: Point | undefined, current: Point, alpha: number): Point {
  if (!previous) return current;
  const blend = Math.max(0, Math.min(1, alpha));
  return {
    x: previous.x + (current.x - previous.x) * blend,
    z: previous.z + (current.z - previous.z) * blend,
  };
}
