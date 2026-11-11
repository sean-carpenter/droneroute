import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { ProposalSuggestion, RouteProposal } from "@droneroute/shared";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { useMissionStore } from "@/store/missionStore";
import { useProposalStore } from "@/store/proposalStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { suggestionToSeed, transformProposal } from "@/lib/proposal";
import { polygonArea, formatArea } from "@/lib/geo";

const KIND_LABELS: Record<ProposalSuggestion["kind"], string> = {
  grid: "Grid survey",
  corridor: "Corridor survey",
  orbit: "Orbit",
  tower: "Tower inspection",
  facade: "Facade scan",
};

const ANCHOR_LABELS: Record<RouteProposal["site"]["anchorSource"], string> = {
  coordinates: "Placed from coordinates in the documents",
  geocoded: "Placed from the address — check it against the map",
  estimated: "Position is a rough estimate — move it into place",
};

/**
 * Review of a route proposal drafted by an AI agent: what it found, what it
 * assumed, and one button per suggested mission. Also lists pending
 * proposals when none is open.
 */
export function ProposalPanel() {
  const proposals = useProposalStore((s) => s.proposals);
  const active = useProposalStore((s) => s.active);
  const transform = useProposalStore((s) => s.transform);
  const { fetchProposals, open, close, setTransform, setStatus, remove } =
    useProposalStore.getState();
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const templateMode = useMissionStore((s) => s.templateMode);

  const [listOpen, setListOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Load proposals at start and whenever the user comes back to the tab
  // (they have usually just been talking to an agent in another window).
  useEffect(() => {
    void fetchProposals();
    const onFocus = () => void fetchProposals();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchProposals]);

  // Open a proposal named in the link the agent handed over
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("proposal");
    if (!id) return;
    window.history.replaceState({}, "", window.location.pathname);
    open(id).catch(() => toast.error("That route proposal could not be found"));
  }, [open]);

  const shown = useMemo(
    () => (active ? transformProposal(active, transform) : null),
    [active, transform],
  );

  const pending = proposals.filter((p) => p.status === "pending");

  if (!active || !shown) {
    if (pending.length === 0) return null;
    return (
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-80 max-w-[calc(100%-2rem)]">
        <button
          onClick={() => setListOpen((v) => !v)}
          className="mx-auto flex items-center gap-1.5 rounded-full border border-cyan-400/60 bg-card/95 px-3 py-1.5 text-xs font-medium text-cyan-200 shadow-lg backdrop-blur-sm hover:bg-cyan-500/10"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {pending.length} route proposal{pending.length > 1 ? "s" : ""} to
          review
        </button>
        {listOpen && (
          <ul className="mt-1.5 rounded-lg border border-border bg-card/95 p-1 shadow-2xl backdrop-blur-sm">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center gap-1">
                <button
                  className="flex-1 truncate rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    setListOpen(false);
                    open(p.id).catch(() =>
                      toast.error("That route proposal could not be opened"),
                    );
                  }}
                >
                  {p.title}
                </button>
                <button
                  className="p-1.5 text-muted-foreground hover:text-destructive"
                  title="Delete proposal"
                  onClick={() => void remove(p.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const useSuggestion = (suggestion: ProposalSuggestion) => {
    const seed = suggestionToSeed(shown, suggestion);
    if (!seed) {
      toast.error(
        "This suggestion refers to something missing from the proposal",
      );
      return;
    }
    const store = useMissionStore.getState();

    // Structures become POIs so the camera has something to aim at
    if (seed.type === "orbit" || seed.type === "tower") {
      seed.params.createPoi = true;
    }
    store.startTemplateFromSeed(seed);
    setCollapsed(true);
  };

  const finish = async (status: "accepted" | "dismissed") => {
    try {
      await setStatus(active.id, status);
    } catch {
      // The review still closes; the proposal just stays listed as pending
    }
    close();
    void fetchProposals();
  };

  const area = shown.boundary ? polygonArea(shown.boundary) : 0;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-[440px] max-w-[calc(100%-2rem)] max-h-[60%] overflow-y-auto rounded-lg border border-cyan-400/50 bg-card/95 p-3 shadow-2xl backdrop-blur-sm">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{shown.title}</div>
          {shown.sourceNote && (
            <div className="truncate text-[10px] text-muted-foreground">
              {shown.sourceNote}
            </div>
          )}
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-muted-foreground hover:text-foreground"
          title={collapsed ? "Show details" : "Hide details"}
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={close}
          className="text-muted-foreground hover:text-foreground"
          title="Close without deciding"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="mt-2 text-[11px] text-muted-foreground">
            {shown.site.address && <div>{shown.site.address}</div>}
            <div
              className={
                shown.site.anchorSource === "coordinates"
                  ? ""
                  : "text-orange-300"
              }
            >
              {ANCHOR_LABELS[shown.site.anchorSource]}
            </div>
            {area > 0 && <div>Site area: {formatArea(area, unitSystem)}</div>}
            {shown.boundaryClosureErrorM !== undefined &&
              shown.boundaryClosureErrorM > 0.5 && (
                <div className="text-orange-300">
                  Boundary did not close by{" "}
                  {shown.boundaryClosureErrorM.toFixed(1)} m
                </div>
              )}
          </div>

          {/* Move / rotate */}
          <div className="mt-2 flex items-end gap-2 rounded border border-border bg-background/40 p-2">
            <div className="flex-1 text-[10px] text-muted-foreground">
              Drag the round handle on the map to move the site. Rotate it here
              if the outline is turned.
            </div>
            <div className="w-24">
              <div className="text-[10px] text-muted-foreground">
                Rotation (°)
              </div>
              <NumericInput
                value={transform.rotationDeg}
                onChange={(v) => setTransform({ rotationDeg: v })}
                min={-180}
                max={180}
                step={1}
                fallback={0}
                className="h-7 text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                setTransform({ eastM: 0, northM: 0, rotationDeg: 0 })
              }
            >
              Reset
            </Button>
          </div>

          {(shown.warnings.length > 0 || shown.assumptions.length > 0) && (
            <div className="mt-2 space-y-1.5 text-[11px]">
              {shown.warnings.length > 0 && (
                <ul className="space-y-1 rounded border border-orange-400/40 bg-orange-500/10 p-2 text-orange-200">
                  {shown.warnings.map((w) => (
                    <li key={w} className="flex gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}
              {shown.assumptions.length > 0 && (
                <div className="rounded border border-border p-2 text-muted-foreground">
                  <div className="mb-0.5 font-medium text-foreground">
                    Assumed by the agent
                  </div>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {shown.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Suggested missions */}
      <div className="mt-2 space-y-1.5">
        {shown.suggestions.map((suggestion, i) => (
          <div
            key={`${suggestion.kind}-${suggestion.targetId}-${i}`}
            className="flex items-start gap-2 rounded border border-border p-2"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">
                {suggestion.title}
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                  {KIND_LABELS[suggestion.kind]}
                </span>
              </div>
              {!collapsed && (
                <div className="text-[11px] text-muted-foreground">
                  {suggestion.rationale}
                </div>
              )}
            </div>
            <Button
              size="sm"
              className="h-7 shrink-0 text-xs"
              disabled={templateMode !== null}
              title={
                templateMode !== null
                  ? "Apply or cancel the open template first"
                  : "Open this as a template you can adjust before applying"
              }
              onClick={() => useSuggestion(suggestion)}
            >
              Use
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => void finish("dismissed")}
        >
          Dismiss proposal
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => void finish("accepted")}
        >
          <Check className="h-3 w-3" />
          Done
        </Button>
      </div>
    </div>
  );
}
