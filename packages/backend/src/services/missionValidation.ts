/**
 * Server-side validation for mission payloads.
 *
 * Client-side checks are UX only — every payload that gets persisted or fed to
 * the KMZ generator is validated here too. The goal is to reject malformed,
 * oversized or out-of-range data before it reaches the database or downstream
 * processing (defends against DoS via huge arrays, NaN/Infinity coordinates and
 * type-confusion). Each validator returns an error string, or `null` when valid.
 */

const MAX_NAME_LEN = 200;
const MAX_WAYPOINTS = 5000;
const MAX_POIS = 2000;
const MAX_OBSTACLES = 1000;
const MAX_VERTICES_PER_OBSTACLE = 5000;
const MAX_OBSTACLE_HEIGHT_M = 1000;
const MAX_SITE_FEATURES = 200;
const MAX_VERTICES_PER_FEATURE = 500;
const SITE_FEATURE_KINDS = ["existing", "garage", "addition", "lot", "other"];
const COLOR = /^#[0-9a-fA-F]{6}$/;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isLatitude(v: unknown): boolean {
  return isFiniteNumber(v) && v >= -90 && v <= 90;
}

function isLongitude(v: unknown): boolean {
  return isFiniteNumber(v) && v >= -180 && v <= 180;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidName(v: unknown): boolean {
  return (
    typeof v === "string" && v.trim().length >= 1 && v.length <= MAX_NAME_LEN
  );
}

function isOptionalName(v: unknown): boolean {
  return v === undefined || (typeof v === "string" && v.length <= MAX_NAME_LEN);
}

function validateWaypoints(value: unknown): string | null {
  if (!Array.isArray(value)) return "waypoints must be an array";
  if (value.length > MAX_WAYPOINTS) return "too many waypoints";
  for (const wp of value) {
    if (!isPlainObject(wp)) return "invalid waypoint";
    if (!isLatitude(wp.latitude) || !isLongitude(wp.longitude)) {
      return "waypoint coordinates out of range";
    }
    if (!isFiniteNumber(wp.height)) return "invalid waypoint height";
    if (!isOptionalName(wp.name)) return "invalid waypoint name";
  }
  return null;
}

function validatePois(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "pois must be an array";
  if (value.length > MAX_POIS) return "too many points of interest";
  for (const poi of value) {
    if (!isPlainObject(poi)) return "invalid point of interest";
    if (!isLatitude(poi.latitude) || !isLongitude(poi.longitude)) {
      return "POI coordinates out of range";
    }
    if (!isFiniteNumber(poi.height)) return "invalid POI height";
    if (!isOptionalName(poi.name)) return "invalid POI name";
  }
  return null;
}

function validateObstacles(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "obstacles must be an array";
  if (value.length > MAX_OBSTACLES) return "too many obstacles";
  for (const obstacle of value) {
    if (!isPlainObject(obstacle)) return "invalid obstacle";
    if (!Array.isArray(obstacle.vertices)) return "invalid obstacle vertices";
    if (obstacle.vertices.length > MAX_VERTICES_PER_OBSTACLE) {
      return "too many obstacle vertices";
    }
    for (const vertex of obstacle.vertices) {
      if (
        !Array.isArray(vertex) ||
        vertex.length !== 2 ||
        !isLatitude(vertex[0]) ||
        !isLongitude(vertex[1])
      ) {
        return "obstacle vertex out of range";
      }
    }
    if (!isOptionalName(obstacle.name)) return "invalid obstacle name";
    if (
      obstacle.height !== undefined &&
      obstacle.height !== null &&
      !(
        isFiniteNumber(obstacle.height) &&
        obstacle.height >= 0 &&
        obstacle.height <= MAX_OBSTACLE_HEIGHT_M
      )
    ) {
      return "invalid obstacle height";
    }
  }
  return null;
}

const MAX_ADDRESS_LEN = 300;

/** Checks the optional mission home inside a config object. */
function validateHome(config: Record<string, unknown>): string | null {
  const home = config.home;
  if (home === undefined || home === null) return null;
  if (!isPlainObject(home)) return "invalid mission home";
  if (!isLatitude(home.latitude) || !isLongitude(home.longitude)) {
    return "mission home coordinates out of range";
  }
  if (
    home.address !== undefined &&
    (typeof home.address !== "string" || home.address.length > MAX_ADDRESS_LEN)
  ) {
    return "invalid mission home address";
  }
  return null;
}

export interface MissionPayload {
  name?: unknown;
  config?: unknown;
  waypoints?: unknown;
  pois?: unknown;
  obstacles?: unknown;
  siteFeatures?: unknown;
}

/** Checks the buildings, lot and other areas drawn on the site. */
function validateSiteFeatures(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "siteFeatures must be an array";
  if (value.length > MAX_SITE_FEATURES) return "too many site features";
  for (const feature of value) {
    if (!isPlainObject(feature)) return "invalid site feature";
    if (typeof feature.id !== "string" || feature.id.length === 0) {
      return "invalid site feature id";
    }
    if (!isValidName(feature.name)) return "invalid site feature name";
    if (!SITE_FEATURE_KINDS.includes(feature.kind as string)) {
      return "invalid site feature kind";
    }
    if (typeof feature.color !== "string" || !COLOR.test(feature.color)) {
      return "invalid site feature color";
    }
    if (
      !Array.isArray(feature.vertices) ||
      feature.vertices.length < 3 ||
      feature.vertices.length > MAX_VERTICES_PER_FEATURE
    ) {
      return "a site feature needs 3 to 500 corners";
    }
    for (const vertex of feature.vertices) {
      if (
        !Array.isArray(vertex) ||
        vertex.length !== 2 ||
        !isLatitude(vertex[0]) ||
        !isLongitude(vertex[1])
      ) {
        return "site feature corner out of range";
      }
    }
    if (
      feature.heightM !== undefined &&
      feature.heightM !== null &&
      !(
        isFiniteNumber(feature.heightM) &&
        feature.heightM >= 0 &&
        feature.heightM <= MAX_OBSTACLE_HEIGHT_M
      )
    ) {
      return "invalid site feature height";
    }
    if (typeof feature.isObstacle !== "boolean") {
      return "invalid site feature obstacle setting";
    }
    if (feature.source !== "manual" && feature.source !== "map") {
      return "invalid site feature source";
    }
    if (
      feature.note !== undefined &&
      (typeof feature.note !== "string" || feature.note.length > 1000)
    ) {
      return "invalid site feature note";
    }
  }
  return null;
}

/** Checks the optional drone home (take-off) point inside a config object. */
function validateTakeoff(config: Record<string, unknown>): string | null {
  const takeoff = config.takeoff;
  if (takeoff === undefined || takeoff === null) return null;
  if (!isPlainObject(takeoff)) return "invalid drone home point";
  if (!isLatitude(takeoff.latitude) || !isLongitude(takeoff.longitude)) {
    return "drone home point coordinates out of range";
  }
  if (
    takeoff.elevationM !== undefined &&
    !(
      isFiniteNumber(takeoff.elevationM) &&
      takeoff.elevationM >= -500 &&
      takeoff.elevationM <= 9000
    )
  ) {
    return "invalid drone home point elevation";
  }
  return null;
}

/** Validate a full mission-create payload. Returns an error message or null. */
export function validateMissionCreate(body: MissionPayload): string | null {
  if (!isValidName(body.name)) return "invalid mission name";
  if (!isPlainObject(body.config)) return "invalid mission config";
  return (
    validateHome(body.config) ??
    validateTakeoff(body.config) ??
    validateWaypoints(body.waypoints) ??
    validatePois(body.pois) ??
    validateObstacles(body.obstacles) ??
    validateSiteFeatures(body.siteFeatures)
  );
}

/**
 * Validate a partial mission-update payload — only the fields that are present
 * are checked.
 */
export function validateMissionUpdate(body: MissionPayload): string | null {
  if (body.name !== undefined && !isValidName(body.name)) {
    return "invalid mission name";
  }
  if (body.config !== undefined) {
    if (!isPlainObject(body.config)) return "invalid mission config";
    const error = validateHome(body.config) ?? validateTakeoff(body.config);
    if (error) return error;
  }
  if (body.waypoints !== undefined) {
    const error = validateWaypoints(body.waypoints);
    if (error) return error;
  }
  return (
    validatePois(body.pois) ??
    validateObstacles(body.obstacles) ??
    validateSiteFeatures(body.siteFeatures)
  );
}

/**
 * Validate the geometry of a parsed/submitted mission used for KMZ generation
 * and import — config shape is left to the caller, this focuses on the arrays.
 */
export function validateMissionGeometry(body: MissionPayload): string | null {
  return (
    validateWaypoints(body.waypoints) ??
    validatePois(body.pois) ??
    validateObstacles(body.obstacles)
  );
}
