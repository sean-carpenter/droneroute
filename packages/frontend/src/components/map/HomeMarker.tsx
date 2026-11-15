import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/mapbox";
import { Home } from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import { HOME_ZOOM, homeLabel } from "@/lib/home";
import { Marker3D } from "./Marker3D";

/**
 * The mission home on the map. Drag it to fine-tune the position; the address
 * it was looked up from stays as its label.
 */
export function HomeMarker() {
  const { current: map } = useMap();
  const home = useMissionStore((s) => s.config.home);
  const focusNonce = useMissionStore((s) => s.homeFocusNonce);
  const setConfig = useMissionStore((s) => s.setConfig);

  // Centre on the home when asked to (it was just set, or the pilot pressed
  // the centre button), and when a mission opens with no route to frame.
  // Moving the marker is not a request, so dragging never re-centres the map.
  const seenNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!map) return;
    const opening = seenNonce.current === null;
    const asked = !opening && seenNonce.current !== focusNonce;
    seenNonce.current = focusNonce;

    const { config, waypoints } = useMissionStore.getState();
    if (!config.home) return;
    const center: [number, number] = [
      config.home.longitude,
      config.home.latitude,
    ];
    if (asked) {
      map.flyTo({ center, zoom: Math.max(map.getZoom(), HOME_ZOOM) });
    } else if (opening && waypoints.length < 2) {
      map.jumpTo({ center, zoom: HOME_ZOOM });
    }
  }, [map, focusNonce]);

  if (!home) return null;

  return (
    <Marker3D
      longitude={home.longitude}
      latitude={home.latitude}
      anchor="center"
      draggable
      onDragEnd={(e) =>
        setConfig({
          home: { ...home, latitude: e.lngLat.lat, longitude: e.lngLat.lng },
        })
      }
    >
      <div
        className="flex h-7 w-7 cursor-grab items-center justify-center rounded-full border-2 border-emerald-200 bg-emerald-600 shadow-lg"
        title={`Mission home: ${homeLabel(home)} (drag to adjust)`}
        onClick={(e) => e.stopPropagation()}
      >
        <Home className="h-3.5 w-3.5 text-white" />
      </div>
    </Marker3D>
  );
}
