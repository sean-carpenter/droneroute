import { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Download,
  Upload,
  Save,
  Settings,
  MapPin,
  ChevronDown,
  ChevronRight,
  Crosshair,
  FolderOpen,
  Route,
  Clock,
  User,
  LogOut,
  Camera,
  Video,
  TrendingUp,
  UserCog,
  CircleHelp,
  Triangle,
  Shield,
  BatteryWarning,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapView } from "@/components/map/MapView";
import { WaypointList } from "@/components/waypoint/WaypointList";
import { BulkActionToolbar } from "@/components/waypoint/BulkActionToolbar";
import { MissionConfig } from "@/components/mission/MissionConfig";
import { PoiList } from "@/components/mission/PoiList";
import { ObstacleList } from "@/components/mission/ObstacleList";
import { RoutesPage } from "@/components/routes/RoutesPage";
import { SharedMissionPage } from "@/components/routes/SharedMissionPage";
import { AdminPage } from "@/pages/AdminPage";
import { ElevationGraph } from "@/components/mission/ElevationGraph";
import { WarningsPanel } from "@/components/mission/WarningsPanel";
import type { Warning } from "@/components/mission/WarningsPanel";
import { AuthModal } from "@/components/auth/AuthModal";
import { AccountModal } from "@/components/auth/AccountModal";
import { AboutDialog } from "@/components/AboutDialog";
import { WelcomeDialog } from "@/components/WelcomeDialog";
import { useMissionStore } from "@/store/missionStore";
import { useAuthStore } from "@/store/authStore";
import { useConfigStore } from "@/store/configStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { formatDistance } from "@/lib/units";
import { useAirspaceStore } from "@/store/airspaceStore";
import { api } from "@/lib/api";
import { getObstacleWarnings, getAirspaceWarnings } from "@/lib/geo";
import { estimateMission, formatDuration } from "@/lib/missionStats";
import { useWindStore } from "@/store/windStore";
import { useSimulationStore } from "@/store/simulationStore";
import { windAdvisory } from "@/lib/wind";
import {
  ImportPreviewDialog,
  type ImportResult,
} from "@/components/mission/ImportPreviewDialog";

const IMPORT_ACCEPT = ".kmz,.kml,.gpx,.csv";

type SidebarSection = "waypoints" | "pois" | "obstacles" | "config";

