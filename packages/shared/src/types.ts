// ── Heading & Turn Modes ─────────────────────────────────

export type HeadingMode =
  | "followWayline"
  | "manually"
  | "fixed"
  | "smoothTransition"
  | "towardPOI";

export type TurnMode =
  | "coordinateTurn"
  | "toPointAndStopWithDiscontinuityCurvature"
  | "toPointAndStopWithContinuityCurvature"
  | "toPointAndPassWithContinuityCurvature";

export type HeightMode = "EGM96" | "relativeToStartPoint" | "aboveGroundLevel";

export type FlyToWaylineMode = "safely" | "pointToPoint";

export type FinishAction =
  | "goHome"
  | "noAction"
  | "autoLand"
  | "gotoFirstWaypoint";

export type RCLostAction = "goBack" | "landing" | "hover";

export type GimbalPitchMode = "manual" | "usePointSetting";

// ── Action Types ─────────────────────────────────────────

export type ActionType =
  | "takePhoto"
  | "startRecord"
  | "stopRecord"
  | "gimbalRotate"
  | "gimbalEvenlyRotate"
  | "rotateYaw"
  | "hover"
  | "zoom"
  | "focus";

export interface TakePhotoParams {
  payloadPositionIndex: number;
  fileSuffix?: string;
}

export interface StartRecordParams {
  payloadPositionIndex: number;
  fileSuffix?: string;
}

export interface StopRecordParams {
  payloadPositionIndex: number;
}

export interface GimbalRotateParams {
  gimbalPitchRotateAngle: number; // -120 to 45
  gimbalYawRotateAngle: number; // -180 to 180
  gimbalRollRotateAngle: number; // typically 0
  gimbalRotateMode: "absoluteAngle";
  payloadPositionIndex: number;
}

export interface GimbalEvenlyRotateParams {
  gimbalPitchRotateAngle: number; // -120 to 45 — target pitch at this waypoint
  payloadPositionIndex: number;
}

export interface RotateYawParams {
  aircraftHeading: number; // -180 to 180
  aircraftPathMode: "clockwise" | "counterClockwise";
}

export interface HoverParams {
  hoverTime: number; // seconds
}

export interface ZoomParams {
  focalLength: number; // mm
}

export interface FocusParams {
  isPointFocus: boolean;
  focusX?: number;
  focusY?: number;
  isInfiniteFocus?: boolean;
}

export type ActionParams =
  | TakePhotoParams
  | StartRecordParams
  | StopRecordParams
  | GimbalRotateParams
  | GimbalEvenlyRotateParams
  | RotateYawParams
  | HoverParams
  | ZoomParams
  | FocusParams;

export interface WaypointAction {
  actionId: number;
  actionType: ActionType;
  params: ActionParams;
}

// ── Drone & Payload ──────────────────────────────────────

export interface DroneModel {
  label: string;
  droneEnumValue: number;
  droneSubEnumValue: number;
  payloads: PayloadModel[];
}

export interface PayloadModel {
  label: string;
  payloadEnumValue: number;
}

