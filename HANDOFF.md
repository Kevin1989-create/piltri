# Piltri — project handoff (for Claude Code)

This file exists so a new Claude Code session in this folder has full context
without re-deriving it. Read this first, then check `README.md`,
`DEPLOYMENT.md`, and `KNOWN-ISSUES.md` for more detail on specific areas.

## What Piltri is

A Next.js app for comparing cities and countries on a weighted "Piltri
Score" across 4 sections (Safety & Stability, Economy, Climate,
Liveability), aggregated from live public data sources. Demographics is
shown as supplementary info, not scored. **There is no Real Estate
section anywhere in the app** — not scored, and (as of 2026-09-20, later
same session as the rest of "Data model" below) no "Coming soon"
placeholder either, on request: no reliable free pricing source exists,
and a permanent placeholder wasn't earning its place. See "Data model,
and why it's 4 sections not 5" below.

Two ways to use it:
- **Explore** (`/explore`): search one city, see its full score breakdown,
  drop a pin anywhere for point-specific distances (Beach, Mountain, Train
  station, Airport), download a PDF-style report. Not limited to the
  shortlist below — this uses Mapbox geocoding, so any place on Earth works.
- **Advanced search** (`/explore/discover`): filter across the ~6,300-city
  shortlist (or roll results up to country level) on any criterion, get a
  photo-forward results grid with list/map toggle, sorting, and pagination
  (`/explore/discover/results`). Clicking a result opens a full report in a
  new tab (`/explore/report` for cities, `/explore/country-report` for
  countries).

