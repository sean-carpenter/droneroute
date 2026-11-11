import type {
  Waypoint,
  PointOfInterest,
  WaypointAction,
} from "@droneroute/shared";
import { DEFAULT_WAYPOINT } from "@droneroute/shared";
import type { CameraModel } from "@/lib/camera";
import { MAVIC_3E_CAMERA, footprintM, spacingFromOverlap } from "@/lib/camera";
import { resolveGimbalAim, type GimbalStrategy } from "@/lib/geo";

// ── Helpers ──────────────────────────────────────────────

/** Move a lat/lng point by a distance (meters) and bearing (degrees, 0=N) */
function destinationPoint(
  lat: number,
  lng: number,
  distanceM: number,
  bearingDeg: number,
): [number, number] {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const brng = toRad(bearingDeg);
  const d = distanceM / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return [toDeg(lat2), toDeg(lng2)];
}

/** Bearing from point A to point B in degrees (0=N, 90=E) */
function bearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Haversine distance in meters */
function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Template Types ───────────────────────────────────────

export type TemplateType =
  | "orbit"
  | "grid"
  | "facade"
  | "pencil"
  | "corridor"
  | "tower";

/**
 * Camera aim chosen in a template. It is turned into a concrete
 * `GimbalStrategy` for every waypoint, so the pitch follows the waypoint's
 * altitude and position.
 *
 * `structureHeight` aims at the structure the template is built around (the
 * wall in front of the drone, the orbit center, the tower axis) at a given
 * height above ground: 0 is its base.
 */
export type TemplateAim =
  | { mode: "fixed"; pitch: number }
  | { mode: "towardPOI"; poiId: string }
  | { mode: "structureHeight"; height: number }
  | { mode: "relativeToSurface"; offsetDeg: number };

export type TemplateAimMode = TemplateAim["mode"];

type TemplatePoi = Pick<
  PointOfInterest,
  "id" | "latitude" | "longitude" | "height"
>;

/** The structure point a waypoint looks at, and how its surface is oriented. */
interface AimAnchor {
  latitude: number;
  longitude: number;
  /** 0 for a vertical surface (wall, tower), -90 for the ground. */
  surfacePitchDeg: number;
}

/** Strategy for one waypoint, given the template aim and the waypoint's anchor. */
export function aimToStrategy(
  aim: TemplateAim,
  anchor: Pick<AimAnchor, "latitude" | "longitude">,
): GimbalStrategy {
  if (aim.mode === "structureHeight") {
    return {
      mode: "towardPoint",
      latitude: anchor.latitude,
      longitude: anchor.longitude,
      height: aim.height,
    };
  }
  return aim;
}

/**
 * Gimbal pitch (and, when tracking a POI, heading) for one generated waypoint.
 * Spread the result over the waypoint after its default heading settings.
 */
function aimFields(
  position: { latitude: number; longitude: number; height: number },
  aim: TemplateAim,
  anchor: AimAnchor,
  pois: TemplatePoi[],
  fallbackPitch: number,
): Pick<Waypoint, "gimbalPitchAngle"> &
  Partial<Pick<Waypoint, "headingMode" | "poiId" | "useGlobalHeadingParam">> {
  const { gimbalPitchAngle, poiId } = resolveGimbalAim(
    position,
    aimToStrategy(aim, anchor),
    { pois, surfacePitchDeg: anchor.surfacePitchDeg, fallbackPitch },
  );
  return poiId
    ? {
        gimbalPitchAngle,
        useGlobalHeadingParam: false,
        headingMode: "towardPOI",
        poiId,
      }
    : { gimbalPitchAngle };
}

/**
 * How photos are captured along a survey line:
 * - `interval`: one waypoint per line end, photos triggered every N meters in flight
 * - `waypoints`: one stop-and-shoot waypoint per photo
 * - `ends`: a photo at each line end only
 */
export type SurveyPhotoMode = "interval" | "waypoints" | "ends";

