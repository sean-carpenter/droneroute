import { describe, it, expect } from "vitest";
import {
  DEFAULT_MISSION_CONFIG,
  type SiteFeature,
  type Waypoint,
} from "@droneroute/shared";
import { MAVIC_3E_CAMERA, spacingFromOverlap } from "./camera";
import { bearing, gridSpacing, type GridParams } from "./templates";
import { getObstacleWarnings, pointInPolygon } from "./geo";
import { standoffByWaypoint } from "./routePlan";
import {
  DEFAULT_CAPTURE_SETTINGS,
  MAP_OVERLAP,
  compileCapturePlan,
  footprintWalls,
  sideFacing,
  type CaptureRequest,
} from "./capturePlan";

const ORIGIN: [number, number] = [42.559, -71.078];
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos((ORIGIN[0] * Math.PI) / 180));

/** A point `x` m east and `y` m north of the origin. */
const at = (x: number, y: number): [number, number] => [
  ORIGIN[0] + y * M_LAT,
  ORIGIN[1] + x * M_LNG,
];

/** Rectangle `w` m east-west by `h` m north-south, turned `deg` clockwise. */
function rect(w: number, h: number, deg = 0, cx = 0, cy = 0) {
  const r = (-deg * Math.PI) / 180;
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) =>
    at(
      cx + x * Math.cos(r) - y * Math.sin(r),
      cy + x * Math.sin(r) + y * Math.cos(r),
    ),
  );
}

const building = (
  vertices: [number, number][],
  heightM: number | null = 8,
): SiteFeature => ({
  id: "house",
  name: "House",
  kind: "existing",
  color: "#64748b",
  vertices,
  heightM,
  isObstacle: true,
  source: "manual",
});

const lot: SiteFeature = {
  id: "lot",
  name: "Lot",
  kind: "lot",
  color: "#22d3ee",
  vertices: rect(80, 60),
  heightM: null,
  isObstacle: false,
  source: "manual",
};

function request(overrides: Partial<CaptureRequest> = {}): CaptureRequest {
  const feature = overrides.feature ?? building(rect(20, 12));
  return {
    planId: "plan-1",
    objective: "exterior_baseline",
    feature,
    siteFeatures: [feature, lot],
    obstacles: [],
    settings: DEFAULT_CAPTURE_SETTINGS,
    camera: MAVIC_3E_CAMERA,
    cameraExact: true,
    config: DEFAULT_MISSION_CONFIG,
    ...overrides,
  };
}

describe("footprint walls", () => {
  it("finds one wall per side of a square-on rectangle, either winding", () => {
    for (const vertices of [rect(20, 12), [...rect(20, 12)].reverse()]) {
      const walls = footprintWalls(vertices);
      expect(walls.map((w) => w.side).sort()).toEqual([
        "facade_east",
        "facade_north",
        "facade_south",
        "facade_west",
      ]);
      const north = walls.find((w) => w.side === "facade_north")!;
      expect(north.lengthM).toBeCloseTo(20, 0);
      expect(north.outwardBearing).toBeCloseTo(0, 0);
    }
  });

  it("joins edges that run on in the same direction", () => {
    const [a, b, c, d] = rect(20, 12);
    const kinked = [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b, c, d] as [
      number,
      number,
    ][];
    expect(footprintWalls(kinked)).toHaveLength(4);
  });

  it("gives an L-shaped house two walls on two of its sides", () => {
    const L = [at(0, 0), at(20, 0), at(20, 8), at(8, 8), at(8, 16), at(0, 16)];
    const walls = footprintWalls(L);
    expect(walls).toHaveLength(6);
    const count = (side: string) => walls.filter((w) => w.side === side).length;
    expect(count("facade_north")).toBe(2);
    expect(count("facade_east")).toBe(2);
  });

  it("puts walls facing between two directions on the right side", () => {
    expect(sideFacing(44)).toBe("facade_north");
    expect(sideFacing(45)).toBe("facade_east");
    expect(sideFacing(-10)).toBe("facade_north");
    expect(sideFacing(270)).toBe("facade_west");
  });
});

