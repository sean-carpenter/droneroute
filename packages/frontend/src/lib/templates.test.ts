import { describe, it, expect } from "vitest";
import {
  DEFAULT_CORRIDOR_PARAMS,
  DEFAULT_GRID_PARAMS,
  corridorLayout,
  generateCorridor,
  generateGrid,
  gridSpacing,
  type GridParams,
} from "./templates";
import {
  DEFAULT_FACADE_PARAMS,
  DEFAULT_FACADE_SPACING,
  DEFAULT_ORBIT_PARAMS,
  DEFAULT_PENCIL_PARAMS,
  DEFAULT_POLYGON_FACADE,
  DEFAULT_RADIAL_FACADE,
  DEFAULT_TOWER_PARAMS,
  MAX_SURVEY_WAYPOINTS,
  bearing,
  facadePhotoSpacing,
  generateBoundaryFacade,
  generateFacade,
  generateOrbit,
  generatePencil,
  generateTower,
  offsetPolygon,
  type FacadeParams,
  type RadialFacadeParams,
  type TemplateAim,
} from "./templates";
import { footprintM } from "./camera";
import { haversineDistance } from "./geo";

// ~400 m (E-W) x ~200 m (N-S) box at the project's standard test location
const LAT = 41.25797;
const LNG = 0.93229;
const grid = (overrides: Partial<GridParams> = {}): GridParams => ({
  ...DEFAULT_GRID_PARAMS,
  corner1: [LAT, LNG],
  corner2: [LAT + 200 / 111320, LNG + 400 / (111320 * Math.cos(0.72))],
  ...overrides,
});

const dist = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) => haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude);

describe("generateGrid — photogrammetry mode", () => {
  it("spaces lines no wider than the side overlap allows", () => {
    const params = grid({ altitude: 80, sideOverlap: 0.75 });
    const { lineSpacingM } = gridSpacing(params);
    const { waypoints } = generateGrid(params);

    // interval mode: two waypoints per pass
    expect(waypoints.length % 2).toBe(0);
    const actual = dist(waypoints[1], waypoints[2]);
    expect(actual).toBeLessThanOrEqual(lineSpacingM + 0.5);
    expect(actual).toBeGreaterThan(lineSpacingM * 0.6);
  });

  it("uses a distance trigger on each pass, not on the turns", () => {
    const params = grid();
    const { photoIntervalM } = gridSpacing(params);
    const { waypoints } = generateGrid(params);

    waypoints.forEach((wp, i) => {
      if (i % 2 === 0) {
        expect(wp.photoIntervalM).toBeCloseTo(photoIntervalM, 1);
      } else {
        expect(wp.photoIntervalM).toBeUndefined();
      }
      expect(wp.actions).toEqual([]);
      expect(wp.gimbalPitchAngle).toBe(-90);
    });
  });

  it("places one waypoint per photo in waypoints mode", () => {
    const params = grid({ photoMode: "waypoints" });
    const { photoIntervalM } = gridSpacing(params);
    const { waypoints } = generateGrid(params);

    expect(waypoints.every((wp) => wp.actions.length === 1)).toBe(true);
    expect(waypoints.every((wp) => wp.photoIntervalM === undefined)).toBe(true);
    // Consecutive photos on the first pass are never further apart than the interval
    const step = dist(waypoints[0], waypoints[1]);
    expect(step).toBeLessThanOrEqual(photoIntervalM + 0.5);
    expect(step).toBeGreaterThan(photoIntervalM * 0.5);
  });

  it("more overlap means more lines", () => {
    const low = generateGrid(grid({ sideOverlap: 0.6 })).waypoints.length;
    const high = generateGrid(grid({ sideOverlap: 0.85 })).waypoints.length;
    expect(high).toBeGreaterThan(low);
  });

  it("takes no photos when photos are off", () => {
    const { waypoints } = generateGrid(grid({ addPhotos: false }));
    expect(
      waypoints.every((wp) => !wp.photoIntervalM && wp.actions.length === 0),
    ).toBe(true);
  });

  it("reverse flies the same lines backwards with triggers still on passes", () => {
    const forward = generateGrid(grid()).waypoints;
    const reversed = generateGrid(grid({ reverse: true })).waypoints;
    expect(reversed.length).toBe(forward.length);
    expect(reversed[0].latitude).toBeCloseTo(
      forward[forward.length - 1].latitude,
      9,
    );
    reversed.forEach((wp, i) => {
      expect(!!wp.photoIntervalM).toBe(i % 2 === 0);
    });
  });
});

