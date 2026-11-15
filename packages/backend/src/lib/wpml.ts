import type {
  Mission,
  MissionConfig,
  Waypoint,
  WaypointAction,
  PointOfInterest,
} from "@droneroute/shared";

// ── XML Helpers ──────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Compute bearing (degrees, 0=N, CW) from point A to point B */
function computeBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360;
}

function findPoi(
  pois: PointOfInterest[],
  id?: string,
): PointOfInterest | undefined {
  if (!id) return undefined;
  return pois.find((p) => p.id === id);
}

// ── DJI WPML rules ───────────────────────────────────────
// Checked against DJI's WPML reference (dji-sdk/Cloud-API-Doc, template.kml,
// waylines.wpml and common elements). See NOTES.md in the parent project.

/**
 * Height modes to write. waylines.wpml only allows WGS84 (ellipsoid) or
 * relativeToStartPoint, and DJI Pilot 2 cannot open "aboveGroundLevel"
 * templates, so above-ground heights are written relative to the take-off
 * point: the same numbers, correct when the drone takes off from ground level
 * with the site. EGM96 heights cannot be turned into ellipsoid heights
 * without geoid data, so those keep their template mode and no execute mode.
 */
export function exportHeightModes(config: MissionConfig): {
  template: string;
  execute: "relativeToStartPoint" | null;
} {
  if (config.heightMode === "EGM96")
    return { template: "EGM96", execute: null };
  return { template: "relativeToStartPoint", execute: "relativeToStartPoint" };
}

/** DJI wants yaw angles in [-180, 180]. */
export function normalizeHeading(degrees: number): number {
  const d = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return d === -180 && degrees > 0 ? 180 : d;
}

/** Lenses to store photos from, by camera. DJI requires this for the payload. */
function imageFormat(payloadEnumValue: number): string {
  if ([43, 53, 67, 81, 83].includes(payloadEnumValue)) return "wide,ir";
  if (payloadEnumValue === 68) return "visible";
  return "wide";
}

const CURVED_TURNS = new Set([
  "toPointAndStopWithContinuityCurvature",
  "toPointAndPassWithContinuityCurvature",
]);

/**
 * Straight-line flag. DJI's own exports write it on every waypoint: 1 for
 * straight legs, 0 for the curved turn modes.
 */
function straightLineXml(turnMode: string, indent: string): string {
  return `\n${indent}<wpml:useStraightLine>${CURVED_TURNS.has(turnMode) ? 0 : 1}</wpml:useStraightLine>`;
}

/** Route length (m) and flying time (s) between waypoints, as DJI's files carry. */
export function routeDistanceAndDuration(mission: Mission): {
  distance: number;
  duration: number;
} {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  let distance = 0;
  let duration = 0;
  const wps = mission.waypoints;
  for (let i = 1; i < wps.length; i++) {
    const a = wps[i - 1];
    const b = wps[i];
    const dLat = rad(b.latitude - a.latitude);
    const dLon = rad(b.longitude - a.longitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.latitude)) *
        Math.cos(rad(b.latitude)) *
        Math.sin(dLon / 2) ** 2;
    const flat = 2 * R * Math.asin(Math.sqrt(h));
    const leg = Math.hypot(flat, b.height - a.height);
    const speed = a.useGlobalSpeed ? mission.config.autoFlightSpeed : a.speed;
    distance += leg;
    if (speed > 0) duration += leg / speed;
  }
  return {
    distance: Math.round(distance * 100) / 100,
    duration: Math.round(duration * 100) / 100,
  };
}

/** Heading block fields DJI's own exports always include. */
function headingExtrasXml(
  poi: { latitude: number; longitude: number; height: number } | undefined,
  indent: string,
): string {
  const point = poi
    ? `${poi.latitude},${poi.longitude},${poi.height}`
    : "0.000000,0.000000,0.000000";
  return `\n${indent}<wpml:waypointPoiPoint>${point}</wpml:waypointPoiPoint>`;
}

/**
 * The WPML reference take-off point: `latitude,longitude,altitude`, followed
 * by its height above ground. Empty when the mission has no drone home point.
 */
