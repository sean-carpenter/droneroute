import { create } from "zustand";
import { DEFAULT_MAP_VIEW, type MapViewState } from "@droneroute/shared";
import { api } from "@/lib/api";

interface ConfigState {
  selfHosted: boolean;
  /** Personal instance with no sign-in: everything saves to a local workspace. */
  singleUser: boolean;
  googleClientId: string | null;
  mapboxToken: string;
  defaultMapView: MapViewState;
  loaded: boolean;
  fetchConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  selfHosted: true,
  singleUser: false,
  googleClientId: null,
  mapboxToken: "",
  defaultMapView: DEFAULT_MAP_VIEW,
  loaded: false,

  fetchConfig: async () => {
    try {
      const res = await api.get<{
        selfHosted: boolean;
        singleUser?: boolean;
        googleClientId?: string;
        mapboxToken?: string;
        defaultMapView?: MapViewState;
      }>("/config");
      set({
        selfHosted: res.selfHosted,
        singleUser: res.singleUser === true,
        googleClientId: res.googleClientId ?? null,
        mapboxToken: res.mapboxToken ?? "",
        defaultMapView: res.defaultMapView ?? DEFAULT_MAP_VIEW,
        loaded: true,
      });
    } catch {
      // Fallback to self-hosted if config endpoint fails
      set({
        selfHosted: true,
        singleUser: false,
        googleClientId: null,
        mapboxToken: "",
        defaultMapView: DEFAULT_MAP_VIEW,
        loaded: true,
      });
    }
  },
}));
