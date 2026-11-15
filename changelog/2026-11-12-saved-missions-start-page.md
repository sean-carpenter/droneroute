## Summary

The app opens on the list of saved missions, saving confirms what was saved,
and a mission can have a home set from an address or coordinates.

## Changes

- Signed-in users and single-user instances start on the saved missions list;
  the editor (waypoints, points of interest, obstacles, mission settings) opens
  after picking a mission or starting a new one. Guests still start in the editor
- Saving shows a confirmation with the mission name, and trims stray spaces
  from the name
- The list marks the mission open in the editor, asks before discarding unsaved
  changes, and clears the editor when its mission is deleted
- The list is labelled "Saved missions" instead of "My routes"
- Mission home: enter an address or `lat, lng` under the mission name. It is
  marked on the map (drag to adjust), the map centers on it, it is saved with
  the mission and shown in the saved missions list. Not written to the KMZ
