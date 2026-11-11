import { useEffect, useMemo, useState } from "react";
import { useMap } from "react-map-gl/mapbox";
import { ArrowUp, RefreshCw, Wind, X } from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import { useWindStore } from "@/store/windStore";
import { roundCoord, windAdvisory } from "@/lib/wind";

const SEVERITY_STYLE = {
  ok: "border-border text-foreground",
  caution: "border-orange-400 text-orange-200",
  danger: "border-red-400 text-red-200",
} as const;

/**
 * Wind advisory for the mission area (or the map center when the mission is
 * empty). Only rendered when the user has turned the wind overlay on.
 */
export function WindPanel() {
  const { current: map } = useMap();
  const enabled = useWindStore((s) => s.enabled);
  const reading = useWindStore((s) => s.reading);
  const loading = useWindStore((s) => s.loading);
  const error = useWindStore((s) => s.error);
  const setEnabled = useWindStore((s) => s.setEnabled);
  const refresh = useWindStore((s) => s.refresh);
  const waypoints = useMissionStore((s) => s.waypoints);

  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [bearing, setBearing] = useState(0);

  // Track the map center (rounded, so small pans don't trigger a refetch)
  useEffect(() => {
    if (!map || !enabled) return;
    const update = () => {
      const c = map.getCenter();
      const next: [number, number] = [roundCoord(c.lat), roundCoord(c.lng)];
      setMapCenter((prev) =>
        prev && prev[0] === next[0] && prev[1] === next[1] ? prev : next,
      );
      setBearing(map.getBearing());
    };
    update();
    map.on("moveend", update);
    return () => {
      map.off("moveend", update);
    };
  }, [map, enabled]);

  // Where and how high the mission flies
  const target = useMemo(() => {
    if (waypoints.length === 0) {
      return mapCenter
        ? { latitude: mapCenter[0], longitude: mapCenter[1], altitudeM: 50 }
        : null;
    }
    const n = waypoints.length;
    return {
      latitude: roundCoord(waypoints.reduce((s, w) => s + w.latitude, 0) / n),
      longitude: roundCoord(waypoints.reduce((s, w) => s + w.longitude, 0) / n),
      altitudeM: Math.max(...waypoints.map((w) => w.height)),
    };
  }, [waypoints, mapCenter]);

  const latitude = target?.latitude;
  const longitude = target?.longitude;
  const altitudeM = target?.altitudeM;
  useEffect(() => {
    if (!enabled || latitude === undefined || longitude === undefined) return;
    void refresh(latitude, longitude, altitudeM ?? 50);
  }, [enabled, latitude, longitude, altitudeM, refresh]);

  if (!enabled) return null;

  const advisory = reading ? windAdvisory(reading) : null;

  return (
    <div
      className={`absolute top-14 left-3 z-10 w-60 bg-card/95 backdrop-blur-sm border rounded-lg shadow-lg p-2.5 text-xs ${SEVERITY_STYLE[advisory?.severity ?? "ok"]}`}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Wind className="h-3.5 w-3.5" />
        <span className="font-semibold">Wind</span>
        {reading && (
          <span className="text-[10px] text-muted-foreground">
            at {reading.levelM} m
          </span>
        )}
        <button
          className="ml-auto text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Refresh wind"
          disabled={loading || !target}
          onClick={() =>
            target &&
            void refresh(
              target.latitude,
              target.longitude,
              target.altitudeM,
              true,
            )
          }
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          className="text-muted-foreground hover:text-foreground"
          title="Hide wind"
          onClick={() => setEnabled(false)}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {reading && advisory ? (
        <div className="flex items-start gap-2">
          {/* Arrow points the way the wind is blowing, in map orientation */}
          <ArrowUp
            className="h-6 w-6 shrink-0"
            style={{
              transform: `rotate(${reading.directionDeg + 180 - bearing}deg)`,
            }}
          />
          <p className="leading-snug">{advisory.message}</p>
        </div>
      ) : (
        <p className="text-muted-foreground">
          {error ?? (loading ? "Loading wind…" : "No wind data yet")}
        </p>
      )}

      <p className="mt-1.5 text-[9px] text-muted-foreground">
        Model data from Open-Meteo. Advisory only — check conditions on site.
      </p>
    </div>
  );
}
