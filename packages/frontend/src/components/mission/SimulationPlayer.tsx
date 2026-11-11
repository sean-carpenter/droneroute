import { useEffect, useMemo, useRef } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { SIMULATION_RATES, useSimulationStore } from "@/store/simulationStore";
import { useMissionStats } from "@/lib/useMissionStats";
import { sampleMission } from "@/lib/simulation";
import { formatDuration } from "@/lib/missionStats";
import { formatDistance, formatHeight } from "@/lib/units";

/** Playback controls and live read-outs for the flight preview. */
export function SimulationPlayer() {
  const active = useSimulationStore((s) => s.active);
  const playing = useSimulationStore((s) => s.playing);
  const rate = useSimulationStore((s) => s.rate);
  const timeS = useSimulationStore((s) => s.timeS);
  const { close, setPlaying, setRate, seek } = useSimulationStore.getState();

  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);
  const config = useMissionStore((s) => s.config);
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const stats = useMissionStats();
  const total = stats.estimatedFlightTimeS;

  // Advance the clock while playing
  const totalRef = useRef(total);
  totalRef.current = total;
  useEffect(() => {
    if (!active || !playing) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const state = useSimulationStore.getState();
      const next = state.timeS + dt * state.rate;
      if (next >= totalRef.current) {
        state.seek(totalRef.current);
        state.setPlaying(false);
        return;
      }
      state.seek(next);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, playing]);

  // Nothing left to preview once the route is gone
  useEffect(() => {
    if (active && waypoints.length < 2) close();
  }, [active, waypoints.length, close]);

  const sample = useMemo(
    () => sampleMission(waypoints, stats, config, pois, timeS),
    [waypoints, stats, config, pois, timeS],
  );

  if (!active || !sample) return null;

  const finished = sample.phase === "finished";
  const readouts: [string, string][] = [
    ["Elapsed", formatDuration(sample.elapsedS)],
    ["Remaining", formatDuration(sample.remainingS)],
    ["Distance left", formatDistance(sample.remainingDistanceM, unitSystem)],
    ["Altitude", formatHeight(sample.height, unitSystem)],
    ["Gimbal", `${Math.round(sample.gimbalPitchDeg)}°`],
    ["Photos", `${sample.photosTaken} / ${stats.photoCount}`],
  ];

  return (
    <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30 w-[460px] max-w-[calc(100%-2rem)] bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl p-3 tabular-nums">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
          Flight preview
        </span>
        <span className="text-[11px] text-muted-foreground">
          {finished
            ? "Mission complete"
            : sample.phase === "stopped"
              ? `At WP ${sample.waypointPos + 1}`
              : `WP ${sample.waypointPos + 1} → ${sample.waypointPos + 2}`}
        </span>
        <button
          onClick={close}
          className="text-muted-foreground hover:text-foreground"
          title="Close preview"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(total, 0.001)}
        step="any"
        value={Math.min(timeS, total)}
        onChange={(e) => seek(parseFloat(e.target.value))}
        className="w-full accent-emerald-500"
        aria-label="Mission time"
      />

      <div className="flex items-center gap-2 mt-1 mb-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          title={playing ? "Pause" : "Play"}
          onClick={() => {
            if (finished) seek(0);
            setPlaying(!playing);
          }}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          title="Restart"
          onClick={() => seek(0)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <div className="flex gap-1 ml-auto">
          {SIMULATION_RATES.map((r) => (
            <button
              key={r}
              onClick={() => setRate(r)}
              className={`px-1.5 py-0.5 rounded border text-[10px] ${rate === r ? "border-emerald-400 bg-emerald-500/20 text-emerald-200" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-6 gap-2">
        {readouts.map(([label, value]) => (
          <div key={label}>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="text-[11px] font-medium">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-2 text-[10px] text-muted-foreground">
        {sample.nextAction ? `Next: ${sample.nextAction}` : "No more actions"}
      </div>
    </div>
  );
}
