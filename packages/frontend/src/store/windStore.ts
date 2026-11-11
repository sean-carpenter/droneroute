import { create } from "zustand";
import { fetchWind, type WindReading } from "@/lib/wind";

const LS_KEY = "windAdvisoryEnabled";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === "true";
  } catch {
    return false;
  }
}

interface WindState {
  /** Off by default: enabling it sends an approximate position to Open-Meteo. */
  enabled: boolean;
  reading: WindReading | null;
  loading: boolean;
  error: string | null;
  setEnabled: (enabled: boolean) => void;
  refresh: (
    latitude: number,
    longitude: number,
    altitudeM: number,
    force?: boolean,
  ) => Promise<void>;
}

let requestId = 0;

export const useWindStore = create<WindState>((set, get) => ({
  enabled: readEnabled(),
  reading: null,
  loading: false,
  error: null,

  setEnabled: (enabled) => {
    try {
      localStorage.setItem(LS_KEY, String(enabled));
    } catch {
      // Storage unavailable — the toggle still works for this session
    }
    set(enabled ? { enabled } : { enabled, reading: null, error: null });
  },

  refresh: async (latitude, longitude, altitudeM, force = false) => {
    if (!get().enabled) return;
    const id = ++requestId;
    set({ loading: true, error: null });
    try {
      const reading = await fetchWind(latitude, longitude, altitudeM, {
        force,
      });
      if (id === requestId && get().enabled) set({ reading, loading: false });
    } catch {
      if (id === requestId) {
        set({ loading: false, error: "Wind data unavailable" });
      }
    }
  },
}));
