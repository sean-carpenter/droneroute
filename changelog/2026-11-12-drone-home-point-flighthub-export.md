## Summary

A mission can have a drone home point, and can be exported in the file layout
DJI FlightHub 2 uses.

## Changes

- Drone home point: set where the aircraft takes off and returns to, by
  coordinates or by dropping a marker on the map and dragging it. Dashed lines
  show the flight to the first waypoint and back from the last
- The drone home point is written to the KMZ as the WPML reference take-off
  point and read back on import
- New "FlightHub 2" export button: the same mission with its files in a
  `wpmz/` folder, as DJI documents for WPML. The existing "Export KMZ" is
  unchanged
- Exported KMZ files are named without the characters DJI apps refuse in a
  route name (underscores, dots and others), from every export button
- Exported files follow DJI's WPML reference: the flight file states its height
  mode (above-ground missions are written relative to the takeoff point, with a
  notice), headings stay within -180 to 180, every waypoint carries the heading
  and turn settings DJI requires, and the file has a return-to-home height and
  camera lens setting. FlightHub 2 export refuses EGM96 missions
