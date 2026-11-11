/**
 * Geometry for land-survey descriptions: turn "N 45°30' E, 120.00 ft" style
 * boundary calls into a polygon on the map. Pure functions — AI agents call
 * these instead of doing the trigonometry themselves.
 */
import type { LatLng } from "@droneroute/shared";

export class SurveyGeometryError extends Error {}

export type DistanceUnit = "ft" | "usft" | "m" | "ch";

const METERS_PER_UNIT: Record<DistanceUnit, number> = {
  ft: 0.3048, // international foot
  usft: 1200 / 3937, // US survey foot
  m: 1,
  ch: 20.1168, // Gunter's chain (66 ft)
};

const CARDINALS: Record<string, number> = {
  N: 0,
  NORTH: 0,
  E: 90,
  EAST: 90,
  S: 180,
  SOUTH: 180,
  W: 270,
  WEST: 270,
};

/**
 * Parse a bearing into an azimuth in degrees clockwise from north.
 * Accepts quadrant bearings (`N 45°30'15" E`, `S45-30-15W`, `N 45.5 E`),
 * cardinal words (`North`, `due east`) and plain azimuths (`135.25`).
 */
export function parseBearing(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input))
      throw new SurveyGeometryError("Invalid bearing");
    return ((input % 360) + 360) % 360;
  }

  const text = input
    .trim()
    .toUpperCase()
    .replace(/^DUE\s+/, "");
  if (text in CARDINALS) return CARDINALS[text];

  const quadrant = /^(N|S|NORTH|SOUTH)\s*(.*?)\s*(E|W|EAST|WEST)$/.exec(text);
  if (quadrant) {
    const parts = quadrant[2].match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (parts.length === 0 || parts.length > 3) {
      throw new SurveyGeometryError(`Cannot read bearing "${input}"`);
    }
    const [deg, min = 0, sec = 0] = parts;
    const angle = deg + min / 60 + sec / 3600;
    if (angle > 90 || min >= 60 || sec >= 60) {
      throw new SurveyGeometryError(
        `Bearing "${input}" is out of range (quadrant angles go from 0 to 90°)`,
      );
    }
    const fromNorth = quadrant[1].startsWith("N");
    const toEast = quadrant[3].startsWith("E");
    if (fromNorth) return toEast ? angle : (360 - angle) % 360;
    return toEast ? 180 - angle : 180 + angle;
  }

  const azimuth = Number(text.replace(/°$/, ""));
  if (text !== "" && Number.isFinite(azimuth)) {
    return ((azimuth % 360) + 360) % 360;
  }
  throw new SurveyGeometryError(`Cannot read bearing "${input}"`);
}

export interface BoundaryCall {
  /** Quadrant bearing, cardinal direction or azimuth in degrees. */
  bearing: string | number;
  distance: number;
  /** True when this call is the chord of a curve rather than a straight line. */
  isCurveChord?: boolean;
}

export interface BoundaryFromCallsInput {
  /** Point of beginning. */
  start: { latitude: number; longitude: number };
  calls: BoundaryCall[];
  unit?: DistanceUnit;
  /**
   * Degrees to rotate every bearing clockwise, for descriptions whose basis
   * of bearings is not true north.
   */
  rotationDeg?: number;
}

export interface BoundaryFromCallsResult {
  /** Vertices starting at the point of beginning, without repeating it at the end. */
  polygon: LatLng[];
  /** Gap between the last point and the point of beginning, in meters. */
  closureErrorM: number;
  perimeterM: number;
  areaM2: number;
  areaAcres: number;
  /** True when the gap is small enough to treat the figure as closed. */
  closes: boolean;
  warnings: string[];
}

const EARTH_R = 6371000;
const DEG = Math.PI / 180;
const MAX_CALLS = 500;

/** Trace boundary calls from a point of beginning into a polygon. */
export function boundaryFromCalls(
  input: BoundaryFromCallsInput,
): BoundaryFromCallsResult {
  const { start, calls } = input;
  const unit = input.unit ?? "ft";
  const metersPerUnit = METERS_PER_UNIT[unit];
  if (!metersPerUnit) {
    throw new SurveyGeometryError(`Unknown distance unit "${unit}"`);
  }
  if (
    !Number.isFinite(start?.latitude) ||
    !Number.isFinite(start?.longitude) ||
    Math.abs(start.latitude) > 90 ||
    Math.abs(start.longitude) > 180
  ) {
    throw new SurveyGeometryError(
      "The point of beginning is not a valid position",
    );
  }
  if (!Array.isArray(calls) || calls.length < 2) {
    throw new SurveyGeometryError("At least two boundary calls are needed");
  }
  if (calls.length > MAX_CALLS) {
    throw new SurveyGeometryError(
      `Too many boundary calls (limit ${MAX_CALLS})`,
    );
  }

  const rotation = input.rotationDeg ?? 0;
  const warnings: string[] = [];

  // Trace in local east/north meters from the point of beginning
  const points: [number, number][] = [[0, 0]];
  let perimeterM = 0;
  let curves = 0;
  calls.forEach((call, i) => {
    if (!Number.isFinite(call.distance) || call.distance <= 0) {
      throw new SurveyGeometryError(`Call ${i + 1} has an invalid distance`);
    }
    const azimuth = (parseBearing(call.bearing) + rotation) * DEG;
    const length = call.distance * metersPerUnit;
    const [x, y] = points[points.length - 1];
    points.push([
      x + length * Math.sin(azimuth),
      y + length * Math.cos(azimuth),
    ]);
    perimeterM += length;
    if (call.isCurveChord) curves++;
  });

  const [endX, endY] = points[points.length - 1];
  const closureErrorM = Math.hypot(endX, endY);
  // 1:500 is far looser than any real survey; beyond it something was misread
  const closes = closureErrorM <= Math.max(0.5, perimeterM / 500);

  if (closes) {
    points.pop(); // the last call returns to the point of beginning
  } else {
    warnings.push(
      `The boundary does not close: it ends ${closureErrorM.toFixed(1)} m from the point of beginning. A call was probably misread or left out.`,
    );
  }
  if (curves > 0) {
    warnings.push(
      `${curves} curved segment${curves > 1 ? "s were" : " was"} drawn as straight chords.`,
    );
  }
  if (rotation === 0) {
    warnings.push(
      "Bearings were treated as true north. Survey bearings are usually grid or record bearings and can be rotated a degree or two.",
    );
  }

  // Shoelace area in local meters
  let twiceArea = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    twiceArea += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  const areaM2 = Math.abs(twiceArea / 2);

  const cosLat = Math.cos(start.latitude * DEG);
  const polygon: LatLng[] = points.map(([x, y]) => [
    start.latitude + y / (DEG * EARTH_R),
    start.longitude + x / (DEG * EARTH_R * cosLat),
  ]);

  return {
    polygon,
    closureErrorM,
    perimeterM,
    areaM2,
    areaAcres: areaM2 / 4046.8564224,
    closes,
    warnings,
  };
}