export default function App() {
  const {
    missionName,
    setMissionName,
    missionId,
    setMissionId,
    config,
    waypoints,
    pois,
    obstacles,
    loadMission,
    currentPage,
    setCurrentPage,
    shareToken,
    setShareToken,
    dirty,
    setDirty,
  } = useMissionStore();

  const [expandedSections, setExpandedSections] = useState<
    Record<SidebarSection, boolean>
  >({
    waypoints: true,
    pois: false,
    obstacles: false,
    config: false,
  });

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    result: ImportResult;
  } | null>(null);

  const { token, email: userEmail, logout, restore, isAdmin } = useAuthStore();
  const { selfHosted, singleUser } = useConfigStore();
  const [gravatarUrl, setGravatarUrl] = useState<string | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // Restore auth session on mount. A single-user instance has no sign-in:
  // it opens (or renews) the local workspace session instead.
  useEffect(() => {
    restore();
    if (singleUser) {
      useAuthStore
        .getState()
        .localLogin()
        .catch(() => toast.error("Could not open the local workspace"));
    }
  }, [singleUser]);

  // Fetch user preferences after auth is restored
  const { fetchPreferences, preferences } = usePreferencesStore();
  const unitSystem = preferences.unitSystem;
  useEffect(() => {
    if (token) {
      fetchPreferences();
    }
  }, [token]);

  // Detect /shared/:token or /admin URL on mount
  useEffect(() => {
    const match = window.location.pathname.match(/^\/shared\/([^/]+)$/);
    if (match) {
      setShareToken(match[1]);
      setCurrentPage("shared");
    } else if (window.location.pathname === "/admin") {
      const token = localStorage.getItem("droneroute_token");
      const adminFlag = localStorage.getItem("droneroute_is_admin") === "true";
      if (token && adminFlag) {
        setCurrentPage("admin");
      } else {
        window.history.replaceState({}, "", "/");
      }
    }
  }, []);

  // Warn before closing/navigating away with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (
        dirty &&
        (waypoints.length > 1 || pois.length > 0 || obstacles.length > 0)
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, waypoints.length, pois.length, obstacles.length]);

  // Obstacle warnings
  const obstacleWarnings = useMemo(
    () => getObstacleWarnings(waypoints, obstacles),
    [waypoints, obstacles],
  );

  // Airspace warnings
  const airspaceZones = useAirspaceStore((s) => s.zones);
  const airspaceEnabled = useAirspaceStore((s) => s.enabled);
  const airspaceWarnings = useMemo(
    () =>
      airspaceEnabled ? getAirspaceWarnings(waypoints, airspaceZones) : [],
    [waypoints, airspaceZones, airspaceEnabled],
  );

  // Flight estimates: distance, time, photos and batteries
  const flightStats = useMemo(
    () => (waypoints.length >= 2 ? estimateMission(waypoints, config) : null),
    [waypoints, config],
  );

  // Wind advisory (only when the user turned the wind overlay on)
  const windReading = useWindStore((s) => (s.enabled ? s.reading : null));

  // Aggregated warnings for overlay
  const warnings = useMemo(() => {
    const result: Warning[] = [];
    if (obstacles.length > 0 && obstacleWarnings.length > 0) {
      result.push({
        id: "obstacle",
        type: "obstacle",
        message: `${obstacleWarnings.length} obstacle warning${obstacleWarnings.length > 1 ? "s" : ""} — waypoints conflict with restricted zones`,
      });
    }
    if (flightStats && flightStats.batteriesNeeded > 1) {
      const swaps = flightStats.batterySwapAfter
        .slice(0, 4)
        .map((pos) => `WP ${pos + 1}`)
        .join(", ");
      const more = flightStats.batterySwapAfter.length > 4 ? "…" : "";
      result.push({
        id: "battery",
        type: "battery",
        message: `Flight time (${formatDuration(flightStats.estimatedFlightTimeS)}) needs ${flightStats.batteriesNeeded} batteries at ${config.maxBatteryMinutes} min each — plan a swap after ${swaps}${more}`,
      });
    }
    if (windReading) {
      const advisory = windAdvisory(windReading);
      if (advisory.severity !== "ok") {
        result.push({
          id: `wind-${advisory.severity}`,
          type: "wind",
          critical: advisory.severity === "danger",
          message: advisory.message,
        });
      }
    }
    // Airspace zone warnings
    const prohibitedCount = airspaceWarnings.filter(
      (w) => w.severity === "prohibited",
    ).length;
    const restrictedCount = airspaceWarnings.filter(
      (w) => w.severity === "restricted",
    ).length;
    if (prohibitedCount > 0) {
      result.push({
        id: "airspace-prohibited",
        type: "airspace",
        message: `Flight path enters ${prohibitedCount} prohibited airspace zone${prohibitedCount > 1 ? "s" : ""} — flight is not allowed`,
      });
    }
    if (restrictedCount > 0) {
      result.push({
        id: "airspace-restricted",
        type: "airspace",
        message: `Flight path enters ${restrictedCount} restricted airspace zone${restrictedCount > 1 ? "s" : ""} — authorization may be required`,
      });
    }
    return result;
  }, [
    obstacleWarnings,
    obstacles.length,
    flightStats,
    config.maxBatteryMinutes,
    airspaceWarnings,
    windReading,
  ]);

  // Compute Gravatar URL when email changes
  useEffect(() => {
    if (!userEmail || singleUser) {
      setGravatarUrl(null);
      return;
    }
    const trimmed = userEmail.trim().toLowerCase();
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(trimmed))
      .then((buf) => {
        const hex = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        setGravatarUrl(`https://www.gravatar.com/avatar/${hex}?s=64&d=mp`);
      });
  }, [userEmail, singleUser]);

  const toggleSection = (section: SidebarSection) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleExport = async () => {
    if (waypoints.length < 2) {
      toast.warning("Need at least 2 waypoints to export");
      return;
    }

    setExporting(true);
    try {
      const blob = await api.post<Blob>("/kmz/generate", {
        name: missionName,
        config,
        waypoints,
        pois,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${missionName.replace(/[^a-zA-Z0-9_-]/g, "_")}.kmz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleSave = async () => {
    if (!token) {
      if (!singleUser) {
        setShowAuthModal(true);
        return;
      }
      // No sign-in on a single-user instance: open the local session first
      try {
        await useAuthStore.getState().localLogin();
      } catch {
        toast.error("Could not open the local workspace");
        return;
      }
    }
    if (!missionName.trim()) {
      toast.warning("Please enter a mission name before saving");
      return;
    }
    setSaving(true);
    try {
      if (missionId) {
        await api.put(`/missions/${missionId}`, {
          name: missionName,
          config,
          waypoints,
          pois,
          obstacles,
        });
      } else {
        const result = await api.post<{ id: string }>("/missions", {
          name: missionName,
          config,
          waypoints,
          pois,
          obstacles,
        });
        setMissionId(result.id);
      }
      setDirty(false);
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Read a mission file on the server and show what it contains before
  // anything in the editor changes.
  const importFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const result = await api.post<ImportResult>("/kmz/import", formData);
      setPendingImport({ fileName: file.name, result });
    } catch (err: any) {
      toast.error(`Import failed: ${err.message}`);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await importFile(file);
    // Reset file input so the same file can be picked again
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const applyImport = (mode: "replace" | "append") => {
    if (!pendingImport) return;
    const { fileName, result } = pendingImport;
    if (mode === "replace") {
      loadMission({
        name: fileName.replace(/\.(kmz|kml|gpx|csv)$/i, ""),
        config: result.config ?? config,
        waypoints: result.waypoints,
        pois: result.pois,
      });
    } else {
      useMissionStore.getState().appendImported(result.waypoints, result.pois);
    }
    setPendingImport(null);
  };

  // Drop a mission file anywhere on the editor to import it
  const importFileRef = useRef(importFile);
  importFileRef.current = importFile;
  useEffect(() => {
    if (currentPage !== "editor") return;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!/\.(kmz|kml|gpx|csv)$/i.test(file.name)) {
        toast.warning("Drop a KMZ, KML, GPX or Litchi CSV file to import");
        return;
      }
      void importFileRef.current(file);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [currentPage]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/selects (except Escape which should always work)
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        e.key !== "Escape" &&
        (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
      )
        return;

      const {
        setIsAddingWaypoint,
        setIsAddingPoi,
        setIsDrawingObstacle,
        setTemplateMode,
        clearWaypointSelection,
        removeSelectedWaypoints,
        selectAllWaypoints,
        selectedWaypointIndices,
        templateMode,
      } = useMissionStore.getState();

      switch (e.key.toLowerCase()) {
        case "w":
          e.preventDefault();
          setIsAddingWaypoint(true);
          break;
        case "p":
          if (e.metaKey || e.ctrlKey) return; // don't intercept Cmd+P
          e.preventDefault();
          setIsAddingPoi(true);
          break;
        case "o":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setTemplateMode(templateMode === "orbit" ? null : "orbit");
          break;
        case "g":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setTemplateMode(templateMode === "grid" ? null : "grid");
          break;
        case "f":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setTemplateMode(templateMode === "facade" ? null : "facade");
          break;
        case "z":
          e.preventDefault();
          if (e.metaKey || e.ctrlKey) {
            if (e.shiftKey) useMissionStore.getState().redo();
            else useMissionStore.getState().undo();
          } else {
            setTemplateMode(templateMode === "pencil" ? null : "pencil");
          }
          break;
        case "y":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            useMissionStore.getState().redo();
          }
          break;
        case "t":
          if (e.metaKey || e.ctrlKey) return; // don't intercept new tab
          e.preventDefault();
          setTemplateMode(templateMode === "tower" ? null : "tower");
          break;
        case "c":
          if (e.metaKey || e.ctrlKey) return; // don't intercept copy
          e.preventDefault();
          setTemplateMode(templateMode === "corridor" ? null : "corridor");
          break;
        case "b":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          setIsDrawingObstacle(!useMissionStore.getState().isDrawingObstacle);
          break;
        case "a":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            selectAllWaypoints();
          } else {
            e.preventDefault();
            const as = useAirspaceStore.getState();
            as.setEnabled(!as.enabled);
          }
          break;
        case "escape":
          e.preventDefault();
          clearWaypointSelection();
          setIsAddingWaypoint(false);
          setIsAddingPoi(false);
          setIsDrawingObstacle(false);
          setTemplateMode(null);
          useSimulationStore.getState().close();
          break;
        case "delete":
        case "backspace":
          if (selectedWaypointIndices.size > 0) {
            e.preventDefault();
            if (selectedWaypointIndices.size > 1) {
              if (
                confirm(`Delete ${selectedWaypointIndices.size} waypoints?`)
              ) {
                removeSelectedWaypoints();
              }
            } else {
              removeSelectedWaypoints();
            }
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Show admin page
  if (currentPage === "admin") {
    return <AdminPage />;
  }

  // Show routes page
  if (currentPage === "routes") {
    return (
      <>
        <RoutesPage onRequestAuth={() => setShowAuthModal(true)} />
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      </>
    );
  }

  // Show shared mission page
  if (currentPage === "shared" && shareToken) {
    return (
      <>
        <SharedMissionPage
          shareToken={shareToken}
          onRequestAuth={() => setShowAuthModal(true)}
        />
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      </>
    );
  }

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <div className="w-88 flex flex-col border-r border-border bg-card shrink-0 tabular-nums">
        {/* Header */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <img src="/droneroute.png" alt="DroneRoute" className="h-5 w-5" />
              <span className="font-bold text-sm">DroneRoute</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAbout(true)}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Help & shortcuts"
              >
                <CircleHelp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCurrentPage("routes")}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="My routes"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
              {!selfHosted && isAdmin && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    window.history.pushState({}, "", "/admin");
                    setCurrentPage("admin");
                  }}
                  className="h-7 w-7 text-purple-400 hover:text-purple-300"
                  title="User management"
                >
                  <Shield className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <Input
            value={missionName}
            onChange={(e) => setMissionName(e.target.value)}
            className="h-8 text-xs font-medium border-blue-500/30 bg-blue-500/5 focus-visible:ring-blue-500/40"
            placeholder="Mission name"
            title="Name your mission for easy identification"
          />
        </div>

        {/* Toolbar */}
        <div className="flex gap-1 p-2 border-b border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 text-xs h-7 border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/15 hover:text-blue-300"
            title="Save mission to your account"
          >
            <Save className="h-3 w-3" />
            {saving ? "..." : "Save"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || waypoints.length < 2}
            className="flex-1 text-xs h-7 border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/15 hover:text-blue-300"
            title={
              waypoints.length < 2
                ? "Add at least 2 waypoints to export"
                : "Export mission as DJI KMZ file"
            }
          >
            <Download className="h-3 w-3" />
            {exporting ? "..." : "Export KMZ"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 text-xs h-7 border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/15 hover:text-blue-300"
            title="Import a DJI KMZ, KML, GPX or Litchi CSV file (or drop one on the page)"
          >
            <Upload className="h-3 w-3" />
            Import
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={IMPORT_ACCEPT}
            className="hidden"
            onChange={handleImport}
          />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Waypoints section — BLUE accent */}
          <div className="border-l-2 border-blue-500/70 bg-blue-500/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-blue-500/10 hover:bg-blue-500/15 text-blue-400"
              onClick={() => toggleSection("waypoints")}
              title="Flight path coordinates — click on the map to add"
            >
              {expandedSections.waypoints ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <MapPin className="h-3 w-3" />
              Waypoints ({waypoints.length})
            </button>
            {expandedSections.waypoints && (
              <div className="max-h-[40vh] overflow-y-auto section-expand">
                <WaypointList />
              </div>
            )}
          </div>

          {/* POIs section — AMBER/ORANGE accent */}
          <div className="border-l-2 border-amber-500/70 bg-amber-500/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-amber-500/10 hover:bg-amber-500/15 text-amber-400"
              onClick={() => toggleSection("pois")}
              title="Targets the drone can point its camera at"
            >
              {expandedSections.pois ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Crosshair className="h-3 w-3" />
              Points of interest ({pois.length})
            </button>
            {expandedSections.pois && (
              <div className="max-h-[30vh] overflow-y-auto section-expand">
                <PoiList />
              </div>
            )}
          </div>

          {/* Obstacles section — RED accent */}
          <div className="border-l-2 border-red-500/70 bg-red-500/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-red-500/10 hover:bg-red-500/15 text-red-400"
              onClick={() => toggleSection("obstacles")}
              title="No-fly zones to avoid during the mission"
            >
              {expandedSections.obstacles ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Triangle className="h-3 w-3" />
              Obstacles ({obstacles.length})
            </button>
            {expandedSections.obstacles && (
              <div className="max-h-[30vh] overflow-y-auto section-expand">
                <ObstacleList />
              </div>
            )}
          </div>

          {/* Mission Settings section — PURPLE accent */}
          <div className="border-l-2 border-purple-500/70 bg-purple-500/[0.03]">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-purple-500/10 hover:bg-purple-500/15 text-purple-400"
              onClick={() => toggleSection("config")}
              title="Drone model, speed, altitude and flight behavior"
            >
              {expandedSections.config ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Settings className="h-3 w-3" />
              Mission settings
            </button>
            {expandedSections.config && (
              <div className="max-h-[40vh] overflow-y-auto section-expand">
                <MissionConfig />
              </div>
            )}
          </div>
        </div>

        {/* Elevation graph */}
        <ElevationGraph />

        {/* Footer stats with colored icons */}
        <div className="px-3 py-2 border-t border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            {(() => {
              const photoCount = flightStats?.photoCount ?? 0;
              const videoCount = flightStats?.videoCount ?? 0;
              return (
                <>
                  {photoCount > 0 && (
                    <span
                      className="flex items-center gap-1 text-[11px]"
                      title="Estimated photos (actions and interval capture)"
                    >
                      <Camera className="h-3 w-3 text-sky-400" />
                      <span className="text-sky-300 font-medium">
                        {photoCount}
                      </span>
                    </span>
                  )}
                  {videoCount > 0 && (
                    <span
                      className="flex items-center gap-1 text-[11px]"
                      title="Video actions"
                    >
                      <Video className="h-3 w-3 text-red-400" />
                      <span className="text-red-300 font-medium">
                        {videoCount}
                      </span>
                    </span>
                  )}
                  {flightStats && flightStats.batteriesNeeded > 1 && (
                    <span
                      className="flex items-center gap-1 text-[11px]"
                      title={`Needs ${flightStats.batteriesNeeded} batteries at ${config.maxBatteryMinutes} min each`}
                    >
                      <BatteryWarning className="h-3 w-3 text-orange-400" />
                      <span className="text-orange-300 font-medium">
                        ×{flightStats.batteriesNeeded}
                      </span>
                    </span>
                  )}
                </>
              );
            })()}
          </div>
          <div className="flex items-center gap-3">
            {waypoints.length >= 2 && flightStats
              ? (() => {
                  const distance = flightStats.totalDistanceM;
                  const time = flightStats.estimatedFlightTimeS;
                  const elevGain = Math.round(flightStats.elevationGainM);
                  const exceedsBattery = flightStats.batteriesNeeded > 1;
                  return (
                    <>
                      {elevGain > 0 && (
                        <span
                          className="flex items-center gap-1 text-[11px]"
                          title="Elevation gain"
                        >
                          <TrendingUp className="h-3 w-3 text-orange-400" />
                          <span className="text-orange-300 font-medium">
                            {elevGain}m
                          </span>
                        </span>
                      )}
                      <span
                        className="flex items-center gap-1 text-[11px]"
                        title="Total distance"
                      >
                        <Route className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-300 font-medium">
                          {formatDistance(distance, unitSystem)}
                        </span>
                      </span>
                      <span
                        className="flex items-center gap-1 text-[11px]"
                        title={
                          exceedsBattery
                            ? `Exceeds one battery (${config.maxBatteryMinutes} min)`
                            : `Estimated flight time — about ${Math.round(flightStats.estimatedBatteryPercent)}% of one battery, excluding take-off and return`
                        }
                      >
                        <Clock
                          className={`h-3 w-3 ${exceedsBattery ? "text-orange-400" : "text-yellow-400"}`}
                        />
                        <span
                          className={`font-medium ${exceedsBattery ? "text-orange-300" : "text-yellow-300"}`}
                        >
                          {formatDuration(time)}
                        </span>
                      </span>
                    </>
                  );
                })()
              : null}
          </div>
        </div>

        {/* Auth row */}
        <div className="px-3 py-2 border-t border-border">
          {token ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {gravatarUrl ? (
                  <img
                    src={gravatarUrl}
                    alt=""
                    className="h-6 w-6 rounded-full shrink-0"
                  />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <User className="h-3 w-3 text-muted-foreground" />
                  </div>
                )}
                <span
                  className="text-[11px] text-muted-foreground truncate"
                  title={
                    singleUser
                      ? "Missions and settings are saved on this machine. No sign-in needed."
                      : userEmail || ""
                  }
                >
                  {singleUser ? "Local workspace" : userEmail}
                </span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAccountMenu(true)}
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  title="Account settings"
                >
                  <UserCog className="h-3.5 w-3.5" />
                </Button>
                {!singleUser && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={logout}
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    title="Sign out"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ) : singleUser ? (
            <div className="h-7 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="h-3 w-3 text-muted-foreground" />
              </div>
              Opening local workspace…
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAuthModal(true)}
              className="w-full h-7 text-[11px] text-muted-foreground hover:text-foreground gap-1.5 justify-start px-1"
            >
              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="h-3 w-3 text-muted-foreground" />
              </div>
              Guest mode. Sign in to save missions
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 relative">
        <MapView />
        <BulkActionToolbar />
        <WarningsPanel warnings={warnings} />
      </div>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showAccountMenu && (
        <AccountModal onClose={() => setShowAccountMenu(false)} />
      )}
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {pendingImport && (
        <ImportPreviewDialog
          fileName={pendingImport.fileName}
          result={pendingImport.result}
          canAppend={waypoints.length > 0}
          onReplace={() => applyImport("replace")}
          onAppend={() => applyImport("append")}
          onCancel={() => setPendingImport(null)}
        />
      )}
      <WelcomeDialog />
    </div>
  );
}
