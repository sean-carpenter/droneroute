import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Source, Layer, Marker, useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { cameraForPayload } from "@/lib/camera";
import { formatDistance } from "@/lib/units";
import { TemplateConfigPanel } from "./TemplateConfigPanel";
import { TemplatePreview } from "./TemplatePreview";
import type {
  OrbitParams,
  GridParams,
  FacadeParams,
  FacadeBoundaryKind,
  TowerParams,
  BoundaryFacadeParams,
  BoundaryFacadeResult,
  TemplateResult,
} from "@/lib/templates";
import {
  generateOrbit,
  generateGrid,
  generateFacade,
  generateTower,
  generateBoundaryFacade,
  pointOnRay,
  withWallCoverage,
  DEFAULT_TOWER_PARAMS,
  DEFAULT_ORBIT_PARAMS,
  DEFAULT_GRID_PARAMS,
  DEFAULT_FACADE_PARAMS,
  DEFAULT_RADIAL_FACADE,
  DEFAULT_POLYGON_FACADE,
} from "@/lib/templates";

/** Haversine distance in meters */
function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Templates drawn as a freehand path are handled by PencilDrawHandler. */
function isPathTemplate(mode: string): boolean {
  return mode === "pencil" || mode === "corridor";
}

interface DragState {
  start: [number, number];
  end: [number, number];
}

/** Generate a GeoJSON circle for orbit preview */
function circleGeoJson(center: [number, number], radiusM: number) {
  const [lat, lng] = center;
  const coords: [number, number][] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusM / 6371000) * Math.cos(angle) * (180 / Math.PI);
    const dLng =
      ((radiusM / 6371000) * Math.sin(angle) * (180 / Math.PI)) /
      Math.cos((lat * Math.PI) / 180);
    coords.push([lng + dLng, lat + dLat]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: coords },
  };
}

function ringGeoJson(points: [number, number][]) {
  const coordinates = points.map(([lat, lng]) => [lng, lat]);
  if (coordinates.length > 2) {
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1])
      coordinates.push([...first]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates },
  };
}

function isBoundaryResult(
  result: TemplateResult,
): result is BoundaryFacadeResult {
  return "plannedCount" in result;
}

function RadiusHandle({
  position,
  onMove,
}: {
  position: [number, number];
  onMove: (next: [number, number]) => void;
}) {
  const { current: map } = useMap();
  return (
    <Marker longitude={position[1]} latitude={position[0]} anchor="center">
      <div
        title="Drag to set the radius"
        onPointerDown={(event) => {
          event.stopPropagation();
          event.preventDefault();
          const mapbox = map?.getMap();
          if (!mapbox) return;
          mapbox.dragPan.disable();
          const move = (ev: { lngLat: { lat: number; lng: number } }) => {
            onMove([ev.lngLat.lat, ev.lngLat.lng]);
          };
          const up = () => {
            mapbox.dragPan.enable();
            mapbox.off("mousemove", move);
            mapbox.off("mouseup", up);
          };
          mapbox.on("mousemove", move);
          mapbox.on("mouseup", up);
        }}
        className="h-3 w-3 cursor-grab rounded-full border-2 border-purple-300 bg-white"
      />
    </Marker>
  );
}

