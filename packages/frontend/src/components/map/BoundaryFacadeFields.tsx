import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { usePreferencesStore } from "@/store/preferencesStore";
import {
  distanceLabel,
  formatDistance,
  fromDisplayDistance,
  fromDisplayHeight,
  heightLabel,
  toDisplayDistance,
  toDisplayHeight,
} from "@/lib/units";
import type {
  BoundaryFacadeParams,
  BoundaryFacadeResult,
  FacadeSpacing,
  TemplateResult,
} from "@/lib/templates";
import type { PointOfInterest } from "@droneroute/shared";
import { CameraAimSection } from "./CameraAimSection";

const CHOICE = "flex-1 px-2 py-1 rounded border text-[11px] transition-colors";
const CHOICE_ON = "border-purple-400 bg-purple-500/20 text-purple-200";
const CHOICE_OFF = "border-border text-muted-foreground hover:text-foreground";

interface BoundaryFacadeFieldsProps {
  params: BoundaryFacadeParams;
  onChange: (params: BoundaryFacadeParams) => void;
  info: Pick<
    BoundaryFacadeResult,
    | "plannedCount"
    | "selfCrossing"
    | "horizontalM"
    | "verticalM"
    | "passes"
    | "passLabel"
  >;
  waypointCount: number;
  cameraLabel: string;
  cameraExact: boolean;
  pois?: PointOfInterest[];
  previewWaypoints: TemplateResult["waypoints"];
}

function choiceClass(active: boolean): string {
  return `${CHOICE} ${active ? CHOICE_ON : CHOICE_OFF}`;
}

