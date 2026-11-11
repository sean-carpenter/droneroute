import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import type { Mission } from "@droneroute/shared";
import { DEFAULT_MISSION_CONFIG } from "@droneroute/shared";
import { generateKmzBuffer } from "../services/kmzGenerator.js";
import { ImportError, importMissionFile } from "../services/missionImport.js";
import { getDb } from "../models/db.js";
import {
  authMiddleware,
  optionalAuth,
  type AuthRequest,
} from "../middleware/auth.js";
import { strictLimiter } from "../middleware/rateLimit.js";
import { validateMissionGeometry } from "../services/missionValidation.js";

export const kmzRoutes = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Generate and download KMZ from mission data (POST body)
kmzRoutes.post(
  "/generate",
  strictLimiter,
  optionalAuth,
  async (req: AuthRequest, res) => {
    try {
      const { name, config, waypoints, pois } = req.body;
      if (!config || !waypoints || waypoints.length < 2) {
        res
          .status(400)
          .json({ error: "At least 2 waypoints and a config are required" });
        return;
      }

      const geometryError = validateMissionGeometry({ waypoints, pois });
      if (geometryError) {
        res.status(400).json({ error: geometryError });
        return;
      }

      const mission: Mission = {
        id: uuidv4(),
        name: name || "mission",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        config,
        waypoints,
        pois: pois || [],
        obstacles: [],
      };

      const buffer = await generateKmzBuffer(mission);

      const filename = `${mission.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.kmz`;
      res.setHeader("Content-Type", "application/vnd.google-earth.kmz");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(buffer);
    } catch (err: any) {
      console.error("KMZ download error:", err);
      res.status(500).json({ error: "Failed to generate KMZ" });
    }
  },
);

// Download KMZ for a saved mission
kmzRoutes.get(
  "/download/:missionId",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const db = getDb();
      const row = db
        .prepare("SELECT * FROM missions WHERE id = ? AND user_id = ?")
        .get(req.params.missionId, req.userId) as any;
      if (!row) {
        res.status(404).json({ error: "Mission not found" });
        return;
      }

      const mission: Mission = {
        id: row.id,
        name: row.name,
        userId: row.user_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        config: JSON.parse(row.config),
        waypoints: JSON.parse(row.waypoints),
        pois: JSON.parse(row.pois || "[]"),
        obstacles: JSON.parse(row.obstacles || "[]"),
      };

      const buffer = await generateKmzBuffer(mission);
      const filename = `${mission.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.kmz`;
      res.setHeader("Content-Type", "application/vnd.google-earth.kmz");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(buffer);
    } catch (err: any) {
      console.error("KMZ download error:", err);
      res.status(500).json({ error: "Failed to generate KMZ" });
    }
  },
);

// Import a mission file: DJI WPML KMZ, plain KML/KMZ, GPX or Litchi CSV
kmzRoutes.post(
  "/import",
  optionalAuth,
  upload.single("file"),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file uploaded" });
        return;
      }

      let imported;
      try {
        imported = await importMissionFile(
          req.file.buffer,
          req.file.originalname,
        );
      } catch (err) {
        if (err instanceof ImportError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }
      const { format, config, waypoints, pois, warnings } = imported;

      const geometryError = validateMissionGeometry({ waypoints, pois });
      if (geometryError) {
        res
          .status(400)
          .json({ error: `Invalid file contents: ${geometryError}` });
        return;
      }

      // Optionally save to DB
      const save = req.query.save === "true";
      let missionId: string | undefined;

      if (save) {
        const db = getDb();
        missionId = uuidv4();
        const name =
          req.file.originalname
            .replace(/\.(kmz|kml|gpx|csv)$/i, "")
            .slice(0, 200) || "Imported Mission";
        db.prepare(
          "INSERT INTO missions (id, name, user_id, config, waypoints, pois, obstacles) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
          missionId,
          name,
          req.userId || null,
          JSON.stringify(config ?? DEFAULT_MISSION_CONFIG),
          JSON.stringify(waypoints),
          JSON.stringify(pois),
          "[]",
        );
      }

      res.json({ id: missionId, format, config, waypoints, pois, warnings });
    } catch (err: any) {
      console.error("Mission import error:", err);
      res.status(500).json({ error: "Failed to read the file" });
    }
  },
);
