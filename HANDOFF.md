# Piltri — project handoff (for Claude Code)

This file exists so a new Claude Code session in this folder has full context
without re-deriving it. Read this first, then check `README.md`,
`DEPLOYMENT.md`, and `KNOWN-ISSUES.md` for more detail on specific areas.

## What Piltri is

A Next.js app for comparing cities and countries on a weighted "Piltri
Score" across 4 sections (Safety & Stability, Economy, Climate,
Liveability), aggregated from live public data sources. Demographics is
shown as supplementary info, not scored. **Real Estate is deliberately not
part of the scored model** — see "Data model, and why it's 4 sections not
5" below; it shows in the UI as "Coming soon".

Two ways to use it:
- **Explore** (`/explore`): search one city, see its full score breakdown,
  drop a pin anywhere for point-specific distances (Beach, Mountain, Train
  station, Airport), download a PDF-style report.
- **Advanced search** (`/explore/discover`): filter across ~500 shortlisted
  cities (or roll results up to country level) on any criterion, get a
  photo-forward results grid with list/map toggle, sorting, and pagination
  (`/explore/discover/results`). Clicking a result opens a full report in a
  new tab (`/explore/report` for cities, `/explore/country-report` for
  countries).

## Stack

Next.js 14 (App Router), TypeScript, Tailwind CSS, Mapbox GL JS, Supabase
(Postgres + service-role client for server-side caching).

## Where everything lives

- **Local folder**: `C:\Users\user\OneDrive\Piltri\piltri` — this is
  **OneDrive-synced**. That has caused real problems: OneDrive can lock
  files mid-write, which breaks `git` (partial `.git/objects` writes) and
  `.next` cache deletion. If a destructive operation (git init, rm -rf,
  large file writes) fails with "Operation not permitted" on random files,
  that's OneDrive sync contention, not a real permissions bug — retry, or
  pause OneDrive sync first.
- **GitHub**: `https://github.com/Kevin1989-create/piltri`, branch `main`.
  Vercel auto-deploys on every push to `main`.
- **Live site**: `https://piltri.me` (custom domain, DNS at Hostinger —
  apex A record to `216.198.79.1`, `www` CNAME to Vercel's per-project
  target) and `https://piltri.vercel.app` (Vercel's own domain, also live).
- **Vercel project**: `piltri` under the `piltri` team/account. Env vars
  (Supabase URL/anon/service-role keys, Mapbox token, `CACHE_TTL_DAYS=30`)
  are set in Vercel's dashboard under Settings → Environment Variables —
  mirror `.env.local` if you need to check exact values.
- **Supabase**: project already provisioned, schema applied
  (`lib/supabase/schema.sql` — note the `pg_trgm` extension must be created
  *before* the trigram index, that ordering bug was already fixed once).
  Real keys are in `.env.local` (gitignored, never commit) and in Vercel.
  `city_scores.data` is a `jsonb` blob of the full `CityExploreData` shape —
  no migration is ever needed when that shape changes, but the cache **must
  be cleared** (see below) whenever it does, since the TTL-based freshness
  check has no way to detect a shape change on its own.

## Data model, and why it's 4 sections not 5 (2026-09-20 simplification)

The original 5-section model (Safety & Stability, Economy, Real Estate,
Climate, Liveability) had two sections — **Safety & Stability and Real
Estate — that were 100% fabricated**: every field in them was a hardcoded
constant in a now-deleted `lib/data-sources/manual-sources.ts` (fixed
`criminalityScore: 50`, `pricePerM2BuyGbp: 3000`, etc.), not real data from
anywhere. Several other fields elsewhere were fake too (cost of living,
school quality, English proficiency, public transport, 3 of Climate's 7
fields) — those got cut as well, in favour of a smaller model where
**everything that's still there is genuinely real**.

What changed:
- **Safety & Stability** is now real: World Bank Worldwide Governance
  Indicators — `politicalStabilityScore` (`GOV_WGI_PV.SC`) and
  `ruleOfLawScore` (`GOV_WGI_RL.SC`), both already published on a 0-100
  scale, free and keyless via the same World Bank API already used
  elsewhere (indicator codes live under WB source id 3 — the generic
  `/v2/country/.../indicator/{code}` endpoint needs no special params, but
  note codes for this dataset are prefixed `GOV_WGI_*`, not the shorter
  `PV.EST`-style codes some WB docs reference — those returned empty when
  tested). `safetyTrend` is derived from Political Stability's own 5-year
  trend, not a separate placeholder (±5% swing = Improving/Worsening).
- **Economy's cost-of-living** is now real: World Bank's Price Level Index
  for household consumption (`PA.NUS.PRVT.PLI`) — verified against known
  cases (Switzerland ~127, Portugal ~60, India ~23).
- **Real Estate** (purchase price, rent, price trend) has **no reliable
  free global source** — Global Property Guide has no API, Numbeo would
  cover it but is paid (~$99/mo). Rather than fabricate numbers, it's
  removed from `SectionKey`/`SectionScores` entirely and shown as a static,
  non-interactive "Coming soon" row (`components/explore/SectionColumn.tsx`)
  — same visual treatment the home page already uses for Assess/Invest.
  `RealEstateFields` is kept, unused, in `lib/types.ts` for exactly the day
  a real per-city source gets wired in — see that file's header comment for
  the reactivation steps.
- **Climate** dropped 3 fake fields (natural disaster risk, sea level rise,
  extreme weather — all were fixed constants) and folded its 3 already-real
  Open-Meteo fields (rainfall, sunshine, snowfall) into the actual score
  alongside temperature, instead of only displaying them.
- **Liveability** dropped school quality and public transport score (both
  fake); everything else in it was already real (Overpass, Wikidata, WHO)
  and is unchanged.
- **SECTION_WEIGHTS** rebalanced from 25/20/20/20/15 (Safety/Economy/
  RealEstate/Climate/Liveability) to 30/25/25/20 (Safety/Economy/Climate/
  Liveability) — the old Real Estate weight was redistributed
  proportionally.
- **Pin mode** trimmed from 13 fields (school, nursery, university, train,
  subway, tramway, high street, domestic + international airport
  separately, beach, park, hospital, elderly care) down to 4: **Beach,
  Mountain (new), Train station, Airport** (domestic + international
  merged — they were querying the identical OSM tag twice, a pre-existing
  redundancy). This directly addresses KNOWN-ISSUES.md's #1 performance
  item. `PinnedLocationData` in `lib/types.ts` is now flat (no more
  `education`/`transport`/`natureAndHealth` nesting).
- Advanced search's criteria registry (`lib/advancedSearch/criteria.ts`)
  and the printable report pages were trimmed/relabelled to match — no
  "Real Estate" category exists there any more.

**If you're about to add a new scored field**: only wire in something with
a real, free (or already-paid-for), globally-covering source — that's the
whole point of this simplification. If you can't find one, it's fine for a
section to just not have that field; don't reach for a placeholder
constant again.

### After changing CityExploreData's shape — clear the cache

`lib/aggregation/cache.ts`'s freshness check is purely TTL-based (is this
row younger than `CACHE_TTL_DAYS`?) — it has no way to know the *shape* of
`CityExploreData` changed, so an old-shaped-but-still-"fresh" cached row
will keep being served as-is (showing `undefined` for any renamed/new
field) until its TTL happens to expire naturally. Whenever you change a
field name or the overall shape, run:

