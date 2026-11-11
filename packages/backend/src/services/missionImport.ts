/**
 * Import missions from common route formats: DJI WPML KMZ, plain KML/KMZ
 * (Google Earth), GPX and Litchi CSV. Every parser is a pure function of the
 * file contents and returns a normalized mission plus human-readable warnings
 * about anything it had to assume or drop.
 */
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type {
  MissionConfig,
  PointOfInterest,
  Waypoint,
  WaypointAction,
} from "@droneroute/shared";
import { DEFAULT_WAYPOINT } from "@droneroute/shared";
import { v4 as uuidv4 } from "uuid";
import { isWpmlArchive, parseWpmlArchive } from "./kmzParser.js";

export type ImportFormat = "wpml" | "kml" | "gpx" | "litchi";

export interface ImportedMission {
  format: ImportFormat;
  /** Only WPML files carry mission settings; other formats leave them alone. */
  config?: MissionConfig;
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  warnings: string[];
}

/** Thrown for files we can't read; the message is safe to show to the user. */
export class ImportError extends Error {}

export const IMPORT_EXTENSIONS = [".kmz", ".kml", ".gpx", ".csv"] as const;

/** Longer paths are thinned out to this many waypoints. */
export const MAX_IMPORT_WAYPOINTS = 500;
/** Uncompressed size limit for a document inside a KMZ archive. */
const MAX_INNER_DOC_BYTES = 20 * 1024 * 1024;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  // Uploaded files are untrusted: never expand DTD entities.
  processEntities: false,
  parseTagValue: false,
});

type LatLngAlt = { latitude: number; longitude: number; altitude?: number };

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function validPosition(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Keep at most `max` points, evenly spread, always including both ends. */
export function thinPoints<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
  }
  return out;
}

function makeWaypoint(
  pos: number,
  point: LatLngAlt,
  extra: Partial<Waypoint> = {},
): Waypoint {
  return {
    ...DEFAULT_WAYPOINT,
    index: pos,
    name: `Waypoint ${pos + 1}`,
    latitude: point.latitude,
    longitude: point.longitude,
    actions: [],
    ...extra,
  };
}

/** Turn a bare path into waypoints, thinning and warning as needed. */
function pathToWaypoints(
  points: LatLngAlt[],
  warnings: string[],
  useAltitude: boolean,
): Waypoint[] {
  const thinned = thinPoints(points, MAX_IMPORT_WAYPOINTS);
  if (thinned.length < points.length) {
    warnings.push(
      `The path had ${points.length} points; it was thinned to ${thinned.length} waypoints.`,
    );
  }
  return thinned.map((p, i) =>
    makeWaypoint(
      i,
      p,
      useAltitude && p.altitude !== undefined && p.altitude >= 1
        ? { height: Math.round(p.altitude * 10) / 10 }
        : {},
    ),
  );
}

// ── KML ──────────────────────────────────────────────────

function parseKmlCoordinates(text: unknown): LatLngAlt[] {
  const points: LatLngAlt[] = [];
  for (const tuple of String(text ?? "")
    .trim()
    .split(/\s+/)) {
    if (!tuple) continue;
    const [lng, lat, alt] = tuple.split(",").map(Number);
    if (!validPosition(lat, lng)) continue;
    points.push({
      latitude: lat,
      longitude: lng,
      altitude: Number.isFinite(alt) ? alt : undefined,
    });
  }
  return points;
}

interface KmlGeometry {
  kind: "point" | "line" | "polygon";
  points: LatLngAlt[];
  relativeAltitude: boolean;
}

