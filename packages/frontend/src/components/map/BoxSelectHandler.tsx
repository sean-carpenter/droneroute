import { useEffect, useState } from "react";
import { useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const MIN_DRAG_PX = 4;

/**
 * Shift+drag on the map draws a rectangle and selects the waypoints inside.
 * Holding Ctrl/Cmd as well adds them to the current selection.
 */
export function BoxSelectHandler() {
  const { current: map } = useMap();
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!map) return;
    let start: { x: number; y: number } | null = null;

    const onMouseDown = (e: any) => {
      const { templateMode, isDrawingObstacle } = useMissionStore.getState();
      if (!e.originalEvent?.shiftKey || templateMode || isDrawingObstacle) {
        return;
      }
      // Only start on the bare map, not on a marker (Shift+click range select)
      const target = e.originalEvent.target as HTMLElement | null;
      if (!target?.classList?.contains("mapboxgl-canvas")) return;

      e.preventDefault();
      map.getMap().dragPan.disable();
      start = { x: e.point.x, y: e.point.y };
    };

    const onMouseMove = (e: any) => {
      if (!start) return;
      setBox({ x1: start.x, y1: start.y, x2: e.point.x, y2: e.point.y });
    };

    const onMouseUp = (e: any) => {
      if (!start) return;
      map.getMap().dragPan.enable();
      const minX = Math.min(start.x, e.point.x);
      const maxX = Math.max(start.x, e.point.x);
      const minY = Math.min(start.y, e.point.y);
      const maxY = Math.max(start.y, e.point.y);
      start = null;
      setBox(null);
      if (maxX - minX < MIN_DRAG_PX && maxY - minY < MIN_DRAG_PX) return;

      const { waypoints, setWaypointSelection } = useMissionStore.getState();
      const inside = waypoints
        .filter((wp) => {
          const p = map.project([wp.longitude, wp.latitude]);
          return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
        })
        .map((wp) => wp.index);
      const additive = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
      setWaypointSelection(inside, additive);
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
  }, [map]);

  if (!box) return null;

  return (
    <div
      className="absolute z-20 border border-blue-400 bg-blue-400/15 pointer-events-none"
      style={{
        left: Math.min(box.x1, box.x2),
        top: Math.min(box.y1, box.y2),
        width: Math.abs(box.x2 - box.x1),
        height: Math.abs(box.y2 - box.y1),
      }}
    />
  );
}