export const DRONE_MODELS: DroneModel[] = [
  {
    label: "DJI M300 RTK",
    droneEnumValue: 60,
    droneSubEnumValue: 0,
    payloads: [
      { label: "H20", payloadEnumValue: 42 },
      { label: "H20T", payloadEnumValue: 43 },
      { label: "H20N", payloadEnumValue: 61 },
      { label: "PSDK", payloadEnumValue: 65534 },
    ],
  },
  {
    label: "DJI M30",
    droneEnumValue: 67,
    droneSubEnumValue: 0,
    payloads: [{ label: "M30 Camera", payloadEnumValue: 52 }],
  },
  {
    label: "DJI M30T",
    droneEnumValue: 67,
    droneSubEnumValue: 1,
    payloads: [{ label: "M30T Camera", payloadEnumValue: 53 }],
  },
  {
    // droneEnumValue 68 appears in real DJI KMZ files (likely Dock-paired M30 variant)
    label: "DJI M30 (Dock)",
    droneEnumValue: 68,
    droneSubEnumValue: 0,
    payloads: [
      { label: "M30 Camera", payloadEnumValue: 52 },
      { label: "M30T Camera", payloadEnumValue: 53 },
    ],
  },
  {
    label: "DJI Mavic 3E",
    droneEnumValue: 77,
    droneSubEnumValue: 0,
    payloads: [{ label: "M3E Camera", payloadEnumValue: 66 }],
  },
  {
    label: "DJI Mavic 3T",
    droneEnumValue: 77,
    droneSubEnumValue: 1,
    payloads: [{ label: "M3T Camera", payloadEnumValue: 67 }],
  },
  {
    label: "DJI Mavic 3M",
    droneEnumValue: 77,
    droneSubEnumValue: 2,
    payloads: [{ label: "M3M Camera", payloadEnumValue: 68 }],
  },
  {
    label: "DJI M350 RTK",
    droneEnumValue: 89,
    droneSubEnumValue: 0,
    payloads: [
      { label: "H20", payloadEnumValue: 42 },
      { label: "H20T", payloadEnumValue: 43 },
      { label: "H20N", payloadEnumValue: 61 },
      { label: "H30", payloadEnumValue: 82 },
      { label: "H30T", payloadEnumValue: 83 },
      { label: "PSDK", payloadEnumValue: 65534 },
    ],
  },
  {
    label: "DJI Mavic 3D",
    droneEnumValue: 91,
    droneSubEnumValue: 0,
    payloads: [{ label: "M3D Camera", payloadEnumValue: 80 }],
  },
  {
    label: "DJI Mavic 3TD",
    droneEnumValue: 91,
    droneSubEnumValue: 1,
    payloads: [{ label: "M3TD Camera", payloadEnumValue: 81 }],
  },
  {
    label: "DJI Mini 4 Pro",
    droneEnumValue: 100,
    droneSubEnumValue: 0,
    payloads: [{ label: "Mini 4 Pro Camera", payloadEnumValue: 100 }],
  },
];

// ── Point of Interest ────────────────────────────────────

export interface PointOfInterest {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  height: number;
}

// ── Obstacle ─────────────────────────────────────────────

export interface Obstacle {
  id: string;
  name: string;
  description: string;
  vertices: [number, number][]; // Array of [latitude, longitude] pairs
  /**
   * Top of the obstacle in meters above ground. When set, waypoints and legs
   * that clear it are reported as passing over instead of as conflicts. Unset
   * means the height is unknown, so everything inside or across it conflicts.
   */
  height?: number | null;
}

// ── Site feature ─────────────────────────────────────────

/** What a site feature is. Each kind has a default color. */
export type SiteFeatureKind =
  | "existing"
  | "garage"
  | "addition"
  | "lot"
  | "other";

/**
 * A building, lot or other area on the site, drawn as a colored polygon the
 * user can edit. Buildings count as obstacles for the route checks; a lot does
 * not.
 */
export interface SiteFeature {
  id: string;
  name: string;
  kind: SiteFeatureKind;
  /** Color as #rrggbb. */
  color: string;
  vertices: [number, number][]; // [latitude, longitude] pairs
  /** Height above ground in meters, when known. */
  heightM?: number | null;
  /** Checked against the route like an obstacle. */
  isObstacle: boolean;
  /** Where the outline came from. */
  source: "manual" | "map" | "proposal";
  note?: string;
}

export const SITE_FEATURE_KINDS: Record<
  SiteFeatureKind,
  { label: string; color: string; isObstacle: boolean }
> = {
  existing: { label: "Existing building", color: "#94a3b8", isObstacle: true },
  garage: { label: "Garage", color: "#f59e0b", isObstacle: true },
  addition: { label: "Addition", color: "#22c55e", isObstacle: true },
  lot: { label: "Lot", color: "#22d3ee", isObstacle: false },
  other: { label: "Other", color: "#a78bfa", isObstacle: true },
};

// ── Waypoint ─────────────────────────────────────────────