```bash
curl -X POST https://piltri.me/api/admin/clear-cache   # or your preview URL
curl -X POST https://piltri.me/api/admin/warm-cache     # repopulates with real data, several minutes on ~500 cities
```

`clear-cache` only deletes `city_scores` rows (never `cities`, which is
harmless metadata) — everything is re-derivable, nothing is a source of
truth there. Both endpoints have no auth (same as the other `/api/admin/*`
routes) — fine while this stays effectively private, add a shared-secret
header check before they could be publicly discovered.

## Current data state — read this before doing anything data-related

The cache was cleared and partially re-warmed (Lisbon only, verified
correct) at the end of the 2026-09-20 session — **run `warm-cache` again
before treating the live site's scores as fully real**, since most of the
~500-city shortlist still needs a fresh aggregation pass under the new
data shape.

Both `/api/admin/seed-random-data` and `/api/admin/warm-cache` (and the new
`/api/admin/clear-cache`) have **no auth** — fine while this stays
effectively private, but add a shared-secret header check before any could
be publicly discovered and hit by someone else.

## Known, disclosed gaps (not bugs — already decided/accepted trade-offs)

- **Nearby/pin data isn't Supabase-persisted** — `getOrAggregatePinDataForCity`
  (powers the "Distance from city centre" Advanced search category) is
  in-memory-only and resets every deploy/restart. A search using any Nearby
  filter will always pay the live cost the first time after a restart. Much
  less of a concern now that pin mode is 4 fields instead of 13, but still
  a known gap.
- **Cold cache is still slow.** The "5s max" search target only holds once
  the relevant cities are warm in Supabase. A brand-new city, or the very
  first search after cache entries expire (30-day TTL), pays full live
  aggregation cost.
- Real Estate is entirely absent from the scored model — see "Data model"
  above. It's a disclosed, deliberate gap, not a bug, until a real per-city
  pricing source is wired in.

## Workflow discipline this project has followed

Every file touched should be verified before considering the work done:

```bash
python3 -c "data = open('PATH','rb').read(); print(len(data), data.count(b'\x00'))"
npx --no-install tsc --noEmit -p tsconfig.json
```

The first catches truncated/corrupted writes (should show 0 null bytes) —
note `python3` isn't installed in this environment as of 2026-09-20; `tsc`
is the practical substitute (it will fail loudly on a truncated/corrupted
file, just less directly). The second should exit clean with zero output.
Do this for every touched file before saying a change is complete — this
caught real bugs earlier in the project's history (a `pg_trgm`
extension-ordering bug in `schema.sql`, among others).

## Recent major work (most recent session, 2026-09-20)

- **Made the whole site responsive** (mobile/tablet, was desktop-only).
  The Explore results page's desktop absolute-overlay layout (map behind a
  floating score panel + pin bar) now switches to a stacked mobile layout
  below the `md` breakpoint via `lib/useMediaQuery.ts` — map on top at a
  fixed height, score card and pin details in normal document flow below
  it, section detail reusing `SectionColumn`'s existing inline accordion
  instead of the desktop-only side panel. `NavBar` collapses to two rows.
  `MapView` got a `compact` prop so its fitBounds padding doesn't waste
  space accounting for a floating desktop panel that isn't there on mobile.
- **Simplified the data model and pin mode to be fully honest** — see the
  "Data model" section above. This was the bigger of the two changes.

## Getting oriented fast

Start with `lib/types.ts` (the whole data model — read its file header
comment first), `lib/aggregation/aggregate.ts` (the real data-fetching
orchestration — every field's source is named directly in comments there),
`lib/advancedSearch/criteria.ts` (every filterable criterion, its ranges,
and per-scope overrides), and `app/api/explore/discover/route.ts` (the
Advanced search matching engine). `lib/aggregation/cache.ts` is the
caching layer — see "After changing CityExploreData's shape" above before
you touch it.
