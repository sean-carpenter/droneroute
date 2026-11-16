import { useState, useRef, useEffect } from "react";
import {
  MapPin,
  X,
  GripVertical,
  Settings,
  ArrowUp,
  Gauge,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Plus,
  Trash2,
} from "lucide-react";
import type { Waypoint } from "@droneroute/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMissionStore } from "@/store/missionStore";
import type { SelectionMode } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { formatHeight, formatSpeed } from "@/lib/units";
import { WaypointEditorInline } from "./WaypointEditor";

export function WaypointList() {
  const {
    waypoints,
    selectedWaypointIndices,
    selectWaypoint,
    removeWaypoint,
    reorderWaypoints,
    updateWaypoint,
    routes,
    activeRouteId,
    addRoute,
    renameRoute,
    removeRoute,
    moveRoute,
    selectRoute,
  } = useMissionStore();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingRoute, setRenamingRoute] = useState<string | null>(null);
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  const [expandedEditor, setExpandedEditor] = useState<number | null>(null);
  const [editingName, setEditingName] = useState<number | null>(null);

  // When exactly one waypoint is selected (e.g. by clicking on the map), expand its editor
  useEffect(() => {
    if (selectedWaypointIndices.size === 1) {
      const [index] = selectedWaypointIndices;
      setExpandedEditor(index);
    }
  }, [selectedWaypointIndices]);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragItemRef = useRef<number | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  if (waypoints.length === 0 && routes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <MapPin className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No waypoints yet</p>
        <p className="text-xs mt-1">Click on the map to add waypoints</p>
      </div>
    );
  }

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragItemRef.current = index;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = dragItemRef.current;
    if (fromIndex !== null && fromIndex !== toIndex) {
      reorderWaypoints(fromIndex, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
    dragItemRef.current = null;
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
    dragItemRef.current = null;
  };

  const toggleEditor = (wpIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedEditor((prev) => (prev === wpIndex ? null : wpIndex));
  };

  const startRename = (wpIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingName(wpIndex);
    // Focus the input after render
    setTimeout(() => nameInputRef.current?.select(), 0);
  };

  const commitRename = (wpIndex: number, value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      updateWaypoint(wpIndex, { name: trimmed });
    }
    setEditingName(null);
  };

  const handleClick = (e: React.MouseEvent, wpIndex: number) => {
    let mode: SelectionMode = "replace";
    if (e.ctrlKey || e.metaKey) {
      mode = "toggle";
    } else if (e.shiftKey) {
      mode = "range";
    }
    selectWaypoint(wpIndex, mode);
  };

  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRow = (wp: Waypoint, i: number) => {
    const isSelected = selectedWaypointIndices.has(wp.index);
    const isDragging = dragIndex === i;
    const isDragOver = dragOverIndex === i;
    const isEditorOpen =
      expandedEditor === wp.index && selectedWaypointIndices.size <= 1;
    const isRenaming = editingName === wp.index;

    return (
      <div key={wp.index}>
        <div
          className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
            isDragging
              ? "opacity-40"
              : isDragOver
                ? "border-t-2 border-primary"
                : isSelected
                  ? "bg-primary/20 border border-primary/40"
                  : "hover:bg-secondary border border-transparent"
          }`}
          onClick={(e) => handleClick(e, wp.index)}
          draggable
          onDragStart={(e) => handleDragStart(e, i)}
          onDragOver={(e) => handleDragOver(e, i)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={handleDragEnd}
        >
          <span title="Drag to reorder">
            <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
          </span>
          <Badge
            variant={isSelected ? "default" : "secondary"}
            className="text-[10px] px-1.5 py-0"
          >
            {wp.index + 1}
          </Badge>
          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <input
                ref={nameInputRef}
                className="text-xs font-medium bg-transparent border-b border-primary outline-none w-full py-0"
                defaultValue={wp.name}
                autoFocus
                onBlur={(e) => commitRename(wp.index, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    commitRename(wp.index, e.currentTarget.value);
                  if (e.key === "Escape") setEditingName(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div
                className="text-xs font-medium truncate cursor-text hover:text-primary transition-colors"
                onDoubleClick={(e) => startRename(wp.index, e)}
                title="Double-click to rename"
              >
                {wp.name || `Waypoint ${wp.index + 1}`}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground flex items-center gap-2">
              <span className="flex items-center gap-0.5">
                <ArrowUp className="h-2.5 w-2.5" />
                {formatHeight(wp.height, unitSystem)}
              </span>
              <span className="flex items-center gap-0.5">
                <Gauge className="h-2.5 w-2.5" />
                {formatSpeed(wp.speed, unitSystem)}
              </span>
            </div>
          </div>
          {wp.actions.length > 0 && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {wp.actions.length}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={`h-5 w-5 shrink-0 ${
              isEditorOpen
                ? "text-primary hover:text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={(e) => toggleEditor(wp.index, e)}
            title="Edit waypoint settings"
          >
            <Settings className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              removeWaypoint(wp.index);
            }}
            title="Remove waypoint"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        {isEditorOpen && (
          <div className="ml-4 mr-1 mt-1 mb-2 border-l-2 border-blue-400/30 bg-blue-500/5 rounded-r-md">
            <WaypointEditorInline waypointIndex={wp.index} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      {routes.map((route, r) => {
        const members = waypoints.filter((wp) => wp.routeId === route.id);
        const isCollapsed = collapsed.has(route.id);
        const isActive = route.id === activeRouteId;
        return (
          <div
            key={route.id}
            className={`rounded-md border ${
              isActive ? "border-blue-400/40" : "border-border/40"
            }`}
          >
            <div
              className={`flex items-center gap-1 rounded-t-md px-1.5 py-1 ${
                isActive ? "bg-blue-500/10" : "bg-secondary/40"
              }`}
            >
              <button
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => toggleCollapsed(route.id)}
                title={isCollapsed ? "Show waypoints" : "Hide waypoints"}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                {renamingRoute === route.id ? (
                  <input
                    className="w-full border-b border-primary bg-transparent text-xs font-semibold outline-none"
                    defaultValue={route.name}
                    autoFocus
                    onBlur={(e) => {
                      if (e.target.value.trim())
                        renameRoute(route.id, e.target.value.trim());
                      setRenamingRoute(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenamingRoute(null);
                    }}
                  />
                ) : (
                  <button
                    className="block w-full truncate text-left text-xs font-semibold hover:text-primary"
                    onClick={() => selectRoute(route.id)}
                    onDoubleClick={() => setRenamingRoute(route.id)}
                    title="Click to select its waypoints and add new ones here; double-click to rename"
                  >
                    {route.name}
                  </button>
                )}
                <div className="text-[10px] text-muted-foreground">
                  {members.length} WP
                  {members.length === 1 && ` · #${members[0].index + 1}`}
                  {members.length > 1 &&
                    ` · #${members[0].index + 1}–${members[members.length - 1].index + 1}`}
                  {isActive && (
                    <span className="ml-1 text-blue-300">· adding here</span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground"
                disabled={r === 0}
                onClick={() => moveRoute(route.id, -1)}
                title="Fly this route earlier"
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground"
                disabled={r === routes.length - 1}
                onClick={() => moveRoute(route.id, 1)}
                title="Fly this route later"
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (
                    members.length === 0 ||
                    confirm(
                      `Delete "${route.name}" and its ${members.length} waypoints?`,
                    )
                  ) {
                    removeRoute(route.id);
                  }
                }}
                title="Delete the route and its waypoints"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {!isCollapsed && (
              <div className="flex flex-col gap-1 p-1">
                {members.map((wp) => renderRow(wp, wp.index))}
                {members.length === 0 && (
                  <p className="px-2 py-1.5 text-[10px] text-muted-foreground">
                    {isActive
                      ? "Click the map to add waypoints to this route."
                      : "Empty. Click its name to add waypoints here."}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 justify-start gap-1.5 text-xs text-muted-foreground"
        onClick={addRoute}
        title="Start an empty route; waypoints you place on the map go into it"
      >
        <Plus className="h-3 w-3" />
        New route
      </Button>
    </div>
  );
}
