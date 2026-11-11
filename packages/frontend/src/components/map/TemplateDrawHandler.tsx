import { useState, useCallback, useMemo, useEffect } from "react";
import { Source, Layer, Marker, useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";
import { cameraForPayload } from "@/lib/camera";
import { TemplateConfigPanel } from "./TemplateConfigPanel";
import { TemplatePreview } from "./TemplatePreview";
import type {
  OrbitParams,
  GridParams,
  FacadeParams,
  TowerParams,
  TemplateResult,
} from "@/lib/templates";
import {
  generateOrbit,
  generateGrid,
  generateFacade,
  generateTower,
  DEFAULT_TOWER_PARAMS,
  DEFAULT_ORBIT_PARAMS,
  DEFAULT_GRID_PARAMS,
  DEFAULT_FACADE_PARAMS,
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

export function TemplateDrawHandler() {
  const templateMode = useMissionStore((s) => s.templateMode);
  const setTemplateMode = useMissionStore((s) => s.setTemplateMode);
  const appendWaypoints = useMissionStore((s) => s.appendWaypoints);
  const pois = useMissionStore((s) => s.pois);
  const payloadEnumValue = useMissionStore((s) => s.config.payloadEnumValue);
  const camera = cameraForPayload(payloadEnumValue).camera;
  const { current: map } = useMap();

  const [dragging, setDragging] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [orbitParams, setOrbitParams] = useState<OrbitParams | null>(null);
  const [gridParams, setGridParams] = useState<GridParams | null>(null);
  const [facadeParams, setFacadeParams] = useState<FacadeParams | null>(null);
  const [towerParams, setTowerParams] = useState<TowerParams | null>(null);

  const resetState = useCallback(() => {
    setDragging(false);
    setDragState(null);
    setConfirmed(false);
    setOrbitParams(null);
    setGridParams(null);
    setFacadeParams(null);
    setTowerParams(null);
  }, []);

  useEffect(() => {
    resetState();
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
      setFacadeParams(templateSeed.params);
    }
    setConfirmed(true);
    consumeTemplateSeed();
  }, [templateSeed, consumeTemplateSeed, resetState]);

  // Map mouse events for drag-to-draw
  useEffect(() => {
    if (!map || !templateMode || isPathTemplate(templateMode)) return;

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
        setFacadeParams({
          ...DEFAULT_FACADE_PARAMS,
          point1: finalDrag.start,
          point2: finalDrag.end,
        });
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
  }, [map, templateMode, confirmed, resetState]);

  const preview: TemplateResult | null = useMemo(() => {
    if (orbitParams) return generateOrbit(orbitParams, pois);
    if (gridParams) return generateGrid({ ...gridParams, camera });
    if (facadeParams) return generateFacade(facadeParams, pois);
    if (towerParams) return generateTower(towerParams, pois);
    return null;
  }, [orbitParams, gridParams, facadeParams, towerParams, camera, pois]);

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
      return generateFacade({
        ...DEFAULT_FACADE_PARAMS,
        point1: dragState.start,
        point2: dragState.end,
      });
    }
    if (templateMode === "tower") {
      return generateTower({
        ...DEFAULT_TOWER_PARAMS,
        center: dragState.start,
        radiusM: Math.round(dist),
      });
    }
    return null;
  }, [dragging, dragState, templateMode]);

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
  }, [dragging, dragState, templateMode]);

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

      {/* Center marker for orbit drag */}
      {dragging &&
        dragState &&
        (templateMode === "orbit" || templateMode === "tower") && (
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
      {dragging && dragState && templateMode === "facade" && (
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

      {/* Config panel */}
      {confirmed && (
        <TemplateConfigPanel
          type={templateMode}
          orbitParams={orbitParams}
          gridParams={gridParams}
          facadeParams={facadeParams}
          onOrbitChange={setOrbitParams}
          onGridChange={setGridParams}
          onFacadeChange={setFacadeParams}
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
