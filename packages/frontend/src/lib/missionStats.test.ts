import { describe, it, expect } from "vitest";
import type { Waypoint } from "@droneroute/shared";
import { DEFAULT_WAYPOINT } from "@droneroute/shared";
import {
  STOP_PENALTY_S,
  estimateMission,
  formatDuration,
  intervalPhotoCount,
} from "./missionStats";
import { sampleMission } from "./simulation";

const LAT = 41.25797;
const LNG = 0.93229;
const M_PER_DEG_LNG = 111195 * Math.cos((LAT * Math.PI) / 180);

/** Waypoint `eastM` meters east of the origin. */
function wp(i: number, eastM: number, extra: Partial<Waypoint> = {}): Waypoint {
  return {
    ...DEFAULT_WAYPOINT,
    index: i,
    name: `Waypoint ${i + 1}`,
    latitude: LAT,
    longitude: LNG + eastM / M_PER_DEG_LNG,
    height: 50,
    actions: [],
    ...extra,
  };
}

const config = {
  autoFlightSpeed: 10,
  globalTurnMode: "toPointAndPassWithContinuityCurvature" as const,
  globalHeadingMode: "followWayline" as const,
  maxBatteryMinutes: 25,
};

describe("estimateMission", () => {
  it("returns zeros for an empty mission", () => {
    const stats = estimateMission([], config);
    expect(stats.totalDistanceM).toBe(0);
    expect(stats.estimatedFlightTimeS).toBe(0);
    expect(stats.batteriesNeeded).toBe(0);
  });

  it("sums distance and time at the global speed", () => {
    const stats = estimateMission([wp(0, 0), wp(1, 1000)], config);
    expect(stats.totalDistanceM).toBeCloseTo(1000, 0);
    expect(stats.estimatedFlightTimeS).toBeCloseTo(100, 0);
    expect(stats.batteriesNeeded).toBe(1);
  });

  it("uses the departing waypoint's speed for each leg", () => {
    const stats = estimateMission(
      [
        wp(0, 0, { useGlobalSpeed: false, speed: 5 }),
        wp(1, 100, { useGlobalSpeed: false, speed: 20 }),
        wp(2, 200),
      ],
      config,
    );
    expect(stats.segments[0].timeS).toBeCloseTo(20, 1);
    expect(stats.segments[1].timeS).toBeCloseTo(5, 1);
  });

  it("includes climbs in distance and elevation gain", () => {
    const stats = estimateMission(
      [wp(0, 0, { height: 20 }), wp(1, 0, { height: 120 })],
      config,
    );
    expect(stats.totalDistanceM).toBeCloseTo(100, 6);
    expect(stats.elevationGainM).toBe(100);
  });

  it("adds a stop penalty and hover time at interior waypoints", () => {
    const passing = estimateMission([wp(0, 0), wp(1, 100), wp(2, 200)], config);
    const stopping = estimateMission(
      [
        wp(0, 0),
        wp(1, 100, {
          actions: [
            { actionId: 0, actionType: "hover", params: { hoverTime: 10 } },
          ],
        }),
        wp(2, 200),
      ],
      config,
    );
    expect(
      stopping.estimatedFlightTimeS - passing.estimatedFlightTimeS,
    ).toBeCloseTo(10 + STOP_PENALTY_S, 6);
  });

  it("counts waypoint photos and interval photos", () => {
    const photo = {
      actionId: 0,
      actionType: "takePhoto" as const,
      params: { payloadPositionIndex: 0 },
    };
    const stats = estimateMission(
      [
        wp(0, 0, { photoIntervalM: 20 }),
        wp(1, 101),
        wp(2, 200, { actions: [photo] }),
      ],
      config,
    );
    // 101 m / 20 m = 5 intervals, plus the shot at the start of the run
    expect(stats.segments[0].intervalPhotos).toBe(6);
    expect(stats.photoCount).toBe(7);
  });

  it("splits a long mission across batteries", () => {
    // 3 legs of 10 km at 10 m/s = 1000 s each; a 25 min battery fits one leg
    const stats = estimateMission(
      [wp(0, 0), wp(1, 10000), wp(2, 20000), wp(3, 30000)],
      config,
    );
    expect(stats.batteriesNeeded).toBe(3);
    expect(stats.batterySwapAfter).toEqual([1, 2]);
    expect(stats.estimatedBatteryPercent).toBeCloseTo(200, 0);
  });
});

describe("intervalPhotoCount", () => {
  it("handles missing or invalid intervals", () => {
    expect(intervalPhotoCount(100, undefined)).toBe(0);
    expect(intervalPhotoCount(100, 0)).toBe(0);
    expect(intervalPhotoCount(100, 25)).toBe(4);
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(119.7)).toBe("2m");
    expect(formatDuration(3720)).toBe("1h 2m");
  });
});

describe("sampleMission", () => {
  const waypoints = [
    wp(0, 0, { photoIntervalM: 25 }),
    wp(1, 100, { height: 70 }),
    wp(2, 100, { height: 70 }),
  ];
  // Give the last leg some length to the north
  waypoints[2].latitude += 100 / 111195;
  const stats = estimateMission(waypoints, config);

  it("returns null without waypoints", () => {
    expect(
      sampleMission([], estimateMission([], config), config, [], 0),
    ).toBeNull();
  });

  it("starts at the first waypoint heading along the first leg", () => {
    const s = sampleMission(waypoints, stats, config, [], 0)!;
    expect(s.latitude).toBe(waypoints[0].latitude);
    expect(s.headingDeg).toBeCloseTo(90, 0);
    expect(s.waypointPos).toBe(0);
    expect(s.photosTaken).toBe(0);
  });

  it("interpolates position, height and photos mid-leg", () => {
    const s = sampleMission(
      waypoints,
      stats,
      config,
      [],
      stats.segments[0].timeS / 2,
    )!;
    expect(s.phase).toBe("flying");
    expect(s.legProgress).toBeCloseTo(0.5, 6);
    expect(s.height).toBeCloseTo(60, 6);
    expect(s.photosTaken).toBe(2);
    expect(s.remainingDistanceM).toBeCloseTo(stats.totalDistanceM - 51, 0);
  });

  it("turns north on the second leg", () => {
    const s = sampleMission(
      waypoints,
      stats,
      config,
      [],
      stats.arrivalS[1] + 1,
    )!;
    expect(s.waypointPos).toBe(1);
    expect(s.headingDeg).toBeCloseTo(0, 0);
  });

  it("clamps to the end of the mission", () => {
    const s = sampleMission(waypoints, stats, config, [], 1e9)!;
    expect(s.phase).toBe("finished");
    expect(s.waypointPos).toBe(2);
    expect(s.remainingS).toBe(0);
    expect(s.remainingDistanceM).toBeCloseTo(0, 6);
  });

  it("points at the POI in toward-POI mode", () => {
    const poi = {
      id: "p",
      name: "POI",
      latitude: LAT + 0.01,
      longitude: waypoints[0].longitude,
      height: 0,
    };
    const facing = waypoints.map((w) => ({
      ...w,
      useGlobalHeadingParam: false,
      headingMode: "towardPOI" as const,
      poiId: "p",
    }));
    const s = sampleMission(facing, stats, config, [poi], 0)!;
    expect(s.headingDeg).toBeCloseTo(0, 0);
  });
});
