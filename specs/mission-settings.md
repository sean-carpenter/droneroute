# Mission settings

Configure your drone model, camera, altitude reference, and safety options for the mission.

## What you can do

- **Set a mission home**: type an address or coordinates (`lat, lng`) in the box under the mission name. The home is marked on the map with a green house, the map centers on it, and the mission opens there next time. Drag the marker to fine-tune the position; the address stays as its label.
- **Set a drone home point**: where the aircraft takes off and returns to. Type coordinates in the box under the mission home, or press the crosshair button to drop it at the center of the map, then drag the blue marker to the launch spot. Dashed lines show the flight out to the first waypoint and, when the mission ends with "go home", back from the last one. An optional ground elevation can be entered next to it.
- **Choose your drone model**: M300 RTK, M350 RTK, M30/M30T, M30 Dock, Mavic 3E/3T/3M/3D/3TD, Mini 4 Pro.
- **Choose a camera/payload** available for the selected drone.
- **Set a global flight speed** and takeoff security height.
- **Choose a height reference**:
  - Relative to start point.
  - EGM96 (MSL) — altitude above mean sea level.
  - Above ground level.
- **Set what happens when the mission ends**: go home, land automatically, return to the first waypoint, or hover.
- **Set what happens if the remote controller connection is lost**: return home, land, or hover.
- **Set the transit speed** (speed used to fly to the first waypoint).
- **Set maximum battery minutes** so the app can warn you if the estimated flight time exceeds your battery capacity.

## How it works

1. Open the mission settings panel in the sidebar.
2. Select your drone and camera.
3. Adjust altitude reference, speeds, and safety options.
4. The app uses these settings when exporting the mission file and when calculating flight time estimates.

## Good to know

- The drone home point is written to the exported KMZ as the WPML reference take-off point (`takeOffRefPoint`), and read back when a DJI KMZ that has one is imported. It is a planning reference: the aircraft still records its real home point where it actually takes off, so launch from the spot you marked. The elevation is written as 0 when left empty.
- The lines to and from the drone home point are straight and are not checked against obstacles; the aircraft climbs to the takeoff security height first.
- The mission home is a planning aid: it is saved with the mission and shown in the saved missions list, but it is not written to the exported KMZ and does not change where the drone takes off or returns to.
- Address lookup uses the map's Mapbox token. Without one, enter coordinates instead. When an address has several matches, pick the right one from the list.
- The available cameras change depending on which drone you select.
- If the estimated flight time exceeds the battery limit you set, a warning appears.
- Height reference affects how altitude values are interpreted by the drone — choose the one that matches your operational needs. The default is **above ground level**.
- All height fields enforce a minimum of 1 meter.
- You can set default values for all mission settings in the **Mission defaults** tab of the settings dialog. New missions will use those defaults instead of the factory defaults.
