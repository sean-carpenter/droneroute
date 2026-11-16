import type { Map as MapboxMap } from "mapbox-gl";
import { haversineDistance } from "@/lib/geo";

/**
 * The editor's map, for code outside the map tree (the sidebar, the page-wide
 * drop handler) that needs to know what is on screen. Set by MapView.
 */
let mainMap: MapboxMap | null = null;

export function setMainMap(map: MapboxMap | null): void {
  mainMap = map;
}

export interface VisibleArea {
  center: [number, number];
  widthM: number;
  heightM: number;
}

/** Center and ground size of the visible map, or null before the map exists. */
export function visibleArea(): VisibleArea | null {
  if (!mainMap) return null;
  const c = mainMap.getCenter();
  const b = mainMap.getBounds();
  if (!b) return null;
  return {
    center: [c.lat, c.lng],
    widthM: haversineDistance(c.lat, b.getWest(), c.lat, b.getEast()),
    heightM: haversineDistance(b.getSouth(), c.lng, b.getNorth(), c.lng),
  };
}
