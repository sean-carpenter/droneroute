import { useState } from "react";
import { toast } from "sonner";
import { Crosshair, PlaneTakeoff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMissionStore } from "@/store/missionStore";
import { formatCoordinates, parseCoordinates } from "@/lib/home";

/**
 * The drone home point: where the aircraft takes off and returns to. Type
 * coordinates or drop it on the map, then drag the marker to the launch spot.
 * It is written to the exported KMZ as the reference take-off point.
 */
export function TakeoffPoint() {
  const takeoff = useMissionStore((s) => s.config.takeoff);
  const setConfig = useMissionStore((s) => s.setConfig);
  const placeTakeoff = useMissionStore((s) => s.placeTakeoff);
  const [text, setText] = useState("");

  if (takeoff) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/5 pl-2 pr-0.5 h-8">
        <PlaneTakeoff className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-xs font-medium">Drone home point</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {formatCoordinates(takeoff.latitude, takeoff.longitude)}
          </div>
        </div>
        <Input
          type="number"
          value={takeoff.elevationM ?? ""}
          onChange={(e) => {
            const value = parseFloat(e.target.value);
            setConfig({
              takeoff: {
                latitude: takeoff.latitude,
                longitude: takeoff.longitude,
                ...(Number.isFinite(value) ? { elevationM: value } : {}),
              },
            });
          }}
          className="h-6 w-16 shrink-0 px-1.5 text-[10px]"
          placeholder="Elev. m"
          title="Ground elevation at the drone home point, in meters. Optional; written to the KMZ as 0 when empty"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          title="Remove the drone home point"
          onClick={() => setConfig({ takeoff: undefined })}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mt-1.5 flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const coords = parseCoordinates(text);
        if (!coords) {
          toast.warning(
            "Enter coordinates as lat, lng, or place it on the map",
          );
          return;
        }
        setConfig({ takeoff: coords });
        setText("");
      }}
    >
      <div className="relative flex-1">
        <PlaneTakeoff className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sky-400" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8 pl-7 text-xs border-sky-500/30 bg-sky-500/5 focus-visible:ring-sky-500/40"
          placeholder="Drone home point: lat, lng"
          title="Where the drone takes off and returns to. Type coordinates and press Enter, or place it on the map"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        title="Place the drone home point at the center of the map, then drag it"
        onClick={placeTakeoff}
      >
        <Crosshair className="h-3.5 w-3.5" />
      </Button>
    </form>
  );
}
