import { useEffect, useMemo, useRef } from "react";
import { Layer, Source, useMap } from "react-map-gl/mapbox";
import { PlaneTakeoff } from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import { formatCoordinates } from "@/lib/home";
import { Marker3D } from "./Marker3D";

/**
 * The drone home point: where the aircraft takes off and returns to. Drag it
 * to the launch spot. Thin dashed lines show the flight out to the first
 * waypoint and, when the mission ends with "go home", back from the last.
 */
export function TakeoffMarker() {
  const { current: map } = useMap();
  const takeoff = useMissionStore((s) => s.config.takeoff);
  const finishAction = useMissionStore((s) => s.config.finishAction);
  const waypoints = useMissionStore((s) => s.waypoints);
  const placeNonce = useMissionStore((s) => s.takeoffPlaceNonce);
  const setConfig = useMissionStore((s) => s.setConfig);

  // "Place on map" drops the point at the centre of the current view.
  const seenNonce = useRef(placeNonce);
  useEffect(() => {
    if (!map || seenNonce.current === placeNonce) return;
    seenNonce.current = placeNonce;
    const center = map.getCenter();
    const current = useMissionStore.getState().config.takeoff;
    setConfig({
      takeoff: { ...current, latitude: center.lat, longitude: center.lng },
    });
  }, [map, placeNonce, setConfig]);

  const legs = useMemo(() => {
    if (!takeoff || waypoints.length === 0) return null;
    const here = [takeoff.longitude, takeoff.latitude];
    const first = waypoints[0];
    const last = waypoints[waypoints.length - 1];
    const lines = [[here, [first.longitude, first.latitude]]];
    if (finishAction === "goHome") {
      lines.push([[last.longitude, last.latitude], here]);
    }
    return {
      type: "FeatureCollection" as const,
      features: lines.map((coordinates) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates },
      })),
    };
  }, [takeoff, waypoints, finishAction]);

  if (!takeoff) return null;

  return (
    <>
      {legs && (
        <Source id="takeoff-legs" type="geojson" data={legs}>
          <Layer
            id="takeoff-legs-line"
            type="line"
            paint={{
              "line-color": "#38bdf8",
              "line-width": 2,
              "line-opacity": 0.8,
              "line-dasharray": [1, 2],
            }}
          />
        </Source>
      )}
      <Marker3D
        longitude={takeoff.longitude}
        latitude={takeoff.latitude}
        anchor="center"
        draggable
        onDragEnd={(e) =>
          setConfig({
            takeoff: {
              ...takeoff,
              latitude: e.lngLat.lat,
              longitude: e.lngLat.lng,
            },
          })
        }
      >
        <div
          className="flex h-7 w-7 cursor-grab items-center justify-center rounded-full border-2 border-sky-200 bg-sky-600 shadow-lg"
          title={`Drone home point: ${formatCoordinates(takeoff.latitude, takeoff.longitude)} (drag to adjust)`}
          onClick={(e) => e.stopPropagation()}
        >
          <PlaneTakeoff className="h-3.5 w-3.5 text-white" />
        </div>
      </Marker3D>
    </>
  );
}
