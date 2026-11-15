import { Source, Layer, Marker } from "react-map-gl/mapbox";
import type { SiteFeature } from "@droneroute/shared";
import { useMissionStore } from "@/store/missionStore";
import { useMemo, useState } from "react";

/** Layer id of a feature's fill, used to select it by clicking the map. */
export const siteFeatureFillId = (id: string) => `site-feature-${id}-fill`;
/** Layer id of a feature's 3D extrusion, also clickable to select it. */
export const siteFeatureExtrusionId = (id: string) =>
  `site-feature-${id}-extrusion`;
export const SITE_FEATURE_FILL_PREFIX = "site-feature-";

/** Feature id from a clickable site-feature layer id, or null. */
export function siteFeatureIdFromLayerId(layerId: string): string | null {
  if (!layerId.startsWith(SITE_FEATURE_FILL_PREFIX)) return null;
  for (const suffix of ["-fill", "-extrusion"]) {
    if (layerId.endsWith(suffix)) {
      return layerId.slice(SITE_FEATURE_FILL_PREFIX.length, -suffix.length);
    }
  }
  return null;
}

/** Average of the corners: close enough to the middle for a label and handle. */
function middle(vertices: [number, number][]): [number, number] {
  const lat = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
  const lng = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;
  return [lat, lng];
}

/**
 * A building, lot or other area drawn in its own color with its name on the
 * map. When selected: drag a corner to move it, click a midpoint to add a
 * corner, right-click a corner to remove it, drag the middle handle to move
 * the whole shape.
 */
export function SiteFeaturePolygon({
  feature,
  is3D,
}: {
  feature: SiteFeature;
  is3D: boolean;
}) {
  const selectedId = useMissionStore((s) => s.selectedSiteFeatureId);
  const setVertices = useMissionStore((s) => s.setSiteFeatureVertices);
  const isSelected = selectedId === feature.id;

  // While the whole shape is being dragged, draw it shifted without saving;
  // the move is saved once on release, so it is one undo step.
  const [shift, setShift] = useState<[number, number] | null>(null);
  const vertices = useMemo(
    () =>
      shift
        ? feature.vertices.map(
            ([lat, lng]) =>
              [lat + shift[0], lng + shift[1]] as [number, number],
          )
        : feature.vertices,
    [feature.vertices, shift],
  );
  const center = useMemo(() => middle(feature.vertices), [feature.vertices]);
  const shownCenter: [number, number] = shift
    ? [center[0] + shift[0], center[1] + shift[1]]
    : center;

  const geojson = useMemo(
    () => ({
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            ...vertices.map(([lat, lng]) => [lng, lat]),
            [vertices[0][1], vertices[0][0]],
          ],
        ],
      },
    }),
    [vertices],
  );

  const midpoints = useMemo(() => {
    if (!isSelected) return [];
    return feature.vertices.map((curr, i) => {
      const next = feature.vertices[(i + 1) % feature.vertices.length];
      return [(curr[0] + next[0]) / 2, (curr[1] + next[1]) / 2] as [
        number,
        number,
      ];
    });
  }, [isSelected, feature.vertices]);

  const sourceId = `site-feature-${feature.id}`;
  const isLot = feature.kind === "lot";

  return (
    <>
      <Source id={sourceId} type="geojson" data={geojson}>
        <Layer
          id={siteFeatureFillId(feature.id)}
          type="fill"
          paint={{
            "fill-color": feature.color,
            "fill-opacity": isLot ? 0.04 : isSelected ? 0.4 : 0.25,
          }}
        />
        <Layer
          id={`${sourceId}-outline`}
          type="line"
          paint={{
            "line-color": feature.color,
            "line-width": isSelected ? 3 : 2,
            ...(isLot ? { "line-dasharray": [3, 2] } : {}),
          }}
        />
        {/* In 3D a building rises to its height, like the map's own buildings */}
        {is3D && !isLot && (feature.heightM ?? 0) > 0 && (
          <Layer
            id={siteFeatureExtrusionId(feature.id)}
            type="fill-extrusion"
            paint={{
              "fill-extrusion-color": feature.color,
              "fill-extrusion-height": feature.heightM!,
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": isSelected ? 0.75 : 0.55,
            }}
          />
        )}
      </Source>

      {/* Name label, which doubles as the move handle when selected */}
      <Marker
        longitude={shownCenter[1]}
        latitude={shownCenter[0]}
        anchor="center"
        draggable={isSelected}
        onDrag={(e) =>
          setShift([e.lngLat.lat - center[0], e.lngLat.lng - center[1]])
        }
        onDragEnd={(e) => {
          const dLat = e.lngLat.lat - center[0];
          const dLng = e.lngLat.lng - center[1];
          setShift(null);
          setVertices(
            feature.id,
            feature.vertices.map(
              ([lat, lng]) => [lat + dLat, lng + dLng] as [number, number],
            ),
          );
        }}
      >
        {/* Drawn like a DroneRoute structure: a diamond and a name label */}
        <div
          className="pointer-events-auto flex flex-col items-center"
          style={{ cursor: isSelected ? "move" : "pointer" }}
          title={
            isSelected
              ? "Drag to move the whole shape"
              : (feature.note ?? feature.name)
          }
          onClick={(e) => {
            e.stopPropagation();
            useMissionStore.getState().selectSiteFeature(feature.id);
          }}
        >
          <div
            className="h-3 w-3 rotate-45 border-2"
            style={{
              borderColor: isSelected ? "#ffffff" : feature.color,
              background: `${feature.color}99`,
            }}
          />
          <span
            className="mt-1 whitespace-nowrap rounded bg-black/70 px-1 text-[10px]"
            style={{ color: isSelected ? "#ffffff" : feature.color }}
          >
            {feature.name}
            {feature.heightM ? ` · ${Math.round(feature.heightM)} m` : ""}
          </span>
        </div>
      </Marker>

      {isSelected &&
        !shift &&
        feature.vertices.map((pos, i) => (
          <Marker
            key={`sf-v-${feature.id}-${i}`}
            longitude={pos[1]}
            latitude={pos[0]}
            anchor="center"
            draggable
            onDragEnd={(e) => {
              const next = [...feature.vertices] as [number, number][];
              next[i] = [e.lngLat.lat, e.lngLat.lng];
              setVertices(feature.id, next);
            }}
          >
            <div
              title="Drag to move this corner, right-click to remove it"
              onContextMenu={(e) => {
                e.preventDefault();
                if (feature.vertices.length > 3) {
                  setVertices(
                    feature.id,
                    feature.vertices.filter((_, j) => j !== i),
                  );
                }
              }}
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#fff",
                border: `2px solid ${feature.color}`,
                cursor: "move",
              }}
            />
          </Marker>
        ))}

      {isSelected &&
        !shift &&
        midpoints.map((pos, i) => (
          <Marker
            key={`sf-mid-${feature.id}-${i}`}
            longitude={pos[1]}
            latitude={pos[0]}
            anchor="center"
          >
            <div
              title="Click to add a corner here"
              onClick={(e) => {
                e.stopPropagation();
                const next = [...feature.vertices] as [number, number][];
                next.splice(i + 1, 0, pos);
                setVertices(feature.id, next);
              }}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#fff",
                border: `1px solid ${feature.color}`,
                cursor: "pointer",
                opacity: 0.8,
              }}
            />
          </Marker>
        ))}
    </>
  );
}
