import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import Map, {
  Source,
  Layer,
  Popup,
  useMap,
  MapMouseEvent,
} from "react-map-gl/mapbox";
import type { LngLatBoundsLike } from "mapbox-gl";
import mapboxgl from "mapbox-gl";
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css";
import { useMissionStore } from "@/store/missionStore";
import { useConfigStore } from "@/store/configStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { getObstacleWarnings, siteFeaturesAsObstacles } from "@/lib/geo";
import { WaypointMarker } from "./WaypointMarker";
import { PoiMarker } from "./PoiMarker";
import { HomeMarker } from "./HomeMarker";
import { TakeoffMarker } from "./TakeoffMarker";
import { MapToolbar } from "./MapToolbar";
import { TemplateDrawHandler } from "./TemplateDrawHandler";
import { PencilDrawHandler } from "./PencilDrawHandler";
import { ObstacleDrawHandler } from "./ObstacleDrawHandler";
import { ObstaclePolygon } from "./ObstaclePolygon";
import {
  SiteFeaturePolygon,
  siteFeatureFillId,
  siteFeatureExtrusionId,
  siteFeatureIdFromLayerId,
} from "./SiteFeaturePolygon";
import { AirspaceOverlay } from "./AirspaceOverlay";
import { DrawingOverlay, DrawingsAnchor } from "./DrawingOverlay";
import { setMainMap } from "@/lib/mainMap";
import { CameraFrustum } from "./CameraFrustum";
import { BoxSelectHandler } from "./BoxSelectHandler";
import { WindPanel } from "./WindPanel";
import { SimulationLayer } from "./SimulationLayer";
import { ProposalLayer } from "./ProposalLayer";
import { ProposalPanel } from "@/components/mission/ProposalPanel";
import { SimulationPlayer } from "@/components/mission/SimulationPlayer";
import { useSimulationStore } from "@/store/simulationStore";
import { Triangle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BuildingPopupData {
  lng: number;
  lat: number;
  height: number | null;
  vertices: [number, number][]; // [lat, lng][]
}

/** Sets up 3D buildings layer and syncs 2D/3D pitch/rotation. */
function SceneSetup({ is3D, mapStyle }: { is3D: boolean; mapStyle: string }) {
  const { current: map } = useMap();

  // Buildings layer (re-added on style changes)
  useEffect(() => {
    if (!map) return;

    const setup = () => {
      const m = map.getMap();
      if (!m.isStyleLoaded()) return;
      if (m.getLayer("3d-buildings")) return;

      // Ensure we have a source with building data.
      // The "composite" source in satellite styles may not include the
      // building source-layer, so add a dedicated vector tile source.
      let buildingSource = "composite";
      const style = m.getStyle();
      const compositeSource = style?.sources?.["composite"] as any;
      const hasBuildingInComposite = compositeSource?.url?.includes(
        "mapbox.mapbox-streets",
      );
      if (!hasBuildingInComposite) {
        if (!m.getSource("mapbox-streets")) {
          m.addSource("mapbox-streets", {
            type: "vector",
            url: "mapbox://mapbox.mapbox-streets-v8",
          });
        }
        buildingSource = "mapbox-streets";
      }

      const layers = style?.layers;
      let labelLayerId: string | undefined;
      if (layers) {
        for (const layer of layers) {
          if (
            layer.type === "symbol" &&
            (layer as any).layout?.["text-field"]
          ) {
            labelLayerId = layer.id;
            break;
          }
        }
      }

      m.addLayer(
        {
          id: "3d-buildings",
          source: buildingSource,
          "source-layer": "building",
          filter: ["has", "height"],
          type: "fill-extrusion",
          minzoom: 14,
          paint: {
            "fill-extrusion-color": "#aaa",
            "fill-extrusion-height": [
              "coalesce",
              ["get", "height"],
              ["get", "render_height"],
              5,
            ],
            "fill-extrusion-base": [
              "coalesce",
              ["get", "min_height"],
              ["get", "render_min_height"],
              0,
            ],
            "fill-extrusion-opacity": 0.5,
          },
        },
        labelLayerId,
      );
    };

    const m = map.getMap();
    // Retry setup: style may already be loaded or may load shortly
    if (m.isStyleLoaded()) setup();
    m.on("style.load", setup);
    // Also listen for styledata which fires more reliably with react-map-gl
    m.on("styledata", setup);
    return () => {
      m.off("style.load", setup);
      m.off("styledata", setup);
    };
  }, [map, mapStyle]);

  // Toggle pitch/rotation when is3D changes
  useEffect(() => {
    if (!map) return;
    const m = map.getMap();

    if (is3D) {
      m.setMaxPitch(85);
      m.dragRotate.enable();
      m.easeTo({ pitch: 45, duration: 500 });
    } else {
      m.easeTo({ pitch: 0, duration: 500 });
      // Set maxPitch after animation to avoid clamping during easeTo
      setTimeout(() => {
        m.setMaxPitch(0);
        m.dragRotate.disable();
      }, 600);
    }
  }, [map, is3D]);

  return null;
}

/** Lets code outside the map tree ask what is on screen (see lib/mainMap). */
function MainMapRegistry() {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map) return;
    setMainMap(map.getMap());
    return () => setMainMap(null);
  }, [map]);
  return null;
}

