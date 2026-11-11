import { create } from "zustand";
import type {
  Waypoint,
  MissionConfig,
  WaypointAction,
  PointOfInterest,
  Obstacle,
} from "@droneroute/shared";
import { DEFAULT_MISSION_CONFIG, DEFAULT_WAYPOINT } from "@droneroute/shared";
import { usePreferencesStore } from "@/store/preferencesStore";
import type { TemplateType } from "@/lib/templates";
import type { TemplateSeed } from "@/lib/proposal";

export type SelectionMode = "replace" | "toggle" | "range";

/** The undoable part of the store: the mission document itself. */
export interface MissionSnapshot {
  missionId: string | null;
  missionName: string;
  config: MissionConfig;
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  obstacles: Obstacle[];
}

/** Maximum number of undo steps kept. */
export const HISTORY_LIMIT = 50;
/** Edits closer together than this collapse into one undo step (drags, typing). */
export const HISTORY_COALESCE_MS = 400;

interface MissionState {
  // Mission metadata
  missionId: string | null;
  missionName: string;
  dirty: boolean;

  // Config
  config: MissionConfig;

  // Waypoints
  waypoints: Waypoint[];
  selectedWaypointIndices: Set<number>;
  lastSelectedWaypointIndex: number | null;

  // POIs
  pois: PointOfInterest[];
  selectedPoiId: string | null;

  // Obstacles
  obstacles: Obstacle[];
  selectedObstacleId: string | null;
  isDrawingObstacle: boolean;
  drawingVertices: [number, number][];

  // History
  past: MissionSnapshot[];
  future: MissionSnapshot[];
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;

  // UI state
  isAddingWaypoint: boolean;
  isAddingPoi: boolean;
  templateMode: TemplateType | null;
  /** Settings a template should open with instead of waiting for a drag. */
  templateSeed: TemplateSeed | null;
  startTemplateFromSeed: (seed: TemplateSeed) => void;
  consumeTemplateSeed: () => void;
  currentPage: "editor" | "routes" | "shared" | "admin";
  shareToken: string | null;
  setCurrentPage: (page: "editor" | "routes" | "shared" | "admin") => void;
  setShareToken: (token: string | null) => void;

  // Waypoint actions
  setMissionName: (name: string) => void;
  setMissionId: (id: string | null) => void;
  setConfig: (config: Partial<MissionConfig>) => void;
  addWaypoint: (lat: number, lng: number) => void;
  updateWaypoint: (index: number, updates: Partial<Waypoint>) => void;
  removeWaypoint: (index: number) => void;
  moveWaypoint: (index: number, lat: number, lng: number) => void;
  selectWaypoint: (index: number | null, mode?: SelectionMode) => void;
  selectAllWaypoints: () => void;
  clearWaypointSelection: () => void;
  /** Select exactly these waypoints, or add them to the current selection. */
  setWaypointSelection: (indices: number[], additive?: boolean) => void;
  removeSelectedWaypoints: () => void;
  updateSelectedWaypoints: (updates: Partial<Waypoint>) => void;
  /** Apply a per-waypoint change to every selected waypoint. */
  mapSelectedWaypoints: (fn: (wp: Waypoint) => Waypoint) => void;
  reorderWaypoints: (fromIndex: number, toIndex: number) => void;
  setIsAddingWaypoint: (adding: boolean) => void;
  addAction: (waypointIndex: number, action: WaypointAction) => void;
  updateAction: (
    waypointIndex: number,
    actionId: number,
    updates: Partial<WaypointAction>,
  ) => void;
  removeAction: (waypointIndex: number, actionId: number) => void;

