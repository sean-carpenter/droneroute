import { describe, it, expect } from "vitest";
import { GIMBAL_PITCH_MAX, GIMBAL_PITCH_MIN, resolveGimbalAim } from "./geo";

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
