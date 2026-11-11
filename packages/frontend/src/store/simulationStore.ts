import { create } from "zustand";

export const SIMULATION_RATES = [1, 2, 5, 10, 30] as const;

interface SimulationState {
  /** True while the flight preview is open. */
  active: boolean;
  playing: boolean;
  /** Playback speed multiplier. */
  rate: number;
  /** Elapsed mission time in seconds. */
  timeS: number;
  open: () => void;
  close: () => void;
  setPlaying: (playing: boolean) => void;
  setRate: (rate: number) => void;
  seek: (timeS: number) => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  active: false,
  playing: false,
  rate: 10,
  timeS: 0,
  open: () => set({ active: true, playing: true, timeS: 0 }),
  close: () => set({ active: false, playing: false, timeS: 0 }),
  setPlaying: (playing) => set({ playing }),
  setRate: (rate) => set({ rate }),
  seek: (timeS) => set({ timeS: Math.max(0, timeS) }),
}));
