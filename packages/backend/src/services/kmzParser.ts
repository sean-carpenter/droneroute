import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type {
  Mission,
  Waypoint,
  MissionConfig,
  WaypointAction,
  PointOfInterest,
} from "@droneroute/shared";
import { DEFAULT_MISSION_CONFIG, DEFAULT_WAYPOINT } from "@droneroute/shared";
import { v4 as uuidv4 } from "uuid";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: false,
  // Uploaded files are untrusted: never expand DTD entities.
  processEntities: false,
  isArray: (name) => {
    return (
      name === "Placemark" ||
      name === "Folder" ||
      name === "wpml:actionGroup" ||
      name === "wpml:action"
    );
  },
});

/** Action types DroneRoute can edit and export. Others are dropped on import. */
const SUPPORTED_ACTIONS = new Set<string>([
  "takePhoto",
  "startRecord",
  "stopRecord",
  "gimbalRotate",
  "gimbalEvenlyRotate",
  "rotateYaw",
  "hover",
  "zoom",
  "focus",
]);

const BOOLEAN_PARAMS = new Set(["isPointFocus", "isInfiniteFocus"]);

/**
 * WPML action params arrive as `{ "wpml:hoverTime": 5 }`. The rest of the app
 * (and the exporter) uses the bare names, so strip the namespace prefix.
 */
function normalizeActionParams(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = key.replace(/^wpml:/, "");
    out[name] = BOOLEAN_PARAMS.has(name)
      ? value === 1 || value === "1" || value === true
      : value;
  }
  return out;
}

export interface ParsedMission {
  config: MissionConfig;
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  /** Things the user should know were changed or dropped during import. */
  warnings: string[];
}

function extractCoords(coordStr: string): {
  longitude: number;
  latitude: number;
} {
  const parts = coordStr.split(",").map((s) => parseFloat(s.trim()));
  return { longitude: parts[0], latitude: parts[1] };
}

interface ParsedActions {
  /** Actions executed on arrival at the waypoint. */
  actions: WaypointAction[];
  /** Capture triggers that span a range of waypoints. */
  intervals: {
    startIndex: number;
    endIndex: number;
    type: "multipleDistance" | "multipleTiming";
    param: number;
  }[];
  dropped: string[];
}

function parseActions(placemark: any, fallbackIndex: number): ParsedActions {
  const result: ParsedActions = { actions: [], intervals: [], dropped: [] };
  const groups = placemark["wpml:actionGroup"];
  if (!groups) return result;

  for (const group of groups) {
    const triggerType =
      group["wpml:actionTrigger"]?.["wpml:actionTriggerType"] ?? "reachPoint";
    const groupActions = group["wpml:action"] || [];

    if (
      triggerType === "multipleDistance" ||
      triggerType === "multipleTiming"
    ) {
      const param = parseFloat(
        group["wpml:actionTrigger"]?.["wpml:actionTriggerParam"],
      );
      const takesPhotos = groupActions.some(
        (a: any) => a["wpml:actionActuatorFunc"] === "takePhoto",
      );
      if (takesPhotos && Number.isFinite(param) && param > 0) {
        const start = parseInt(group["wpml:actionGroupStartIndex"]);
        const end = parseInt(group["wpml:actionGroupEndIndex"]);
        result.intervals.push({
          startIndex: Number.isFinite(start) ? start : fallbackIndex,
          endIndex: Number.isFinite(end) ? end : fallbackIndex + 1,
          type: triggerType,
          param,
        });
      }
      continue;
    }

    for (const action of groupActions) {
      const actionType = action["wpml:actionActuatorFunc"];
      if (!SUPPORTED_ACTIONS.has(actionType)) {
        if (actionType) result.dropped.push(String(actionType));
        continue;
      }
      result.actions.push({
        // Ids only need to be unique within one waypoint's action list
        actionId: result.actions.length,
        actionType,
        params: normalizeActionParams(
          action["wpml:actionActuatorFuncParam"],
        ) as any,
      });
    }
  }
  return result;
}

/** Placemarks of the first folder that actually contains waypoint points. */
function waypointFolder(doc: any): any | undefined {
  const folders: any[] = doc?.Folder ?? [];
  return (
    folders.find((f) => (f.Placemark ?? []).some((pm: any) => pm?.Point)) ??
    undefined
  );
}

/** True when the archive looks like a DJI WPML mission. */
export function isWpmlArchive(zip: JSZip): boolean {
  return [
    "template.kml",
    "wpmz/template.kml",
    "waylines.wpml",
    "wpmz/waylines.wpml",
  ].some((name) => zip.file(name));
}

export async function parseKmz(buffer: Buffer): Promise<ParsedMission> {
  return parseWpmlArchive(await JSZip.loadAsync(buffer));
}

