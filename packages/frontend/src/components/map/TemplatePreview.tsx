import { useMemo } from "react";
import { Source, Layer, Marker } from "react-map-gl/mapbox";
import type { TemplateResult } from "@/lib/templates";

interface TemplatePreviewProps {
  result: TemplateResult;
}

/**
 * Preview of the waypoints a template will create. Drawn as map layers rather
 * than DOM markers so survey templates with hundreds of points stay smooth.
 */
export function TemplatePreview({ result }: TemplatePreviewProps) {
  const { waypoints, pois } = result;

  const geojson = useMemo(() => {
    const features: GeoJSON.Feature[] = waypoints.map((wp) => ({
      type: "Feature",
      properties: { capture: wp.photoIntervalM ? 1 : 0 },
      geometry: { type: "Point", coordinates: [wp.longitude, wp.latitude] },
    }));

    // Legs flown with interval capture are drawn solid, transits dashed
    for (let i = 0; i < waypoints.length - 1; i++) {
      features.push({
        type: "Feature",
        properties: { capture: waypoints[i].photoIntervalM ? 1 : 0 },
        geometry: {
          type: "LineString",
          coordinates: [
            [waypoints[i].longitude, waypoints[i].latitude],
            [waypoints[i + 1].longitude, waypoints[i + 1].latitude],
          ],
        },
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [waypoints]);

  return (
    <>
      <Source id="template-preview" type="geojson" data={geojson}>
        <Layer
          id="template-preview-transit"
          type="line"
          filter={[
            "all",
            ["==", ["geometry-type"], "LineString"],
            ["==", ["get", "capture"], 0],
          ]}
          paint={{
            "line-color": "#a78bfa",
            "line-width": 1.5,
            "line-opacity": 0.7,
            "line-dasharray": [2, 2],
          }}
        />
        <Layer
          id="template-preview-capture"
          type="line"
          filter={[
            "all",
            ["==", ["geometry-type"], "LineString"],
            ["==", ["get", "capture"], 1],
          ]}
          paint={{
            "line-color": "#c4b5fd",
            "line-width": 2.5,
            "line-opacity": 0.9,
          }}
        />
        <Layer
          id="template-preview-points"
          type="circle"
          filter={["==", ["geometry-type"], "Point"]}
          paint={{
            "circle-radius": 4,
            "circle-color": "#c4b5fd",
            "circle-stroke-color": "#a78bfa",
            "circle-stroke-width": 2,
            "circle-opacity": 0.8,
          }}
        />
      </Source>

      {/* POI markers */}
      {pois.map((poi, i) => (
        <Marker
          key={`preview-poi-${i}`}
          longitude={poi.longitude}
          latitude={poi.latitude}
          anchor="center"
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#fbbf24",
              border: "2px solid #f59e0b",
              opacity: 0.8,
            }}
          />
        </Marker>
      ))}
    </>
  );
}
