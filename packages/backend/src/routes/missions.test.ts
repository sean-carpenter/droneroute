import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { getDb, initDb } from "../models/db.js";
import { authRoutes } from "./auth.js";
import { missionRoutes } from "./missions.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/missions", missionRoutes);

let token: string;

const validBody = {
  name: "Test mission",
  config: { autoFlightSpeed: 5 },
  waypoints: [
    {
      index: 0,
      name: "WP1",
      latitude: 41.25,
      longitude: 0.93,
      height: 30,
      speed: 5,
      gimbalPitchAngle: 0,
    },
    {
      index: 1,
      name: "WP2",
      latitude: 41.26,
      longitude: 0.94,
      height: 30,
      speed: 5,
      gimbalPitchAngle: 0,
    },
  ],
  pois: [],
  obstacles: [],
};

beforeAll(async () => {
  initDb();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email: "missions@test.dev", password: "secret123" });
  token = res.body.token;
});

describe("POST /api/missions/:id/duplicate", () => {
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const createMission = async (body: object = validBody, t = token) => {
    const res = await request(app)
      .post("/api/missions")
      .set(auth(t))
      .send(body);
    return res.body.id as string;
  };

  it("copies every field into a new, unshared mission", async () => {
    const id = await createMission({ ...validBody, name: "Original" });
    // The copy is verbatim, so any JSON will do here; skip create validation
    getDb()
      .prepare(
        "UPDATE missions SET pois = ?, obstacles = ?, site_features = ?, share_token = ? WHERE id = ?",
      )
      .run(
        JSON.stringify([{ id: "p1", name: "Tower" }]),
        JSON.stringify([{ id: "o1", name: "Shed" }]),
        JSON.stringify([{ id: "s1", kind: "building" }]),
        "tok-original",
        id,
      );

    const res = await request(app)
      .post(`/api/missions/${id}/duplicate`)
      .set(auth(token));
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Original (copy)");
    expect(res.body.id).not.toBe(id);

    const [orig, copy] = await Promise.all(
      [id, res.body.id].map((i) =>
        request(app).get(`/api/missions/${i}`).set(auth(token)),
      ),
    );
    for (const key of [
      "config",
      "waypoints",
      "pois",
      "obstacles",
      "siteFeatures",
    ]) {
      expect(copy.body[key]).toEqual(orig.body[key]);
    }
    const row = getDb()
      .prepare("SELECT share_token FROM missions WHERE id = ?")
      .get(res.body.id) as { share_token: string | null };
    expect(row.share_token).toBeNull();
  });

  it("refuses another user's mission with 403", async () => {
    const other = await request(app)
      .post("/api/auth/register")
      .send({ email: "other-dup@test.dev", password: "secret123" });
    const id = await createMission(validBody, other.body.token);
    const res = await request(app)
      .post(`/api/missions/${id}/duplicate`)
      .set(auth(token));
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown mission", async () => {
    const res = await request(app)
      .post("/api/missions/does-not-exist/duplicate")
      .set(auth(token));
    expect(res.status).toBe(404);
  });

  it("requires a session", async () => {
    const id = await createMission();
    const res = await request(app).post(`/api/missions/${id}/duplicate`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/missions — server-side validation", () => {
  it("creates a mission with a valid payload", async () => {
    const res = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it("rejects out-of-range coordinates with 400", async () => {
    const res = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...validBody,
        waypoints: [{ ...validBody.waypoints[0], latitude: 999 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("waypoint coordinates out of range");
  });

  it("rejects a non-array waypoints field with 400", async () => {
    const res = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, waypoints: { not: "an array" } });
    expect(res.status).toBe(400);
  });
});
