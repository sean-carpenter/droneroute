import { useRef, useEffect } from "react";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, MapPin } from "lucide-react";
import { usePreferencesStore } from "@/store/preferencesStore";
import {
  heightLabel,
  speedLabel,
  distanceLabel,
  toDisplayHeight,
  fromDisplayHeight,
  toDisplaySpeed,
  fromDisplaySpeed,
  toDisplayDistance,
  fromDisplayDistance,
  speedRange,
} from "@/lib/units";
import type {
  TemplateType,
  OrbitParams,
  GridParams,
  FacadeParams,
  PencilParams,
  CorridorParams,
  TowerParams,
  TemplateResult,
} from "@/lib/templates";
import { corridorLayout, gridSpacing } from "@/lib/templates";
import { cameraForPayload } from "@/lib/camera";
import { useMissionStore } from "@/store/missionStore";
import { SurveyFields } from "./SurveyFields";
import { CameraAimSection } from "./CameraAimSection";
import type { PointOfInterest } from "@droneroute/shared";

const NO_WAYPOINTS: TemplateResult["waypoints"] = [];

interface TemplateConfigPanelProps {
  type: TemplateType;
  orbitParams?: OrbitParams | null;
  gridParams?: GridParams | null;
  facadeParams?: FacadeParams | null;
  pencilParams?: PencilParams | null;
  corridorParams?: CorridorParams | null;
  onCorridorChange?: (params: CorridorParams) => void;
  towerParams?: TowerParams | null;
  onTowerChange?: (params: TowerParams) => void;
  /** Generated waypoints, used for the survey read-outs. */
  previewWaypoints?: TemplateResult["waypoints"];
  onOrbitChange?: (params: OrbitParams) => void;
  onGridChange?: (params: GridParams) => void;
  onFacadeChange?: (params: FacadeParams) => void;
  onPencilChange?: (params: PencilParams) => void;
  onApply: () => void;
  onCancel: () => void;
  waypointCount: number;
  pois?: PointOfInterest[];
}

