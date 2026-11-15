import { useState } from "react";
import { toast } from "sonner";
import { Home, LocateFixed, Pencil, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMissionStore } from "@/store/missionStore";
import { useConfigStore } from "@/store/configStore";
import {
  formatCoordinates,
  lookupAddress,
  parseCoordinates,
  type AddressMatch,
} from "@/lib/home";

/**
 * The mission home: one box that takes an address or "lat, lng". Once set it
 * shows the address and coordinates, with buttons to centre the map on it,
 * change it or remove it. The marker on the map can be dragged to fine-tune.
 */
export function MissionHome() {
  const home = useMissionStore((s) => s.config.home);
  const setConfig = useMissionStore((s) => s.setConfig);
  const focusHome = useMissionStore((s) => s.focusHome);
  const mapboxToken = useConfigStore((s) => s.mapboxToken);

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<AddressMatch[] | null>(null);

  const close = () => {
    setEditing(false);
    setText("");
    setMatches(null);
  };

  const apply = (next: {
    latitude: number;
    longitude: number;
    address?: string;
  }) => {
    setConfig({ home: next });
    focusHome();
    close();
  };

  const submit = async () => {
    const query = text.trim();
    if (!query || searching) return;

    const coords = parseCoordinates(query);
    if (coords) {
      apply(coords);
      return;
    }
    if (query.length < 3) {
      toast.warning("Enter an address, or coordinates as lat, lng");
      return;
    }

    setSearching(true);
    try {
      const found = await lookupAddress(query, mapboxToken, home);
      if (found.length === 0) {
        toast.warning("No match for that address");
        setMatches(null);
      } else if (found.length === 1) {
        apply(found[0]);
      } else {
        setMatches(found);
      }
    } catch (err: any) {
      toast.error(err.message || "Address lookup failed");
    } finally {
      setSearching(false);
    }
  };

  if (home && !editing) {
    const coords = formatCoordinates(home.latitude, home.longitude);
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 pl-2 pr-0.5 h-8">
        <Home className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1 leading-tight" title={coords}>
          <div className="truncate text-xs font-medium">
            {home.address || coords}
          </div>
          {home.address && (
            <div className="truncate text-[10px] text-muted-foreground">
              {coords}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          title="Center the map on the mission home"
          onClick={focusHome}
        >
          <LocateFixed className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          title="Change the mission home"
          onClick={() => {
            setText(home.address || coords);
            setEditing(true);
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          title="Remove the mission home"
          onClick={() => setConfig({ home: undefined })}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="relative flex-1">
          <Home className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-400" />
          <Input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMatches(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && editing) close();
            }}
            autoFocus={editing}
            className="h-8 pl-7 text-xs border-emerald-500/30 bg-emerald-500/5 focus-visible:ring-emerald-500/40"
            placeholder="Mission home: address or lat, lng"
            title="Where this mission is based. Type an address, or coordinates as lat, lng, and press Enter"
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={searching || !text.trim()}
          title="Set the mission home"
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
        {editing && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            title="Cancel"
            onClick={close}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </form>
      {matches && (
        <div className="mt-1 overflow-hidden rounded-md border border-border bg-background">
          {matches.map((match) => (
            <button
              key={`${match.latitude},${match.longitude},${match.address}`}
              type="button"
              className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-accent"
              title={match.address}
              onClick={() => apply(match)}
            >
              {match.address}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
