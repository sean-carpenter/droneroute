import { describe, it, expect } from "vitest";
import {
  GIMBAL_PITCH_MAX,
  GIMBAL_PITCH_MIN,
  OBSTACLE_CLEARANCE_M,
  getObstacleWarnings,
  isObstacleConflict,
  resolveGimbalAim,
  siteFeaturesAsObstacles,
} from "./geo";

const LAT = 41.25797;
const LNG = 0.93229;
/** A point `m` meters north of the origin. */
const north = (m: number) => LAT + m / 111195;

const drone = (height: number) => ({ latitude: LAT, longitude: LNG, height });
const poi = (m: number, height: number) => ({
  id: "p1",
  latitude: north(m),
  longitude: LNG,
  height,
});

describe("resolveGimbalAim", () => {
  it("returns a fixed pitch, clamped to the gimbal range", () => {
    expect(resolveGimbalAim(drone(30), { mode: "fixed", pitch: -30 })).toEqual({
      gimbalPitchAngle: -30,
    });
    expect(
      resolveGimbalAim(drone(30), { mode: "fixed", pitch: -120 })
        .gimbalPitchAngle,
    ).toBe(GIMBAL_PITCH_MIN);
    expect(
      resolveGimbalAim(drone(30), { mode: "fixed", pitch: 80 })
        .gimbalPitchAngle,
    ).toBe(GIMBAL_PITCH_MAX);
  });

  it("aims at a POI and reports it so the heading can follow", () => {
    // 30 m above a target 30 m away → 45° down
    expect(
      resolveGimbalAim(
        drone(30),
        { mode: "towardPOI", poiId: "p1" },
        { pois: [poi(30, 0)] },
      ),
    ).toEqual({ gimbalPitchAngle: -45, poiId: "p1" });
  });

  it("looks up at a POI above the aircraft", () => {
    expect(
      resolveGimbalAim(
        drone(10),
        { mode: "towardPOI", poiId: "p1" },
        { pois: [poi(40, 50)] },
      ).gimbalPitchAngle,
    ).toBe(GIMBAL_PITCH_MAX); // 45° up, limited by the gimbal
  });

  it("falls back when the POI is gone", () => {
    expect(
      resolveGimbalAim(
        drone(30),
        { mode: "towardPOI", poiId: "missing" },
        { pois: [poi(30, 0)], fallbackPitch: -20 },
      ),
    ).toEqual({ gimbalPitchAngle: -20 });
  });

  it("aims at a point and follows altitude", () => {
    const target = {
      mode: "towardPoint" as const,
      latitude: north(20),
      longitude: LNG,
      height: 20,
    };
    const pitchAt = (h: number) =>
      resolveGimbalAim(drone(h), target).gimbalPitchAngle;
    expect(pitchAt(20)).toBe(0); // level with the target
    expect(pitchAt(40)).toBe(-45); // above it
    expect(pitchAt(10)).toBeCloseTo(27, 0); // below it → looks up
    expect(pitchAt(60)).toBeLessThan(pitchAt(40));
  });

  it("points straight down when directly above the target", () => {
    expect(
      resolveGimbalAim(drone(50), {
        mode: "towardPoint",
        latitude: LAT,
        longitude: LNG,
        height: 0,
      }).gimbalPitchAngle,
    ).toBe(-90);
  });

  it("offsets from perpendicular for walls and from nadir for ground", () => {
    const strategy = { mode: "relativeToSurface" as const, offsetDeg: 15 };
    // Wall: 15° below level
    expect(resolveGimbalAim(drone(30), strategy).gimbalPitchAngle).toBe(-15);
    expect(
      resolveGimbalAim(drone(30), strategy, { surfacePitchDeg: 0 })
        .gimbalPitchAngle,
    ).toBe(-15);
    // Ground: 15° up from straight down
    expect(
      resolveGimbalAim(drone(30), strategy, { surfacePitchDeg: -90 })
        .gimbalPitchAngle,
    ).toBe(-75);
  });

  it("is deterministic", () => {
    const run = () =>
      resolveGimbalAim(
        drone(37.5),
        { mode: "towardPOI", poiId: "p1" },
        { pois: [poi(42, 3)] },
      );
    expect(run()).toEqual(run());
  });
});

