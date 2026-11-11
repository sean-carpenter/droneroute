/**
 * Flight preview: where the aircraft is, where it points and what it has done
 * at any moment of the estimated mission timeline. Pure functions.
 */
import type {
  MissionConfig,
  PointOfInterest,
  Waypoint,
  WaypointAction,
} from "@droneroute/shared";
import type { MissionStats } from "./missionStats";

export interface SimulationSample {
  latitude: number;
  longitude: number;
  height: number;
  /** Aircraft heading in degrees, 0 = north, clockwise. */
  headingDeg: number;
  gimbalPitchDeg: number;
  /** Array position of the last waypoint reached. */
  waypointPos: number;
  /** 0–1 progress along the leg leaving `waypointPos` (0 while stopped). */
  legProgress: number;
  phase: "stopped" | "flying" | "finished";
  elapsedS: number;
  remainingS: number;
  remainingDistanceM: number;
  photosTaken: number;
  /** What happens next, e.g. "Take photo at WP 4". */
  nextAction: string | null;
}

const ACTION_LABELS: Record<WaypointAction["actionType"], string> = {
  takePhoto: "Take photo",
  startRecord: "Start recording",
  stopRecord: "Stop recording",
  gimbalRotate: "Rotate gimbal",
  gimbalEvenlyRotate: "Tilt gimbal smoothly",
  rotateYaw: "Rotate aircraft",
  hover: "Hover",
  zoom: "Zoom",
  focus: "Focus",
};

function bearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const rad = Math.PI / 180;
  const dLng = (lng2 - lng1) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2 * rad);
  const x =
    Math.cos(lat1 * rad) * Math.sin(lat2 * rad) -
    Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
  return (((Math.atan2(y, x) / rad) % 360) + 360) % 360;
}

/** Interpolate between two angles along the shortest arc. */
function lerpAngle(a: number, b: number, t: number): number {
  const diff = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + diff * t) % 360) + 360) % 360;
}

function headingAt(
  from: Waypoint,
  to: Waypoint | undefined,
  lat: number,
  lng: number,
  t: number,
  config: Pick<MissionConfig, "globalHeadingMode">,
  pois: PointOfInterest[],
  fallback: number,
): number {
  const mode = from.useGlobalHeadingParam
    ? config.globalHeadingMode
    : (from.headingMode ?? config.globalHeadingMode);

  if (mode === "towardPOI" && from.poiId) {
    const poi = pois.find((p) => p.id === from.poiId);
    if (poi) return bearing(lat, lng, poi.latitude, poi.longitude);
  }
  if (mode === "fixed" || mode === "manually") {
    return ((from.headingAngle ?? 0) + 360) % 360;
  }
  if (mode === "smoothTransition" && to) {
    return lerpAngle(from.headingAngle ?? 0, to.headingAngle ?? 0, t);
  }
  if (!to) return fallback;
  if (from.latitude === to.latitude && from.longitude === to.longitude) {
    return fallback;
  }
  return bearing(from.latitude, from.longitude, to.latitude, to.longitude);
}

/** Find the next waypoint at or after `pos` that has something to do. */
function describeNext(
  waypoints: Waypoint[],
  pos: number,
  includeCurrent: boolean,
): string | null {
  for (let i = includeCurrent ? pos : pos + 1; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (wp.actions.length > 0) {
      const label = ACTION_LABELS[wp.actions[0].actionType] ?? "Action";
      const more = wp.actions.length > 1 ? ` +${wp.actions.length - 1}` : "";
      return `${label}${more} at WP ${i + 1}`;
    }
    if (wp.photoIntervalM && i < waypoints.length - 1) {
      return `Interval photos from WP ${i + 1}`;
    }
  }
  return null;
}

/** State of the aircraft `timeS` seconds into the mission. */
export function sampleMission(
  waypoints: Waypoint[],
  stats: MissionStats,
  config: Pick<MissionConfig, "globalHeadingMode">,
  pois: PointOfInterest[],
  timeS: number,
): SimulationSample | null {
  if (waypoints.length === 0) return null;

  const total = stats.estimatedFlightTimeS;
  const t = Math.min(Math.max(timeS, 0), total);
  const last = waypoints.length - 1;

  // Last waypoint whose arrival time has passed
  let pos = 0;
  while (pos < last && stats.arrivalS[pos + 1] <= t) pos++;

  const from = waypoints[pos];
  const seg = pos < last ? stats.segments[pos] : undefined;
  const to = seg ? waypoints[pos + 1] : undefined;

  const flying = !!seg && t >= seg.startS && seg.timeS > 0;
  const progress = flying ? Math.min(1, (t - seg.startS) / seg.timeS) : 0;

  const lerp = (a: number, b: number) => a + (b - a) * progress;
  const latitude = to ? lerp(from.latitude, to.latitude) : from.latitude;
  const longitude = to ? lerp(from.longitude, to.longitude) : from.longitude;
  const height = to ? lerp(from.height, to.height) : from.height;

  // Heading while stopped at the final waypoint: keep the arrival course.
  const prev = pos > 0 ? waypoints[pos - 1] : undefined;
  const arrivalCourse = prev
    ? bearing(prev.latitude, prev.longitude, from.latitude, from.longitude)
    : 0;
  const headingDeg = headingAt(
    from,
    to,
    latitude,
    longitude,
    progress,
    config,
    pois,
    arrivalCourse,
  );

  // The gimbal only sweeps between waypoints when asked to; otherwise it
  // holds the pitch set at the last waypoint.
  const sweeps =
    !!to && to.actions.some((a) => a.actionType === "gimbalEvenlyRotate");
  const gimbalPitchDeg =
    to && sweeps
      ? lerp(from.gimbalPitchAngle, to.gimbalPitchAngle)
      : from.gimbalPitchAngle;

  // Photos: waypoint actions fire on arrival, interval photos along the leg.
  let photosTaken = 0;
  for (let i = 0; i <= pos; i++) {
    photosTaken += waypoints[i].actions.filter(
      (a) => a.actionType === "takePhoto",
    ).length;
    if (i < pos) photosTaken += stats.segments[i].intervalPhotos;
  }
  if (seg && flying) {
    photosTaken += Math.floor(seg.intervalPhotos * progress + 1e-9);
  }

  let remainingDistanceM = 0;
  for (let i = pos; i < stats.segments.length; i++) {
    const d = stats.segments[i].distanceM;
    remainingDistanceM += i === pos ? d * (1 - progress) : d;
  }

  const finished = t >= total;
  return {
    latitude,
    longitude,
    height,
    headingDeg,
    gimbalPitchDeg,
    waypointPos: pos,
    legProgress: progress,
    phase: finished ? "finished" : flying ? "flying" : "stopped",
    elapsedS: t,
    remainingS: total - t,
    remainingDistanceM,
    photosTaken,
    nextAction: finished ? null : describeNext(waypoints, pos, !flying),
  };
}
