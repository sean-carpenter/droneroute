/**
 * Convert projected survey coordinates (State Plane, UTM, …) to latitude and
 * longitude. The projection is identified by its EPSG code.
 */
import { createRequire } from "module";
import proj4 from "proj4";
import type { LatLng } from "@droneroute/shared";

export class CoordinateSystemError extends Error {}

const require = createRequire(import.meta.url);
const definitions = new Map<number, { proj4: string; name: string }>();

function lookup(epsg: number): { proj4: string; name: string } {
  if (!Number.isInteger(epsg) || epsg < 1024 || epsg > 999999) {
    throw new CoordinateSystemError("The EPSG code is not valid");
  }
  const cached = definitions.get(epsg);
  if (cached) return cached;

  let entry: { proj4?: string | null; name?: string } | undefined;
  try {
    // One small JSON file per code, loaded only when asked for
    entry = require(`epsg-index/s/${epsg}.json`);
  } catch {
    entry = undefined;
  }
  if (!entry?.proj4) {
    throw new CoordinateSystemError(
      `EPSG:${epsg} is unknown or has no projection definition`,
    );
  }
  const def = { proj4: entry.proj4, name: entry.name ?? `EPSG:${epsg}` };
  definitions.set(epsg, def);
  return def;
}

export interface ConvertedCoordinates {
  system: string;
  points: LatLng[];
}

const MAX_POINTS = 2000;

/**
 * Convert easting/northing pairs to [latitude, longitude]. Coordinates must be
 * in the unit the EPSG code defines (e.g. US survey feet for most NAD83
 * State Plane "ftUS" codes).
 */
export function convertToWgs84(
  epsg: number,
  points: { easting: number; northing: number }[],
): ConvertedCoordinates {
  if (!Array.isArray(points) || points.length === 0) {
    throw new CoordinateSystemError("No coordinates to convert");
  }
  if (points.length > MAX_POINTS) {
    throw new CoordinateSystemError(
      `Too many coordinates (limit ${MAX_POINTS})`,
    );
  }
  const def = lookup(epsg);
  const out: LatLng[] = points.map(({ easting, northing }, i) => {
    if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
      throw new CoordinateSystemError(`Coordinate ${i + 1} is not a number`);
    }
    const [lng, lat] = proj4(def.proj4, "WGS84", [easting, northing]);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new CoordinateSystemError(
        `Coordinate ${i + 1} does not fall inside ${def.name}. Check the EPSG code and the unit.`,
      );
    }
    return [lat, lng];
  });
  return { system: def.name, points: out };
}