describe("getObstacleWarnings", () => {
  // A square 20 m on a side, centered 30 m north of the origin.
  const east = (m: number) =>
    LNG + m / (111195 * Math.cos((LAT * Math.PI) / 180));
  const square = (height?: number | null) => ({
    id: "o1",
    name: "Trees",
    description: "",
    vertices: [
      [north(20), east(-10)],
      [north(20), east(10)],
      [north(40), east(10)],
      [north(40), east(-10)],
    ] as [number, number][],
    ...(height === undefined ? {} : { height }),
  });
  const wp = (
    index: number,
    northM: number,
    eastM: number,
    height: number,
  ) => ({
    index,
    latitude: north(northM),
    longitude: east(eastM),
    height,
  });
  const types = (warnings: ReturnType<typeof getObstacleWarnings>) =>
    warnings.map((w) => `${w.waypointIndex}:${w.type}`);

  // Waypoint 0 is west of the square, 1 inside it, 2 east of it.
  const route = (height: number) => [
    wp(0, 30, -30, height),
    wp(1, 30, 0, height),
    wp(2, 30, 30, height),
  ];

  it("flags everything when the obstacle has no height", () => {
    for (const obstacle of [square(), square(null)]) {
      const warnings = getObstacleWarnings(route(120), [obstacle]);
      expect(types(warnings)).toEqual(["1:inside", "0:crosses", "1:crosses"]);
      expect(warnings.every(isObstacleConflict)).toBe(true);
    }
  });

  it("flags a route at or below the obstacle's height plus clearance", () => {
    const below = OBSTACLE_CLEARANCE_M - 0.1;
    expect(types(getObstacleWarnings(route(10), [square(25)]))).toEqual([
      "1:inside",
      "0:crosses",
      "1:crosses",
    ]);
    expect(
      getObstacleWarnings(route(25 + below), [square(25)]).every(
        isObstacleConflict,
      ),
    ).toBe(true);
  });

  it("reports a route that clears the obstacle as passing over", () => {
    const warnings = getObstacleWarnings(route(25 + OBSTACLE_CLEARANCE_M), [
      square(25),
    ]);
    expect(types(warnings)).toEqual([
      "1:passesOver",
      "0:passesOver",
      "1:passesOver",
    ]);
    expect(warnings.some(isObstacleConflict)).toBe(false);
  });

  it("judges a leg by its lower end", () => {
    // Climbing from 12 m to 50 m across the square: the low end is in the trees.
    const warnings = getObstacleWarnings(
      [wp(0, 30, -30, 12), wp(1, 30, 30, 50)],
      [square(25)],
    );
    expect(types(warnings)).toEqual(["0:crosses"]);
  });

  it("clears nothing when heights cannot be compared", () => {
    const warnings = getObstacleWarnings(route(120), [square(25)], {
      compareHeights: false,
    });
    expect(warnings.every(isObstacleConflict)).toBe(true);
    // Waypoints without a height are never cleared either.
    const bare = route(120).map(({ height: _height, ...rest }) => rest);
    expect(
      getObstacleWarnings(bare, [square(25)]).every(isObstacleConflict),
    ).toBe(true);
  });

  it("leaves a route that stays outside alone", () => {
    expect(
      getObstacleWarnings([wp(0, 0, -30, 5), wp(1, 0, 30, 5)], [square(25)]),
    ).toEqual([]);
  });
});

describe("siteFeaturesAsObstacles", () => {
  const base = {
    id: "f",
    name: "Garage",
    kind: "garage" as const,
    color: "#f59e0b",
    vertices: [
      [north(20), LNG - 0.0001],
      [north(20), LNG + 0.0001],
      [north(40), LNG + 0.0001],
    ] as [number, number][],
    isObstacle: true,
    source: "manual" as const,
  };

  it("passes on buildings marked as obstacles, with their height", () => {
    const out = siteFeaturesAsObstacles([
      { ...base, heightM: 6 },
      { ...base, id: "lot", kind: "lot", isObstacle: false },
    ]);
    expect(out).toEqual([
      {
        id: "f",
        name: "Garage",
        description: "",
        vertices: base.vertices,
        height: 6,
      },
    ]);
    expect(siteFeaturesAsObstacles([base])[0].height).toBeNull();
  });

  it("makes a route through a building a conflict", () => {
    const route = [
      { index: 0, latitude: north(30), longitude: LNG - 0.001, height: 10 },
      { index: 1, latitude: north(30), longitude: LNG + 0.001, height: 10 },
    ];
    const warnings = getObstacleWarnings(
      route,
      siteFeaturesAsObstacles([{ ...base, heightM: 6 }]),
    );
    expect(warnings.map((w) => w.type)).toEqual(["crosses"]);
  });
});
