import { useMemo } from "react";
import { useMissionStore } from "@/store/missionStore";
import { estimateMission, type MissionStats } from "@/lib/missionStats";

/** Live flight estimates for the mission being edited. */
export function useMissionStats(): MissionStats {
  const waypoints = useMissionStore((s) => s.waypoints);
  const config = useMissionStore((s) => s.config);
  return useMemo(() => estimateMission(waypoints, config), [waypoints, config]);
}
