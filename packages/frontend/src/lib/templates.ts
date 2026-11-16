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
export function destinationPoint(
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
export function bearing(
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
  /**
   * Site outline [lat, lng][]. When given, flight lines are clipped to it
   * instead of filling the rectangle between the two corners.
   */
  boundary?: [number, number][];
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
  /**
   * How rows and columns are chosen. When present, photos are also placed
   * with their edges on the wall's ends and on the min and max heights, so
   * none of a photo looks past the wall. Missing (older seeds): photos are
   * centered on the ends and the altitudes, and counts are manual.
   */
  coverage?: FacadeCoverage;
  /** Camera whose footprint places the edge photos. Mavic 3E wide if unset. */
  camera?: CameraModel;
}

/**
 * Automatic rows and columns for a wall. While `auto` is on, the counts are
 * worked out again whenever the distance, the wall or the altitudes change:
 * the fewest photos that still keep the overlap between neighbors.
 */
export interface FacadeCoverage {
  auto: boolean;
  /** Share of a photo's width repeated in the next column, 0 to 0.9. */
  horizontalOverlap: number;
  /** Share of a photo's height repeated in the next row, 0 to 0.9. */
  verticalOverlap: number;
}

export const DEFAULT_FACADE_COVERAGE: FacadeCoverage = {
  auto: true,
  horizontalOverlap: 0.75,
  verticalOverlap: 0.75,
};

export const FACADE_COVERAGE_PRESETS = [
  {
    label: "Coverage",
    overlap: 0.2,
    hint: "Every spot in one photo, with a margin for drift",
  },
  {
    label: "Inspection",
    overlap: 0.4,
    hint: "Every spot in about two photos",
  },
  {
    label: "3D model",
    overlap: 0.75,
    hint: "Overlap photogrammetry (WebODM) needs",
  },
] as const;

/** Closest photo spacing the automatic counts will use, in meters. */
export const MIN_FACADE_PHOTO_SPACING_M = 0.1;

export interface WallCoverage {
  numRows: number;
  numColumns: number;
  /** Wall area one photo covers at the standoff, level camera. */
  footprint: { widthM: number; heightM: number };
  /**
   * Distance along the wall, and up it, between the first and last photo
   * centers: the wall minus one photo, since edge photos sit with their
   * edges on the wall's ends and on the min and max heights.
   */
  centersSpanM: { horizontal: number; vertical: number };
  /** Gap between neighboring photos the counts give, in meters. */
  spacing: { horizontalM: number; verticalM: number };
  /** Overlap the counts give: at least the target. */
  overlap: { horizontal: number; vertical: number };
}

/** Wall area one photo covers from `distanceM` away, level camera. */
export function wallFootprint(
  distanceM: number,
  camera: CameraModel = MAVIC_3E_CAMERA,
): { widthM: number; heightM: number } {
  const d = Math.max(0.5, distanceM);
  return {
    widthM: (d * camera.sensorWidthMm) / camera.focalLengthMm,
    heightM: (d * camera.sensorHeightMm) / camera.focalLengthMm,
  };
}

/**
 * Fewest rows and columns that cover the wall, from the min to the max
 * height, with at least the requested overlap. Edge photos sit with their
 * edges on the wall's ends and on the min and max heights; a wall smaller
 * than one photo gets a single photo in its middle.
 */
export function wallCoverage(
  params: Pick<
    FacadeParams,
    "point1" | "point2" | "distanceM" | "minAltitude" | "maxAltitude"
  >,
  coverage: Pick<FacadeCoverage, "horizontalOverlap" | "verticalOverlap">,
  camera: CameraModel = MAVIC_3E_CAMERA,
): WallCoverage {
  const clamp = (v: number) => Math.min(0.9, Math.max(0, v));
  const lengthM = haversine(
    params.point1[0],
    params.point1[1],
    params.point2[0],
    params.point2[1],
  );
  const heightM = Math.abs(params.maxAltitude - params.minAltitude);
  const footprint = wallFootprint(params.distanceM, camera);
  const centersSpanM = {
    horizontal: Math.max(0, lengthM - footprint.widthM),
    vertical: Math.max(0, heightM - footprint.heightM),
  };
  const step = {
    horizontal: Math.max(
      MIN_FACADE_PHOTO_SPACING_M,
      footprint.widthM * (1 - clamp(coverage.horizontalOverlap)),
    ),
    vertical: Math.max(
      MIN_FACADE_PHOTO_SPACING_M,
      footprint.heightM * (1 - clamp(coverage.verticalOverlap)),
    ),
  };
  // A tiny tolerance keeps an exact fit from adding a needless photo
  const count = (span: number, stepM: number) =>
    span < 0.01 ? 1 : Math.ceil(span / stepM - 1e-9) + 1;
  const numColumns = count(centersSpanM.horizontal, step.horizontal);
  const numRows = count(centersSpanM.vertical, step.vertical);
  const horizontalM =
    numColumns > 1 ? centersSpanM.horizontal / (numColumns - 1) : 0;
  const verticalM = numRows > 1 ? centersSpanM.vertical / (numRows - 1) : 0;
  return {
    numRows,
    numColumns,
    footprint,
    centersSpanM,
    spacing: { horizontalM, verticalM },
    overlap: {
      horizontal: numColumns > 1 ? 1 - horizontalM / footprint.widthM : 1,
      vertical: numRows > 1 ? 1 - verticalM / footprint.heightM : 1,
    },
  };
}

/** The wall's params with rows and columns brought up to date when automatic. */
export function withWallCoverage(
  params: FacadeParams,
  camera: CameraModel = MAVIC_3E_CAMERA,
): FacadeParams {
  if (!params.coverage?.auto) return params;
  const { numRows, numColumns } = wallCoverage(
    params,
    params.coverage,
    params.camera ?? camera,
  );
  return numRows === params.numRows && numColumns === params.numColumns
    ? params
    : { ...params, numRows, numColumns };
}

/** Which outline the facade tool is drawing. Wall is the original two-point scan. */
export type FacadeBoundaryKind = "wall" | "circle" | "spiral" | "polygon";

/**
 * Photo spacing on a vertical face. Overlap is measured on the camera
 * footprint at the target distance: horizontal is left-right (sensor width),
 * vertical is up-down (sensor height).
 */
export interface FacadeSpacing {
  mode: "overlap" | "distance";
  /** 0 to 1. Used when mode is overlap. */
  horizontalOverlap: number;
  /** 0 to 1. Used when mode is overlap. */
  verticalOverlap: number;
  /** Meters between photos. Used when mode is distance. */
  horizontalM: number;
  verticalM: number;
}

export interface RadialFacadeParams {
  boundary: "circle" | "spiral";
  center: [number, number];
  /** Point that sets the direction of the radius handles. */
  handle: [number, number];
  /** Structure radius at the bottom of the altitude range. */
  radiusBottomM: number;
  /** Structure radius at the top. Used only when tapered, and not for columns. */
  radiusTopM: number;
  tapered: boolean;
  /** How far outside the structure the drone flies. */
  standoffM: number;
  minAltitude: number;
  maxAltitude: number;
  /** Circle only. A spiral always climbs. */
  pattern: "horizontal" | "vertical";
  spacing: FacadeSpacing;
  clockwise: boolean;
  createPoi: boolean;
  aim: TemplateAim;
  camera?: CameraModel;
}

export interface PolygonFacadeParams {
  boundary: "polygon";
  /** Structure footprint, [lat, lng], at least 3 corners. */
  vertices: [number, number][];
  standoffM: number;
  minAltitude: number;
  maxAltitude: number;
  pattern: "horizontal" | "vertical";
  spacing: FacadeSpacing;
  aim: TemplateAim;
  camera?: CameraModel;
}

export type BoundaryFacadeParams = RadialFacadeParams | PolygonFacadeParams;

export interface BoundaryFacadeResult extends TemplateResult {
  /** Photos the spacing asked for, before the waypoint cap. */
  plannedCount: number;
  /** The outward offset of a polygon crosses itself. */
  selfCrossing: boolean;
  horizontalM: number;
  verticalM: number;
  /** Orbits, columns, or spiral turns. */
  passes: number;
  passLabel: "orbits" | "columns" | "turns";
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

/** Look straight at the wall or mast beside the drone. */
export const LEVEL_SURFACE_AIM: TemplateAim = {
  mode: "relativeToSurface",
  offsetDeg: 0,
};

export const DEFAULT_TOWER_PARAMS: Omit<TowerParams, "center" | "radiusM"> = {
  minAltitude: 1,
  maxAltitude: 50,
  turns: 4,
  pointsPerTurn: 8,
  style: "helix",
  clockwise: true,
  createPoi: true,
  aim: LEVEL_SURFACE_AIM,
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
  distanceM: 1,
  // The band of wall to photograph: from the ground to a house's roof line.
  // A wall drawn along a site feature with a height takes that height.
  minAltitude: 0,
  maxAltitude: 8,
  // Placeholders: with automatic coverage on, the counts are worked out from
  // the wall, distance and heights as soon as the wall is drawn.
  numRows: 30,
  numColumns: 2,
  addPhotos: true,
  aim: LEVEL_SURFACE_AIM,
  coverage: DEFAULT_FACADE_COVERAGE,
};

export const DEFAULT_FACADE_SPACING: FacadeSpacing = {
  mode: "distance",
  horizontalOverlap: 0.75,
  verticalOverlap: 0.75,
  horizontalM: 1,
  verticalM: 1,
};

export const DEFAULT_RADIAL_FACADE: Omit<
  RadialFacadeParams,
  "boundary" | "center" | "handle" | "radiusBottomM" | "radiusTopM"
> = {
  tapered: false,
  standoffM: 1,
  minAltitude: 1,
  maxAltitude: 40,
  pattern: "horizontal",
  spacing: DEFAULT_FACADE_SPACING,
  clockwise: true,
  createPoi: true,
  aim: LEVEL_SURFACE_AIM,
};

export const DEFAULT_POLYGON_FACADE: Omit<PolygonFacadeParams, "vertices"> = {
  boundary: "polygon",
  standoffM: 1,
  minAltitude: 1,
  maxAltitude: 40,
  pattern: "horizontal",
  spacing: DEFAULT_FACADE_SPACING,
  aim: LEVEL_SURFACE_AIM,
};

/**
 * Facade settings for going all the way around a structure's footprint.
 * With a known height the band runs from near the ground to just above the
 * top, and the camera looks straight at the wall.
 */
export function polygonFacadeAround(
  vertices: [number, number][],
  heightM?: number | null,
): PolygonFacadeParams {
  const minAltitude = heightM
    ? Math.min(
        DEFAULT_POLYGON_FACADE.minAltitude,
        Math.max(1, Math.round(heightM * 0.25)),
      )
    : DEFAULT_POLYGON_FACADE.minAltitude;
  return {
    ...DEFAULT_POLYGON_FACADE,
    vertices,
    minAltitude,
    maxAltitude: Math.max(
      minAltitude + 5,
      heightM ? heightM + 5 : DEFAULT_POLYGON_FACADE.maxAltitude,
    ),
  };
}

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

/** Bounding-box corners of an outline, for `GridParams.corner1/corner2`. */
export function boundaryCorners(boundary: [number, number][]): {
  corner1: [number, number];
  corner2: [number, number];
} {
  const lats = boundary.map((p) => p[0]);
  const lngs = boundary.map((p) => p[1]);
  return {
    corner1: [Math.min(...lats), Math.min(...lngs)],
    corner2: [Math.max(...lats), Math.max(...lngs)],
  };
}

/**
 * Parallel flight lines across a polygon, clipped to its outline. Lines run
 * at `directionDeg` (0 = east-west, counter-clockwise positive) and are
 * returned in lawn-mower order. A concave outline can cut one line into
 * several passes.
 */
function clippedSurveyLines(
  boundary: [number, number][],
  lineSpacingM: number,
  directionDeg: number,
): [number, number][][] {
  const origin = boundary[0];
  const theta = directionDeg * DEG;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Rotate the outline so the flight lines become horizontal
  const poly = toLocal(boundary, origin).map(([x, y]): [number, number] => [
    x * cos + y * sin,
    -x * sin + y * cos,
  ]);
  const ys = poly.map((p) => p[1]);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const height = maxY - minY;
  if (!(height > 0)) return [];

  // Evenly spaced lines, half a spacing in from each edge, never wider apart
  // than requested
  const count = Math.min(
    500,
    Math.max(1, Math.ceil(height / Math.max(lineSpacingM, 1) - 1e-9)),
  );
  const step = height / count;

  const passes: [number, number][][] = [];
  for (let i = 0; i < count; i++) {
    const y = minY + (i + 0.5) * step;
    const xs: number[] = [];
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const [ax, ay] = poly[a];
      const [bx, by] = poly[b];
      if (ay > y !== by > y) {
        xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((p, q) => p - q);

    const segments: [number, number][][] = [];
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k + 1] - xs[k] < 1) continue; // slivers shorter than a meter
      segments.push([
        [xs[k], y],
        [xs[k + 1], y],
      ]);
    }
    // Alternate direction line by line
    const ordered =
      i % 2 === 1
        ? segments.reverse().map((s): [number, number][] => [s[1], s[0]])
        : segments;

    for (const segment of ordered) {
      // Rotate back and return to lat/lng
      passes.push(
        fromLocal(
          segment.map(([x, sy]): [number, number] => [
            x * cos - sy * sin,
            x * sin + sy * cos,
          ]),
          origin,
        ),
      );
    }
  }
  return passes;
}

