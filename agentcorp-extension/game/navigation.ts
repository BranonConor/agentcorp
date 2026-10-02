import type { Point } from "./simulation";

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Obstacle = Bounds & { id: string };
const CORNER_MARGIN = 0.005;

function contains(bounds: Bounds, point: Point): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX &&
    point.z >= bounds.minZ && point.z <= bounds.maxZ;
}

export function intersects(from: Point, to: Point, bounds: Bounds): boolean {
  let enter = 0;
  let exit = 1;
  for (const [start, end, min, max] of [
    [from.x, to.x, bounds.minX, bounds.maxX],
    [from.z, to.z, bounds.minZ, bounds.maxZ],
  ]) {
    const delta = end - start;
    if (delta === 0) {
      if (start < min || start > max) return false;
    } else {
      const a = (min - start) / delta;
      const b = (max - start) / delta;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) return false;
    }
  }
  return true;
}

/** A visibility graph of furniture corners; every edge checks the whole swept body. */
export function createNavigation(obstacles: readonly Obstacle[], room: Bounds, clearance: Point) {
  const bounds = {
    minX: room.minX + clearance.x, maxX: room.maxX - clearance.x,
    minZ: room.minZ + clearance.z, maxZ: room.maxZ - clearance.z,
  };
  const inflate = (obstacle: Obstacle) => ({
    ...obstacle,
    minX: obstacle.minX - clearance.x, maxX: obstacle.maxX + clearance.x,
    minZ: obstacle.minZ - clearance.z, maxZ: obstacle.maxZ + clearance.z,
  });
  const inflated = obstacles.map(inflate);
  const isWalkable = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.z) &&
    contains(bounds, point) && !inflated.some(obstacle => contains(obstacle, point));
  const segmentClear = (from: Point, to: Point) => isWalkable(from) && isWalkable(to) &&
    !inflated.some(obstacle => intersects(from, to, obstacle));
  const rectangleCorners = ({ minX, maxX, minZ, maxZ }: Bounds) => [
    { x: minX - CORNER_MARGIN, z: minZ - CORNER_MARGIN },
    { x: maxX + CORNER_MARGIN, z: minZ - CORNER_MARGIN },
    { x: minX - CORNER_MARGIN, z: maxZ + CORNER_MARGIN },
    { x: maxX + CORNER_MARGIN, z: maxZ + CORNER_MARGIN },
  ];
  const corners = inflated.flatMap(rectangleCorners).filter(isWalkable);
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
  const edges = corners.map(() => [] as { to: number; distance: number }[]);
  corners.forEach((from, i) => {
    for (let j = i + 1; j < corners.length; j++) {
      if (!segmentClear(from, corners[j])) continue;
      const length = distance(from, corners[j]);
      edges[i].push({ to: j, distance: length });
      edges[j].push({ to: i, distance: length });
    }
  });

  const route = (from: Point, to: Point, blockers: readonly Obstacle[] = []): Point[] | null => {
    const dynamic = blockers.map(inflate);
    const clearDynamic = (a: Point, b: Point) => !dynamic.some(obstacle => intersects(a, b, obstacle));
    const clear = (a: Point, b: Point) => segmentClear(a, b) && clearDynamic(a, b);
    if (!isWalkable(from) || !isWalkable(to) || !clearDynamic(from, from) || !clearDynamic(to, to)) return null;
    if (from.x === to.x && from.z === to.z) return [];
    if (clear(from, to)) return [{ ...to }];
    const extra = dynamic.flatMap(rectangleCorners).filter(point => isWalkable(point) && clearDynamic(point, point));
    const vertices = [...corners, ...extra];
    const nodes = [...vertices, from, to];
    const start = vertices.length;
    const end = start + 1;
    const links = [...edges.map((edge, i) => edge.filter(link => clearDynamic(corners[i], corners[link.to]))),
      ...extra.map(() => [] as { to: number; distance: number }[]), [], []];
    for (let i = corners.length; i < vertices.length; i++) {
      for (let j = 0; j < i; j++) {
        if (!clear(vertices[i], vertices[j])) continue;
        const length = distance(vertices[i], vertices[j]);
        links[i].push({ to: j, distance: length });
        links[j].push({ to: i, distance: length });
      }
    }
    for (let i = 0; i < vertices.length; i++) {
      if (clear(from, vertices[i])) links[start].push({ to: i, distance: distance(from, vertices[i]) });
      if (clear(vertices[i], to)) links[i].push({ to: end, distance: distance(vertices[i], to) });
    }
    const costs = nodes.map(() => Infinity);
    const previous = nodes.map(() => -1);
    const visited = new Set<number>();
    costs[start] = 0;
    while (true) {
      let current = -1;
      for (let i = 0; i < nodes.length; i++) {
        if (!visited.has(i) && Number.isFinite(costs[i]) &&
          (current === -1 || costs[i] < costs[current])) current = i;
      }
      if (current === -1) return null;
      if (current === end) {
        const path: Point[] = [];
        for (let i = end; i !== start; i = previous[i]) path.unshift({ ...nodes[i] });
        return path;
      }
      visited.add(current);
      for (const edge of links[current]) {
        const cost = costs[current] + edge.distance;
        if (cost < costs[edge.to]) {
          costs[edge.to] = cost;
          previous[edge.to] = current;
        }
      }
    }
  };
  return { route, isWalkable, segmentClear };
}

export type Navigation = ReturnType<typeof createNavigation>;
