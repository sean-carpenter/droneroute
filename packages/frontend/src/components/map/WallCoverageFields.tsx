import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { formatShortDistance } from "@/lib/units";
import type { CameraModel } from "@/lib/camera";
import { estimateMission, formatDuration } from "@/lib/missionStats";
import {
  DEFAULT_FACADE_COVERAGE,
  FACADE_COVERAGE_PRESETS,
  MAX_SURVEY_WAYPOINTS,
  wallCoverage,
  type FacadeCoverage,
  type FacadeParams,
  type TemplateResult,
} from "@/lib/templates";

interface WallCoverageFieldsProps {
  params: FacadeParams;
  onChange: (params: FacadeParams) => void;
  camera: CameraModel;
  cameraExact: boolean;
  previewWaypoints: TemplateResult["waypoints"];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Rows and columns for a wall scan. In auto mode they are worked out from the
 * camera, the distance to the wall, its length and the altitude band, to give
 * the chosen overlap with the fewest photos, and they follow every change.
 * Typing a count switches to manual; Auto switches back.
 */
export function WallCoverageFields({
  params,
  onChange,
  camera,
  cameraExact,
  previewWaypoints,
}: WallCoverageFieldsProps) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const config = useMissionStore((s) => s.config);
  const coverage: FacadeCoverage = params.coverage ?? {
    ...DEFAULT_FACADE_COVERAGE,
    auto: false,
  };
  const auto = coverage.auto;
  const setCoverage = (changes: Partial<FacadeCoverage>) =>
    onChange({ ...params, coverage: { ...coverage, ...changes } });

  // What the current counts actually give, auto or manual. Edge photos sit
  // with their edges on the wall's ends and on its lowest and highest height.
  const result = useMemo(() => {
    const { footprint, centersSpanM } = wallCoverage(params, coverage, camera);
    const along = (span: number, count: number, size: number) => {
      if (count > 1) {
        const gap = span / (count - 1);
        return { gap, overlap: 1 - gap / size, missed: gap > size };
      }
      // One photo: it covers the band only if the band fits in the photo
      return { gap: 0, overlap: 1, missed: span > 0.01 };
    };
    const h = along(
      centersSpanM.horizontal,
      params.numColumns,
      footprint.widthM,
    );
    const v = along(centersSpanM.vertical, params.numRows, footprint.heightM);
    const low = Math.min(params.minAltitude, params.maxAltitude);
    const high = Math.max(params.minAltitude, params.maxAltitude);
    const half = Math.min((high - low) / 2, footprint.heightM / 2);
    return {
      footprint,
      horizontal: h,
      vertical: v,
      flies: { lowM: low + half, highM: high - half },
    };
  }, [params, coverage, camera]);

  const stats = useMemo(
    () =>
      estimateMission(
        previewWaypoints.map((wp, i) => ({ ...wp, index: i, name: "" })),
        config,
      ),
    [previewWaypoints, config],
  );

  const gaps = result.horizontal.missed || result.vertical.missed;
  const preset = FACADE_COVERAGE_PRESETS.find(
    (p) =>
      Math.abs(p.overlap - coverage.horizontalOverlap) < 0.001 &&
      Math.abs(p.overlap - coverage.verticalOverlap) < 0.001,
  );

  const choice = (on: boolean) =>
    `flex-1 rounded border px-2 py-1 text-[10px] transition-colors ${
      on
        ? "border-purple-400 bg-purple-500/20 text-purple-100"
        : "border-border text-muted-foreground hover:bg-secondary"
    }`;

