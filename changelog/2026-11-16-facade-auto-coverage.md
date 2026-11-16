# Automatic rows and columns for a facade wall

A wall facade's rows and columns were a fixed 1 m apart and did not change
with the distance to the wall. They are now worked out from the camera's
field of view at that distance, the wall's length and the altitude band: the
fewest photos that keep the chosen overlap (Coverage 20%, Inspection 40%,
3D model 75%, or any value). They follow every change while Auto is on;
typing a count switches to Manual. The panel shows the photo footprint,
spacing and overlap achieved, photo count, flight time and battery use, and
warns when photos stop touching.

Rows are now placed to a tenth of a meter instead of whole meters, so
close-range rows less than a meter apart no longer collapse onto the same
height.

Edge photos now sit with their edges on the wall's ends and on the band of
wall to photograph (**Wall from** / **Wall up to**, which replace min and max
altitude for these walls), instead of being centered on them: half of every
edge photo used to look past the wall. A 12 m by 7 m wall from 3 m at 75%
overlap went from 130 photos to 72. A new wall reaches up to the height of
the site feature it is drawn along (plus 0.5 m), or 8 m, instead of 30 m.