export function TemplateDrawHandler() {
  const templateMode = useMissionStore((s) => s.templateMode);
  const setTemplateMode = useMissionStore((s) => s.setTemplateMode);
  const appendWaypoints = useMissionStore((s) => s.appendWaypoints);
  const pois = useMissionStore((s) => s.pois);
  const payloadEnumValue = useMissionStore((s) => s.config.payloadEnumValue);
  const camera = cameraForPayload(payloadEnumValue).camera;
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const { current: map } = useMap();

  const [dragging, setDragging] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [orbitParams, setOrbitParams] = useState<OrbitParams | null>(null);
  const [gridParams, setGridParams] = useState<GridParams | null>(null);
  const [facadeParams, setFacadeParams] = useState<FacadeParams | null>(null);
  // Every change to a wall goes through here, so automatic rows and columns
  // follow the distance, the wall and the altitudes ("sticky" coverage).
  const updateFacade = useCallback(
    (params: FacadeParams | null) =>
      setFacadeParams(params && withWallCoverage(params, camera)),
    [camera],
  );
  const [facadeBoundary, setFacadeBoundary] =
    useState<FacadeBoundaryKind>("wall");
  const [boundaryParams, setBoundaryParams] =
    useState<BoundaryFacadeParams | null>(null);
  const [polygonVertices, setPolygonVertices] = useState<[number, number][]>(
    [],
  );
  const polygonVerticesRef = useRef<[number, number][]>([]);
  const [towerParams, setTowerParams] = useState<TowerParams | null>(null);

  const resetState = useCallback(() => {
    setDragging(false);
    setDragState(null);
    setConfirmed(false);
    setOrbitParams(null);
    setGridParams(null);
    setFacadeParams(null);
    setBoundaryParams(null);
    polygonVerticesRef.current = [];
    setPolygonVertices([]);
    setTowerParams(null);
  }, []);

  const selectFacadeBoundary = useCallback((kind: FacadeBoundaryKind) => {
    setFacadeBoundary((current) => {
      if (current === kind) return current;
      setDragging(false);
      setDragState(null);
      setConfirmed(false);
      setFacadeParams(null);
      setBoundaryParams(null);
      polygonVerticesRef.current = [];
      setPolygonVertices([]);
      return kind;
    });
  }, []);

  useEffect(() => {
    resetState();
    setFacadeBoundary("wall");
  }, [templateMode, resetState]);

  // A seed (from a route proposal) opens the template already filled in,
  // skipping the drag. Declared after the reset above so it wins when both
  // run for the same change.
  const templateSeed = useMissionStore((s) => s.templateSeed);
  const consumeTemplateSeed = useMissionStore((s) => s.consumeTemplateSeed);
  useEffect(() => {
    if (!templateSeed || isPathTemplate(templateSeed.type)) return;
    resetState();
    if (templateSeed.type === "grid") setGridParams(templateSeed.params);
    else if (templateSeed.type === "orbit") setOrbitParams(templateSeed.params);
    else if (templateSeed.type === "tower") setTowerParams(templateSeed.params);
    else if (templateSeed.type === "facade") {
      if ("boundary" in templateSeed.params) {
        setFacadeBoundary(templateSeed.params.boundary);
        setBoundaryParams(templateSeed.params);
      } else {
        setFacadeBoundary("wall");
        updateFacade(templateSeed.params);
      }
    }
    setConfirmed(true);
    consumeTemplateSeed();
  }, [templateSeed, consumeTemplateSeed, resetState]);

  // Map mouse events for drag-to-draw
  useEffect(() => {
    if (!map || !templateMode || isPathTemplate(templateMode)) return;
    if (templateMode === "facade" && facadeBoundary === "polygon") return;

    let isDragging = false;
    let currentDrag: DragState | null = null;

    const onMouseDown = (e: any) => {
      if (confirmed) return;
      e.preventDefault();
      map.getMap().dragPan.disable();
      const pos: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      isDragging = true;
      currentDrag = { start: pos, end: pos };
      setDragging(true);
      setDragState(currentDrag);
    };

    const onMouseMove = (e: any) => {
      if (!isDragging || !currentDrag) return;
      currentDrag = { ...currentDrag, end: [e.lngLat.lat, e.lngLat.lng] };
      setDragState({ ...currentDrag });
    };

    const onMouseUp = (e: any) => {
      if (!isDragging || !currentDrag) return;
      map.getMap().dragPan.enable();
      isDragging = false;

      const endPos: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      const finalDrag = { ...currentDrag, end: endPos };
      setDragState(finalDrag);
      setDragging(false);

      const dist = haversine(
        finalDrag.start[0],
        finalDrag.start[1],
        finalDrag.end[0],
        finalDrag.end[1],
      );

      if (dist < 5) {
        resetState();
        return;
      }

      const tm = useMissionStore.getState().templateMode;
      if (tm === "orbit") {
        setOrbitParams({
          ...DEFAULT_ORBIT_PARAMS,
          center: finalDrag.start,
          radiusM: Math.round(dist),
        });
      } else if (tm === "grid") {
        setGridParams({
          ...DEFAULT_GRID_PARAMS,
          corner1: finalDrag.start,
          corner2: finalDrag.end,
        });
      } else if (tm === "facade") {
        if (facadeBoundary === "circle" || facadeBoundary === "spiral") {
          const radiusM = Math.round(dist);
          setBoundaryParams({
            ...DEFAULT_RADIAL_FACADE,
            boundary: facadeBoundary,
            center: finalDrag.start,
            handle: finalDrag.end,
            radiusBottomM: radiusM,
            radiusTopM: radiusM,
          });
        } else {
          updateFacade({
            ...DEFAULT_FACADE_PARAMS,
            point1: finalDrag.start,
            point2: finalDrag.end,
          });
        }
      } else if (tm === "tower") {
        setTowerParams({
          ...DEFAULT_TOWER_PARAMS,
          center: finalDrag.start,
          radiusM: Math.round(dist),
        });
      }

      setConfirmed(true);
      currentDrag = null;
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);

    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      map.getMap().dragPan.enable();
    };
  }, [map, templateMode, confirmed, resetState, facadeBoundary]);

  // Polygon facades are clicked corner by corner, like an obstacle.
  useEffect(() => {
    if (
      !map ||
      templateMode !== "facade" ||
      facadeBoundary !== "polygon" ||
      confirmed
    ) {
      return;
    }
    const mapbox = map.getMap();
    mapbox.doubleClickZoom.disable();

    const finish = (vertices: [number, number][]) => {
      if (vertices.length < 3) return;
      setBoundaryParams({ ...DEFAULT_POLYGON_FACADE, vertices });
      setConfirmed(true);
      polygonVerticesRef.current = [];
      setPolygonVertices([]);
    };

    const onClick = (e: { lngLat: { lat: number; lng: number } }) => {
      const vertices = polygonVerticesRef.current;
      if (vertices.length >= 3) {
        const first = mapbox.project([vertices[0][1], vertices[0][0]]);
        const click = mapbox.project([e.lngLat.lng, e.lngLat.lat]);
        if (Math.hypot(first.x - click.x, first.y - click.y) < 15) {
          finish(vertices);
          return;
        }
      }
      const next: [number, number][] = [
        ...vertices,
        [e.lngLat.lat, e.lngLat.lng],
      ];
      polygonVerticesRef.current = next;
      setPolygonVertices(next);
    };

    const onDblClick = (e: { preventDefault: () => void }) => {
      e.preventDefault();
      let vertices = polygonVerticesRef.current;
      if (vertices.length >= 2) {
        const last = vertices[vertices.length - 1];
        const prev = vertices[vertices.length - 2];
        if (haversine(last[0], last[1], prev[0], prev[1]) < 1) {
          vertices = vertices.slice(0, -1);
        }
      }
      finish(vertices);
    };

    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      mapbox.doubleClickZoom.enable();
    };
  }, [map, templateMode, facadeBoundary, confirmed]);

  const preview: TemplateResult | null = useMemo(() => {
    if (orbitParams) return generateOrbit(orbitParams, pois);
    if (gridParams) return generateGrid({ ...gridParams, camera });
    if (boundaryParams) {
      return generateBoundaryFacade({ ...boundaryParams, camera }, pois);
    }
    if (facadeParams) return generateFacade(facadeParams, pois);
    if (towerParams) return generateTower(towerParams, pois);
    return null;
  }, [
    orbitParams,
    gridParams,
    facadeParams,
    boundaryParams,
    towerParams,
    camera,
    pois,
  ]);

  const dragPreview = useMemo(() => {
    if (!dragging || !dragState || !templateMode) return null;
    const dist = haversine(
      dragState.start[0],
      dragState.start[1],
      dragState.end[0],
      dragState.end[1],
    );
    if (dist < 5) return null;

    if (templateMode === "orbit") {
      return generateOrbit({
        ...DEFAULT_ORBIT_PARAMS,
        center: dragState.start,
        radiusM: Math.round(dist),
      });
    }
    if (templateMode === "grid") {
      return generateGrid({
        ...DEFAULT_GRID_PARAMS,
        corner1: dragState.start,
        corner2: dragState.end,
      });
    }
    if (templateMode === "facade") {
      if (facadeBoundary === "circle" || facadeBoundary === "spiral") {
        const radiusM = Math.round(dist);
        return generateBoundaryFacade({
          ...DEFAULT_RADIAL_FACADE,
          boundary: facadeBoundary,
          center: dragState.start,
          handle: dragState.end,
          radiusBottomM: radiusM,
          radiusTopM: radiusM,
          camera,
        });
      }
      return generateFacade(
        withWallCoverage(
          {
            ...DEFAULT_FACADE_PARAMS,
            point1: dragState.start,
            point2: dragState.end,
          },
          camera,
        ),
      );
    }
    if (templateMode === "tower") {
      return generateTower({
        ...DEFAULT_TOWER_PARAMS,
        center: dragState.start,
        radiusM: Math.round(dist),
      });
    }
    return null;
  }, [dragging, dragState, templateMode, facadeBoundary, camera]);

  // Build drag guide GeoJSON
  const dragGuideGeojson = useMemo(() => {
    if (!dragging || !dragState) return null;
    if (templateMode === "orbit" || templateMode === "tower") {
      const dist = haversine(
        dragState.start[0],
        dragState.start[1],
        dragState.end[0],
        dragState.end[1],
      );
      return circleGeoJson(dragState.start, dist);
    }
    if (templateMode === "grid") {
      const [lat1, lng1] = dragState.start;
      const [lat2, lng2] = dragState.end;
      return {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [lng1, lat1],
            [lng2, lat1],
            [lng2, lat2],
            [lng1, lat2],
            [lng1, lat1],
          ],
        },
      };
    }
    if (templateMode === "facade") {
      if (facadeBoundary === "circle" || facadeBoundary === "spiral") {
        const dist = haversine(
          dragState.start[0],
          dragState.start[1],
          dragState.end[0],
          dragState.end[1],
        );
        return circleGeoJson(dragState.start, dist);
      }
      return {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [dragState.start[1], dragState.start[0]],
            [dragState.end[1], dragState.end[0]],
          ],
        },
      };
    }
    return null;
  }, [dragging, dragState, templateMode, facadeBoundary]);

  if (!templateMode || isPathTemplate(templateMode)) return null;

  const handleApply = () => {
    if (preview) {
      appendWaypoints(preview.waypoints, preview.pois);
    }
    resetState();
  };

  const handleCancel = () => {
    resetState();
    setTemplateMode(null);
  };

  const activePreview = confirmed ? preview : dragPreview;
  const radial =
    boundaryParams && boundaryParams.boundary !== "polygon"
      ? boundaryParams
      : null;
  const taperApplies =
    !!radial &&
    radial.tapered &&
    (radial.boundary === "spiral" || radial.pattern === "horizontal");
  const dragRadiusM =
    dragging &&
    dragState &&
    templateMode === "facade" &&
    (facadeBoundary === "circle" || facadeBoundary === "spiral")
      ? haversine(
          dragState.start[0],
          dragState.start[1],
          dragState.end[0],
          dragState.end[1],
        )
      : null;
  const boundaryInfo = preview && isBoundaryResult(preview) ? preview : null;
  const polygonOutline =
    boundaryParams?.boundary === "polygon" ? boundaryParams.vertices : null;

  return (
    <>
      {/* Draw guide during drag */}
      {dragGuideGeojson && (
        <Source id="template-drag-guide" type="geojson" data={dragGuideGeojson}>
          <Layer
            id="template-drag-guide-layer"
            type="line"
            paint={{
              "line-color": "#a78bfa",
              "line-width": 2,
              "line-opacity": 0.5,
              "line-dasharray": [3, 2],
            }}
          />
        </Source>
      )}

      {radial && (
        <Source
          id="facade-structure"
          type="geojson"
          data={circleGeoJson(radial.center, radial.radiusBottomM)}
        >
          <Layer
            id="facade-structure-layer"
            type="line"
            paint={{
              "line-color": "#a78bfa",
              "line-width": 2,
              "line-opacity": 0.85,
            }}
          />
        </Source>
      )}
      {radial && taperApplies && (
        <Source
          id="facade-structure-top"
          type="geojson"
          data={circleGeoJson(radial.center, radial.radiusTopM)}
        >
          <Layer
            id="facade-structure-top-layer"
            type="line"
            paint={{
              "line-color": "#a78bfa",
              "line-width": 2,
              "line-opacity": 0.55,
              "line-dasharray": [2, 2],
            }}
          />
        </Source>
      )}
      {polygonOutline && polygonOutline.length >= 3 && (
        <Source
          id="facade-polygon"
          type="geojson"
          data={ringGeoJson(polygonOutline)}
        >
          <Layer
            id="facade-polygon-layer"
            type="line"
            paint={{
              "line-color": "#a78bfa",
              "line-width": 2,
              "line-opacity": 0.85,
            }}
          />
        </Source>
      )}
      {polygonVertices.length >= 2 && (
        <Source
          id="facade-polygon-drawing"
          type="geojson"
          data={ringGeoJson(polygonVertices)}
        >
          <Layer
            id="facade-polygon-drawing-layer"
            type="line"
            paint={{
              "line-color": "#a78bfa",
              "line-width": 2,
              "line-opacity": 0.5,
              "line-dasharray": [3, 2],
            }}
          />
        </Source>
      )}
      {polygonVertices.map((vertex, index) => (
        <Marker
          key={`facade-vertex-${index}`}
          longitude={vertex[1]}
          latitude={vertex[0]}
          anchor="center"
        >
          <div className="h-2 w-2 rounded-full bg-purple-300" />
        </Marker>
      ))}

      {dragRadiusM != null && dragState && (
        <Marker
          longitude={(dragState.start[1] + dragState.end[1]) / 2}
          latitude={(dragState.start[0] + dragState.end[0]) / 2}
          anchor="bottom"
        >
          <div className="mb-1 whitespace-nowrap rounded border border-border bg-card/95 px-1.5 py-0.5 text-[10px]">
            {formatDistance(dragRadiusM, unitSystem)} from center
          </div>
        </Marker>
      )}
      {radial && (
        <Marker
          longitude={
            pointOnRay(
              radial.center,
              radial.handle,
              radial.radiusBottomM / 2,
            )[1]
          }
          latitude={
            pointOnRay(
              radial.center,
              radial.handle,
              radial.radiusBottomM / 2,
            )[0]
          }
          anchor="bottom"
        >
          <div className="mb-1 whitespace-nowrap rounded border border-border bg-card/95 px-1.5 py-0.5 text-[10px]">
            {formatDistance(radial.radiusBottomM, unitSystem)} from center
          </div>
        </Marker>
      )}
      {radial && (
        <RadiusHandle
          position={pointOnRay(
            radial.center,
            radial.handle,
            radial.radiusBottomM,
          )}
          onMove={(next) => {
            const radiusM = Math.max(
              0,
              Math.round(
                haversine(radial.center[0], radial.center[1], next[0], next[1]),
              ),
            );
            setBoundaryParams({
              ...radial,
              handle: next,
              radiusBottomM: radiusM,
            });
          }}
        />
      )}
      {radial && taperApplies && (
        <RadiusHandle
          position={pointOnRay(radial.center, radial.handle, radial.radiusTopM)}
          onMove={(next) => {
            const radiusM = Math.max(
              0,
              Math.round(
                haversine(radial.center[0], radial.center[1], next[0], next[1]),
              ),
            );
            setBoundaryParams({
              ...radial,
              tapered: true,
              radiusTopM: radiusM,
              handle: pointOnRay(
                radial.center,
                next,
                Math.max(radial.radiusBottomM, 1),
              ),
            });
          }}
        />
      )}

      {/* Center marker for orbit drag */}
      {dragging &&
        dragState &&
        (templateMode === "orbit" ||
          templateMode === "tower" ||
          (templateMode === "facade" &&
            (facadeBoundary === "circle" || facadeBoundary === "spiral"))) && (
          <Marker
            longitude={dragState.start[1]}
            latitude={dragState.start[0]}
            anchor="center"
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#a78bfa",
              }}
            />
          </Marker>
        )}

      {/* Facade endpoint markers during drag */}
      {dragging &&
        dragState &&
        templateMode === "facade" &&
        facadeBoundary === "wall" && (
          <>
            <Marker
              longitude={dragState.start[1]}
              latitude={dragState.start[0]}
              anchor="center"
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#a78bfa",
                }}
              />
            </Marker>
            <Marker
              longitude={dragState.end[1]}
              latitude={dragState.end[0]}
              anchor="center"
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#a78bfa",
                }}
              />
            </Marker>
          </>
        )}

      {/* Preview waypoints */}
      {activePreview && <TemplatePreview result={activePreview} />}

      {/* Config panel. Facade shows the boundary choice before the outline exists. */}
      {(confirmed || templateMode === "facade") && (
        <TemplateConfigPanel
          type={templateMode}
          orbitParams={orbitParams}
          gridParams={gridParams}
          facadeParams={facadeParams}
          facadeBoundary={facadeBoundary}
          onFacadeBoundaryChange={selectFacadeBoundary}
          drawing={templateMode === "facade" && !confirmed}
          liveRadiusM={dragRadiusM}
          boundaryParams={boundaryParams}
          onBoundaryChange={setBoundaryParams}
          boundaryInfo={boundaryInfo}
          onOrbitChange={setOrbitParams}
          onGridChange={setGridParams}
          onFacadeChange={updateFacade}
          towerParams={towerParams}
          onTowerChange={setTowerParams}
          pois={pois}
          onApply={handleApply}
          onCancel={handleCancel}
          waypointCount={activePreview?.waypoints.length ?? 0}
          previewWaypoints={activePreview?.waypoints}
        />
      )}
    </>
  );
}
