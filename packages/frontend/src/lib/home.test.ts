import { describe, it, expect } from "vitest";
import { homeLabel, parseCoordinates, parseGeocodeResponse } from "./home";

describe("parseCoordinates", () => {
  it("reads lat, lng separated by a comma, semicolon or space", () => {
    const expected = { latitude: 38.5816, longitude: -121.4944 };
    expect(parseCoordinates("38.5816, -121.4944")).toEqual(expected);
    expect(parseCoordinates("38.5816;-121.4944")).toEqual(expected);
    expect(parseCoordinates("  38.5816 -121.4944 ")).toEqual(expected);
  });

  it("applies hemisphere letters", () => {
    expect(parseCoordinates("38.5816 N, 121.4944 W")).toEqual({
      latitude: 38.5816,
      longitude: -121.4944,
    });
    expect(parseCoordinates("33.9° s, 18.4° e")).toEqual({
      latitude: -33.9,
      longitude: 18.4,
    });
  });

  it("rejects out-of-range values", () => {
    expect(parseCoordinates("91, 10")).toBeNull();
    expect(parseCoordinates("10, 181")).toBeNull();
  });

  it("leaves addresses alone", () => {
    expect(parseCoordinates("1600 Pennsylvania Ave")).toBeNull();
    expect(parseCoordinates("123 Main St, 95814")).toBeNull();
    expect(parseCoordinates("38.5816")).toBeNull();
    expect(parseCoordinates("")).toBeNull();
  });
});

describe("parseGeocodeResponse", () => {
  it("keeps features that have a position and a name", () => {
    const body = {
      features: [
        {
          geometry: { coordinates: [-121.4944, 38.5816] },
          properties: { full_address: "1 Main St, Sacramento, CA" },
        },
        {
          geometry: { coordinates: [-121.5, 38.6] },
          properties: { name: "X" },
        },
        { geometry: {}, properties: { full_address: "nowhere" } },
        { geometry: { coordinates: [1, 2] }, properties: {} },
      ],
    };
    expect(parseGeocodeResponse(body)).toEqual([
      {
        address: "1 Main St, Sacramento, CA",
        latitude: 38.5816,
        longitude: -121.4944,
      },
      { address: "X", latitude: 38.6, longitude: -121.5 },
    ]);
  });

  it("returns nothing for an unexpected body", () => {
    expect(parseGeocodeResponse(null)).toEqual([]);
    expect(parseGeocodeResponse({})).toEqual([]);
  });
});

describe("homeLabel", () => {
  it("prefers the address and falls back to coordinates", () => {
    expect(homeLabel({ latitude: 1, longitude: 2, address: "1 Main St" })).toBe(
      "1 Main St",
    );
    expect(homeLabel({ latitude: 38.5816, longitude: -121.4944 })).toBe(
      "38.581600, -121.494400",
    );
  });
});