/** Adds a geocoding search box to the map (top-left). */
function GeocoderControl() {
  const { current: map } = useMap();
  const mapboxToken = useConfigStore((s) => s.mapboxToken);
  const geocoderRef = useRef<MapboxGeocoder | null>(null);

  useEffect(() => {
    if (!map || !mapboxToken || geocoderRef.current) return;
    const m = map.getMap();

    const geocoder = new MapboxGeocoder({
      accessToken: mapboxToken,
      mapboxgl: mapboxgl as any,
      marker: false,
      collapsed: true,
      placeholder: "Search location...",
    });

    m.addControl(geocoder, "top-left");
    geocoderRef.current = geocoder;

    return () => {
      try {
        m.removeControl(geocoder);
      } catch {
        // DOM already detached — ignore
      }
      geocoderRef.current = null;
    };
  }, [map, mapboxToken]);

  return null;
}

/**
 * Automatically fits the map to show all waypoints when a mission is loaded.
 * Triggers when waypoints go from 0 to N (N >= 2).
 */
function FitBoundsOnLoad() {
  const { current: map } = useMap();
  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);
  const obstacles = useMissionStore((s) => s.obstacles);
  const siteFeatures = useMissionStore((s) => s.siteFeatures);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const wasEmpty = prevCountRef.current === 0;
    prevCountRef.current = waypoints.length;
    if (!wasEmpty || waypoints.length < 2 || !map) return;

    const allPoints = [
      ...waypoints.map((wp) => [wp.longitude, wp.latitude] as [number, number]),
      ...pois.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...obstacles.flatMap((o) =>
        o.vertices.map((v) => [v[1], v[0]] as [number, number]),
      ),
      ...siteFeatures.flatMap((f) =>
        f.vertices.map((v) => [v[1], v[0]] as [number, number]),
      ),
    ];

    if (allPoints.length === 0) return;

    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const [lng, lat] of allPoints) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }

    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ] as LngLatBoundsLike,
      { padding: 50, maxZoom: 16 },
    );
  }, [waypoints, pois, obstacles, siteFeatures, map]);

  return null;
}

