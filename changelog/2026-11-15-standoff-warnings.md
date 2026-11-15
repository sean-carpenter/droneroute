# Warn when the route comes too close to an obstacle

Until now the planner only warned when a route entered or crossed an
obstacle; skimming along a wall at arm's length was silent. The warnings
panel now also says when any waypoint or leg comes within 10 m of an obstacle
or a building marked as one, naming it and the closest distance. A route
that clears the obstacle's height with margin to spare is not warned about.
With absolute (EGM96) altitudes, heights cannot be compared, so the check is
purely horizontal — deliberately conservative.
