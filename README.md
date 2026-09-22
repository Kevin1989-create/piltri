# Piltri — Explore

Next.js / Supabase / Vercel / Mapbox implementation of Piltri's Explore
section, per `piltri-project-brief.md` and `piltri-project-checklist.md`.

## What's here

- **Design system** (`tailwind.config.ts`, `lib/design-tokens.ts`,
  `components/ui/*`) — brand colours, Playfair Display wordmark, buttons,
  cards, score badges, search bar with the locked suggestion behaviour.
- **Backend** (`app/api/explore/*`, `lib/aggregation/*`,
  `lib/data-sources/*`) — search, score aggregation, and pin-mode endpoints;
  a Supabase caching layer; adapters for World Bank (including governance,
  price-level, and land-area indicators), UN Population Division (country
  median age), GeoNames (country languages), Open-Meteo, Overpass/OSM,
  Wikidata (city-level population/area), Mapbox, and WHO — all
  free/keyless, and every field in the scored model is backed by one of
  them today. Demographics shows country-level and city-level figures
  separately rather than blending them — see HANDOFF.md's "Demographics
  split into Country vs City" section. No placeholder/manual data sources
  remain — see HANDOFF.md's "Data model" section for what changed and why.
- **Frontend** (`app/page.tsx`, `app/explore/*`) — Home, Explore landing,
  Explore results (map + 4 section cards), and Pin mode overlay, responsive
  from phone to desktop.
- **Database** (`lib/supabase/schema.sql`) — `cities`, `city_scores`,
  `saved_pins` tables with RLS.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in the values — see DEPLOYMENT.md
npm run dev
```

Open http://localhost:3000.

## Project structure

```
app/                  Next.js App Router pages + API routes
components/ui/        Design system — brand-agnostic building blocks
components/explore/   Explore-specific composed components
lib/data-sources/     One adapter per external API
lib/aggregation/      Scoring, orchestration, Supabase caching
lib/supabase/         Client + schema.sql
data/static/          Real shortlist data (discover-cities.json)
```

See `DEPLOYMENT.md` for taking this to production on piltri.me, and
HANDOFF.md for full context on the current data model.