  const readouts: [string, string][] = [
    [
      "Photo covers",
      `${formatShortDistance(result.footprint.widthM, unitSystem)} × ${formatShortDistance(result.footprint.heightM, unitSystem)}`,
    ],
    [
      "Photo spacing",
      `${params.numColumns > 1 ? formatShortDistance(result.horizontal.gap, unitSystem) : "—"} × ${params.numRows > 1 ? formatShortDistance(result.vertical.gap, unitSystem) : "—"}`,
    ],
    [
      "Overlap",
      `${params.numColumns > 1 ? pct(Math.max(0, result.horizontal.overlap)) : "—"} × ${params.numRows > 1 ? pct(Math.max(0, result.vertical.overlap)) : "—"}`,
    ],
    [
      "Drone flies",
      result.flies.highM - result.flies.lowM < 0.05
        ? `at ${formatShortDistance(result.flies.lowM, unitSystem)}`
        : `${formatShortDistance(result.flies.lowM, unitSystem)} – ${formatShortDistance(result.flies.highM, unitSystem)}`,
    ],
    ["Photos", params.addPhotos ? `${previewWaypoints.length}` : "—"],
    ["Flight time", formatDuration(stats.estimatedFlightTimeS)],
    [
      "Batteries",
      stats.batteriesNeeded > 1
        ? `${stats.batteriesNeeded}`
        : `${Math.round(stats.estimatedBatteryPercent)}%`,
    ],
  ];

  return (
    <div className="mb-3 rounded-md border border-border/60 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Label className="text-[10px]">Rows and columns</Label>
        <div className="flex w-36 gap-1">
          <button
            type="button"
            className={choice(auto)}
            onClick={() => setCoverage({ auto: true })}
            title="Work out rows and columns for the overlap, and keep them up to date"
          >
            Auto
          </button>
          <button
            type="button"
            className={choice(!auto)}
            onClick={() => setCoverage({ auto: false })}
            title="Set rows and columns yourself"
          >
            Manual
          </button>
        </div>
      </div>

      {auto && (
        <>
          <div className="mb-2 flex gap-1">
            {FACADE_COVERAGE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className={choice(preset?.label === p.label)}
                onClick={() =>
                  setCoverage({
                    horizontalOverlap: p.overlap,
                    verticalOverlap: p.overlap,
                  })
                }
                title={p.hint}
              >
                {p.label} {pct(p.overlap)}
              </button>
            ))}
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px]">Side-to-side overlap (%)</Label>
              <NumericInput
                value={Math.round(coverage.horizontalOverlap * 100)}
                onChange={(v) => setCoverage({ horizontalOverlap: v / 100 })}
                min={0}
                max={90}
                step={5}
                fallback={75}
                integer
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">Up-and-down overlap (%)</Label>
              <NumericInput
                value={Math.round(coverage.verticalOverlap * 100)}
                onChange={(v) => setCoverage({ verticalOverlap: v / 100 })}
                min={0}
                max={90}
                step={5}
                fallback={75}
                integer
                className="h-7 text-xs"
              />
            </div>
          </div>
        </>
      )}

      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px]">Rows</Label>
          <NumericInput
            value={params.numRows}
            onChange={(v) =>
              onChange({
                ...params,
                numRows: v,
                coverage: { ...coverage, auto: false },
              })
            }
            min={1}
            max={MAX_SURVEY_WAYPOINTS}
            fallback={params.numRows}
            integer
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">Columns</Label>
          <NumericInput
            value={params.numColumns}
            onChange={(v) =>
              onChange({
                ...params,
                numColumns: v,
                coverage: { ...coverage, auto: false },
              })
            }
            min={1}
            max={MAX_SURVEY_WAYPOINTS}
            fallback={params.numColumns}
            integer
            className="h-7 text-xs"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
        {readouts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium tabular-nums">{value}</span>
          </div>
        ))}
      </div>

      {gaps && (
        <p className="mt-2 text-[10px] text-orange-300">
          Neighboring photos do not touch: parts of the wall are missed. Add
          rows or columns, or switch to Auto.
        </p>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground">
        Photo edges line up with the wall's ends and the heights above, so no
        photo looks past the wall. Worked out for a level camera on the{" "}
        {camera.label}
        {cameraExact ? "" : " (stand-in for this drone)"}. Flight time includes
        stopping at each photo but not take-off or return.
        {Math.min(
          params.numColumns > 1 ? result.horizontal.gap : Infinity,
          params.numRows > 1 ? result.vertical.gap : Infinity,
        ) < 0.5
          ? " Photos under 0.5 m apart: check the controller accepts waypoints this close."
          : ""}
      </p>
    </div>
  );
}
