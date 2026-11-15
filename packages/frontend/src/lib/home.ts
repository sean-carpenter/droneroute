import type { MissionHome } from "@droneroute/shared";

/** Zoom used when the map centres on a mission home. */
export const HOME_ZOOM = 17;

const NUMBER = String.raw`[+-]?\d+(?:\.\d+)?`;
const COORDS = new RegExp(
  String.raw`^\s*(${NUMBER})\s*°?\s*([NS])?\s*[,;\s]\s*(${NUMBER})\s*°?\s*([EW])?\s*$`,
  "i",
);

/**
 * Reads decimal-degree coordinates typed as "lat, lng" (comma, semicolon or
 * space between them, optional N/S and E/W letters). Returns null for anything
 * else, including values outside the valid ranges, so the caller can treat
 * the text as an address instead.
 */
export function parseCoordinates(
  text: string,
): { latitude: number; longitude: number } | null {
  const m = COORDS.exec(text);
  if (!m) return null;
  let latitude = Number(m[1]);
  let longitude = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") latitude = -Math.abs(latitude);
  if (m[4]?.toUpperCase() === "W") longitude = -Math.abs(longitude);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

/** What to show for a home: its address, or its coordinates when it has none. */
export function homeLabel(home: MissionHome): string {
  return home.address || formatCoordinates(home.latitude, home.longitude);
}

export interface AddressMatch {
  address: string;
  latitude: number;
  longitude: number;
}

/** Picks the usable matches out of a Mapbox geocoding v6 response. */
export function parseGeocodeResponse(body: unknown): AddressMatch[] {
  const features = (body as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const matches: AddressMatch[] = [];
  for (const feature of features) {
    const f = feature as {
      geometry?: { coordinates?: unknown[] };
      properties?: { full_address?: string; name?: string };
    };
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const address = f.properties?.full_address ?? f.properties?.name;
    if (typeof lat !== "number" || typeof lng !== "number" || !address) {
      continue;
    }
    matches.push({ address, latitude: lat, longitude: lng });
  }
  return matches;
}

/**
 * Looks an address up with Mapbox, using the public token the map already
 * runs on. `near` biases results towards where the map is looking.
 */
export async function lookupAddress(
  query: string,
  token: string,
  near?: { latitude: number; longitude: number },
): Promise<AddressMatch[]> {
  if (!token) {
    throw new Error("Address lookup needs a Mapbox token; enter coordinates");
  }
  const params = new URLSearchParams({
    q: query.trim(),
    limit: "5",
    access_token: token,
  });
  if (near) params.set("proximity", `${near.longitude},${near.latitude}`);
  let res: Response;
  try {
    res = await fetch(
      `https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`,
      { signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    throw new Error("The address lookup service could not be reached");
  }
  if (!res.ok) throw new Error("The address lookup service returned an error");
  return parseGeocodeResponse(await res.json());
}
