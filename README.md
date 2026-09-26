# Piltri — Explore

Compare cities and countries on a weighted Piltri Score (Safety, Economy,
Environment, Quality of Life) for ~66,000 cities in 245 countries.

## How it works

- **Data** is computed offline by `pipeline/` from free bulk sources
  (GeoNames, World Bank, WHO, WorldClim, NASA POWER, satellite PM2.5, GHS-POP,
  Ookla, Overture Maps, Natural Earth, USGS) and published as a versioned
  bundle to Supabase Storage. See `pipeline/README.md`.
- **The site** (Next.js, Vercel) copies the current dataset into
  `public/data/<version>/` at build time and serves it from its own CDN.
  Everything - city pages, search, pin mode, Advanced Search - reads those
  static files **in the browser**; there's no server-side data code and no
  third-party API call when a page loads.
- **Maps**: MapLibre GL + OpenFreeMap tiles (free, no key).
- **Database**: only the curated Resources links (`lib/supabase/schema.sql`).

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in the values - see DEPLOYMENT.md
npm run dev                  # downloads the current dataset first (predev)
```

Open http://localhost:3000.

## Project structure

```
app/                  Pages; app/api/ only has Resources links + /admin
components/ui/        Design system building blocks
components/explore/   Explore pages' components (map, panels, charts)
lib/dataset/          Dataset schema (shared with the pipeline), browser loaders,
                      score assembly, search, pin mode
lib/advancedSearch/   Criteria registry + in-browser search engine
lib/kpiRows.ts        What each section panel shows
pipeline/             Offline data pipeline (npm run pipeline)
scripts/              sync-dataset.mjs - installs the dataset before dev/build
```

See `DEPLOYMENT.md` for production setup and `HANDOFF.md` for history and
design decisions.
