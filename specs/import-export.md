# Import and export

Bring in existing missions or export your planned flight as a file ready for DJI drones.

## What you can do

- **Export** a mission as a KMZ file compatible with DJI drones (WPML format).
- **Export for FlightHub 2**: the same mission in a KMZ whose files sit in a `wpmz/` folder, the arrangement DJI documents for WPML files and the one DJI FlightHub 2 and DJI Pilot 2 write themselves.
- **Import** an existing mission or path from a file:
  - **DJI KMZ (WPML)** — waypoints, actions, interval capture, POIs and mission settings.
  - **KML or Google Earth KMZ** — paths become waypoints; a polygon is imported as a route around its outline; placemarks next to a path become POIs.
  - **GPX** — the first route or track becomes waypoints; GPX waypoints next to it become POIs.
  - **Litchi CSV** — waypoints with altitude, speed, heading, curve size, gimbal pitch, actions, POIs and photo intervals.

## How it works

### Exporting

1. Plan your mission in the editor.
2. Click the export/download button.
3. A KMZ file is generated and downloaded to your computer.
4. Load the KMZ onto your drone's controller (manually or using the upload tool).

To take a mission to DJI FlightHub 2, click **FlightHub 2** instead of **Export KMZ**, then import the downloaded file into the project's flight route library in FlightHub 2.

### Importing

1. Click the import button, or drag a file onto the page.
2. Select a KMZ, KML, GPX or CSV file from your computer.
3. An **import preview** shows the detected format, how many waypoints, POIs and photo actions were found, and any warnings (for example, heights that had to be assumed).
4. Choose **Replace mission** to load the file, or **Add to mission** to append its waypoints to the route you already have.

## Good to know

- The exported KMZ follows DJI's WPML standard, so it works with DJI's own flight apps too.
- The two exports contain the same route. They differ only in where the files sit inside the KMZ: **Export KMZ** keeps them at the top level, **FlightHub 2** puts them in `wpmz/`. Import accepts both.
- DJI apps take the route name from the file name and refuse `< > : " / | ? * . _ \`. Every export, from the editor, the saved missions list or a shared link, therefore names its file with letters, digits, spaces and hyphens only ("Site grid - orbit.kmz").
- The FlightHub 2 export is a file you import yourself. DroneRoute does not sign in to FlightHub 2 or upload to it.
- If the mission has a drone home point, both exports carry it as the reference take-off point.
- Heights: DJI's flight file only holds heights relative to the takeoff point or absolute ellipsoid heights. Missions planned **above ground level** are exported with the same numbers **relative to the takeoff point**, which is right when the drone takes off from ground level with the site; a notice says so after each export. Missions in **EGM96** are exported as they are, and the FlightHub 2 export refuses them, because they cannot be converted without geoid data.
- The return-to-home height in the file is the highest waypoint, and never below the takeoff security height.
- The export fills in what DJI requires for every waypoint (heading and turn settings, camera lens setting), so the files follow DJI's published WPML reference.
- Imported missions may not look exactly the same if the original file used features not supported by DroneRoute.
- Distance-interval photo capture is exported as a DJI `multipleDistance` trigger and read back on import.
- KML and GPX files usually carry no height above ground, so their waypoints get the default altitude; the preview tells you when this happens.
- Paths with more than 500 points are thinned to 500 evenly spread waypoints.
- Only WPML files carry mission settings. Importing any other format keeps your current settings.
- The maximum import file size is 50 MB.
- Imported and saved missions are validated: files with malformed contents or
  out-of-range coordinates are rejected with an error rather than being loaded.
