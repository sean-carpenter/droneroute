import { describe, it, expect } from "vitest";
import type { MissionRoute, Waypoint } from "@droneroute/shared";
import { DEFAULT_WAYPOINT } from "@droneroute/shared";
import { nextRouteName, normalizeRoutes } from "./routes";

const wp = (name: string, routeId?: string): Waypoint => ({
  ...DEFAULT_WAYPOINT,
  index: -1,
  name,
  latitude: 42.5,
  longitude: -71,
  actions: [],
  ...(routeId ? { routeId } : {}),
});
const route = (id: string, kind = "manual"): MissionRoute => ({
  id,
  name: id,
  kind,
});

describe("route names", () => {
  it("names templates after themselves, numbering repeats", () => {
    expect(nextRouteName("facade", [])).toBe("Facade");
    expect(nextRouteName("facade", [{ ...route("a"), name: "Facade" }])).toBe(
      "Facade 2",
    );
    expect(nextRouteName("manual", [])).toBe("Route 1");
    expect(nextRouteName("manual", [{ ...route("a"), name: "Route 1" }])).toBe(
      "Route 2",
    );
  });
});

describe("normalizeRoutes", () => {
  it("puts older missions' waypoints into one new route", () => {
    const { waypoints, routes } = normalizeRoutes([wp("a"), wp("b")], []);
    expect(routes).toHaveLength(1);
    expect(routes[0].name).toBe("Route 1");
    expect(waypoints.map((w) => [w.name, w.routeId, w.index])).toEqual([
      ["a", routes[0].id, 0],
      ["b", routes[0].id, 1],
    ]);
  });

  it("keeps each route together, in route order, order within kept", () => {
    const { waypoints, from } = normalizeRoutes(
      [wp("b1", "B"), wp("a1", "A"), wp("b2", "B"), wp("a2", "A")],
      [route("A"), route("B")],
    );
    expect(waypoints.map((w) => w.name)).toEqual(["a1", "a2", "b1", "b2"]);
    expect(waypoints.map((w) => w.index)).toEqual([0, 1, 2, 3]);
    expect(from).toEqual([1, 3, 0, 2]);
  });

  it("gives strays to the first route", () => {
    const { waypoints } = normalizeRoutes(
      [wp("x", "gone"), wp("a", "A")],
      [route("A")],
    );
    expect(waypoints.every((w) => w.routeId === "A")).toBe(true);
  });
});

describe("waypoint names", () => {
  it("renumbers automatic names to their position, keeps typed ones", () => {
    const { waypoints } = normalizeRoutes(
      [wp("Waypoint 9", "B"), wp("Gable end", "A"), wp("Waypoint 1", "A")],
      [route("A"), route("B")],
    );
    expect(waypoints.map((w) => w.name)).toEqual([
      "Gable end",
      "Waypoint 2",
      "Waypoint 3",
    ]);
  });
});
