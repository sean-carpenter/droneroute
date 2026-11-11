/**
 * Wind advisory from Open-Meteo (https://open-meteo.com, no API key).
 * Advisory only — nothing here changes the mission.
 */

export interface WindReading {
  /** Height above ground the speed/direction refer to, in meters. */
  levelM: number;
  speedMps: number;
  /** Direction the wind blows FROM, degrees clockwise from north. */
  directionDeg: number;
  gustMps: number | null;
  /** ISO time of the model step the reading belongs to. */
  time: string;
  latitude: number;
  longitude: number;
  fetchedAt: number;
}

export interface WindLimits {
  /** Sustained wind above which a caution is shown, m/s. */
  cautionMps: number;
  /** Wind or gusts above which flying is not advised, m/s. */
  maxMps: number;
}

/** DJI lists 12 m/s as the Mavic 3 Enterprise wind resistance limit. */
export const DEFAULT_WIND_LIMITS: WindLimits = { cautionMps: 8, maxMps: 12 };

const LEVELS_M = [10, 80, 120] as const;
const CACHE_TTL_MS = 15 * 60 * 1000;
/** Positions are rounded to ~1 km before they are sent or cached. */
const COORD_DECIMALS = 2;

export function roundCoord(value: number): number {
  const f = 10 ** COORD_DECIMALS;
  return Math.round(value * f) / f;
}

/** Model level closest to the flight altitude. */
export function nearestWindLevel(altitudeM: number): number {
  return LEVELS_M.reduce((best, level) =>
    Math.abs(level - altitudeM) < Math.abs(best - altitudeM) ? level : best,
  );
}

export function windUrl(latitude: number, longitude: number): string {
  const vars = [
    ...LEVELS_M.flatMap((l) => [`wind_speed_${l}m`, `wind_direction_${l}m`]),
    "wind_gusts_10m",
  ].join(",");
  return `https://api.open-meteo.com/v1/forecast?latitude=${roundCoord(latitude)}&longitude=${roundCoord(longitude)}&current=${vars}&wind_speed_unit=ms`;
}

/** Pick the reading for the flight altitude out of an Open-Meteo response. */
export function parseWindResponse(
  body: unknown,
  altitudeM: number,
  now: number = Date.now(),
): WindReading | null {
  const current = (body as { current?: Record<string, unknown> } | null)
    ?.current;
  if (!current) return null;
  const num = (key: string): number | null => {
    const v = current[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const preferred = nearestWindLevel(altitudeM);
  const levels = [preferred, ...LEVELS_M.filter((l) => l !== preferred)];
  for (const level of levels) {
    const speed = num(`wind_speed_${level}m`);
    const direction = num(`wind_direction_${level}m`);
    if (speed === null || direction === null) continue;
    const b = body as { latitude?: number; longitude?: number };
    return {
      levelM: level,
      speedMps: speed,
      directionDeg: direction,
      gustMps: num("wind_gusts_10m"),
      time: typeof current.time === "string" ? current.time : "",
      latitude: b.latitude ?? 0,
      longitude: b.longitude ?? 0,
      fetchedAt: now,
    };
  }
  return null;
}

const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

export function compassPoint(directionDeg: number): string {
  const idx = Math.round((((directionDeg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[idx];
}

export type WindSeverity = "ok" | "caution" | "danger";

export interface WindAdvisory {
  severity: WindSeverity;
  message: string;
}

export function windAdvisory(
  reading: WindReading,
  limits: WindLimits = DEFAULT_WIND_LIMITS,
): WindAdvisory {
  const from = `${compassPoint(reading.directionDeg)} (${Math.round(reading.directionDeg)}°)`;
  const base = `Wind ${reading.speedMps.toFixed(1)} m/s from ${from}`;
  const gust =
    reading.gustMps !== null && reading.gustMps > reading.speedMps
      ? `, gusts ${reading.gustMps.toFixed(1)} m/s`
      : "";
  const peak = Math.max(reading.speedMps, reading.gustMps ?? 0);

  if (reading.speedMps >= limits.maxMps || peak >= limits.maxMps * 1.25) {
    return {
      severity: "danger",
      message: `${base}${gust}. Above the aircraft's wind limit — do not fly.`,
    };
  }
  if (reading.speedMps >= limits.cautionMps || peak >= limits.maxMps) {
    return {
      severity: "caution",
      message: `${base}${gust}. Expect shorter flight time; consider a lower speed or more overlap.`,
    };
  }
  return { severity: "ok", message: `${base}${gust}.` };
}

const cache = new Map<string, WindReading>();

/**
 * Fetch the current wind near a position. Results are cached for 15 minutes
 * per ~1 km cell and flight level; pass `force` to bypass the cache.
 */
export async function fetchWind(
  latitude: number,
  longitude: number,
  altitudeM: number,
  options: { force?: boolean; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<WindReading> {
  const now = options.now ?? Date.now();
  const key = `${roundCoord(latitude)},${roundCoord(longitude)},${nearestWindLevel(altitudeM)}`;
  const cached = cache.get(key);
  if (!options.force && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  const res = await (options.fetchImpl ?? fetch)(windUrl(latitude, longitude));
  if (!res.ok) throw new Error("Weather service unavailable");
  const reading = parseWindResponse(await res.json(), altitudeM, now);
  if (!reading) throw new Error("Weather service returned no wind data");
  cache.set(key, reading);
  return reading;
}

export function clearWindCache(): void {
  cache.clear();
}
