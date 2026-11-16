import { useRef, useState } from "react";
import { Eye, EyeOff, FileUp, Loader2, Move, X } from "lucide-react";
import { SITE_DRAWING_LIMITS } from "@droneroute/shared";
import { Button } from "@/components/ui/button";
import { useMissionStore } from "@/store/missionStore";
import { normalizeDegrees } from "@/lib/drawings";
import { addDrawingWithFeedback } from "@/components/mission/addDrawingWithFeedback";

/**
 * Drawings laid over the map, such as a site plan to trace buildings from.
 * Add one with the button or by dropping a one-page PDF on the map.
 */
export function DrawingList() {
  const drawings = useMissionStore((s) => s.drawings);
  const selectedId = useMissionStore((s) => s.selectedDrawingId);
  const selectDrawing = useMissionStore((s) => s.selectDrawing);
  const updateDrawing = useMissionStore((s) => s.updateDrawing);
  const removeDrawing = useMissionStore((s) => s.removeDrawing);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    await addDrawingWithFeedback(file);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-1 border-b border-border/50 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          Drawings ({drawings.length})
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => fileRef.current?.click()}
          disabled={busy || drawings.length >= SITE_DRAWING_LIMITS.maxDrawings}
          title="Lay a one-page PDF drawing over the map to trace from it"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <FileUp className="h-3 w-3" />
          )}
          Add drawing
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      {drawings.length === 0 && (
        <p className="px-1 text-[10px] text-muted-foreground">
          Drop a one-page PDF (a site plan, say) on the map to lay it over the
          satellite view and trace buildings from it.
        </p>
      )}

      {drawings.map((d) => {
        const isSelected = selectedId === d.id;
        return (
          <div
            key={d.id}
            className={`rounded-md border px-2 py-1.5 ${
              isSelected
                ? "border-sky-500/60 bg-sky-500/10"
                : "border-transparent"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <button
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  updateDrawing(d.id, { visible: !d.visible });
                  if (d.visible && isSelected) selectDrawing(null);
                }}
                title={d.visible ? "Hide on the map" : "Show on the map"}
              >
                {d.visible ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </button>
              <input
                value={d.name}
                onChange={(e) => updateDrawing(d.id, { name: e.target.value })}
                onBlur={(e) => {
                  if (!e.target.value.trim()) {
                    updateDrawing(d.id, { name: "Drawing" });
                  }
                }}
                className="min-w-0 flex-1 truncate bg-transparent text-xs font-medium outline-none"
                title="Name"
              />
              <Button
                variant={isSelected ? "default" : "ghost"}
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10px]"
                disabled={!d.visible}
                onClick={() => selectDrawing(isSelected ? null : d.id)}
                title="Show handles to move, resize and rotate it on the map"
              >
                <Move className="h-3 w-3" />
                {isSelected ? "Done" : "Adjust"}
              </Button>
              <button
                className="shrink-0 text-muted-foreground hover:text-red-400"
                onClick={() => removeDrawing(d.id)}
                title="Remove the drawing"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {isSelected && (
              <div className="mt-1.5 flex flex-col gap-1.5 text-[10px] text-muted-foreground">
                <label className="flex items-center gap-2">
                  <span className="w-14 shrink-0">See-through</span>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={Math.round(d.opacity * 100)}
                    onChange={(e) =>
                      updateDrawing(d.id, {
                        opacity: Number(e.target.value) / 100,
                      })
                    }
                    className="flex-1 accent-sky-500"
                    title="Opacity"
                  />
                  <span className="w-8 text-right">
                    {Math.round(d.opacity * 100)}%
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1">
                    Width
                    <input
                      type="number"
                      min={SITE_DRAWING_LIMITS.minWidthM}
                      max={SITE_DRAWING_LIMITS.maxWidthM}
                      step={0.5}
                      value={d.widthM}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (
                          v >= SITE_DRAWING_LIMITS.minWidthM &&
                          v <= SITE_DRAWING_LIMITS.maxWidthM
                        ) {
                          updateDrawing(d.id, { widthM: v });
                        }
                      }}
                      className="h-6 w-16 rounded border border-input bg-background px-1 text-[10px] text-foreground"
                      title="Width of the whole sheet on the ground, in meters"
                    />
                    m
                  </label>
                  <label className="flex items-center gap-1">
                    Rotation
                    <input
                      type="number"
                      step={0.5}
                      value={d.rotationDeg}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          updateDrawing(d.id, {
                            rotationDeg: normalizeDegrees(v),
                          });
                        }
                      }}
                      className="h-6 w-14 rounded border border-input bg-background px-1 text-[10px] text-foreground"
                      title="Clockwise from north, in degrees"
                    />
                    °
                  </label>
                </div>
                <p>
                  On the map, drag the middle to move it, a corner to resize it
                  and the round handle to rotate it.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
