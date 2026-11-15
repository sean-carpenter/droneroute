import { Source, Layer, Marker, useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";
import { useEffect, useMemo } from "react";
import { SITE_FEATURE_KINDS } from "@droneroute/shared";

/** Finish the shape as whatever is being drawn: a site feature or an obstacle. */
function finishShape(vertices: [number, number][]) {
  const state = useMissionStore.getState();
  if (state.drawingSiteFeatureKind) {
    state.addSiteFeature(vertices, state.drawingSiteFeatureKind);
  } else {
    state.addObstacle(vertices);
  }
}

/**
 * Handles obstacle polygon drawing on the map.
 * Click to place vertices, double-click or click near first vertex to close.
 * Escape to cancel.
 */
export function ObstacleDrawHandler() {
  const isDrawingObstacle = useMissionStore((s) => s.isDrawingObstacle);
  const drawingVertices = useMissionStore((s) => s.drawingVertices);
  const setDrawingVertices = useMissionStore((s) => s.setDrawingVertices);
  const addObstacle = useMissionStore((s) => s.addObstacle);
  const setIsDrawingObstacle = useMissionStore((s) => s.setIsDrawingObstacle);
  const featureKind = useMissionStore((s) => s.drawingSiteFeatureKind);
  const color = featureKind ? SITE_FEATURE_KINDS[featureKind].color : "#ef4444";
  const { current: map } = useMap();

  // Escape key cancels drawing
  useEffect(() => {
    if (!isDrawingObstacle) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawingVertices([]);
        setIsDrawingObstacle(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDrawingObstacle, setDrawingVertices, setIsDrawingObstacle]);

  // Map click handler for placing vertices
  useEffect(() => {
    if (!isDrawingObstacle || !map) return;

    const handleClick = (e: any) => {
      const newVertex: [number, number] = [e.lngLat.lat, e.lngLat.lng];

      // Check if near first vertex to close
      const currentVertices = useMissionStore.getState().drawingVertices;
      if (currentVertices.length >= 3) {
        const [firstLat, firstLng] = currentVertices[0];
        const firstPoint = map.project([firstLng, firstLat]);
        const clickPoint = map.project([e.lngLat.lng, e.lngLat.lat]);
        const dist = Math.sqrt(
          (firstPoint.x - clickPoint.x) ** 2 +
            (firstPoint.y - clickPoint.y) ** 2,
        );
        if (dist < 15) {
          finishShape(currentVertices);
          return;
        }
      }

      setDrawingVertices([...currentVertices, newVertex]);
    };

    const handleDblClick = (e: any) => {
      e.preventDefault();
      const verts = useMissionStore.getState().drawingVertices;
      if (verts.length >= 3) {
        finishShape(verts);
      }
    };

    map.on("click", handleClick);
    map.on("dblclick", handleDblClick);
    return () => {
      map.off("click", handleClick);
      map.off("dblclick", handleDblClick);
    };
  }, [isDrawingObstacle, map, setDrawingVertices, addObstacle]);

  // GeoJSON for drawing lines
  const lineGeojson = useMemo(() => {
    if (drawingVertices.length < 2) return null;
    const coords = drawingVertices.map(([lat, lng]) => [lng, lat]);
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: coords,
      },
    };
  }, [drawingVertices]);

  // Closing line preview
  const closingGeojson = useMemo(() => {
    if (drawingVertices.length < 3) return null;
    const first = drawingVertices[0];
    const last = drawingVertices[drawingVertices.length - 1];
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [last[1], last[0]],
          [first[1], first[0]],
        ],
      },
    };
  }, [drawingVertices]);

  if (!isDrawingObstacle || drawingVertices.length === 0) return null;

  return (
    <>
      {/* Placed vertices */}
      {drawingVertices.map((pos, i) => (
        <Marker
          key={`draw-v-${i}`}
          longitude={pos[1]}
          latitude={pos[0]}
          anchor="center"
        >
          <div
            style={{
              width: i === 0 ? 14 : 10,
              height: i === 0 ? 14 : 10,
              borderRadius: "50%",
              background: i === 0 ? color : "#ffffff",
              border: `2px solid ${color}`,
            }}
          />
        </Marker>
      ))}

      {/* Lines between placed vertices */}
      {lineGeojson && (
        <Source id="obstacle-drawing-line" type="geojson" data={lineGeojson}>
          <Layer
            id="obstacle-drawing-line-layer"
            type="line"
            paint={{
              "line-color": color,
              "line-width": 2,
              "line-opacity": 0.8,
              "line-dasharray": [3, 2],
            }}
          />
        </Source>
      )}

      {/* Closing line preview */}
      {closingGeojson && (
        <Source id="obstacle-closing-line" type="geojson" data={closingGeojson}>
          <Layer
            id="obstacle-closing-line-layer"
            type="line"
            paint={{
              "line-color": color,
              "line-width": 1.5,
              "line-opacity": 0.4,
              "line-dasharray": [2, 3],
            }}
          />
        </Source>
      )}
    </>
  );
}
