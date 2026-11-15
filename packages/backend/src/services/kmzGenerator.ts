import archiver from "archiver";
import { PassThrough } from "stream";
import type { KmzLayout, Mission } from "@droneroute/shared";
import { buildTemplateKml, buildWaylinesWpml } from "../lib/wpml.js";

/**
 * Builds the KMZ. `layout` chooses where the files sit inside the archive:
 * "root" puts them at the top level (the long-standing DroneRoute export);
 * "wpmz" puts them in a `wpmz/` folder, the layout DJI documents for WPML
 * files and the one DJI Pilot 2 and FlightHub 2 write themselves.
 */
export function generateKmzBuffer(
  mission: Mission,
  layout: KmzLayout = "root",
): Promise<Buffer> {
  const prefix = layout === "wpmz" ? "wpmz/" : "";
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();

    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    passthrough.on("end", () => resolve(Buffer.concat(chunks)));
    passthrough.on("error", reject);

    archive.pipe(passthrough);

    // Add template.kml
    const templateKml = buildTemplateKml(mission);
    archive.append(templateKml, { name: `${prefix}template.kml` });

    // Add waylines.wpml
    const waylinesWpml = buildWaylinesWpml(mission);
    archive.append(waylinesWpml, { name: `${prefix}waylines.wpml` });

    // Add empty res/ directory
    archive.append("", { name: `${prefix}res/` });

    archive.finalize();
  });
}

/** Reads the export target a client asked for. Anything unknown is the default. */
export function layoutForTarget(target: unknown): KmzLayout {
  return target === "flighthub2" ? "wpmz" : "root";
}