export function BoundaryFacadeFields({
  params,
  onChange,
  info,
  waypointCount,
  cameraLabel,
  cameraExact,
  pois,
  previewWaypoints,
}: BoundaryFacadeFieldsProps) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const radial = params.boundary === "polygon" ? null : params;
  const taperAllowed =
    params.boundary === "spiral" || params.pattern === "horizontal";
  const passName =
    info.passLabel === "columns"
      ? "Columns"
      : info.passLabel === "turns"
        ? "Turns"
        : "Orbits";

  const setSpacing = (patch: Partial<FacadeSpacing>) =>
    onChange({ ...params, spacing: { ...params.spacing, ...patch } });

  return (
    <>
      {params.boundary !== "spiral" && (
        <div className="flex gap-1 mb-2">
          {(
            [
              ["horizontal", "Horizontal orbits"],
              ["vertical", "Vertical columns"],
            ] as const
          ).map(([pattern, label]) => (
            <button
              key={pattern}
              type="button"
              onClick={() => onChange({ ...params, pattern })}
              className={choiceClass(params.pattern === pattern)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <Label className="text-[10px]">
            Target distance ({distanceLabel(unitSystem)})
          </Label>
          <NumericInput
            value={toDisplayDistance(params.standoffM, unitSystem)}
            onChange={(value) =>
              onChange({
                ...params,
                standoffM: Math.max(1, fromDisplayDistance(value, unitSystem)),
              })
            }
            min={1}
            step={1}
            fallback={1}
            className="h-7 text-xs"
          />
        </div>
        {radial && (
          <div>
            <Label className="text-[10px]">
              Bottom radius ({distanceLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayDistance(radial.radiusBottomM, unitSystem)}
              onChange={(value) =>
                onChange({
                  ...radial,
                  radiusBottomM: Math.max(
                    0,
                    fromDisplayDistance(value, unitSystem),
                  ),
                })
              }
              min={0}
              step={1}
              fallback={10}
              className="h-7 text-xs"
            />
          </div>
        )}
        <div>
          <Label className="text-[10px]">
            Min altitude ({heightLabel(unitSystem)})
          </Label>
          <NumericInput
            value={toDisplayHeight(params.minAltitude, unitSystem)}
            onChange={(value) =>
              onChange({
                ...params,
                minAltitude: fromDisplayHeight(value, unitSystem),
              })
            }
            min={1}
            step={1}
            fallback={1}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">
            Max altitude ({heightLabel(unitSystem)})
          </Label>
          <NumericInput
            value={toDisplayHeight(params.maxAltitude, unitSystem)}
            onChange={(value) =>
              onChange({
                ...params,
                maxAltitude: fromDisplayHeight(value, unitSystem),
              })
            }
            min={1}
            step={5}
            fallback={40}
            className="h-7 text-xs"
          />
        </div>
      </div>

      {radial && taperAllowed && (
        <div className="flex items-end gap-3 mb-2">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer pb-1">
            <input
              type="checkbox"
              checked={radial.tapered}
              onChange={(event) =>
                onChange({
                  ...radial,
                  tapered: event.target.checked,
                  radiusTopM: event.target.checked
                    ? radial.radiusTopM
                    : radial.radiusBottomM,
                })
              }
              className="rounded"
            />
            Taper
          </label>
          {radial.tapered && (
            <div className="flex-1">
              <Label className="text-[10px]">
                Top radius ({distanceLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayDistance(radial.radiusTopM, unitSystem)}
                onChange={(value) =>
                  onChange({
                    ...radial,
                    radiusTopM: Math.max(
                      0,
                      fromDisplayDistance(value, unitSystem),
                    ),
                  })
                }
                min={0}
                step={1}
                fallback={radial.radiusBottomM}
                className="h-7 text-xs"
              />
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1 mb-2">
        {(
          [
            ["overlap", "Overlap"],
            ["distance", "Distance"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setSpacing({ mode })}
            className={choiceClass(params.spacing.mode === mode)}
          >
            {label}
          </button>
        ))}
      </div>

      {params.spacing.mode === "overlap" ? (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <Label className="text-[10px]">Horizontal overlap (%)</Label>
            <NumericInput
              value={Math.round(params.spacing.horizontalOverlap * 100)}
              onChange={(value) =>
                setSpacing({ horizontalOverlap: value / 100 })
              }
              min={10}
              max={90}
              step={5}
              fallback={75}
              integer
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">Vertical overlap (%)</Label>
            <NumericInput
              value={Math.round(params.spacing.verticalOverlap * 100)}
              onChange={(value) => setSpacing({ verticalOverlap: value / 100 })}
              min={10}
              max={90}
              step={5}
              fallback={75}
              integer
              className="h-7 text-xs"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div>
            <Label className="text-[10px]">
              Horizontal distance ({distanceLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayDistance(params.spacing.horizontalM, unitSystem)}
              onChange={(value) =>
                setSpacing({
                  horizontalM: Math.max(
                    0.5,
                    fromDisplayDistance(value, unitSystem),
                  ),
                })
              }
              min={0.5}
              step={1}
              fallback={1}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">
              Vertical distance ({distanceLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayDistance(params.spacing.verticalM, unitSystem)}
              onChange={(value) =>
                setSpacing({
                  verticalM: Math.max(
                    0.5,
                    fromDisplayDistance(value, unitSystem),
                  ),
                })
              }
              min={0.5}
              step={1}
              fallback={1}
              className="h-7 text-xs"
            />
          </div>
        </div>
      )}

      {radial && (
        <label className="flex items-center gap-1.5 text-xs cursor-pointer mb-2">
          <input
            type="checkbox"
            checked={radial.clockwise}
            onChange={(event) =>
              onChange({ ...radial, clockwise: event.target.checked })
            }
            className="rounded"
          />
          Clockwise
        </label>
      )}

      <p className="text-[10px] text-muted-foreground mb-2">
        {cameraLabel}
        {!cameraExact && " (stand-in for this payload)"}
      </p>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 mb-2 rounded border border-border bg-background/40 p-2 tabular-nums">
        {(
          [
            ["Horizontal", formatDistance(info.horizontalM, unitSystem)],
            ["Vertical", formatDistance(info.verticalM, unitSystem)],
            [passName, `${info.passes}`],
            ["Photos", `${info.plannedCount}`],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="text-[11px] font-medium">{value}</div>
          </div>
        ))}
      </div>

      {info.plannedCount > waypointCount && (
        <p className="text-[10px] text-orange-300 mb-2">
          Only the first {waypointCount} photos are kept. Increase the spacing
          or shorten the height range to keep them all.
        </p>
      )}
      {info.selfCrossing && (
        <p className="text-[10px] text-orange-300 mb-2">
          The flight path crosses itself. Reduce the target distance.
        </p>
      )}

      <CameraAimSection
        aim={params.aim}
        onChange={(aim) => onChange({ ...params, aim })}
        modes={["structureHeight", "towardPOI", "fixed", "relativeToSurface"]}
        pois={pois}
        structureLabel="Height on structure"
        heightPresets={[
          { label: "Base", height: 0 },
          {
            label: "Middle",
            height:
              Math.round(((params.minAltitude + params.maxAltitude) / 2) * 10) /
              10,
          },
          { label: "Top", height: params.maxAltitude },
        ]}
        defaultFixedPitch={0}
        surfaceHint="Degrees below level (0 = straight at the structure)"
        previewWaypoints={previewWaypoints}
      />
    </>
  );
}
