import { describe, it, expect } from "vitest";
import {
  MAVIC_3E_CAMERA,
  altitudeForGsd,
  cameraForPayload,
  footprintM,
  gsdCmPerPx,
  maxSpeedForInterval,
  spacingFromOverlap,
} from "./camera";

describe("camera math", () => {
  it("computes GSD for the Mavic 3E at 100 m", () => {
    // 100 m * 17.3 mm / (12.3 mm * 5280 px) = 2.66 cm/px
    expect(gsdCmPerPx(100)).toBeCloseTo(2.664, 2);
  });

  it("scales GSD linearly with altitude", () => {
    expect(gsdCmPerPx(50)).toBeCloseTo(gsdCmPerPx(100) / 2, 6);
  });

  it("inverts GSD back to altitude", () => {
    expect(altitudeForGsd(gsdCmPerPx(73))).toBeCloseTo(73, 6);
  });

  it("computes the ground footprint", () => {
    const { widthM, heightM } = footprintM(100);
    expect(widthM).toBeCloseTo(140.65, 1);
    expect(heightM).toBeCloseTo(105.69, 1);
    // Footprint aspect matches the sensor aspect
    expect(widthM / heightM).toBeCloseTo(17.3 / 13.0, 6);
  });

  it("derives spacing from overlap", () => {
    const { lineSpacingM, photoIntervalM } = spacingFromOverlap(100, 0.75, 0.8);
    expect(lineSpacingM).toBeCloseTo(140.65 * 0.25, 1);
    expect(photoIntervalM).toBeCloseTo(105.69 * 0.2, 1);
  });

  it("never returns zero spacing for out-of-range overlap", () => {
    const { lineSpacingM, photoIntervalM } = spacingFromOverlap(100, 1, 1.5);
    expect(lineSpacingM).toBeGreaterThan(0);
    expect(photoIntervalM).toBeGreaterThan(0);
  });

  it("limits speed by the camera's shortest photo interval", () => {
    expect(maxSpeedForInterval(7)).toBeCloseTo(
      7 / MAVIC_3E_CAMERA.minPhotoIntervalS,
      6,
    );
  });

  it("flags payloads without known geometry", () => {
    expect(cameraForPayload(66)).toEqual({
      camera: MAVIC_3E_CAMERA,
      exact: true,
    });
    expect(cameraForPayload(52).exact).toBe(false);
  });
});
