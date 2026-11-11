import { useEffect, useMemo } from "react";
import { Source, Layer, Marker, useMap } from "react-map-gl/mapbox";
import type { LngLatBoundsLike } from "mapbox-gl";
import { Move } from "lucide-react";
import { useProposalStore } from "@/store/proposalStore";
import {
  proposalPivot,
  proposalPoints,
  transformProposal,
} from "@/lib/proposal";

const METERS_PER_DEG_LAT = (6371000 * Math.PI) / 180;

/**
 * Ghost overlay of the route proposal under review: site boundary, structures
 * and alignments, with a handle to drag the whole thing into place.
 */
export function ProposalLayer() {
  const { current: map } = useMap();
  const active = useProposalStore((s) => s.active);
  const transform = useProposalStore((s) => s.transform);
  const setTransform = useProposalStore((s) => s.setTransform);

  const shown = useMemo(
    () => (active ? transformProposal(active, transform) : null),
    [active, transform],
  );

  // Fly to a proposal when it is opened (not on every nudge)
  useEffect(() => {
    if (!map || !active) return;
    const points = proposalPoints(active);
    if (points.length === 0) return;
    const lats = points.map((p) => p[0]);
    const lngs = points.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ] as LngLatBoundsLike,
      { padding: 120, maxZoom: 18, duration: 800 },
    );
  }, [map, active]);

  const geojson = useMemo(() => {
    if (!shown) return null;
    const features: GeoJSON.Feature[] = [];
    if (shown.boundary) {
      const ring = [...shown.boundary, shown.boundary[0]].map(([lat, lng]) => [
        lng,
        lat,
      ]);
      features.push({
        type: "Feature",
        properties: { kind: "boundary" },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
    for (const alignment of shown.alignments) {
      features.push({
        type: "Feature",
        properties: { kind: "alignment" },
        geometry: {
          type: "LineString",
          coordinates: alignment.path.map(([lat, lng]) => [lng, lat]),
        },
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [shown]);

  if (!active || !shown || !geojson) return null;

  // The handle sits at the pivot of the proposal as currently shown
  const original = proposalPivot(active);
  const handle = proposalPivot(shown);

  const onDrag = (e: { lngLat: { lat: number; lng: number } }) => {
    const cosLat = Math.cos((original[0] * Math.PI) / 180);
    setTransform({
      northM: (e.lngLat.lat - original[0]) * METERS_PER_DEG_LAT,
      eastM: (e.lngLat.lng - original[1]) * METERS_PER_DEG_LAT * cosLat,
    });
  };

  return (
    <>
      <Source id="proposal" type="geojson" data={geojson}>
        <Layer
          id="proposal-boundary-fill"
          type="fill"
          filter={["==", ["get", "kind"], "boundary"]}
          paint={{ "fill-color": "#22d3ee", "fill-opacity": 0.12 }}
        />
        <Layer
          id="proposal-boundary-line"
          type="line"
          filter={["==", ["get", "kind"], "boundary"]}
          paint={{
            "line-color": "#22d3ee",
            "line-width": 2.5,
            "line-dasharray": [3, 2],
          }}
        />
        <Layer
          id="proposal-alignment-line"
          type="line"
          filter={["==", ["get", "kind"], "alignment"]}
          paint={{
            "line-color": "#f472b6",
            "line-width": 3,
            "line-dasharray": [1, 1.5],
          }}
        />
      </Source>

      {shown.structures.map((structure) => (
        <Marker
          key={structure.id}
          longitude={structure.longitude}
          latitude={structure.latitude}
          anchor="center"
        >
          <div
            className="pointer-events-none flex flex-col items-center"
            title={structure.note}
          >
            <div className="h-3 w-3 rotate-45 border-2 border-cyan-300 bg-cyan-500/60" />
            <span className="mt-1 rounded bg-black/70 px-1 text-[10px] text-cyan-100 whitespace-nowrap">
              {structure.name}
              {structure.heightM ? ` · ${Math.round(structure.heightM)} m` : ""}
            </span>
          </div>
        </Marker>
      ))}

      <Marker
        longitude={handle[1]}
        latitude={handle[0]}
        anchor="center"
        draggable
        onDrag={onDrag}
        onDragEnd={onDrag}
      >
        <div
          className="flex h-8 w-8 cursor-move items-center justify-center rounded-full border-2 border-cyan-300 bg-cyan-600/90 text-white shadow-lg"
          title="Drag to move the proposed site into place"
        >
          <Move className="h-4 w-4" />
        </div>
      </Marker>
    </>
  );
}
