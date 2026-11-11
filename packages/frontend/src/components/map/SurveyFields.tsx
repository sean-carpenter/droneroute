import { useMemo } from "react";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import {
  heightLabel,
  toDisplayHeight,
  fromDisplayHeight,
  formatDistance,
} from "@/lib/units";
import {
  OVERLAP_PRESETS,
  altitudeForGsd,
  footprintM,
  gsdCmPerPx,
  maxSpeedForInterval,
  type CameraModel,
} from "@/lib/camera";
import { estimateMission, formatDuration } from "@/lib/missionStats";
import type { SurveyPhotoMode, TemplateResult } from "@/lib/templates";

export interface SurveyValues {
  altitude: number;
  sideOverlap: number;
  forwardOverlap: number;
  photoMode: SurveyPhotoMode;
  addPhotos: boolean;
}

interface SurveyFieldsProps extends SurveyValues {
  lineSpacingM: number;
  photoIntervalM: number;
  camera: CameraModel;
  /** False when the mission's payload has no known camera geometry. */
  cameraExact: boolean;
  previewWaypoints: TemplateResult["waypoints"];
  onChange: (patch: Partial<SurveyValues>) => void;
}

const PHOTO_MODE_LABELS: Record<SurveyPhotoMode, string> = {
  interval: "Distance interval",
  waypoints: "Waypoint per photo",
  ends: "Line ends only",
};

/**
 * Overlap, GSD and capture settings shared by the photogrammetry grid and the
 * corridor template, with live read-outs for the resulting flight.
 */
export function SurveyFields({
  altitude,
  sideOverlap,
  forwardOverlap,
  photoMode,
  addPhotos,
  lineSpacingM,
  photoIntervalM,
  camera,
  cameraExact,
  previewWaypoints,
  onChange,
}: SurveyFieldsProps) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const config = useMissionStore((s) => s.config);

  const stats = useMemo(
    () =>
      estimateMission(
        previewWaypoints.map((wp, i) => ({ ...wp, index: i, name: "" })),
        config,
      ),
    [previewWaypoints, config],
  );

  const gsd = gsdCmPerPx(altitude, camera);
  const footprint = footprintM(altitude, camera);
  const maxSpeed = maxSpeedForInterval(photoIntervalM, camera);
  const tooFast =
    addPhotos && photoMode === "interval" && config.autoFlightSpeed > maxSpeed;

  const readouts: [string, string][] = [
    ["GSD", `${gsd.toFixed(2)} cm/px`],
    [
      "Footprint",
      `${formatDistance(footprint.widthM, unitSystem)} × ${formatDistance(footprint.heightM, unitSystem)}`,
    ],
    ["Line spacing", formatDistance(lineSpacingM, unitSystem)],
    ["Photo interval", formatDistance(photoIntervalM, unitSystem)],
    ["Photos", addPhotos ? `~${stats.photoCount}` : "—"],
    ["Distance", formatDistance(stats.totalDistanceM, unitSystem)],
    ["Flight time", formatDuration(stats.estimatedFlightTimeS)],
    [
      "Batteries",
      stats.batteriesNeeded > 1
        ? `${stats.batteriesNeeded}`
        : `${Math.round(stats.estimatedBatteryPercent)}%`,
    ],
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <Label className="text-[10px]">
            Altitude ({heightLabel(unitSystem)})
          </Label>
          <NumericInput
            value={toDisplayHeight(altitude, unitSystem)}
            onChange={(v) =>
              onChange({ altitude: fromDisplayHeight(v, unitSystem) })
            }
            min={5}
            step={5}
            fallback={80}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">GSD (cm/px)</Label>
          <NumericInput
            value={+gsd.toFixed(2)}
            onChange={(v) =>
              onChange({
                altitude: Math.max(
                  5,
                  Math.round(altitudeForGsd(v, camera) * 10) / 10,
                ),
              })
            }
            min={0.2}
            step={0.1}
            fallback={2}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">Side overlap (%)</Label>
          <NumericInput
            value={Math.round(sideOverlap * 100)}
            onChange={(v) => onChange({ sideOverlap: v / 100 })}
            min={10}
            max={90}
            step={5}
            fallback={75}
            integer
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">Forward overlap (%)</Label>
          <NumericInput
            value={Math.round(forwardOverlap * 100)}
            onChange={(v) => onChange({ forwardOverlap: v / 100 })}
            min={10}
            max={90}
            step={5}
            fallback={75}
            integer
            className="h-7 text-xs"
          />
        </div>
      </div>

      <div className="flex gap-1 mb-2">
        {OVERLAP_PRESETS.map((preset) => {
          const active =
            Math.abs(preset.sideOverlap - sideOverlap) < 0.001 &&
            Math.abs(preset.forwardOverlap - forwardOverlap) < 0.001;
          return (
            <button
              key={preset.label}
              onClick={() =>
                onChange({
                  sideOverlap: preset.sideOverlap,
                  forwardOverlap: preset.forwardOverlap,
                })
              }
              className={`flex-1 px-1.5 py-1 rounded border text-[10px] transition-colors ${active ? "border-purple-400 bg-purple-500/20 text-purple-200" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <Label className="text-[10px]">Photo capture</Label>
          <Select
            value={addPhotos ? photoMode : "none"}
            onValueChange={(v) =>
              v === "none"
                ? onChange({ addPhotos: false })
                : onChange({
                    addPhotos: true,
                    photoMode: v as SurveyPhotoMode,
                  })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PHOTO_MODE_LABELS) as SurveyPhotoMode[]).map(
                (mode) => (
                  <SelectItem key={mode} value={mode}>
                    {PHOTO_MODE_LABELS[mode]}
                  </SelectItem>
                ),
              )}
              <SelectItem value="none">No photos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="text-[10px] text-muted-foreground self-end pb-1">
          {camera.label}
          {!cameraExact && " (stand-in for this payload)"}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-x-2 gap-y-1 mb-2 rounded border border-border bg-background/40 p-2 tabular-nums">
        {readouts.map(([label, value]) => (
          <div key={label}>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="text-[11px] font-medium">{value}</div>
          </div>
        ))}
      </div>

      {tooFast && (
        <p className="text-[10px] text-orange-300 mb-2">
          Mission speed ({config.autoFlightSpeed} m/s) is too fast for this
          photo interval. Stay under {maxSpeed.toFixed(1)} m/s or lower the
          forward overlap.
        </p>
      )}
      {stats.batteriesNeeded > 1 && (
        <p className="text-[10px] text-orange-300 mb-2">
          Needs {stats.batteriesNeeded} batteries at {config.maxBatteryMinutes}{" "}
          min each.
        </p>
      )}
    </>
  );
}
