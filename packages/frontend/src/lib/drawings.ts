import { SITE_DRAWING_LIMITS, type SiteDrawing } from "@droneroute/shared";

/**
 * Geometry of a drawing laid over the map. A drawing is placed by its center,
 * ground width and clockwise rotation; its height follows from the image's
 * proportions. Distances are small (a site), so a flat local frame in meters
 * around the center is accurate enough.
 */

type LatLng = [number, number];

const M_PER_DEG_LAT = 111_320;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Point `east` / `north` meters away from `origin`. */
export function offsetMeters(
  origin: LatLng,
  east: number,
  north: number,
): LatLng {
  const [lat, lng] = origin;
  return [
    lat + north / M_PER_DEG_LAT,
    lng + east / (M_PER_DEG_LAT * Math.cos(toRad(lat))),
  ];
}

/** Meters east and north of `origin` to `point`. */
export function localMeters(
  origin: LatLng,
  point: LatLng,
): { east: number; north: number } {
  return {
    east: (point[1] - origin[1]) * M_PER_DEG_LAT * Math.cos(toRad(origin[0])),
    north: (point[0] - origin[0]) * M_PER_DEG_LAT,
  };
}

/** Rotate a local offset clockwise (as seen on a north-up map). */
function rotateClockwise(east: number, north: number, deg: number) {
  const r = toRad(deg);
  return {
    east: east * Math.cos(r) + north * Math.sin(r),
    north: -east * Math.sin(r) + north * Math.cos(r),
  };
}

type Placement = Pick<
  SiteDrawing,
  "center" | "widthM" | "rotationDeg" | "widthPx" | "heightPx"
>;

export function drawingHeightM(d: Placement): number {
  return (d.widthM * d.heightPx) / d.widthPx;
}

function placeLocal(d: Placement, east: number, north: number): LatLng {
  const r = rotateClockwise(east, north, d.rotationDeg);
  return offsetMeters(d.center, r.east, r.north);
}

/** Corners of the image: top left, top right, bottom right, bottom left. */
export function drawingCorners(d: Placement): [LatLng, LatLng, LatLng, LatLng] {
  const hw = d.widthM / 2;
  const hh = drawingHeightM(d) / 2;
  return [
    placeLocal(d, -hw, hh),
    placeLocal(d, hw, hh),
    placeLocal(d, hw, -hh),
    placeLocal(d, -hw, -hh),
  ];
}

/** The same corners as Mapbox image-source coordinates ([lng, lat]). */
export function drawingImageCoordinates(
  d: Placement,
): [[number, number], [number, number], [number, number], [number, number]] {
  const [a, b, c, e] = drawingCorners(d).map(([lat, lng]) => [lng, lat]) as [
    number,
    number,
  ][];
  return [a, b, c, e];
}

/** Where the rotate handle sits: just beyond the middle of the top edge. */
export function drawingRotateHandle(d: Placement): LatLng {
  const hh = drawingHeightM(d) / 2;
  return placeLocal(d, 0, hh + Math.max(4, hh * 0.3));
}

function clampWidth(widthM: number): number {
  return Math.min(
    SITE_DRAWING_LIMITS.maxWidthM,
    Math.max(SITE_DRAWING_LIMITS.minWidthM, widthM),
  );
}

/**
 * Width after dragging a corner to `point`: the image grows or shrinks about
 * its center, keeping its proportions, so the corner follows the pointer's
 * distance from the center.
 */
export function widthFromCorner(d: Placement, point: LatLng): number {
  const { east, north } = localMeters(d.center, point);
  const halfDiagonal = Math.hypot(d.widthM / 2, drawingHeightM(d) / 2);
  if (halfDiagonal === 0) return d.widthM;
  return clampWidth((d.widthM * Math.hypot(east, north)) / halfDiagonal);
}

/** Rotation that points the top of the drawing from its center towards `point`. */
export function rotationTowards(d: Placement, point: LatLng): number {
  const { east, north } = localMeters(d.center, point);
  return normalizeDegrees(toDeg(Math.atan2(east, north)));
}

/** Degrees in [0, 360), rounded to a tenth. */
export function normalizeDegrees(deg: number): number {
  const n = Math.round((((deg % 360) + 360) % 360) * 10) / 10;
  return n >= 360 ? 0 : n;
}

/**
 * Initial width for a new drawing: it fills most of the visible map without
 * spilling over either edge.
 */
export function initialWidthM(
  view: { widthM: number; heightM: number },
  widthPx: number,
  heightPx: number,
): number {
  const byWidth = view.widthM * 0.7;
  const byHeight = (view.heightM * 0.7 * widthPx) / heightPx;
  return clampWidth(Math.round(Math.min(byWidth, byHeight)));
}
