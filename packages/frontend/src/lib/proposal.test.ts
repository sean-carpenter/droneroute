import { describe, it, expect } from "vitest";
import type { RouteProposalContent } from "@droneroute/shared";
import {
  NO_TRANSFORM,
  proposalPivot,
  suggestionToSeed,
  transformProposal,
} from "./proposal";
import {
  generateGrid,
  DEFAULT_GRID_PARAMS,
  boundaryCorners,
} from "./templates";
import { haversineDistance, pointInPolygon } from "./geo";

const LAT = 39.5;
const LNG = -98.35;
const M_LAT = 111195;
const M_LNG = M_LAT * Math.cos((LAT * Math.PI) / 180);
/** Position `east` and `north` meters from the origin. */
const at = (east: number, north: number): [number, number] => [
  LAT + north / M_LAT,
  LNG + east / M_LNG,
];

const proposal: RouteProposalContent = {
  title: "Test site",
  site: {
    anchor: { latitude: LAT, longitude: LNG },
    anchorSource: "geocoded",
  },
  boundary: [at(0, 0), at(200, 0), at(200, 100), at(0, 100)],
  structures: [
    {
      id: "silo",
      name: "Silo",
      latitude: at(50, 50)[0],
      longitude: at(50, 50)[1],
      heightM: 30,
      footprintRadiusM: 6,
    },
  ],
  alignments: [
    { id: "road", name: "Road", path: [at(0, 0), at(200, 100)], widthM: 25 },
  ],
  suggestions: [],
  assumptions: [],
  warnings: [],
};

const dist = (a: [number, number], b: [number, number]) =>
  haversineDistance(a[0], a[1], b[0], b[1]);

describe("transformProposal", () => {
  it("returns the same object when nothing moved", () => {
    expect(transformProposal(proposal, NO_TRANSFORM)).toBe(proposal);
  });

  it("moves everything by the offset", () => {
    const moved = transformProposal(proposal, {
      eastM: 30,
      northM: -40,
      rotationDeg: 0,
    });
    expect(dist(moved.boundary![0], at(30, -40))).toBeLessThan(0.05);
    expect(
      dist(
        [moved.structures[0].latitude, moved.structures[0].longitude],
        at(80, 10),
      ),
    ).toBeLessThan(0.05);
    expect(dist(moved.alignments[0].path[1], at(230, 60))).toBeLessThan(0.05);
    expect(
      dist(
        [moved.site.anchor!.latitude, moved.site.anchor!.longitude],
        at(30, -40),
      ),
    ).toBeLessThan(0.05);
  });

  it("rotates clockwise about the middle and keeps the shape", () => {
    const pivot = proposalPivot(proposal);
    expect(dist(pivot, at(100, 50))).toBeLessThan(0.05);

    const turned = transformProposal(proposal, {
      eastM: 0,
      northM: 0,
      rotationDeg: 90,
    });
    // The south-west corner (west and south of the pivot) swings to the north-west
    expect(dist(turned.boundary![0], at(50, 150))).toBeLessThan(0.1);
    // Side lengths are unchanged
    expect(dist(turned.boundary![0], turned.boundary![1])).toBeCloseTo(200, 0);
    expect(dist(turned.boundary![1], turned.boundary![2])).toBeCloseTo(100, 0);
  });
});

describe("suggestionToSeed", () => {
  const base = { title: "t", rationale: "r" };

  it("seeds a grid clipped to the boundary", () => {
    const seed = suggestionToSeed(proposal, {
      ...base,
      kind: "grid",
      targetId: "boundary",
      altitudeM: 60,
      sideOverlap: 0.8,
      crossHatch: true,
    });
    expect(seed?.type).toBe("grid");
    if (seed?.type !== "grid") return;
    expect(seed.params.boundary).toBe(proposal.boundary);
    expect(seed.params.altitude).toBe(60);
    expect(seed.params.sideOverlap).toBe(0.8);
    expect(seed.params.forwardOverlap).toBe(DEFAULT_GRID_PARAMS.forwardOverlap);
    expect(seed.params.crossHatch).toBe(true);
    expect(seed.params.corner1).toEqual(proposal.boundary![0]);
  });

  it("seeds a corridor from an alignment", () => {
    const seed = suggestionToSeed(proposal, {
      ...base,
      kind: "corridor",
      targetId: "road",
    });
    expect(seed?.type).toBe("corridor");
    if (seed?.type !== "corridor") return;
    expect(seed.params.path).toBe(proposal.alignments[0].path);
    expect(seed.params.widthM).toBe(25);
  });

  it("seeds an orbit that clears the structure and aims at its middle", () => {
    const seed = suggestionToSeed(proposal, {
      ...base,
      kind: "orbit",
      targetId: "silo",
      standoffM: 20,
    });
    expect(seed?.type).toBe("orbit");
    if (seed?.type !== "orbit") return;
    expect(seed.params.radiusM).toBe(26);
    expect(seed.params.altitude).toBe(45);
    expect(seed.params.aim).toEqual({ mode: "structureHeight", height: 15 });
  });

  it("seeds a tower that climbs past the top", () => {
    const seed = suggestionToSeed(proposal, {
      ...base,
      kind: "tower",
      targetId: "silo",
    });
    expect(seed?.type).toBe("tower");
    if (seed?.type !== "tower") return;
    expect(seed.params.maxAltitude).toBe(35);
    expect(seed.params.radiusM).toBe(21);
    expect(seed.params.aim).toEqual({ mode: "structureHeight", height: 15 });
  });

  it("seeds a facade from the ends of an alignment", () => {
    const seed = suggestionToSeed(proposal, {
      ...base,
      kind: "facade",
      targetId: "road",
      standoffM: 12,
      minAltitudeM: 8,
      maxAltitudeM: 9,
    });
    expect(seed?.type).toBe("facade");
    if (seed?.type !== "facade") return;
    expect(seed.params.point1).toEqual(proposal.alignments[0].path[0]);
    expect(seed.params.distanceM).toBe(12);
    expect(seed.params.maxAltitude).toBe(13); // kept above the minimum
  });

  it("returns null when the target is missing", () => {
    expect(
      suggestionToSeed(proposal, { ...base, kind: "orbit", targetId: "gone" }),
    ).toBeNull();
    expect(
      suggestionToSeed(
        { ...proposal, boundary: undefined },
        { ...base, kind: "grid", targetId: "boundary" },
      ),
    ).toBeNull();
  });
});

