import { describe, it, expect, beforeEach, vi } from "vitest";
import { compileCapturePlan } from "@/lib/capturePlan";
import { MAVIC_3E_CAMERA } from "@/lib/camera";
import { routeEdited } from "@/lib/routePlan";
import { HISTORY_COALESCE_MS, useMissionStore } from "./missionStore";

const store = () => useMissionStore.getState();

function tick() {
  vi.advanceTimersByTime(HISTORY_COALESCE_MS + 1);
}

const HOUSE: [number, number][] = [
  [42.559, -71.078],
  [42.559, -71.0777],
  [42.5591, -71.0777],
  [42.5591, -71.078],
];

/** Compile the open draft the way the panel does. */
function compileDraft() {
  const draft = store().captureDraft!;
  const feature = store().siteFeatures.find((f) => f.id === draft.featureId)!;
  return compileCapturePlan({
    planId: draft.planId,
    objective: draft.objective,
    feature,
    siteFeatures: store().siteFeatures,
    obstacles: store().obstacles,
    settings: draft.settings,
    camera: MAVIC_3E_CAMERA,
    cameraExact: true,
    config: store().config,
  });
}

describe("capture plans in the mission", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    store().clearMission();
    store().clearHistory();
    tick();
    store().addSiteFeature(HOUSE, "existing", { name: "House", heightM: 7 });
  });

  const house = () => store().siteFeatures[0].id;
  const captureRoutes = () =>
    store().routes.filter((r) => r.plan?.capture?.featureId === house());

  it("adds one route per planned part, each remembering the plan", () => {
    store().addWaypoint(42.5585, -71.0785); // a hand-placed route first
    store().openCapturePlan(house());
    expect(store().captureDraft).toMatchObject({
      featureId: house(),
      objective: "exterior_baseline",
      existing: false,
    });
    tick();
    store().applyCapturePlan(compileDraft());
    expect(store().captureDraft).toBeNull();
    // No lot drawn: everything but site context
    expect(captureRoutes().map((r) => r.name)).toEqual([
      "Roof, straight down (House)",
      "Roof, angled (House)",
      "North facade (House)",
      "East facade (House)",
      "South facade (House)",
      "West facade (House)",
    ]);
    for (const route of captureRoutes()) {
      expect(routeEdited(route, store().waypoints)).toBe(false);
    }
    expect(store().routes[0].name).toBe("Route 1");

    store().undo();
    expect(captureRoutes()).toHaveLength(0);
    expect(store().waypoints).toHaveLength(1);
  });

  it("reopens the existing plan and replaces its routes in place", () => {
    store().openCapturePlan(house());
    store().applyCapturePlan(compileDraft());
    store().addRoute();
    store().addWaypoint(42.5585, -71.0785);
    const before = store().routes.map((r) => r.name);
    const planId = captureRoutes()[0].plan!.capture!.planId;

    store().openCapturePlan(house());
    expect(store().captureDraft).toMatchObject({ planId, existing: true });
    store().updateCaptureDraft({
      settings: { ...store().captureDraft!.settings, facadeStandoffM: 8 },
    });
    store().applyCapturePlan(compileDraft());

    expect(store().routes.map((r) => r.name)).toEqual(before);
    const north = captureRoutes().find((r) =>
      r.name.startsWith("North facade"),
    )!;
    expect(north.plan!.capture!.settings.facadeStandoffM).toBe(8);
    expect(store().routes.at(-1)!.kind).toBe("manual");
  });

  it("regenerates a capture route to the same waypoints", () => {
    store().openCapturePlan(house());
    store().applyCapturePlan(compileDraft());
    const north = captureRoutes().find((r) =>
      r.name.startsWith("North facade"),
    )!;
    const flown = () =>
      store()
        .waypoints.filter((wp) => wp.routeId === north.id)
        .map((wp) => ({ ...wp, index: 0, name: "" }));
    const before = flown();
    expect(store().regenerateRoute(north.id)).toBe(true);
    expect(flown()).toEqual(before);
  });

  it("closes the plan when another mission opens", () => {
    store().openCapturePlan(house());
    store().clearMission();
    expect(store().captureDraft).toBeNull();
  });
});

describe("capture plans for a building without a height", () => {
  beforeEach(() => {
    store().clearMission();
    store().addSiteFeature(HOUSE, "existing", { name: "House" });
  });

  it("records the assumed height on the building when the routes are added", () => {
    const id = store().siteFeatures[0].id;
    store().openCapturePlan(id);
    store().applyCapturePlan(compileDraft());
    expect(store().siteFeatures[0].heightM).toBe(8);
  });
});
