import { useEffect, useMemo, useState } from "react";
import { Layer, Marker, Source, useMap } from "react-map-gl/mapbox";
import type { ImageSource, MapMouseEvent, MapTouchEvent } from "mapbox-gl";
import type { SiteDrawing } from "@droneroute/shared";
import { useMissionStore } from "@/store/missionStore";
import { pointInPolygon } from "@/lib/geo";
import { RotateCw } from "lucide-react";
import {
  drawingCorners,
  drawingImageCoordinates,
  drawingRotateHandle,
  rotationTowards,
  widthFromCorner,
} from "@/lib/drawings";

/**
 * Empty layer added before every other layer of ours. Drawings are inserted
 * just below it, so they sit on the basemap but under the route, site
 * features and obstacles.
 */
export const DRAWINGS_ANCHOR_ID = "drawings-anchor";

export function DrawingsAnchor() {
  return (
    <Layer
      id={DRAWINGS_ANCHOR_ID}
      type="background"
      paint={{ "background-opacity": 0 }}
    />
  );
}

type Handle = "move" | "rotate" | 0 | 1 | 2 | 3;
type Placement = Pick<SiteDrawing, "center" | "widthM" | "rotationDeg">;

const HANDLE_STYLE = {
  width: 14,
  height: 14,
  borderRadius: 3,
  background: "#ffffff",
  border: "2px solid #0ea5e9",
  boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
} as const;

/**
 * A drawing laid over the map. When selected it shows handles: drag the
 * drawing itself (or its middle handle) to move it, a corner to resize it
 * (proportions kept), the round handle to rotate it. While dragging, only the outline and the image corners move; the
 * change is saved once on release, so it is a single undo step.
 */
