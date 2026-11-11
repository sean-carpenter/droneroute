import { create } from "zustand";
import type { RouteProposal, RouteProposalStatus } from "@droneroute/shared";
import { api } from "@/lib/api";
import { NO_TRANSFORM, type ProposalTransform } from "@/lib/proposal";

interface ProposalState {
  proposals: RouteProposal[];
  /** Proposal being reviewed on the map. */
  active: RouteProposal | null;
  /** How far the user has moved/rotated the active proposal. */
  transform: ProposalTransform;
  fetchProposals: () => Promise<void>;
  open: (id: string) => Promise<void>;
  close: () => void;
  setTransform: (transform: Partial<ProposalTransform>) => void;
  setStatus: (id: string, status: RouteProposalStatus) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useProposalStore = create<ProposalState>((set, get) => ({
  proposals: [],
  active: null,
  transform: NO_TRANSFORM,

  fetchProposals: async () => {
    try {
      set({ proposals: await api.get<RouteProposal[]>("/proposals") });
    } catch {
      // Not signed in or offline: there is simply nothing to show
      set({ proposals: [] });
    }
  },

  open: async (id) => {
    const active = await api.get<RouteProposal>(`/proposals/${id}`);
    set({ active, transform: NO_TRANSFORM });
  },

  close: () => set({ active: null, transform: NO_TRANSFORM }),

  setTransform: (transform) =>
    set((state) => ({ transform: { ...state.transform, ...transform } })),

  setStatus: async (id, status) => {
    await api.patch(`/proposals/${id}`, { status });
    set((state) => ({
      proposals: state.proposals.map((p) =>
        p.id === id ? { ...p, status } : p,
      ),
      active:
        state.active?.id === id ? { ...state.active, status } : state.active,
    }));
  },

  remove: async (id) => {
    await api.delete(`/proposals/${id}`);
    set((state) => ({
      proposals: state.proposals.filter((p) => p.id !== id),
      ...(get().active?.id === id
        ? { active: null, transform: NO_TRANSFORM }
        : {}),
    }));
  },
}));
