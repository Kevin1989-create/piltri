# Known issues and limitations

Updated 2026-09-26, after the move to an offline dataset served as static
files. The earlier issues (slow pin mode, empty beach field for London,
Overpass/Mapbox rate limits, cold loads) went away with the live data
sources they came from.

## Data limitations (disclosed in the UI)
- **Sunshine hours, snowfall and UV index** are estimates derived from
  climate normals (see pipeline/README.md "Disclosed estimates").
- **Coastal flood / sea-level-rise exposure** are simple proxies
  (elevation + distance to the coast), not inundation models.
- **Travel times** in pin mode and the "distance from city centre" filters
  are straight-line estimates (~30 km/h) - there's no routing engine.
- **Country-level fields** (economy, safety, healthcare, PISA...) are the
  same for every city in a country - there's no free per-city source.
- **Air quality** has no value above 70°N (outside the satellite grid) -
  31 small Arctic towns.
- **Broadband/mobile speeds** need at least 30 Speedtest results within
  5 km; small or remote places often have none.
- **City population** is GeoNames' city-proper figure; districts of a big
  city are listed as their own places.

## Licensing
WHO health data and Ookla speed data are non-commercial licences (fine
today). If Piltri ever becomes commercial, replace the healthcare score with
a World Bank indicator and drop or licence the speeds.

## To verify
- Clicking directly on a labelled map feature (shop, station) should snap
  the pin to it and show its name - worth a deliberate test on mobile.