A `/admin` back-office page (password-gated, see "Scaling the data
pipeline" below) shows city-data coverage and can trigger a manual cache
refresh.

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
  (Supabase URL/anon/service-role keys, Mapbox token, `CACHE_TTL_DAYS=30`,
  and as of 2026-09-20 also `CRON_SECRET` and `ADMIN_PASSWORD` — see
  "Scaling the data pipeline" below) are set in Vercel's dashboard under
  Settings → Environment Variables — mirror `.env.local` if you need to
  check exact values. **`CRON_SECRET`/`ADMIN_PASSWORD` were generated
  locally and added to `.env.local` but still need adding to Vercel's env
  vars for the scheduled cron and `/admin` page to work in production** —
  see that section for the actual values.
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
  removed from `SectionKey`/`SectionScores` entirely. It initially shipped
  with a static, non-interactive "Coming soon" row instead
  (`components/explore/SectionColumn.tsx`) and a matching `RealEstateFields`
  type kept unused in `lib/types.ts` — **both were removed later the same
  day** (user's call: not worth a permanent placeholder "until we have
  more visibility"). There is currently no trace of Real Estate left in
  the UI or types at all; re-add a `SectionKey`, its own `*Fields`
  interface, and a real per-city price source in
  `lib/aggregation/aggregate.ts` if a real source ever gets wired in.
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

## Scaling the data pipeline (2026-09-20, same-day follow-up)

The shortlist grew from ~500 hand-curated cities to **~6,300** (every
GeoNames city with population ≥ 100,000 — free, public-domain dataset,
`data/static/discover-cities.json`, built via a one-off script, not
committed). This was only safe because of two other changes made
alongside it:

- **Overpass calls dropped from 14 per city to 1.** Every Overpass-sourced
  field (amenity density, transport presence, economy-sector counts) used
  to be a separate HTTP request; `getCityOverpassData` in
  `lib/data-sources/overpass.ts` now combines all 14 into one query using
  named result sets (`->.s0`, `.s0 out count;`, etc.) — Overpass returns
  one count element per `out count`, in order. **This was verified correct
  by testing directly against `overpass.kumi.systems`** (a mirror — see
  below) after the primary instance blocked us mid-testing.
- **World Bank / WHO calls are memoized per country** (`COUNTRY_LEVEL_TTL_MS`
  in `lib/aggregation/aggregate.ts`) — these are country-level, not
  city-level, so hundreds of cities sharing a country no longer repeat an
  identical API call.

**Real incident from this session, worth knowing about**: running the
original 498-city warm-cache job (14 Overpass calls × 498 cities ≈ 7,000
requests in a few minutes) got this project's own IP **temporarily blocked
by Overpass's primary public instance** (`overpass-api.de` returned 406 on
every request, including a plain status check, for over 30 minutes).
Lessons applied:
1. `lib/aggregation/warmCache.ts` paces itself: `CONCURRENCY = 4` cities at
   once, a `600ms` pause between batches — deliberately gentle, not just
   "as fast as possible".
2. `lib/data-sources/overpass.ts` now tries a **second and third public
   Overpass mirror** (`overpass.kumi.systems`, `overpass.openstreetmap.ru`)
   if the primary fails — primary first (normal case: one request, no
   extra load on the mirrors), racing the fallbacks in parallel only if
   primary fails (so one slow mirror ahead of a healthy one can't compound
   the wait). **By the end of this session, the kumi.systems mirror had
   *also* started rate-limiting us (429) from repeated testing** — so even
   with 3 mirrors, don't hammer this during development; a handful of test
   requests is fine, hundreds in a short window is not.
3. **The warm job is deliberately re-runnable with no persisted cursor** —
   every call just asks Supabase "which shortlisted cities aren't fresh
   right now" and processes up to `limit` of them. A cron tick that fails
   or gets rate-limited mid-run costs nothing beyond that run; the next
   scheduled tick just picks up wherever the "still stale" set currently
   stands.

**A real bug this surfaced and fixed**: `getCachedCityDataBatch` in
`lib/aggregation/cache.ts` passed every candidate's slug/id to Supabase's
`.in(...)` filter in one unchunked call. That was fine at ~500 candidates;
at ~6,300 it silently failed (every candidate read back as "not cached"
even for a city aggregated seconds earlier) — Postgrest's `.in()` is
passed via the request URL, and thousands of values in one call risk
exceeding practical size limits. Now chunked at 300 slugs/ids per call
(`IN_CLAUSE_CHUNK_SIZE`). **If you ever see "every city always looks
stale" again, check this first** — it's an easy trap to fall back into if
someone "simplifies" this back to one unchunked query.

### Scheduled warming — cron, not manual curl

- **`warmCache()` (`lib/aggregation/warmCache.ts`) is bounded by wall-clock
  deadline, not a fixed city count.** The first version used a fixed count
  (80 cities/call) and genuinely hit Vercel's 60s function timeout in
  production, returning nothing (a `FUNCTION_INVOCATION_TIMEOUT`) —
  Overpass's real per-request latency varies too much (typical: under a
  second; worst case, racing mirrors: ~12s) for a fixed count to be safe.
  `warmCache({ deadlineMs })` checks the wall clock between batches and
  stops issuing new ones once close to the deadline, so it always returns
  real progress instead of risking total failure. **The deadline check only
  happens *between* batches, not during one** — the real worst-case total
  is `deadlineMs` + one batch's own worst case (~12s) + overhead, which is
  why both routes below use 30s against a 60s ceiling, not something
  closer to 60 (a real test at 45s measured ~56s total — too tight).
- `app/api/cron/warm-cache-tick/route.ts` — calls `warmCache({ deadlineMs:
  30000 })`, sized to comfortably finish inside a serverless function's
  execution window (`maxDuration = 60`). Auth: Vercel automatically sends
  `Authorization: Bearer <CRON_SECRET>` on every real cron invocation.
- `vercel.json` — a `crons` entry firing this daily at 04:00 UTC (Vercel's
  free-tier frequency floor is once/day). How many cities that clears
  depends entirely on how fast Overpass is responding that day — on a good
  day, likely dozens to 100+; on a degraded day, as few as a handful. Not
  literally "quarterly," but self-correcting: every tick just processes
  whatever's still stale, so a slow day doesn't lose progress, just makes
  less of it.
