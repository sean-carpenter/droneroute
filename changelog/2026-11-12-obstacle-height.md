## Summary

Obstacles can have a height, so a route that flies well above the trees or a
building is no longer reported as a conflict.

## Changes

- Obstacle settings have a new "Height (m)" field: the top of the obstacle
  above ground
- A waypoint or leg at least 5 m above that height is reported in a blue
  "Route passes over…" notice instead of an obstacle warning, and the leg is
  no longer drawn in red
- A leg is judged by its lower end; obstacles without a height behave as
  before; heights are ignored when the mission uses absolute (EGM96) altitudes
- Obstacles converted from 3D buildings take the building's height
