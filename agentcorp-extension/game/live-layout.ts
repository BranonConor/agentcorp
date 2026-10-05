import { DESKS, COFFEE_SPOTS, type Point } from "./simulation";

export const LIVE_ROOM = { halfWidth: 9.4, back: -6.4, front: 7.2, windowY: 1.72 };
export const LIVE_FLOOR = { width: LIVE_ROOM.halfWidth * 2 - 0.18, depth: LIVE_ROOM.front - LIVE_ROOM.back - 0.18 };
export const LIVE_COFFEE_Z = -4.75;
export const LIVE_COFFEE_COUNTER = { width: 3.12, height: 1.82, y: 0.92, depth: 0.62 };
export const LIVE_COFFEE_SPOTS = COFFEE_SPOTS.map(({ x }) => ({ x, z: LIVE_COFFEE_Z + 0.75 }));
export const LIVE_DIVIDER_X = 3.45;
export const LIVE_DIVIDER_START_Z = 0.25;
export const LIVE_DIVIDER_END_Z = 5.15;
export const LIVE_DIVIDER_WIDTH = 0.3;
export const LIVE_LAMP = { width: 0.55, depth: 0.55, z: LIVE_DIVIDER_START_Z - 0.25 };
export const LIVE_BOOKCASE = { width: 1.38, depth: 0.3, z: LIVE_ROOM.back + 0.32 };
export const LIVE_BOOKCASE_XS = [-8.3, 8.3] as const;
export const LIVE_DIVIDER_PLANTS = [
  { x: -3, z: 5.55, size: 1.1 }, { x: 3, z: 5.55, size: 1.1 },
] as const;
export const LIVE_PLANTS = [
  { x: -6.6, z: LIVE_ROOM.back + 1.04, size: 1 }, { x: -4.4, z: LIVE_ROOM.back + 1.08, size: 0.84 },
  { x: 4.4, z: LIVE_ROOM.back + 1.08, size: 0.84 }, { x: 6.6, z: LIVE_ROOM.back + 1.04, size: 1 },
  ...LIVE_DIVIDER_PLANTS,
  { x: -8.2, z: 4.95, size: 0.92 }, { x: 8.2, z: 4.95, size: 0.92 },
] as const;
export const PLANT_FOOTPRINT = { width: 0.62, depth: 0.42 };
export const LIVE_STACKS = [{ x: -6.9, z: -3.5 }, { x: -6.55, z: -3.5 }] as const;
export const STACK_FOOTPRINT = { width: 0.65, depth: 0.4 };
export const DESK_SHAPE = { width: 1.55, height: 1.23, y: 0.58, z: -0.56, depth: 0.52 };
export const CHAIR_SHAPE = { width: 0.66, height: 0.94, y: 0.49, x: 0.35, z: 0.37, depth: 0.32 };
export const AGENT_SHADOW = { width: 0.6, depth: 0.38 };
// The opaque 22/32-pixel body in the 0.95-wide sprite, plus clearance.
export const LIVE_AGENT_CLEARANCE = { x: 0.35, z: AGENT_SHADOW.depth / 2 + 0.01 };

export const EXTRA_DESKS: readonly Point[] = [
  { x: -4.7, z: -0.35 }, { x: 4.7, z: -0.35 },
  { x: -6.8, z: -0.35 }, { x: 6.8, z: -0.35 },
  { x: -4.7, z: 1.65 }, { x: 4.7, z: 1.65 },
  { x: -6.8, z: 1.65 }, { x: 6.8, z: 1.65 },
  { x: -4.7, z: 3.65 }, { x: 4.7, z: 3.65 },
  { x: -6.8, z: 3.65 }, { x: 6.8, z: 3.65 },
];

export const MIN_LIVE_DESKS = 4;
export const MIN_VISIBLE_LIVE_DESKS = MIN_LIVE_DESKS + 4;
export const MAX_LIVE_DESKS = MIN_LIVE_DESKS + EXTRA_DESKS.length;
export const LIVE_DESKS: readonly Point[] = [...DESKS, ...EXTRA_DESKS];
export const LIVE_RUG_X = 6.1;
export const LIVE_LOUNGE_Z = 5.65;
export const LIVE_LOUNGE_SOFA_X = LIVE_RUG_X;
export const LIVE_LOUNGE_SEATS_PER_WING = 3;
export const LIVE_SOFA = {
  width: 3.08, height: 1.12, y: 0.56, backZ: LIVE_LOUNGE_Z - 0.23,
  frontZ: LIVE_LOUNGE_Z + 0.17, footprintZ: LIVE_LOUNGE_Z - 0.08, depth: 0.72,
};
export const LIVE_LOUNGE_APPROACH_Z = LIVE_SOFA.footprintZ + LIVE_SOFA.depth / 2 + LIVE_AGENT_CLEARANCE.z + 0.02;
const loungePositions: readonly Point[] = [
  { x: LIVE_LOUNGE_SOFA_X + 0.92, z: LIVE_LOUNGE_Z },
  { x: LIVE_LOUNGE_SOFA_X, z: LIVE_LOUNGE_Z },
  { x: LIVE_LOUNGE_SOFA_X - 0.92, z: LIVE_LOUNGE_Z },
  { x: 8.8, z: 5.95 },
  { x: 4.18, z: 6.2 },
  { x: 8.7, z: 4.1 },
];
export const LOUNGE_SPOTS: readonly Point[] = loungePositions.flatMap(({ x, z }) =>
  [{ x: -x, z }, { x, z }]);

export function assignLoungeSpots(idle: readonly boolean[]): (Point | null)[] {
  const occupied = [0, 0];
  return idle.map((isIdle, index) => {
    if (!isIdle) return null;
    const side = index % 2;
    const spot = LOUNGE_SPOTS[occupied[side]++ * 2 + side];
    if (!spot) throw new RangeError(`No lounge spot for wing worker ${index}`);
    return spot;
  });
}

export function isLoungeSeat(point: Point): boolean {
  return LOUNGE_SPOTS.some((seat, index) =>
    index < LIVE_LOUNGE_SEATS_PER_WING * 2 && seat.x === point.x && seat.z === point.z);
}

export function walkingDestination(destination: Point): Point {
  return isLoungeSeat(destination) ? { x: destination.x, z: LIVE_LOUNGE_APPROACH_Z } : { ...destination };
}

const DESK_PROPS = ["plant", "mug", "lamp", "books", "notes", "headphones"] as const;
export type DeskProp = typeof DESK_PROPS[number];

export function deskPropsFor(index: number): readonly [DeskProp, DeskProp] {
  const seed = (Math.imul(index + 19, 0x9e3779b1) ^ Math.imul(index + 7, 0x85ebca6b)) >>> 0;
  const first = seed % DESK_PROPS.length;
  const second = (first + 1 + ((seed >>> 8) % (DESK_PROPS.length - 1))) % DESK_PROPS.length;
  return [DESK_PROPS[first], DESK_PROPS[second]];
}

export function liveDeskCount(workers: number): number {
  return Math.max(MIN_VISIBLE_LIVE_DESKS, Math.min(MAX_LIVE_DESKS, workers));
}
