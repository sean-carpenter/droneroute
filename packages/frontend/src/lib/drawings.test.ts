import { describe, it, expect } from "vitest";
import {
  drawingCorners,
  drawingHeightM,
  drawingRotateHandle,
  initialWidthM,
  localMeters,
  normalizeDegrees,
  offsetMeters,
  rotationTowards,
  widthFromCorner,
} from "./drawings";

const center: [number, number] = [42.55917, -71.07792];
// A 36 x 24 in sheet, 60 m wide on the ground: 40 m tall
const sheet = {
  center,
  widthM: 60,
  rotationDeg: 0,
  widthPx: 3600,
  heightPx: 2400,
};

const close = (a: number, b: number, tol = 0.01) =>
  expect(Math.abs(a - b)).toBeLessThan(tol);

describe("drawing placement", () => {
  it("keeps the sheet's proportions", () => {
    expect(drawingHeightM(sheet)).toBe(40);
  });

  it("puts the corners at half width and height, north up", () => {
    const [tl, tr, br, bl] = drawingCorners(sheet).map((p) =>
      localMeters(center, p),
    );
    close(tl.east, -30);
    close(tl.north, 20);
    close(tr.east, 30);
    close(tr.north, 20);
    close(br.east, 30);
    close(br.north, -20);
    close(bl.east, -30);
    close(bl.north, -20);
  });

  it("rotates clockwise: at 90° the top of the sheet faces east", () => {
    const [tl, tr] = drawingCorners({ ...sheet, rotationDeg: 90 }).map((p) =>
      localMeters(center, p),
    );
    close(tl.east, 20);
    close(tl.north, 30);
    close(tr.east, 20);
    close(tr.north, -30);
    const handle = localMeters(
      center,
      drawingRotateHandle({ ...sheet, rotationDeg: 90 }),
    );
    expect(handle.east).toBeGreaterThan(20);
    close(handle.north, 0);
  });

  it("offset and local meters round-trip", () => {
    const p = offsetMeters(center, 12.5, -7.25);
    const back = localMeters(center, p);
    close(back.east, 12.5);
    close(back.north, -7.25);
  });
});

describe("handles", () => {
  it("resizes about the center from a corner, keeping proportions", () => {
    // Pull the top right corner out to twice its distance from the center
    const corner = offsetMeters(center, 60, 40);
    close(widthFromCorner(sheet, corner), 120);
    // Never below 1 m
    expect(widthFromCorner(sheet, center)).toBe(1);
  });

  it("rotates the top towards the pointer", () => {
    expect(rotationTowards(sheet, offsetMeters(center, 0, 10))).toBe(0);
    expect(rotationTowards(sheet, offsetMeters(center, 10, 0))).toBe(90);
    expect(rotationTowards(sheet, offsetMeters(center, -10, 0))).toBe(270);
  });

  it("normalizes degrees into [0, 360)", () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(359.99)).toBe(0);
    expect(normalizeDegrees(725.04)).toBe(5);
  });
});

describe("initial size", () => {
  it("fits 70% of the view without spilling over either edge", () => {
    // Wide view: height limits a 3:2 sheet
    expect(initialWidthM({ widthM: 400, heightM: 100 }, 3600, 2400)).toBe(105);
    // Tall view: width limits
    expect(initialWidthM({ widthM: 100, heightM: 400 }, 3600, 2400)).toBe(70);
  });
});
