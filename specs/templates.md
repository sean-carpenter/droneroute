# Templates

Create common flight patterns automatically instead of placing waypoints one by one.

## What you can do

- **Orbit**: fly a circular path around a center point. Choose radius, number of waypoints, and direction (clockwise or counter-clockwise).
- **Grid survey**: fly a back-and-forth zigzag pattern over an area. In **photogrammetry** mode you set side and forward overlap (or pick a preset) and the app works out line spacing and photo interval from the camera; it shows ground sample distance (GSD), image footprint, photo count, distance, flight time and batteries needed as you adjust. You can also type a target GSD and the altitude follows. **Fixed spacing** mode keeps the simple "lines every N meters" behavior.
- **Corridor survey**: draw a path along a road, river or power line and the app flies one or more parallel lines along it, wide enough to cover the corridor width you set.
- **Facade scan**: fly a vertical scanning pattern along a building face. Useful for inspections.
- **Pencil path**: draw a freehand path on the map and the app places evenly spaced waypoints along it.

- **Tower inspection**: circle a mast, chimney or tower while climbing — either one continuous spiral (helix) or a stack of level orbits — between a minimum and maximum altitude.
- **Cross-hatch**: a grid survey option that adds a second set of lines at 90° to the first, for better 3D reconstruction.

### Camera aim

Orbit, facade, tower, pencil and corridor templates share a **Camera aim** section that decides the gimbal pitch of every generated waypoint:

- **Fixed pitch**: the same angle everywhere.
- **Toward POI**: each waypoint points at a point of interest you pick; the pitch is worked out from that waypoint's position and altitude, and the aircraft turns to face the POI.
- **Height on structure** (orbit, facade, tower): aim at the structure itself at a height you choose — the wall straight in front of the drone, or the center of the orbit or tower. Height 0 is the base. Aiming at the base looks further down as the drone climbs; aiming at a height band levels off when the drone reaches it and looks up from below it. Base / middle / top buttons fill in common heights.
- **Relative to surface**: a fixed number of degrees away from looking straight at the surface — below level for walls and towers, up from straight down for ground surveys (an oblique view).

The panel shows the resulting pitch range and warns when a waypoint would need more tilt than the gimbal allows (-90° to +35°).

### Photo capture on survey lines

Grid (photogrammetry mode) and corridor surveys offer three ways to take photos:

- **Distance interval** (default): the drone flies each line without stopping and takes a photo every few meters. Only the line ends are waypoints.
- **Waypoint per photo**: one stop-and-shoot waypoint for every photo. Slower, but each photo position can be edited.
- **Line ends only**: a photo at each end of every line.

## How it works

1. Select a template from the toolbar or press its shortcut key (O for orbit, G for grid, F for facade, Z for pencil, C for corridor, T for tower).
2. Configure the template options in the panel that appears.
3. Click on the map to place the template.
4. The generated waypoints appear in the sidebar and can be edited individually.

## Good to know

- Survey math uses the Mavic 3E wide camera. With other payloads the same camera is used as a stand-in and the panel says so.
- If the mission speed is too fast for the camera to keep up with the photo interval, the panel warns you and shows the highest usable speed.
- Survey templates are capped at 2000 waypoints.
- Templates are repeatable: the same settings always produce exactly the same waypoints and camera angles, so an inspection can be regenerated and flown again.
- Facade and orbit keep their earlier defaults (aim at the wall base / the ground under the center).
- When an orbit or tower creates its center POI, the POI is placed at the height the camera aims for.

- You can combine templates — for example, use a grid survey and then add an orbit around a specific structure.
- All generated waypoints behave like normal waypoints after placement. You can move, delete, or change their settings.
