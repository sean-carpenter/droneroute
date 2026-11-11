# Import and export

Bring in existing missions or export your planned flight as a file ready for DJI drones.

## What you can do

- **Export** a mission as a KMZ file compatible with DJI drones (WPML format).
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

### Importing

1. Click the import button, or drag a file onto the page.
2. Select a KMZ, KML, GPX or CSV file from your computer.
3. An **import preview** shows the detected format, how many waypoints, POIs and photo actions were found, and any warnings (for example, heights that had to be assumed).
4. Choose **Replace mission** to load the file, or **Add to mission** to append its waypoints to the route you already have.

## Good to know

- The exported KMZ follows DJI's WPML standard, so it works with DJI's own flight apps too.
- Imported missions may not look exactly the same if the original file used features not supported by DroneRoute.
- Distance-interval photo capture is exported as a DJI `multipleDistance` trigger and read back on import.
- KML and GPX files usually carry no height above ground, so their waypoints get the default altitude; the preview tells you when this happens.
- Paths with more than 500 points are thinned to 500 evenly spread waypoints.
- Only WPML files carry mission settings. Importing any other format keeps your current settings.
- The maximum import file size is 50 MB.
- Imported and saved missions are validated: files with malformed contents or
  out-of-range coordinates are rejected with an error rather than being loaded.
