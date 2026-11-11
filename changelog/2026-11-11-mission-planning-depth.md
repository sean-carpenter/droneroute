## Summary

Deeper mission planning: camera-aware photogrammetry surveys, corridor
missions, multi-battery flight estimates, a wind advisory, import from more
formats, undo/redo with better bulk editing, and a flight preview.

## Changes

- Grid survey gains a photogrammetry mode: side/forward overlap, presets, a GSD
  calculator and live read-outs (footprint, spacing, photos, distance, time,
  batteries) based on the Mavic 3E wide camera
- New corridor survey template for linear features (shortcut `C`)
- Distance-interval photo capture between waypoints, exported as a WPML
  `multipleDistance` trigger and read back on import
- Flight estimates now include climbs, stops and hover time, count interval
  photos, and report how many batteries a mission needs and where to swap
- Flight time uses each leg's departing waypoint speed, matching how WPML
  defines `waypointSpeed`
- Optional wind advisory from Open-Meteo (off by default; sends a position
  rounded to ~1 km)
- Import KML, Google Earth KMZ, GPX and Litchi CSV in addition to DJI KMZ, with
  an import preview, warnings, drag-and-drop and an "add to mission" option
- DJI KMZ import keeps action parameters (hover time, gimbal angles, …), reads
  interval capture, tolerates mapping templates and out-of-order indices, and
  reports unsupported actions instead of importing them blank
- Undo/redo for all mission edits (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z), up to 50 steps
- Box-select waypoints with Shift+drag; bulk editor adds relative altitude,
  photo interval and add/remove photo actions
- Flight preview: animated drone with camera view, speed control, scrubbing and
  live read-outs
- Shared camera aim for templates: fixed pitch, toward POI, height on the
  structure, or relative to the surface, computed per waypoint; available on
  orbit, facade, pencil, corridor and the new tower template
- New tower inspection template (helix or stacked orbits, shortcut `T`)
- Cross-hatch option for grid surveys
- Frontend unit tests (vitest) added and run in CI