describe("generateGrid — fixed spacing mode", () => {
  it("keeps the original two-waypoints-per-pass behavior", () => {
    const { waypoints } = generateGrid(
      grid({ mode: "fixedSpacing", spacingM: 50 }),
    );
    // 200 m cross axis / 50 m + 1 = 5 passes
    expect(waypoints.length).toBe(10);
    expect(waypoints.every((wp) => wp.actions.length === 1)).toBe(true);
    expect(waypoints.every((wp) => wp.photoIntervalM === undefined)).toBe(true);
  });
});

describe("generateCorridor", () => {
  // Straight 500 m centerline heading east
  const east = (m: number): [number, number] => [
    LAT,
    LNG + m / (111195 * Math.cos((LAT * Math.PI) / 180)),
  ];
  const straight = [east(0), east(250), east(500)];

  it("uses a single line when the swath already covers the corridor", () => {
    const params = {
      ...DEFAULT_CORRIDOR_PARAMS,
      path: straight,
      altitude: 80,
      widthM: 60,
    };
    expect(footprintM(80).widthM).toBeGreaterThan(60);
    expect(corridorLayout(params).lineOffsetsM).toEqual([0]);
    const { waypoints } = generateCorridor(params);
    // Collinear midpoint is simplified away
    expect(waypoints.length).toBe(2);
    expect(dist(waypoints[0], waypoints[1])).toBeCloseTo(500, 0);
  });

  it("adds parallel lines to cover a wide corridor", () => {
    const params = {
      ...DEFAULT_CORRIDOR_PARAMS,
      path: straight,
      altitude: 80,
      widthM: 250,
    };
    const { lineOffsetsM, lineSpacingM } = corridorLayout(params);
    const swath = footprintM(80).widthM;
    const covered = (lineOffsetsM.length - 1) * lineSpacingM + swath;
    expect(covered).toBeGreaterThanOrEqual(250);
    // Offsets are centered on the centerline
    expect(lineOffsetsM[0]).toBeCloseTo(
      -lineOffsetsM[lineOffsetsM.length - 1],
      9,
    );

    const { waypoints } = generateCorridor(params);
    expect(waypoints.length).toBe(lineOffsetsM.length * 2);
    // Lawn-mower: second line starts next to where the first one ended
    expect(dist(waypoints[1], waypoints[2])).toBeCloseTo(lineSpacingM, 0);
  });

  it("keeps parallel lines at the right distance around a bend", () => {
    const bend: [number, number][] = [
      east(0),
      east(300),
      [LAT + 300 / 111195, east(300)[1]],
    ];
    const params = {
      ...DEFAULT_CORRIDOR_PARAMS,
      path: bend,
      altitude: 80,
      widthM: 250,
    };
    const { lineOffsetsM } = corridorLayout(params);
    const { waypoints } = generateCorridor(params);
    expect(waypoints.length).toBe(lineOffsetsM.length * 3);
    // First line start is offset sideways from the centerline start
    const start = { latitude: bend[0][0], longitude: bend[0][1] };
    expect(dist(waypoints[0], start)).toBeCloseTo(Math.abs(lineOffsetsM[0]), 0);
  });

  it("returns nothing for a degenerate path", () => {
    expect(
      generateCorridor({ ...DEFAULT_CORRIDOR_PARAMS, path: [east(0)] })
        .waypoints,
    ).toEqual([]);
  });
});

// ── Camera aim across templates ─────────────────────────

const M_PER_DEG_LAT = 111195;
const eastOf = (m: number): [number, number] => [
  LAT,
  LNG + m / (M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180)),
];
const TARGET_POI = {
  id: "poi-1",
  latitude: LAT + 60 / M_PER_DEG_LAT,
  longitude: LNG,
  height: 5,
};

