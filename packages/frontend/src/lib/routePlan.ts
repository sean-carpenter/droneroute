import type {
  MissionRoute,
  PointOfInterest,
  RoutePlan,
  SiteFeature,
  Waypoint,
} from "@droneroute/shared";
import {
  generateBoundaryFacade,
  generateCorridor,
  generateFacade,
  generateGrid,
  generateOrbit,
  generatePencil,
  generateTower,
  generateWalls,
  type BoundaryFacadeParams,
  type CorridorParams,
  type FacadeParams,
  type GridParams,
  type OrbitParams,
  type PencilParams,
  type TemplateResult,
  type TowerParams,
  type WallsParams,
} from "@/lib/templates";

/**
 * Route plans: what a template route was made from, so it can be made again.
 * Pure functions; the store keeps the plan on the route.
 */

/**
 * Bump when a generator change makes the same settings give different
 * waypoints, so older routes can say they were made by an earlier version.
 */
export const GENERATOR_VERSION = 1;

/** A generator and the settings it runs with. */
export type PlanInput =
  | { generator: "orbit"; params: OrbitParams }
  | { generator: "tower"; params: TowerParams }
  | { generator: "grid"; params: GridParams }
  | { generator: "corridor"; params: CorridorParams }
  | { generator: "facade"; params: FacadeParams }
  | { generator: "boundaryFacade"; params: BoundaryFacadeParams }
  | { generator: "walls"; params: WallsParams }
  | { generator: "pencil"; params: PencilParams };

/** A plan input plus the site feature it was built around, if any. */
export type PlanRequest = PlanInput & { targetFeatureId?: string };

/** Run the generator a plan names. The one place templates are dispatched. */
export function runPlan(
  input: PlanInput,
  pois: PointOfInterest[] = [],
): TemplateResult {
  switch (input.generator) {
    case "orbit":
      return generateOrbit(input.params, pois);
    case "tower":
      return generateTower(input.params, pois);
    case "grid":
      return generateGrid(input.params);
    case "corridor":
      return generateCorridor(input.params, pois);
    case "facade":
      return generateFacade(input.params, pois);
    case "boundaryFacade":
      return generateBoundaryFacade(input.params, pois);
    case "walls":
      return generateWalls(input.params, pois);
    case "pencil":
      return generatePencil(input.params, pois);
  }
}

/**
 * The input to run again for a stored plan. A route built around a site
 * feature follows that feature's current outline; if the feature is gone,
 * the outline saved with the plan is used.
 */
export function planInputFor(
  plan: RoutePlan,
  siteFeatures: SiteFeature[],
): PlanInput {
  // The settings were saved by this module from a PlanInput, and the server
  // checks the generator name, so reading them back as one is safe
  const input = {
    generator: plan.generator,
    params: plan.params,
  } as unknown as PlanInput;
  if (
    input.generator === "boundaryFacade" &&
    input.params.boundary === "polygon" &&
    plan.targetFeatureId
  ) {
    const feature = siteFeatures.find((f) => f.id === plan.targetFeatureId);
    if (feature) {
      return {
        generator: "boundaryFacade",
        params: { ...input.params, vertices: feature.vertices },
      };
    }
  }
  return input;
}

/**
 * Keep the target only when the route really goes around it: the outline
 * used is the feature's outline as it is now.
 */
export function confirmedTarget(
  input: PlanInput,
  targetFeatureId: string | undefined,
  siteFeatures: SiteFeature[],
): string | undefined {
  if (!targetFeatureId) return undefined;
  if (input.generator !== "boundaryFacade") return undefined;
  if (input.params.boundary !== "polygon") return undefined;
  const feature = siteFeatures.find((f) => f.id === targetFeatureId);
  if (!feature) return undefined;
  return sameJson(feature.vertices, input.params.vertices)
    ? targetFeatureId
    : undefined;
}

function sameJson(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** JSON with object keys sorted, so equal values always print the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
    );
  return `{${entries.join(",")}}`;
}

/** cyrb53: a small, fast, non-cryptographic 53-bit string hash. */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** Waypoint fields that follow the list position, not the flight. */
const POSITIONAL_KEYS = new Set(["index", "name", "routeId"]);

/**
 * Fingerprint of a route's waypoints: everything that is flown, not the
 * list position or the automatic name, which change when other routes do.
 */
export function waypointsFingerprint(
  waypoints: Omit<Waypoint, "index" | "name">[],
): string {
  const flown = waypoints.map((wp) =>
    Object.fromEntries(
      Object.entries(wp).filter(([key]) => !POSITIONAL_KEYS.has(key)),
    ),
  );
  return cyrb53(stableStringify(flown));
}

/** True when a template route's waypoints no longer match what it generated. */
export function routeEdited(
  route: MissionRoute,
  waypoints: Waypoint[],
): boolean {
  if (!route.plan) return false;
  const members = waypoints.filter((wp) => wp.routeId === route.id);
  return waypointsFingerprint(members) !== route.plan.waypointsHash;
}

/**
 * How close to a structure the route was planned to fly, for routes that
 * fly beside one: the standoff warning then applies this distance instead of
 * the general one. Undefined for routes with no planned standoff.
 */
export function routeStandoffM(
  plan: RoutePlan | undefined,
): number | undefined {
  if (!plan) return undefined;
  const params = plan.params as Record<string, unknown>;
  if (plan.generator === "facade" && typeof params.distanceM === "number") {
    return params.distanceM;
  }
  if (
    plan.generator === "boundaryFacade" &&
    typeof params.standoffM === "number"
  ) {
    return params.standoffM;
  }
  if (plan.generator === "walls" && Array.isArray(params.walls)) {
    const distances = (params.walls as { distanceM?: unknown }[])
      .map((w) => w.distanceM)
      .filter((d): d is number => typeof d === "number");
    return distances.length > 0 ? Math.min(...distances) : undefined;
  }
  return undefined;
}

/**
 * Share of a route's planned standoff it may come within before the
 * standoff warning fires: room for rounding, and for corners beveled by the
 * outward path.
 */
export const STANDOFF_TOLERANCE = 0.9;

/**
 * Standoff to check each waypoint against, by waypoint index: the route's
 * own planned standoff where it has one (never more than the general
 * distance), otherwise the general distance.
 */
export function standoffByWaypoint(
  waypoints: Pick<Waypoint, "index" | "routeId">[],
  routes: MissionRoute[],
  generalM: number,
): (index: number) => number {
  const byRoute = new Map<string, number>();
  for (const route of routes) {
    const planned = routeStandoffM(route.plan);
    if (planned !== undefined) {
      byRoute.set(route.id, Math.min(generalM, planned * STANDOFF_TOLERANCE));
    }
  }
  const byIndex = new Map<number, number>();
  for (const wp of waypoints) {
    const own = wp.routeId ? byRoute.get(wp.routeId) : undefined;
    if (own !== undefined) byIndex.set(wp.index, own);
  }
  return (index) => byIndex.get(index) ?? generalM;
}

/** True when the route was made by an earlier version of its generator. */
export function planOutdated(plan: RoutePlan): boolean {
  return plan.generatorVersion !== GENERATOR_VERSION;
}
