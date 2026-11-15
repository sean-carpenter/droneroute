import { Source, Layer, Marker } from "react-map-gl/mapbox";
import type { Obstacle } from "@droneroute/shared";
import { useMissionStore } from "@/store/missionStore";
import { useMemo } from "react";

interface ObstaclePolygonProps {
  obstacle: Obstacle;
  is3D: boolean;
}

export function ObstaclePolygon({ obstacle, is3D }: ObstaclePolygonProps) {
  const selectedObstacleId = useMissionStore((s) => s.selectedObstacleId);
  const moveObstacleVertex = useMissionStore((s) => s.moveObstacleVertex);
  const addObstacleVertex = useMissionStore((s) => s.addObstacleVertex);
  const removeObstacleVertex = useMissionStore((s) => s.removeObstacleVertex);

  const isSelected = selectedObstacleId === obstacle.id;

  // GeoJSON for the polygon fill + outline
  const geojson = useMemo(() => {
    // Mapbox polygons: [lng, lat], ring must be closed
    const ring = [
      ...obstacle.vertices.map(([lat, lng]) => [lng, lat]),
      [obstacle.vertices[0][1], obstacle.vertices[0][0]],
    ];
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "Polygon" as const,
        coordinates: [ring],
      },
    };
  }, [obstacle.vertices]);

  // Midpoints between consecutive vertices
  const midpoints = useMemo(() => {
    if (!isSelected || obstacle.vertices.length < 2) return [];
    return obstacle.vertices.map((curr, i) => {
      const next = obstacle.vertices[(i + 1) % obstacle.vertices.length];
      return [(curr[0] + next[0]) / 2, (curr[1] + next[1]) / 2] as [
        number,
        number,
      ];
    });
  }, [isSelected, obstacle.vertices]);

  const sourceId = `obstacle-${obstacle.id}`;

  return (
    <>
      <Source id={sourceId} type="geojson" data={geojson}>
        <Layer
          id={`${sourceId}-fill`}
          type="fill"
          paint={{
            "fill-color": "#ef4444",
            "fill-opacity": isSelected ? 0.2 : 0.12,
          }}
          // onClick doesn't exist on Layer; we handle via map click interactivity
        />
        <Layer
          id={`${sourceId}-outline`}
          type="line"
          paint={{
            "line-color": "#ef4444",
            "line-width": isSelected ? 3 : 2,
            "line-opacity": isSelected ? 1 : 0.7,
          }}
        />
        {/* In 3D an obstacle with a known height rises to it */}
        {is3D && (obstacle.height ?? 0) > 0 && (
          <Layer
            id={`${sourceId}-extrusion`}
            type="fill-extrusion"
            paint={{
              "fill-extrusion-color": "#ef4444",
              "fill-extrusion-height": obstacle.height!,
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": isSelected ? 0.5 : 0.35,
            }}
          />
        )}
      </Source>

      {/* Vertex handles (draggable markers when selected) */}
      {isSelected &&
        obstacle.vertices.map((pos, i) => (
          <Marker
            key={`obs-v-${obstacle.id}-${i}`}
            longitude={pos[1]}
            latitude={pos[0]}
            anchor="center"
            draggable
            onDragEnd={(e) => {
              moveObstacleVertex(obstacle.id, i, e.lngLat.lat, e.lngLat.lng);
            }}
          >
            <div
              onContextMenu={(e) => {
                e.preventDefault();
                if (obstacle.vertices.length > 3) {
                  removeObstacleVertex(obstacle.id, i);
                }
              }}
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#fff",
                border: "2px solid #ef4444",
                cursor: "move",
              }}
            />
          </Marker>
        ))}

      {/* Midpoint handles (click to insert vertex) */}
      {isSelected &&
        midpoints.map((pos, i) => (
          <Marker
            key={`obs-mid-${obstacle.id}-${i}`}
            longitude={pos[1]}
            latitude={pos[0]}
            anchor="center"
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                addObstacleVertex(obstacle.id, i, pos[0], pos[1]);
              }}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#fecaca",
                border: "1px solid #ef4444",
                cursor: "pointer",
                opacity: 0.7,
              }}
            />
          </Marker>
        ))}
    </>
  );
}