describe("generateFacade — camera aim", () => {
  const facade = (aim?: TemplateAim): FacadeParams => ({
    ...DEFAULT_FACADE_PARAMS,
    point1: eastOf(0),
    point2: eastOf(40),
    distanceM: 20,
    minAltitude: 10,
    maxAltitude: 40,
    numRows: 4,
    numColumns: 3,
    ...(aim ? { aim } : {}),
  });

  it("aims at the wall base by default, steeper as the drone climbs", () => {
    const { waypoints } = generateFacade(facade());
    for (const wp of waypoints) {
      const expected = -Math.round((Math.atan2(wp.height, 20) * 180) / Math.PI);
      expect(Math.abs(wp.gimbalPitchAngle - expected)).toBeLessThanOrEqual(1);
    }
    const byRow = [0, 3, 6, 9].map((i) => waypoints[i].gimbalPitchAngle);
    expect(byRow).toEqual([...byRow].sort((a, b) => b - a));
    expect(byRow[0]).toBeGreaterThan(byRow[3]);
  });

  it("levels off at a target height band on the wall", () => {
    const { waypoints } = generateFacade(
      facade({ mode: "structureHeight", height: 20 }),
    );
    const pitchAt = (alt: number) =>
      waypoints.find((wp) => wp.height === alt)!.gimbalPitchAngle;
    expect(pitchAt(10)).toBeGreaterThan(0); // below the band → looks up
    expect(pitchAt(20)).toBe(0); // level with it
    expect(pitchAt(40)).toBe(-45); // 20 m above, 20 m away
    // Every column in a row shares the same pitch
    expect(
      new Set(waypoints.slice(0, 3).map((w) => w.gimbalPitchAngle)).size,
    ).toBe(1);
  });

  it("tracks a POI with heading and pitch", () => {
    const { waypoints } = generateFacade(
      facade({ mode: "towardPOI", poiId: "poi-1" }),
      [TARGET_POI],
    );
    expect(waypoints.every((wp) => wp.headingMode === "towardPOI")).toBe(true);
    expect(waypoints.every((wp) => wp.poiId === "poi-1")).toBe(true);
    // Higher rows look further down at the same POI
    expect(waypoints[9].gimbalPitchAngle).toBeLessThan(
      waypoints[0].gimbalPitchAngle,
    );
  });

  it("keeps facing the wall when the POI is missing", () => {
    const { waypoints } = generateFacade(
      facade({ mode: "towardPOI", poiId: "gone" }),
      [],
    );
    expect(waypoints.every((wp) => wp.headingMode === "fixed")).toBe(true);
    expect(waypoints.every((wp) => wp.gimbalPitchAngle === 0)).toBe(true);
  });

  it("supports fixed and relative-to-surface pitch", () => {
    expect(
      generateFacade(facade({ mode: "fixed", pitch: -10 })).waypoints.every(
        (wp) => wp.gimbalPitchAngle === -10,
      ),
    ).toBe(true);
    expect(
      generateFacade(
        facade({ mode: "relativeToSurface", offsetDeg: 20 }),
      ).waypoints.every((wp) => wp.gimbalPitchAngle === -20),
    ).toBe(true);
  });

  it("is deterministic", () => {
    const params = facade({ mode: "structureHeight", height: 15 });
    expect(generateFacade(params)).toEqual(generateFacade(params));
  });
});

describe("generateOrbit — camera aim", () => {
  const orbit = (aim?: TemplateAim) => ({
    ...DEFAULT_ORBIT_PARAMS,
    center: [LAT, LNG] as [number, number],
    radiusM: 30,
    altitude: 30,
    ...(aim ? { aim } : {}),
  });

  it("aims at the ground under the center by default", () => {
    const { waypoints, pois } = generateOrbit(orbit());
    expect(waypoints).toHaveLength(12);
    expect(waypoints.every((wp) => wp.gimbalPitchAngle === -45)).toBe(true);
    expect(waypoints.every((wp) => wp.headingMode === "fixed")).toBe(true);
    expect(pois[0].height).toBe(0);
  });

  it("aims at a height on the center axis and puts the POI there", () => {
    const { waypoints, pois } = generateOrbit(
      orbit({ mode: "structureHeight", height: 30 }),
    );
    expect(waypoints.every((wp) => wp.gimbalPitchAngle === 0)).toBe(true);
    expect(pois[0].height).toBe(30);
  });

  it("can track an existing POI instead of the center", () => {
    const { waypoints } = generateOrbit(
      orbit({ mode: "towardPOI", poiId: "poi-1" }),
      [TARGET_POI],
    );
    expect(waypoints.every((wp) => wp.poiId === "poi-1")).toBe(true);
    // Not all the same distance from the POI → pitch varies
    expect(
      new Set(waypoints.map((w) => w.gimbalPitchAngle)).size,
    ).toBeGreaterThan(1);
  });
});

