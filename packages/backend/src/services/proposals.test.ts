import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../models/db.js";
import { authRoutes } from "../routes/auth.js";
import { proposalRoutes } from "../routes/proposals.js";
import { createMcpRouter } from "../mcp/server.js";
import { validateProposal } from "./proposalValidation.js";
import { convertToWgs84, CoordinateSystemError } from "./coordinateSystems.js";
import { geocodeAddress, GeocodingError } from "./geocoding.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/proposals", proposalRoutes);
app.use("/mcp", createMcpRouter());

const boundary: [number, number][] = [
  [39.5, -98.35],
  [39.501, -98.35],
  [39.501, -98.349],
  [39.5, -98.349],
];

const proposal = (overrides: Record<string, unknown> = {}) => ({
  title: "Lot 12 site survey",
  sourceNote: "Drafted from plat.pdf",
  site: {
    address: "100 Main St",
    anchor: { latitude: 39.5, longitude: -98.35 },
    anchorSource: "geocoded",
  },
  boundary,
  structures: [
    { id: "barn", name: "Barn", latitude: 39.5005, longitude: -98.3495 },
  ],
  alignments: [
    {
      id: "road",
      name: "Access road",
      path: [boundary[0], boundary[2]],
      widthM: 20,
    },
  ],
  suggestions: [
    {
      kind: "grid",
      targetId: "boundary",
      title: "Site map",
      rationale: "Whole-site orthomosaic.",
      altitudeM: 80,
    },
    {
      kind: "orbit",
      targetId: "barn",
      title: "Barn orbit",
      rationale: "Closer look at the barn.",
    },
    {
      kind: "corridor",
      targetId: "road",
      title: "Road corridor",
      rationale: "Follows the access road.",
    },
  ],
  assumptions: ["Bearings treated as true north."],
  warnings: [],
  ...overrides,
});

let token = "";
let otherToken = "";

beforeAll(async () => {
  initDb();
  const a = await request(app)
    .post("/api/auth/register")
    .send({ email: "pilot@test.dev", password: "secret123" });
  const b = await request(app)
    .post("/api/auth/register")
    .send({ email: "other@test.dev", password: "secret123" });
  token = a.body.token;
  otherToken = b.body.token;
});

describe("validateProposal", () => {
  it("accepts a complete proposal and fills defaults", () => {
    const result = validateProposal({
      title: "Tower check",
      site: { anchorSource: "estimated" },
      structures: [
        { id: "t1", name: "Tower", latitude: 39.5, longitude: -98.35 },
      ],
      suggestions: [
        {
          kind: "tower",
          targetId: "t1",
          title: "Spiral",
          rationale: "Tall structure.",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.alignments).toEqual([]);
      expect(result.proposal.warnings).toEqual([]);
    }
  });

  it("rejects suggestions that point at nothing", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ boundary: undefined }, /boundary polygon/],
      [
        {
          suggestions: [
            {
              kind: "orbit",
              targetId: "nope",
              title: "x",
              rationale: "y",
            },
          ],
        },
        /id of a structure/,
      ],
      [
        {
          suggestions: [
            {
              kind: "facade",
              targetId: "barn",
              title: "x",
              rationale: "y",
            },
          ],
        },
        /id of an alignment/,
      ],
    ];
    for (const [overrides, message] of cases) {
      const result = validateProposal(proposal(overrides));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(message);
    }
  });

  it("rejects out-of-range and malformed data", () => {
    const bad = [
      proposal({ boundary: [[95, 0], boundary[1], boundary[2]] }),
      proposal({ title: "" }),
      proposal({ suggestions: [] }),
      proposal({
        structures: [{ id: "bad id!", name: "x", latitude: 0, longitude: 0 }],
      }),
      proposal({
        structures: [
          { id: "a", name: "x", latitude: 0, longitude: 0 },
          { id: "a", name: "y", latitude: 0, longitude: 0 },
        ],
      }),
      proposal({ site: { anchorSource: "vibes" } }),
      "not an object",
      null,
    ];
    for (const input of bad) expect(validateProposal(input).ok).toBe(false);
  });
});

