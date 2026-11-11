import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PointOfInterest } from "@droneroute/shared";
import { usePreferencesStore } from "@/store/preferencesStore";
import { heightLabel, toDisplayHeight, fromDisplayHeight } from "@/lib/units";
import { GIMBAL_PITCH_MAX, GIMBAL_PITCH_MIN } from "@/lib/geo";
import type {
  TemplateAim,
  TemplateAimMode,
  TemplateResult,
} from "@/lib/templates";

const MODE_LABELS: Record<TemplateAimMode, string> = {
  fixed: "Fixed pitch",
  towardPOI: "Toward POI",
  structureHeight: "Height on structure",
  relativeToSurface: "Relative to surface",
};

interface CameraAimSectionProps {
  aim: TemplateAim;
  onChange: (aim: TemplateAim) => void;
  /** Aim modes this template supports, in display order. */
  modes: TemplateAimMode[];
  pois?: PointOfInterest[];
  /** Label for the structure-height input, e.g. "Height on wall". */
  structureLabel?: string;
  /** One-click heights, e.g. base / middle / top of the scanned range. */
  heightPresets?: { label: string; height: number }[];
  /** Pitch used when switching to fixed mode. */
  defaultFixedPitch?: number;
  /** Explains what "relative to surface" means for this template. */
  surfaceHint?: string;
  previewWaypoints?: TemplateResult["waypoints"];
}

/**
 * "Camera aim" controls shared by every template: how the gimbal pitch is
 * chosen for the generated waypoints, with the resulting pitch range.
 */
export function CameraAimSection({
  aim,
  onChange,
  modes,
  pois = [],
  structureLabel = "Height on structure",
  heightPresets,
  defaultFixedPitch = -45,
  surfaceHint = "Degrees below looking straight at the surface",
  previewWaypoints = [],
}: CameraAimSectionProps) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  const setMode = (mode: TemplateAimMode) => {
    if (mode === aim.mode) return;
    switch (mode) {
      case "fixed":
        onChange({ mode, pitch: defaultFixedPitch });
        break;
      case "towardPOI":
        if (pois.length > 0) onChange({ mode, poiId: pois[0].id });
        break;
      case "structureHeight":
        onChange({ mode, height: heightPresets?.[0]?.height ?? 0 });
        break;
      case "relativeToSurface":
        onChange({ mode, offsetDeg: 15 });
        break;
    }
  };

  const pitches = previewWaypoints.map((wp) => wp.gimbalPitchAngle);
  const minPitch = pitches.length ? Math.min(...pitches) : null;
  const maxPitch = pitches.length ? Math.max(...pitches) : null;
  const atLimit =
    minPitch !== null &&
    maxPitch !== null &&
    aim.mode !== "fixed" &&
    (minPitch <= GIMBAL_PITCH_MIN || maxPitch >= GIMBAL_PITCH_MAX);
  const missingPoi =
    aim.mode === "towardPOI" && !pois.some((p) => p.id === aim.poiId);

  return (
    <div className="mb-3 rounded border border-border bg-background/40 p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Camera aim
        </span>
        {minPitch !== null && maxPitch !== null && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {minPitch === maxPitch
              ? `Pitch ${minPitch}°`
              : `Pitch ${minPitch}° to ${maxPitch}°`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px]">Aim mode</Label>
          <Select
            value={aim.mode}
            onValueChange={(v) => setMode(v as TemplateAimMode)}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modes.map((mode) => (
                <SelectItem
                  key={mode}
                  value={mode}
                  disabled={mode === "towardPOI" && pois.length === 0}
                >
                  {mode === "structureHeight"
                    ? structureLabel
                    : MODE_LABELS[mode]}
                  {mode === "towardPOI" && pois.length === 0 && " (no POIs)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {aim.mode === "fixed" && (
          <div>
            <Label className="text-[10px]">Gimbal pitch (°)</Label>
            <NumericInput
              value={aim.pitch}
              onChange={(v) => onChange({ mode: "fixed", pitch: v })}
              min={GIMBAL_PITCH_MIN}
              max={GIMBAL_PITCH_MAX}
              step={5}
              fallback={defaultFixedPitch}
              className="h-7 text-xs"
            />
          </div>
        )}

        {aim.mode === "towardPOI" && (
          <div>
            <Label className="text-[10px]">Target POI</Label>
            <Select
              value={missingPoi ? "" : aim.poiId}
              onValueChange={(v) => onChange({ mode: "towardPOI", poiId: v })}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Select POI..." />
              </SelectTrigger>
              <SelectContent>
                {pois.map((poi) => (
                  <SelectItem key={poi.id} value={poi.id}>
                    {poi.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {aim.mode === "structureHeight" && (
          <div>
            <Label className="text-[10px]">
              Target height ({heightLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayHeight(aim.height, unitSystem)}
              onChange={(v) =>
                onChange({
                  mode: "structureHeight",
                  height: fromDisplayHeight(v, unitSystem),
                })
              }
              min={0}
              step={5}
              fallback={0}
              className="h-7 text-xs"
            />
          </div>
        )}

        {aim.mode === "relativeToSurface" && (
          <div>
            <Label className="text-[10px]">Offset (°)</Label>
            <NumericInput
              value={aim.offsetDeg}
              onChange={(v) =>
                onChange({ mode: "relativeToSurface", offsetDeg: v })
              }
              min={-35}
              max={90}
              step={5}
              fallback={0}
              className="h-7 text-xs"
            />
          </div>
        )}
      </div>

      {aim.mode === "structureHeight" && heightPresets && (
        <div className="flex gap-1 mt-1.5">
          {heightPresets.map((preset) => (
            <button
              key={preset.label}
              onClick={() =>
                onChange({ mode: "structureHeight", height: preset.height })
              }
              className={`flex-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${Math.abs(preset.height - aim.height) < 0.05 ? "border-purple-400 bg-purple-500/20 text-purple-200" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {aim.mode === "relativeToSurface" && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          {surfaceHint}
        </p>
      )}
      {aim.mode === "towardPOI" && !missingPoi && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          The aircraft also turns to face the POI.
        </p>
      )}
      {missingPoi && (
        <p className="mt-1.5 text-[10px] text-orange-300">
          The selected POI no longer exists. Pick another one.
        </p>
      )}
      {atLimit && (
        <p className="mt-1.5 text-[10px] text-orange-300">
          Some waypoints hit the gimbal limit ({GIMBAL_PITCH_MIN}° to{" "}
          {GIMBAL_PITCH_MAX}°) and cannot aim exactly at the target.
        </p>
      )}
    </div>
  );
}