describe("generateTower", () => {
  const tower = (overrides = {}) => ({
    ...DEFAULT_TOWER_PARAMS,
    center: [LAT, LNG] as [number, number],
    radiusM: 20,
    ...overrides,
  });

  it("climbs continuously in helix style", () => {
    const { waypoints, pois } = generateTower(tower());
    expect(waypoints).toHaveLength(4 * 8 + 1);
    expect(waypoints[0].height).toBe(10);
    expect(waypoints.at(-1)!.height).toBe(50);
    for (let i = 1; i < waypoints.length; i++) {
      expect(waypoints[i].height).toBeGreaterThan(waypoints[i - 1].height);
    }
    // Every waypoint sits on the standoff circle
    for (const wp of waypoints) {
      expect(
        haversineDistance(wp.latitude, wp.longitude, LAT, LNG),
      ).toBeCloseTo(20, 1);
    }
    expect(pois).toHaveLength(1);
  });

  it("flies level closed rings in stacked style", () => {
    const { waypoints } = generateTower(
      tower({ style: "stacked", turns: 3, pointsPerTurn: 6 }),
    );
    expect(waypoints).toHaveLength(3 * 7);
    expect([...new Set(waypoints.map((w) => w.height))]).toEqual([10, 30, 50]);
    // Each ring ends where it started
    expect(waypoints[6].latitude).toBeCloseTo(waypoints[0].latitude, 9);
    expect(waypoints[6].longitude).toBeCloseTo(waypoints[0].longitude, 9);
  });

  it("pitches up below the aim height and down above it", () => {
    const { waypoints, pois } = generateTower(
      tower({ aim: { mode: "structureHeight", height: 30 } }),
    );
    expect(waypoints[0].gimbalPitchAngle).toBe(35); // 20 m below, 20 m away → 45° up, gimbal limit
    expect(waypoints.at(-1)!.gimbalPitchAngle).toBe(-45);
    expect(pois[0].height).toBe(30);
  });

  it("aims at the base with an ever steeper pitch", () => {
    const { waypoints } = generateTower(
      tower({ aim: { mode: "structureHeight", height: 0 } }),
    );
    const pitches = waypoints.map((w) => w.gimbalPitchAngle);
    expect(pitches[0]).toBeGreaterThan(pitches.at(-1)!);
    expect(pitches).toEqual([...pitches].sort((a, b) => b - a));
  });

  it("reverses direction and tolerates swapped altitudes", () => {
    const cw = generateTower(tower()).waypoints;
    const ccw = generateTower(tower({ clockwise: false })).waypoints;
    expect(ccw[1].longitude).toBeLessThan(LNG);
    expect(cw[1].longitude).toBeGreaterThan(LNG);
    const swapped = generateTower(
      tower({ minAltitude: 50, maxAltitude: 10 }),
    ).waypoints;
    expect(swapped[0].height).toBe(10);
  });

  it("is deterministic", () => {
    expect(generateTower(tower())).toEqual(generateTower(tower()));
  });
});

describe("generatePencil — camera aim", () => {
  const path: [number, number][] = [eastOf(0), eastOf(100)];

  it("uses a fixed pitch and follows the path by default", () => {
    const { waypoints } = generatePencil({ ...DEFAULT_PENCIL_PARAMS, path });
    expect(waypoints.every((wp) => wp.gimbalPitchAngle === -45)).toBe(true);
    expect(waypoints.every((wp) => wp.headingMode === "followWayline")).toBe(
      true,
    );
  });

  it("recomputes pitch at every waypoint when facing a POI", () => {
    const { waypoints } = generatePencil(
      {
        ...DEFAULT_PENCIL_PARAMS,
        path,
        aim: { mode: "towardPOI", poiId: "poi-1" },
      },
      [TARGET_POI],
    );
    expect(waypoints.every((wp) => wp.headingMode === "towardPOI")).toBe(true);
    // The path leads away from the POI, so the camera flattens out
    expect(waypoints.at(-1)!.gimbalPitchAngle).toBeGreaterThan(
      waypoints[0].gimbalPitchAngle,
    );
  });
});