describe("compileCapturePlan", () => {
  it("plans every part of an exterior baseline", () => {
    const plan = compileCapturePlan(request());
    expect(plan.elements.map((e) => [e.element, e.status])).toEqual([
      ["site_context", "planned"],
      ["roof_nadir", "planned"],
      ["roof_oblique", "planned"],
      ["facade_north", "planned"],
      ["facade_east", "planned"],
      ["facade_south", "planned"],
      ["facade_west", "planned"],
    ]);
    expect(plan.totals.routes).toBe(7);
    expect(plan.totals.photos).toBeGreaterThan(0);
    expect(plan.totals.batteries).toBeGreaterThanOrEqual(1);
    expect(plan.issues).toEqual([]);
    expect(plan.lotId).toBe("lot");
    for (const e of plan.elements) {
      expect(e.route!.capture).toMatchObject({
        planId: "plan-1",
        objective: "exterior_baseline",
        element: e.element,
        featureId: "house",
        lotId: "lot",
      });
    }
  });

  it("is repeatable: the same request gives the same plan", () => {
    expect(compileCapturePlan(request())).toEqual(
      compileCapturePlan(request()),
    );
  });

  it("asks for a lot outline instead of guessing the site", () => {
    const plan = compileCapturePlan(
      request({ siteFeatures: [building(rect(20, 12))] }),
    );
    const site = plan.elements.find((e) => e.element === "site_context")!;
    expect(site.status).toBe("missing");
    expect(site.route).toBeUndefined();
    expect(plan.totals.routes).toBe(6);
  });

  it("only plans the parts an objective needs", () => {
    expect(
      compileCapturePlan(
        request({ objective: "roof_inspection" }),
      ).elements.map((e) => e.element),
    ).toEqual(["roof_nadir", "roof_oblique"]);
    expect(
      compileCapturePlan(
        request({ objective: "facade_inspection" }),
      ).elements.every((e) => e.route?.input.generator === "walls"),
    ).toBe(true);
  });

  it("says when no wall faces a side", () => {
    const triangle = building([at(0, 0), at(20, 0), at(0, 20)]);
    const plan = compileCapturePlan(
      request({ feature: triangle, siteFeatures: [triangle] }),
    );
    const sides = Object.fromEntries(
      plan.elements.map((e) => [e.element, e.status]),
    );
    // Walls face south, west and north-east (east bin)
    expect(sides.facade_north).toBe("none");
    expect(sides.facade_south).toBe("planned");
  });

  it("flies the facades outside the building, at their standoff", () => {
    const feature = building(rect(20, 12, 30));
    const plan = compileCapturePlan(request({ feature }));
    for (const e of plan.elements.filter((x) =>
      x.element.startsWith("facade"),
    )) {
      const wps = e.route!.result.waypoints;
      expect(wps.length).toBeGreaterThan(0);
      for (const wp of wps) {
        expect(
          pointInPolygon([wp.latitude, wp.longitude], feature.vertices),
        ).toBe(false);
        // Photos stay within the wall; only the transit climbs go higher
        if (wp.actions.length > 0) expect(wp.height).toBeLessThanOrEqual(8.5);
      }
      const indexed = wps.map((wp, i) => ({ ...wp, index: i })) as Waypoint[];
      const close = getObstacleWarnings(
        indexed,
        [
          {
            id: "house",
            name: "House",
            description: "",
            vertices: feature.vertices,
            height: 8,
          },
        ],
        { standoffM: DEFAULT_CAPTURE_SETTINGS.facadeStandoffM * 0.9 },
      );
      expect(close, e.element).toEqual([]);
    }
  });

  it("works out roof overlap from the roof, not the ground", () => {
    const plan = compileCapturePlan(request());
    const roof = plan.elements.find((e) => e.element === "roof_nadir")!;
    const params = roof.route!.input.params as GridParams;
    expect(params.altitude).toBe(28);
    expect(params.surfaceHeightM).toBe(8);
    expect(gridSpacing(params).lineSpacingM).toBeCloseTo(
      spacingFromOverlap(20, MAP_OVERLAP, MAP_OVERLAP).lineSpacingM,
      6,
    );
  });

  it("flies the roof lines along the building's longest wall", () => {
    const feature = building(rect(40, 12, 30));
    const plan = compileCapturePlan(request({ feature }));
    const wps = plan.elements.find((e) => e.element === "roof_nadir")!.route!
      .result.waypoints;
    const b = bearing(
      wps[0].latitude,
      wps[0].longitude,
      wps[1].latitude,
      wps[1].longitude,
    );
    // The long walls run at 120° (90° turned 30° clockwise), either way along
    const off = (((b - 120) % 180) + 180) % 180;
    expect(Math.min(off, 180 - off)).toBeLessThan(2);
  });

  it("looks down at the roof edge from the angled path", () => {
    const plan = compileCapturePlan(request());
    const oblique = plan.elements.find((e) => e.element === "roof_oblique")!;
    expect(oblique.route!.targetFeatureId).toBe("house");
    for (const wp of oblique.route!.result.waypoints) {
      expect(wp.height).toBe(18);
      expect(wp.gimbalPitchAngle).toBeLessThan(-30);
      expect(wp.gimbalPitchAngle).toBeGreaterThan(-60);
    }
  });

  it("assumes a height when the building has none, and says so", () => {
    const feature = building(rect(20, 12), null);
    const plan = compileCapturePlan(
      request({ feature, siteFeatures: [feature, lot] }),
    );
    expect(plan.assumptions[0]).toContain("no height set");
    const roof = plan.elements.find((e) => e.element === "roof_nadir")!;
    expect((roof.route!.input.params as GridParams).altitude).toBe(28);
    // The building itself is not reported as in the way of its own roof photos
    expect(plan.issues).toEqual([]);
  });

  it("reports a neighboring building the facades come close to", () => {
    const garage: SiteFeature = {
      ...building(rect(6, 6, 0, 15, 0)),
      id: "garage",
      name: "Garage",
      kind: "garage",
    };
    const feature = building(rect(20, 12));
    const plan = compileCapturePlan(
      request({ feature, siteFeatures: [feature, garage, lot] }),
    );
    expect(plan.issues.some((i) => i.message.includes("Garage"))).toBe(true);
  });

  it("moves between walls and routes above the roof, never past a corner", () => {
    // An L-shaped house: two walls on the north and east sides, one concave corner
    const L = building([
      at(0, 0),
      at(20, 0),
      at(20, 8),
      at(8, 8),
      at(8, 16),
      at(0, 16),
    ]);
    const plan = compileCapturePlan(
      request({ feature: L, siteFeatures: [L, lot] }),
    );
    // Nothing runs into the house. The only close passes are in the inside
    // corner, where a wall's photos are taken near the wall at right angles
    expect(plan.issues.filter((i) => i.conflict)).toEqual([]);
    expect(plan.issues.map((i) => i.element).sort()).toEqual([
      "facade_east",
      "facade_north",
    ]);
    for (const issue of plan.issues) {
      expect(issue.message).toMatch(/comes within 4\.\d m of House/);
    }
    const north = plan.elements.find((e) => e.element === "facade_north")!;
    const wps = north.route!.result.waypoints;
    // Starts and ends with a photo-less waypoint at transit height
    expect(wps[0].height).toBe(14);
    expect(wps[0].actions).toEqual([]);
    expect(wps.at(-1)!.height).toBe(14);
  });

  it("finds a route that runs too close to the building on the way between routes", () => {
    // Facades 2 m out with no transit climb would cut the corners: check the
    // whole-flight check sees legs, by making the building taller than the transit
    const tall = building(rect(20, 12), 8);
    const plan = compileCapturePlan(
      request({
        feature: tall,
        siteFeatures: [{ ...tall, heightM: 30 }, lot],
      }),
    );
    expect(plan.issues.length).toBeGreaterThan(0);
  });

  it("warns about routes above 400 ft", () => {
    const plan = compileCapturePlan(
      request({
        settings: { ...DEFAULT_CAPTURE_SETTINGS, siteAltitudeM: 130 },
      }),
    );
    expect(plan.issues.some((i) => i.message.includes("400 ft"))).toBe(true);
  });
});

describe("per-route standoff", () => {
  it("checks a route against its own planned standoff", () => {
    const routes = [
      {
        id: "close",
        name: "Facade",
        kind: "facade",
        plan: {
          generator: "facade" as const,
          params: { distanceM: 1 },
          generatorVersion: 1,
          waypointsHash: "x",
        },
      },
      { id: "plain", name: "Route 1", kind: "manual" },
    ];
    const at = standoffByWaypoint(
      [
        { index: 0, routeId: "close" },
        { index: 1, routeId: "plain" },
      ],
      routes,
      10,
    );
    expect(at(0)).toBeCloseTo(0.9);
    expect(at(1)).toBe(10);
    expect(at(7)).toBe(10);
  });
});
