import type {
  CaptureElement,
  CaptureObjective,
  CaptureSettings,
  MissionConfig,
  Obstacle,
  RouteCapture,
  SiteFeature,
  Waypoint,
} from "@droneroute/shared";
import type { CameraModel } from "@/lib/camera";
import { spacingFromOverlap } from "@/lib/camera";
import {
  DEFAULT_FACADE_PARAMS,
  DEFAULT_GRID_PARAMS,
  bearing,
  boundaryCorners,
  offsetPolygon,
  toLocal,
  withWallCoverage,
  type FacadeParams,
  type GridParams,
  type PolygonFacadeParams,
  type TemplateResult,
} from "@/lib/templates";
import { runPlan, type PlanInput } from "@/lib/routePlan";
import { estimateMission } from "@/lib/missionStats";
import {
  DEFAULT_STANDOFF_M,
  OBSTACLE_CLEARANCE_M,
  getObstacleWarnings,
  haversineDistance,
  isObstacleConflict,
  pointInPolygon,
  siteFeaturesAsObstacles,
} from "@/lib/geo";

/**
 * Capture plans: turn "what is this inspection for" plus a building outline
 * into routes. Which parts to photograph comes from the objective (a fixed
 * playbook, no AI); every waypoint comes from the existing templates. Pure
 * functions; the store adds the routes.
 */

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  facadeStandoffM: 6,
  roofClearanceM: 20,
  obliqueOffsetM: 10,
  siteAltitudeM: 60,
  assumedHeightM: 8,
};

/** Overlap between neighboring facade photos: every spot in about two photos. */
export const FACADE_OVERLAP = 0.4;
/** Side and forward overlap for straight-down mapping photos. */
export const MAP_OVERLAP = 0.75;
/** Overlap between neighboring angled roof photos along the path. */
export const OBLIQUE_OVERLAP = 0.6;
/** Walls shorter than this are not photographed on their own. */
export const MIN_WALL_M = 2;
/** Neighboring edges turning less than this are one wall. */
export const COLLINEAR_DEG = 12;
/** US limit for small drones, 400 ft above ground. */
export const MAX_ALTITUDE_M = 122;

export const OBJECTIVES: Record<
  CaptureObjective,
  {
    label: string;
    description: string;
    elements: CaptureElement[];
    groundFollowUp: string[];
  }
> = {
  exterior_baseline: {
    label: "Exterior condition baseline",
    description:
      "The site around the building, the roof from above and at an angle, and every facade: a full exterior record to repeat later.",
    elements: [
      "site_context",
      "roof_nadir",
      "roof_oblique",
      "facade_north",
      "facade_east",
      "facade_south",
      "facade_west",
    ],
    groundFollowUp: [
      "Entrances and doors",
      "Drainage: downspouts, drains and grade at the walls",
      "Wall sections hidden by trees, decks or other structures",
      "Undersides of eaves and overhangs",
    ],
  },
  roof_inspection: {
    label: "Roof inspection",
    description:
      "The roof straight down for coverage and at an angle all the way around for edges, flashing and gutters.",
    elements: ["roof_nadir", "roof_oblique"],
    groundFollowUp: [
      "Gutters and downspouts from below",
      "Roof areas under trees or overhangs",
    ],
  },
  facade_inspection: {
    label: "Facade inspection",
    description:
      "Every wall photographed straight on, side by side, from near the ground to the roof line.",
    elements: ["facade_north", "facade_east", "facade_south", "facade_west"],
    groundFollowUp: [
      "Entrances and doors",
      "Wall sections hidden by trees, decks or other structures",
    ],
  },
};

export const ELEMENT_LABELS: Record<CaptureElement, string> = {
  site_context: "Site context",
  roof_nadir: "Roof, straight down",
  roof_oblique: "Roof, angled",
  facade_north: "North facade",
  facade_east: "East facade",
  facade_south: "South facade",
  facade_west: "West facade",
};

/** Said with every plan: what DroneRoute cannot know. */
export const OPERATOR_NOTICE =
  "DroneRoute only checks the obstacles and buildings drawn in this mission. It knows nothing of wires, trees, cranes, people, vehicles, airspace authorization, flight restrictions or weather. No warning does not mean safe to fly: review every route before flying.";

type FacadeElement =
  | "facade_north"
  | "facade_east"
  | "facade_south"
  | "facade_west";