export function DrawingOverlay({
  drawing,
  lightLines,
}: {
  drawing: SiteDrawing;
  /** Draw the lines white: black ink is lost on satellite or dark maps. */
  lightLines: boolean;
}) {
  const { current: map } = useMap();
  const selected = useMissionStore((s) => s.selectedDrawingId === drawing.id);
  const updateDrawing = useMissionStore((s) => s.updateDrawing);

  const [preview, setPreview] = useState<Placement | null>(null);
  const [active, setActive] = useState<Handle | null>(null);
  const [pointer, setPointer] = useState<[number, number] | null>(null);

  const shown = useMemo(() => ({ ...drawing, ...preview }), [drawing, preview]);
  const sourceId = `drawing-${drawing.id}`;

  // Move the image's corners directly whenever the placement changes, while
  // dragging and after typed or slider edits alike: react-map-gl does not
  // pass coordinate changes on to an existing image source.
  useEffect(() => {
    if (!map) return;
    const source = map.getSource(sourceId) as ImageSource | undefined;
    source?.setCoordinates(drawingImageCoordinates(shown));
  }, [map, shown, sourceId]);

  // While the handles show, the drawing itself can be dragged to move it.
  // Only presses on the map canvas count, so the handles keep their own drags.
  useEffect(() => {
    if (!map || !selected) return;
    const m = map.getMap();
    const canvas = m.getCanvas();
    const corners = drawingCorners(drawing);
    const isOver = (e: MapMouseEvent | MapTouchEvent) =>
      pointInPolygon([e.lngLat.lat, e.lngLat.lng], corners);

    let from: { lat: number; lng: number } | null = null;
    let moved: [number, number] | null = null;
    let cursorBefore: string | null = null;

    const onDown = (e: MapMouseEvent | MapTouchEvent) => {
      if ("points" in e && e.points.length !== 1) return; // pinch zoom
      if (e.originalEvent.target !== canvas || !isOver(e)) return;
      e.preventDefault(); // the map must not pan while the drawing moves
      from = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      moved = null;
      setActive("move");
    };
    const onMove = (e: MapMouseEvent | MapTouchEvent) => {
      if (from) {
        moved = [
          drawing.center[0] + e.lngLat.lat - from.lat,
          drawing.center[1] + e.lngLat.lng - from.lng,
        ];
        setPreview({
          center: moved,
          widthM: drawing.widthM,
          rotationDeg: drawing.rotationDeg,
        });
        return;
      }
      // Show a move cursor over the drawing, and give back the tool's after
      const over = isOver(e);
      if (over && cursorBefore === null) {
        cursorBefore = canvas.style.cursor;
        canvas.style.cursor = "move";
      } else if (!over && cursorBefore !== null) {
        canvas.style.cursor = cursorBefore;
        cursorBefore = null;
      }
    };
    const onUp = () => {
      if (!from) return;
      from = null;
      if (moved) updateDrawing(drawing.id, { center: moved });
      moved = null;
      setPreview(null);
      setActive(null);
    };

    m.on("mousedown", onDown);
    m.on("touchstart", onDown);
    m.on("mousemove", onMove);
    m.on("touchmove", onMove);
    m.on("touchend", onUp);
    // Released anywhere, even over the sidebar
    window.addEventListener("mouseup", onUp);
    return () => {
      m.off("mousedown", onDown);
      m.off("touchstart", onDown);
      m.off("mousemove", onMove);
      m.off("touchmove", onMove);
      m.off("touchend", onUp);
      window.removeEventListener("mouseup", onUp);
      if (cursorBefore !== null) canvas.style.cursor = cursorBefore;
    };
  }, [map, selected, drawing, updateDrawing]);

  const committedCoordinates = useMemo(
    () => drawingImageCoordinates(drawing),
    [drawing],
  );

  const corners = useMemo(() => drawingCorners(shown), [shown]);
  // The outline, plus a stem from the top edge out to the rotate handle
  const outline = useMemo(() => {
    const [tl, tr] = corners;
    const topMiddle: [number, number] = [
      (tl[1] + tr[1]) / 2,
      (tl[0] + tr[0]) / 2,
    ];
    const handle = drawingRotateHandle(shown);
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "MultiLineString" as const,
        coordinates: [
          [...corners, corners[0]].map(([lat, lng]) => [lng, lat]),
          [topMiddle, [handle[1], handle[0]]],
        ],
      },
    };
  }, [corners, shown]);

  const start = (handle: Handle) => setActive(handle);
  const drag = (handle: Handle, lat: number, lng: number) => {
    setPointer([lat, lng]);
    const base: Placement = {
      center: drawing.center,
      widthM: drawing.widthM,
      rotationDeg: drawing.rotationDeg,
    };
    const point: [number, number] = [lat, lng];
    if (handle === "move") {
      setPreview({ ...base, center: point });
    } else if (handle === "rotate") {
      setPreview({ ...base, rotationDeg: rotationTowards(drawing, point) });
    } else {
      setPreview({ ...base, widthM: widthFromCorner(drawing, point) });
    }
  };
  const end = () => {
    if (preview) {
      updateDrawing(drawing.id, {
        center: preview.center,
        widthM: Math.round(preview.widthM * 10) / 10,
        rotationDeg: preview.rotationDeg,
      });
    }
    setPreview(null);
    setActive(null);
    setPointer(null);
  };

  /** The handle being dragged follows the pointer; the rest follow the shape. */
  const at = (handle: Handle, pos: [number, number]) =>
    active === handle && pointer ? pointer : pos;

  return (
    <>
      <Source
        id={sourceId}
        type="image"
        url={drawing.image}
        coordinates={committedCoordinates}
      >
        <Layer
          id={`${sourceId}-raster`}
          type="raster"
          beforeId={DRAWINGS_ANCHOR_ID}
          paint={{
            "raster-opacity": drawing.opacity,
            // The paper is already transparent, so lifting every pixel's
            // brightness to full turns only the lines white.
            "raster-brightness-min": lightLines ? 1 : 0,
            "raster-fade-duration": 0,
            "raster-resampling": "linear",
          }}
        />
      </Source>

      {selected && (
        <>
          <Source id={`${sourceId}-outline`} type="geojson" data={outline}>
            <Layer
              id={`${sourceId}-outline-line`}
              type="line"
              paint={{
                "line-color": "#0ea5e9",
                "line-width": 2,
                "line-dasharray": [2, 1.5],
              }}
            />
          </Source>

          <Marker
            longitude={at("move", shown.center)[1]}
            latitude={at("move", shown.center)[0]}
            anchor="center"
            draggable
            onDragStart={() => start("move")}
            onDrag={(e) => drag("move", e.lngLat.lat, e.lngLat.lng)}
            onDragEnd={end}
          >
            <div
              title="Drag to move the drawing"
              style={{ ...HANDLE_STYLE, width: 18, height: 18, cursor: "move" }}
              className="flex items-center justify-center text-[11px] leading-none text-sky-600"
            >
              ✥
            </div>
          </Marker>

          {corners.map((pos, i) => {
            const handle = i as 0 | 1 | 2 | 3;
            const p = at(handle, pos);
            return (
              <Marker
                key={`corner-${i}`}
                longitude={p[1]}
                latitude={p[0]}
                anchor="center"
                draggable
                onDragStart={() => start(handle)}
                onDrag={(e) => drag(handle, e.lngLat.lat, e.lngLat.lng)}
                onDragEnd={end}
              >
                <div
                  title="Drag to resize the drawing"
                  style={{
                    ...HANDLE_STYLE,
                    cursor: i % 2 === 0 ? "nwse-resize" : "nesw-resize",
                  }}
                />
              </Marker>
            );
          })}

          {(() => {
            const p = at("rotate", drawingRotateHandle(shown));
            return (
              <Marker
                longitude={p[1]}
                latitude={p[0]}
                anchor="center"
                draggable
                onDragStart={() => start("rotate")}
                onDrag={(e) => drag("rotate", e.lngLat.lat, e.lngLat.lng)}
                onDragEnd={end}
              >
                <div
                  title={`Drag to rotate the drawing (${Math.round(shown.rotationDeg)}°)`}
                  style={{
                    ...HANDLE_STYLE,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    cursor: "grab",
                  }}
                  className="relative flex items-center justify-center text-sky-600"
                >
                  <RotateCw className="h-3 w-3" strokeWidth={3} />
                  {/* The angle, read live while spinning */}
                  <span className="pointer-events-none absolute left-full ml-1.5 whitespace-nowrap rounded bg-black/75 px-1 text-[10px] font-medium text-white">
                    {shown.rotationDeg.toFixed(1)}°
                  </span>
                </div>
              </Marker>
            );
          })()}
        </>
      )}
    </>
  );
}
