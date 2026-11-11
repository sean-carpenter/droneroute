import { describe, it, expect } from "vitest";
import {
  SurveyGeometryError,
  boundaryFromCalls,
  parseBearing,
} from "./surveyGeometry.js";

describe("parseBearing", () => {
  it("reads quadrant bearings in common notations", () => {
    expect(parseBearing("N 45°30'00\" E")).toBeCloseTo(45.5, 9);
    expect(parseBearing("N45-30-00E")).toBeCloseTo(45.5, 9);
    expect(parseBearing("n 45 30 e")).toBeCloseTo(45.5, 9);
    expect(parseBearing("N 45.5 E")).toBeCloseTo(45.5, 9);
    expect(parseBearing("S 89°59'30\" W")).toBeCloseTo(269.9917, 3);
    expect(parseBearing("S 10° E")).toBeCloseTo(170, 9);
    expect(parseBearing("N 10° W")).toBeCloseTo(350, 9);
    expect(parseBearing("N 0° W")).toBe(0);
    expect(parseBearing("North 12 15 East")).toBeCloseTo(12.25, 9);
  });

  it("reads cardinal directions and azimuths", () => {
    expect(parseBearing("North")).toBe(0);
    expect(parseBearing("due east")).toBe(90);
    expect(parseBearing("S")).toBe(180);
    expect(parseBearing("135.25")).toBe(135.25);
    expect(parseBearing(-90)).toBe(270);
    expect(parseBearing(725)).toBe(5);
  });

  it("rejects bearings it cannot read", () => {
    for (const bad of ["N 95° E", "N 45°75' E", "northish", "", "N E"]) {
      expect(() => parseBearing(bad)).toThrow(SurveyGeometryError);
    }
    expect(() => parseBearing(NaN)).toThrow(SurveyGeometryError);
  });
});

describe("boundaryFromCalls", () => {
  const start = { latitude: 39.5, longitude: -98.35 };
  const square = (side: number) => [
    { bearing: "N 0° E", distance: side },
    { bearing: "N 90° E", distance: side },
    { bearing: "S 0° E", distance: side },
    { bearing: "N 90° W", distance: side },
  ];

  it("closes a square and reports its size", () => {
    const result = boundaryFromCalls({ start, calls: square(100), unit: "m" });
    expect(result.closes).toBe(true);
    expect(result.closureErrorM).toBeCloseTo(0, 6);
    expect(result.polygon).toHaveLength(4);
    expect(result.polygon[0]).toEqual([39.5, -98.35]);
    expect(result.perimeterM).toBeCloseTo(400, 6);
    expect(result.areaM2).toBeCloseTo(10000, 3);
    // Second corner is 100 m north of the start
    expect((result.polygon[1][0] - 39.5) * 111195).toBeCloseTo(100, 0);
    expect(result.polygon[1][1]).toBeCloseTo(-98.35, 9);
    // Third corner is east of it
    expect(result.polygon[2][1]).toBeGreaterThan(-98.35);
  });

  it("converts units", () => {
    const feet = boundaryFromCalls({ start, calls: square(208.71) });
    expect(feet.areaAcres).toBeCloseTo(1, 2); // a one-acre square
    const survey = boundaryFromCalls({
      start,
      calls: square(1000),
      unit: "usft",
    });
    expect(survey.perimeterM).toBeCloseTo(4000 * (1200 / 3937), 6);
    const chains = boundaryFromCalls({ start, calls: square(1), unit: "ch" });
    expect(chains.perimeterM).toBeCloseTo(80.4672, 6);
  });

  it("reports a boundary that does not close", () => {
    const calls = square(100);
    calls[3] = { bearing: "N 90° W", distance: 80 };
    const result = boundaryFromCalls({ start, calls, unit: "m" });
    expect(result.closes).toBe(false);
    expect(result.closureErrorM).toBeCloseTo(20, 6);
    expect(result.polygon).toHaveLength(5);
    expect(result.warnings.join(" ")).toMatch(/does not close/);
  });

  it("rotates for a basis of bearings and flags curves", () => {
    const calls = square(100).map((c, i) => ({ ...c, isCurveChord: i === 1 }));
    const result = boundaryFromCalls({
      start,
      calls,
      unit: "m",
      rotationDeg: 90,
    });
    // The first leg now runs east instead of north
    expect(result.polygon[1][0]).toBeCloseTo(39.5, 6);
    expect(result.polygon[1][1]).toBeGreaterThan(-98.35);
    expect(result.areaM2).toBeCloseTo(10000, 3);
    expect(result.warnings.join(" ")).toMatch(/1 curved segment was/);
    expect(result.warnings.join(" ")).not.toMatch(/true north/);
  });

  it("rejects bad input", () => {
    const bad = (input: unknown) =>
      expect(() => boundaryFromCalls(input as never)).toThrow(
        SurveyGeometryError,
      );
    bad({ start, calls: [{ bearing: "N", distance: 10 }] });
    bad({ start, calls: [...square(10), { bearing: "N", distance: -1 }] });
    bad({ start: { latitude: 95, longitude: 0 }, calls: square(10) });
    bad({ start, calls: square(10), unit: "furlongs" });
    bad({
      start,
      calls: [...square(10), { bearing: "sideways", distance: 1 }],
    });
  });
});