function buildTakeOffRefXml(config: MissionConfig): string {
  const point = config.takeoff;
  if (!point) return "";
  return `
    <wpml:takeOffRefPoint>${point.latitude},${point.longitude},${point.elevationM ?? 0}</wpml:takeOffRefPoint>
    <wpml:takeOffRefPointAGLHeight>0</wpml:takeOffRefPointAGLHeight>`;
}

// ── Action XML ───────────────────────────────────────────

function buildActionXml(action: WaypointAction): string {
  let paramsXml = "";

  switch (action.actionType) {
    case "takePhoto":
      paramsXml = `
              <wpml:payloadPositionIndex>${(action.params as any).payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>
              <wpml:fileSuffix>${escapeXml((action.params as any).fileSuffix || "")}</wpml:fileSuffix>
              <wpml:useGlobalPayloadLensIndex>1</wpml:useGlobalPayloadLensIndex>`;
      break;
    case "startRecord":
      paramsXml = `
              <wpml:payloadPositionIndex>${(action.params as any).payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>
              <wpml:fileSuffix>${escapeXml((action.params as any).fileSuffix || "")}</wpml:fileSuffix>
              <wpml:useGlobalPayloadLensIndex>1</wpml:useGlobalPayloadLensIndex>`;
      break;
    case "stopRecord":
      paramsXml = `
              <wpml:payloadPositionIndex>${(action.params as any).payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>`;
      break;
    case "gimbalRotate": {
      const p = action.params as any;
      paramsXml = `
              <wpml:gimbalHeadingYawBase>north</wpml:gimbalHeadingYawBase>
              <wpml:gimbalRotateMode>${p.gimbalRotateMode || "absoluteAngle"}</wpml:gimbalRotateMode>
              <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>
              <wpml:gimbalPitchRotateAngle>${p.gimbalPitchRotateAngle ?? 0}</wpml:gimbalPitchRotateAngle>
              <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable>
              <wpml:gimbalRollRotateAngle>${p.gimbalRollRotateAngle ?? 0}</wpml:gimbalRollRotateAngle>
              <wpml:gimbalYawRotateEnable>1</wpml:gimbalYawRotateEnable>
              <wpml:gimbalYawRotateAngle>${p.gimbalYawRotateAngle ?? 0}</wpml:gimbalYawRotateAngle>
              <wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable>
              <wpml:gimbalRotateTime>0</wpml:gimbalRotateTime>
              <wpml:payloadPositionIndex>${p.payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>`;
      break;
    }
    case "gimbalEvenlyRotate": {
      const p = action.params as any;
      paramsXml = `
              <wpml:gimbalPitchRotateAngle>${p.gimbalPitchRotateAngle ?? -45}</wpml:gimbalPitchRotateAngle>
              <wpml:payloadPositionIndex>${p.payloadPositionIndex ?? 0}</wpml:payloadPositionIndex>`;
      break;
    }
    case "rotateYaw": {
      const p = action.params as any;
      paramsXml = `
              <wpml:aircraftHeading>${p.aircraftHeading ?? 0}</wpml:aircraftHeading>
              <wpml:aircraftPathMode>${p.aircraftPathMode || "clockwise"}</wpml:aircraftPathMode>`;
      break;
    }
    case "hover":
      paramsXml = `
              <wpml:hoverTime>${(action.params as any).hoverTime ?? 5}</wpml:hoverTime>`;
      break;
    case "zoom":
      paramsXml = `
              <wpml:focalLength>${(action.params as any).focalLength ?? 24}</wpml:focalLength>`;
      break;
    case "focus": {
      const p = action.params as any;
      paramsXml = `
              <wpml:isPointFocus>${p.isPointFocus ? 1 : 0}</wpml:isPointFocus>
              <wpml:focusX>${p.focusX ?? 0.5}</wpml:focusX>
              <wpml:focusY>${p.focusY ?? 0.5}</wpml:focusY>
              <wpml:isInfiniteFocus>${p.isInfiniteFocus ? 1 : 0}</wpml:isInfiniteFocus>`;
      break;
    }
  }

  return `
          <wpml:action>
            <wpml:actionId>${action.actionId}</wpml:actionId>
            <wpml:actionActuatorFunc>${action.actionType}</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>${paramsXml}
            </wpml:actionActuatorFuncParam>
          </wpml:action>`;
}