function collectKmlGeometry(node: any, out: KmlGeometry[], depth = 0): void {
  if (!node || typeof node !== "object" || depth > 12) return;

  const relative = (g: any) => g?.altitudeMode === "relativeToGround";

  for (const point of asArray<any>(node.Point)) {
    const points = parseKmlCoordinates(point.coordinates);
    if (points.length) {
      out.push({ kind: "point", points, relativeAltitude: relative(point) });
    }
  }
  for (const line of asArray<any>(node.LineString)) {
    const points = parseKmlCoordinates(line.coordinates);
    if (points.length >= 2) {
      out.push({ kind: "line", points, relativeAltitude: relative(line) });
    }
  }
  for (const track of asArray<any>(node.Track)) {
    // gx:Track — "lng lat alt" triples
    const points: LatLngAlt[] = [];
    for (const coord of asArray<any>(track.coord)) {
      const [lng, lat, alt] = String(coord).trim().split(/\s+/).map(Number);
      if (validPosition(lat, lng)) {
        points.push({
          latitude: lat,
          longitude: lng,
          altitude: Number.isFinite(alt) ? alt : undefined,
        });
      }
    }
    if (points.length >= 2) {
      out.push({ kind: "line", points, relativeAltitude: relative(track) });
    }
  }
  for (const polygon of asArray<any>(node.Polygon)) {
    const ring = parseKmlCoordinates(
      polygon.outerBoundaryIs?.LinearRing?.coordinates,
    );
    // Drop the closing vertex that repeats the first one
    if (ring.length >= 4) ring.pop();
    if (ring.length >= 3) {
      out.push({
        kind: "polygon",
        points: ring,
        relativeAltitude: relative(polygon),
      });
    }
  }

  for (const key of ["Document", "Folder", "Placemark", "MultiGeometry"]) {
    for (const child of asArray<any>(node[key])) {
      collectKmlGeometry(child, out, depth + 1);
    }
  }
}

export function parseKml(text: string): ImportedMission {
  let root: any;
  try {
    root = xml.parse(text);
  } catch {
    throw new ImportError("The KML file is not valid XML");
  }
  if (!root?.kml) throw new ImportError("The file is not a KML document");

  const geometry: KmlGeometry[] = [];
  collectKmlGeometry(root.kml, geometry);

  const warnings: string[] = [];
  const lines = geometry.filter((g) => g.kind === "line");
  const polygons = geometry.filter((g) => g.kind === "polygon");
  const points = geometry.filter((g) => g.kind === "point");

  let source: LatLngAlt[];
  let relativeAltitude: boolean;
  if (lines.length > 0) {
    source = lines.flatMap((l) => l.points);
    relativeAltitude = lines.every((l) => l.relativeAltitude);
    if (lines.length > 1) {
      warnings.push(`${lines.length} paths were joined into one route.`);
    }
    if (polygons.length > 0) {
      warnings.push("Polygons in the file were ignored.");
    }
  } else if (polygons.length > 0) {
    source = polygons[0].points;
    relativeAltitude = polygons[0].relativeAltitude;
    warnings.push(
      "The polygon outline was imported as a route around its edge.",
    );
    if (polygons.length > 1) {
      warnings.push("Only the first polygon was imported.");
    }
  } else {
    source = points.flatMap((p) => p.points);
    relativeAltitude =
      points.length > 0 && points.every((p) => p.relativeAltitude);
  }

  if (source.length === 0) {
    throw new ImportError("No paths, polygons or placemarks found in the KML");
  }

  const useAltitude =
    relativeAltitude && source.some((p) => (p.altitude ?? 0) >= 1);
  if (!useAltitude) {
    warnings.push(
      `The file has no heights above ground; waypoints were set to ${DEFAULT_WAYPOINT.height} m.`,
    );
  }

  // Placemark points that accompany a path become points of interest.
  const pois: PointOfInterest[] =
    lines.length > 0 || polygons.length > 0
      ? points
          .flatMap((p) => p.points)
          .slice(0, 200)
          .map((p, i) => ({
            id: uuidv4(),
            name: `POI ${i + 1}`,
            latitude: p.latitude,
            longitude: p.longitude,
            height: 0,
          }))
      : [];

  return {
    format: "kml",
    waypoints: pathToWaypoints(source, warnings, useAltitude),
    pois,
    warnings,
  };
}