export interface OrbitParams {
  center: [number, number]; // [lat, lng]
  radiusM: number;
  altitude: number;
  numPoints: number;
  clockwise: boolean;
  createPoi: boolean;
  aim: TemplateAim;
}

export interface TowerParams {
  center: [number, number]; // [lat, lng] — axis of the structure
  radiusM: number; // standoff from the axis
  minAltitude: number;
  maxAltitude: number;
  /** Number of loops around the structure. */
  turns: number;
  pointsPerTurn: number;
  /** `helix` climbs continuously; `stacked` flies level rings. */
  style: "helix" | "stacked";
  clockwise: boolean;
  createPoi: boolean;
  aim: TemplateAim;
}

export interface GridParams {
  corner1: [number, number]; // [lat, lng]
  corner2: [number, number]; // [lat, lng]
  altitude: number;
  spacingM: number;
  addPhotos: boolean;
  rotationDeg: number; // rotation of the grid in degrees (0-360)
  reverse: boolean; // fly the grid in reverse order
  /** `photogrammetry` derives line spacing and photo interval from overlaps. */
  mode: "fixedSpacing" | "photogrammetry";
  sideOverlap: number; // 0–1, photogrammetry mode only
  forwardOverlap: number; // 0–1, photogrammetry mode only
  photoMode: SurveyPhotoMode; // photogrammetry mode only
  camera?: CameraModel; // defaults to the Mavic 3E wide camera
  /** Fly a second set of lines at 90° to the first. */
  crossHatch: boolean;
}

export interface CorridorParams {
  path: [number, number][]; // raw drawn centerline [lat, lng]
  widthM: number; // total corridor width to cover
  altitude: number;
  sideOverlap: number; // 0–1
  forwardOverlap: number; // 0–1
  addPhotos: boolean;
  photoMode: SurveyPhotoMode;
  reverse: boolean;
  camera?: CameraModel; // defaults to the Mavic 3E wide camera
  aim: TemplateAim;
}

export interface FacadeParams {
  point1: [number, number]; // [lat, lng] — one end of wall
  point2: [number, number]; // [lat, lng] — other end of wall
  distanceM: number; // distance from wall
  minAltitude: number;
  maxAltitude: number;
  numRows: number;
  numColumns: number;
  addPhotos: boolean;
  aim: TemplateAim;
}

export interface PencilParams {
  path: [number, number][]; // raw drawn points [lat, lng]
  numPoints: number; // target waypoint count
  altitude: number;
  speed: number;
  reverse: boolean;
  /** `towardPOI` also turns the aircraft to face the POI during the flight. */
  aim: TemplateAim;
}

export type TemplateParams =
  | OrbitParams
  | GridParams
  | FacadeParams
  | PencilParams
  | CorridorParams
  | TowerParams;

export interface TemplateResult {
  waypoints: Omit<Waypoint, "index" | "name">[];
  pois: Omit<PointOfInterest, "id">[];
}

// ── Default Params ───────────────────────────────────────

export const DEFAULT_ORBIT_PARAMS: Omit<OrbitParams, "center" | "radiusM"> = {
  altitude: 30,
  numPoints: 12,
  clockwise: true,
  createPoi: true,
  aim: { mode: "structureHeight", height: 0 },
};

export const DEFAULT_TOWER_PARAMS: Omit<TowerParams, "center" | "radiusM"> = {
  minAltitude: 10,
  maxAltitude: 50,
  turns: 4,
  pointsPerTurn: 8,
  style: "helix",
  clockwise: true,
  createPoi: true,
  // Halfway up the default altitude range
  aim: { mode: "structureHeight", height: 30 },
};

export const DEFAULT_GRID_PARAMS: Omit<GridParams, "corner1" | "corner2"> = {
  altitude: 80,
  spacingM: 30,
  addPhotos: true,
  rotationDeg: 0,
  reverse: false,
  mode: "photogrammetry",
  sideOverlap: 0.75,
  forwardOverlap: 0.75,
  photoMode: "interval",
  crossHatch: false,
};