export interface Waypoint {
  index: number;
  name: string;
  latitude: number;
  longitude: number;
  height: number;
  speed: number;
  useGlobalSpeed: boolean;
  useGlobalHeight: boolean;
  useGlobalHeadingParam: boolean;
  useGlobalTurnParam: boolean;
  headingMode?: HeadingMode;
  headingAngle?: number;
  poiId?: string; // Reference to PointOfInterest when headingMode = "towardPOI"
  turnMode?: TurnMode;
  turnDampingDist?: number;
  gimbalPitchAngle: number;
  /**
   * Distance-interval capture: take a photo every N meters while flying from
   * this waypoint to the next one (WPML `multipleDistance` trigger).
   */
  photoIntervalM?: number;
  actions: WaypointAction[];
}

// ── Mission Config ───────────────────────────────────────

/**
 * Where a mission is based: the site address and/or the spot the pilot
 * launches from. A planning aid only — it is not written to the KMZ.
 */
export interface MissionHome {
  latitude: number;
  longitude: number;
  /** The address the position was looked up from, when there is one. */
  address?: string;
}

/**
 * Where the drone takes off from and returns to. Shown on the map and written
 * to the KMZ as the WPML reference take-off point.
 */
export interface TakeoffPoint {
  latitude: number;
  longitude: number;
  /** Elevation of the ground at this spot, in meters. 0 when not known. */
  elevationM?: number;
}

/** Which arrangement of files to use inside an exported KMZ. */
export type KmzLayout = "root" | "wpmz";

/**
 * File name for an exported KMZ. DJI apps (FlightHub 2, Pilot 2) take the
 * route name from the file name and refuse < > : " / | ? * . _ and \, so the
 * name keeps only letters, digits, spaces and hyphens.
 */
