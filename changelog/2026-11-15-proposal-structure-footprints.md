# Route proposals carry building footprints

An AI agent drafting a route proposal can now trace a structure's footprint
(`footprintVertices`) and say what it is (`kind`), not just give a point and
radius. Footprints show as cyan outlines while the proposal is reviewed, move
and rotate with it, and marking the proposal done adds each one as a site
feature with its name, kind and height.

A facade suggestion can also target a structure with a footprint: pressing Use
opens the facade template as a path all the way around the footprint at the
suggested standoff distance, instead of a single wall.
