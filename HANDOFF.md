# Piltri — project handoff

Current state of the project for a new session. Read this first; then
`README.md`, `pipeline/README.md`, `DEPLOYMENT.md`, `KNOWN-ISSUES.md`. The
reasoning behind older product decisions is archived in `docs/HISTORY.md`
(it describes designs that no longer exist - don't follow its technical
instructions).

## What Piltri is

Compare ~146,800 places (every GeoNames place with 1,000+ people) in 245
countries on a weighted **Piltri Score**: Safety 30%, Economy 25%,
Environment 25%, Quality of Life 20% (users re-weight on `/settings`, with
units and language). Demographics are shown but not scored. There is **no
Real Estate section** - no free, reliable global price source exists.

- **Explore** (`/`): search a city -> `/city?id=lyon-fr`: map, score,
  section panels (the city's own figures, then its country's), world rank,
  a printable report (`/report?id=`), Compare (`/compare?id=…&id=…`, up
  to 10 places), and pin mode. Tapping a Yes or a distance shows it on the
  map: flags for a Yes (up to 6), the road journey for a distance, with an
  "Open in Google Maps" link.
- **Advanced search** (`/search`): one page of plain choices, live results,
  each result's list position and "#N overall"; a country's figures at
  `/country?code=FR`.
- **Leaderboards** (`/leaderboards`): 10 rankings, top 10, by region,
  population size and places per country.
- Every page address is listed in `lib/urls.ts`; the older `/explore/...`
  addresses redirect (next.config.js).
- **/admin** (password): dataset status and the Resources links editor.

## Constraints (from the owner)

- **Zero running cost, no live third-party data calls.** New data goes
  through the offline pipeline from free bulk sources; never a runtime API
  or a paid tier. One approved exception (2026-10-16): road journeys on the
  map ask the OpenStreetMap community's routing server (FOSSGIS OSRM,
  `lib/routing.ts`), falling back to a straight line.
- **Local figures are never estimated** (2026-10-24): a city version of a
  country figure only where a source reports or counts it for the place
  or its region; otherwise "No data" in the city block, the country figure
  in the country block. The plan, country by country:
  https://claude.ai/artifact/D3ofpbjU5YYR3b42w7sXbm (phase 1 done; phases
  2-3: Europe + US, then other data-rich countries).
- **May earn money one day** (2026-10-24): no non-commercial-only sources,
  except Ookla's speeds until it actually does.
- "No loading time": pages read small static files; nothing waits on a
  server function.
- Only real, sourced data. A field with no value for a place is hidden,
  never filled with a made-up default. Estimates are labelled as estimates.
- UI conventions requested over time: values have at most 1 decimal; city
  block before country block; descriptive facts in grey, good/bad metrics
  coloured green/amber/red; labels truncate to one line with hover text.

## Architecture (2026-10-27)

```
pipeline/ (offline, monthly GitHub Action)
   free bulk sources -> ~/.piltri-pipeline-cache -> dataset v<schema>/<version>/bundle.json.gz.<n> (in pieces under 50 MB)
   -> Supabase Storage bucket "piltri-data" (public) + v<schema>/manifest.json
site build (Vercel; scripts/sync-dataset.mjs via prebuild/predev)
   -> public/data/<version>/...  (static, immutable-cached on Vercel's CDN)
   -> lib/dataset/meta.generated.json (manifest bundled into the JS)
browser
   lib/dataset/cities.ts   city page = countries.json + one ~250-city chunk
   lib/dataset/search.ts   search = one per-letter index file
   lib/dataset/pin.ts      pin mode = the 5°x5° point tiles around the pin
   lib/advancedSearch/engine.ts  filters all cities from column files
```

- Shared format: `lib/dataset/schema.ts` (bump `DATASET_SCHEMA_VERSION` when
  fields/layout change - each schema version publishes under its own
  `v<N>/` prefix so the live site keeps working until new code deploys).
- Score maths and page data shape: `lib/dataset/assemble.ts` (runs in the
  pipeline for ranks and in the browser for pages).
- What each panel shows: `lib/kpiRows.ts`. Filters: `lib/advancedSearch/criteria.ts`
  (the pipeline publishes a column per city-varying criterion automatically).