export function TemplateConfigPanel({
  type,
  orbitParams,
  gridParams,
  facadeParams,
  pencilParams,
  corridorParams,
  onCorridorChange,
  towerParams,
  onTowerChange,
  previewWaypoints = NO_WAYPOINTS,
  onOrbitChange,
  onGridChange,
  onFacadeChange,
  onPencilChange,
  onApply,
  onCancel,
  waypointCount,
  pois,
}: TemplateConfigPanelProps) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const payloadEnumValue = useMissionStore((s) => s.config.payloadEnumValue);
  const { camera, exact: cameraExact } = cameraForPayload(payloadEnumValue);
  const title =
    type === "orbit"
      ? "Orbit"
      : type === "grid"
        ? "Grid survey"
        : type === "facade"
          ? "Facade scan"
          : type === "corridor"
            ? "Corridor survey"
            : type === "tower"
              ? "Tower inspection"
              : "Pencil path";
  const description =
    type === "orbit"
      ? "Circular flight path around a center point. Adjust the radius, number of points, and enable POI to keep the camera focused on the center."
      : type === "grid"
        ? "Lawn-mower zigzag pattern for systematic area coverage. Control line spacing for overlap and rotation to align with the terrain."
        : type === "facade"
          ? "Vertical scanning pattern along a wall or building face. Set the standoff distance, altitude range, and grid density for full coverage."
          : type === "corridor"
            ? "Parallel survey lines along the path you drew, for roads, rivers and power lines. Set the corridor width and overlap; the number of lines follows from the camera footprint."
            : type === "tower"
              ? "Circle a mast, chimney or tower while climbing, as one continuous spiral or a stack of level orbits. The camera can track the base, mid-point or any height."
              : "Freehand flight path drawn on the map. Adjust the number of waypoints to control how closely the path is followed.";

  // Stop all pointer/keyboard/wheel events from reaching Leaflet (native DOM level)
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    const events = [
      "mousedown",
      "mouseup",
      "dblclick",
      "wheel",
      "keydown",
      "keyup",
      "pointerdown",
      "pointerup",
      "touchstart",
      "touchend",
    ];
    for (const evt of events) el.addEventListener(evt, stop);
    return () => {
      for (const evt of events) el.removeEventListener(evt, stop);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl p-3 min-w-[320px] max-w-[440px] max-h-[calc(100%-2rem)] overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
            {title}
          </span>
          <Badge variant="secondary" className="text-[10px] gap-1">
            <MapPin className="h-3 w-3" />
            {waypointCount} waypoints
          </Badge>
        </div>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground mb-3">{description}</p>

      {/* Orbit params */}
      {type === "orbit" && orbitParams && onOrbitChange && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label className="text-[10px]">
                Radius ({distanceLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayDistance(orbitParams.radiusM, unitSystem)}
                onChange={(v) =>
                  onOrbitChange({
                    ...orbitParams,
                    radiusM: fromDisplayDistance(v, unitSystem),
                  })
                }
                min={5}
                step={5}
                fallback={5}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">
                Altitude ({heightLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayHeight(orbitParams.altitude, unitSystem)}
                onChange={(v) =>
                  onOrbitChange({
                    ...orbitParams,
                    altitude: fromDisplayHeight(v, unitSystem),
                  })
                }
                min={5}
                step={5}
                fallback={30}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">Points</Label>
              <NumericInput
                value={orbitParams.numPoints}
                onChange={(v) =>
                  onOrbitChange({ ...orbitParams, numPoints: v })
                }
                min={3}
                max={72}
                fallback={12}
                integer
                className="h-7 text-xs"
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={orbitParams.clockwise}
                  onChange={(e) =>
                    onOrbitChange({
                      ...orbitParams,
                      clockwise: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                Clockwise
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={orbitParams.createPoi}
                  onChange={(e) =>
                    onOrbitChange({
                      ...orbitParams,
                      createPoi: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                Center POI
              </label>
            </div>
          </div>
          <CameraAimSection
            aim={orbitParams.aim}
            onChange={(aim) => onOrbitChange({ ...orbitParams, aim })}
            modes={[
              "structureHeight",
              "towardPOI",
              "fixed",
              "relativeToSurface",
            ]}
            pois={pois}
            structureLabel="Height at center"
            heightPresets={[
              { label: "Ground", height: 0 },
              {
                label: "Half altitude",
                height: Math.round(orbitParams.altitude * 5) / 10,
              },
            ]}
            surfaceHint="Degrees below level (0 = straight at the center axis)"
            previewWaypoints={previewWaypoints}
          />
        </>
      )}

      {/* Grid mode */}
      {type === "grid" && gridParams && onGridChange && (
        <div className="flex gap-1 mb-2">
          {(
            [
              ["photogrammetry", "Photogrammetry"],
              ["fixedSpacing", "Fixed spacing"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => onGridChange({ ...gridParams, mode })}
              className={`flex-1 px-2 py-1 rounded border text-[11px] transition-colors ${gridParams.mode === mode ? "border-purple-400 bg-purple-500/20 text-purple-200" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Grid params — photogrammetry */}
      {type === "grid" &&
        gridParams &&
        onGridChange &&
        gridParams.mode === "photogrammetry" && (
          <>
            <SurveyFields
              altitude={gridParams.altitude}
              sideOverlap={gridParams.sideOverlap}
              forwardOverlap={gridParams.forwardOverlap}
              photoMode={gridParams.photoMode}
              addPhotos={gridParams.addPhotos}
              {...gridSpacing({ ...gridParams, camera })}
              camera={camera}
              cameraExact={cameraExact}
              previewWaypoints={previewWaypoints}
              onChange={(patch) => onGridChange({ ...gridParams, ...patch })}
            />
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <Label className="text-[10px]">Rotation (°)</Label>
                <NumericInput
                  value={gridParams.rotationDeg}
                  onChange={(v) =>
                    onGridChange({ ...gridParams, rotationDeg: v })
                  }
                  min={-180}
                  max={180}
                  step={5}
                  fallback={0}
                  className="h-7 text-xs"
                />
              </div>
              <div className="flex items-end gap-3 pb-1">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={gridParams.reverse}
                    onChange={(e) =>
                      onGridChange({ ...gridParams, reverse: e.target.checked })
                    }
                    className="rounded"
                  />
                  Reverse
                </label>
                <label
                  className="flex items-center gap-1.5 text-xs cursor-pointer"
                  title="Fly a second set of lines at 90° for better 3D reconstruction"
                >
                  <input
                    type="checkbox"
                    checked={gridParams.crossHatch}
                    onChange={(e) =>
                      onGridChange({
                        ...gridParams,
                        crossHatch: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  Cross-hatch
                </label>
              </div>
            </div>
          </>
        )}

      {/* Corridor params */}
      {type === "corridor" && corridorParams && onCorridorChange && (
        <>
          <SurveyFields
            altitude={corridorParams.altitude}
            sideOverlap={corridorParams.sideOverlap}
            forwardOverlap={corridorParams.forwardOverlap}
            photoMode={corridorParams.photoMode}
            addPhotos={corridorParams.addPhotos}
            {...(({ lineSpacingM, photoIntervalM }) => ({
              lineSpacingM,
              photoIntervalM,
            }))(corridorLayout({ ...corridorParams, camera }))}
            camera={camera}
            cameraExact={cameraExact}
            previewWaypoints={previewWaypoints}
            onChange={(patch) =>
              onCorridorChange({ ...corridorParams, ...patch })
            }
          />
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label className="text-[10px]">
                Corridor width ({distanceLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayDistance(corridorParams.widthM, unitSystem)}
                onChange={(v) =>
                  onCorridorChange({
                    ...corridorParams,
                    widthM: fromDisplayDistance(v, unitSystem),
                  })
                }
                min={5}
                step={10}
                fallback={60}
                className="h-7 text-xs"
              />
            </div>
            <div className="flex items-end justify-between pb-1">
              <span className="text-[10px] text-muted-foreground">
                {
                  corridorLayout({ ...corridorParams, camera }).lineOffsetsM
                    .length
                }{" "}
                line(s)
              </span>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={corridorParams.reverse}
                  onChange={(e) =>
                    onCorridorChange({
                      ...corridorParams,
                      reverse: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                Reverse
              </label>
            </div>
          </div>
          <CameraAimSection
            aim={corridorParams.aim}
            onChange={(aim) => onCorridorChange({ ...corridorParams, aim })}
            modes={["fixed", "towardPOI", "relativeToSurface"]}
            pois={pois}
            defaultFixedPitch={-90}
            surfaceHint="Degrees up from straight down (0 = nadir, 30 = oblique)"
            previewWaypoints={previewWaypoints}
          />
        </>
      )}

      {/* Tower params */}
      {type === "tower" && towerParams && onTowerChange && (
        <>
          <div className="flex gap-1 mb-2">
            {(
              [
                ["helix", "Helix"],
                ["stacked", "Stacked orbits"],
              ] as const
            ).map(([style, label]) => (
              <button
                key={style}
                onClick={() => onTowerChange({ ...towerParams, style })}
                className={`flex-1 px-2 py-1 rounded border text-[11px] transition-colors ${towerParams.style === style ? "border-purple-400 bg-purple-500/20 text-purple-200" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label className="text-[10px]">
                Radius ({distanceLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayDistance(towerParams.radiusM, unitSystem)}
                onChange={(v) =>
                  onTowerChange({
                    ...towerParams,
                    radiusM: fromDisplayDistance(v, unitSystem),
                  })
                }
                min={3}
                step={5}
                fallback={15}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">
                {towerParams.style === "helix" ? "Turns" : "Rings"}
              </Label>
              <NumericInput
                value={towerParams.turns}
                onChange={(v) => onTowerChange({ ...towerParams, turns: v })}
                min={1}
                max={30}
                fallback={4}
                integer
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">
                Min altitude ({heightLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayHeight(towerParams.minAltitude, unitSystem)}
                onChange={(v) => {
                  const metricV = fromDisplayHeight(v, unitSystem);
                  onTowerChange({
                    ...towerParams,
                    minAltitude: metricV,
                    maxAltitude: Math.max(metricV, towerParams.maxAltitude),
                  });
                }}
                min={2}
                step={5}
                fallback={10}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">
                Max altitude ({heightLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayHeight(towerParams.maxAltitude, unitSystem)}
                onChange={(v) =>
                  onTowerChange({
                    ...towerParams,
                    maxAltitude: Math.max(
                      towerParams.minAltitude,
                      fromDisplayHeight(v, unitSystem),
                    ),
                  })
                }
                min={2}
                step={5}
                fallback={50}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">Points per turn</Label>
              <NumericInput
                value={towerParams.pointsPerTurn}
                onChange={(v) =>
                  onTowerChange({ ...towerParams, pointsPerTurn: v })
                }
                min={3}
                max={36}
                fallback={8}
                integer
                className="h-7 text-xs"
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={towerParams.clockwise}
                  onChange={(e) =>
                    onTowerChange({
                      ...towerParams,
                      clockwise: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                Clockwise
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={towerParams.createPoi}
                  onChange={(e) =>
                    onTowerChange({
                      ...towerParams,
                      createPoi: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                Center POI
              </label>
            </div>
          </div>
          <CameraAimSection
            aim={towerParams.aim}
            onChange={(aim) => onTowerChange({ ...towerParams, aim })}
            modes={[
              "structureHeight",
              "towardPOI",
              "relativeToSurface",
              "fixed",
            ]}
            pois={pois}
            structureLabel="Height on structure"
            heightPresets={[
              { label: "Base", height: 0 },
              {
                label: "Mid-point",
                height:
                  Math.round(
                    (towerParams.minAltitude + towerParams.maxAltitude) * 5,
                  ) / 10,
              },
              { label: "Top", height: towerParams.maxAltitude },
            ]}
            defaultFixedPitch={0}
            surfaceHint="Degrees below level (0 = straight at the structure)"
            previewWaypoints={previewWaypoints}
          />
        </>
      )}

      {/* Grid params — fixed spacing */}
      {type === "grid" &&
        gridParams &&
        onGridChange &&
        gridParams.mode === "fixedSpacing" && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label className="text-[10px]">
                Altitude ({heightLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayHeight(gridParams.altitude, unitSystem)}
                onChange={(v) =>
                  onGridChange({
                    ...gridParams,
                    altitude: fromDisplayHeight(v, unitSystem),
                  })
                }
                min={5}
                step={5}
                fallback={80}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">
                Line spacing ({distanceLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayDistance(gridParams.spacingM, unitSystem)}
                onChange={(v) =>
                  onGridChange({
                    ...gridParams,
                    spacingM: fromDisplayDistance(v, unitSystem),
                  })
                }
                min={3}
                step={5}
                fallback={30}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">Rotation (°)</Label>
              <NumericInput
                value={gridParams.rotationDeg}
                onChange={(v) =>
                  onGridChange({ ...gridParams, rotationDeg: v })
                }
                min={-180}
                max={180}
                step={5}
                fallback={0}
                className="h-7 text-xs"
              />
            </div>
            <div className="flex items-end gap-2 pb-1">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={gridParams.addPhotos}
                  onChange={(e) =>
                    onGridChange({ ...gridParams, addPhotos: e.target.checked })
                  }
                  className="rounded"
                />
                Photos
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={gridParams.reverse}
                  onChange={(e) =>
                    onGridChange({ ...gridParams, reverse: e.target.checked })
                  }
                  className="rounded"
                />
                Reverse
              </label>
            </div>
          </div>
        )}

      {/* Facade params */}
      {type === "facade" && facadeParams && onFacadeChange && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label className="text-[10px]">
                Distance from wall ({distanceLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayDistance(facadeParams.distanceM, unitSystem)}
                onChange={(v) =>
                  onFacadeChange({
                    ...facadeParams,
                    distanceM: fromDisplayDistance(v, unitSystem),
                  })
                }
                min={3}
                step={5}
                fallback={20}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">
                Min altitude ({heightLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayHeight(facadeParams.minAltitude, unitSystem)}
                onChange={(v) => {
                  const metricV = fromDisplayHeight(v, unitSystem);
                  onFacadeChange({
                    ...facadeParams,
                    minAltitude: metricV,
                    maxAltitude: Math.max(
                      metricV + 5,
                      facadeParams.maxAltitude,
                    ),
                  });
                }}
                min={2}
                step={5}
                fallback={10}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">
                Max altitude ({heightLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayHeight(facadeParams.maxAltitude, unitSystem)}
                onChange={(v) =>
                  onFacadeChange({
                    ...facadeParams,
                    maxAltitude: Math.max(
                      facadeParams.minAltitude + 5,
                      fromDisplayHeight(v, unitSystem),
                    ),
                  })
                }
                min={toDisplayHeight(facadeParams.minAltitude + 5, unitSystem)}
                step={5}
                fallback={30}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">Rows</Label>
              <NumericInput
                value={facadeParams.numRows}
                onChange={(v) =>
                  onFacadeChange({ ...facadeParams, numRows: v })
                }
                min={1}
                max={20}
                fallback={4}
                integer
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">Columns</Label>
              <NumericInput
                value={facadeParams.numColumns}
                onChange={(v) =>
                  onFacadeChange({ ...facadeParams, numColumns: v })
                }
                min={2}
                max={30}
                fallback={8}
                integer
                className="h-7 text-xs"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={facadeParams.addPhotos}
                  onChange={(e) =>
                    onFacadeChange({
                      ...facadeParams,
                      addPhotos: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                Photos
              </label>
            </div>
          </div>
          <CameraAimSection
            aim={facadeParams.aim}
            onChange={(aim) => onFacadeChange({ ...facadeParams, aim })}
            modes={[
              "structureHeight",
              "towardPOI",
              "fixed",
              "relativeToSurface",
            ]}
            pois={pois}
            structureLabel="Height on wall"
            heightPresets={[
              { label: "Base", height: 0 },
              {
                label: "Middle",
                height:
                  Math.round(
                    (facadeParams.minAltitude + facadeParams.maxAltitude) * 5,
                  ) / 10,
              },
              { label: "Top", height: facadeParams.maxAltitude },
            ]}
            defaultFixedPitch={0}
            surfaceHint="Degrees below level (0 = straight at the wall)"
            previewWaypoints={previewWaypoints}
          />
        </>
      )}

      {/* Pencil params */}
      {type === "pencil" && pencilParams && onPencilChange && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label className="text-[10px]">Waypoints</Label>
              <NumericInput
                value={pencilParams.numPoints}
                onChange={(v) =>
                  onPencilChange({ ...pencilParams, numPoints: v })
                }
                min={2}
                max={200}
                fallback={10}
                integer
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">
                Altitude ({heightLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplayHeight(pencilParams.altitude, unitSystem)}
                onChange={(v) =>
                  onPencilChange({
                    ...pencilParams,
                    altitude: fromDisplayHeight(v, unitSystem),
                  })
                }
                min={5}
                step={5}
                fallback={30}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <Label className="text-[10px]">
                Speed ({speedLabel(unitSystem)})
              </Label>
              <NumericInput
                value={toDisplaySpeed(pencilParams.speed, unitSystem)}
                onChange={(v) =>
                  onPencilChange({
                    ...pencilParams,
                    speed: fromDisplaySpeed(v, unitSystem),
                  })
                }
                min={speedRange(unitSystem).min}
                max={speedRange(unitSystem).max}
                step={speedRange(unitSystem).step}
                fallback={7}
                className="h-7 text-xs"
              />
            </div>
            <div className="flex items-end pb-1 gap-3">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={pencilParams.reverse}
                  onChange={(e) =>
                    onPencilChange({
                      ...pencilParams,
                      reverse: e.target.checked,
                    })
                  }
                  className="rounded"
                />
                Reverse
              </label>
            </div>
          </div>
          <CameraAimSection
            aim={pencilParams.aim}
            onChange={(aim) => onPencilChange({ ...pencilParams, aim })}
            modes={["fixed", "towardPOI", "relativeToSurface"]}
            pois={pois}
            surfaceHint="Degrees up from straight down (0 = nadir, 45 = oblique)"
            previewWaypoints={previewWaypoints}
          />
        </>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onApply}
          className="flex-1 h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white"
        >
          <Check className="h-3 w-3 mr-1" />
          Apply
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="h-7 text-xs"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
