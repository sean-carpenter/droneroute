import { AlertTriangle, Info, X } from "lucide-react";
import { useState } from "react";

export interface Warning {
  id: string;
  type: "battery" | "obstacle" | "airspace" | "wind";
  /** Red styling for conditions that should stop the flight. */
  critical?: boolean;
  /** Blue styling for things worth knowing that need no action. */
  info?: boolean;
  message: string;
}

interface WarningsPanelProps {
  warnings: Warning[];
}

export function WarningsPanel({ warnings }: WarningsPanelProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (warnings.length === 0) return null;

  const visible = warnings.filter((w) => !dismissed.has(w.id));
  if (visible.length === 0) return null;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] flex flex-col gap-1.5 pointer-events-none max-w-[600px] w-full px-4">
      {visible.map((w) => {
        const isProhibited = w.id === "airspace-prohibited" || !!w.critical;
        const isInfo = !isProhibited && !!w.info;
        const tone = isProhibited ? "red" : isInfo ? "sky" : "orange";
        const borderColor = {
          red: "border-red-400",
          sky: "border-sky-400",
          orange: "border-orange-400",
        }[tone];
        const bgColor = {
          red: "bg-red-600/90",
          sky: "bg-sky-700/90",
          orange: "bg-orange-600/90",
        }[tone];
        const iconColor = {
          red: "text-red-100",
          sky: "text-sky-100",
          orange: "text-orange-100",
        }[tone];
        const dismissColor = {
          red: "text-red-200/70",
          sky: "text-sky-200/70",
          orange: "text-orange-200/70",
        }[tone];
        const Icon = isInfo ? Info : AlertTriangle;
        return (
          <div
            key={w.id}
            className={`pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-lg border-2 ${borderColor} ${bgColor} text-white text-xs font-medium shadow-lg backdrop-blur-sm`}
          >
            <Icon className={`h-3.5 w-3.5 ${iconColor} shrink-0`} />
            <span className="flex-1">{w.message}</span>
            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(w.id))}
              className={`shrink-0 ${dismissColor} hover:text-white transition-colors`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