- Server code left: `/api/explore/resource-links` (Supabase table) and
  `/api/admin/*`. Maps: MapLibre GL **v4** + OpenFreeMap (v5 ships an ESM
  worker Next 14 can't resolve).

## Fields and sources

See `pipeline/README.md` for the full table. Highlights and decisions:

- **Amenities** = Overture places within 5 km of the centre per resident of
  those 5 km, log-scale scored (`AMENITY_RATIOS`).
- **Transport**: metro = subway/monorail line or station within 5 km; tram =
  tram/light-rail track within 5 km (Overture transportation = OSM rail);
  train/bus/airport from GeoNames + Overture. Pin-mode station names come
  from GeoNames only (Overture's category includes kiosks).
- **Beach** = a mapped beach (GeoNames, OpenStreetMap via Overture) within
  1 km of the sea coast with open water beside it; a **lake beach** is its
  own figure; river and estuary banks count as neither. **Mountain** =
  1,000 m+ peak rising 500 m+ above the city.
- **Airports**: nearest international and nearest local airport with
  scheduled flights (OurAirports).
- **Local figures (phase 1, 2026-10-24)**: median age and population growth
  within 5 km (WorldPop, GHS-POP), nearest hospital (Overture), armed
  conflict within 50 km (UCDP GED), regional GDP per head as reported
  (Kummu et al., 2018+). Rows appear only when the dataset's manifest has
  the source (`hasSource` in `lib/kpiRows.ts`); a failing source is left
  out of that month's dataset (`optional` in `pipeline/build.ts`). Not
  scored yet.
- **Climate**: WorldClim normals incl. monthly highs/lows/rain (climate
  chart), summer high / winter low; climate type from Beck et al.'s
  published Köppen maps (today + projected 2071-2099, SSP2-4.5); sunshine, snowfall and **UV** (NASA
  POWER, converted to noon peak, includes cloud) are disclosed estimates.
- **Air pollution**: ACAG satellite PM2.5 (2024) - **counts in the
  Environment score** (5 µg/m³ scores 100, 50+ scores 0).
- **Density** = people within 5 km / 78.5 km² (GHS-POP 2025). City land area
  isn't shown (no free city boundaries).
- **Internet**: Ookla fixed + mobile download speeds within 5 km, widened
  to 15/30 km where there are under 30 tests (radius stored and shown).
- **Nearest large city** (500k+), distances to capital/airport/station,
  time zone (GeoNames; UTC offset computed in the browser), currency.
- Country-level: World Bank (economy, safety, demographics, life expectancy,
  internet use, PISA), WHO UHC (healthcare), ND-GAIN, UN median age.
- **Licences**: all open; credited publicly at /sources. Only Ookla
  is non-commercial - build with `PIPELINE_COMMERCIAL=1` to drop it. WHO
  data is CC BY 4.0.
- **Shortlist hygiene**: duplicate names resolved to the largest entry whose
  point is a town; ~240 "places" with no town at their point are left out (see
  pipeline/README.md "Data-quality rules").
- **Air pollution** counts in the Environment score; small island nations
  outside the satellite map use WHO's labelled national estimate.

## Where things live

- **To-do list**: `BACKLOG.md` - the owner's requests and planned work, in
  order (map fixes, accounts, data phases, the move to Cloudflare).
- **Search engines**: `public/robots.txt`; the sitemap (`/sitemap.xml` +
  `/sitemaps/*.xml`, every place and country) is written from the dataset
  by `scripts/sync-dataset.mjs` at each build; city and country pages set
  their own title, description and canonical address (`lib/pageMeta.ts`).
- **Local folder**: `C:\Users\user\dev\piltri` (moved out of OneDrive; the
  old OneDrive copy is out of date - Claude sessions still open there, for
  their saved memory). The pipeline cache is deliberately outside
  (`~/.piltri-pipeline-cache`, ~15 GB with WorldPop's age grids).
- **GitHub**: `https://github.com/Kevin1989-create/piltri`, branch `main`;
  Vercel deploys every push.
- **Live**: `https://www.piltri.me` (apex redirects to www; DNS at
  Hostinger) and `https://piltri.vercel.app`.
- **Secrets**: `.env.local` (never commit): `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`. Admin API calls from scripts:
  `Authorization: Bearer <ADMIN_PASSWORD>` against `https://www.piltri.me`
  (the apex redirect drops the header).
- GitHub Actions secrets needed for the monthly refresh:
  `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `VERCEL_DEPLOY_HOOK_URL`.

## Working on it

- `npm run dev` (installs the current dataset first), `npm run build`,
  `npm run typecheck`.
- Test an unpublished dataset: `DATASET_DIR=<pipeline out dir> npm run dev`.
- Rebuild data: `npm run pipeline` (first run downloads ~15 GB and extracts
  Overture from S3 - hours; later runs reuse the cache). Pin
  `OVERTURE_RELEASE=<release>` to reuse a local extract instead of
  re-extracting a newer release.
- Commits end with `Co-Authored-By: Claude ...`; never force-push.
