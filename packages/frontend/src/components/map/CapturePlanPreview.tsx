import { useMemo } from "react";
import { useCompiledCapture } from "@/components/mission/CapturePlanPanel";
import { TemplatePreview } from "./TemplatePreview";
import type { TemplateResult } from "@/lib/templates";

/** The open capture plan's routes on the map, in flight order, before they are added. */
export function CapturePlanPreview() {
  const compiled = useCompiledCapture();
  const result: TemplateResult | null = useMemo(() => {
    if (!compiled) return null;
    const waypoints = compiled.elements.flatMap(
      (e) => e.route?.result.waypoints ?? [],
    );
    return waypoints.length > 0 ? { waypoints, pois: [] } : null;
  }, [compiled]);
  return result ? <TemplatePreview result={result} /> : null;
}