/** GeoJSON source + layer for the flight path polyline segments (3D with altitude) */
function FlightPath({ is3D }: { is3D: boolean }) {
  const waypoints = useMissionStore((s) => s.waypoints);
  const obstacles = useMissionStore((s) => s.obstacles);
  const siteFeatures = useMissionStore((s) => s.siteFeatures);
  const heightMode = useMissionStore((s) => s.config.heightMode);

  const warnings = useMemo(
    () =>
      getObstacleWarnings(
        waypoints,
        [...obstacles, ...siteFeaturesAsObstacles(siteFeatures)],
        { compareHeights: heightMode !== "EGM96" },
      ),
    [waypoints, obstacles, siteFeatures, heightMode],
  );

  const warningSegments = useMemo(() => {
    const set = new Set<number>();
    for (const w of warnings) {
      if (w.type === "crosses") set.add(w.waypointIndex);
    }
    return set;
  }, [warnings]);

  // 3D flight path segments (elevated)
  const geojson = useMemo(() => {
    if (waypoints.length < 2) return null;
    const features = waypoints.slice(0, -1).map((wp, i) => {
      const next = waypoints[i + 1];
      return {
        type: "Feature" as const,
        properties: {
          color: warningSegments.has(wp.index) ? "#ef4444" : "#3b82f6",
          zStart: wp.height,
          zEnd: next.height,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [wp.longitude, wp.latitude],
            [next.longitude, next.latitude],
          ],
        },
      };
    });
    return { type: "FeatureCollection" as const, features };
  }, [waypoints, warningSegments]);

  // Vertical dashed lines from ground to waypoint height
  // Use a tiny offset so the line has non-zero length (required for line-progress)
  const polesGeojson = useMemo(() => {
    if (waypoints.length === 0) return null;
    const features = waypoints.map((wp) => ({
      type: "Feature" as const,
      properties: { height: wp.height },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [wp.longitude, wp.latitude],
          [wp.longitude + 1e-8, wp.latitude + 1e-8],
        ],
      },
    }));
    return { type: "FeatureCollection" as const, features };
  }, [waypoints]);

  // Ground shadow path (single continuous line at ground level)
  const groundPathGeojson = useMemo(() => {
    if (waypoints.length < 2) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: waypoints.map((wp) => [wp.longitude, wp.latitude]),
      },
    };
  }, [waypoints]);

  if (!geojson) return null;

  return (
    <>
      {/* Ground shadow line (3D only) */}
      {is3D && groundPathGeojson && (
        <Source id="flight-path-ground" type="geojson" data={groundPathGeojson}>
          <Layer
            id="flight-path-ground-line"
            type="line"
            paint={{
              "line-color": "#94a3b8",
              "line-width": 1.5,
              "line-opacity": 0.3,
            }}
            layout={{
              "line-cap": "round",
              "line-join": "round",
            }}
          />
        </Source>
      )}

      {/* Flight path lines — elevated in 3D, flat in 2D */}
      <Source id="flight-path" type="geojson" data={geojson} lineMetrics={true}>
        <Layer
          id="flight-path-line"
          type="line"
          paint={{
            "line-color": ["get", "color"],
            "line-width": 3,
            "line-opacity": 0.9,
            "line-dasharray": [2, 1.2],
          }}
          layout={
            is3D
              ? ({
                  "line-cap": "round",
                  "line-join": "round",
                  "line-z-offset": [
                    "interpolate",
                    ["linear"],
                    ["line-progress"],
                    0,
                    ["get", "zStart"],
                    1,
                    ["get", "zEnd"],
                  ],
                } as any)
              : {
                  "line-cap": "round",
                  "line-join": "round",
                }
          }
        />
      </Source>

      {/* Vertical dashed lines from ground to waypoint altitude (3D only) */}
      {is3D && polesGeojson && (
        <Source
          id="wp-poles"
          type="geojson"
          data={polesGeojson}
          lineMetrics={true}
        >
          <Layer
            id="wp-poles-layer"
            type="line"
            paint={{
              "line-color": "#94a3b8",
              "line-width": 1,
              "line-opacity": 0.5,
              "line-dasharray": [2, 2],
            }}
            layout={
              {
                "line-z-offset": [
                  "interpolate",
                  ["linear"],
                  ["line-progress"],
                  0,
                  0,
                  1,
                  ["get", "height"],
                ],
              } as any
            }
          />
        </Source>
      )}
    </>
  );
}

/** Dotted lines from waypoints to their referenced POI */
function PoiPointingLines({ is3D }: { is3D: boolean }) {
  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);

  const geojson = useMemo(() => {
    const features: any[] = [];
    for (const wp of waypoints) {
      if (wp.headingMode === "towardPOI" && wp.poiId) {
        const poi = pois.find((p) => p.id === wp.poiId);
        if (poi) {
          features.push({
            type: "Feature",
            properties: {
              color: "#4ade80",
              width: 3,
              opacity: 0.8,
              zStart: wp.height,
              zEnd: poi.height,
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [wp.longitude, wp.latitude],
                [poi.longitude, poi.latitude],
              ],
            },
          });
        }
      }
    }
    return { type: "FeatureCollection" as const, features };
  }, [waypoints, pois]);

  if (geojson.features.length === 0) return null;

  return (
    <Source id="poi-pointing-lines" type="geojson" data={geojson} lineMetrics>
      <Layer
        id="poi-pointing-lines-layer"
        type="line"
        paint={{
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": ["get", "opacity"],
        }}
        layout={
          is3D
            ? ({
                "line-z-offset": [
                  "interpolate",
                  ["linear"],
                  ["line-progress"],
                  0,
                  ["get", "zStart"],
                  1,
                  ["get", "zEnd"],
                ],
              } as any)
            : {}
        }
      />
    </Source>
  );
}

