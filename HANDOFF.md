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
  to 10 places). Tapping a Yes or a distance shows it on the map: every
  place for a Yes, the road journey for a distance, with an "Open in
  Google Maps" link. The old pin mode is switched off (`PIN_MODE`).
- **Map motion** (2026-11-07, owner: "align strictly", "super super
  smooth"): the expand, layer-list and spot buttons expand the map the
  same way on every device - one camera move framing the place
  (`frameHome` in MapView), and back to the view from before on the way
  out; the camera, the phone's map box and the panels share one pace and
  curve (`lib/motion.ts`). Never start a second camera move for the same
  change: two at once restart each other (the old jolts). Phone sections
  and the desktop section panel fold and glide (`components/ui/Collapse`).
  A phone on its side (`land:` variant in tailwind.config.ts) gets a
  one-row top bar and the layer list as a strip along the top of the map;
  upright, the list sits along the top too, as chips (2026-11-08).
  A phone's map opens and closes as a curtain (2026-11-08, owner): the
  page keeps the map's slot in place, the clip's bottom edge moves, the
  camera holds the place in the open part with bottom padding
  (`collapseTo`), the buttons glide between their two layouts and the
  locator rides the curtain's edge (`runCurtain`).
- **Launch splash** (2026-11-08, owner): the installed app opens on the
  animated wordmark and "Find your Piltri" (~2 s, a tap skips it) -
  `components/ui/LaunchSplash.tsx`, CSS in globals.css; `?splash=1` shows
  it in a browser. Android draws its own launch screen first (the icon on
  the cream) and no page can remove it, so the splash starts on that same
  amber disc and P, and the P becomes the wordmark's first letter.
- **Basemap** (2026-11-08, owner: "more contrast and details ... like
  Google Maps"): less muted (`lib/mapColors.ts`), a clear road hierarchy
  and shopping/business districts in peach (`emphasizeStreets`).
- **The spot's card** frames the place and the spot in the room it leaves
  (above it on a phone, beside it on a computer); the place's framing
  comes back when it closes. Changing city closes a figure's places and
  forgets the view from before expanding.
- **Opening view** (2026-11-07, owner): on a computer the place is framed
  in the room right of the score column (room is no longer kept for a
  section panel - the map glides across when one opens, `sidePanelOpen`),
  so you see inside it; a locator in the corner shows the country with
  the place as a pulsing dot (`CountryLocator.tsx`; tap: the whole
  country, and back). Silhouettes: `public/geo/countries/<CC>.json`, from
  Natural Earth (public domain) by `scripts/build-country-shapes.mjs` -
  run by hand and committed; parts far apart are separate clusters
  (mainland France / Réunion...), and GeoNames territories Natural Earth
  folds into another country get the cluster their largest town is in.
- **Saved and accounts** (2026-11-08, owner): a heart beside a city's
  name saves the place, Save on a spot's card saves the spot (the same
  heart); `/saved` shows them on a globe (`components/saved/SavedGlobe.tsx`,
  d3-geo on a canvas, land from `public/geo/world.json`) or as a list
  filtered by kind, country and name. Kept in the browser, and in the
  account once signed in: Supabase Auth by email link, table `saved_items`
  with row-level security (`supabase/saved-items.sql`), kept in step by
  `lib/account.ts` (first sign-in on a browser merges, then the account is
  the truth; sign-out clears the browser's copy). `/privacy`; "Delete my
  account" (`/api/account/delete`). Switched on by
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` - see BACKLOG for the owner's steps.
- **Spots** (2026-10-31, owner): on the expanded map, drop a spot (the
  pin button under the layer list's): its card lists the centre and the
  nearest station, school, hospital... from the city's own lists; tapping
  a line draws the journey by road; a second spot gives the journey
  between them. Those nearest places are on the map too (icon, what, how
  far, a fine line; tapping one picks its journey), and while the spot is
  on, any tap on the map moves it there - the pin glides, the card
  updates in place (2026-11-07, owner). Saved in the browser (`lib/spots.ts`, shown on the map and
  under "Your spots" in the layer list) and shared by link
  (`/city?id=…&spot=lat,lng&to=lat,lng`, which opens on the expanded map).
  `components/explore/SpotCard.tsx`; accounts come next (BACKLOG).
- **Advanced search** (`/search`): one page of plain choices, live results,
  each result's list position and "#N overall"; a country's figures at
  `/country?code=FR`.
- **Leaderboards** (`/leaderboards`): 12 rankings, top 10, by region,
  population size and places per country. At the default score settings
  the page reads `leaderboards/<region>.json`, worked out by the pipeline
  with the same code (`precomputeLeaderboards` in `lib/leaderboards.ts`,
  2026-11-07: it used to download every place's figures, 2-3 s); with
  custom settings the browser works them out.
- Every page address is listed in `lib/urls.ts`; the older `/explore/...`
  addresses redirect (next.config.js).
- **/admin** (password): dataset status and the Resources links editor.

## Constraints (from the owner)

- **Zero running cost, no live third-party data calls.** New data goes
  through the offline pipeline from free bulk sources; never a runtime API
  or a paid tier. Two approved exceptions: road journeys on the map ask
  the OpenStreetMap community's routing server (2026-10-16; FOSSGIS OSRM,
  `lib/routing.ts`), falling back to a straight line; and the map's
  address search asks Photon, Komoot's free search over OpenStreetMap
  (2026-11-11; `lib/geocode.ts`), only after a pause in typing - when it
  doesn't answer, the box says so.
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
   -> its files on Cloudflare Pages, project piltri-data (scripts/stage-data-site.mjs;
      the live version kept next to the new one) - since 2026-11-13
   -> Supabase Storage bucket "piltri-data" (public) + v<schema>/manifest.json (the switch)
site build (Vercel; scripts/sync-dataset.mjs via prebuild/predev)
   -> lib/dataset/meta.generated.json (manifest bundled into the JS) + sitemaps
   -> the browser reads the files from NEXT_PUBLIC_DATA_URL (Cloudflare Pages,
      immutable-cached), so a Vercel deploy is a few MB, not ~350 MB; unset
      (local development), they're copied into public/data/<version>/
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
  tram/light-rail track within 5 km (Overture transportation = OSM rail).
  Stations and stops since 2026-11-08 come from OpenStreetMap's own tags
  (via Overture's base theme, `extractOvertureTransit`): Overture's places
  had a tram stop as Olivet's train station and no tram stops at all.
  Airports from OurAirports/GeoNames. Pin-mode station names come
  from GeoNames only (Overture's category includes kiosks).
- **Beach** = a mapped beach (GeoNames, OpenStreetMap via Overture) within
  1 km of the sea coast with open water beside it; a **lake beach** is its
  own figure; river and estuary banks count as neither. **Mountain** =
  1,000 m+ peak rising 500 m+ above the city.
- **Airports**: nearest international and nearest local airport with
  scheduled flights (OurAirports); "in the city" for airports means within
  80 km of the centre (2026-10-30, owner: London's Gatwick, Luton...).
- **Nearness tiers** (2026-10-30, owner): beaches, mountains, forests and
  airports are green/amber/red by distance (`NEARNESS` in
  `lib/dataset/assemble.ts`) and count in the score.
- **Is there one in the city?** (2026-10-29): stations, schools, hospitals,
  airports, beaches... - Yes if one is in the city's outline or within
  1 km of it (5 km of the centre without an outline), and tapping it shows
  every one (dataset `inside/`, `pipeline/insidePlaces.ts`); No with the
  distance to the nearest and its journey. The older hasX fields (within
  5 km) still drive Advanced search and the ghost check.
- **On the map**: a layer list shows any kinds at once - within 5 km of
  the centre zoomed out (read from OpenFreeMap's zoom-14 tiles,
  `lib/mapPlaces.ts`), every one in view from zoom 14 (the tiles' own).
  Datasets before 2026-10-29: a Yes also reads the tiles. Icons per kind:
  `components/explore/mapIcons.ts` (colours brightened to survive the map
  canvas's desaturation filter).
- **Local figures (phase 1, 2026-10-24)**: median age and population growth
  within 5 km (WorldPop, GHS-POP), nearest hospital (Overture), armed
  conflict within 50 km (UCDP GED). Rows appear only when the dataset's
  manifest has the source (`hasSource` in `lib/kpiRows.ts`); a failing
  source is left out of that month's dataset (`optional` in
  `pipeline/build.ts`). Regional GDP per head (Kummu et al.) was switched
  off on 2026-10-30 (owner): 2018-2021 figures for whole regions, counted
  where people work - local household income comes in phase 2.
- **Score, as local as the data allows** (2026-10-30, owner): Environment
  is all local, with nature nearby (beach, mountain, forest) since
  2026-10-30 and its river basin's water since 2026-11-07; Safety adds armed conflict nearby to the country's three
  figures; Quality of Life adds healthcare access (a hospital in the city,
  else by distance), everyday services (train station, bus station,
  school, nursery in the city) and an international airport within reach
  to its four local and two country figures.
  Economy stays national until phase 2 (`sectionInputs` in
  `lib/dataset/assemble.ts`); inflation joined it on 2026-11-06 (owner:
  closest to 2% a year is best, RANGES.inflation). World ranks are
  computed by the refresh.
- **Climate**: TerraClimate 1991-2020 averages (since 2026-11-13;
  WorldClim 1970-2000 before) incl. monthly highs/lows/rain (climate
  chart), summer high / winter low - from a committed table
  (`pipeline/static/terraclimate-1991-2020.bin.gz`, rebuilt only by
  `scripts/build-climate-normals.mts`); the site's "1991-2020" wording
  follows the dataset's source line (`lib/climateSource.ts`); climate type from Beck et al.'s
  published Köppen maps (today + projected 2071-2099, SSP2-4.5); sunshine, snowfall and **UV** (NASA
  POWER, converted to noon peak, includes cloud) are disclosed estimates.
- **Air pollution**: ACAG satellite PM2.5 (2024) - **counts in the
  Environment score** (5 µg/m³ scores 100, 50+ scores 0).
- **Water** (2026-11-07, owner): water stress (share of the renewed water
  used) and the groundwater trend, from WRI Aqueduct 4.0 - **for the
  river basin** (cut by province and aquifer, median ~370 km²), not the
  town alone; the rows say "For its river basin". Both count in the
  Environment score as one figure, the worse of the two (`waterScore` in
  `lib/dataset/assemble.ts`: a stable water table, four places in five,
  shouldn't lift a score on its own); "Plenty of water" in Advanced search;
  "water stress" on Compare.
- **Density** = people within 5 km / 78.5 km² (GHS-POP 2025). City land area
  isn't shown (no free city boundaries).
- **Internet**: Ookla fixed + mobile download speeds within 5 km, widened
  to 15/30 km where there are under 30 tests (radius stored and shown).
- **Nearest large city** (500k+), distances to capital/airport/station,
  time zone (GeoNames; UTC offset computed in the browser), currency.
- Country-level: World Bank (economy incl. inflation, safety, demographics,
  life expectancy, internet use, PISA), WHO UHC (healthcare), ND-GAIN, UN
  median age. Trade balance was considered and left out (2026-11-06): a
  surplus or deficit isn't good or bad in itself.
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
