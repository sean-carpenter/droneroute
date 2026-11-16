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

## Drawings

Lay a drawing, such as the site plan from a permit set, over the map to line it up with the satellite view and trace buildings from it.

- **Add** a drawing: drag a one-page PDF onto the editor, or press **Add drawing** in the **Site** section. It appears see-through in the middle of the map.
- **Line it up**: press **Adjust** next to it in the list, then drag the drawing itself (or its middle handle) to move it, a corner to resize it (its proportions stay the same) and the round ⟳ handle above it to rotate it. To spin it precisely, use the rotation slider, the ⟲ and ⟳ buttons (1° a click, 10° with Shift) or the [ and ] keys while it is selected (1°, 10° with Shift). For exact numbers, type the sheet's width on the ground in meters and its rotation in degrees.
- **See-through**: the slider sets how strongly the drawing shows. The white paper is always clear, so only the lines cover the map.
- Adjusting is a tool of its own, like adding waypoints or a template: only while it is on does the drawing show handles and move when dragged. Press **Done** or Esc, or pick any other tool, to end it. The rest of the time the drawing lets every click through to the map, so templates, waypoints and site features can be placed on top of it. The eye icon hides a drawing without removing it, and the X removes it.
- Then draw the buildings over it as usual with **Draw**.

## Good to know

- Features are saved with the mission, copied when a mission is shared or cloned, and opened with it.
- Drawings are saved with the mission too, copied with it when it is duplicated, shared or cloned, and opened with it. Each sheet's width, rotation and see-through setting are kept.
- Only one-page PDFs can be added for now; a multi-page set is refused with a message. A mission holds up to 10 drawings.
- The PDF is drawn into an image in your browser; the PDF itself is not uploaded or kept.
- On the satellite and dark maps the drawing's lines show white, so black ink stays visible; on the street map they keep their own colors.
- Drawings are not written to the exported KMZ.
- Buildings count as obstacles by default: a route that enters or crosses one gets the same warnings and red legs as a drawn obstacle, and with a height set, a route well above it is reported as passing over. A lot is not an obstacle by default. Turn this on or off per feature.
- Changing a feature's kind also changes its color and name, unless you changed those yourself.
- Site features are not written to the exported KMZ.
- Building outlines added from the map come from Mapbox's building data, which may be missing newer buildings, garages and sheds; draw those instead.
- In 3D view a feature with a height rises to it as a solid block in its own color (lots stay flat), and clicking the block selects the feature just like clicking its footprint. A building added from the map also keeps Mapbox's own grey extrusion underneath, so the two may overlap.
- Accepting an [AI route proposal](ai-route-proposals.md) adds the structures the agent traced footprints for as site features.