export function MapView() {
  const mapboxToken = useConfigStore((s) => s.mapboxToken);
  const defaultMapView = useConfigStore((s) => s.defaultMapView);
  const waypoints = useMissionStore((s) => s.waypoints);
  const pois = useMissionStore((s) => s.pois);
  const obstacles = useMissionStore((s) => s.obstacles);
  const siteFeatures = useMissionStore((s) => s.siteFeatures);
  const isAddingWaypoint = useMissionStore((s) => s.isAddingWaypoint);
  const isAddingPoi = useMissionStore((s) => s.isAddingPoi);
  const isDrawingObstacle = useMissionStore((s) => s.isDrawingObstacle);
  const templateMode = useMissionStore((s) => s.templateMode);
  const selectedWaypointIndices = useMissionStore(
    (s) => s.selectedWaypointIndices,
  );
  const addWaypoint = useMissionStore((s) => s.addWaypoint);
  const addPoi = useMissionStore((s) => s.addPoi);
  const addObstacle = useMissionStore((s) => s.addObstacle);
  const addSiteFeature = useMissionStore((s) => s.addSiteFeature);
  const selectSiteFeature = useMissionStore((s) => s.selectSiteFeature);
  const drawings = useMissionStore((s) => s.drawings);
  const simulating = useSimulationStore((s) => s.active);
  const vizPrefs = usePreferencesStore((s) => s.preferences?.visualization);
  const [mapStyle, setMapStyle] = useState(
    vizPrefs?.mapStyle === "street"
      ? "mapbox://styles/mapbox/dark-v11"
      : "mapbox://styles/mapbox/satellite-streets-v12",
  );
  const [is3D, setIs3D] = useState(vizPrefs?.viewMode === "3d");
  const [buildingPopup, setBuildingPopup] = useState<BuildingPopupData | null>(
    null,
  );

  const cursorClass =
    templateMode === "pencil" || templateMode === "corridor"
      ? "map-tool-pencil"
      : templateMode
        ? "map-tool-template"
        : isDrawingObstacle
          ? "map-tool-obstacle"
          : isAddingWaypoint
            ? "map-tool-waypoint"
            : isAddingPoi
              ? "map-tool-poi"
              : "";

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      if (templateMode || isDrawingObstacle) return;
      if (isAddingWaypoint) {
        addWaypoint(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      if (isAddingPoi) {
        addPoi(e.lngLat.lat, e.lngLat.lng);
        return;
      }

      // A site feature was clicked: select it
      const hitId = e.features
        ?.map((f) => siteFeatureIdFromLayerId(f.layer?.id ?? ""))
        .find((id) => id !== null);
      if (hitId) {
        selectSiteFeature(hitId);
        setBuildingPopup(null);
        return;
      }

      // Check if a 3D building was clicked
      const map = e.target as any;
      if (map.getLayer && map.getLayer("3d-buildings")) {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["3d-buildings"],
        });
        if (features && features.length > 0) {
          const feature = features[0];
          const geometry = feature.geometry;
          if (geometry.type === "Polygon" && geometry.coordinates?.[0]) {
            // Convert [lng, lat] → [lat, lng] for our obstacle format
            const ring = geometry.coordinates[0] as [number, number][];
            // Remove the closing duplicate vertex
            const vertices: [number, number][] = ring
              .slice(0, -1)
              .map(([lng, lat]) => [lat, lng] as [number, number]);

            if (vertices.length >= 3) {
              const height = feature.properties?.height ?? null;
              setBuildingPopup({
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
                height: height ? Math.round(height) : null,
                vertices,
              });
              return;
            }
          }
        }
      }

      // Clicked elsewhere — dismiss popup
      setBuildingPopup(null);
    },
    [
      isAddingWaypoint,
      isAddingPoi,
      templateMode,
      isDrawingObstacle,
      addWaypoint,
      addPoi,
      selectSiteFeature,
    ],
  );

  const cursor =
    templateMode || isDrawingObstacle || isAddingWaypoint || isAddingPoi
      ? "crosshair"
      : "grab";

  if (!mapboxToken) {
    return (
      <div className="relative h-full w-full flex items-center justify-center bg-background text-muted-foreground">
        <p>Mapbox token not configured. Add MAPBOX_TOKEN to your .env file.</p>
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full ${cursorClass}`}>
      <Map
        mapboxAccessToken={mapboxToken}
        initialViewState={{
          longitude: defaultMapView.longitude,
          latitude: defaultMapView.latitude,
          zoom: defaultMapView.zoom,
          pitch: 0,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        cursor={cursor}
        onClick={handleClick}
        interactiveLayerIds={siteFeatures.flatMap((f) =>
          is3D && (f.heightM ?? 0) > 0 && f.kind !== "lot"
            ? [siteFeatureFillId(f.id), siteFeatureExtrusionId(f.id)]
            : [siteFeatureFillId(f.id)],
        )}
        doubleClickZoom={false}
        boxZoom={false}
        id="main-map"
        terrain={is3D ? { source: "mapbox-dem", exaggeration: 1 } : undefined}
      >
        {/* DEM source — always present so terrain prop can reference it */}
        <Source
          id="mapbox-dem"
          type="raster-dem"
          url="mapbox://mapbox.mapbox-terrain-dem-v1"
          tileSize={512}
          maxzoom={14}
        />
        {/* First of our layers: drawings go just below it, under everything else */}
        <DrawingsAnchor />
        {drawings
          .filter((d) => d.visible)
          .map((d) => (
            <DrawingOverlay
              key={d.id}
              drawing={d}
              lightLines={
                mapStyle.includes("satellite") || mapStyle.includes("dark")
              }
            />
          ))}
        <MainMapRegistry />
        <FitBoundsOnLoad />
        <GeocoderControl />
        <SceneSetup is3D={is3D} mapStyle={mapStyle} />
        <FlightPath is3D={is3D} />
        <PoiPointingLines is3D={is3D} />
        <TemplateDrawHandler />
        <PencilDrawHandler />
        <ObstacleDrawHandler />
        <BoxSelectHandler />
        <WindPanel />
        <SimulationLayer is3D={is3D} />
        <ProposalLayer />
        <AirspaceOverlay />
        {siteFeatures.map((feature) => (
          <SiteFeaturePolygon key={feature.id} feature={feature} is3D={is3D} />
        ))}
        {obstacles.map((obstacle) => (
          <ObstaclePolygon key={obstacle.id} obstacle={obstacle} is3D={is3D} />
        ))}
        <HomeMarker />
        <TakeoffMarker />
        {waypoints.map((wp) => (
          <WaypointMarker key={wp.index} waypoint={wp} is3D={is3D} />
        ))}
        {!simulating &&
          selectedWaypointIndices.size === 1 &&
          (() => {
            const idx = [...selectedWaypointIndices][0];
            const wp = waypoints.find((w) => w.index === idx);
            return wp ? (
              <CameraFrustum waypoint={wp} pois={pois} is3D={is3D} />
            ) : null;
          })()}
        {pois.map((poi) => (
          <PoiMarker key={poi.id} poi={poi} is3D={is3D} />
        ))}

        {/* Building-to-obstacle popup */}
        {buildingPopup && (
          <Popup
            longitude={buildingPopup.lng}
            latitude={buildingPopup.lat}
            anchor="bottom"
            closeOnClick={false}
            onClose={() => setBuildingPopup(null)}
            className="building-popup"
          >
            <div className="flex flex-col gap-2 p-1 min-w-[160px]">
              <div className="text-xs text-zinc-300">
                <strong className="text-white">Building</strong>
                {buildingPopup.height != null && (
                  <span className="ml-2 text-zinc-400">
                    {buildingPopup.height}m tall
                  </span>
                )}
              </div>
              <div className="text-[10px] text-zinc-500">
                {buildingPopup.vertices.length} vertices
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 h-7 text-xs"
                onClick={() => {
                  addObstacle(buildingPopup.vertices, buildingPopup.height);
                  setBuildingPopup(null);
                }}
              >
                <Triangle className="h-3 w-3" />
                Convert to obstacle
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 h-7 text-xs"
                onClick={() => {
                  // The first one added is most likely the house itself.
                  const hasExisting = useMissionStore
                    .getState()
                    .siteFeatures.some((f) => f.kind === "existing");
                  addSiteFeature(
                    buildingPopup.vertices,
                    hasExisting ? "other" : "existing",
                    { heightM: buildingPopup.height, source: "map" },
                  );
                  setBuildingPopup(null);
                }}
              >
                <Building2 className="h-3 w-3" />
                Add as building
              </Button>
            </div>
          </Popup>
        )}
      </Map>

      {/* Style switcher + 2D/3D toggle */}
      <div className="absolute bottom-4 left-4 z-10 flex gap-1">
        <button
          className={`px-2 py-1 text-xs rounded ${mapStyle.includes("dark") ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground border border-border"}`}
          onClick={() => setMapStyle("mapbox://styles/mapbox/dark-v11")}
        >
          Street
        </button>
        <button
          className={`px-2 py-1 text-xs rounded ${mapStyle.includes("satellite") ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground border border-border"}`}
          onClick={() =>
            setMapStyle("mapbox://styles/mapbox/satellite-streets-v12")
          }
        >
          Satellite
        </button>
        <div className="w-px bg-border mx-1" />
        <button
          className={`px-2 py-1 text-xs rounded ${!is3D ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground border border-border"}`}
          onClick={() => setIs3D(false)}
        >
          2D
        </button>
        <button
          className={`px-2 py-1 text-xs rounded ${is3D ? "bg-primary text-primary-foreground" : "bg-background/90 text-foreground border border-border"}`}
          onClick={() => setIs3D(true)}
        >
          3D
        </button>
      </div>

      <MapToolbar />
      <SimulationPlayer />
      <ProposalPanel />
    </div>
  );
}
