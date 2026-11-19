# Che Guevara route audit — 18 November 2026

The original route joined too few locations and allowed terrain-based routing to substitute plausible paths for the recorded itinerary. This correction retains the 18 narrative stops and all 26 sketches, adding intermediate geographic control points. These waypoints shape the line; they do not become extra numbered cards.

## Corrections

- Argentina: follow the Atlantic coast via Villa Gesell and Mar del Plata, continue via Necochea, and approach Bariloche through Choele Choel, Piedra del Águila and San Martín de los Andes.
- Chilean border: cross the lakes through Puerto Blest, Lago Frías, Peulla and Petrohué before turning north through Osorno and Valdivia. The previous shortcut went directly northwest from Bariloche toward Temuco. The leg's forced land-only mode is removed so the existing router can infer its water and land sections.
- Central Chile: pass through Santiago between Los Ángeles and Valparaíso.
- Northern Chile/Peru: approach the mine through Baquedano and Calama; then go via Iquique, Arica, Tacna, Tarata, Puno, Juliaca and Sicuani. The former mine-to-Cusco shortcut missed this coastal and highland sequence.
- Machu Picchu: follow the Sacred Valley approach and return through Cusco before heading west. Continue through Abancay, Huancarama, Andahuaylas, Ayacucho, Huancayo, La Merced/Oxapampa, San Ramón and Tarma toward Lima. This is an overview route; minor excursions are not represented as separate visits.
- Lima–Pucallpa: constrain the route through the central mountain crossing, Cerro de Pasco, Huánuco, Tingo María and Aguaytía rather than a straight northeast shortcut.
- Amazon: follow the Ucayali to its confluence with the Marañón, then the Amazon through Iquitos toward San Pablo and Leticia. The old line deviated up to roughly 24 km from the atlas's river geometry.
- San Pablo: move the marker from approximately 3.92°S, 70.50°W to 4.02°S, 71.10°W, near San Pablo de Loreto and its river landing, about 68 km west of the original marker. This is a settlement-scale marker, not an asserted coordinate of the 1952 hospital building.
- Colombia/Venezuela: retain the already-corrected Leticia–Bogotá flight, then follow the overland route through Cúcuta, San Cristóbal and the Venezuelan Andean corridor to Caracas. The final note clarifies that Ernesto returned via Miami; this journey's displayed route still ends at Caracas, where the companions separated.
- Dates: anchor all 18 narrative stops to arrival dates in the published itinerary, replacing distance-interpolated dates at undated stops. English and Chinese stop notes/dates agree.

## Sources and limits

The [publisher's itinerary, pp. xiii–xv](https://cdn.penguin.co.uk/dam-assets/books/9780241465103/9780241465103-sample.pdf) establishes the recorded sequence and dates. [The diary's lake-crossing account](https://www.marxists.org/archive/guevara/1952/motorcycle-diaries/ch12.htm) describes the arrival at Petrohué. [Chile's tourism service](https://chileestuyo.cl/destacado/peulla/) confirms that Peulla–Petrohué is a lake crossing.

[Peru's tourism inventory](https://consultasenlinea.mincetur.gob.pe/fichaInventario/index.aspx?cod_Ficha=10312) identifies San Pablo as the colony visited in 1952. The [mapped San Pablo landing](https://mapcarta.com/es/N5041272507) places it near 4.017°S, 71.100°W. This also avoids confusing it with other settlements named San Pablo.

Named itinerary locations are supplemented with geographic corridor points between them. River control points come from the repository's Natural Earth 1:50m river centerlines (`data/basemap/ne_50m_rivers_lake_centerlines.geojson`). These are generalized modern map geometries, not reconstructed 1952 channels. Land paths between controls remain terrain approximations rather than exact historical roads. Short lake controls keep the coarse routing grid from substituting an unrelated mountain pass.
