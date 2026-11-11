# Mission planning

Plan a drone flight by placing waypoints on the map and configuring what the drone should do at each one.

## What you can do

- Place waypoints by clicking on the map.
- Set altitude, speed, gimbal pitch (camera angle), and heading for each waypoint.
- Choose a heading mode: follow the flight path, set a fixed angle, smooth transition between angles, or aim toward a point of interest.
- Choose a turn mode: smooth curve, stop at the waypoint then continue, or fly through without stopping.
- Reorder waypoints by dragging them in the sidebar list.
- Select multiple waypoints at once (Ctrl+click, Shift+click, Ctrl+A, or Shift+drag a box on the map — add Ctrl/Cmd to extend the selection) and edit them all in bulk.
- In the bulk editor, set a value for all selected waypoints or change them relatively: raise or lower altitude by an amount, set a photo interval, add or remove photo actions.
- **Undo and redo** any change to the mission (waypoints, POIs, obstacles, settings, templates, clearing) with Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or the toolbar arrows. Up to 50 steps are kept.
- Take photos at a **distance interval** between two waypoints instead of stopping at each one.
- Rename waypoints by double-clicking their name.
- Use a global speed for the whole flight, or set a different speed for each waypoint.
- Use a global altitude for the whole flight, or set a different altitude for each waypoint.

## How it works

1. Press **W** or click the waypoint button in the toolbar to enter waypoint mode.
2. Click on the map to place waypoints. They appear as numbered markers.
3. Click a waypoint in the sidebar or on the map to select it and open its settings.
4. Adjust altitude, speed, heading, and turn mode as needed.
5. Add actions to any waypoint (see below).

### Waypoint actions

At each waypoint, you can tell the drone to:

- **Take a photo**.
- **Start or stop recording** video.
- **Rotate the gimbal** to a specific angle.
- **Smooth gimbal movement** (gradual interpolation to a new angle).
- **Rotate the drone** (yaw) clockwise or counter-clockwise.
- **Hover** in place for a set number of seconds.
- **Zoom** to a specific focal length.
- **Focus** on a specific point or set to infinite focus.

## Good to know

- The flight path is drawn on the map as an animated dashed line. The animation speed reflects the drone's configured speed at each segment.
- You can mix manual waypoints with template-generated ones — they all work the same once placed.
- The sidebar shows an elevation graph so you can visualize altitude changes across the flight.
- The sidebar footer and the elevation chart header show live estimates: total distance, flight time, photo count and — when the flight is longer than the battery limit in mission settings — how many batteries it needs. A warning names the waypoints after which to swap.
- Flight time is an estimate: it adds a few seconds wherever the drone stops, and does not include take-off, the flight to the first waypoint, or the return home.
- Dragging a waypoint or typing quickly counts as a single undo step. Loading a mission starts a fresh undo history.