export const DEFAULT_CORRIDOR_PARAMS: Omit<CorridorParams, "path"> = {
  widthM: 60,
  altitude: 80,
  sideOverlap: 0.75,
  forwardOverlap: 0.75,
  addPhotos: true,
  photoMode: "interval",
  reverse: false,
  aim: { mode: "fixed", pitch: -90 },
};

export const DEFAULT_FACADE_PARAMS: Omit<FacadeParams, "point1" | "point2"> = {
  distanceM: 20,
  minAltitude: 10,
  maxAltitude: 30,
  numRows: 4,
  numColumns: 8,
  addPhotos: true,
  // Wall base, as before
  aim: { mode: "structureHeight", height: 0 },
};

export const DEFAULT_PENCIL_PARAMS: Omit<PencilParams, "path"> = {
  numPoints: 10,
  altitude: 30,
  speed: 7,
  reverse: false,
  aim: { mode: "fixed", pitch: -45 },
};

// ── Generators ───────────────────────────────────────────

/** Heading in the -180..180 range DJI expects. */
function normalizeHeading(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return Math.round(wrapped > 180 ? wrapped - 360 : wrapped);
}

/** POI at the center of an orbit/tower, at the height the camera aims for. */
function centerPoi(
  name: string,
  center: [number, number],
  aim: TemplateAim,
): Omit<PointOfInterest, "id"> {
  return {
    name,
    latitude: center[0],
    longitude: center[1],
    height: aim.mode === "structureHeight" ? aim.height : 0,
  };
}

export function generateOrbit(
  params: OrbitParams,
  availablePois: TemplatePoi[] = [],
): TemplateResult {
  const { center, radiusM, altitude, numPoints, clockwise, createPoi, aim } =
    params;
  const [cLat, cLng] = center;

  const waypoints: TemplateResult["waypoints"] = [];
  const pois: TemplateResult["pois"] = [];

  // Optionally create a POI at the center
  if (createPoi) {
    pois.push(centerPoi("Orbit center", center, aim));
  }

  const anchor: AimAnchor = {
    latitude: cLat,
    longitude: cLng,
    surfacePitchDeg: 0,
  };

  for (let i = 0; i < numPoints; i++) {
    const fraction = i / numPoints;
    // Start from North (0°), go clockwise or counter-clockwise
    const angleDeg = clockwise ? fraction * 360 : 360 - fraction * 360;
    const [lat, lng] = destinationPoint(cLat, cLng, radiusM, angleDeg);

    waypoints.push({
      ...DEFAULT_WAYPOINT,
      latitude: lat,
      longitude: lng,
      height: altitude,
      speed: 5,
      useGlobalSpeed: false,
      useGlobalHeadingParam: false,
      headingMode: "fixed",
      // Face the center
      headingAngle: normalizeHeading(bearing(lat, lng, cLat, cLng)),
      turnMode: "toPointAndPassWithContinuityCurvature",
      useGlobalTurnParam: false,
      actions: [],
      ...aimFields(
        { latitude: lat, longitude: lng, height: altitude },
        aim,
        anchor,
        availablePois,
        -45,
      ),
    });
  }

  return { waypoints, pois };
}

// ── Tower / helix ────────────────────────────────────────

/** Hard cap on tower waypoints. */
const MAX_TOWER_WAYPOINTS = 500;

/**
 * Inspect a tall structure by circling it while climbing: either one
 * continuous spiral or a stack of level rings.
 */
