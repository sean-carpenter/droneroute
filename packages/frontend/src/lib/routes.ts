import type { MissionRoute, Waypoint } from "@droneroute/shared";
import { newId } from "@/lib/ids";

/**
 * Routes are named groups of waypoints. The mission is still one path: the
 * waypoints in order, each route's waypoints together, routes in list order.
 * These helpers keep that true after any change. Pure functions.
 */

/** Base name for a route made by a template, an import or by hand. */
export const ROUTE_KIND_NAMES: Record<string, string> = {
  manual: "Route",
  import: "Imported",
  orbit: "Orbit",
  grid: "Grid survey",
  facade: "Facade",
  pencil: "Pencil path",
  corridor: "Corridor",
  tower: "Tower",
};

/** "Facade", then "Facade 2", "Facade 3"... skipping names already taken. */
export function nextRouteName(kind: string, routes: MissionRoute[]): string {
  const base = ROUTE_KIND_NAMES[kind] ?? "Route";
  const taken = new Set(routes.map((r) => r.name));
  // Hand-made routes are always numbered: "Route 1"
  if (kind !== "manual" && !taken.has(base)) return base;
  for (let n = kind === "manual" ? 1 : 2; ; n++) {
    if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }
}

export function newRoute(kind: string, routes: MissionRoute[]): MissionRoute {
  return { id: newId(), name: nextRouteName(kind, routes), kind };
}

const AUTO_NAME = /^Waypoint \d+$/;

/**
 * Bring waypoints and routes in line: every waypoint belongs to a route that
 * exists (strays join the first route, which is made if there is none), each
 * route's waypoints sit together in route order, indices run 0..n-1, and
 * automatic names ("Waypoint 7") match the position.
 * Order within a route is kept. `from[i]` is the input position of the
 * waypoint now at position i.
 */
export function normalizeRoutes(
  waypoints: Waypoint[],
  routes: MissionRoute[],
): { waypoints: Waypoint[]; routes: MissionRoute[]; from: number[] } {
  let list = routes;
  const known = new Set(list.map((r) => r.id));
  if (waypoints.some((wp) => !wp.routeId || !known.has(wp.routeId))) {
    if (list.length === 0) list = [newRoute("manual", [])];
    known.add(list[0].id);
  }
  const fallback = list[0]?.id;
  const order = new Map(list.map((r, i) => [r.id, i]));
  const assigned = waypoints.map((wp) =>
    wp.routeId && known.has(wp.routeId) ? wp : { ...wp, routeId: fallback },
  );
  const ranked = assigned
    .map((wp, i) => ({ wp, i }))
    .sort(
      (a, b) =>
        order.get(a.wp.routeId!)! - order.get(b.wp.routeId!)! || a.i - b.i,
    );
  return {
    waypoints: ranked.map(({ wp }, index) => {
      // Automatic names ("Waypoint 7") follow the position; typed names stay
      const name = AUTO_NAME.test(wp.name) ? `Waypoint ${index + 1}` : wp.name;
      return wp.index === index && wp.name === name
        ? wp
        : { ...wp, index, name };
    }),
    routes: list,
    from: ranked.map(({ i }) => i),
  };
}

/** Waypoint indices of a route, in flight order. */
export function routeIndices(waypoints: Waypoint[], routeId: string): number[] {
  return waypoints.filter((wp) => wp.routeId === routeId).map((wp) => wp.index);
}
