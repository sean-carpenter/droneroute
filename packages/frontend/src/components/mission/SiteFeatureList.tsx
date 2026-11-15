import { useState } from "react";
import { Building2, Pencil, Settings, X } from "lucide-react";
import { SITE_FEATURE_KINDS, type SiteFeatureKind } from "@droneroute/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { polygonArea, formatArea } from "@/lib/geo";

const KINDS = Object.entries(SITE_FEATURE_KINDS) as [
  SiteFeatureKind,
  (typeof SITE_FEATURE_KINDS)[SiteFeatureKind],
][];

/**
 * Buildings, the lot and other areas on the site. Each has a kind, a color
 * and a name; draw new ones here or click a building on the map to add it.
 */
export function SiteFeatureList() {
  const {
    siteFeatures,
    selectedSiteFeatureId,
    selectSiteFeature,
    updateSiteFeature,
    removeSiteFeature,
    startDrawingSiteFeature,
    drawingSiteFeatureKind,
  } = useMissionStore();
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const [drawKind, setDrawKind] = useState<SiteFeatureKind>("addition");
  const [openEditor, setOpenEditor] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="flex items-center gap-1">
        <select
          value={drawKind}
          onChange={(e) => setDrawKind(e.target.value as SiteFeatureKind)}
          className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          title="What to draw"
        >
          {KINDS.map(([kind, info]) => (
            <option key={kind} value={kind}>
              {info.label}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => startDrawingSiteFeature(drawKind)}
          disabled={drawingSiteFeatureKind !== null}
          title="Click the corners on the map; click the first corner or double-click to finish, Esc to cancel"
        >
          <Pencil className="h-3 w-3" />
          {drawingSiteFeatureKind ? "Drawing…" : "Draw"}
        </Button>
      </div>
      <p className="px-1 text-[10px] text-muted-foreground">
        Or click a building on the map and choose "Add as building".
      </p>

      {siteFeatures.length === 0 && (
        <div className="flex flex-col items-center p-4 text-center text-muted-foreground">
          <Building2 className="mb-2 h-7 w-7 opacity-50" />
          <p className="text-xs">No buildings or areas yet</p>
        </div>
      )}

      {siteFeatures.map((feature) => {
        const isSelected = selectedSiteFeatureId === feature.id;
        const editorOpen = openEditor === feature.id;
        return (
          <div key={feature.id}>
            <div
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                isSelected
                  ? "border-white/40 bg-white/10"
                  : "border-transparent hover:bg-secondary"
              }`}
              onClick={() => selectSiteFeature(isSelected ? null : feature.id)}
            >
              <input
                type="color"
                value={feature.color}
                onChange={(e) =>
                  updateSiteFeature(feature.id, { color: e.target.value })
                }
                onClick={(e) => e.stopPropagation()}
                className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                title="Color"
              />
              <div className="min-w-0 flex-1">
                <input
                  value={feature.name}
                  onChange={(e) =>
                    updateSiteFeature(feature.id, { name: e.target.value })
                  }
                  onBlur={(e) => {
                    if (!e.target.value.trim()) {
                      updateSiteFeature(feature.id, {
                        name: SITE_FEATURE_KINDS[feature.kind].label,
                      });
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full truncate bg-transparent text-xs font-medium outline-none"
                  title="Name"
                />
                <div className="text-[10px] text-muted-foreground">
                  {formatArea(polygonArea(feature.vertices), unitSystem)}
                  {typeof feature.heightM === "number" &&
                    ` · ${feature.heightM} m tall`}
                  {!feature.isObstacle && " · not an obstacle"}
                </div>
              </div>
              <select
                value={feature.kind}
                onChange={(e) => {
                  const kind = e.target.value as SiteFeatureKind;
                  const was = SITE_FEATURE_KINDS[feature.kind];
                  const now = SITE_FEATURE_KINDS[kind];
                  updateSiteFeature(feature.id, {
                    kind,
                    // Follow the new kind's color unless the user picked one.
                    ...(feature.color === was.color
                      ? { color: now.color }
                      : {}),
                    ...(feature.name === was.label ? { name: now.label } : {}),
                    isObstacle: now.isObstacle,
                  });
                }}
                onClick={(e) => e.stopPropagation()}
                className="h-6 shrink-0 rounded border border-input bg-background px-1 text-[10px]"
                title="Kind"
              >
                {KINDS.map(([kind, info]) => (
                  <option key={kind} value={kind}>
                    {info.label}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenEditor(editorOpen ? null : feature.id);
                }}
                title="Height, obstacle setting and notes"
              >
                <Settings className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  removeSiteFeature(feature.id);
                }}
                title="Remove"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>

            {editorOpen && (
              <div
                className="mb-2 ml-4 mr-1 mt-1 space-y-2 rounded-r-md border-l-2 p-3"
                style={{ borderColor: feature.color }}
              >
                <div>
                  <Label className="text-xs">Height (m)</Label>
                  <Input
                    type="number"
                    value={feature.heightM ?? ""}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      updateSiteFeature(feature.id, {
                        heightM: Number.isFinite(value)
                          ? Math.min(1000, Math.max(0, value))
                          : null,
                      });
                    }}
                    min={0}
                    max={1000}
                    placeholder="Not set"
                    className="h-7 text-xs"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={feature.isObstacle}
                    onChange={(e) =>
                      updateSiteFeature(feature.id, {
                        isObstacle: e.target.checked,
                      })
                    }
                  />
                  Treat as obstacle (warn when the route crosses it)
                </label>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <textarea
                    value={feature.note ?? ""}
                    onChange={(e) =>
                      updateSiteFeature(feature.id, { note: e.target.value })
                    }
                    className="h-14 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Anything worth knowing about it"
                  />
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {feature.vertices.length} corners · drag the name on the map
                  to move it, drag a corner to reshape, right-click a corner to
                  remove it
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