const FACADE_DIRECTIONS: Record<FacadeElement, string> = {
  facade_north: "north",
  facade_east: "east",
  facade_south: "south",
  facade_west: "west",
};

/** The compass side a wall faces, from its outward bearing. */
export function sideFacing(outwardBearing: number): FacadeElement {
  const b = ((outwardBearing % 360) + 360) % 360;
  if (b >= 315 || b < 45) return "facade_north";
  if (b < 135) return "facade_east";
  if (b < 225) return "facade_south";
  return "facade_west";
}

export interface Wall {
  /** Ends of the wall, with the outside on the right going from `start` to `end`. */
  start: [number, number];
  end: [number, number];
  lengthM: number;
  /** Bearing the wall faces, 0 = north. */
  outwardBearing: number;
  side: FacadeElement;
}

function angleBetween(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/** Corners without repeats, counter-clockwise (outside on the right of each edge). */
function counterClockwise(vertices: [number, number][]): [number, number][] {
  const ring = vertices.filter(
    (p, i) =>
      i === 0 || p[0] !== vertices[i - 1][0] || p[1] !== vertices[i - 1][1],
  );
  const last = ring[ring.length - 1];
  if (ring.length > 1 && last[0] === ring[0][0] && last[1] === ring[0][1]) {
    ring.pop();
  }
  if (ring.length < 3) return ring;
  const local = toLocal(ring, ring[0]);
  let area = 0;
  for (let i = 0; i < local.length; i++) {
    const [x1, y1] = local[i];
    const [x2, y2] = local[(i + 1) % local.length];
    area += x1 * y2 - x2 * y1;
  }
  return area >= 0 ? ring : [...ring].reverse();
}

/**
 * The walls of a footprint: edges that run on in nearly the same direction
 * are joined into one wall, and each wall knows which way it faces.
 */
export function footprintWalls(vertices: [number, number][]): Wall[] {
  const ring = counterClockwise(vertices);
  const n = ring.length;
  if (n < 3) return [];
  const edges = ring.map((a, i) => {
    const b = ring[(i + 1) % n];
    return { a, b, bearing: bearing(a[0], a[1], b[0], b[1]) };
  });
  // Start at a real corner so a wall is never split across the start
  let start = edges.findIndex(
    (e, i) =>
      angleBetween(edges[(i - 1 + n) % n].bearing, e.bearing) > COLLINEAR_DEG,
  );
  if (start < 0) start = 0;

  const groups: { a: [number, number]; b: [number, number]; first: number }[] =
    [];
  for (let k = 0; k < n; k++) {
    const e = edges[(start + k) % n];
    const group = groups[groups.length - 1];
    if (group && angleBetween(group.first, e.bearing) <= COLLINEAR_DEG) {
      group.b = e.b;
    } else {
      groups.push({ a: e.a, b: e.b, first: e.bearing });
    }
  }
  return groups.map(({ a, b }) => {
    const outwardBearing = (bearing(a[0], a[1], b[0], b[1]) + 90) % 360;
    return {
      start: a,
      end: b,
      lengthM: haversineDistance(a[0], a[1], b[0], b[1]),
      outwardBearing,
      side: sideFacing(outwardBearing),
    };
  });
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function centroid(vertices: [number, number][]): [number, number] {
  const lat = vertices.reduce((s, p) => s + p[0], 0) / vertices.length;
  const lng = vertices.reduce((s, p) => s + p[1], 0) / vertices.length;
  return [lat, lng];
}

/**
 * Grid rotation that runs the flight lines along the longest wall, so a
 * long building is flown with as few turns as possible.
 */
function rotationAlong(
  boundary: [number, number][],
  outline: [number, number][],
): number {
  const walls = footprintWalls(outline);
  if (walls.length === 0) return 0;
  const longest = walls.reduce((a, b) => (b.lengthM > a.lengthM ? b : a));
  // Line direction in the grid's convention: degrees counter-clockwise from east
  const theta = 90 - bearing(...longest.start, ...longest.end);
  const local = toLocal(boundary, boundary[0]);
  const xs = local.map((p) => p[0]);
  const ys = local.map((p) => p[1]);
  const wide =
    Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  const rotation = (wide ? 0 : 90) - theta;
  return round1((((rotation % 180) + 180) % 180) % 360);
}

export interface CaptureRequest {
  planId: string;
  objective: CaptureObjective;
  /** The building to capture. */
  feature: SiteFeature;
  /** Every site feature in the mission: lot outlines and other buildings. */
  siteFeatures: SiteFeature[];
  obstacles: Obstacle[];
  settings: CaptureSettings;
  camera: CameraModel;
  /** False when the camera is a stand-in for the selected payload. */
  cameraExact: boolean;
  config: MissionConfig;
}

export interface CompiledRoute {
  name: string;
  kind: string;
  input: PlanInput;
  targetFeatureId?: string;
  capture: RouteCapture;
  result: TemplateResult;
}

export interface CompiledElement {
  element: CaptureElement;
  label: string;
  /** `planned` has a route; `missing` needs something from the operator; `none` does not apply to this building. */
  status: "planned" | "missing" | "none";
  note?: string;
  route?: CompiledRoute;
  timeS: number;
  photos: number;
  waypoints: number;
}

export interface CaptureIssue {
  element: CaptureElement;
  message: string;
  /** True when the route runs into something, not just close to it. */
  conflict: boolean;
}

export interface CompiledCapture {
  planId: string;
  objective: CaptureObjective;
  featureId: string;
  lotId?: string;
  settings: CaptureSettings;
  elements: CompiledElement[];
  assumptions: string[];
  issues: CaptureIssue[];
  groundFollowUp: string[];
  totals: {
    routes: number;
    timeS: number;
    photos: number;
    waypoints: number;
    batteries: number;
  };
}

/** Lot outline the building stands in, for site context photos. */
export function lotAround(
  feature: SiteFeature,
  siteFeatures: SiteFeature[],
): SiteFeature | undefined {
  if (feature.vertices.length < 3) return undefined;
  const middle = centroid(feature.vertices);
  return siteFeatures.find(
    (f) =>
      f.id !== feature.id &&
      f.kind === "lot" &&
      f.vertices.length >= 3 &&
      pointInPolygon(middle, f.vertices),
  );
}

/** Indexed waypoints for estimates and checks. */
function indexed(result: TemplateResult): Waypoint[] {
  return result.waypoints.map((wp, i) => ({
    ...wp,
    index: i,
    name: `Waypoint ${i + 1}`,
  }));
}

/** Standoff a capture route is checked against: its own distance where it has one. */
function elementStandoffM(
  element: CompiledElement,
  settings: CaptureSettings,
): number {
  const generator = element.route?.input.generator;
  if (generator === "walls") return settings.facadeStandoffM * 0.9;
  if (generator === "boundaryFacade") return settings.obliqueOffsetM * 0.9;
  return DEFAULT_STANDOFF_M;
}

/**
 * Check the whole flight, routes in order and the legs between them, against
 * every obstacle and building drawn. Each problem is reported once per route
 * and obstacle.
 */
function checkFlight(
  elements: CompiledElement[],
  obstacles: Obstacle[],
  settings: CaptureSettings,
  config: MissionConfig,
): CaptureIssue[] {
  const owner: CompiledElement[] = [];
  const flight: Waypoint[] = [];
  for (const element of elements) {
    for (const wp of element.route?.result.waypoints ?? []) {
      owner.push(element);
      flight.push({ ...wp, index: flight.length, name: "" });
    }
  }
  if (flight.length === 0) return [];
  const names = new Map(obstacles.map((o) => [o.id, o.name]));
  const warnings = getObstacleWarnings(flight, obstacles, {
    compareHeights: config.heightMode !== "EGM96",
    standoffFor: (i) => elementStandoffM(owner[i], settings),
  });

  const issues: CaptureIssue[] = [];
  // One issue per route and obstacle: a conflict wins, else the closest pass
  const worst = new Map<string, { warning: (typeof warnings)[number] }>();
  for (const w of warnings) {
    if (w.type === "passesOver") continue;
    const key = `${owner[w.waypointIndex].element}|${w.obstacleId}`;
    const known = worst.get(key)?.warning;
    const rank = (x: typeof w) =>
      isObstacleConflict(x) ? -1 : (x.distanceM ?? Infinity);
    if (!known || rank(w) < rank(known)) worst.set(key, { warning: w });
  }
  for (const { warning: w } of worst.values()) {
    const element = owner[w.waypointIndex];
    const obstacle = names.get(w.obstacleId) ?? "an obstacle";
    issues.push({
      element: element.element,
      conflict: isObstacleConflict(w),
      message: isObstacleConflict(w)
        ? `${element.label} runs into ${obstacle}.`
        : `${element.label} comes within ${(w.distanceM ?? 0).toFixed(1)} m of ${obstacle}.`,
    });
  }

  for (const element of elements) {
    const wps = element.route?.result.waypoints ?? [];
    if (wps.length === 0) continue;
    const highest = Math.max(...wps.map((wp) => wp.height));
    if (highest > MAX_ALTITUDE_M) {
      issues.push({
        element: element.element,
        conflict: false,
        message: `${element.label} flies ${Math.round(highest)} m above take-off, over the 400 ft (122 m) limit.`,
      });
    }
  }
  return issues;
}

/** Build the capture plan for one building. Same request, same plan. */
export function compileCapturePlan(request: CaptureRequest): CompiledCapture {
  const { feature, settings, camera, objective } = request;
  const height = feature.heightM ?? settings.assumedHeightM;
  const lot = lotAround(feature, request.siteFeatures);
  const capture = (element: CaptureElement): RouteCapture => ({
    planId: request.planId,
    objective,
    element,
    featureId: feature.id,
    ...(lot ? { lotId: lot.id } : {}),
    settings,
  });
  const routeName = (element: CaptureElement) =>
    `${ELEMENT_LABELS[element]} (${feature.name})`;

  const walls = footprintWalls(feature.vertices);
  const shortWalls = walls.filter((w) => w.lengthM < MIN_WALL_M).length;

  const planFor = (
    element: CaptureElement,
  ):
    | { input: PlanInput; kind: string; targetFeatureId?: string }
    | { status: "missing" | "none"; note: string } => {
    if (element === "site_context") {
      if (!lot) {
        return {
          status: "missing",
          note: "No lot outline around this building. Draw a lot site feature to plan site photos.",
        };
      }
      const params: GridParams = {
        ...DEFAULT_GRID_PARAMS,
        ...boundaryCorners(lot.vertices),
        boundary: lot.vertices,
        altitude: settings.siteAltitudeM,
        sideOverlap: MAP_OVERLAP,
        forwardOverlap: MAP_OVERLAP,
        rotationDeg: rotationAlong(lot.vertices, lot.vertices),
        camera,
      };
      return { input: { generator: "grid", params }, kind: "grid" };
    }
    if (element === "roof_nadir") {
      // Photos reach past the eaves: half a line spacing outside the outline
      const { lineSpacingM } = spacingFromOverlap(
        settings.roofClearanceM,
        MAP_OVERLAP,
        MAP_OVERLAP,
        camera,
      );
      const boundary = offsetPolygon(feature.vertices, lineSpacingM / 2).ring;
      const params: GridParams = {
        ...DEFAULT_GRID_PARAMS,
        ...boundaryCorners(boundary),
        boundary,
        altitude: round1(height + settings.roofClearanceM),
        surfaceHeightM: round1(height),
        sideOverlap: MAP_OVERLAP,
        forwardOverlap: MAP_OVERLAP,
        rotationDeg: rotationAlong(boundary, feature.vertices),
        camera,
      };
      return { input: { generator: "grid", params }, kind: "grid" };
    }
    if (element === "roof_oblique") {
      const altitude = round1(height + settings.obliqueOffsetM);
      const params: PolygonFacadeParams = {
        boundary: "polygon",
        vertices: feature.vertices,
        standoffM: settings.obliqueOffsetM,
        minAltitude: altitude,
        maxAltitude: altitude,
        pattern: "horizontal",
        spacing: {
          mode: "overlap",
          horizontalOverlap: OBLIQUE_OVERLAP,
          verticalOverlap: OBLIQUE_OVERLAP,
          horizontalM: 1,
          verticalM: 1,
        },
        // Look down at the roof edge beside the drone
        aim: { mode: "structureHeight", height: round1(height) },
        camera,
      };
      return {
        input: { generator: "boundaryFacade", params },
        kind: "facade",
        targetFeatureId: feature.id,
      };
    }
    const sideWalls = walls.filter(
      (w) => w.side === element && w.lengthM >= MIN_WALL_M,
    );
    if (sideWalls.length === 0) {
      return {
        status: "none",
        note: `No wall of this building faces ${FACADE_DIRECTIONS[element]}.`,
      };
    }
    const facades: FacadeParams[] = sideWalls.map((w) =>
      withWallCoverage(
        {
          ...DEFAULT_FACADE_PARAMS,
          point1: w.start,
          point2: w.end,
          distanceM: settings.facadeStandoffM,
          minAltitude: 0,
          maxAltitude: round1(height + 0.5),
          camera,
          coverage: {
            auto: true,
            horizontalOverlap: FACADE_OVERLAP,
            verticalOverlap: FACADE_OVERLAP,
          },
        },
        camera,
      ),
    );
    return {
      input: {
        generator: "walls",
        params: {
          walls: facades,
          // Move between walls, and on to the next route, above the roof
          transitAltitude: round1(height + OBSTACLE_CLEARANCE_M + 1),
        },
      },
      kind: "facade",
    };
  };

  const checked = [
    ...request.obstacles,
    // The building's own outline, at the height the plan assumes for it
    ...siteFeaturesAsObstacles(request.siteFeatures).map((o) =>
      o.id === feature.id && o.height == null ? { ...o, height } : o,
    ),
  ];
  const issues: CaptureIssue[] = [];

  const elements: CompiledElement[] = OBJECTIVES[objective].elements.map(
    (element) => {
      const label = ELEMENT_LABELS[element];
      const plan = planFor(element);
      if (!("input" in plan)) {
        return { element, label, ...plan, timeS: 0, photos: 0, waypoints: 0 };
      }
      const result = runPlan(plan.input);
      if (result.waypoints.length === 0) {
        return {
          element,
          label,
          status: "missing",
          note: "The outline is too small or too irregular for this template.",
          timeS: 0,
          photos: 0,
          waypoints: 0,
        };
      }
      const stats = estimateMission(indexed(result), request.config);
      return {
        element,
        label,
        status: "planned",
        route: {
          name: routeName(element),
          kind: plan.kind,
          input: plan.input,
          ...(plan.targetFeatureId
            ? { targetFeatureId: plan.targetFeatureId }
            : {}),
          capture: capture(element),
          result,
        },
        timeS: stats.estimatedFlightTimeS,
        photos: stats.photoCount,
        waypoints: result.waypoints.length,
      };
    },
  );

  issues.push(...checkFlight(elements, checked, settings, request.config));

  const assumptions: string[] = [];
  if (feature.heightM == null) {
    assumptions.push(
      `${feature.name} has no height set, so ${settings.assumedHeightM} m is assumed, and set on the building when the routes are added. Correct it and update the plan if it is wrong.`,
    );
  }
  if (feature.source === "map") {
    assumptions.push(
      "The outline comes from map data. Check it against the satellite image before flying.",
    );
  } else if (feature.source === "proposal") {
    assumptions.push(
      "The outline was traced by an AI proposal. Check it against the satellite image before flying.",
    );
  }
  assumptions.push(
    "Altitudes are above the take-off point: take off at ground level near the building.",
  );
  if (!request.cameraExact) {
    assumptions.push(
      "Photo spacing uses the Mavic 3E wide camera as a stand-in for the selected payload.",
    );
  }
  if (shortWalls > 0) {
    assumptions.push(
      `${shortWalls} wall${shortWalls > 1 ? "s" : ""} shorter than ${MIN_WALL_M} m ${shortWalls > 1 ? "are" : "is"} not photographed on ${shortWalls > 1 ? "their" : "its"} own; the neighboring walls' photos may cover ${shortWalls > 1 ? "them" : "it"}.`,
    );
  }

  const planned = elements.filter((e) => e.status === "planned");
  const timeS = planned.reduce((s, e) => s + e.timeS, 0);
  const batteryS = request.config.maxBatteryMinutes * 60;
  return {
    planId: request.planId,
    objective,
    featureId: feature.id,
    ...(lot ? { lotId: lot.id } : {}),
    settings,
    elements,
    assumptions,
    issues,
    groundFollowUp: OBJECTIVES[objective].groundFollowUp,
    totals: {
      routes: planned.length,
      timeS,
      photos: planned.reduce((s, e) => s + e.photos, 0),
      waypoints: planned.reduce((s, e) => s + e.waypoints, 0),
      batteries: batteryS > 0 && timeS > 0 ? Math.ceil(timeS / batteryS) : 0,
    },
  };
}