- `app/api/admin/warm-cache/route.ts` — same deadline-bounded call,
  manually triggered, optionally with `?limit=N` to also cap the candidate
  count. **A single call can never sweep the whole ~6,300-city shortlist**
  (same 60s ceiling applies no matter who's calling it) — a genuine full
  sweep means calling this repeatedly until `remaining` reads 0.
- `/admin` — password-gated (see below) back-office page: coverage stats
  (fresh/stale/countries) plus "warm one batch now" (one deadline-bounded
  call, same as a cron tick), "warm everything stale" (loops the same
  call client-side until `remaining` is 0, with a Stop button — this is
  what actually delivers a full sweep, not a single long server request),
  and "clear entire cache". Auth: `POST /api/admin/login {password}` sets
  an httpOnly cookie; every `/api/admin/*` route also accepts
  `Authorization: Bearer <ADMIN_PASSWORD>` directly (for curl/scripts) —
  see `lib/adminAuth.ts`. **Every `/api/admin/*` and `/api/cron/*` route
  is now gated this way** — the earlier "no auth, add a check before this
  is ever public" TODOs are resolved.
- **`CRON_SECRET` / `ADMIN_PASSWORD` were generated locally and have
  already been added to Vercel's production env vars** (done together
  with the user during the 2026-09-20 session) — both confirmed working
  live (`/admin` login and `POST /api/admin/status` with a Bearer token
  both verified against piltri.me). If you need the actual values, check
  `.env.local` or Vercel's dashboard directly rather than assuming — don't
  regenerate them without reason, since that would invalidate the ones
  already configured in Vercel.

### After changing CityExploreData's shape — clear the cache

`lib/aggregation/cache.ts`'s freshness check is purely TTL-based (is this
row younger than `CACHE_TTL_DAYS`?) — it has no way to know the *shape* of
`CityExploreData` changed, so an old-shaped-but-still-"fresh" cached row
will keep being served as-is (showing `undefined` for any renamed/new
field) until its TTL happens to expire naturally. Whenever you change a
field name or the overall shape, run:

```bash
AUTH="Authorization: Bearer $ADMIN_PASSWORD"
curl -X POST -H "$AUTH" https://piltri.me/api/admin/clear-cache
curl -X POST -H "$AUTH" https://piltri.me/api/admin/warm-cache   # unbounded full sweep — can take a long time on ~6,300 cities; pass ?limit=N to bound it
```

`clear-cache` only deletes `city_scores` rows (never `cities`, which is
harmless metadata) — everything is re-derivable, nothing is a source of
truth there. Both endpoints (and every other `/api/admin/*` route) require
`ADMIN_PASSWORD` — see "Scheduled warming" above.

## Sub-second responses (2026-09-20, later same session)

The user's explicit bar: **every search/data view should appear in well
under 1 second, or the structure needs more work.** Measured against the
live site, it didn't — even a cache *hit* took ~950ms server time, and
Advanced search's unfiltered "Search all" across the new ~6,300-city
shortlist didn't finish in 60s at all. Root causes, all fixed:

1. **`getOrAggregateCityData` unconditionally UPSERTed the `cities` table
   on every single request** — a write, with real latency cost, even for
   a city that was already fully cached. It now does ONE read (`city_scores`
   joined to `cities`, filtered by slug via PostgREST's `!inner` embedded-resource
   syntax) for the hit path, and only touches `cities` at all on a genuine
   miss/stale read. Measured: ~950ms → ~150-300ms for a repeat lookup.
2. **`getCachedCityDataBatch`'s chunked Supabase queries ran sequentially**
   (a plain `for` loop with `await` inside) — at the ~6,300-city shortlist
   size that's ~21 chunks one after another. Now `Promise.all`'d in
   parallel, since each chunk is an independent query with nothing to wait
   on the others for. Also merged into the same single-join-query
   optimization as #1 (was two sequential lookup types, cities then
   city_scores; now one).
