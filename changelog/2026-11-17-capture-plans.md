# Capture plans: from "what is this inspection for" to routes

A building's settings now have **Plan capture**. Pick an objective (exterior
condition baseline, roof inspection, facade inspection) and DroneRoute plans
the parts it needs from the building's outline and height:

- the site context over the lot;
- the roof straight down, with overlap worked out from the roof, not the ground;
- the roof at an angle;
- one route per facade side, with walls found from the outline.

All of it is made by the existing templates; there is no AI.

Before adding, a checklist shows each part's waypoints, photos and time, or
what is missing. It also shows the totals and batteries, the assumptions,
what is better done from the ground, and anything the whole flight runs
into or comes too close to. The plan is saved on its routes and can be
reopened to update them in place.

Also:

- Facade routes climb above the roof between walls, instead of cutting
  past corners.
- The "too close" warning checks facade routes against their own planned
  distance, so a facade planned at 1 m no longer always warns at 10 m.
- Grid surveys can take a surface height (`surfaceHeightM`).
- A new `walls` generator flies several walls as one route.