describe("survey aim and cross-hatch", () => {
  it("corridor supports oblique and POI aim", () => {
    const base = {
      ...DEFAULT_CORRIDOR_PARAMS,
      path: [eastOf(0), eastOf(300)] as [number, number][],
    };
    expect(
      generateCorridor(base).waypoints.every(
        (wp) => wp.gimbalPitchAngle === -90,
      ),
    ).toBe(true);
    expect(
      generateCorridor({
        ...base,
        aim: { mode: "relativeToSurface", offsetDeg: 30 },
      }).waypoints.every((wp) => wp.gimbalPitchAngle === -60),
    ).toBe(true);
    const tracking = generateCorridor(
      { ...base, aim: { mode: "towardPOI", poiId: "poi-1" } },
      [TARGET_POI],
    ).waypoints;
    expect(tracking.every((wp) => wp.poiId === "poi-1")).toBe(true);
  });

  it("cross-hatch adds a perpendicular set of lines", () => {
    const single = generateGrid(grid()).waypoints;
    const crossed = generateGrid(grid({ crossHatch: true })).waypoints;
    expect(crossed.length).toBeGreaterThan(single.length);
    expect(crossed.slice(0, single.length)).toEqual(single);
    // First set runs E-W (constant latitude), second runs N-S
    expect(single[0].latitude).toBeCloseTo(single[1].latitude, 9);
    const extra = crossed.slice(single.length);
    expect(extra[0].longitude).toBeCloseTo(extra[1].longitude, 9);
  });
});