3. **Advanced search (`/api/explore/discover`) used to live-aggregate any
   candidate not already cached** — fine when the shortlist was small and
   mostly pre-warmed, but at ~6,300 cities with only a fraction warmed so
   far, that meant "Search all" was waiting on hundreds/thousands of live
   external-API calls. **It now reads cache only, never live-aggregates
   mid-search** — an uncached candidate is skipped (counted in the
   response's `notYetCached`, surfaced honestly in the UI, not hidden) and
   simply appears once the scheduled warm job reaches it. This is a real,
   deliberate trade-off (search results are only as complete as the cache
   is warm) in exchange for search always being fast regardless of cache
   coverage — the right trade given the explicit speed requirement, but
   worth knowing about if "why isn't city X showing up" comes up again.
4. **The city-scope match loop ran every one of ~6,300 candidates through
   a `CONCURRENCY`-batched `Promise.all` structure** (~1,000 batches) even
   though, once cache-only, scoring a candidate with no Nearby filter
   involves zero real async I/O — that batching exists purely to rate-limit
   genuine live lookups (Nearby/pin data), so it now only runs when a
   Nearby filter is actually active; otherwise it's a plain synchronous
   loop (see `evaluateCityCandidate` in
   `app/api/explore/discover/route.ts`).

**Net result, measured**: single cached city ~150-300ms; unfiltered
"Search all" across the full city shortlist ~265-350ms (was 60s+
timeout); country scope ~550-650ms (fewer candidates, already fine).
**Single-city Explore search for a city that's never been aggregated
before is the one path that's still inherently slow** (live external-API
aggregation, several seconds) — that's unavoidable for "any city on
Earth" search working at all, not a bug; it's also a one-time cost per
city since the result gets cached. **Advanced search's Nearby-filter path
is also still slower** than the cache-only default, for the same reason
disclosed in "Known, disclosed gaps" below (pin data isn't
Supabase-persisted).

## City-level data reliability fixes (2026-09-21)

User reported London's population showed "69 million" (the UK's national
figure, not London's ~9M) and main language was empty. Root-caused and
fixed four separate, real bugs found while chasing this:

