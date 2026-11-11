import { describe, it, expect, beforeEach } from "vitest";
import {
  clearWindCache,
  compassPoint,
  fetchWind,
  nearestWindLevel,
  parseWindResponse,
  windAdvisory,
  windUrl,
  type WindReading,
} from "./wind";

// Shape captured from a real Open-Meteo response
const RESPONSE = {
  latitude: 41.414772,
  longitude: 2.2254717,
  current: {
    time: "2026-11-11T04:15",
    interval: 900,
    wind_speed_10m: 1.27,
    wind_direction_10m: 315,
    wind_gusts_10m: 2.3,
    wind_speed_80m: 1.97,
    wind_direction_80m: 294,
    wind_speed_120m: 2.86,
    wind_direction_120m: 282,
  },
};

const reading = (overrides: Partial<WindReading>): WindReading => ({
  levelM: 80,
  speedMps: 3,
  directionDeg: 270,
  gustMps: null,
  time: "",
  latitude: 0,
  longitude: 0,
  fetchedAt: 0,
  ...overrides,
});

describe("wind", () => {
  beforeEach(() => clearWindCache());

  it("picks the model level nearest the flight altitude", () => {
    expect(nearestWindLevel(20)).toBe(10);
    expect(nearestWindLevel(80)).toBe(80);
    expect(nearestWindLevel(110)).toBe(120);
  });

  it("parses the reading for the flight altitude", () => {
    const r = parseWindResponse(RESPONSE, 90, 1234)!;
    expect(r.levelM).toBe(80);
    expect(r.speedMps).toBe(1.97);
    expect(r.directionDeg).toBe(294);
    expect(r.gustMps).toBe(2.3);
    expect(r.fetchedAt).toBe(1234);
  });

  it("falls back to another level when the preferred one is missing", () => {
    const body = {
      current: { wind_speed_10m: 4, wind_direction_10m: 90 },
    };
    expect(parseWindResponse(body, 120)!.levelM).toBe(10);
  });

  it("rejects malformed responses", () => {
    expect(parseWindResponse(null, 50)).toBeNull();
    expect(parseWindResponse({}, 50)).toBeNull();
    expect(
      parseWindResponse({ current: { wind_speed_10m: "fast" } }, 50),
    ).toBeNull();
  });

  it("sends only a rounded position", () => {
    const url = windUrl(41.25797725781744, 0.9322907667035154);
    expect(url).toContain("latitude=41.26&");
    expect(url).toContain("longitude=0.93&");
    expect(url).toContain("wind_speed_unit=ms");
  });

  it("names compass points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(270)).toBe("W");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(-90)).toBe("W");
  });

  it("grades the advisory by wind and gusts", () => {
    expect(windAdvisory(reading({ speedMps: 3 })).severity).toBe("ok");
    expect(windAdvisory(reading({ speedMps: 9 })).severity).toBe("caution");
    expect(windAdvisory(reading({ speedMps: 5, gustMps: 12.5 })).severity).toBe(
      "caution",
    );
    expect(windAdvisory(reading({ speedMps: 13 })).severity).toBe("danger");
    expect(windAdvisory(reading({ speedMps: 6 })).message).toBe(
      "Wind 6.0 m/s from W (270°).",
    );
  });

  it("caches per location and honors force", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: true, json: async () => RESPONSE };
    }) as unknown as typeof fetch;

    await fetchWind(41.2, 0.9, 80, { fetchImpl, now: 0 });
    await fetchWind(41.2001, 0.9001, 80, { fetchImpl, now: 60_000 });
    expect(calls).toBe(1);

    await fetchWind(41.2, 0.9, 80, { fetchImpl, now: 16 * 60_000 });
    expect(calls).toBe(2);

    await fetchWind(41.2, 0.9, 80, {
      fetchImpl,
      now: 16 * 60_000,
      force: true,
    });
    expect(calls).toBe(3);
  });

  it("reports service failures", async () => {
    const fetchImpl = (async () => ({ ok: false })) as unknown as typeof fetch;
    await expect(fetchWind(1, 2, 50, { fetchImpl })).rejects.toThrow(
      "Weather service unavailable",
    );
  });
});