export function kmzFileName(name: string): string {
  const clean = name
    .replace(/[^\p{L}\p{N} -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${clean || "mission"}.kmz`;
}

export interface MissionConfig {
  droneEnumValue: number;
  droneSubEnumValue: number;
  payloadEnumValue: number;
  flyToWaylineMode: FlyToWaylineMode;
  finishAction: FinishAction;
  exitOnRCLost: "goContinue" | "executeLostAction";
  executeRCLostAction: RCLostAction;
  takeOffSecurityHeight: number;
  globalTransitionalSpeed: number;
  autoFlightSpeed: number;
  maxBatteryMinutes: number;
  heightMode: HeightMode;
  globalHeadingMode: HeadingMode;
  globalTurnMode: TurnMode;
  gimbalPitchMode: GimbalPitchMode;
  home?: MissionHome;
  takeoff?: TakeoffPoint;
}

// ── Mission ──────────────────────────────────────────────

export interface Mission {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  config: MissionConfig;
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  obstacles: Obstacle[];
  siteFeatures?: SiteFeature[];
}

// ── Shared Mission ──────────────────────────────────────

export interface SharedMission {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  shareToken: string;
  ownerEmail?: string;
  config: MissionConfig;
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  obstacles: Obstacle[];
  siteFeatures?: SiteFeature[];
}

// ── Route proposals (drafted by an AI agent, reviewed by the user) ──────

/** [latitude, longitude] */
export type LatLng = [number, number];

export interface ProposalStructure {
  /** Referenced by suggestions' `targetId`. */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Height above ground in meters, when the documents give it. */
  heightM?: number;
  /** Radius of a circle that encloses the footprint, in meters. */
  footprintRadiusM?: number;
  /**
   * Footprint outline as [latitude, longitude] corners, when the documents
   * give one. Accepting the proposal turns it into a site feature, and a
   * facade suggestion may target it.
   */
  footprintVertices?: LatLng[];
  /** What the structure is, which sets the site feature's kind on accept. */
  kind?: SiteFeatureKind;
  note?: string;
}

export interface ProposalAlignment {
  id: string;
  name: string;
  /** Centerline of a road, utility, wall or other linear feature. */
  path: LatLng[];
  /** Width to cover on the ground, in meters. */
  widthM?: number;
}

export type ProposalSuggestionKind =
  | "grid"
  | "corridor"
  | "orbit"
  | "tower"
  | "facade";

/** One mission the agent recommends, mapped onto an existing template. */
export interface ProposalSuggestion {
  kind: ProposalSuggestionKind;
  /**
   * What it applies to: `"boundary"` for grids, a structure id for orbit and
   * tower, an alignment id for corridor. A facade takes an alignment id (one
   * wall) or the id of a structure with a footprint (all the way around).
   */
  targetId: string;
  title: string;
  /** Why the agent recommends this, in a sentence or two. */
  rationale: string;
  altitudeM?: number;
  sideOverlap?: number; // 0–1
  forwardOverlap?: number; // 0–1
  crossHatch?: boolean;
  /** Distance to keep from a structure or wall, in meters. */
  standoffM?: number;
  minAltitudeM?: number;
  maxAltitudeM?: number;
}

export interface RouteProposalContent {
  title: string;
  /** Which agent drafted it and from which documents. */
  sourceNote?: string;
  site: {
    address?: string;
    anchor?: { latitude: number; longitude: number };
    /** How the position on the map was determined, which sets how far to trust it. */
    anchorSource: "coordinates" | "geocoded" | "estimated";
  };
  /** Property or project limits. */
  boundary?: LatLng[];
  /** Gap left when the boundary calls were traced, in meters. */
  boundaryClosureErrorM?: number;
  structures: ProposalStructure[];
  alignments: ProposalAlignment[];
  suggestions: ProposalSuggestion[];
  /** Things the agent assumed because the documents did not say. */
  assumptions: string[];
  /** Things the user should check before flying. */
  warnings: string[];
}

export type RouteProposalStatus = "pending" | "accepted" | "dismissed";

export interface RouteProposal extends RouteProposalContent {
  id: string;
  status: RouteProposalStatus;
  createdAt: string;
}

// ── Admin ────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  isAdmin: boolean;
  isBanned: boolean;
  missionCount: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  perPage: number;
  total: number;
}

// ── User Preferences ────────────────────────────────────

export interface VisualizationPreferences {
  viewMode: "2d" | "3d";
  mapStyle: "satellite" | "street";
}

export type UnitSystem = "metric" | "imperial";

export interface UserPreferences {
  unitSystem: UnitSystem;
  visualization: VisualizationPreferences;
  missionDefaults: MissionConfig;
}

// ── Map ──────────────────────────────────────────────────

/** Map center (latitude/longitude) and zoom shown when the app first loads. */
export interface MapViewState {
  latitude: number;
  longitude: number;
  zoom: number;
}

// ── Default Config ───────────────────────────────────────

export const DEFAULT_MISSION_CONFIG: MissionConfig = {
  droneEnumValue: 77,
  droneSubEnumValue: 0,
  payloadEnumValue: 66,
  flyToWaylineMode: "safely",
  finishAction: "goHome",
  exitOnRCLost: "executeLostAction",
  executeRCLostAction: "goBack",
  takeOffSecurityHeight: 20,
  globalTransitionalSpeed: 10,
  autoFlightSpeed: 7,
  maxBatteryMinutes: 25,
  heightMode: "aboveGroundLevel",
  globalHeadingMode: "followWayline",
  globalTurnMode: "toPointAndStopWithDiscontinuityCurvature",
  gimbalPitchMode: "usePointSetting",
};

export const DEFAULT_WAYPOINT: Omit<
  Waypoint,
  "index" | "name" | "latitude" | "longitude"
> = {
  height: 30,
  speed: 7,
  useGlobalSpeed: true,
  useGlobalHeight: false,
  useGlobalHeadingParam: true,
  useGlobalTurnParam: true,
  gimbalPitchAngle: -45,
  actions: [],
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  unitSystem: "metric",
  visualization: {
    viewMode: "2d",
    mapStyle: "satellite",
  },
  missionDefaults: { ...DEFAULT_MISSION_CONFIG },
};

/**
 * Built-in default map view (Barcelona). Used when no DEFAULT_MAP_* env vars are
 * configured, and as the client-side fallback before the config endpoint loads.
 */
export const DEFAULT_MAP_VIEW: MapViewState = {
  latitude: 41.3874,
  longitude: 2.1686,
  zoom: 13,
};