function buildActionGroupXml(
  wp: Waypoint,
  groupIdOffset: number,
  waypointCount: number,
): string {
  let xml = "";

  if (wp.actions.length > 0) {
    const actionsXml = wp.actions.map(buildActionXml).join("");
    xml += `
        <wpml:actionGroup>
          <wpml:actionGroupId>${groupIdOffset}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${wp.index}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${wp.index}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
          </wpml:actionTrigger>${actionsXml}
        </wpml:actionGroup>`;
  }

  // Distance-interval capture on the leg from this waypoint to the next.
  // Group ids must be unique within the file, so these start after the
  // per-waypoint ids.
  const interval = Number(wp.photoIntervalM);
  if (
    Number.isFinite(interval) &&
    interval > 0 &&
    wp.index < waypointCount - 1
  ) {
    xml += `
        <wpml:actionGroup>
          <wpml:actionGroupId>${waypointCount + groupIdOffset}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${wp.index}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${wp.index + 1}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>multipleDistance</wpml:actionTriggerType>
            <wpml:actionTriggerParam>${interval}</wpml:actionTriggerParam>
          </wpml:actionTrigger>${buildActionXml({
            actionId: 0,
            actionType: "takePhoto",
            params: { payloadPositionIndex: 0 },
          })}
        </wpml:actionGroup>`;
  }

  return xml;
}

// ── Template KML ─────────────────────────────────────────

