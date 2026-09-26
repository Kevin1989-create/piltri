# Known issues and limitations

Updated 2026-09-26. The data is an offline dataset served as static files
(see HANDOFF.md); the issues of the old live-API design went with it.

## Data limitations, and how each is handled
- **Estimates**: sunshine hours, snowfall and UV index are derived from
  climate normals; flood / sea-level exposure are proxies (elevation +
  distance to the coast); travel times are straight-line (~30 km/h). All
  are labelled as such in the row hints and on /explore/sources.
- **Internet speed** needs 30+ Speedtest results: taken within 5 km, widened
  to 15 or 30 km for small places (the page shows "(15 km)"). About 7,000
  places (broadband) / 9,000 (mobile) have no tests within 30 km and show
  no figure.
- **Air pollution** comes from a satellite map covering land from 60°S to
  70°N. Towns just north of it take the grid-edge value; small island
  nations the map misses (Marshall Islands, Nauru, Tuvalu, Palau) show
  WHO's national estimate, labelled "national estimate". Three places
  have no value (Lakshadweep, a Venezuelan island, Svalbard).
- **Beaches**: sea coast, or a mapped beach on the sea or a large lake
  (Natural Earth's major lakes). River spots, small reservoirs and
  "beach" pools don't count.
- **Country-level fields** (economy, safety, healthcare, PISA...) are the
  same for every city in a country - there's no free per-city source.
- **City population** is GeoNames' city-proper figure; districts of big
  cities are listed as their own places.
- **Places left out**: GeoNames entries whose point isn't a town (a
  municipality's centre in empty land, a national park, an abandoned
  city) - fewer than 1,000 people within 5 km, no restaurant, no school,
  inland. Where a name appears twice in a country, the largest entry
  whose point is actually a town wins.

## Licensing
All sources are open (see /explore/sources, which carries the required
attributions). One is non-commercial: Ookla's speed data (CC BY-NC-SA 4.0).
A commercial deployment builds the dataset with `PIPELINE_COMMERCIAL=1`,
which leaves the speed fields out. (WHO's datasets are CC BY 4.0 under the
terms at data.who.int.)

## To verify
- Clicking directly on a labelled map feature (shop, station) should snap
  the pin to it and show its name - worth a deliberate test on mobile.
