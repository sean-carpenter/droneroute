import { describe, it, expect } from "vitest";
import {
  validateMissionCreate,
  validateMissionUpdate,
  validateMissionGeometry,
} from "./missionValidation.js";

const validWaypoint = {
  index: 0,
  name: "WP1",
  latitude: 41.25,
  longitude: 0.93,
  height: 30,
  speed: 5,
  gimbalPitchAngle: 0,
};

const validCreate = {
  name: "Test mission",
  config: { autoFlightSpeed: 5 },
  waypoints: [validWaypoint, { ...validWaypoint, index: 1, longitude: 0.94 }],
  pois: [],
  obstacles: [],
};

describe("validateMissionCreate", () => {
  it("accepts a well-formed mission", () => {
    expect(validateMissionCreate(validCreate)).toBeNull();
  });

  it("rejects a missing or blank name", () => {
    expect(validateMissionCreate({ ...validCreate, name: "" })).toBe(
      "invalid mission name",
    );
    expect(validateMissionCreate({ ...validCreate, name: "   " })).toBe(
      "invalid mission name",
    );
    expect(validateMissionCreate({ ...validCreate, name: 123 })).toBe(
      "invalid mission name",
    );
  });

  it("rejects an over-long name", () => {
    expect(
      validateMissionCreate({ ...validCreate, name: "x".repeat(201) }),
    ).toBe("invalid mission name");
  });

  it("rejects a non-object config", () => {
    expect(validateMissionCreate({ ...validCreate, config: "nope" })).toBe(
      "invalid mission config",
    );
    expect(validateMissionCreate({ ...validCreate, config: [1, 2] })).toBe(
      "invalid mission config",
    );
  });

  it("rejects waypoints that are not an array", () => {
    expect(validateMissionCreate({ ...validCreate, waypoints: {} })).toBe(
      "waypoints must be an array",
    );
  });

  it("rejects out-of-range coordinates", () => {
    expect(
      validateMissionCreate({
        ...validCreate,
        waypoints: [{ ...validWaypoint, latitude: 91 }],
      }),
    ).toBe("waypoint coordinates out of range");
    expect(
      validateMissionCreate({
        ...validCreate,
        waypoints: [{ ...validWaypoint, longitude: 200 }],
      }),
    ).toBe("waypoint coordinates out of range");
  });

  it("rejects non-finite coordinates (NaN / Infinity)", () => {
    expect(
      validateMissionCreate({
        ...validCreate,
        waypoints: [{ ...validWaypoint, latitude: Number.NaN }],
      }),
    ).toBe("waypoint coordinates out of range");
    expect(
      validateMissionCreate({
        ...validCreate,
        waypoints: [{ ...validWaypoint, height: Number.POSITIVE_INFINITY }],
      }),
    ).toBe("invalid waypoint height");
  });

  it("rejects too many waypoints (DoS guard)", () => {
    const waypoints = Array.from({ length: 5001 }, (_, i) => ({
      ...validWaypoint,
      index: i,
    }));
    expect(validateMissionCreate({ ...validCreate, waypoints })).toBe(
      "too many waypoints",
    );
  });

  it("validates POIs and obstacles", () => {
    expect(
      validateMissionCreate({
        ...validCreate,
        pois: [{ name: "P", latitude: 200, longitude: 0, height: 1 }],
      }),
    ).toBe("POI coordinates out of range");
    expect(
      validateMissionCreate({
        ...validCreate,
        obstacles: [{ name: "O", vertices: [[91, 0]] }],
      }),
    ).toBe("obstacle vertex out of range");
    expect(
      validateMissionCreate({
        ...validCreate,
        obstacles: [{ name: "O", vertices: [[41, 0, 5]] }],
      }),
    ).toBe("obstacle vertex out of range");
  });

  it("accepts an obstacle with or without a height, and rejects a bad one", () => {
    const square = [
      [41, 0],
      [41, 1],
      [42, 1],
    ];
    const withHeight = (height: unknown) => ({
      ...validCreate,
      obstacles: [{ name: "Trees", vertices: square, height }],
    });
    expect(validateMissionCreate(withHeight(25))).toBeNull();
    expect(validateMissionCreate(withHeight(0))).toBeNull();
    expect(validateMissionCreate(withHeight(null))).toBeNull();
    expect(validateMissionCreate(withHeight(undefined))).toBeNull();
    for (const bad of [-1, 1001, "25", Number.NaN]) {
      expect(validateMissionCreate(withHeight(bad))).toBe(
        "invalid obstacle height",
      );
    }
  });
});

describe("mission home", () => {
  const withHome = (home: unknown) => ({
    ...validCreate,
    config: { ...validCreate.config, home },
  });

  it("accepts a home with or without an address", () => {
    expect(
      validateMissionCreate(withHome({ latitude: 38.58, longitude: -121.49 })),
    ).toBeNull();
    expect(
      validateMissionCreate(
        withHome({ latitude: 38.58, longitude: -121.49, address: "1 Main St" }),
      ),
    ).toBeNull();
  });

  it("rejects a malformed home on create and update", () => {
    expect(validateMissionCreate(withHome("here"))).toBe(
      "invalid mission home",
    );
    expect(
      validateMissionCreate(withHome({ latitude: 95, longitude: 0 })),
    ).toBe("mission home coordinates out of range");
    expect(
      validateMissionUpdate({
        config: { home: { latitude: 1, longitude: 2, address: 5 } },
      }),
    ).toBe("invalid mission home address");
  });
});

