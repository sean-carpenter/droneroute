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

describe("site features", () => {
  const square: [number, number][] = [
    [42.559, -71.078],
    [42.559, -71.0778],
    [42.5592, -71.0778],
    [42.5592, -71.078],
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    store().clearMission();
    store().clearHistory();
    tick();
  });

  it("adds a feature with its kind's name, color and obstacle setting", () => {
    store().addSiteFeature(square, "garage");
    tick();
    store().addSiteFeature(square, "garage");
    tick();
    store().addSiteFeature(square, "lot", { heightM: 3, source: "map" });
    const [first, second, lot] = store().siteFeatures;
    expect([first.name, second.name, lot.name]).toEqual([
      "Garage",
      "Garage 2",
      "Lot",
    ]);
    expect(first.color).toBe("#f59e0b");
    expect(first.isObstacle).toBe(true);
    expect(lot.isObstacle).toBe(false);
    expect(lot.heightM).toBe(3);
    expect(lot.source).toBe("map");
    expect(store().selectedSiteFeatureId).toBe(lot.id);
  });

  it("finishes the drawing tool as a site feature when one is being drawn", () => {
    store().startDrawingSiteFeature("addition");
    expect(store().isDrawingObstacle).toBe(true);
    expect(store().drawingSiteFeatureKind).toBe("addition");
    store().setIsDrawingObstacle(false);
    expect(store().drawingSiteFeatureKind).toBeNull();
    store().startDrawingSiteFeature("addition");
    store().addSiteFeature(square, "addition");
    expect(store().isDrawingObstacle).toBe(false);
    expect(store().drawingSiteFeatureKind).toBeNull();
    expect(store().obstacles).toHaveLength(0);
  });

  it("undoes adding, moving and editing a feature", () => {
    store().addSiteFeature(square, "existing");
    const id = store().siteFeatures[0].id;
    tick();
    const moved = square.map(
      ([lat, lng]) => [lat + 0.0001, lng] as [number, number],
    );
    store().setSiteFeatureVertices(id, moved);
    tick();
    store().updateSiteFeature(id, { color: "#123456", name: "House" });

    store().undo();
    expect(store().siteFeatures[0].color).toBe("#94a3b8");
    store().undo();
    expect(store().siteFeatures[0].vertices).toEqual(square);
    store().undo();
    expect(store().siteFeatures).toHaveLength(0);
  });

  it("keeps at least three corners", () => {
    store().addSiteFeature(square, "other");
    const id = store().siteFeatures[0].id;
    store().setSiteFeatureVertices(id, square.slice(0, 2));
    expect(store().siteFeatures[0].vertices).toHaveLength(4);
  });

  it("selects one thing at a time and loads with the mission", () => {
    store().addObstacle(square);
    store().addSiteFeature(square, "other");
    expect(store().selectedObstacleId).toBeNull();
    store().selectObstacle(store().obstacles[0].id);
    expect(store().selectedSiteFeatureId).toBeNull();

    const features = store().siteFeatures;
    store().loadMission({
      name: "Saved",
      config: store().config,
      waypoints: [],
      siteFeatures: features,
    });
    expect(store().siteFeatures).toEqual(features);
    expect(store().past).toHaveLength(0);
    store().loadMission({
      name: "Old mission",
      config: store().config,
      waypoints: [],
    });
    expect(store().siteFeatures).toEqual([]);
  });
});

describe("drawings", () => {
  const drawing = {
    name: "Site plan",
    image: "data:image/png;base64,iVBORw0KGgo=",
    widthPx: 3600,
    heightPx: 2400,
    center: [42.559, -71.078] as [number, number],
    widthM: 60,
    rotationDeg: 0,
    opacity: 0.7,
    visible: true,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    store().clearMission();
    store().clearHistory();
    tick();
  });

  it("adds, selects, updates and removes a drawing, each undoable", () => {
    const id = store().addDrawing(drawing);
    expect(store().drawings).toEqual([{ ...drawing, id }]);
    expect(store().selectedDrawingId).toBe(id);
    expect(store().dirty).toBe(true);

    tick();
    store().updateDrawing(id, { rotationDeg: 15, widthM: 72 });
    expect(store().drawings[0]).toMatchObject({ rotationDeg: 15, widthM: 72 });

    tick();
    store().undo();
    expect(store().drawings[0]).toMatchObject({ rotationDeg: 0, widthM: 60 });
    store().redo();
    expect(store().drawings[0].rotationDeg).toBe(15);

    tick();
    store().removeDrawing(id);
    expect(store().drawings).toEqual([]);
    store().undo();
    expect(store().drawings).toHaveLength(1);
  });

  it("is loaded with a mission and cleared with it", () => {
    store().loadMission({
      name: "Saved",
      config: store().config,
      waypoints: [],
      drawings: [{ ...drawing, id: "d1" }],
    });
    expect(store().drawings).toHaveLength(1);
    expect(store().selectedDrawingId).toBeNull();
    expect(store().past).toHaveLength(0);

    store().clearMission();
    expect(store().drawings).toEqual([]);
  });
});
