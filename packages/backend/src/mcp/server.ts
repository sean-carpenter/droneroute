/**
 * MCP endpoint that lets AI agents (Claude, Cursor, Codex, …) draft route
 * proposals. The agent reads the user's documents itself; this server only
 * offers deterministic helpers and stores the proposal for review in the app.
 */
import { Router, type Request, type Response } from "express";
import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../models/db.js";
import { verifyToken } from "../services/authService.js";
import { getLocalUserId, isSingleUser } from "../lib/singleUser.js";
import {
  boundaryFromCalls,
  SurveyGeometryError,
} from "../services/surveyGeometry.js";
import {
  convertToWgs84,
  CoordinateSystemError,
} from "../services/coordinateSystems.js";
import { geocodeAddress, GeocodingError } from "../services/geocoding.js";
import {
  proposalShape,
  validateProposal,
} from "../services/proposalValidation.js";
import { createProposal } from "../services/proposalStore.js";
import { ROUTE_PLANNING_GUIDE } from "./guide.js";

export function isMcpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MCP_ENABLED === "true";
}

/** Hostnames the endpoint answers to (guards against DNS rebinding). */
function allowedHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return ["localhost", "127.0.0.1", "[::1]", ...extra];
}

/** Who the request acts as: the local workspace, or the bearer token's user. */
function resolveUserId(req: Request): string | null {
  if (isSingleUser()) return getLocalUserId();
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const payload = verifyToken(header.slice(7));
  if (!payload) return null;
  const user = getDb()
    .prepare("SELECT is_banned FROM users WHERE id = ?")
    .get(payload.userId) as { is_banned: number } | undefined;
  return user && !user.is_banned ? payload.userId : null;
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Errors whose message is written for the agent; anything else stays generic. */
function describeError(err: unknown): string {
  if (
    err instanceof SurveyGeometryError ||
    err instanceof CoordinateSystemError ||
    err instanceof GeocodingError
  ) {
    return err.message;
  }
  console.error("MCP tool error:", err);
  return "The tool failed unexpectedly";
}

const position = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export function buildMcpServer(userId: string, baseUrl: string): McpServer {
  const server = new McpServer({ name: "droneroute", version: "1.0.0" });

  server.registerTool(
    "get_route_planning_guide",
    {
      title: "Route planning guide",
      description:
        "Read this first. Explains how to turn a survey, plat or permit set into a DroneRoute route proposal: locating the site, building the boundary, choosing missions, and what to submit.",
    },
    async () => ({ content: [{ type: "text", text: ROUTE_PLANNING_GUIDE }] }),
  );

  server.registerTool(
    "geocode_address",
    {
      title: "Look up an address",
      description:
        "Find the latitude and longitude of a street address or place name. Returns up to three matches with the kind of match (address, street, place). The address is sent to Mapbox.",
      inputSchema: { address: z.string().min(3).max(300) },
    },
    async ({ address }) => {
      try {
        const matches = await geocodeAddress(address);
        return matches.length > 0
          ? ok({ matches })
          : fail("No match for that address");
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "boundary_from_bearings",
    {
      title: "Boundary from bearings and distances",
      description:
        "Trace a metes-and-bounds description into a polygon. Give the point of beginning and the calls in order; returns the corners as [latitude, longitude], the closure error, perimeter and area. Use this instead of computing corners yourself.",
      inputSchema: {
        start: position.describe("Point of beginning"),
        calls: z
          .array(
            z.object({
              bearing: z
                .union([z.string().min(1).max(40), z.number()])
                .describe(
                  'Quadrant bearing such as "N 45°30\'15\\" E", a cardinal direction, or an azimuth in degrees clockwise from north',
                ),
              distance: z.number().positive(),
              isCurveChord: z
                .boolean()
                .optional()
                .describe("True when this is the chord of a curve"),
            }),
          )
          .min(2)
          .max(500),
        unit: z
          .enum(["ft", "usft", "m", "ch"])
          .default("ft")
          .describe(
            "ft = international feet, usft = US survey feet, ch = chains",
          ),
        rotationDeg: z
          .number()
          .min(-180)
          .max(180)
          .optional()
          .describe(
            "Degrees to rotate all bearings clockwise when the basis of bearings is not true north",
          ),
      },
    },
    async (input) => {
      try {
        return ok(boundaryFromCalls(input));
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "convert_coordinates",
    {
      title: "Convert survey coordinates",
      description:
        "Convert State Plane, UTM or other projected coordinates to latitude and longitude. Identify the system by EPSG code (for example 2227 = NAD83 California zone 3, US survey feet) and give coordinates in that system's unit.",
      inputSchema: {
        epsg: z.number().int(),
        points: z
          .array(z.object({ easting: z.number(), northing: z.number() }))
          .min(1)
          .max(2000),
      },
    },
    async ({ epsg, points }) => {
      try {
        return ok(convertToWgs84(epsg, points));
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "submit_route_proposal",
    {
      title: "Submit a route proposal",
      description:
        "Save a route proposal for the pilot to review in DroneRoute. Returns a link to open it. Positions are [latitude, longitude]. Nothing is flown or added to a mission until the pilot accepts it.",
      inputSchema: proposalShape,
    },
    async (input) => {
      const result = validateProposal(input);
      if (!result.ok) return fail(result.error);
      try {
        const proposal = createProposal(userId, result.proposal);
        return ok({
          id: proposal.id,
          reviewUrl: `${baseUrl}/?proposal=${proposal.id}`,
          message:
            "Saved. Give the pilot the review link; they adjust and accept it in DroneRoute.",
        });
      } catch (err) {
        return fail(describeError(err));
      }
    },
  );

  server.registerTool(
    "list_missions",
    {
      title: "List saved missions",
      description:
        "Names and sizes of the pilot's saved missions, for context. Read-only.",
    },
    async () => {
      const rows = getDb()
        .prepare(
          "SELECT name, waypoints, updated_at FROM missions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50",
        )
        .all(userId) as {
        name: string;
        waypoints: string;
        updated_at: string;
      }[];
      return ok({
        missions: rows.map((row) => {
          let waypointCount = 0;
          try {
            waypointCount = (JSON.parse(row.waypoints) as unknown[]).length;
          } catch {
            // Leave the count at 0 for a row that can't be read
          }
          return { name: row.name, waypointCount, updatedAt: row.updated_at };
        }),
      });
    },
  );

  server.registerPrompt(
    "draft_route_from_documents",
    {
      title: "Draft a route from a survey or permit set",
      description:
        "Read the attached survey, plat or permit set and submit a first route proposal to DroneRoute.",
      argsSchema: {
        goal: z
          .string()
          .optional()
          .describe("What the flight is for, e.g. progress photos, a site map"),
      },
    },
    ({ goal }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `${ROUTE_PLANNING_GUIDE}\n\n---\n\nRead the documents I have given you and submit a route proposal to DroneRoute.${goal ? ` The flight is for: ${goal}.` : ""}`,
          },
        },
      ],
    }),
  );

  return server;
}

function rpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

/** Router for `/mcp`: stateless streamable HTTP, one server per request. */
export function createMcpRouter(): Router {
  const router = Router();
  router.use(hostHeaderValidation(allowedHosts()));

  router.post("/", async (req: Request, res: Response) => {
    const userId = resolveUserId(req);
    if (!userId) {
      rpcError(res, 401, "A valid bearer token is required");
      return;
    }

    const baseUrl = `${req.protocol}://${req.headers.host ?? "localhost"}`;
    const server = buildMcpServer(userId, baseUrl);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request error:", err);
      if (!res.headersSent) rpcError(res, 500, "Internal server error");
    }
  });

  // Stateless server: no event stream to open and no session to end
  const notAllowed = (_req: Request, res: Response) =>
    rpcError(res, 405, "Method not allowed");
  router.get("/", notAllowed);
  router.delete("/", notAllowed);

  return router;
}