// ── GPX ──────────────────────────────────────────────────

function gpxPoints(nodes: any[]): LatLngAlt[] {
  const out: LatLngAlt[] = [];
  for (const node of nodes) {
    const lat = Number(node?.["@_lat"]);
    const lng = Number(node?.["@_lon"]);
    if (validPosition(lat, lng)) out.push({ latitude: lat, longitude: lng });
  }
  return out;
}

export function parseGpx(text: string): ImportedMission {
  let root: any;
  try {
    root = xml.parse(text);
  } catch {
    throw new ImportError("The GPX file is not valid XML");
  }
  const gpx = root?.gpx;
  if (!gpx) throw new ImportError("The file is not a GPX document");

  const warnings: string[] = [];
  const routes = asArray<any>(gpx.rte).map((r) =>
    gpxPoints(asArray<any>(r.rtept)),
  );
  const tracks = asArray<any>(gpx.trk).map((t) =>
    asArray<any>(t.trkseg).flatMap((seg) => gpxPoints(asArray<any>(seg.trkpt))),
  );
  const marks = gpxPoints(asArray<any>(gpx.wpt));

  const route = routes.find((r) => r.length >= 2);
  const track = tracks.find((t) => t.length >= 2);

  let source: LatLngAlt[];
  let pois: PointOfInterest[] = [];
  if (route || track) {
    source = (route ?? track)!;
    const others =
      routes.filter((r) => r.length >= 2).length +
      tracks.filter((t) => t.length >= 2).length -
      1;
    if (others > 0) {
      warnings.push(
        `The file has several routes or tracks; only the first ${route ? "route" : "track"} was imported.`,
      );
    }
    pois = marks.slice(0, 200).map((p, i) => ({
      id: uuidv4(),
      name: `POI ${i + 1}`,
      latitude: p.latitude,
      longitude: p.longitude,
      height: 0,
    }));
  } else {
    source = marks;
  }

  if (source.length === 0) {
    throw new ImportError("No route, track or waypoints found in the GPX");
  }

  // GPX elevations are above sea level, not above ground, so they are not used.
  warnings.push(
    `GPX has no heights above ground; waypoints were set to ${DEFAULT_WAYPOINT.height} m.`,
  );

  return {
    format: "gpx",
    waypoints: pathToWaypoints(source, warnings, false),
    pois,
    warnings,
  };
}

// ── Litchi CSV ───────────────────────────────────────────

/** Split one CSV line, honoring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Litchi heading is 0–360; WPML uses -180..180. */
function normalizeHeading(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return Math.round(wrapped > 180 ? wrapped - 360 : wrapped);
}