describe("/api/proposals", () => {
  it("requires a session", async () => {
    expect((await request(app).get("/api/proposals")).status).toBe(401);
    expect(
      (await request(app).post("/api/proposals").send(proposal())).status,
    ).toBe(401);
  });

  it("stores, lists, updates and deletes a user's own proposals", async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const created = await request(app)
      .post("/api/proposals")
      .set(auth)
      .send(proposal());
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");
    const id = created.body.id;

    const list = await request(app).get("/api/proposals").set(auth);
    expect(list.body.map((p: { id: string }) => p.id)).toContain(id);

    // Another user can neither see nor change it
    const other = { Authorization: `Bearer ${otherToken}` };
    expect((await request(app).get("/api/proposals").set(other)).body).toEqual(
      [],
    );
    expect(
      (await request(app).get(`/api/proposals/${id}`).set(other)).status,
    ).toBe(404);
    expect(
      (await request(app).delete(`/api/proposals/${id}`).set(other)).status,
    ).toBe(404);

    const patched = await request(app)
      .patch(`/api/proposals/${id}`)
      .set(auth)
      .send({ status: "accepted" });
    expect(patched.status).toBe(200);
    expect(
      (await request(app).get(`/api/proposals/${id}`).set(auth)).body.status,
    ).toBe("accepted");
    expect(
      (
        await request(app)
          .patch(`/api/proposals/${id}`)
          .set(auth)
          .send({ status: "flown" })
      ).status,
    ).toBe(400);

    expect(
      (await request(app).delete(`/api/proposals/${id}`).set(auth)).status,
    ).toBe(200);
    expect(
      (await request(app).get(`/api/proposals/${id}`).set(auth)).status,
    ).toBe(404);
  });

  it("rejects an invalid proposal with a readable reason", async () => {
    const res = await request(app)
      .post("/api/proposals")
      .set({ Authorization: `Bearer ${token}` })
      .send(proposal({ suggestions: [] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid proposal at suggestions/);
  });
});

describe("/mcp", () => {
  const rpc = (
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    request(app)
      .post("/mcp")
      .set({
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...headers,
      })
      .send({ jsonrpc: "2.0", id: 1, ...body });

  /** Streamable HTTP may answer as JSON or as a single SSE event. */
  const parse = (res: request.Response) => {
    if (res.body && Object.keys(res.body).length > 0) return res.body;
    const line = res.text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(line!.slice(6));
  };

  it("requires a bearer token outside single-user mode", async () => {
    const res = await rpc({ method: "tools/list" });
    expect(res.status).toBe(401);
  });

  it("rejects requests for an unexpected host", async () => {
    const res = await rpc(
      { method: "tools/list" },
      { Host: "evil.example", Authorization: `Bearer ${token}` },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("lists the tools", async () => {
    const res = await rpc(
      { method: "tools/list" },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(200);
    const names = parse(res).result.tools.map((t: { name: string }) => t.name);
    expect(names.sort()).toEqual([
      "boundary_from_bearings",
      "convert_coordinates",
      "geocode_address",
      "get_route_planning_guide",
      "list_missions",
      "submit_route_proposal",
    ]);
  });

  it("traces a boundary and stores a submitted proposal", async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const traced = parse(
      await rpc(
        {
          method: "tools/call",
          params: {
            name: "boundary_from_bearings",
            arguments: {
              start: { latitude: 39.5, longitude: -98.35 },
              unit: "m",
              calls: [
                { bearing: "North", distance: 100 },
                { bearing: "East", distance: 100 },
                { bearing: "South", distance: 100 },
                { bearing: "West", distance: 100 },
              ],
            },
          },
        },
        auth,
      ),
    );
    const boundaryResult = JSON.parse(traced.result.content[0].text);
    expect(boundaryResult.closes).toBe(true);
    expect(boundaryResult.polygon).toHaveLength(4);

    const submitted = parse(
      await rpc(
        {
          method: "tools/call",
          params: {
            name: "submit_route_proposal",
            arguments: proposal({ boundary: boundaryResult.polygon }),
          },
        },
        auth,
      ),
    );
    expect(submitted.result.isError).toBeFalsy();
    const { id, reviewUrl } = JSON.parse(submitted.result.content[0].text);
    expect(reviewUrl).toContain(`/?proposal=${id}`);

    const stored = await request(app).get(`/api/proposals/${id}`).set(auth);
    expect(stored.status).toBe(200);
    expect(stored.body.title).toBe("Lot 12 site survey");
  });

  it("returns validation problems to the agent as tool errors", async () => {
    const res = parse(
      await rpc(
        {
          method: "tools/call",
          params: {
            name: "submit_route_proposal",
            arguments: proposal({
              suggestions: [
                {
                  kind: "orbit",
                  targetId: "missing",
                  title: "x",
                  rationale: "y",
                },
              ],
            }),
          },
        },
        { Authorization: `Bearer ${token}` },
      ),
    );
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/id of a structure/);
  });

  it("acts as the local workspace in single-user mode", async () => {
    process.env.SINGLE_USER = "true";
    try {
      const res = await rpc({
        method: "tools/call",
        params: { name: "list_missions", arguments: {} },
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(parse(res).result.content[0].text)).toEqual({
        missions: [],
      });
    } finally {
      delete process.env.SINGLE_USER;
    }
  });
});

describe("convertToWgs84", () => {
  it("converts UTM coordinates", () => {
    // UTM zone 14N (EPSG:32614), central meridian 99°W
    const { points, system } = convertToWgs84(32614, [
      { easting: 500000, northing: 4372000 },
    ]);
    expect(system).toMatch(/UTM zone 14N/);
    expect(points[0][1]).toBeCloseTo(-99, 4);
    expect(points[0][0]).toBeCloseTo(39.5, 1);
  });

  it("converts State Plane feet", () => {
    // EPSG:2227 NAD83 / California zone 3 (ftUS): its false origin
    const { points } = convertToWgs84(2227, [
      { easting: 6561666.667, northing: 1640416.667 },
    ]);
    expect(points[0][0]).toBeCloseTo(36.5, 3);
    expect(points[0][1]).toBeCloseTo(-120.5, 3);
  });

  it("rejects unknown systems and impossible coordinates", () => {
    expect(() => convertToWgs84(999998, [{ easting: 0, northing: 0 }])).toThrow(
      CoordinateSystemError,
    );
    expect(() => convertToWgs84(2227, [])).toThrow(CoordinateSystemError);
    expect(() => convertToWgs84(2227, [{ easting: NaN, northing: 0 }])).toThrow(
      CoordinateSystemError,
    );
  });
});

describe("geocodeAddress", () => {
  const fakeFetch = (body: unknown, ok = true) =>
    (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

  it("returns matches from a Mapbox response", async () => {
    const matches = await geocodeAddress("100 Main St", {
      token: "pk.test",
      fetchImpl: fakeFetch({
        features: [
          {
            geometry: { coordinates: [-98.35, 39.5] },
            properties: {
              full_address: "100 Main St, Lebanon, Kansas",
              feature_type: "address",
              coordinates: { accuracy: "rooftop" },
            },
          },
          { geometry: {} },
        ],
      }),
    });
    expect(matches).toEqual([
      {
        name: "100 Main St, Lebanon, Kansas",
        latitude: 39.5,
        longitude: -98.35,
        type: "address",
        accuracy: "rooftop",
      },
    ]);
  });

  it("fails clearly without a token or when the service errors", async () => {
    await expect(geocodeAddress("100 Main St", { token: "" })).rejects.toThrow(
      GeocodingError,
    );
    await expect(
      geocodeAddress("100 Main St", {
        token: "pk.test",
        fetchImpl: fakeFetch({}, false),
      }),
    ).rejects.toThrow(GeocodingError);
    await expect(geocodeAddress("x", { token: "pk.test" })).rejects.toThrow(
      GeocodingError,
    );
  });
});
