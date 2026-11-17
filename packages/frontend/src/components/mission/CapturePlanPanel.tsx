import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Footprints,
  MinusCircle,
  X,
} from "lucide-react";
import {
  CAPTURE_OBJECTIVES,
  type CaptureObjective,
  type CaptureSettings,
} from "@droneroute/shared";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { useMissionStore } from "@/store/missionStore";
import { cameraForPayload } from "@/lib/camera";
import { formatDuration } from "@/lib/missionStats";
import {
  OBJECTIVES,
  OPERATOR_NOTICE,
  compileCapturePlan,
  type CompiledCapture,
} from "@/lib/capturePlan";

/** The open capture plan, compiled from the current site. Null when none is open. */
export function useCompiledCapture(): CompiledCapture | null {
  const draft = useMissionStore((s) => s.captureDraft);
  const siteFeatures = useMissionStore((s) => s.siteFeatures);
  const obstacles = useMissionStore((s) => s.obstacles);
  const config = useMissionStore((s) => s.config);
  return useMemo(() => {
    if (!draft) return null;
    const feature = siteFeatures.find((f) => f.id === draft.featureId);
    if (!feature || feature.vertices.length < 3) return null;
    const { camera, exact } = cameraForPayload(config.payloadEnumValue);
    return compileCapturePlan({
      planId: draft.planId,
      objective: draft.objective,
      feature,
      siteFeatures,
      obstacles,
      settings: draft.settings,
      camera,
      cameraExact: exact,
      config,
    });
  }, [draft, siteFeatures, obstacles, config]);
}

/** Which settings each objective uses. */
const SETTING_FIELDS: {
  key: keyof CaptureSettings;
  label: string;
  title: string;
  min: number;
  max: number;
  uses: (o: CaptureObjective) => boolean;
}[] = [
  {
    key: "facadeStandoffM",
    label: "Facade distance (m)",
    title: "How far from each wall the facade photos are taken",
    min: 2,
    max: 50,
    uses: (o) => o !== "roof_inspection",
  },
  {
    key: "roofClearanceM",
    label: "Above roof (m)",
    title: "Height above the roof for the straight-down roof photos",
    min: 5,
    max: 100,
    uses: (o) => o !== "facade_inspection",
  },
  {
    key: "obliqueOffsetM",
    label: "Angled offset (m)",
    title:
      "For angled roof photos: distance outside the outline and height above the roof. Equal values look down at 45°.",
    min: 3,
    max: 50,
    uses: (o) => o !== "facade_inspection",
  },
  {
    key: "siteAltitudeM",
    label: "Site altitude (m)",
    title: "Height above take-off for the site photos",
    min: 20,
    max: 120,
    uses: (o) => o === "exterior_baseline",
  },
  {
    key: "assumedHeightM",
    label: "Assumed height (m)",
    title: "Building height used when the site feature has none",
    min: 2,
    max: 200,
    uses: () => true,
  },
];

/**
 * Plan the capture of one building from what the inspection is for: which
 * parts to photograph and how, as routes made by the templates. The operator
 * reviews the checklist and the preview on the map, then adds the routes.
 */