describe("boundary facades", () => {
  const center = { latitude: LAT, longitude: LNG };
  const meters = (east: number, north: number): [number, number] => [
    LAT + north / 111320,
    LNG + east / (111320 * Math.cos((LAT * Math.PI) / 180)),
  ];

  const radial = (
    overrides: Partial<RadialFacadeParams> = {},
  ): RadialFacadeParams => ({
    ...DEFAULT_RADIAL_FACADE,
    boundary: "circle",
    center: [LAT, LNG],
    handle: meters(15, 0),
    radiusBottomM: 10,
    radiusTopM: 10,
    spacing: {
      ...DEFAULT_FACADE_SPACING,
      mode: "distance",
      horizontalM: 8,
      verticalM: 10,
    },
    minAltitude: 10,
    maxAltitude: 10,
    ...overrides,
  });

  it("spaces photos from the camera footprint at the target distance", () => {
    const gaps = facadePhotoSpacing(20, {
      ...DEFAULT_FACADE_SPACING,
      mode: "overlap",
      horizontalOverlap: 0.75,
      verticalOverlap: 0.6,
    });
    // Mavic 3E wide: 17.3 x 13.0 mm sensor, 12.3 mm focal length
    expect(gaps.horizontalM).toBeCloseTo(((20 * 17.3) / 12.3) * 0.25, 5);
    expect(gaps.verticalM).toBeCloseTo(((20 * 13.0) / 12.3) * 0.4, 5);
  });

  it("uses the typed gaps in distance mode", () => {
    const gaps = facadePhotoSpacing(20, {
      ...DEFAULT_FACADE_SPACING,
      mode: "distance",
      horizontalM: 8,
      verticalM: 6,
    });
    expect(gaps).toEqual({ horizontalM: 8, verticalM: 6 });
  });

  it("flies a circle at structure radius plus the target distance", () => {
    const params = radial();
    const flightRadius = params.radiusBottomM + params.standoffM;
    const count = Math.max(
      4,
      Math.round((2 * Math.PI * flightRadius) / params.spacing.horizontalM),
    );
    const { waypoints, pois, passes, passLabel } =
      generateBoundaryFacade(params);

    expect(waypoints).toHaveLength(count);
    expect(passes).toBe(1);
    expect(passLabel).toBe("orbits");
    expect(pois).toHaveLength(1);
    for (const wp of waypoints) {
      expect(dist(wp, center)).toBeCloseTo(flightRadius, 0);
      expect(wp.actions[0]?.actionType).toBe("takePhoto");
      const towardCenter = bearing(wp.latitude, wp.longitude, LAT, LNG);
      const wrapped = towardCenter > 180 ? towardCenter - 360 : towardCenter;
      expect(wp.headingAngle).toBeCloseTo(wrapped, 0);
    }
    expect(waypoints[0].latitude).toBeGreaterThan(LAT);
    // Due south is 180 or -180, depending on which side of the meridian the
    // first sample lands.
    expect(Math.abs(waypoints[0].headingAngle ?? 0)).toBeCloseTo(180, 0);
    expect(waypoints[1].longitude).toBeGreaterThan(LNG);
  });

  it("tapers horizontal orbits and spirals, and ignores taper on columns", () => {
    const tapered = radial({
      tapered: true,
      radiusTopM: 30,
      standoffM: 5,
      minAltitude: 10,
      maxAltitude: 30,
      spacing: {
        ...DEFAULT_FACADE_SPACING,
        mode: "distance",
        horizontalM: 20,
        verticalM: 20,
      },
    });
    const orbits = generateBoundaryFacade(tapered).waypoints;
    const low = orbits.filter((wp) => wp.height === 10);
    const high = orbits.filter((wp) => wp.height === 30);
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    expect(dist(low[0], center)).toBeCloseTo(15, 0);
    expect(dist(high[0], center)).toBeCloseTo(35, 0);

    const columns = generateBoundaryFacade({
      ...tapered,
      pattern: "vertical",
    }).waypoints;
    expect(columns.length).toBeGreaterThan(0);
    for (const wp of columns) {
      expect(dist(wp, center)).toBeCloseTo(15, 0);
    }

    const spiral = generateBoundaryFacade({
      ...tapered,
      boundary: "spiral",
      maxAltitude: 40,
      spacing: {
        ...DEFAULT_FACADE_SPACING,
        mode: "distance",
        horizontalM: 8,
        verticalM: 10,
      },
    }).waypoints;
    expect(spiral[0].height).toBe(10);
    expect(spiral.at(-1)!.height).toBe(40);
    expect(dist(spiral[0], center)).toBeCloseTo(15, 0);
    expect(dist(spiral.at(-1)!, center)).toBeCloseTo(35, 0);
    for (let i = 1; i < spiral.length; i++) {
      expect(spiral[i].height).toBeGreaterThanOrEqual(spiral[i - 1].height);
    }
    expect(spiral.at(-1)!.height).toBeGreaterThan(spiral[0].height);
  });

  it("keeps an offset square outside the footprint by the target distance", () => {
    const half = 15;
    const square = [
      meters(-half, -half),
      meters(half, -half),
      meters(half, half),
      meters(-half, half),
    ];
    const standoff = 5;
    const offset = offsetPolygon(square, standoff);
    expect(offset.selfCrossing).toBe(false);
    const south = Math.min(...offset.ring.map((point) => point[0]));
    const originalSouth = Math.min(...square.map((point) => point[0]));
    expect((originalSouth - south) * 111320).toBeCloseTo(standoff, 0);

    const { waypoints, selfCrossing } = generateBoundaryFacade({
      ...DEFAULT_POLYGON_FACADE,
      vertices: square,
      standoffM: standoff,
      minAltitude: 20,
      maxAltitude: 20,
      spacing: {
        ...DEFAULT_FACADE_SPACING,
        mode: "distance",
        horizontalM: 3,
        verticalM: 10,
      },
    });
    expect(selfCrossing).toBe(false);
    const southSide = waypoints
      .filter((wp) => wp.latitude < LAT)
      .sort(
        (a, b) => Math.abs(a.longitude - LNG) - Math.abs(b.longitude - LNG),
      )[0];
    expect(southSide.headingAngle).toBeCloseTo(0, 0);
    expect((LAT - southSide.latitude) * 111320).toBeCloseTo(half + standoff, 0);
  });

  it("warns when a tight notch makes the offset cross itself", () => {
    const notch = [
      meters(0, 0),
      meters(10, 0),
      meters(10, 10),
      meters(8, 10),
      meters(8, 4),
      meters(2, 4),
      meters(2, 10),
      meters(0, 10),
    ];
    expect(offsetPolygon(notch, 5).selfCrossing).toBe(true);
  });

  it("drops photos past the survey waypoint cap", () => {
    const result = generateBoundaryFacade(
      radial({
        radiusBottomM: 20,
        standoffM: 10,
        minAltitude: 0,
        maxAltitude: 40,
        spacing: {
          ...DEFAULT_FACADE_SPACING,
          mode: "distance",
          horizontalM: 1,
          verticalM: 1,
        },
      }),
    );
    expect(result.plannedCount).toBeGreaterThan(MAX_SURVEY_WAYPOINTS);
    expect(result.waypoints).toHaveLength(MAX_SURVEY_WAYPOINTS);
  });
});
