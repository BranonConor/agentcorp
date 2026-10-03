import {
  CHAIR_SHAPE, DESK_SHAPE, LIVE_AGENT_CLEARANCE, LIVE_BOOKCASE, LIVE_BOOKCASE_XS,
  LIVE_COFFEE_COUNTER, LIVE_COFFEE_Z, LIVE_DESKS, LIVE_DIVIDER_END_Z,
  LIVE_DIVIDER_START_Z, LIVE_DIVIDER_WIDTH, LIVE_DIVIDER_X, LIVE_FLOOR, LIVE_LAMP,
  LIVE_LOUNGE_SOFA_X, LIVE_PLANTS, LIVE_ROOM, LIVE_SOFA, LIVE_STACKS,
  PLANT_FOOTPRINT, STACK_FOOTPRINT,
} from "./live-layout";
import { createNavigation, type Obstacle } from "./navigation";

const rectangle = (id: string, x: number, z: number, width: number, depth: number): Obstacle => ({
  id, minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2,
});

// Cutout furniture has no mesh depth. Use its ground/contact footprint, not the transparent sprite border.
export const LIVE_OBSTACLES: readonly Obstacle[] = [
  ...LIVE_DESKS.flatMap(({ x, z }, index) => [
    rectangle(`desk-${index}`, x, z + DESK_SHAPE.z, DESK_SHAPE.width, DESK_SHAPE.depth),
    rectangle(`chair-${index}`, x + CHAIR_SHAPE.x, z + CHAIR_SHAPE.z, CHAIR_SHAPE.width, CHAIR_SHAPE.depth),
  ]),
  ...[-1, 1].flatMap(side => [
    rectangle(`sofa-${side}`, side * LIVE_LOUNGE_SOFA_X, LIVE_SOFA.footprintZ, LIVE_SOFA.width, LIVE_SOFA.depth),
    rectangle(`divider-${side}`, side * LIVE_DIVIDER_X, (LIVE_DIVIDER_START_Z + LIVE_DIVIDER_END_Z) / 2,
      LIVE_DIVIDER_WIDTH, LIVE_DIVIDER_END_Z - LIVE_DIVIDER_START_Z),
    rectangle(`lamp-${side}`, side * LIVE_DIVIDER_X, LIVE_LAMP.z, LIVE_LAMP.width, LIVE_LAMP.depth),
  ]),
  rectangle("coffee-counter", 0, LIVE_COFFEE_Z, LIVE_COFFEE_COUNTER.width, LIVE_COFFEE_COUNTER.depth),
  ...LIVE_BOOKCASE_XS.map(x => rectangle(`bookcase-${x}`, x, LIVE_BOOKCASE.z + 0.01,
    LIVE_BOOKCASE.width, LIVE_BOOKCASE.depth + 0.02)),
  ...LIVE_PLANTS.map(({ x, z, size }, index) => rectangle(`plant-${index}`, x, z,
    PLANT_FOOTPRINT.width * size, PLANT_FOOTPRINT.depth * size)),
  ...LIVE_STACKS.map(({ x, z }, index) => rectangle(`stack-${index}`, x, z, STACK_FOOTPRINT.width, STACK_FOOTPRINT.depth)),
];
export const LIVE_WALK_BOUNDS = {
  minX: -LIVE_FLOOR.width / 2, maxX: LIVE_FLOOR.width / 2,
  minZ: LIVE_ROOM.back + 0.16, maxZ: LIVE_FLOOR.depth / 2,
};
export const liveNavigation = createNavigation(LIVE_OBSTACLES, LIVE_WALK_BOUNDS, LIVE_AGENT_CLEARANCE);
