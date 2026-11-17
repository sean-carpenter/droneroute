# Route plans: template routes remember how they were made

A template's settings were thrown away once it was applied, so a route could
only be replayed, not made again. Now each template route keeps a plan: the
template, its exact settings (camera included), the site feature a facade goes
around, the POI it made, the generator version and a fingerprint of the
waypoints it produced. The plan is saved inside the route (no new column),
checked by the server, and never written to the KMZ.

A new regenerate button on each template route makes it again from its plan:
identical waypoints when nothing changed, the current outline when a site
feature was reshaped. Routes changed by hand say "Edited since generated", and
regenerating them asks first. This is the groundwork for capture plans and for
repeating a capture months later.
