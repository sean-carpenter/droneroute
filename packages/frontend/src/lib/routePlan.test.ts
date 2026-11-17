import { describe, it, expect } from "vitest";
import type { RoutePlan, SiteFeature } from "@droneroute/shared";
import {
  DEFAULT_CORRIDOR_PARAMS,
  DEFAULT_FACADE_PARAMS,
  DEFAULT_GRID_PARAMS,
  DEFAULT_ORBIT_PARAMS,
  DEFAULT_PENCIL_PARAMS,
  DEFAULT_TOWER_PARAMS,
  generateBoundaryFacade,
  generateCorridor,
  generateFacade,
  generateGrid,
  generateOrbit,
  generatePencil,
  generateTower,
  polygonFacadeAround,
} from "./templates";
import {
  confirmedTarget,
  planInputFor,
  routeEdited,
  runPlan,
  stableStringify,
  waypointsFingerprint,
  type PlanInput,
} from "./routePlan";

const HOUSE: [number, number][] = [
  [42.559, -71.078],
  [42.559, -71.0778],
  [42.5592, -71.0778],
  [42.5592, -71.078],
];

const feature = (vertices = HOUSE): SiteFeature => ({
  id: "house",
  name: "House",
  kind: "existing",
  color: "#64748b",
  vertices,
  heightM: 8,
  isObstacle: true,
  source: "manual",
});

const PATH: [number, number][] = [
  [42.559, -71.078],
  [42.5595, -71.0775],
  [42.56, -71.078],
];

describe("runPlan", () => {
  it("gives exactly what calling each generator directly gives", () => {
    const orbit = {
      ...DEFAULT_ORBIT_PARAMS,
      center: [42.559, -71.078] as [number, number],
      radiusM: 25,
    };
    const tower = {
      ...DEFAULT_TOWER_PARAMS,
      center: [42.559, -71.078] as [number, number],
      radiusM: 8,
    };
    const grid = {
      ...DEFAULT_GRID_PARAMS,
      corner1: HOUSE[0],
      corner2: HOUSE[2],
    };
    const corridor = { ...DEFAULT_CORRIDOR_PARAMS, path: PATH };
    const facade = {
      ...DEFAULT_FACADE_PARAMS,
      point1: HOUSE[0],
      point2: HOUSE[1],
    };
    const around = polygonFacadeAround(HOUSE, 8);
    const pencil = { ...DEFAULT_PENCIL_PARAMS, path: PATH };

    const cases: [PlanInput, unknown][] = [
      [{ generator: "orbit", params: orbit }, generateOrbit(orbit)],
      [{ generator: "tower", params: tower }, generateTower(tower)],
      [{ generator: "grid", params: grid }, generateGrid(grid)],
      [{ generator: "corridor", params: corridor }, generateCorridor(corridor)],
      [{ generator: "facade", params: facade }, generateFacade(facade)],
      [
        { generator: "boundaryFacade", params: around },
        generateBoundaryFacade(around),
      ],
      [{ generator: "pencil", params: pencil }, generatePencil(pencil)],
    ];
    for (const [input, direct] of cases) {
      const result = runPlan(input);
      expect(result.waypoints.length, input.generator).toBeGreaterThan(0);
      expect(result, input.generator).toEqual(direct);
    }
  });

  it("survives a save: settings read back from JSON give the same waypoints", () => {
    const input: PlanInput = {
      generator: "boundaryFacade",
      params: polygonFacadeAround(HOUSE, 8),
    };
    const reloaded = JSON.parse(JSON.stringify(input)) as PlanInput;
    expect(waypointsFingerprint(runPlan(reloaded).waypoints)).toBe(
      waypointsFingerprint(runPlan(input).waypoints),
    );
  });
});

describe("targets", () => {
  const plan = (targetFeatureId?: string): RoutePlan => ({
    generator: "boundaryFacade",
    params: polygonFacadeAround(HOUSE, 8) as unknown as Record<string, unknown>,
    targetFeatureId,
    generatorVersion: 1,
    waypointsHash: "x",
  });

  it("goes around the feature's current outline", () => {
    const moved = HOUSE.map(([lat, lng]) => [lat + 0.0001, lng]) as [
      number,
      number,
    ][];
    const input = planInputFor(plan("house"), [feature(moved)]);
    expect(input.generator === "boundaryFacade" && input.params).toMatchObject({
      vertices: moved,
    });
  });

  it("falls back to the saved outline when the feature is gone", () => {
    const input = planInputFor(plan("house"), []);
    expect(input.params).toMatchObject({ vertices: HOUSE });
  });

  it("keeps a target only when the route uses that outline", () => {
    const input: PlanInput = {
      generator: "boundaryFacade",
      params: polygonFacadeAround(HOUSE, 8),
    };
    expect(confirmedTarget(input, "house", [feature()])).toBe("house");
    expect(confirmedTarget(input, "house", [])).toBeUndefined();
    const edited: PlanInput = {
      generator: "boundaryFacade",
      params: { ...polygonFacadeAround(HOUSE, 8), vertices: HOUSE.slice(0, 3) },
    };
    expect(confirmedTarget(edited, "house", [feature()])).toBeUndefined();
    expect(
      confirmedTarget(
        {
          generator: "orbit",
          params: { ...DEFAULT_ORBIT_PARAMS, center: HOUSE[0], radiusM: 9 },
        },
        "house",
        [feature()],
      ),
    ).toBeUndefined();
  });
});

describe("fingerprints", () => {
  const { waypoints } = generatePencil({
    ...DEFAULT_PENCIL_PARAMS,
    path: PATH,
  });

  it("ignores list position, names and route, not what is flown", () => {
    const placed = waypoints.map((wp, i) => ({
      ...wp,
      index: i + 7,
      name: `Waypoint ${i + 8}`,
      routeId: "r1",
    }));
    expect(waypointsFingerprint(placed)).toBe(waypointsFingerprint(waypoints));
    const raised = waypoints.map((wp, i) =>
      i === 1 ? { ...wp, height: wp.height + 1 } : wp,
    );
    expect(waypointsFingerprint(raised)).not.toBe(
      waypointsFingerprint(waypoints),
    );
  });

  it("does not depend on key order", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(
      stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }),
    );
  });

  it("tells when a route was edited by hand", () => {
    const members = waypoints.map((wp, i) => ({
      ...wp,
      index: i,
      name: `Waypoint ${i + 1}`,
      routeId: "r1",
    }));
    const route = {
      id: "r1",
      name: "Pencil path",
      kind: "pencil",
      plan: {
        generator: "pencil" as const,
        params: {},
        generatorVersion: 1,
        waypointsHash: waypointsFingerprint(members),
      },
    };
    expect(routeEdited(route, members)).toBe(false);
    const moved = members.map((wp, i) =>
      i === 0 ? { ...wp, latitude: wp.latitude + 0.00001 } : wp,
    );
    expect(routeEdited(route, moved)).toBe(true);
    expect(routeEdited({ ...route, plan: undefined }, moved)).toBe(false);
  });
});