export function generateTower(
  params: TowerParams,
  availablePois: TemplatePoi[] = [],
): TemplateResult {
  const { center, radiusM, style, clockwise, createPoi, aim } = params;
  const [cLat, cLng] = center;
  const turns = Math.max(1, Math.round(params.turns));
  const pointsPerTurn = Math.max(3, Math.round(params.pointsPerTurn));
  const minAltitude = Math.min(params.minAltitude, params.maxAltitude);
  const maxAltitude = Math.max(params.minAltitude, params.maxAltitude);

  const anchor: AimAnchor = {
    latitude: cLat,
    longitude: cLng,
    surfacePitchDeg: 0,
  };

  // (angle, altitude) of every waypoint, bottom to top
  const steps: { angleDeg: number; altitude: number }[] = [];
  if (style === "helix") {
    const total = turns * pointsPerTurn;
    for (let i = 0; i <= total; i++) {
      steps.push({
        angleDeg: (i / pointsPerTurn) * 360,
        altitude: minAltitude + (i / total) * (maxAltitude - minAltitude),
      });
    }
  } else {
    for (let ring = 0; ring < turns; ring++) {
      const altitude =
        turns === 1
          ? minAltitude
          : minAltitude + (ring / (turns - 1)) * (maxAltitude - minAltitude);
      // Close each ring by returning to its first point before climbing
      for (let i = 0; i <= pointsPerTurn; i++) {
        steps.push({ angleDeg: (i / pointsPerTurn) * 360, altitude });
      }
    }
  }

  const waypoints: TemplateResult["waypoints"] = steps
    .slice(0, MAX_TOWER_WAYPOINTS)
    .map(({ angleDeg, altitude }) => {
      const [lat, lng] = destinationPoint(
        cLat,
        cLng,
        radiusM,
        clockwise ? angleDeg : -angleDeg,
      );
      const height = Math.round(altitude * 10) / 10;
      return {
        ...DEFAULT_WAYPOINT,
        latitude: lat,
        longitude: lng,
        height,
        speed: 3,
        useGlobalSpeed: false,
        useGlobalHeadingParam: false,
        headingMode: "fixed" as const,
        headingAngle: normalizeHeading(bearing(lat, lng, cLat, cLng)),
        turnMode: "toPointAndPassWithContinuityCurvature" as const,
        useGlobalTurnParam: false,
        actions: [],
        ...aimFields(
          { latitude: lat, longitude: lng, height },
          aim,
          anchor,
          availablePois,
          -30,
        ),
      };
    });

  return {
    waypoints,
    pois: createPoi ? [centerPoi("Tower center", center, aim)] : [],
  };
}

// ── Survey lines (shared by grid and corridor) ──────────

const TAKE_PHOTO: WaypointAction = {
  actionId: 0,
  actionType: "takePhoto",
  params: { payloadPositionIndex: 0 },
};

/** Hard cap on generated survey waypoints, to keep the editor responsive. */
export const MAX_SURVEY_WAYPOINTS = 2000;

interface SurveyLineOptions {
  altitude: number;
  addPhotos: boolean;
  photoMode: SurveyPhotoMode;
  photoIntervalM: number;
  aim?: TemplateAim; // defaults to straight down
  pois?: TemplatePoi[];
}

/** Split a polyline so that no segment is longer than `maxStepM`. */
function densifyPath(
  path: [number, number][],
  maxStepM: number,
): [number, number][] {
  if (path.length < 2 || !(maxStepM > 0)) return path;
  const out: [number, number][] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const [aLat, aLng] = path[i - 1];
    const [bLat, bLng] = path[i];
    const len = haversine(aLat, aLng, bLat, bLng);
    const steps = Math.max(1, Math.ceil(len / maxStepM - 1e-9));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      out.push([aLat + t * (bLat - aLat), aLng + t * (bLng - aLng)]);
    }
  }
  return out;
}

