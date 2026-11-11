import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import type {
  MissionConfig,
  PointOfInterest,
  Waypoint,
} from "@droneroute/shared";
import { Button } from "@/components/ui/button";

export interface ImportResult {
  format: "wpml" | "kml" | "gpx" | "litchi";
  config?: MissionConfig;
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  warnings: string[];
}

const FORMAT_LABELS: Record<ImportResult["format"], string> = {
  wpml: "DJI waypoint mission (WPML)",
  kml: "KML path",
  gpx: "GPX route",
  litchi: "Litchi CSV mission",
};

interface ImportPreviewDialogProps {
  fileName: string;
  result: ImportResult;
  /** True when the editor already holds a mission the import could extend. */
  canAppend: boolean;
  onReplace: () => void;
  onAppend: () => void;
  onCancel: () => void;
}

/** Shows what an imported file contains before it changes the mission. */
export function ImportPreviewDialog({
  fileName,
  result,
  canAppend,
  onReplace,
  onAppend,
  onCancel,
}: ImportPreviewDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onCancel]);

  const photoCount = result.waypoints.reduce(
    (sum, wp) =>
      sum + wp.actions.filter((a) => a.actionType === "takePhoto").length,
    0,
  );
  const intervalLegs = result.waypoints.filter(
    (wp) => wp.photoIntervalM,
  ).length;

  const rows: [string, string][] = [
    ["Format", FORMAT_LABELS[result.format]],
    ["Waypoints", String(result.waypoints.length)],
    ["Points of interest", String(result.pois.length)],
    ["Photo actions", String(photoCount)],
    ["Interval capture legs", String(intervalLegs)],
    [
      "Mission settings",
      result.config ? "Included in file" : "Keeps current settings",
    ],
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold">Import preview</h2>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3 truncate">
          {fileName}
        </p>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-3 tabular-nums">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        {result.warnings.length > 0 && (
          <ul className="mb-3 space-y-1 rounded border border-orange-400/40 bg-orange-500/10 p-2 text-[11px] text-orange-200">
            {result.warnings.map((warning) => (
              <li key={warning} className="flex gap-1.5">
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {canAppend && (
            <Button variant="outline" size="sm" onClick={onAppend}>
              Add to mission
            </Button>
          )}
          <Button
            size="sm"
            onClick={onReplace}
            disabled={result.waypoints.length === 0}
          >
            {canAppend ? "Replace mission" : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}