export function parseLitchiCsv(text: string): ImportedMission {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new ImportError("The CSV file has no waypoints");

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const latCol = col("latitude");
  const lngCol = col("longitude");
  if (latCol === -1 || lngCol === -1) {
    throw new ImportError(
      "The CSV is not a Litchi mission: latitude/longitude columns are missing",
    );
  }

  const columns = {
    altitude: col("altitude(m)"),
    heading: col("heading(deg)"),
    curve: col("curvesize(m)"),
    gimbalMode: col("gimbalmode"),
    gimbalPitch: col("gimbalpitchangle"),
    speed: col("speed(m/s)"),
    poiLat: col("poi_latitude"),
    poiLng: col("poi_longitude"),
    poiAlt: col("poi_altitude(m)"),
    photoTime: col("photo_timeinterval"),
    photoDist: col("photo_distinterval"),
  };
  const actionCols: { type: number; param: number }[] = [];
  for (let n = 1; n <= 15; n++) {
    const type = col(`actiontype${n}`);
    if (type === -1) break;
    actionCols.push({ type, param: col(`actionparam${n}`) });
  }

  const warnings: string[] = [];
  const poiByKey = new Map<string, PointOfInterest>();
  const waypoints: Waypoint[] = [];
  let skippedRows = 0;
  let timedIntervals = false;

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const num = (index: number): number | undefined => {
      if (index === -1) return undefined;
      const v = Number(cells[index]);
      return cells[index] !== "" && Number.isFinite(v) ? v : undefined;
    };

    const lat = num(latCol);
    const lng = num(lngCol);
    if (lat === undefined || lng === undefined || !validPosition(lat, lng)) {
      skippedRows++;
      continue;
    }

    const extra: Partial<Waypoint> = {};

    const altitude = num(columns.altitude);
    if (altitude !== undefined) {
      extra.height = Math.max(1, Math.round(altitude * 10) / 10);
    }

    const speed = num(columns.speed);
    if (speed !== undefined && speed > 0) {
      extra.speed = speed;
      extra.useGlobalSpeed = false;
    }

    // Heading: face the POI when one is set, otherwise the listed heading
    const poiLat = num(columns.poiLat);
    const poiLng = num(columns.poiLng);
    const hasPoi =
      poiLat !== undefined &&
      poiLng !== undefined &&
      (poiLat !== 0 || poiLng !== 0) &&
      validPosition(poiLat, poiLng);
    if (hasPoi) {
      const poiAlt = num(columns.poiAlt) ?? 0;
      const key = `${poiLat},${poiLng},${poiAlt}`;
      if (!poiByKey.has(key)) {
        poiByKey.set(key, {
          id: uuidv4(),
          name: `POI ${poiByKey.size + 1}`,
          latitude: poiLat!,
          longitude: poiLng!,
          height: Math.round(poiAlt),
        });
      }
      extra.useGlobalHeadingParam = false;
      extra.headingMode = "towardPOI";
      extra.poiId = poiByKey.get(key)!.id;
    } else {
      const heading = num(columns.heading);
      if (heading !== undefined) {
        extra.useGlobalHeadingParam = false;
        extra.headingMode = "smoothTransition";
        extra.headingAngle = normalizeHeading(heading);
      }
    }

    // Curve size 0 means stop at the waypoint; otherwise fly a rounded corner
    const curve = num(columns.curve);
    if (curve !== undefined) {
      extra.useGlobalTurnParam = false;
      if (curve > 0) {
        extra.turnMode = "toPointAndPassWithContinuityCurvature";
        extra.turnDampingDist = curve;
      } else {
        extra.turnMode = "toPointAndStopWithDiscontinuityCurvature";
      }
    }

    // Gimbal mode 2 = interpolate to the listed pitch
    const gimbalPitch = num(columns.gimbalPitch);
    if (num(columns.gimbalMode) === 2 && gimbalPitch !== undefined) {
      extra.gimbalPitchAngle = Math.max(-90, Math.min(30, gimbalPitch));
    }

    const actions: WaypointAction[] = [];
    for (const { type, param } of actionCols) {
      const actionType = num(type);
      const value = num(param) ?? 0;
      const actionId = actions.length;
      switch (actionType) {
        case 0: // stay for (ms)
          actions.push({
            actionId,
            actionType: "hover",
            params: { hoverTime: Math.max(1, Math.round(value / 1000)) },
          });
          break;
        case 1:
          actions.push({
            actionId,
            actionType: "takePhoto",
            params: { payloadPositionIndex: 0 },
          });
          break;
        case 2:
          actions.push({
            actionId,
            actionType: "startRecord",
            params: { payloadPositionIndex: 0 },
          });
          break;
        case 3:
          actions.push({
            actionId,
            actionType: "stopRecord",
            params: { payloadPositionIndex: 0 },
          });
          break;
        case 4: // rotate aircraft to heading
          actions.push({
            actionId,
            actionType: "rotateYaw",
            params: {
              aircraftHeading: normalizeHeading(value),
              aircraftPathMode: "clockwise",
            },
          });
          break;
        case 5: // tilt camera
          actions.push({
            actionId,
            actionType: "gimbalRotate",
            params: {
              gimbalPitchRotateAngle: Math.max(-90, Math.min(30, value)),
              gimbalYawRotateAngle: 0,
              gimbalRollRotateAngle: 0,
              gimbalRotateMode: "absoluteAngle",
              payloadPositionIndex: 0,
            },
          });
          break;
        default:
          break; // -1 = no action
      }
    }
    extra.actions = actions;

    const photoDist = num(columns.photoDist);
    const photoTime = num(columns.photoTime);
    if (photoDist !== undefined && photoDist > 0) {
      extra.photoIntervalM = photoDist;
    } else if (photoTime !== undefined && photoTime > 0) {
      extra.photoIntervalM =
        Math.round(photoTime * (extra.speed ?? DEFAULT_WAYPOINT.speed) * 10) /
        10;
      timedIntervals = true;
    }

    waypoints.push(
      makeWaypoint(waypoints.length, { latitude: lat, longitude: lng }, extra),
    );
  }

  if (waypoints.length === 0) {
    throw new ImportError("The CSV file has no valid waypoints");
  }
  if (waypoints.length > MAX_IMPORT_WAYPOINTS) {
    throw new ImportError(
      `The CSV has ${waypoints.length} waypoints; the limit is ${MAX_IMPORT_WAYPOINTS}`,
    );
  }
  // An interval on the last waypoint has no leg to apply to
  delete waypoints[waypoints.length - 1].photoIntervalM;

  if (skippedRows > 0) {
    warnings.push(
      `${skippedRows} rows without valid coordinates were skipped.`,
    );
  }
  if (timedIntervals) {
    warnings.push(
      "Timed interval shooting was converted to distance intervals using each leg's speed.",
    );
  }
  warnings.push(
    "Litchi altitudes are relative to the take-off point; check the height mode in mission settings.",
  );

  return {
    format: "litchi",
    waypoints,
    pois: Array.from(poiByKey.values()),
    warnings,
  };
}