export async function parseWpmlArchive(zip: JSZip): Promise<ParsedMission> {
  const warnings: string[] = [];

  // template.kml sits at the root or inside wpmz/ (DJI convention). Some
  // exports only carry waylines.wpml, which has the same mission config.
  const templateFile =
    zip.file("template.kml") || zip.file("wpmz/template.kml");
  const waylinesFile =
    zip.file("waylines.wpml") || zip.file("wpmz/waylines.wpml");
  if (!templateFile && !waylinesFile) {
    throw new Error("Invalid KMZ: missing template.kml");
  }

  const waylinesDoc = waylinesFile
    ? parser.parse(await waylinesFile.async("string"))?.kml?.Document
    : undefined;
  const doc =
    (templateFile
      ? parser.parse(await templateFile.async("string"))?.kml?.Document
      : undefined) ?? waylinesDoc;
  if (!doc) {
    throw new Error("Invalid KMZ: no mission document");
  }

  // Parse mission config
  const mc = doc["wpml:missionConfig"] || {};
  const droneInfo = mc["wpml:droneInfo"] || {};
  const payloadInfo = mc["wpml:payloadInfo"] || {};

  const config: MissionConfig = {
    ...DEFAULT_MISSION_CONFIG,
    droneEnumValue: parseInt(droneInfo["wpml:droneEnumValue"] || "67"),
    droneSubEnumValue: parseInt(droneInfo["wpml:droneSubEnumValue"] || "0"),
    payloadEnumValue: parseInt(payloadInfo["wpml:payloadEnumValue"] || "52"),
    flyToWaylineMode: mc["wpml:flyToWaylineMode"] || "safely",
    finishAction: mc["wpml:finishAction"] || "goHome",
    exitOnRCLost: mc["wpml:exitOnRCLost"] || "executeLostAction",
    executeRCLostAction: mc["wpml:executeRCLostAction"] || "goBack",
    takeOffSecurityHeight: parseFloat(mc["wpml:takeOffSecurityHeight"] || "20"),
    globalTransitionalSpeed: parseFloat(
      mc["wpml:globalTransitionalSpeed"] || "10",
    ),
  };

  // Determine which document contains the Folder with waypoints.
  // template.kml may have it, or — for mapping/area templates, whose
  // template only stores a polygon — it may only be in waylines.wpml.
  let folder = waypointFolder(doc);
  if (!folder && waylinesDoc) {
    folder = waypointFolder(waylinesDoc);
    if (folder && (doc.Folder ?? []).length > 0) {
      warnings.push(
        "This file is not a plain waypoint route; the flight lines DJI generated for it were imported as waypoints.",
      );
    }
  }
  if (waylinesDoc && (waylinesDoc.Folder ?? []).length > 1) {
    warnings.push(
      "The file contains several waylines; only the first one was imported.",
    );
  }

  if (folder) {
    config.autoFlightSpeed = parseFloat(folder["wpml:autoFlightSpeed"] || "7");
    config.gimbalPitchMode =
      folder["wpml:gimbalPitchMode"] || "usePointSetting";
    config.globalTurnMode =
      folder["wpml:globalWaypointTurnMode"] ||
      "toPointAndStopWithDiscontinuityCurvature";

    const headingParam = folder["wpml:globalWaypointHeadingParam"];
    if (headingParam) {
      config.globalHeadingMode =
        headingParam["wpml:waypointHeadingMode"] || "followWayline";
    }

    const coordSys = folder["wpml:waylineCoordinateSysParam"];
    if (coordSys?.["wpml:heightMode"]) {
      config.heightMode = coordSys["wpml:heightMode"];
    } else if (folder["wpml:executeHeightMode"]) {
      // Fallback: some DJI files use executeHeightMode at folder level
      config.heightMode = folder["wpml:executeHeightMode"];
    }
  }

  // Parse waypoints and collect POIs from waypointPoiPoint references
  const placemarks: any[] = (folder?.Placemark || []).filter(
    (pm: any) => pm?.Point?.coordinates != null,
  );
  const poiMap = new Map<string, PointOfInterest>(); // key: "lon,lat,height" -> POI
  const intervals: ParsedActions["intervals"] = [];
  const dropped = new Set<string>();

  const parsedWaypoints: Waypoint[] = placemarks.map((pm: any, i: number) => {
    const coords = extractCoords(String(pm.Point.coordinates));
    const wpIndex = pm["wpml:index"] != null ? parseInt(pm["wpml:index"]) : i;
    const parsedActions = parseActions(pm, wpIndex);
    const actions = parsedActions.actions;
    intervals.push(...parsedActions.intervals);
    for (const name of parsedActions.dropped) dropped.add(name);

    // Check for per-waypoint heading params with POI
    const headingParam = pm["wpml:waypointHeadingParam"];
    let headingMode: string | undefined;
    let headingAngle: number | undefined;
    let poiId: string | undefined;

    if (headingParam) {
      headingMode = headingParam["wpml:waypointHeadingMode"];
      headingAngle =
        headingParam["wpml:waypointHeadingAngle"] != null
          ? parseFloat(headingParam["wpml:waypointHeadingAngle"])
          : undefined;
      const poiPoint = headingParam["wpml:waypointPoiPoint"];
      if (headingMode === "towardPOI" && poiPoint) {
        const poiKey = String(poiPoint);
        if (!poiMap.has(poiKey)) {
          const parts = poiKey.split(",").map((s) => parseFloat(s.trim()));
          const poi: PointOfInterest = {
            id: uuidv4(),
            name: `POI ${poiMap.size + 1}`,
            latitude: parts[0],
            longitude: parts[1],
            height: Math.round(parts[2] || 0),
          };
          poiMap.set(poiKey, poi);
        }
        poiId = poiMap.get(poiKey)!.id;
      }
    }

    // Parse turn mode and damping distance
    const turnParam = pm["wpml:waypointTurnParam"];
    const turnMode = turnParam?.["wpml:waypointTurnMode"];
    const turnDampingDist =
      turnParam?.["wpml:waypointTurnDampingDist"] != null
        ? parseFloat(turnParam["wpml:waypointTurnDampingDist"])
        : undefined;

    // Height: try wpml:executeHeight (waylines.wpml), wpml:height, wpml:ellipsoidHeight
    const height = Math.round(
      parseFloat(
        pm["wpml:executeHeight"] ||
          pm["wpml:height"] ||
          pm["wpml:ellipsoidHeight"] ||
          "50",
      ),
    );

    // Gimbal pitch: try direct field or extract from gimbalRotate action
    let gimbalPitchAngle =
      pm["wpml:gimbalPitchAngle"] != null
        ? parseFloat(pm["wpml:gimbalPitchAngle"])
        : undefined;
    if (gimbalPitchAngle == null) {
      // Look for a gimbalRotate action with pitch angle
      const gimbalAction = actions.find((a) => a.actionType === "gimbalRotate");
      const gimbalParams = gimbalAction?.params as any;
      if (gimbalParams?.gimbalPitchRotateAngle != null) {
        gimbalPitchAngle = parseFloat(gimbalParams.gimbalPitchRotateAngle);
      }
    }

    return {
      ...DEFAULT_WAYPOINT,
      index: wpIndex,
      name: `Waypoint ${wpIndex + 1}`,
      latitude: coords.latitude,
      longitude: coords.longitude,
      height,
      speed: parseFloat(
        pm["wpml:waypointSpeed"] || String(config.autoFlightSpeed),
      ),
      useGlobalSpeed:
        pm["wpml:useGlobalSpeed"] === "1" || pm["wpml:useGlobalSpeed"] === 1,
      useGlobalHeight:
        pm["wpml:useGlobalHeight"] === "1" || pm["wpml:useGlobalHeight"] === 1,
      useGlobalHeadingParam:
        pm["wpml:useGlobalHeadingParam"] === "1" ||
        pm["wpml:useGlobalHeadingParam"] === 1,
      useGlobalTurnParam:
        pm["wpml:useGlobalTurnParam"] === "1" ||
        pm["wpml:useGlobalTurnParam"] === 1,
      gimbalPitchAngle: gimbalPitchAngle ?? DEFAULT_WAYPOINT.gimbalPitchAngle,
      headingMode: headingMode as any,
      headingAngle,
      turnMode: turnMode as any,
      turnDampingDist,
      poiId,
      actions,
    };
  });

  // The editor addresses waypoints by array position, so order them by
  // their file index and renumber from zero.
  const fileIndexToPos = new Map<number, number>();
  const waypoints = [...parsedWaypoints]
    .sort((a, b) => a.index - b.index)
    .map((wp, pos) => {
      fileIndexToPos.set(wp.index, pos);
      return { ...wp, index: pos, name: `Waypoint ${pos + 1}` };
    });

  // Interval capture groups cover a range of waypoints: mark every leg in it.
  let convertedTiming = false;
  for (const interval of intervals) {
    const start = fileIndexToPos.get(interval.startIndex);
    if (start === undefined) continue;
    const end = fileIndexToPos.get(interval.endIndex) ?? start + 1;
    for (let pos = start; pos < Math.max(end, start + 1); pos++) {
      const wp = waypoints[pos];
      if (!wp || pos >= waypoints.length - 1) continue;
      if (interval.type === "multipleDistance") {
        wp.photoIntervalM = interval.param;
      } else {
        // Time trigger: express it as the distance flown in that time
        const speed = wp.useGlobalSpeed ? config.autoFlightSpeed : wp.speed;
        wp.photoIntervalM = Math.round(interval.param * speed * 10) / 10;
        convertedTiming = true;
      }
    }
  }
  if (convertedTiming) {
    warnings.push(
      "Timed interval shooting was converted to distance intervals using each leg's speed.",
    );
  }
  if (dropped.size > 0) {
    warnings.push(
      `Unsupported actions were skipped: ${[...dropped].join(", ")}.`,
    );
  }
  if (waypoints.length === 0) {
    warnings.push("No waypoints were found in the file.");
  }

  const pois = Array.from(poiMap.values());

  return { config, waypoints, pois, warnings };
}
