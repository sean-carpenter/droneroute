/**
 * Flight estimates for a mission: distance, time, photo count and how many
 * batteries it takes. Pure functions — no store or DOM access.
 *
 * The timing model is deliberately simple: each leg is flown at its waypoint
 * speed, and a fixed penalty is added wherever the aircraft has to stop.
 * It does not include take-off, the flight to the first waypoint, or the
 * return home, so treat the battery figures as a lower bound.
 */
import type { MissionConfig, Waypoint } from "@droneroute/shared";
import { haversineDistance } from "./geo";

/** Seconds lost braking to a stop and accelerating away again. */
export const STOP_PENALTY_S = 4;
/** Seconds a stop-and-shoot action (photo, gimbal or yaw move) takes. */
export const ACTION_TIME_S = 1;

export interface SegmentStats {
  /** Waypoint array positions (not `index` fields) of the leg's two ends. */
  from: number;
  to: number;
  distanceM: number;
  speedMps: number;
  timeS: number;
  /** Photos triggered by distance while flying this leg. */
  intervalPhotos: number;
  /** Elapsed mission time when the aircraft leaves `from`. */
  startS: number;
}

export interface MissionStats {
  totalDistanceM: number;
  estimatedFlightTimeS: number;
  photoCount: number;
  videoCount: number;
  elevationGainM: number;
  /** Time spent stopped at each waypoint (turn penalty + actions). */
  dwellS: number[];
  /** Elapsed mission time when the aircraft arrives at each waypoint. */
  arrivalS: number[];
  segments: SegmentStats[];
  batteriesNeeded: number;
  /** Share of one battery the whole mission uses (can exceed 100). */
  estimatedBatteryPercent: number;
  /** Waypoint array positions after which a battery swap is needed. */
  batterySwapAfter: number[];
}

type SpeedConfig = Pick<
  MissionConfig,
  "autoFlightSpeed" | "globalTurnMode" | "maxBatteryMinutes"
>;

/** Speed flown from this waypoint to the next one (WPML `waypointSpeed`). */
export function legSpeed(wp: Waypoint, config: SpeedConfig): number {
  const speed = wp.useGlobalSpeed ? config.autoFlightSpeed : wp.speed;
  return speed > 0 ? speed : config.autoFlightSpeed;
}

function stopsAt(wp: Waypoint, config: SpeedConfig): boolean {
  const mode = wp.useGlobalTurnParam
    ? config.globalTurnMode
    : (wp.turnMode ?? config.globalTurnMode);
  return mode.startsWith("toPointAndStop");
}

/** Seconds the aircraft spends stationary at a waypoint. */
export function dwellTime(
  wp: Waypoint,
  config: SpeedConfig,
  isEndpoint: boolean,
): number {
  let time = 0;
  for (const action of wp.actions) {
    if (action.actionType === "hover") {
      time += Number((action.params as { hoverTime?: number }).hoverTime) || 0;
    } else if (
      action.actionType === "takePhoto" ||
      action.actionType === "gimbalRotate" ||
      action.actionType === "rotateYaw"
    ) {
      time += ACTION_TIME_S;
    }
  }
  // Actions force a stop even in pass-through turn modes.
  if (!isEndpoint && (time > 0 || stopsAt(wp, config))) time += STOP_PENALTY_S;
  return time;
}

/** Photos taken on a leg of `distanceM` flown with a distance trigger. */
export function intervalPhotoCount(
  distanceM: number,
  photoIntervalM: number | undefined,
): number {
  if (!photoIntervalM || photoIntervalM <= 0) return 0;
  return Math.floor(distanceM / photoIntervalM + 1e-9);
}

export function estimateMission(
  waypoints: Waypoint[],
  config: SpeedConfig,
): MissionStats {
  const n = waypoints.length;
  const dwellS = waypoints.map((wp, i) =>
    dwellTime(wp, config, i === 0 || i === n - 1),
  );
  const arrivalS: number[] = n > 0 ? [0] : [];
  const segments: SegmentStats[] = [];

  let totalDistanceM = 0;
  let elevationGainM = 0;
  let photoCount = 0;
  let videoCount = 0;
  let clock = 0;

  for (let i = 0; i < n; i++) {
    const wp = waypoints[i];
    for (const action of wp.actions) {
      if (action.actionType === "takePhoto") photoCount++;
      if (action.actionType === "startRecord") videoCount++;
    }
    clock += dwellS[i];
    if (i === n - 1) break;

    const next = waypoints[i + 1];
    const horizontal = haversineDistance(
      wp.latitude,
      wp.longitude,
      next.latitude,
      next.longitude,
    );
    const climb = next.height - wp.height;
    const distanceM = Math.hypot(horizontal, climb);
    const speedMps = legSpeed(wp, config);
    const timeS = distanceM / speedMps;

    let intervalPhotos = intervalPhotoCount(distanceM, wp.photoIntervalM);
    // A run of interval legs also fires once at its very start.
    if (wp.photoIntervalM && !(i > 0 && waypoints[i - 1].photoIntervalM)) {
      intervalPhotos += 1;
    }

    segments.push({
      from: i,
      to: i + 1,
      distanceM,
      speedMps,
      timeS,
      intervalPhotos,
      startS: clock,
    });

    totalDistanceM += distanceM;
    if (climb > 0) elevationGainM += climb;
    photoCount += intervalPhotos;
    clock += timeS;
    arrivalS.push(clock);
  }

  const budgetS = config.maxBatteryMinutes * 60;
  const batterySwapAfter: number[] = [];
  if (budgetS > 0) {
    let used = dwellS[0] ?? 0;
    for (const seg of segments) {
      const cost = seg.timeS + dwellS[seg.to];
      if (used + cost > budgetS && used > 0) {
        batterySwapAfter.push(seg.from);
        used = 0;
      }
      used += cost;
    }
  }

  return {
    totalDistanceM,
    estimatedFlightTimeS: clock,
    photoCount,
    videoCount,
    elevationGainM,
    dwellS,
    arrivalS,
    segments,
    batteriesNeeded: n >= 2 ? batterySwapAfter.length + 1 : 0,
    estimatedBatteryPercent: budgetS > 0 ? (clock / budgetS) * 100 : 0,
    batterySwapAfter,
  };
}

/** Format seconds as a short human-readable duration. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const totalSecs = Math.round(seconds);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return `${mins}m${secs > 0 ? ` ${secs}s` : ""}`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h${remainMins > 0 ? ` ${remainMins}m` : ""}`;
}
