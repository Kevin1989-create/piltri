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
npm run pipeline:publish  # upload it to Supabase Storage (v2/<version>/bundle.json.gz + v2/manifest.json)
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
| Healthcare quality | WHO GHO (UHC service coverage index) | CC BY-NC-SA 3.0 IGO* |
| Climate readiness | ND-GAIN (`generateClimateReadiness.mjs`) | free |
| Temperature (mean, monthly highs/lows), rainfall, humidity, sunshine, snow | WorldClim 2.1 normals (1970-2000), 2.5′ grid | CC BY 4.0 |
| Climate type today (1991-2020) and by 2085 (SSP2-4.5) | Beck et al. (2023) 1 km Köppen-Geiger maps | CC BY 4.0 |
| UV index | NASA POWER all-sky UV climatology (CERES SYN1deg, 2001-2020) | public domain |
| Air pollution (PM2.5) | ACAG satellite-derived PM2.5 V6.GL.03, 2024, 0.01° (AWS Open Data) | CC BY 4.0 |
| Population density (5 km) | GHS-POP R2023A, 2025, 1 km (EC JRC) | CC BY 4.0 |
| Broadband / mobile speed | Ookla Speedtest open data, latest quarter (AWS Open Data) | CC BY-NC-SA 4.0* |
| Restaurants/bars/cafés, cultural venues, family activities, parks, schools, universities, stations | Overture Maps places | CDLA-Permissive-2.0 |
| Tram / light rail / metro lines | Overture Maps transportation (OpenStreetMap rail) | ODbL |
| Airports, rail/metro/bus stations, beaches, 1,000 m+ peaks, forests, volcanoes | GeoNames `allCountries` | CC BY 4.0 |
| Coastline | Natural Earth 1:10m | public domain |
| Earthquakes (M5+ since 1970) | USGS catalogue | public domain |

\* Non-commercial licences: fine for Piltri today; if it ever becomes
commercial, swap the healthcare score for a World Bank indicator and drop
(or licence) the Ookla speeds.

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

## How it's organised

- `shortlist.ts` - GeoNames cities5000 -> the ~66k cities + per-country
  capital/currency
- `countries.ts` (+ `sources/`, `static/`) - World Bank + WHO + UN + ND-GAIN
  -> one record per country
- `geonames.ts` - point features (airports, stations, peaks...) from the
  full GeoNames dump
- `overture.ts` - resumable per-file extracts of Overture places and urban
  rail from their public S3 bucket
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