1. **`getCityPopulationAndArea`'s query design was unusably slow for any
   densely-mapped city.** It used `SERVICE wikibase:around` (geo-radius
   scan) first, then filtered by exact label match — which forces
   Wikidata to materialise every coordinate-tagged entity within 15km
   before it can filter by name. Tested live: London's version of that
   query took 39+ seconds (never finished in one further test after 90s),
   comfortably past the 8s client timeout, so it always fell back to
   World Bank's country-level population. **Fixed by flipping the query
   order** — exact label match first (`?item rdfs:label "cityName"@en`,
   hits Wikidata's label index directly), then disambiguate same-named
   places by computing real haversine distance in JS. Tested live:
   London ~540ms, Paris ~20-750ms, Springfield (very common name, 248
   candidate rows) ~2.1s — all comfortably fast. A per-statement P585
   (point-in-time) qualifier was tried to properly pick the *most recent*
   population figure but reintroduced the same slow cross-product pattern
   (pushed London to a 502 from Wikidata's gateway) — reverted in favour
   of the simpler "pick the largest value on file" heuristic.
2. **A second Wikidata query-design bug, found while fixing #1: proximity
   alone isn't a safe disambiguator.** Wikidata has other entities that
   share a city's exact label and can sit *closer* to the search
   coordinate than the city itself — e.g. `Q127430952`, "Mint of Paris"
   (Monnaie de Paris), labelled "Paris" and pinned almost exactly at
   central Paris's coordinate, closer than the actual city entity (`Q90`).
   It has no population/area statement, so "nearest label match" latched
   onto it and returned nothing, every time, for Paris specifically.
   Fixed by only considering candidate rows that actually carry a
   population or area value before picking nearest.
3. **REST Countries' free API (v3.1, used for `mostWidelySpokenLanguage`)
   is fully dead.** It now returns HTTP 200 with
   `{"success":false,"data":null,"errors":[...]}` on every v1-v4 request
   instead of an error status, so the old code's `!res.ok` check never
   caught it — it silently parsed an empty `languages` object and
   returned `"Unknown"` for every city, for what's presumably been a
   while now. The replacement (v5) needs a paid-tier-adjacent account and
   an API key, which breaks this project's "no keys anywhere" principle.
   **Replaced entirely** — `lib/data-sources/restcountries.ts` is gone;
   `lib/data-sources/languages.ts` now reads
   `data/static/country-languages.json`, generated from GeoNames'
   `countryInfo.txt` (same free, keyless, public-domain source already
   used for the city shortlist) via a one-off script (not committed, same
   pattern as `discover-cities.json`). Covers 249 countries; every
   country's `mostWidelySpokenLanguage` is a real name, a handful of
   secondary/tertiary languages deep in some countries' `officialLanguages`
   array fall back to a raw ISO code since that array isn't rendered
   anywhere in the UI today.
4. **The real architectural finding: `fetchWithTimeout`'s `next: {
   revalidate }` caching could permanently memorise a bad response.**
   While debugging #1/#2, a fully-fixed, verified-fast query kept
   returning `null` for Paris — traced to Next's Data Cache having cached
   an earlier empty/degenerate response for that exact request (most
   likely one that got aborted by this same timeout while contending with
   other concurrent Wikidata calls) and serving it instantly (no network
   call, confirmed via response timing) on every later run regardless of
   code changes, for up to the revalidate window (1-30 days depending on
   the file). This risk applied to every external data source using this
   pattern, not just Wikidata's — **all of them can time out under load**
   per `fetchWithTimeout`'s own header comment. Fixed by removing
   `next: { revalidate }` from all 5 files that had it (`worldbank.ts`,
   `openmeteo.ts`, `nominatim.ts`, `wikidata.ts`, `who.ts`) in favour of
   `cache: "no-store"` — the cache that actually matters here is the
   explicit, per-city, on-a-schedule Supabase `city_scores` table (see
   "Sub-second responses" above), not an unmanaged fetch-level cache
   underneath it. See `fetchWithTimeout.ts`'s header comment for the full
   writeup.

`aggregate.ts`'s Wikidata call (population/area) used to run alongside
two others — ranked-universities count and notable-restaurants count —
in the outer `Promise.all`. Testing showed Wikidata queues concurrent
requests from one client, and those two (both slow, both found to be
returning the wrong answer) could starve the fast population query's
turn and time it out even though it runs in under a second alone. That's
what led to finding they were broken in the first place.

**"Ranked universities nearby" and "notable restaurants nearby" have been
removed entirely (2026-09-21, same-day follow-up), not fixed.** Both
`countRankedUniversities` and `countNotableRestaurants`
(`lib/data-sources/wikidata.ts`) had the same "`SERVICE wikibase:box`
before filtering by the rare property" ordering bug as the population
query above, and were confirmed both **wrong and slow** for a dense
city — tested live for London: the original query took 20s and returned
`0` (wrong; London has ~36 by a corrected query), a query restructured
to filter by the rare ranking-ID property first before checking
coordinates returned the correct `36` but still took 28s. Rather than
ship a fixed-but-still-unreliable version of a secondary, display-only
stat, the user's direction ("remove all gaps, simplify as much as
possible, we'll build back up slowly") was to cut it. Removed
completely, same discipline as the Real Estate removal — the two
functions and their JSDoc from `wikidata.ts`, the `worldRankedUniversityCount`/
`notableRestaurantCount` fields from `LiveabilityFields` (`lib/types.ts`),
the assignment in `aggregate.ts` (which also let the now-pointless
`getWikidataFields` sequencing wrapper collapse back into a single
`safely(() => getCityPopulationAndArea(...))` call in the main
`Promise.all`), the two Advanced Search criteria
(`lib/advancedSearch/criteria.ts`), the `buildLiveabilityNotableRows` KPI
row builder and its `COLOR_RANGES.notableCount` (`lib/kpiRows.ts`), the
"Local Signals" merge in both `SectionDetail.tsx` and
`app/explore/report/page.tsx` (Transport rows now render alone), and the
mock fields in `randomSeed.ts`. Nothing scored was affected — these two
counts were always display-only, never part of any section's
`averageScores` input. Worth re-adding later with a properly
redesigned query if wanted back.

**Cache implication, worth knowing before assuming the live site is
fixed**: this only changes what happens on the next aggregation for a
given city. Already-cached cities (including London, from before this
fix) keep serving their old, wrong `city_scores` row until re-aggregated
— and per `CACHE_TTL_DAYS=30`, they won't be considered "stale" and
picked up by the daily cron on their own for up to 30 days. To get
already-cached cities corrected sooner, use `/admin` → "Warm everything
stale" only refreshes rows past the TTL — a full "Clear entire cache"
followed by letting cron/admin warming rebuild is the way to force every
city through the fixed code path.

Also confirmed, not a bug: exact-label matching (#1/#2 above) means a
city whose Mapbox-geocoded name doesn't match Wikidata's exact English
label won't resolve to city-level data — e.g. "New York" (Mapbox) vs
Wikidata's "New York City" (Q60; "New York" alone is Wikidata's label
for the *state*, Q1384). Falls back to the World Bank country figure,
same documented, intentional behaviour as any other label mismatch — see
`getCityPopulationAndArea`'s doc comment.

## Current data state — read this before doing anything data-related

As of the end of the 2026-09-20 session: the shortlist is the new
~6,300-city one, `CRON_SECRET`/`ADMIN_PASSWORD` are live in Vercel and
confirmed working, and the cron/admin infra itself is verified end to end
— but **actual data coverage is still tiny** (well under 100 cities warmed
out of ~6,300) because of two things discovered *while verifying* the
scheduled job in production: Overpass's free public instances were
rate-limiting this project's testing traffic for a while, and the first
version of the warm job used a fixed city count that hit Vercel's function
timeout and returned nothing (fixed same session — see "Scheduled warming"
above, now deadline-bounded and verified to complete in ~30s locally).
**Before treating the live site's scores as real for anything beyond a
literal handful of cities**: either wait for the daily cron to keep
working through the shortlist (pace varies with how fast Overpass is
responding that day — see "Scheduled warming"), or trigger a manual full
sweep from `/admin` ("Warm everything stale") and watch it actually
progress. A city that hasn't been warmed yet still
works everywhere (both single-city Explore and Advanced search fall
through to live aggregation on a cache miss, same as always) — the only
cost of not being warmed is speed: that specific city pays the full live
aggregation cost instead of a fast cache read, which matters most for
Advanced search's "Search all" scanning hundreds/thousands of candidates
at once.

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
- Real Estate is entirely absent from the app — not scored, no UI trace
  at all (see "Data model" above). It's a disclosed, deliberate gap, not a
  bug, until a real per-city pricing source is wired in.
- **The shortlist (6,300 cities) is still only ~1 city warmed** as of
  2026-09-20 — see "Current data state" above. Not a bug, just not done
  yet; the daily cron will get there on its own.
- Overpass has no formal SLA and its free public mirrors can and did
  rate-limit this project during real testing — see "Scaling the data
  pipeline" above. The 3-mirror fallback and paced batch job are the
  mitigation, not a guarantee it can never happen again.

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

## Recent major work (2026-09-20 — one long session, three parts)

1. **Made the whole site responsive** (mobile/tablet, was desktop-only).
   The Explore results page's desktop absolute-overlay layout (map behind a
   floating score panel + pin bar) now switches to a stacked mobile layout
   below the `md` breakpoint via `lib/useMediaQuery.ts` — map on top at a
   fixed height, score card and pin details in normal document flow below
   it, section detail reusing `SectionColumn`'s existing inline accordion
   instead of the desktop-only side panel. `NavBar` collapses to two rows.
   `MapView` got a `compact` prop so its fitBounds padding doesn't waste
   space accounting for a floating desktop panel that isn't there on mobile.
2. **Simplified the data model and pin mode to be fully honest** — see
   "Data model, and why it's 4 sections not 5" above.
3. **Scaled the data pipeline** to a ~6,300-city shortlist with a real
   scheduled-warming architecture instead of manual curl commands — see
   "Scaling the data pipeline" above. This is the part most likely to need
   a first real follow-up (confirming Overpass access recovered, running
   the first full warm sweep, adding `CRON_SECRET`/`ADMIN_PASSWORD` to
   Vercel).

## Getting oriented fast

Start with `lib/types.ts` (the whole data model — read its file header
comment first), `lib/aggregation/aggregate.ts` (the real data-fetching
orchestration — every field's source is named directly in comments there),
`lib/advancedSearch/criteria.ts` (every filterable criterion, its ranges,
and per-scope overrides), and `app/api/explore/discover/route.ts` (the
Advanced search matching engine). `lib/aggregation/cache.ts` is the
caching layer — see "After changing CityExploreData's shape" above before
you touch it.