/** Turn a list of survey passes (polylines) into nadir waypoints. */
function buildSurveyWaypoints(
  passes: [number, number][][],
  opts: SurveyLineOptions,
): TemplateResult["waypoints"] {
  const { altitude, addPhotos, photoMode, photoIntervalM } = opts;
  const aim: TemplateAim = opts.aim ?? { mode: "fixed", pitch: -90 };
  const waypoints: TemplateResult["waypoints"] = [];

  for (const pass of passes) {
    const perPhoto = addPhotos && photoMode === "waypoints";
    const points = perPhoto ? densifyPath(pass, photoIntervalM) : pass;

    points.forEach(([lat, lng], i) => {
      const isEnd = i === 0 || i === points.length - 1;
      const useInterval =
        addPhotos && photoMode === "interval" && i < points.length - 1;
      const stop = isEnd || perPhoto;
      waypoints.push({
        ...DEFAULT_WAYPOINT,
        latitude: lat,
        longitude: lng,
        height: altitude,
        useGlobalHeadingParam: false,
        headingMode: "followWayline",
        // The ground under the aircraft is the surface being surveyed
        ...aimFields(
          { latitude: lat, longitude: lng, height: altitude },
          aim,
          { latitude: lat, longitude: lng, surfacePitchDeg: -90 },
          opts.pois ?? [],
          -90,
        ),
        turnMode: stop
          ? "toPointAndStopWithContinuityCurvature"
          : "toPointAndPassWithContinuityCurvature",
        useGlobalTurnParam: false,
        ...(useInterval ? { photoIntervalM: round1(photoIntervalM) } : {}),
        actions:
          addPhotos && (perPhoto || (photoMode === "ends" && isEnd))
            ? [{ ...TAKE_PHOTO }]
            : [],
      });
    });
  }

  return waypoints.slice(0, MAX_SURVEY_WAYPOINTS);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Line spacing and photo interval actually used by a grid, in meters. */
export function gridSpacing(
  params: Pick<
    GridParams,
    | "mode"
    | "altitude"
    | "spacingM"
    | "sideOverlap"
    | "forwardOverlap"
    | "camera"
  >,
): { lineSpacingM: number; photoIntervalM: number } {
  const camera = params.camera ?? MAVIC_3E_CAMERA;
  const fromOverlap = spacingFromOverlap(
    params.altitude,
    params.sideOverlap,
    params.forwardOverlap,
    camera,
  );
  if (params.mode === "photogrammetry") return fromOverlap;
  return {
    lineSpacingM: params.spacingM,
    photoIntervalM: fromOverlap.photoIntervalM,
  };
}

export function generateGrid(params: GridParams): TemplateResult {
  const { corner1, corner2, altitude, addPhotos, rotationDeg, reverse } =
    params;
  const [lat1, lng1] = corner1;
  const [lat2, lng2] = corner2;

  const { lineSpacingM, photoIntervalM } = gridSpacing(params);
  // Fixed-spacing grids keep the original behavior: a photo at each line end.
  const photoMode: SurveyPhotoMode =
    params.mode === "photogrammetry" ? params.photoMode : "ends";

  // Determine bounding box
  const minLat = Math.min(lat1, lat2);
  const maxLat = Math.max(lat1, lat2);
  const minLng = Math.min(lng1, lng2);
  const maxLng = Math.max(lng1, lng2);

  // Center of the bounding box (rotation pivot)
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  // Calculate the width and height of the area in meters
  const widthM = haversine(minLat, minLng, minLat, maxLng);
  const heightM = haversine(minLat, minLng, maxLat, minLng);

  // Fly along the longer axis; a cross-hatch adds the other axis afterwards
  const primaryEW = widthM >= heightM;

  // Rotation helper: rotate a lat/lng point around the center by rotationDeg degrees.
  // Uses equirectangular approximation (accurate enough for small areas).
  const rotRad = (rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  const cosCenter = Math.cos((centerLat * Math.PI) / 180);

  function rotatePoint(lat: number, lng: number): [number, number] {
    if (rotationDeg === 0) return [lat, lng];
    // Convert to local offsets in degrees, scaling lng by cos(lat) for equal units
    const dLat = lat - centerLat;
    const dLng = (lng - centerLng) * cosCenter;
    // Rotate
    const rLat = dLat * cosR - dLng * sinR;
    const rLng = dLat * sinR + dLng * cosR;
    // Convert back
    return [centerLat + rLat, centerLng + rLng / cosCenter];
  }

  const linesAlong = (flyEW: boolean): [number, number][][] => {
    // Number of passes: lines sit on both edges and are spread evenly, so the
    // real spacing is never wider than requested (overlap is never lower).
    const crossAxisDist = flyEW ? heightM : widthM;
    const numPasses = Math.min(
      500,
      Math.max(2, Math.ceil(crossAxisDist / Math.max(lineSpacingM, 1)) + 1),
    );
    const passes: [number, number][][] = [];

    for (let pass = 0; pass < numPasses; pass++) {
      const fraction = numPasses <= 1 ? 0 : pass / (numPasses - 1);
      const flip = pass % 2 === 1; // lawn-mower pattern: alternate direction

      let start: [number, number];
      let end: [number, number];

      if (flyEW) {
        // Cross axis is N-S: each pass is a horizontal E-W line
        const lat = minLat + fraction * (maxLat - minLat);
        start = [lat, flip ? maxLng : minLng];
        end = [lat, flip ? minLng : maxLng];
      } else {
        // Cross axis is E-W: each pass is a vertical N-S line
        const lng = minLng + fraction * (maxLng - minLng);
        start = [flip ? maxLat : minLat, lng];
        end = [flip ? minLat : maxLat, lng];
      }

      passes.push([rotatePoint(...start), rotatePoint(...end)]);
    }
    return passes;
  };

  let passes = linesAlong(primaryEW);
  if (params.crossHatch) {
    passes = [...passes, ...linesAlong(!primaryEW)];
  }

  if (reverse) {
    passes = passes.reverse().map((p) => [...p].reverse());
  }

  return {
    waypoints: buildSurveyWaypoints(passes, {
      altitude,
      addPhotos,
      photoMode,
      photoIntervalM,
    }),
    pois: [],
  };
}

// ── Corridor (linear survey along a centerline) ─────────

const EARTH_R = 6371000;
const DEG = Math.PI / 180;

/** Project [lat, lng] points to local east/north meters around an origin. */
function toLocal(
  points: [number, number][],
  origin: [number, number],
): [number, number][] {
  const cos0 = Math.cos(origin[0] * DEG);
  return points.map(([lat, lng]) => [
    (lng - origin[1]) * DEG * EARTH_R * cos0,
    (lat - origin[0]) * DEG * EARTH_R,
  ]);
}

function fromLocal(
  points: [number, number][],
  origin: [number, number],
): [number, number][] {
  const cos0 = Math.cos(origin[0] * DEG);
  return points.map(([x, y]) => [
    origin[0] + y / (DEG * EARTH_R),
    origin[1] + x / (DEG * EARTH_R * cos0),
  ]);
}

/** Douglas–Peucker simplification of a polyline in local meters. */
function simplifyLocal(
  points: [number, number][],
  toleranceM: number,
): [number, number][] {
  if (points.length <= 2) return points;
  const keep: boolean[] = points.map(() => false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay);
    let maxD = 0;
    let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d =
        len === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxI !== -1 && maxD > toleranceM) {
      keep[maxI] = true;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Offset a polyline sideways by `offsetM` (positive = left of travel). */
function offsetLocal(
  points: [number, number][],
  offsetM: number,
): [number, number][] {
  if (offsetM === 0) return points;
  const normals: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    const dy = points[i + 1][1] - points[i][1];
    const len = Math.hypot(dx, dy) || 1;
    normals.push([-dy / len, dx / len]);
  }
  return points.map(([x, y], i) => {
    const n1 = normals[Math.max(0, i - 1)];
    const n2 = normals[Math.min(normals.length - 1, i)];
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const mLen = Math.hypot(mx, my);
    if (mLen < 1e-6) return [x + n1[0] * offsetM, y + n1[1] * offsetM];
    mx /= mLen;
    my /= mLen;
    // Miter length grows at sharp corners; cap it so offsets stay sane.
    const cosHalf = Math.max(0.35, mx * n1[0] + my * n1[1]);
    const scale = offsetM / cosHalf;
    return [x + mx * scale, y + my * scale];
  });
}

/** Simplified centerline and the parallel lines needed to cover a corridor. */
export function corridorLayout(params: CorridorParams): {
  centerline: [number, number][];
  lineOffsetsM: number[];
  lineSpacingM: number;
  photoIntervalM: number;
} {
  const camera = params.camera ?? MAVIC_3E_CAMERA;
  const { lineSpacingM, photoIntervalM } = spacingFromOverlap(
    params.altitude,
    params.sideOverlap,
    params.forwardOverlap,
    camera,
  );
  const { widthM: swathM } = footprintM(params.altitude, camera);

  // n lines spaced s apart cover (n - 1) * s + swath
  const numLines = Math.min(
    50,
    Math.max(
      1,
      Math.ceil((params.widthM - swathM) / Math.max(lineSpacingM, 1) - 1e-9) +
        1,
    ),
  );
  const lineOffsetsM = Array.from(
    { length: numLines },
    (_, i) => (i - (numLines - 1) / 2) * lineSpacingM,
  );

  let centerline: [number, number][] = [];
  if (params.path.length >= 2) {
    const origin = params.path[0];
    const tolerance = Math.max(2, Math.min(10, params.widthM / 15));
    centerline = fromLocal(
      simplifyLocal(toLocal(params.path, origin), tolerance),
      origin,
    );
  }

  return { centerline, lineOffsetsM, lineSpacingM, photoIntervalM };
}

export function generateCorridor(
  params: CorridorParams,
  availablePois: TemplatePoi[] = [],
): TemplateResult {
  const { centerline, lineOffsetsM, photoIntervalM } = corridorLayout(params);
  if (centerline.length < 2) return { waypoints: [], pois: [] };

  const origin = centerline[0];
  const local = toLocal(centerline, origin);

  let passes = lineOffsetsM.map((offset, i) => {
    const line = fromLocal(offsetLocal(local, offset), origin);
    return i % 2 === 1 ? line.reverse() : line; // lawn-mower order
  });

  if (params.reverse) {
    passes = passes.reverse().map((p) => [...p].reverse());
  }

  return {
    waypoints: buildSurveyWaypoints(passes, {
      altitude: params.altitude,
      addPhotos: params.addPhotos,
      photoMode: params.photoMode,
      photoIntervalM,
      aim: params.aim,
      pois: availablePois,
    }),
    pois: [],
  };
}

export function generateFacade(
  params: FacadeParams,
  availablePois: TemplatePoi[] = [],
): TemplateResult {
  const {
    point1,
    point2,
    distanceM,
    minAltitude,
    maxAltitude,
    numRows,
    numColumns,
    addPhotos,
    aim,
  } = params;
  const [lat1, lng1] = point1;
  const [lat2, lng2] = point2;

  const waypoints: TemplateResult["waypoints"] = [];

  // Wall bearing and perpendicular offset direction
  const wallBearing = bearing(lat1, lng1, lat2, lng2);
  // Perpendicular: offset 90° to the right of the wall direction
  const offsetBearing = (wallBearing + 90) % 360;

  // Generate the scan grid along the wall
  for (let row = 0; row < numRows; row++) {
    const altFraction = numRows <= 1 ? 0 : row / (numRows - 1);
    const alt = Math.round(
      minAltitude + altFraction * (maxAltitude - minAltitude),
    );
    const reverse = row % 2 === 1; // zigzag

    for (let col = 0; col < numColumns; col++) {
      const colIdx = reverse ? numColumns - 1 - col : col;
      const colFraction = numColumns <= 1 ? 0 : colIdx / (numColumns - 1);

      // Point along the wall
      const wallLat = lat1 + colFraction * (lat2 - lat1);
      const wallLng = lng1 + colFraction * (lng2 - lng1);

      // Offset perpendicular to wall
      const [wpLat, wpLng] = destinationPoint(
        wallLat,
        wallLng,
        distanceM,
        offsetBearing,
      );

      // Heading: face the wall (opposite of offset direction)
      const headingToWall = (offsetBearing + 180) % 360;
      const normalizedHeading =
        headingToWall > 180 ? headingToWall - 360 : headingToWall;

      waypoints.push({
        ...DEFAULT_WAYPOINT,
        latitude: wpLat,
        longitude: wpLng,
        height: alt,
        speed: 3,
        useGlobalSpeed: false,
        useGlobalHeadingParam: false,
        headingMode: "fixed",
        headingAngle: Math.round(normalizedHeading),
        turnMode: "toPointAndStopWithContinuityCurvature",
        useGlobalTurnParam: false,
        actions: addPhotos
          ? [
              {
                actionId: 0,
                actionType: "takePhoto",
                params: { payloadPositionIndex: 0 },
              },
            ]
          : [],
        // The wall point straight in front of this column is the anchor, so
        // the pitch changes with altitude: aiming at the base looks further
        // down as the drone climbs, aiming at a height band levels off.
        ...aimFields(
          { latitude: wpLat, longitude: wpLng, height: alt },
          aim,
          { latitude: wallLat, longitude: wallLng, surfacePitchDeg: 0 },
          availablePois,
          0,
        ),
      });
    }
  }

  return { waypoints, pois: [] };
}

// ── Pencil (freehand path) ──────────────────────────────

/**
 * Resample a polyline of raw points into exactly `n` equidistant points.
 * Uses cumulative arc-length along the raw path and linear interpolation.
 */
function resamplePath(raw: [number, number][], n: number): [number, number][] {
  if (raw.length === 0) return [];
  if (raw.length === 1 || n <= 1) return [raw[0]];

  // 1. Compute cumulative arc-length distances
  const cumDist: number[] = [0];
  for (let i = 1; i < raw.length; i++) {
    cumDist.push(
      cumDist[i - 1] +
        haversine(raw[i - 1][0], raw[i - 1][1], raw[i][0], raw[i][1]),
    );
  }
  const totalLength = cumDist[cumDist.length - 1];

  if (totalLength === 0) return [raw[0]];

  // 2. Place n points at equal arc-length intervals
  const result: [number, number][] = [];
  let segIdx = 0; // current segment index in the raw path

  for (let k = 0; k < n; k++) {
    const targetDist = (k / (n - 1)) * totalLength;

    // Advance segIdx to find the segment containing targetDist
    while (segIdx < raw.length - 2 && cumDist[segIdx + 1] < targetDist) {
      segIdx++;
    }

    const segLen = cumDist[segIdx + 1] - cumDist[segIdx];
    const t = segLen > 0 ? (targetDist - cumDist[segIdx]) / segLen : 0;

    const lat = raw[segIdx][0] + t * (raw[segIdx + 1][0] - raw[segIdx][0]);
    const lng = raw[segIdx][1] + t * (raw[segIdx + 1][1] - raw[segIdx][1]);
    result.push([lat, lng]);
  }

  return result;
}

/** Total arc-length of a polyline in meters */
export function pathLength(path: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  }
  return total;
}

export function generatePencil(
  params: PencilParams,
  availablePois: TemplatePoi[] = [],
): TemplateResult {
  const { path, numPoints, altitude, speed, reverse, aim } = params;

  if (path.length < 2 || numPoints < 2) return { waypoints: [], pois: [] };

  const resampled = resamplePath(path, numPoints);

  const waypoints: TemplateResult["waypoints"] = resampled.map(
    ([lat, lng]) => ({
      ...DEFAULT_WAYPOINT,
      latitude: lat,
      longitude: lng,
      height: altitude,
      speed,
      useGlobalSpeed: false,
      useGlobalHeadingParam: false,
      headingMode: "followWayline" as const,
      turnMode: "toPointAndPassWithContinuityCurvature" as const,
      useGlobalTurnParam: false,
      actions: [],
      // Toward a POI, both heading and pitch follow it from every waypoint.
      // The ground below is the reference surface for the other modes.
      ...aimFields(
        { latitude: lat, longitude: lng, height: altitude },
        aim,
        { latitude: lat, longitude: lng, surfacePitchDeg: -90 },
        availablePois,
        -45,
      ),
    }),
  );

  if (reverse) {
    waypoints.reverse();
  }

  return { waypoints, pois: [] };
}
