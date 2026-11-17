# Obstacles

Draw no-fly zones on the map to get warnings when your flight path conflicts with them.

## What you can do

- Draw polygon-shaped areas on the map representing obstacles or restricted zones.
- See a list of all obstacles in the sidebar.
- Get automatic warnings when any waypoint falls inside an obstacle zone, or a leg of the route crosses one.
- Give an obstacle a **height** (the top of the trees or building, in meters above ground). A route that is at least 5 m above it is then reported as passing over the obstacle, in a blue notice, instead of as a warning.

## How it works

1. Press **B** or click the obstacle button in the toolbar to enter obstacle drawing mode.
2. Click on the map to draw the corners of the polygon.
3. Close the polygon to finish.
4. If any waypoint is inside the polygon, or a leg crosses it, a warning appears in the warnings panel and the leg is drawn in red.
5. To set a height, open the obstacle's settings (gear icon) in the sidebar and fill in **Height (m)**.

## Good to know

- Obstacles are visual aids and warnings only — they don't prevent you from flying through them. They help you spot potential problems before exporting the mission.
- You can delete or edit obstacles from the sidebar list.
- An obstacle without a height is treated as reaching any altitude: everything inside or across it is a warning.
- A route that stays outside an obstacle but comes within 10 m of it gets a "too close" warning naming the obstacle and the closest distance. A facade route was planned to fly close to a wall, so it is checked against its own distance instead (a little under it, for rounding): a facade 2 m from the wall warns only where it comes closer than about 1.8 m to something, such as the other wall in an inside corner. It is advice, not a conflict: the legs are not drawn red. A route that clears the obstacle's height (plus the 5 m margin) is not warned about.
- A leg is judged by its lower end, so a climb or descent that starts or ends below the obstacle's height plus 5 m is still a warning.
- Heights are compared only when the mission's altitude mode is relative to the ground or the takeoff point. With absolute (EGM96) altitudes the numbers are not comparable, so every obstacle is treated as having no height.
- Obstacles created from a 3D building take the building's height when the map data has one.
- In 3D view an obstacle with a height rises to it as a translucent red block; one without a height stays flat.
- The takeoff climb and the return to home are not checked against obstacles.
- Buildings drawn as [site features](site-features.md) are checked like obstacles unless you turn that off for them.
