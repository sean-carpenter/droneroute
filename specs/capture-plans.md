# Capture plans

Say what an inspection of a building is for, and DroneRoute works out which parts to photograph and how, and makes the routes for them. You review everything on the map before anything is added, and every route stays editable.

## What you can do

- Open a building's settings in the site list (gear icon) and press **Plan capture**.
- Pick what the inspection is for:
  - **Exterior condition baseline**: the site around the building, the roof straight down and at an angle, and every facade. A full exterior record to repeat later.
  - **Roof inspection**: the roof straight down and at an angle all the way around.
  - **Facade inspection**: every wall, straight on.
- Adjust the distances: from the walls, above the roof, the angled offset, the site altitude, and the height to assume when the building has none.
- Read the checklist. Each part shows:
  - **Planned**: with its waypoints, photos and flight time.
  - **Needs something from you**: for example, a lot outline for site photos.
  - **Does not apply**: for example, no wall faces west.
- The totals show routes, flight time, batteries and photos.
- See the proposed routes on the map, then press **Add routes**. Undo removes them all in one step.
- Open **Plan capture** again (it now says **Update capture plan**) to change the objective or distances, or to rebuild after reshaping the building. **Update** replaces that plan's routes where they are in the flight, and leaves your other routes alone.

## How it works

The objective decides which parts are needed. The routes come from the [templates](templates.md), with settings worked out from the building's outline and height:

| Part                            | Route                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Site context                    | Grid survey over the lot outline the building stands in, 75% overlap, at the site altitude                                                                                                                                                 |
| Roof, straight down             | Grid survey over the roof outline, reaching a little past the eaves, at the building height plus the height above roof. Overlap is worked out from the camera's distance to the roof, not to the ground. Lines run along the longest wall. |
| Roof, angled                    | One loop around the outline, outside it and above the roof by the angled offset, looking down at the roof edge (45° when both are equal)                                                                                                   |
| North, east, south, west facade | Each wall facing that way, photographed straight on from near the ground to just above the roof line at the facade distance, every spot in about two photos (Inspection overlap)                                                           |

- The walls come from the outline: corners that barely turn are ignored, so a wall drawn with an extra point is still one wall. A wall faces whichever of north, east, south or west is closest to straight out from it.
- Walls shorter than 2 m are left out, and the plan says so.
- Each facade route climbs straight up to 6 m above the roof before moving to the next wall or route, and comes straight down at the next. This keeps the drone from cutting past the building's corners.
- Each route remembers the plan it belongs to, so it can be [regenerated](templates.md#regenerating-a-route) on its own, and the plan can be reopened later.

## Checks and assumptions

- The whole flight, including the moves between routes, is checked against every obstacle and every building marked as an obstacle. The plan lists anything it runs into, or comes closer to than its own distance (for example, the other wall in an inside corner). It also flags any route above 400 ft (122 m).
- Assumptions are listed. For example:
  - the assumed building height;
  - that altitudes are above the take-off point;
  - an outline that came from map data;
  - a stand-in camera.
- A building with no height gets the assumed height when the routes are added, so the mission's own warnings see the same building the plan did.
- It also lists what is better photographed from the ground, such as entrances, drainage and the undersides of eaves.

## Good to know

- DroneRoute only knows what is drawn in the mission. It knows nothing of wires, trees, cranes, people, airspace authorization, flight restrictions or weather. No warning does not mean safe to fly.
- Flight time leaves out the flights between routes and to and from take-off.
- The objective, settings and building are saved with each route. Nothing is written to the KMZ beyond the waypoints.