// ── Dispatch ─────────────────────────────────────────────

function extensionOf(filename: string): string {
  const match = /\.[a-z0-9]+$/i.exec(filename);
  return match ? match[0].toLowerCase() : "";
}

function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function decodeText(buffer: Buffer): string {
  // Binary data means the extension lied about the contents
  if (buffer.subarray(0, 4096).includes(0)) {
    throw new ImportError("The file is not a text document");
  }
  return buffer.toString("utf8");
}

/**
 * Parse an uploaded mission file. The filename is only used to pick a parser
 * (it never touches the filesystem); the contents must match the extension.
 */
export async function importMissionFile(
  buffer: Buffer,
  filename: string,
): Promise<ImportedMission> {
  const ext = extensionOf(filename);

  switch (ext) {
    case ".kmz": {
      if (!isZip(buffer)) throw new ImportError("The file is not a valid KMZ");
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(buffer);
      } catch {
        throw new ImportError("The file is not a valid KMZ");
      }
      if (isWpmlArchive(zip)) {
        const parsed = await parseWpmlArchive(zip);
        return { format: "wpml", ...parsed };
      }
      // Plain Google Earth KMZ: a zipped KML, usually doc.kml
      const kmlFile =
        zip.file("doc.kml") ?? zip.file(/\.kml$/i).find((f) => !f.dir);
      if (!kmlFile) throw new ImportError("The KMZ contains no KML document");
      const data = await kmlFile.async("nodebuffer");
      if (data.length > MAX_INNER_DOC_BYTES) {
        throw new ImportError("The KML inside the KMZ is too large");
      }
      return parseKml(decodeText(data));
    }
    case ".kml":
      return parseKml(decodeText(buffer));
    case ".gpx":
      return parseGpx(decodeText(buffer));
    case ".csv":
      return parseLitchiCsv(decodeText(buffer));
    default:
      throw new ImportError(
        `Unsupported file type. Use ${IMPORT_EXTENSIONS.join(", ")}`,
      );
  }
}
