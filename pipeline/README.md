# Piltri data pipeline

Every number the site shows is **computed offline** by this pipeline and
published as static files. The website makes **no third-party API calls at
request time**: a city page is one small CDN read from Supabase Storage.

```
npm run pipeline          # build + publish (≈40 min first run, mostly Overture)
npm run pipeline:build    # compute a dataset into ~/.piltri-pipeline-cache/out/<version>/
npm run pipeline:publish  # upload the newest built dataset and switch the site to it
```

Refreshes run automatically once a month via
`.github/workflows/refresh-dataset.yml` (needs two repo secrets:
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). The site picks up a
new dataset within ~5 minutes of publishing, with no redeploy.

## Sources (all free, no API keys, commercial use allowed)

| What | Source | Licence | How |
|---|---|---|---|
| City shortlist, population, elevation | GeoNames `cities5000` | CC BY 4.0 | every place with 5,000+ people (~66k) |
| Country economy, safety, demographics, life expectancy, internet, PISA | World Bank Open Data | CC BY 4.0 | one bulk call per indicator, all countries |
| Healthcare quality | WHO GHO (UHC service coverage index) | CC BY-NC-SA 3.0 IGO* | one bulk call |
| Climate readiness | ND-GAIN | free | `scripts/generateClimateReadiness.mjs` |
| Temperature, rainfall, humidity, sunshine, snow, Köppen | WorldClim 2.1 normals (1970-2000), 2.5′ grid | CC BY 4.0 | rasters sampled with `geotiff.js` |
| Restaurants/bars/cafés, cultural venues, family activities, parks, schools, universities, stations | Overture Maps places | CDLA-Permissive-2.0 | DuckDB over Overture's public S3 bucket |
| Airports, rail/metro/bus/tram, schools, universities, beaches, 1,000 m+ peaks, forests, volcanoes | GeoNames `allCountries` | CC BY 4.0 | streamed once |
| Coastline | Natural Earth 1:10m | public domain | densified to ~1 km |
| Earthquakes (M5+ since 1970) | USGS catalogue | public domain | fetched a decade at a time |

\* WHO data is non-commercial - swap the healthcare score for a World Bank
indicator if Piltri becomes commercial.

### Disclosed estimates
- **Sunshine hours**: from WorldClim solar radiation via FAO-56
  Angström-Prescott, calibrated ×1.1 against 11 reference cities (~9% mean
  error).
- **Snowfall**: precipitation in sub-zero months (monthly means can't see
  individual spring storms).
- **Coastal flood / sea-level-rise exposure**: elevation + distance to the
  coastline - proxies, not inundation models.
- **Pin-mode travel times**: straight-line distance, ~30 km/h (no routing).

## How it's organised

- `countries.ts` - World Bank + WHO -> one record per country
- `geonames.ts` - point features + city elevations
- `overture.ts` - resumable per-file extract of Overture places; per-city
  counts within 5 km computed **inside DuckDB** (millions of points never
  enter JavaScript)
- `worldclim.ts` - climate rasters -> per-city climate fields
- `hazards.ts` - coastline + earthquakes
- `build.ts` - joins everything, writes the dataset
- `poiTiles.ts` - 5°×5° tiles of airports/stations/beaches/peaks for pin mode
- `publish.ts` - gzips + uploads to the `piltri-data` bucket; flips
  `manifest.json` last (atomic switch); keeps current + previous version

The on-disk format is defined once in `lib/dataset/schema.ts`, shared with
the site's loader (`lib/dataset/load.ts`). **Changing `CITY_FIELDS` means
bumping `DATASET_SCHEMA_VERSION`** - the site refuses a dataset built for a
different schema instead of misreading columns.

## Adding a field

1. Compute it in `build.ts` (usually from an index or source already loaded).
2. Add it to `CITY_FIELDS` + `CityRecord` (city-level) or `CountryRecord`
   (country-level) in `lib/dataset/schema.ts`; bump the schema version.
3. Map it into `CityExploreData` in `lib/dataset/assemble.ts`.
4. Show it in `lib/kpiRows.ts`; optionally filter on it in
   `lib/advancedSearch/criteria.ts`.
5. `npm run pipeline`, then deploy the site (the new site reads the new
   schema version).

## Caching

Downloads and slow intermediate steps are cached in
`~/.piltri-pipeline-cache/` (outside OneDrive - it's ~2 GB). Delete
`work/<step>.json` to recompute a step, or set `PIPELINE_FRESH=1` to
recompute everything.
