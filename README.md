# Piltri — Explore

Next.js / Supabase / Vercel / Mapbox implementation of Piltri's Explore
section, per `piltri-project-brief.md` and `piltri-project-checklist.md`.

## What's here

- **Design system** (`tailwind.config.ts`, `lib/design-tokens.ts`,
  `components/ui/*`) — brand colours, Playfair Display wordmark, buttons,
  cards, score badges, search bar with the locked suggestion behaviour.
- **Backend** (`app/api/explore/*`, `lib/aggregation/*`,
  `lib/data-sources/*`) — search, score aggregation, and pin-mode endpoints;
  a Supabase caching layer; adapters for World Bank, REST Countries,
  Open-Meteo, Overpass/OSM, Mapbox, and WHO (all free/keyless), plus
  clearly-flagged placeholder adapters for the 6 sources that need manual
  setup (see "Data sources still to wire up" below).
- **Frontend** (`app/page.tsx`, `app/explore/*`) — Home, Explore landing,
  Explore results (map + 6 section cards), and Pin mode overlay, matching
  the locked page designs.
- **Database** (`lib/supabase/schema.sql`) — `cities`, `city_scores`,
  `saved_pins` tables with RLS.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in the values — see DEPLOYMENT.md
npm run dev
```

Open http://localhost:3000.

## Data sources still to wire up (Phase 3.1)

These fields ship with clearly-flagged placeholder values
(`lib/data-sources/manual-sources.ts`) because their source has no simple,
free, keyless API:

| Field(s) | Source | What's needed |
|---|---|---|
| Criminality score/trend, geopolitical tension | UNODC | Import a published crime dataset |
| Real estate price/rent/trend | Global Property Guide | Register for access, or licence data |
| Cost of living index | Expatistan | No public API — manual entry (Numbeo is the paid upgrade path, ~$99/mo, post-launch) |
| Natural disaster risk | UNDRR | Register for INFORM Risk Index access |
| Sea level rise exposure | NASA / Climate Central | Register for a NASA API key |
| Extreme weather risk | EM-DAT | Register for export access |
| School quality | PISA / UNESCO | Import latest published country scores into `data/static/pisa-scores.json` |
| English proficiency | EF EPI | Transcribe latest annual report into `data/static/ef-epi.json` |
| Public transport score | Moovit / GTFS | Needs per-city GTFS feed integration |

None of these block running the app — Explore works end-to-end today with
neutral placeholder scores for these fields, clearly marked in the code.

## Project structure

```
app/                  Next.js App Router pages + API routes
components/ui/        Design system — brand-agnostic building blocks
components/explore/   Explore-specific composed components
lib/data-sources/     One adapter per external API
lib/aggregation/      Scoring, orchestration, Supabase caching
lib/supabase/         Client + schema.sql
data/static/          Manually-sourced datasets (Phase 3.1)
```

See `DEPLOYMENT.md` for taking this to production on piltri.me.