export function CapturePlanPanel() {
  const draft = useMissionStore((s) => s.captureDraft);
  const siteFeatures = useMissionStore((s) => s.siteFeatures);
  const updateCaptureDraft = useMissionStore((s) => s.updateCaptureDraft);
  const closeCapturePlan = useMissionStore((s) => s.closeCapturePlan);
  const applyCapturePlan = useMissionStore((s) => s.applyCapturePlan);
  const compiled = useCompiledCapture();

  if (!draft) return null;
  const feature = siteFeatures.find((f) => f.id === draft.featureId);
  const objective = OBJECTIVES[draft.objective];

  return (
    <div className="absolute top-4 left-4 z-20 w-[400px] max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)] overflow-y-auto rounded-lg border border-emerald-400/50 bg-card/95 p-3 shadow-2xl backdrop-blur-sm">
      <div className="flex items-start gap-2">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            Capture plan: {feature?.name ?? "building"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {draft.existing
              ? "This building already has a plan. Updating replaces its routes."
              : "Proposed routes are shown on the map. Nothing is added until you add them."}
          </div>
        </div>
        <button
          onClick={closeCapturePlan}
          className="text-muted-foreground hover:text-foreground"
          title="Close without adding routes"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!feature || !compiled ? (
        <p className="mt-2 text-xs text-orange-300">
          The building is gone or its outline has fewer than 3 corners.
        </p>
      ) : (
        <>
          <div className="mt-2">
            <select
              value={draft.objective}
              onChange={(e) =>
                updateCaptureDraft({
                  objective: e.target.value as CaptureObjective,
                })
              }
              className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
              title="What the inspection is for"
            >
              {CAPTURE_OBJECTIVES.map((o) => (
                <option key={o} value={o}>
                  {OBJECTIVES[o].label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {objective.description}
            </p>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            {SETTING_FIELDS.filter((f) => f.uses(draft.objective)).map((f) => (
              <label key={f.key} title={f.title}>
                <div className="text-[10px] text-muted-foreground">
                  {f.label}
                </div>
                <NumericInput
                  value={draft.settings[f.key]}
                  onChange={(v) =>
                    updateCaptureDraft({
                      settings: { ...draft.settings, [f.key]: v },
                    })
                  }
                  min={f.min}
                  max={f.max}
                  step={1}
                  fallback={draft.settings[f.key]}
                  className="h-7 text-xs"
                />
              </label>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-1">
            {compiled.elements.map((e) => (
              <div
                key={e.element}
                className="flex items-start gap-2 rounded border border-border bg-background/40 px-2 py-1.5"
              >
                {e.status === "planned" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : e.status === "missing" ? (
                  <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                ) : (
                  <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{e.label}</div>
                  {e.status === "planned" ? (
                    <div className="text-[10px] text-muted-foreground">
                      {e.waypoints} WP · about {e.photos} photos ·{" "}
                      {formatDuration(e.timeS)}
                    </div>
                  ) : (
                    <div
                      className={`text-[10px] ${e.status === "missing" ? "text-amber-300" : "text-muted-foreground"}`}
                    >
                      {e.note}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 text-xs">
            <span className="font-semibold">
              {compiled.totals.routes} route
              {compiled.totals.routes === 1 ? "" : "s"}
            </span>{" "}
            · about {formatDuration(compiled.totals.timeS)} flying ·{" "}
            {compiled.totals.batteries} batter
            {compiled.totals.batteries === 1 ? "y" : "ies"} · about{" "}
            {compiled.totals.photos} photos
          </div>
          <div className="text-[10px] text-muted-foreground">
            Flight time leaves out the flights between routes and to and from
            take-off.
          </div>

          {compiled.issues.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {compiled.issues.map((issue, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-1.5 text-[11px] ${issue.conflict ? "text-red-400" : "text-orange-300"}`}
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {issue.message}
                </div>
              ))}
            </div>
          )}

          <div className="mt-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Assumptions
            </div>
            <ul className="mt-0.5 list-disc pl-4 text-[11px] text-muted-foreground">
              {compiled.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>

          <div className="mt-2">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Footprints className="h-3 w-3" />
              Better from the ground
            </div>
            <ul className="mt-0.5 list-disc pl-4 text-[11px] text-muted-foreground">
              {compiled.groundFollowUp.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>

          <p className="mt-2 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-200">
            {OPERATOR_NOTICE}
          </p>

          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={closeCapturePlan}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={compiled.totals.routes === 0}
              onClick={() => applyCapturePlan(compiled)}
              title="Add the routes to the mission. Each stays editable, and undo removes them."
            >
              {draft.existing ? "Update" : "Add"} {compiled.totals.routes} route
              {compiled.totals.routes === 1 ? "" : "s"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
