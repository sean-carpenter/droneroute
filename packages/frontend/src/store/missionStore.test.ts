import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  HISTORY_COALESCE_MS,
  HISTORY_LIMIT,
  useMissionStore,
} from "./missionStore";

const store = () => useMissionStore.getState();

/** Move the clock far enough that the next edit is its own undo step. */
function tick() {
  vi.advanceTimersByTime(HISTORY_COALESCE_MS + 1);
}

describe("mission history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    store().clearMission();
    store().clearHistory();
    tick();
  });

  it("undoes and redoes adding waypoints", () => {
    store().addWaypoint(1, 1);
    tick();
    store().addWaypoint(2, 2);
    expect(store().waypoints).toHaveLength(2);

    store().undo();
    expect(store().waypoints).toHaveLength(1);
    store().undo();
    expect(store().waypoints).toHaveLength(0);
    store().undo(); // nothing left — no-op
    expect(store().waypoints).toHaveLength(0);

    store().redo();
    store().redo();
    expect(store().waypoints.map((w) => w.latitude)).toEqual([1, 2]);
    expect(store().future).toHaveLength(0);
  });

  it("collapses rapid edits into one step", () => {
    store().addWaypoint(1, 1);
    tick();
    // A drag: many moves in quick succession
    for (let i = 0; i < 10; i++) {
      store().moveWaypoint(0, 1 + i / 100, 1);
      vi.advanceTimersByTime(16);
    }
    store().undo();
    expect(store().waypoints[0].latitude).toBe(1);
  });

  it("drops the redo stack after a new edit", () => {
    store().addWaypoint(1, 1);
    tick();
    store().addWaypoint(2, 2);
    store().undo();
    tick();
    store().addWaypoint(3, 3);
    expect(store().future).toHaveLength(0);
    store().redo();
    expect(store().waypoints.map((w) => w.latitude)).toEqual([1, 3]);
  });

  it("covers config, POIs, obstacles and clearing the mission", () => {
    store().setConfig({ autoFlightSpeed: 3 });
    tick();
    store().addPoi(5, 5);
    tick();
    store().addObstacle([
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
    tick();
    store().clearMission();
    expect(store().pois).toHaveLength(0);

    store().undo();
    expect(store().pois).toHaveLength(1);
    expect(store().obstacles).toHaveLength(1);
    expect(store().config.autoFlightSpeed).toBe(3);
    store().undo();
    expect(store().obstacles).toHaveLength(0);
    store().undo();
    expect(store().pois).toHaveLength(0);
    store().undo();
    expect(store().config.autoFlightSpeed).not.toBe(3);
  });

  it("does not record selection or UI changes", () => {
    store().addWaypoint(1, 1);
    tick();
    const steps = store().past.length;
    store().selectWaypoint(0);
    store().setTemplateMode("grid");
    store().setIsAddingPoi(true);
    expect(store().past).toHaveLength(steps);
  });

  it("clears the selection when restoring", () => {
    store().addWaypoint(1, 1);
    tick();
    store().addWaypoint(2, 2);
    expect(store().selectedWaypointIndices.size).toBe(1);
    store().undo();
    expect(store().selectedWaypointIndices.size).toBe(0);
  });

  it("starts a fresh history when a mission is loaded", () => {
    store().addWaypoint(1, 1);
    tick();
    store().loadMission({
      name: "Loaded",
      config: store().config,
      waypoints: [],
    });
    expect(store().past).toHaveLength(0);
    store().undo();
    expect(store().missionName).toBe("Loaded");
  });

  it("caps the number of undo steps", () => {
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      store().addWaypoint(i, i);
      tick();
    }
    expect(store().past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("selection helpers", () => {
  beforeEach(() => {
    store().clearMission();
    for (let i = 0; i < 4; i++) store().addWaypoint(i, i);
  });

  it("replaces or extends the selection", () => {
    store().setWaypointSelection([0, 1]);
    expect([...store().selectedWaypointIndices]).toEqual([0, 1]);
    store().setWaypointSelection([3], true);
    expect([...store().selectedWaypointIndices].sort()).toEqual([0, 1, 3]);
    store().setWaypointSelection([]);
    expect(store().selectedWaypointIndices.size).toBe(0);
  });

  it("applies a relative change to selected waypoints only", () => {
    store().setWaypointSelection([1, 2]);
    store().mapSelectedWaypoints((wp) => ({ ...wp, height: wp.height + 10 }));
    expect(store().waypoints.map((w) => w.height)).toEqual([30, 40, 40, 30]);
  });

  it("appends imported waypoints with fresh indices", () => {
    const imported = store().waypoints.slice(0, 2);
    store().appendImported(imported);
    expect(store().waypoints.map((w) => w.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(store().waypoints[5].name).toBe("Waypoint 6");
  });
});
