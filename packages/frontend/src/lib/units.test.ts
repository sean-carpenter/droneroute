import { describe, it, expect } from "vitest";
import { formatShortDistance } from "./units";

describe("formatShortDistance", () => {
  it("keeps centimeters for close-range figures", () => {
    expect(formatShortDistance(0.352)).toBe("0.35 m");
    expect(formatShortDistance(1.4065)).toBe("1.41 m");
    expect(formatShortDistance(12.46)).toBe("12.5 m");
    expect(formatShortDistance(250)).toBe("250 m");
  });

  it("uses tenths of a foot in imperial", () => {
    expect(formatShortDistance(0.3048, "imperial")).toBe("1.0 ft");
    expect(formatShortDistance(1.41, "imperial")).toBe("4.6 ft");
  });
});