export function buildTemplateKml(mission: Mission): string {
  const c = mission.config;
  const pois = mission.pois || [];
  const now = Date.now();

  const placemarks = mission.waypoints
    .map((wp, i) => {
      const actionGroupXml = buildActionGroupXml(
        wp,
        i,
        mission.waypoints.length,
      );

      // DJI requires these whenever the waypoint does not use the global ones.
      let headingOverrideXml = "";
      if (!wp.useGlobalHeadingParam) {
        const mode = wp.headingMode || c.globalHeadingMode;
        const poi = mode === "towardPOI" ? findPoi(pois, wp.poiId) : undefined;
        const angle =
          poi !== undefined
            ? computeBearing(
                wp.latitude,
                wp.longitude,
                poi.latitude,
                poi.longitude,
              )
            : (wp.headingAngle ?? 0);
        headingOverrideXml = `
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>${poi || mode !== "towardPOI" ? mode : "followWayline"}</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>${normalizeHeading(angle)}</wpml:waypointHeadingAngle>${headingExtrasXml(poi, "          ")}
          <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
          <wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>
        </wpml:waypointHeadingParam>`;
      }
      const turnMode = wp.useGlobalTurnParam
        ? c.globalTurnMode
        : wp.turnMode || c.globalTurnMode;
      let turnOverrideXml = "";
      if (!wp.useGlobalTurnParam) {
        turnOverrideXml = `
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>${turnMode}</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>${wp.turnDampingDist ?? 0}</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>`;
      }

      return `
      <Placemark>
        <Point>
          <coordinates>${wp.longitude},${wp.latitude}</coordinates>
        </Point>
        <wpml:index>${wp.index}</wpml:index>
        <wpml:ellipsoidHeight>${wp.height}</wpml:ellipsoidHeight>
        <wpml:height>${wp.height}</wpml:height>
        <wpml:useGlobalHeight>${wp.useGlobalHeight ? 1 : 0}</wpml:useGlobalHeight>
        <wpml:useGlobalSpeed>${wp.useGlobalSpeed ? 1 : 0}</wpml:useGlobalSpeed>
        ${!wp.useGlobalSpeed ? `<wpml:waypointSpeed>${wp.speed}</wpml:waypointSpeed>` : ""}
        <wpml:useGlobalHeadingParam>${wp.useGlobalHeadingParam ? 1 : 0}</wpml:useGlobalHeadingParam>
        <wpml:useGlobalTurnParam>${wp.useGlobalTurnParam ? 1 : 0}</wpml:useGlobalTurnParam>
        <wpml:gimbalPitchAngle>${wp.gimbalPitchAngle}</wpml:gimbalPitchAngle>${headingOverrideXml}${turnOverrideXml}${straightLineXml(turnMode, "        ")}${actionGroupXml}
        <wpml:isRisky>0</wpml:isRisky>
      </Placemark>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:wpml="http://www.dji.com/wpmz/1.0.6">
<Document>
  <wpml:createTime>${now}</wpml:createTime>
  <wpml:updateTime>${now}</wpml:updateTime>
  <wpml:missionConfig>
    <wpml:flyToWaylineMode>${c.flyToWaylineMode}</wpml:flyToWaylineMode>
    <wpml:finishAction>${c.finishAction}</wpml:finishAction>
    <wpml:exitOnRCLost>${c.exitOnRCLost}</wpml:exitOnRCLost>
    <wpml:executeRCLostAction>${c.executeRCLostAction}</wpml:executeRCLostAction>
    <wpml:takeOffSecurityHeight>${c.takeOffSecurityHeight}</wpml:takeOffSecurityHeight>${buildTakeOffRefXml(c)}
    <wpml:globalTransitionalSpeed>${c.globalTransitionalSpeed}</wpml:globalTransitionalSpeed>
    <wpml:droneInfo>
      <wpml:droneEnumValue>${c.droneEnumValue}</wpml:droneEnumValue>
      <wpml:droneSubEnumValue>${c.droneSubEnumValue}</wpml:droneSubEnumValue>
    </wpml:droneInfo>
    <wpml:payloadInfo>
      <wpml:payloadEnumValue>${c.payloadEnumValue}</wpml:payloadEnumValue>
      <wpml:payloadSubEnumValue>0</wpml:payloadSubEnumValue>
      <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
    </wpml:payloadInfo>
  </wpml:missionConfig>
  <Folder>
    <wpml:templateType>waypoint</wpml:templateType>
    <wpml:templateId>0</wpml:templateId>
    <wpml:waylineCoordinateSysParam>
      <wpml:coordinateMode>WGS84</wpml:coordinateMode>
      <wpml:heightMode>${exportHeightModes(c).template}</wpml:heightMode>
      <wpml:positioningType>GPS</wpml:positioningType>
    </wpml:waylineCoordinateSysParam>
    <wpml:autoFlightSpeed>${c.autoFlightSpeed}</wpml:autoFlightSpeed>
    <wpml:globalHeight>${mission.waypoints[0]?.height ?? c.takeOffSecurityHeight}</wpml:globalHeight>
    <wpml:caliFlightEnable>0</wpml:caliFlightEnable>
    <wpml:gimbalPitchMode>${c.gimbalPitchMode}</wpml:gimbalPitchMode>
    <wpml:globalWaypointHeadingParam>
      <wpml:waypointHeadingMode>${c.globalHeadingMode}</wpml:waypointHeadingMode>
      <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>
      <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>
      <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
      <wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>
    </wpml:globalWaypointHeadingParam>
    <wpml:globalWaypointTurnMode>${c.globalTurnMode}</wpml:globalWaypointTurnMode>
    <wpml:globalUseStraightLine>${CURVED_TURNS.has(c.globalTurnMode) ? 0 : 1}</wpml:globalUseStraightLine>${placemarks}
    <wpml:payloadParam>
      <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
      <wpml:imageFormat>${imageFormat(c.payloadEnumValue)}</wpml:imageFormat>
    </wpml:payloadParam>
  </Folder>
</Document>
</kml>`;
}

// ── Waylines WPML ────────────────────────────────────────

export function buildWaylinesWpml(mission: Mission): string {
  const c = mission.config;
  const { execute } = exportHeightModes(c);
  const route = routeDistanceAndDuration(mission);
  const pois = mission.pois || [];

  const placemarks = mission.waypoints
    .map((wp, i) => {
      const actionGroupXml = buildActionGroupXml(
        wp,
        i,
        mission.waypoints.length,
      );
      const headingMode = wp.useGlobalHeadingParam
        ? c.globalHeadingMode
        : wp.headingMode || c.globalHeadingMode;
      const turnMode = wp.useGlobalTurnParam
        ? c.globalTurnMode
        : wp.turnMode || c.globalTurnMode;
      const speed = wp.useGlobalSpeed ? c.autoFlightSpeed : wp.speed;

      // POI pointing: compute bearing or emit POI coordinates
      let headingAngle = wp.headingAngle ?? 0;
      const poi =
        headingMode === "towardPOI" ? findPoi(pois, wp.poiId) : undefined;
      if (poi) {
        headingAngle = computeBearing(
          wp.latitude,
          wp.longitude,
          poi.latitude,
          poi.longitude,
        );
      }
      const angleEnabled =
        headingMode === "fixed" || headingMode === "smoothTransition" ? 1 : 0;

      return `
      <Placemark>
        <Point>
          <coordinates>${wp.longitude},${wp.latitude}</coordinates>
        </Point>
        <wpml:index>${wp.index}</wpml:index>
        <wpml:executeHeight>${wp.height}</wpml:executeHeight>
        <wpml:waypointSpeed>${speed}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>${headingMode}</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>${normalizeHeading(headingAngle)}</wpml:waypointHeadingAngle>${headingExtrasXml(poi, "          ")}
          <wpml:waypointHeadingAngleEnable>${angleEnabled}</wpml:waypointHeadingAngleEnable>
          <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
          <wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>
        </wpml:waypointHeadingParam>
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>${turnMode}</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>${wp.turnDampingDist ?? 0}</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>${straightLineXml(turnMode, "        ")}
        <wpml:gimbalPitchAngle>${wp.gimbalPitchAngle}</wpml:gimbalPitchAngle>${actionGroupXml}
        <wpml:waypointGimbalHeadingParam>
          <wpml:waypointGimbalPitchAngle>${wp.gimbalPitchAngle}</wpml:waypointGimbalPitchAngle>
          <wpml:waypointGimbalYawAngle>0</wpml:waypointGimbalYawAngle>
        </wpml:waypointGimbalHeadingParam>
        <wpml:isRisky>0</wpml:isRisky>
        <wpml:waypointWorkType>0</wpml:waypointWorkType>
      </Placemark>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:wpml="http://www.dji.com/wpmz/1.0.6">
<Document>
  <wpml:missionConfig>
    <wpml:flyToWaylineMode>${c.flyToWaylineMode}</wpml:flyToWaylineMode>
    <wpml:finishAction>${c.finishAction}</wpml:finishAction>
    <wpml:exitOnRCLost>${c.exitOnRCLost}</wpml:exitOnRCLost>
    <wpml:executeRCLostAction>${c.executeRCLostAction}</wpml:executeRCLostAction>
    <wpml:takeOffSecurityHeight>${c.takeOffSecurityHeight}</wpml:takeOffSecurityHeight>${buildTakeOffRefXml(c)}
    <wpml:globalTransitionalSpeed>${c.globalTransitionalSpeed}</wpml:globalTransitionalSpeed>
    <wpml:droneInfo>
      <wpml:droneEnumValue>${c.droneEnumValue}</wpml:droneEnumValue>
      <wpml:droneSubEnumValue>${c.droneSubEnumValue}</wpml:droneSubEnumValue>
    </wpml:droneInfo>
    <wpml:payloadInfo>
      <wpml:payloadEnumValue>${c.payloadEnumValue}</wpml:payloadEnumValue>
      <wpml:payloadSubEnumValue>0</wpml:payloadSubEnumValue>
      <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
    </wpml:payloadInfo>
  </wpml:missionConfig>
  <Folder>
    <wpml:templateId>0</wpml:templateId>${
      execute
        ? `
    <wpml:executeHeightMode>${execute}</wpml:executeHeightMode>`
        : ""
    }
    <wpml:waylineId>0</wpml:waylineId>
    <wpml:distance>${route.distance}</wpml:distance>
    <wpml:duration>${route.duration}</wpml:duration>
    <wpml:autoFlightSpeed>${c.autoFlightSpeed}</wpml:autoFlightSpeed>${
      execute
        ? ""
        : `
    <wpml:waylineCoordinateSysParam>
      <wpml:coordinateMode>WGS84</wpml:coordinateMode>
      <wpml:heightMode>${c.heightMode}</wpml:heightMode>
    </wpml:waylineCoordinateSysParam>`
    }${placemarks}
  </Folder>
</Document>
</kml>`;
}
