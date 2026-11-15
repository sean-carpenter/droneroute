# Site features

Draw the buildings and areas of a site on the map — the existing building, a garage, a new addition, the lot — each as its own colored, named shape you can edit.

## What you can do

- **Draw** a feature: open the **Site** section in the sidebar, pick a kind, press **Draw**, then click the corners on the map. Click the first corner or double-click to finish; Esc cancels.
- **Add a building from the map**: click a building on the map and choose **Add as building**. The first one added becomes the existing building; later ones are "Other" until you change their kind.
- **Kinds**: existing building, garage, addition, lot and other. Each kind has its own default color and name.
- **Edit** a feature: select it in the list or click it on the map, then:
  - drag its name label to move the whole shape;
  - drag a corner to reshape it, click a midpoint to add a corner, right-click a corner to remove it (at least three stay);
  - change its name, kind and color in the list;
  - set a height, notes, and whether it counts as an obstacle (gear icon);
  - start a facade inspection around it (**Plan facade inspection** under the gear icon, for everything but a lot): the [facade template](templates.md) opens around the outline at a standoff distance, spanning the feature's height when one is set.
- **Remove** a feature with the X in the list.
- Undo and redo cover every change.

## Good to know

- Features are saved with the mission, copied when a mission is shared or cloned, and opened with it.
- Buildings count as obstacles by default: a route that enters or crosses one gets the same warnings and red legs as a drawn obstacle, and with a height set, a route well above it is reported as passing over. A lot is not an obstacle by default. Turn this on or off per feature.
- Changing a feature's kind also changes its color and name, unless you changed those yourself.
- Site features are not written to the exported KMZ.
- Building outlines added from the map come from Mapbox's building data, which may be missing newer buildings, garages and sheds; draw those instead.
- In 3D view a feature with a height rises to it as a solid block in its own color (lots stay flat), and clicking the block selects the feature just like clicking its footprint. A building added from the map also keeps Mapbox's own grey extrusion underneath, so the two may overlap.
- Accepting an [AI route proposal](ai-route-proposals.md) adds the structures the agent traced footprints for as site features.
