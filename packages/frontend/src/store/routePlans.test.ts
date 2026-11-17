import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_ORBIT_PARAMS, polygonFacadeAround } from "@/lib/templates";
import { routeEdited, runPlan, type PlanInput } from "@/lib/routePlan";
import { HISTORY_COALESCE_MS, useMissionStore } from "./missionStore";

const store = () => useMissionStore.getState();

function tick() {
  vi.advanceTimersByTime(HISTORY_COALESCE_MS + 1);
}

const HOUSE: [number, number][] = [
  [42.559, -71.078],
  [42.559, -71.0778],
  [42.5592, -71.0778],
  [42.5592, -71.078],
];

/** Apply a template the way the draw handlers do. */
function apply(input: PlanInput, targetFeatureId?: string) {
  const result = runPlan(input, store().pois);
  store().setTemplateMode(
    input.generator === "boundaryFacade"
      ? "facade"
      : (input.generator as "orbit"),
  );
  store().appendWaypoints(result.waypoints, result.pois, {
    ...input,
    targetFeatureId,
  });
  return store().routes.at(-1)!;
}

function flown(routeId: string) {
  return store()
    .waypoints.filter((wp) => wp.routeId === routeId)
    .map((wp) => ({ ...wp, index: 0, name: "" }));
}

describe("route plans", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    store().clearMission();
    store().clearHistory();
    tick();
  });

  function addHouse() {
    store().addSiteFeature(HOUSE, "existing", { heightM: 8 });
    return store().siteFeatures.at(-1)!.id;
  }

  it("keeps the template settings on the route it makes", () => {
    const house = addHouse();
    const route = apply(
      { generator: "boundaryFacade", params: polygonFacadeAround(HOUSE, 8) },
      house,
    );
    expect(route.plan).toMatchObject({
      generator: "boundaryFacade",
      targetFeatureId: house,
      generatorVersion: 1,
    });
    expect(route.plan!.params).toMatchObject({ vertices: HOUSE });
    expect(routeEdited(route, store().waypoints)).toBe(false);
  });

  it("hand-placed routes have no plan", () => {
    store().addWaypoint(1, 1);
    expect(store().routes[0].plan).toBeUndefined();
  });

  it("regenerates the same waypoints when nothing changed", () => {
    const house = addHouse();
    store().addWaypoint(42.558, -71.079); // another route first
    const route = apply(
      { generator: "boundaryFacade", params: polygonFacadeAround(HOUSE, 8) },
      house,
    );
    const before = flown(route.id);
    const others = store().waypoints.filter((wp) => wp.routeId !== route.id);
    tick();
    expect(store().regenerateRoute(route.id)).toBe(true);
    expect(flown(route.id)).toEqual(before);
    expect(store().waypoints.filter((wp) => wp.routeId !== route.id)).toEqual(
      others,
    );
  });

  it("follows the building's current outline, as one undo step", () => {
    const house = addHouse();
    const route = apply(
      { generator: "boundaryFacade", params: polygonFacadeAround(HOUSE, 8) },
      house,
    );
    const before = flown(route.id);
    tick();
    const bigger = HOUSE.map(([lat, lng], i) =>
      i >= 2 ? [lat + 0.0002, lng] : [lat, lng],
    ) as [number, number][];
    store().setSiteFeatureVertices(house, bigger);
    tick();
    store().regenerateRoute(route.id);
    const after = flown(route.id);
    expect(after).not.toEqual(before);
    const plan = store().routes.find((r) => r.id === route.id)!.plan!;
    expect(plan.params).toMatchObject({ vertices: bigger });
    expect(
      routeEdited(
        store().routes.find((r) => r.id === route.id)!,
        store().waypoints,
      ),
    ).toBe(false);

    store().undo();
    expect(flown(route.id)).toEqual(before);
  });

  it("marks a route edited by hand, and regenerating clears it", () => {
    const route = apply({
      generator: "orbit",
      params: {
        ...DEFAULT_ORBIT_PARAMS,
        center: [42.559, -71.078],
        radiusM: 20,
      },
    });
    const first = store().waypoints.find((wp) => wp.routeId === route.id)!;
    store().updateWaypoint(first.index, { height: first.height + 3 });
    const edited = () =>
      routeEdited(
        store().routes.find((r) => r.id === route.id)!,
        store().waypoints,
      );
    expect(edited()).toBe(true);
    store().regenerateRoute(route.id);
    expect(edited()).toBe(false);
  });

  it("reuses the orbit's POI instead of adding another", () => {
    const route = apply({
      generator: "orbit",
      params: {
        ...DEFAULT_ORBIT_PARAMS,
        center: [42.559, -71.078],
        radiusM: 20,
        createPoi: true,
      },
    });
    expect(store().pois).toHaveLength(1);
    const poiId = store().pois[0].id;
    expect(route.plan!.poiId).toBe(poiId);
    store().regenerateRoute(route.id);
    expect(store().pois.map((p) => p.id)).toEqual([poiId]);
    const linked = store()
      .waypoints.filter((wp) => wp.routeId === route.id)
      .every((wp) => wp.poiId === poiId);
    expect(linked).toBe(true);
  });

  it("keeps the plan through save and reload", () => {
    const house = addHouse();
    const route = apply(
      { generator: "boundaryFacade", params: polygonFacadeAround(HOUSE, 8) },
      house,
    );
    const saved = JSON.parse(
      JSON.stringify({
        name: "Saved",
        config: store().config,
        waypoints: store().waypoints,
        pois: store().pois,
        siteFeatures: store().siteFeatures,
        routes: store().routes,
      }),
    );
    store().clearMission();
    store().loadMission(saved);
    const loaded = store().routes.find((r) => r.id === route.id)!;
    expect(loaded.plan).toEqual(route.plan);
    expect(routeEdited(loaded, store().waypoints)).toBe(false);
    const before = flown(route.id);
    expect(store().regenerateRoute(route.id)).toBe(true);
    expect(flown(route.id)).toEqual(before);
  });

  it("refuses to regenerate a route without a plan", () => {
    store().addWaypoint(1, 1);
    expect(store().regenerateRoute(store().routes[0].id)).toBe(false);
    expect(store().waypoints).toHaveLength(1);
  });
});