describe("generateGrid with a boundary", () => {
  // L-shaped parcel: 200 x 200 m with the north-east quarter cut out
  const lShape = [
    at(0, 0),
    at(200, 0),
    at(200, 100),
    at(100, 100),
    at(100, 200),
    at(0, 200),
  ];
  const params = (overrides = {}) => ({
    ...DEFAULT_GRID_PARAMS,
    ...boundaryCorners(lShape),
    boundary: lShape,
    altitude: 60,
    ...overrides,
  });

  it("keeps every flight line inside the outline", () => {
    const { waypoints } = generateGrid(params());
    expect(waypoints.length).toBeGreaterThan(4);
    expect(waypoints.length % 2).toBe(0);
    for (let i = 0; i < waypoints.length; i += 2) {
      const a = waypoints[i];
      const b = waypoints[i + 1];
      // The middle of each pass is inside the parcel
      const mid: [number, number] = [
        (a.latitude + b.latitude) / 2,
        (a.longitude + b.longitude) / 2,
      ];
      expect(pointInPolygon(mid, lShape)).toBe(true);
      expect(a.photoIntervalM).toBeGreaterThan(0);
      expect(b.photoIntervalM).toBeUndefined();
    }
    // Nothing strays into the cut-out corner
    const cutOut = [at(101, 101), at(199, 101), at(199, 199), at(101, 199)];
    for (const wp of waypoints) {
      expect(pointInPolygon([wp.latitude, wp.longitude], cutOut)).toBe(false);
    }
  });

  it("has shorter lines where the parcel is narrower", () => {
    const { waypoints } = generateGrid(params());
    const lengths: number[] = [];
    for (let i = 0; i < waypoints.length; i += 2) {
      lengths.push(
        haversineDistance(
          waypoints[i].latitude,
          waypoints[i].longitude,
          waypoints[i + 1].latitude,
          waypoints[i + 1].longitude,
        ),
      );
    }
    expect(Math.max(...lengths)).toBeCloseTo(200, 0);
    expect(Math.min(...lengths)).toBeCloseTo(100, 0);
  });

  it("supports rotation and cross-hatch", () => {
    const base = generateGrid(params()).waypoints;
    const rotated = generateGrid(params({ rotationDeg: 30 })).waypoints;
    expect(rotated.length).toBeGreaterThan(0);
    // Turning the lines changes where the passes run
    expect(rotated).not.toEqual(base);
    for (const wp of rotated) {
      // Still on or inside the outline (allowing for the boundary itself)
      const inside = pointInPolygon(
        [wp.latitude, wp.longitude],
        [
          at(-1, -1),
          at(201, -1),
          at(201, 101),
          at(101, 101),
          at(101, 201),
          at(-1, 201),
        ],
      );
      expect(inside).toBe(true);
    }
    const crossed = generateGrid(params({ crossHatch: true })).waypoints;
    expect(crossed.length).toBeGreaterThan(base.length);
  });

  it("is deterministic and leaves rectangle grids unchanged", () => {
    expect(generateGrid(params())).toEqual(generateGrid(params()));
    const rect = { ...params(), boundary: undefined };
    const waypoints = generateGrid(rect).waypoints;
    // Rectangle grid puts lines on both edges
    expect(waypoints[0].latitude).toBeCloseTo(at(0, 0)[0], 9);
  });
});
