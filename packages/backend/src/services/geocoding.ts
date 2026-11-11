/** Address lookup through Mapbox, using the token the map already needs. */

export class GeocodingError extends Error {}

export interface GeocodeMatch {
  name: string;
  latitude: number;
  longitude: number;
  /** What was matched: "address", "street", "place", … */
  type: string;
  /** Mapbox's accuracy hint for address matches, e.g. "rooftop", "parcel". */
  accuracy?: string;
}

export async function geocodeAddress(
  address: string,
  options: { token?: string; fetchImpl?: typeof fetch } = {},
): Promise<GeocodeMatch[]> {
  const token = options.token ?? process.env.MAPBOX_TOKEN;
  if (!token) {
    throw new GeocodingError(
      "Address lookup is not configured (no Mapbox token)",
    );
  }
  const query = address.trim();
  if (query.length < 3 || query.length > 300) {
    throw new GeocodingError("The address is too short or too long");
  }

  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&limit=3&access_token=${encodeURIComponent(token)}`;
  let res: Response;
  try {
    res = await (options.fetchImpl ?? fetch)(url, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GeocodingError("The address lookup service could not be reached");
  }
  if (!res.ok) {
    throw new GeocodingError("The address lookup service returned an error");
  }

  const body = (await res.json()) as { features?: unknown[] };
  const matches: GeocodeMatch[] = [];
  for (const feature of body.features ?? []) {
    const f = feature as {
      geometry?: { coordinates?: unknown[] };
      properties?: {
        full_address?: string;
        name?: string;
        feature_type?: string;
        coordinates?: { accuracy?: string };
      };
    };
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    matches.push({
      name: f.properties?.full_address ?? f.properties?.name ?? query,
      latitude: lat,
      longitude: lng,
      type: f.properties?.feature_type ?? "unknown",
      accuracy: f.properties?.coordinates?.accuracy,
    });
  }
  return matches;
}
