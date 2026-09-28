# Piltri data pipeline

Every number the site shows is **computed offline** by this pipeline. The
website has **no server-side data code at all**: at build time
(`scripts/sync-dataset.mjs`, run by `predev`/`prebuild`) it copies the
current dataset into `public/data/<version>/`, and the browser reads small,
immutable, CDN-cached files from there - a city page is two files of a few
KB, a search keystroke reads a local index, Advanced Search filters every
city in the browser in milliseconds.

```
npm run pipeline          # build + publish
npm run pipeline:build    # compute a dataset into ~/.piltri-pipeline-cache/out/<version>/
npm run pipeline:publish  # upload it to Supabase Storage (v<schema>/<version>/bundle.json.gz + v<schema>/manifest.json)
```

Test a local build on the site without publishing it:
`DATASET_DIR=~/.piltri-pipeline-cache/out/<version> npm run dev`.

Refreshes run automatically once a month via
`.github/workflows/refresh-dataset.yml`, which builds, publishes and then
triggers a Vercel deploy (repo secrets: `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `VERCEL_DEPLOY_HOOK_URL`). Any other deploy
also picks up the latest published dataset.

## Sources (all free, no API keys)

| What | Source | Licence |
|---|---|---|
| City shortlist, population, elevation, time zone, capitals, currencies | GeoNames `cities5000` + `countryInfo` | CC BY 4.0 |
| Country economy, safety, demographics, life expectancy, internet, PISA | World Bank Open Data (bulk, all countries) | CC BY 4.0 |
| Healthcare quality; PM2.5 fallback for small island nations | WHO (data.who.int: UHC service coverage index, SDG 11.6.2 PM2.5) | CC BY 4.0 |
| Climate readiness | ND-GAIN (`generateClimateReadiness.mjs`) | free |
| Temperature (mean, monthly highs/lows), rainfall, humidity, sunshine, snow | WorldClim 2.1 normals (1970-2000), 2.5′ grid | CC BY 4.0 |
| Climate type today (1991-2020) and by 2085 (SSP2-4.5) | Beck et al. (2023) 1 km Köppen-Geiger maps | CC BY 4.0 |
| UV index | NASA POWER all-sky UV climatology (CERES SYN1deg, 2001-2020) | public domain |
| Air pollution (PM2.5) | ACAG satellite-derived PM2.5 V6.GL.03, 2024, 0.01° (AWS Open Data) | CC BY 4.0 |
| Population density (5 km) | GHS-POP R2023A, 2025, 1 km (EC JRC) | CC BY 4.0 |
| Broadband / mobile speed | Ookla Speedtest open data, latest quarter (AWS Open Data) | CC BY-NC-SA 4.0* |
| Coastline, major lakes (which beaches count) | Natural Earth 1:10m | public domain |
| Restaurants/bars/cafés, cultural venues, family activities, parks, schools, universities, stations | Overture Maps places | CDLA-Permissive-2.0 |
| Tram / light rail / metro lines | Overture Maps transportation (OpenStreetMap rail) | ODbL |
| City outlines on the map | Overture Maps divisions (OpenStreetMap boundaries) | ODbL |
| Airports, rail/metro/bus stations, beaches, 1,000 m+ peaks, forests, volcanoes | GeoNames `allCountries` | CC BY 4.0 |
| Earthquakes (M5+ since 1970) | USGS catalogue | public domain |

\* Non-commercial: fine for Piltri today. A commercial deployment builds with
`PIPELINE_COMMERCIAL=1`, which leaves the speed fields out. Every source is
credited on the site at /explore/sources (built from the manifest).

### Disclosed estimates
- **Sunshine hours**: WorldClim solar radiation via FAO-56 Angström-Prescott,
  calibrated ×1.1 against 11 reference cities (~9% mean error).
- **Snowfall**: precipitation in sub-zero months.
- **UV index**: POWER publishes a 24-hour mean; the noon peak is recovered
  from the sun's path (UV ∝ cos(zenith)^2.42), averaged over 12 months.
  Includes cloud, so it reads lower than clear-sky forecast values.
- **Coastal flood / sea-level-rise exposure**: elevation + distance to the
  coastline - proxies, not inundation models.
- **Pin-mode / "distance from city centre" minutes**: straight-line distance
  at ~30 km/h (no routing).
- **Amenities per resident**: Overture places within 5 km / GHS-POP
  residents within 5 km (at least 1,000), per 1,000 (places to eat) or
  10,000 (parks, cultural, family). Computed on the site from the stored
  counts and density; scored on a log scale capped near the 95th
  percentile (AMENITY_RATIOS in lib/dataset/assemble.ts).

### Data-quality rules
- **No stand-in values**: a figure a source doesn't have for a place is
  stored as null - the site shows "No data" and leaves it out of the
  section score (a section with no data at all scores a neutral 50).
- **Country codes** come from GeoNames' countryInfo.txt (ISO3; Kosovo is
  XKX, as World Bank uses), so territories World Bank covers (Kosovo,
  Palestine, Curaçao, Guam...) get their data. About 30 places have no
  World Bank data at all (Taiwan, Western Sahara, the French overseas
  departments, Jersey/Guernsey, small islands).
- **Duplicate names** in a country (~2,400 GeoNames pairs): the largest
  entry whose point is a town (5,000+ people, or a fifth of its stated
  population, within 5 km) - so a municipality centre point in empty land
  can't win on population alone.
- **Places left out**: under 1,000 people within 5 km, no restaurant, no
  school, and inland - the listed point isn't a town (~240 places).
- **Speeds**: averaged within 5 km, widened to 15/30 km below 30 tests;
  the radius is stored and shown.
- **PM2.5**: grid-edge value for towns just beyond the satellite map;
  WHO national estimate (labelled) for small countries it misses.
- **Beaches**: only on the sea or a Natural Earth major lake (scalerank <= 7).
- **City outlines**: the Overture division polygon with the city's own name
  (ignoring "City of" / "Greater" / " City") that contains its point, within
  ~1 km, between 0.3 and 6,000 km² - a locality first, a region only for
  city-states (Berlin, Tokyo); parts over ~50 km away (islands) dropped.
  Otherwise none, and the map draws the 5 km circle - never a neighbouring
  town's outline. ~58% of places get one. Simplified to ~100-300 points and
  stored as integer deltas (bounds/<CC>-<n>.json).

## How it's organised

- `shortlist.ts` - GeoNames cities5000 -> the ~66k cities + per-country
  capital/currency
- `countries.ts` (+ `sources/`, `static/`) - World Bank + WHO + UN + ND-GAIN
  -> one record per country
- `geonames.ts` - point features (airports, stations, peaks...) from the
  full GeoNames dump
- `overture.ts` - resumable per-file extracts of Overture places and urban
  rail from their public S3 bucket
- `boundaries.ts` - each city's outline from Overture divisions, matched by
  name and location
- `nearCities.ts` - "within 5 km of each city" counts and averages, run
  **inside DuckDB** (millions of points never enter JavaScript)
- `worldclim.ts`, `koppenMap.ts`, `uv.ts`, `airQuality.ts`, `population.ts`,
  `broadband.ts`, `hazards.ts` - one module per raster/dataset
- `build.ts` - joins everything, computes scores and world ranks
- `output.ts` - writes the site's file layout (city chunks, search index,
  Advanced Search columns, pin-mode tiles, manifest) + `bundle.json.gz`
- `publish.ts` - uploads the bundle, then the manifest (atomic switch);
  keeps current + previous version

The file format is defined once in `lib/dataset/schema.ts`, shared with the
site. **Changing `CITY_FIELDS` or the layout means bumping
`DATASET_SCHEMA_VERSION`** - the site refuses a dataset built for a
different schema, and each schema version publishes under its own `v<N>/`
prefix so the live site keeps working until the new code deploys.

## Adding a field

1. Compute it in `build.ts` (a new module if it needs a new source).
2. Add it to `CITY_FIELDS` + `CityRecord` (city-level) or `CountryRecord`
   (country-level) in `lib/dataset/schema.ts`; bump the schema version.
3. Map it into `CityExploreData` in `lib/dataset/assemble.ts`.
4. Show it in `lib/kpiRows.ts`; to make it filterable, add it to
   `lib/advancedSearch/criteria.ts` (the pipeline publishes a column for
   it automatically).
5. `npm run pipeline`, then deploy the site.

## Caching

Downloads and slow intermediate steps are cached in
`~/.piltri-pipeline-cache/` (outside OneDrive - it's ~10 GB). Per-city
steps are keyed by a hash of the city list, so a changed shortlist
recomputes them. Delete `work/<step>.json` to recompute one step, or set
`PIPELINE_FRESH=1` to recompute everything.