  // POI actions
  addPoi: (lat: number, lng: number) => void;
  updatePoi: (id: string, updates: Partial<PointOfInterest>) => void;
  removePoi: (id: string) => void;
  movePoi: (id: string, lat: number, lng: number) => void;
  selectPoi: (id: string | null) => void;
  setIsAddingPoi: (adding: boolean) => void;
  setTemplateMode: (mode: TemplateType | null) => void;
  appendWaypoints: (
    waypoints: Omit<Waypoint, "index" | "name">[],
    pois?: Omit<PointOfInterest, "id">[],
  ) => void;

  // Obstacle actions
  addObstacle: (vertices: [number, number][]) => void;
  updateObstacle: (id: string, updates: Partial<Obstacle>) => void;
  removeObstacle: (id: string) => void;
  moveObstacleVertex: (
    id: string,
    vertexIndex: number,
    lat: number,
    lng: number,
  ) => void;
  addObstacleVertex: (
    id: string,
    afterIndex: number,
    lat: number,
    lng: number,
  ) => void;
  removeObstacleVertex: (id: string, vertexIndex: number) => void;
  selectObstacle: (id: string | null) => void;
  setIsDrawingObstacle: (drawing: boolean) => void;
  setDrawingVertices: (vertices: [number, number][]) => void;

  // Mission actions
  /** Add imported waypoints/POIs to the end of the current mission. */
  appendImported: (waypoints: Waypoint[], pois?: PointOfInterest[]) => void;
  loadMission: (data: {
    id?: string;
    name: string;
    config: MissionConfig;
    waypoints: Waypoint[];
    pois?: PointOfInterest[];
    obstacles?: Obstacle[];
  }) => void;
  clearMission: () => void;
  setDirty: (dirty: boolean) => void;
}

const CLEARED_SELECTION = {
  selectedWaypointIndices: new Set<number>(),
  lastSelectedWaypointIndex: null,
  selectedPoiId: null,
  selectedObstacleId: null,
};

function snapshotOf(state: MissionSnapshot): MissionSnapshot {
  return {
    missionId: state.missionId,
    missionName: state.missionName,
    config: state.config,
    waypoints: state.waypoints,
    pois: state.pois,
    obstacles: state.obstacles,
  };
}

/** True when two states hold different mission documents. */
function documentChanged(a: MissionSnapshot, b: MissionSnapshot): boolean {
  return (
    a.waypoints !== b.waypoints ||
    a.pois !== b.pois ||
    a.obstacles !== b.obstacles ||
    a.config !== b.config ||
    a.missionName !== b.missionName
  );
}

// History bookkeeping lives outside the store so it never triggers renders.
let restoringHistory = false;
let lastHistoryPushAt = 0;

