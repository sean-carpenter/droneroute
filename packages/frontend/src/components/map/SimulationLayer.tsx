import { useMemo } from "react";
import type { PointOfInterest, Waypoint } from "@droneroute/shared";
import { useMissionStore } from "@/store/missionStore";
import { useSimulationStore } from "@/store/simulationStore";
import { useMissionStats } from "@/lib/useMissionStats";
import { sampleMission } from "@/lib/simulation";
import { Marker3D } from "./Marker3D";
import { CameraFrustum } from "./CameraFrustum";

const NO_POIS: PointOfInterest[] = [];

/** The simulated aircraft and its camera view during a flight preview. */
export function SimulationLayer({ is3D }: { is3D: boolean }) {
  const active = useSimulationStore((s) => s.active);
  const timeS = useSimulationStore((s) => s.timeS);
  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);
  const config = useMissionStore((s) => s.config);
  const stats = useMissionStats();

  const sample = useMemo(
    () =>
      active ? sampleMission(waypoints, stats, config, pois, timeS) : null,
    [active, waypoints, stats, config, pois, timeS],
  );

  // A stand-in waypoint at the aircraft's position lets the regular camera
  // frustum show where the camera is looking right now.
  const camera: Waypoint | null = useMemo(() => {
    if (!sample) return null;
    return {
      ...waypoints[sample.waypointPos],
      latitude: sample.latitude,
      longitude: sample.longitude,
      height: sample.height,
      gimbalPitchAngle: sample.gimbalPitchDeg,
      useGlobalHeadingParam: false,
      headingMode: "fixed",
      headingAngle: sample.headingDeg,
      poiId: undefined,
    };
  }, [sample, waypoints]);

  if (!sample || !camera) return null;

  return (
    <>
      <CameraFrustum waypoint={camera} pois={NO_POIS} is3D={is3D} />
      <Marker3D
        longitude={sample.longitude}
        latitude={sample.latitude}
        altitude={is3D ? sample.height : 0}
        anchor="center"
      >
        <div
          style={{
            width: 34,
            height: 34,
            transform: `rotate(${sample.headingDeg}deg)`,
            pointerEvents: "none",
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
          }}
        >
          <svg viewBox="0 0 34 34" width="34" height="34">
            <circle
              cx="17"
              cy="17"
              r="15"
              fill="rgba(16,185,129,0.25)"
              stroke="#34d399"
              strokeWidth="1.5"
            />
            {/* Arrow points along the aircraft heading */}
            <path
              d="M17 5 L25 26 L17 21 L9 26 Z"
              fill="#10b981"
              stroke="#ecfdf5"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </Marker3D>
    </>
  );
}