/** Grid passes for an outline: along its longer side, plus rotation. */
function boundaryGridPasses(
  boundary: [number, number][],
  lineSpacingM: number,
  rotationDeg: number,
  crossHatch: boolean,
): [number, number][][] {
  const local = toLocal(boundary, boundary[0]);
  const xs = local.map((p) => p[0]);
  const ys = local.map((p) => p[1]);
  const wide =
    Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  // Same sense as the rectangle grid: positive rotation turns it clockwise
  const direction = (wide ? 0 : 90) - rotationDeg;
  const passes = clippedSurveyLines(boundary, lineSpacingM, direction);
  return crossHatch
    ? [...passes, ...clippedSurveyLines(boundary, lineSpacingM, direction + 90)]
    : passes;
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

  let passes: [number, number][][];
  if (params.boundary && params.boundary.length >= 3) {
    passes = boundaryGridPasses(
      params.boundary,
      lineSpacingM,
      rotationDeg,
      params.crossHatch,
    );
  } else {
    passes = linesAlong(primaryEW);
    if (params.crossHatch) {
      passes = [...passes, ...linesAlong(!primaryEW)];
    }
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
export function toLocal(
  points: [number, number][],
  origin: [number, number],
): [number, number][] {
  const cos0 = Math.cos(origin[0] * DEG);
  return points.map(([lat, lng]) => [
    (lng - origin[1]) * DEG * EARTH_R * cos0,
    (lat - origin[0]) * DEG * EARTH_R,
  ]);
}

export function fromLocal(
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

/**
 * Row and column counts so photos land about `spacingM` apart along a wall
 * and up the altitude band. Both ends of the wall and both altitudes are
 * included.
 */
export function wallPhotoCounts(
  point1: [number, number],
  point2: [number, number],
  minAltitude: number,
  maxAltitude: number,
  spacingM = DEFAULT_FACADE_SPACING.horizontalM,
): { numRows: number; numColumns: number } {
  const lengthM = haversine(point1[0], point1[1], point2[0], point2[1]);
  const span = Math.abs(maxAltitude - minAltitude);
  const step = Math.max(0.5, spacingM);
  return {
    numColumns: Math.max(2, Math.round(lengthM / step) + 1),
    numRows: Math.max(1, Math.round(span / step) + 1),
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

  // With coverage, edge photos sit with their edges on the wall's ends and on
  // the min and max heights: centers are half a photo in from each edge (the
  // middle, for a wall smaller than a photo). Without it (older seeds), photo
  // centers are on the ends and the altitudes.
  let colFrom = 0;
  let colTo = 1;
  let altFrom = minAltitude;
  let altTo = maxAltitude;
  if (params.coverage) {
    const lengthM = haversine(lat1, lng1, lat2, lng2);
    const footprint = wallFootprint(distanceM, params.camera);
    const halfW = Math.min(lengthM / 2, footprint.widthM / 2);
    if (lengthM > 0) {
      colFrom = halfW / lengthM;
      colTo = 1 - colFrom;
    }
    const low = Math.min(minAltitude, maxAltitude);
    const high = Math.max(minAltitude, maxAltitude);
    const halfH = Math.min((high - low) / 2, footprint.heightM / 2);
    altFrom = low + halfH;
    altTo = high - halfH;
  }

  const waypoints: TemplateResult["waypoints"] = [];

  // Wall bearing and perpendicular offset direction
  const wallBearing = bearing(lat1, lng1, lat2, lng2);
  // Perpendicular: offset 90° to the right of the wall direction
  const offsetBearing = (wallBearing + 90) % 360;

  // Generate the scan grid along the wall. Stop at the same cap as the
  // other facade plans so a long wall cannot run past it.
  for (
    let row = 0;
    row < numRows && waypoints.length < MAX_SURVEY_WAYPOINTS;
    row++
  ) {
    // A single row or column sits in the middle of its band when aligned
    const altFraction =
      numRows <= 1 ? (params.coverage ? 0.5 : 0) : row / (numRows - 1);
    // Tenths of a meter: close-range rows can be well under a meter apart,
    // and whole meters would stack several of them at the same height
    const alt = roundTenth(altFrom + altFraction * (altTo - altFrom));
    const reverse = row % 2 === 1; // zigzag

    for (
      let col = 0;
      col < numColumns && waypoints.length < MAX_SURVEY_WAYPOINTS;
      col++
    ) {
      const colIdx = reverse ? numColumns - 1 - col : col;
      const colFraction =
        colFrom +
        (numColumns <= 1
          ? params.coverage
            ? 0.5
            : 0
          : colIdx / (numColumns - 1)) *
          (colTo - colFrom);

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

// ── Circle, spiral and polygon facades ──────────────────

type XY = [number, number];

/** Place `origin` at `distanceM` along the ray through `toward`. */
export function pointOnRay(
  origin: [number, number],
  toward: [number, number],
  distanceM: number,
): [number, number] {
  return destinationPoint(
    origin[0],
    origin[1],
    distanceM,
    bearing(origin[0], origin[1], toward[0], toward[1]),
  );
}

/**
 * Horizontal and vertical gap between photos on a vertical face, in meters.
 * At a level gimbal the sensor's long side runs left-right.
 */
export function facadePhotoSpacing(
  standoffM: number,
  spacing: FacadeSpacing,
  camera: CameraModel = MAVIC_3E_CAMERA,
): { horizontalM: number; verticalM: number } {
  if (spacing.mode === "distance") {
    return {
      horizontalM: Math.max(0.5, spacing.horizontalM),
      verticalM: Math.max(0.5, spacing.verticalM),
    };
  }
  const clamp = (value: number) => Math.min(0.95, Math.max(0, value));
  const distance = Math.max(1, standoffM);
  const horizontalCoverage =
    (distance * camera.sensorWidthMm) / camera.focalLengthMm;
  const verticalCoverage =
    (distance * camera.sensorHeightMm) / camera.focalLengthMm;
  return {
    horizontalM: Math.max(
      0.5,
      horizontalCoverage * (1 - clamp(spacing.horizontalOverlap)),
    ),
    verticalM: Math.max(
      0.5,
      verticalCoverage * (1 - clamp(spacing.verticalOverlap)),
    ),
  };
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Altitudes from bottom to top, both ends included. */
function altitudeLevels(
  minAltitude: number,
  maxAltitude: number,
  verticalM: number,
): number[] {
  const min = Math.min(minAltitude, maxAltitude);
  const max = Math.max(minAltitude, maxAltitude);
  const span = max - min;
  if (span < 0.5 || !(verticalM > 0)) return [roundTenth(min)];
  const intervals = Math.max(1, Math.round(span / verticalM));
  const levels: number[] = [];
  for (let i = 0; i <= intervals; i++) {
    levels.push(roundTenth(min + (i / intervals) * span));
  }
  return levels;
}

function addXY(a: XY, b: XY): XY {
  return [a[0] + b[0], a[1] + b[1]];
}

function subXY(a: XY, b: XY): XY {
  return [a[0] - b[0], a[1] - b[1]];
}

function mulXY(a: XY, scale: number): XY {
  return [a[0] * scale, a[1] * scale];
}

function lenXY(a: XY): number {
  return Math.hypot(a[0], a[1]);
}

function dotXY(a: XY, b: XY): number {
  return a[0] * b[0] + a[1] * b[1];
}

function unitXY(a: XY): XY {
  const length = lenXY(a);
  if (length < 1e-9) return [0, 0];
  return [a[0] / length, a[1] / length];
}

/** Right-hand normal of a unit direction. Outward for a counter-clockwise ring. */
function rightNormal(direction: XY): XY {
  return [direction[1], -direction[0]];
}

function signedArea(points: XY[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    area += points[i][0] * next[1] - next[0] * points[i][1];
  }
  return area / 2;
}

function dedupeMeters(points: XY[], minimumM = 0.2): XY[] {
  const out: XY[] = [];
  for (const point of points) {
    if (
      out.length === 0 ||
      lenXY(subXY(point, out[out.length - 1])) > minimumM
    ) {
      out.push(point);
    }
  }
  if (out.length > 1 && lenXY(subXY(out[0], out[out.length - 1])) <= minimumM) {
    out.pop();
  }
  return out;
}

function dedupeGeographic(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const point of points) {
    if (
      out.length === 0 ||
      haversine(
        point[0],
        point[1],
        out[out.length - 1][0],
        out[out.length - 1][1],
      ) > 0.2
    ) {
      out.push(point);
    }
  }
  if (
    out.length > 1 &&
    haversine(
      out[0][0],
      out[0][1],
      out[out.length - 1][0],
      out[out.length - 1][1],
    ) <= 0.2
  ) {
    out.pop();
  }
  return out;
}

function intersectLines(
  origin: XY,
  direction: XY,
  other: XY,
  otherDirection: XY,
): XY | null {
  const det =
    direction[0] * otherDirection[1] - direction[1] * otherDirection[0];
  if (Math.abs(det) < 1e-9) return null;
  const delta = subXY(other, origin);
  const t = (delta[0] * otherDirection[1] - delta[1] * otherDirection[0]) / det;
  return addXY(origin, mulXY(direction, t));
}

function segmentsCross(a1: XY, a2: XY, b1: XY, b2: XY): boolean {
  const orient = (p: XY, q: XY, r: XY) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return (
    orient(a1, a2, b1) * orient(a1, a2, b2) < 0 &&
    orient(b1, b2, a1) * orient(b1, b2, a2) < 0
  );
}

function ringSelfIntersects(points: XY[]): boolean {
  const count = points.length;
  if (count < 4) return false;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const gap = Math.min(Math.abs(i - j), count - Math.abs(i - j));
      if (gap <= 1) continue;
      if (
        segmentsCross(
          points[i],
          points[(i + 1) % count],
          points[j],
          points[(j + 1) % count],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

export interface OffsetPolygon {
  /** Corners of the outward path, without a repeated closing point. */
  ring: [number, number][];
  selfCrossing: boolean;
}

/**
 * Push every edge of a footprint outward by `distanceM`. Sharp convex
 * corners are beveled so the miter cannot run away.
 */
export function offsetPolygon(
  vertices: [number, number][],
  distanceM: number,
): OffsetPolygon {
  const geographic = dedupeGeographic(vertices);
  if (geographic.length < 3 || !(distanceM > 0)) {
    return { ring: geographic, selfCrossing: false };
  }
  const origin = geographic[0];
  let local = dedupeMeters(toLocal(geographic, origin));
  if (local.length < 3) return { ring: geographic, selfCrossing: false };
  if (signedArea(local) < 0) local = [...local].reverse();

  const count = local.length;
  const directions: XY[] = [];
  const normals: XY[] = [];
  for (let i = 0; i < count; i++) {
    const direction = unitXY(subXY(local[(i + 1) % count], local[i]));
    directions.push(direction);
    normals.push(rightNormal(direction));
  }

  const miterLimit = 2;
  const offset: XY[] = [];
  for (let i = 0; i < count; i++) {
    const previous = (i - 1 + count) % count;
    const vertex = local[i];
    const start = addXY(vertex, mulXY(normals[previous], distanceM));
    const end = addXY(vertex, mulXY(normals[i], distanceM));
    const hit = intersectLines(start, directions[previous], end, directions[i]);
    if (!hit || lenXY(subXY(hit, vertex)) > miterLimit * distanceM) {
      offset.push(start, end);
    } else {
      offset.push(hit);
    }
  }

  const cleaned = dedupeMeters(offset);
  // A notch narrower than the target distance comes back on top of the
  // building. Those points sit closer than the standoff, which is the cue
  // to warn even when the ring does not literally cross itself.
  const collapsed = cleaned.some((point) => {
    let nearest = Infinity;
    for (let i = 0; i < local.length; i++) {
      const projected = projectSegment(
        point,
        local[i],
        local[(i + 1) % local.length],
      );
      nearest = Math.min(nearest, lenXY(subXY(point, projected)));
    }
    return nearest < distanceM - 0.05;
  });
  return {
    ring: fromLocal(cleaned, origin),
    selfCrossing: ringSelfIntersects(cleaned) || collapsed,
  };
}

function projectSegment(point: XY, start: XY, end: XY): XY {
  const edge = subXY(end, start);
  const length2 = dotXY(edge, edge);
  if (length2 < 1e-9) return start;
  const t = Math.max(
    0,
    Math.min(1, dotXY(subXY(point, start), edge) / length2),
  );
  return addXY(start, mulXY(edge, t));
}

function nearestOnRing(point: XY, ring: XY[]): XY {
  let best = ring[0];
  let bestDistance = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const projected = projectSegment(
      point,
      ring[i],
      ring[(i + 1) % ring.length],
    );
    const distance = lenXY(subXY(point, projected));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = projected;
    }
  }
  return best;
}

/** Points around a closed ring, keeping every corner and filling edges. */
function sampleClosedRing(
  ring: [number, number][],
  spacingM: number,
): [number, number][] {
  if (ring.length < 3) return [...ring];
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i++) {
    const start = ring[i];
    const end = ring[(i + 1) % ring.length];
    out.push(start);
    const edgeLength = haversine(start[0], start[1], end[0], end[1]);
    const steps = Math.max(1, Math.round(edgeLength / Math.max(spacingM, 0.5)));
    for (let step = 1; step < steps; step++) {
      const t = step / steps;
      out.push([
        start[0] + t * (end[0] - start[0]),
        start[1] + t * (end[1] - start[1]),
      ]);
    }
  }
  return out;
}

interface FacadeShot {
  latitude: number;
  longitude: number;
  height: number;
  anchorLat: number;
  anchorLng: number;
}

function facadeShotWaypoint(
  shot: FacadeShot,
  aim: TemplateAim,
  pois: TemplatePoi[],
): TemplateResult["waypoints"][number] {
  return {
    ...DEFAULT_WAYPOINT,
    latitude: shot.latitude,
    longitude: shot.longitude,
    height: shot.height,
    speed: 3,
    useGlobalSpeed: false,
    useGlobalHeadingParam: false,
    headingMode: "fixed",
    headingAngle: normalizeHeading(
      bearing(shot.latitude, shot.longitude, shot.anchorLat, shot.anchorLng),
    ),
    turnMode: "toPointAndStopWithContinuityCurvature",
    useGlobalTurnParam: false,
    actions: [{ ...TAKE_PHOTO }],
    ...aimFields(
      {
        latitude: shot.latitude,
        longitude: shot.longitude,
        height: shot.height,
      },
      aim,
      {
        latitude: shot.anchorLat,
        longitude: shot.anchorLng,
        surfacePitchDeg: 0,
      },
      pois,
      0,
    ),
  };
}

function radialFlightPoint(
  center: [number, number],
  radiusM: number,
  angleDeg: number,
  clockwise: boolean,
): [number, number] {
  return destinationPoint(
    center[0],
    center[1],
    radiusM,
    clockwise ? angleDeg : -angleDeg,
  );
}

function emptyBoundary(
  gaps: { horizontalM: number; verticalM: number },
  passLabel: BoundaryFacadeResult["passLabel"],
  selfCrossing = false,
): BoundaryFacadeResult {
  return {
    waypoints: [],
    pois: [],
    plannedCount: 0,
    selfCrossing,
    horizontalM: gaps.horizontalM,
    verticalM: gaps.verticalM,
    passes: 0,
    passLabel,
  };
}

function finishBoundary(
  shots: FacadeShot[],
  aim: TemplateAim,
  pois: TemplatePoi[],
  extraPois: TemplateResult["pois"],
  gaps: { horizontalM: number; verticalM: number },
  passes: number,
  passLabel: BoundaryFacadeResult["passLabel"],
  selfCrossing: boolean,
): BoundaryFacadeResult {
  return {
    waypoints: shots
      .slice(0, MAX_SURVEY_WAYPOINTS)
      .map((shot) => facadeShotWaypoint(shot, aim, pois)),
    pois: extraPois,
    plannedCount: shots.length,
    selfCrossing,
    horizontalM: gaps.horizontalM,
    verticalM: gaps.verticalM,
    passes,
    passLabel,
  };
}

/**
 * Map a round structure or a building footprint. The drawn shape is the
 * structure. The drone flies `standoffM` outside it and stops for each photo.
 */
export function generateBoundaryFacade(
  params: BoundaryFacadeParams,
  availablePois: TemplatePoi[] = [],
): BoundaryFacadeResult {
  const camera = params.camera ?? MAVIC_3E_CAMERA;
  const gaps = facadePhotoSpacing(params.standoffM, params.spacing, camera);
  const standoff = Math.max(1, params.standoffM);
  if (params.boundary === "polygon") {
    return generatePolygonFacade(params, gaps, standoff, availablePois);
  }
  return generateRadialFacade(params, gaps, standoff, availablePois);
}

function generateRadialFacade(
  params: RadialFacadeParams,
  gaps: { horizontalM: number; verticalM: number },
  standoff: number,
  availablePois: TemplatePoi[],
): BoundaryFacadeResult {
  const minAltitude = Math.min(params.minAltitude, params.maxAltitude);
  const maxAltitude = Math.max(params.minAltitude, params.maxAltitude);
  const applyTaper =
    params.tapered &&
    (params.boundary === "spiral" || params.pattern === "horizontal");
  const radiusBottom = Math.max(0, params.radiusBottomM);
  const radiusTop = Math.max(0, applyTaper ? params.radiusTopM : radiusBottom);
  const flightRadius = (t: number) =>
    Math.max(1, radiusBottom + t * (radiusTop - radiusBottom) + standoff);

  const shots: FacadeShot[] = [];
  const anchor = { anchorLat: params.center[0], anchorLng: params.center[1] };
  let passes = 1;
  let passLabel: BoundaryFacadeResult["passLabel"] = "orbits";

  if (params.boundary === "spiral") {
    passLabel = "turns";
    const span = maxAltitude - minAltitude;
    const turns = span > 0.5 ? span / gaps.verticalM : 0;
    passes = turns > 0 ? Math.round(turns * 10) / 10 : 1;
    if (turns === 0) {
      const radius = flightRadius(0);
      const count = Math.max(
        4,
        Math.round((2 * Math.PI * radius) / gaps.horizontalM),
      );
      for (let i = 0; i < count; i++) {
        const [latitude, longitude] = radialFlightPoint(
          params.center,
          radius,
          (i / count) * 360,
          params.clockwise,
        );
        shots.push({
          latitude,
          longitude,
          height: roundTenth(minAltitude),
          ...anchor,
        });
      }
    } else {
      const thetaEnd = turns * 2 * Math.PI;
      let theta = 0;
      while (theta < thetaEnd - 1e-6) {
        const t = theta / thetaEnd;
        const radius = flightRadius(t);
        const [latitude, longitude] = radialFlightPoint(
          params.center,
          radius,
          (theta * 180) / Math.PI,
          params.clockwise,
        );
        shots.push({
          latitude,
          longitude,
          height: roundTenth(minAltitude + t * span),
          ...anchor,
        });
        theta += gaps.horizontalM / radius;
      }
      const [latitude, longitude] = radialFlightPoint(
        params.center,
        flightRadius(1),
        (thetaEnd * 180) / Math.PI,
        params.clockwise,
      );
      shots.push({
        latitude,
        longitude,
        height: roundTenth(maxAltitude),
        ...anchor,
      });
    }
  } else if (params.pattern === "vertical") {
    passLabel = "columns";
    const radius = flightRadius(0);
    const columns = Math.max(
      4,
      Math.round((2 * Math.PI * radius) / gaps.horizontalM),
    );
    passes = columns;
    const levels = altitudeLevels(minAltitude, maxAltitude, gaps.verticalM);
    for (let column = 0; column < columns; column++) {
      const [latitude, longitude] = radialFlightPoint(
        params.center,
        radius,
        (column / columns) * 360,
        params.clockwise,
      );
      const heights = column % 2 === 0 ? levels : [...levels].reverse();
      for (const height of heights) {
        shots.push({ latitude, longitude, height, ...anchor });
      }
    }
  } else {
    const levels = altitudeLevels(minAltitude, maxAltitude, gaps.verticalM);
    passes = levels.length;
    let startAngle = 0;
    for (let level = 0; level < levels.length; level++) {
      const t = levels.length === 1 ? 0 : level / (levels.length - 1);
      const radius = flightRadius(t);
      const count = Math.max(
        4,
        Math.round((2 * Math.PI * radius) / gaps.horizontalM),
      );
      const reverse = level % 2 === 1;
      let lastAngle = startAngle;
      for (let i = 0; i < count; i++) {
        const angle = reverse
          ? startAngle - (i / count) * 360
          : startAngle + (i / count) * 360;
        const [latitude, longitude] = radialFlightPoint(
          params.center,
          radius,
          angle,
          params.clockwise,
        );
        shots.push({ latitude, longitude, height: levels[level], ...anchor });
        lastAngle = angle;
      }
      startAngle = lastAngle;
    }
  }

  return finishBoundary(
    shots,
    params.aim,
    availablePois,
    params.createPoi
      ? [centerPoi("Facade center", params.center, params.aim)]
      : [],
    gaps,
    passes,
    passLabel,
    false,
  );
}

function generatePolygonFacade(
  params: PolygonFacadeParams,
  gaps: { horizontalM: number; verticalM: number },
  standoff: number,
  availablePois: TemplatePoi[],
): BoundaryFacadeResult {
  const passLabel: BoundaryFacadeResult["passLabel"] =
    params.pattern === "vertical" ? "columns" : "orbits";
  const geographic = dedupeGeographic(params.vertices);
  if (geographic.length < 3) return emptyBoundary(gaps, passLabel);

  const offset = offsetPolygon(geographic, standoff);
  if (offset.ring.length < 3) {
    return emptyBoundary(gaps, passLabel, offset.selfCrossing);
  }

  const origin = geographic[0];
  const structure = toLocal(geographic, origin);
  const stations = sampleClosedRing(offset.ring, gaps.horizontalM).map(
    ([latitude, longitude]) => {
      const [localPoint] = toLocal([[latitude, longitude]], origin);
      const nearest = nearestOnRing(localPoint, structure);
      const [anchorLat, anchorLng] = fromLocal([nearest], origin)[0];
      return { latitude, longitude, anchorLat, anchorLng };
    },
  );
  if (stations.length === 0)
    return emptyBoundary(gaps, passLabel, offset.selfCrossing);

  const levels = altitudeLevels(
    params.minAltitude,
    params.maxAltitude,
    gaps.verticalM,
  );
  const shots: FacadeShot[] = [];
  if (params.pattern === "vertical") {
    stations.forEach((station, index) => {
      const heights = index % 2 === 0 ? levels : [...levels].reverse();
      for (const height of heights) {
        shots.push({ ...station, height });
      }
    });
  } else {
    levels.forEach((height, level) => {
      const pass = level % 2 === 0 ? stations : [...stations].reverse();
      for (const station of pass) {
        shots.push({ ...station, height });
      }
    });
  }

  return finishBoundary(
    shots,
    params.aim,
    availablePois,
    [],
    gaps,
    params.pattern === "vertical" ? stations.length : levels.length,
    passLabel,
    offset.selfCrossing,
  );
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