export const useMissionStore = create<MissionState>((set, get) => ({
  missionId: null,
  missionName: "New Mission",
  dirty: false,
  config: { ...DEFAULT_MISSION_CONFIG },
  waypoints: [],
  selectedWaypointIndices: new Set<number>(),
  lastSelectedWaypointIndex: null,
  pois: [],
  selectedPoiId: null,
  obstacles: [],
  selectedObstacleId: null,
  isDrawingObstacle: false,
  drawingVertices: [],
  isAddingWaypoint: true,
  isAddingPoi: false,
  templateMode: null,
  templateSeed: null,
  startTemplateFromSeed: (seed) =>
    set({
      templateMode: seed.type,
      templateSeed: seed,
      isAddingWaypoint: false,
      isAddingPoi: false,
      isDrawingObstacle: false,
      selectedWaypointIndices: new Set(),
      selectedPoiId: null,
    }),
  consumeTemplateSeed: () => set({ templateSeed: null }),
  past: [],
  future: [],

  undo: () => {
    const { past, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    restoringHistory = true;
    lastHistoryPushAt = 0;
    set({
      ...previous,
      past: past.slice(0, -1),
      future: [...future, snapshotOf(get())],
      ...CLEARED_SELECTION,
      dirty: true,
    });
    restoringHistory = false;
  },

  redo: () => {
    const { past, future } = get();
    if (future.length === 0) return;
    const next = future[future.length - 1];
    restoringHistory = true;
    lastHistoryPushAt = 0;
    set({
      ...next,
      past: [...past, snapshotOf(get())],
      future: future.slice(0, -1),
      ...CLEARED_SELECTION,
      dirty: true,
    });
    restoringHistory = false;
  },

  clearHistory: () => {
    lastHistoryPushAt = 0;
    set({ past: [], future: [] });
  },

  currentPage: "editor",
  shareToken: null,
  setCurrentPage: (page) => set({ currentPage: page }),
  setShareToken: (token) => set({ shareToken: token }),

  setMissionName: (name) => set({ missionName: name, dirty: true }),
  setMissionId: (id) => set({ missionId: id }),

  setConfig: (updates) =>
    set((state) => ({
      config: { ...state.config, ...updates },
      dirty: true,
    })),

  addWaypoint: (lat, lng) =>
    set((state) => {
      const index = state.waypoints.length;
      const newWaypoint: Waypoint = {
        ...DEFAULT_WAYPOINT,
        index,
        name: `Waypoint ${index + 1}`,
        latitude: lat,
        longitude: lng,
        actions: [],
      };
      return {
        waypoints: [...state.waypoints, newWaypoint],
        selectedWaypointIndices: new Set([index]),
        lastSelectedWaypointIndex: index,
        dirty: true,
      };
    }),

  updateWaypoint: (index, updates) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        wp.index === index ? { ...wp, ...updates } : wp,
      ),
      dirty: true,
    })),

  removeWaypoint: (index) =>
    set((state) => {
      const filtered = state.waypoints
        .filter((wp) => wp.index !== index)
        .map((wp, i) => ({ ...wp, index: i }));

      // Rebuild selection: remove the deleted index, adjust indices above it
      const newSelection = new Set<number>();
      for (const idx of state.selectedWaypointIndices) {
        if (idx === index) continue;
        newSelection.add(idx > index ? idx - 1 : idx);
      }

      return {
        waypoints: filtered,
        selectedWaypointIndices: newSelection,
        lastSelectedWaypointIndex:
          state.lastSelectedWaypointIndex === index
            ? null
            : state.lastSelectedWaypointIndex !== null &&
                state.lastSelectedWaypointIndex > index
              ? state.lastSelectedWaypointIndex - 1
              : state.lastSelectedWaypointIndex,
        dirty: true,
      };
    }),

  moveWaypoint: (index, lat, lng) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        wp.index === index ? { ...wp, latitude: lat, longitude: lng } : wp,
      ),
      dirty: true,
    })),

  selectWaypoint: (index, mode = "replace") =>
    set((state) => {
      if (index === null) {
        return {
          selectedWaypointIndices: new Set<number>(),
          lastSelectedWaypointIndex: null,
        };
      }

      switch (mode) {
        case "replace":
          return {
            selectedWaypointIndices: new Set([index]),
            lastSelectedWaypointIndex: index,
          };

        case "toggle": {
          const next = new Set(state.selectedWaypointIndices);
          if (next.has(index)) {
            next.delete(index);
          } else {
            next.add(index);
          }
          return {
            selectedWaypointIndices: next,
            lastSelectedWaypointIndex: next.size > 0 ? index : null,
          };
        }

        case "range": {
          const anchor = state.lastSelectedWaypointIndex;
          if (anchor === null) {
            return {
              selectedWaypointIndices: new Set([index]),
              lastSelectedWaypointIndex: index,
            };
          }
          const start = Math.min(anchor, index);
          const end = Math.max(anchor, index);
          const rangeSet = new Set(state.selectedWaypointIndices);
          for (let i = start; i <= end; i++) {
            rangeSet.add(i);
          }
          return {
            selectedWaypointIndices: rangeSet,
            // Keep the anchor so subsequent Shift+clicks extend from the same origin
            lastSelectedWaypointIndex: anchor,
          };
        }
      }
    }),

  selectAllWaypoints: () =>
    set((state) => ({
      selectedWaypointIndices: new Set(state.waypoints.map((wp) => wp.index)),
      lastSelectedWaypointIndex: state.waypoints.length > 0 ? 0 : null,
    })),

  clearWaypointSelection: () =>
    set({
      selectedWaypointIndices: new Set<number>(),
      lastSelectedWaypointIndex: null,
    }),

  setWaypointSelection: (indices, additive = false) =>
    set((state) => {
      const next = additive
        ? new Set(state.selectedWaypointIndices)
        : new Set<number>();
      for (const i of indices) next.add(i);
      return {
        selectedWaypointIndices: next,
        lastSelectedWaypointIndex:
          indices.length > 0
            ? indices[indices.length - 1]
            : additive
              ? state.lastSelectedWaypointIndex
              : null,
      };
    }),

  mapSelectedWaypoints: (fn) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        state.selectedWaypointIndices.has(wp.index)
          ? { ...fn(wp), index: wp.index }
          : wp,
      ),
      dirty: true,
    })),

  removeSelectedWaypoints: () =>
    set((state) => {
      if (state.selectedWaypointIndices.size === 0) return state;
      const filtered = state.waypoints
        .filter((wp) => !state.selectedWaypointIndices.has(wp.index))
        .map((wp, i) => ({ ...wp, index: i }));
      return {
        waypoints: filtered,
        selectedWaypointIndices: new Set<number>(),
        lastSelectedWaypointIndex: null,
        dirty: true,
      };
    }),

  updateSelectedWaypoints: (updates) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        state.selectedWaypointIndices.has(wp.index)
          ? { ...wp, ...updates }
          : wp,
      ),
      dirty: true,
    })),

  reorderWaypoints: (fromIndex, toIndex) =>
    set((state) => {
      const items = [...state.waypoints];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      // Re-index after reorder
      const reindexed = items.map((wp, i) => ({ ...wp, index: i }));
      return {
        waypoints: reindexed,
        selectedWaypointIndices: new Set([toIndex]),
        lastSelectedWaypointIndex: toIndex,
        dirty: true,
      };
    }),

  setIsAddingWaypoint: (adding) =>
    set((state) => ({
      isAddingWaypoint: adding,
      isAddingPoi: adding ? false : state.isAddingPoi,
      isDrawingObstacle: adding ? false : state.isDrawingObstacle,
      templateMode: adding ? null : state.templateMode,
    })),

  addAction: (waypointIndex, action) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        wp.index === waypointIndex
          ? { ...wp, actions: [...wp.actions, action] }
          : wp,
      ),
      dirty: true,
    })),

  updateAction: (waypointIndex, actionId, updates) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        wp.index === waypointIndex
          ? {
              ...wp,
              actions: wp.actions.map((a) =>
                a.actionId === actionId ? { ...a, ...updates } : a,
              ),
            }
          : wp,
      ),
      dirty: true,
    })),

  removeAction: (waypointIndex, actionId) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        wp.index === waypointIndex
          ? {
              ...wp,
              actions: wp.actions.filter((a) => a.actionId !== actionId),
            }
          : wp,
      ),
      dirty: true,
    })),

  // POI actions
  addPoi: (lat, lng) =>
    set((state) => {
      const poi: PointOfInterest = {
        id: crypto.randomUUID(),
        name: `POI ${state.pois.length + 1}`,
        latitude: lat,
        longitude: lng,
        height: 0,
      };
      return {
        pois: [...state.pois, poi],
        selectedPoiId: poi.id,
        dirty: true,
      };
    }),

  updatePoi: (id, updates) =>
    set((state) => ({
      pois: state.pois.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      dirty: true,
    })),

  removePoi: (id) =>
    set((state) => ({
      pois: state.pois.filter((p) => p.id !== id),
      selectedPoiId: state.selectedPoiId === id ? null : state.selectedPoiId,
      // Clear poiId references on waypoints
      waypoints: state.waypoints.map((wp) =>
        wp.poiId === id ? { ...wp, poiId: undefined } : wp,
      ),
      dirty: true,
    })),

  movePoi: (id, lat, lng) =>
    set((state) => ({
      pois: state.pois.map((p) =>
        p.id === id ? { ...p, latitude: lat, longitude: lng } : p,
      ),
      dirty: true,
    })),

  selectPoi: (id) => set({ selectedPoiId: id }),

  setIsAddingPoi: (adding) =>
    set((state) => ({
      isAddingPoi: adding,
      isAddingWaypoint: adding ? false : state.isAddingWaypoint,
      isDrawingObstacle: adding ? false : state.isDrawingObstacle,
      templateMode: adding ? null : state.templateMode,
    })),

  // Obstacle actions
  addObstacle: (vertices) =>
    set((state) => {
      const obstacle: Obstacle = {
        id: crypto.randomUUID(),
        name: `Obstacle ${state.obstacles.length + 1}`,
        description: "",
        vertices,
      };
      return {
        obstacles: [...state.obstacles, obstacle],
        selectedObstacleId: obstacle.id,
        isDrawingObstacle: false,
        drawingVertices: [],
        dirty: true,
      };
    }),

  updateObstacle: (id, updates) =>
    set((state) => ({
      obstacles: state.obstacles.map((o) =>
        o.id === id ? { ...o, ...updates } : o,
      ),
      dirty: true,
    })),

  removeObstacle: (id) =>
    set((state) => ({
      obstacles: state.obstacles.filter((o) => o.id !== id),
      selectedObstacleId:
        state.selectedObstacleId === id ? null : state.selectedObstacleId,
      dirty: true,
    })),

  moveObstacleVertex: (id, vertexIndex, lat, lng) =>
    set((state) => ({
      obstacles: state.obstacles.map((o) => {
        if (o.id !== id) return o;
        const vertices = [...o.vertices] as [number, number][];
        vertices[vertexIndex] = [lat, lng];
        return { ...o, vertices };
      }),
      dirty: true,
    })),

  addObstacleVertex: (id, afterIndex, lat, lng) =>
    set((state) => ({
      obstacles: state.obstacles.map((o) => {
        if (o.id !== id) return o;
        const vertices = [...o.vertices] as [number, number][];
        vertices.splice(afterIndex + 1, 0, [lat, lng]);
        return { ...o, vertices };
      }),
      dirty: true,
    })),

  removeObstacleVertex: (id, vertexIndex) =>
    set((state) => ({
      obstacles: state.obstacles.map((o) => {
        if (o.id !== id || o.vertices.length <= 3) return o;
        const vertices = o.vertices.filter(
          (_: [number, number], i: number) => i !== vertexIndex,
        );
        return { ...o, vertices };
      }),
      dirty: true,
    })),

  selectObstacle: (id) => set({ selectedObstacleId: id }),

  setIsDrawingObstacle: (drawing) =>
    set((state) => ({
      isDrawingObstacle: drawing,
      isAddingWaypoint: drawing ? false : state.isAddingWaypoint,
      isAddingPoi: drawing ? false : state.isAddingPoi,
      templateMode: drawing ? null : state.templateMode,
      selectedWaypointIndices: drawing
        ? new Set<number>()
        : state.selectedWaypointIndices,
      selectedPoiId: drawing ? null : state.selectedPoiId,
      drawingVertices: drawing ? [] : state.drawingVertices,
    })),

  setDrawingVertices: (vertices) => set({ drawingVertices: vertices }),

  setTemplateMode: (mode) =>
    set({
      templateMode: mode,
      isAddingWaypoint: false,
      isAddingPoi: false,
      isDrawingObstacle: false,
      selectedWaypointIndices: new Set(),
      selectedPoiId: null,
    }),

  appendWaypoints: (newWps, newPois) =>
    set((state) => {
      const startIndex = state.waypoints.length;
      const fullWaypoints: Waypoint[] = newWps.map((wp, i) => ({
        ...wp,
        index: startIndex + i,
        name: `Waypoint ${startIndex + i + 1}`,
      }));

      const fullPois: PointOfInterest[] = (newPois || []).map((p) => ({
        ...p,
        id: crypto.randomUUID(),
      }));

      // If orbit template created a POI, link the waypoints to it
      if (fullPois.length === 1) {
        const poiId = fullPois[0].id;
        for (const wp of fullWaypoints) {
          if (wp.headingMode === "fixed") {
            // Convert to towardPOI mode for orbit waypoints
            wp.headingMode = "towardPOI";
            wp.poiId = poiId;
          }
        }
      }

      return {
        waypoints: [...state.waypoints, ...fullWaypoints],
        pois: [...state.pois, ...fullPois],
        selectedWaypointIndices: new Set(fullWaypoints.map((wp) => wp.index)),
        lastSelectedWaypointIndex:
          fullWaypoints.length > 0
            ? fullWaypoints[fullWaypoints.length - 1].index
            : state.lastSelectedWaypointIndex,
        templateMode: null,
        dirty: true,
      };
    }),

  appendImported: (newWps, newPois = []) =>
    set((state) => {
      const startIndex = state.waypoints.length;
      const appended = newWps.map((wp, i) => ({
        ...wp,
        index: startIndex + i,
        name: `Waypoint ${startIndex + i + 1}`,
      }));
      return {
        waypoints: [...state.waypoints, ...appended],
        pois: [...state.pois, ...newPois],
        selectedWaypointIndices: new Set(appended.map((wp) => wp.index)),
        lastSelectedWaypointIndex: appended.length
          ? appended[appended.length - 1].index
          : state.lastSelectedWaypointIndex,
        dirty: true,
      };
    }),

  loadMission: (data) => {
    // A freshly loaded mission is a new document: its history starts empty.
    restoringHistory = true;
    lastHistoryPushAt = 0;
    set({
      past: [],
      future: [],
      missionId: data.id || null,
      missionName: data.name,
      config: data.config,
      waypoints: data.waypoints,
      pois: data.pois || [],
      obstacles: data.obstacles || [],
      selectedWaypointIndices: new Set<number>(),
      lastSelectedWaypointIndex: null,
      selectedPoiId: null,
      selectedObstacleId: null,
      dirty: false,
    });
    restoringHistory = false;
  },

  clearMission: () => {
    const prefs = usePreferencesStore.getState().preferences;
    set({
      missionId: null,
      missionName: "New Mission",
      config: { ...DEFAULT_MISSION_CONFIG, ...prefs.missionDefaults },
      waypoints: [],
      pois: [],
      obstacles: [],
      selectedWaypointIndices: new Set<number>(),
      lastSelectedWaypointIndex: null,
      selectedPoiId: null,
      selectedObstacleId: null,
      isDrawingObstacle: false,
      drawingVertices: [],
      dirty: false,
    });
  },

  setDirty: (dirty) => set({ dirty }),
}));

// Record an undo step whenever the mission document changes. Store updates
// are immutable, so comparing references is enough to detect an edit, and
// every mutating action is covered without each one having to opt in.
useMissionStore.subscribe((state, prev) => {
  if (restoringHistory || !documentChanged(state, prev)) return;

  const now = Date.now();
  const coalesce =
    state.past.length > 0 && now - lastHistoryPushAt < HISTORY_COALESCE_MS;
  lastHistoryPushAt = now;

  if (coalesce) {
    if (state.future.length > 0) useMissionStore.setState({ future: [] });
    return;
  }

  useMissionStore.setState({
    past: [...state.past, snapshotOf(prev)].slice(-HISTORY_LIMIT),
    future: [],
  });
});