describe("validateMissionUpdate", () => {
  it("accepts an empty partial update", () => {
    expect(validateMissionUpdate({})).toBeNull();
  });

  it("only validates fields that are present", () => {
    expect(validateMissionUpdate({ name: "New name" })).toBeNull();
    expect(validateMissionUpdate({ name: "" })).toBe("invalid mission name");
    expect(validateMissionUpdate({ waypoints: "bad" })).toBe(
      "waypoints must be an array",
    );
  });
});

describe("validateMissionGeometry", () => {
  it("accepts valid geometry without requiring name/config", () => {
    expect(
      validateMissionGeometry({ waypoints: validCreate.waypoints }),
    ).toBeNull();
  });

  it("rejects invalid geometry", () => {
    expect(
      validateMissionGeometry({
        waypoints: [{ ...validWaypoint, latitude: 999 }],
      }),
    ).toBe("waypoint coordinates out of range");
  });
});

describe("drone home point", () => {
  const withTakeoff = (takeoff: unknown) => ({
    ...validCreate,
    config: { ...validCreate.config, takeoff },
  });

  it("accepts a point with or without an elevation", () => {
    expect(
      validateMissionCreate(
        withTakeoff({ latitude: 38.58, longitude: -121.49 }),
      ),
    ).toBeNull();
    expect(
      validateMissionCreate(
        withTakeoff({ latitude: 38.58, longitude: -121.49, elevationM: 12.5 }),
      ),
    ).toBeNull();
    expect(validateMissionCreate(withTakeoff(undefined))).toBeNull();
  });

  it("rejects a malformed point on create and update", () => {
    expect(validateMissionCreate(withTakeoff("here"))).toBe(
      "invalid drone home point",
    );
    expect(
      validateMissionCreate(withTakeoff({ latitude: 95, longitude: 0 })),
    ).toBe("drone home point coordinates out of range");
    expect(
      validateMissionCreate(
        withTakeoff({ latitude: 38, longitude: 0, elevationM: "high" }),
      ),
    ).toBe("invalid drone home point elevation");
    expect(
      validateMissionUpdate({
        config: { ...validCreate.config, takeoff: { latitude: 0 } },
      }),
    ).toBe("drone home point coordinates out of range");
  });
});

describe("site features", () => {
  const square: [number, number][] = [
    [42.559, -71.078],
    [42.559, -71.0778],
    [42.5592, -71.0778],
  ];
  const feature = (extra: Record<string, unknown> = {}) => ({
    id: "f1",
    name: "Existing house",
    kind: "existing",
    color: "#94a3b8",
    vertices: square,
    isObstacle: true,
    source: "manual",
    ...extra,
  });
  const withFeatures = (siteFeatures: unknown) => ({
    ...validCreate,
    siteFeatures,
  });

  it("accepts well-formed features, with or without height", () => {
    expect(validateMissionCreate(withFeatures([feature()]))).toBeNull();
    expect(
      validateMissionCreate(
        withFeatures([feature({ heightM: 7.7, note: "Ridge 25'-3\"" })]),
      ),
    ).toBeNull();
    expect(
      validateMissionCreate(withFeatures([feature({ heightM: null })])),
    ).toBeNull();
    expect(validateMissionCreate(validCreate)).toBeNull(); // optional
  });

  it("rejects bad kinds, colors, corners and flags", () => {
    expect(validateMissionCreate(withFeatures("nope"))).toBe(
      "siteFeatures must be an array",
    );
    expect(
      validateMissionCreate(withFeatures([feature({ kind: "shed" })])),
    ).toBe("invalid site feature kind");
    expect(
      validateMissionCreate(withFeatures([feature({ color: "red" })])),
    ).toBe("invalid site feature color");
    expect(
      validateMissionCreate(
        withFeatures([feature({ vertices: square.slice(0, 2) })]),
      ),
    ).toBe("a site feature needs 3 to 500 corners");
    expect(
      validateMissionCreate(
        withFeatures([
          feature({
            vertices: [
              [95, 0],
              [0, 0],
              [1, 1],
            ],
          }),
        ]),
      ),
    ).toBe("site feature corner out of range");
    expect(
      validateMissionCreate(withFeatures([feature({ heightM: -2 })])),
    ).toBe("invalid site feature height");
    expect(
      validateMissionCreate(withFeatures([feature({ isObstacle: "yes" })])),
    ).toBe("invalid site feature obstacle setting");
    expect(
      validateMissionCreate(withFeatures([feature({ source: "osm" })])),
    ).toBe("invalid site feature source");
    expect(
      validateMissionUpdate({ siteFeatures: [feature({ name: "" })] }),
    ).toBe("invalid site feature name");
  });
});
