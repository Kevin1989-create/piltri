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

## Country-level vs city-level audit, and 2 more bugs found (2026-09-21, later same session)

After the fixes above, the user reported London still showed the UK's
population - traced to Supabase's `city_scores` cache: cities cached
before that session's fixes stay "fresh" by `CACHE_TTL_DAYS=30` and won't
be touched by cron for up to 30 days on their own. **Cleared via
`/admin` → "Clear entire cache"** (confirmed working as designed - every
row is re-derivable, nothing lost) and re-warmed; London corrected
immediately after. If this ever comes up again: check `/api/admin/status`
for `freshCities` before assuming a code fix didn't work - a "fresh" row
can still be running old logic.

Asked to also audit every scored field by real data granularity. Full
result: **Safety & Stability (30% weight) and Economy (25% weight) are
100% World Bank, country-level, identical for every city in a country**;
Climate (25%) is 100% city-level (Open-Meteo, exact coordinates);
Liveability (20%) is city-level except its healthcare input (WHO,
country-level). Net: **~59% of the Piltri Score's weighted inputs are
country-level**, not city-specific - no free, globally-open per-city
alternative exists for safety/crime or detailed local economic stats,
which is why World Bank was used for these in the first place.

**Decision (user, delegated with direction): keep all 4 sections and
every current field as the basis, don't cut anything - just make it
correct and honest.** Turned out the disclosure this implies was already
built: `PrecisionTier` (`lib/kpiRows.ts`) and `DemographicsPrecision`
(`CityHeader.tsx`) already tag every KPI row and demographic stat as
`country` / `city` / `pinned` with a hover tooltip - Economy and Safety
rows already say "Country Data", population/area already say "City Data"
(genuinely true since the Wikidata fix), language already says "Country
Data". Nothing to add there; if a future field's real source changes,
update its tag in `buildKpiRows`/`CityHeader.tsx`, not before.

Two real bugs found while doing this audit, both fixed:

1. **Liveability's "per 10k population" fields divided by the country's
   population, not the city's**, even though the numerator (Overpass
   amenity count within 5km of the city centre) was always genuinely
   city-level. Produced a meaningless ratio - a small capital in a huge
   country read as artificially "sparse" purely from the country's size,
   nothing to do with the city itself. Fixed in `aggregate.ts`: `per10k`
   now divides by `resolvedPopulation` (the same city-level-when-possible
   figure already shown in the UI), not the raw World Bank country total.
   Recalibrated `RANGES.restaurantsBarsPer10k` (0-40 → 0-30),
   `culturalVenuesPer10k` (0-10 → 0-3) against real Overpass data at the
   new scale - tested live: London 4,933 restaurants/bars/cafes within
   5km ÷ 8.8M city population = 5.6/10k; Ljubljana 554 ÷ 284k = 19.5/10k;
   Prague 3,209 ÷ 1.4M = 23.0/10k. `familyActivitiesPer10k` kept at 0-15
   (only one clean data point before Overpass's free mirrors rate-limited
   the rest of this session's calibration traffic - revisit if it looks
   off once more real data accumulates). Matching `COLOR_RANGES` in
   `kpiRows.ts` and `suggestedRange`s in `criteria.ts` updated to match.
2. **`greenSpacePctOfCityArea` never computed a real area percentage** -
   it's a normalised count of parks/gardens (Overpass, within 5km) on a
   fixed 0-60 scale, then divided by 5, displayed as "X% of city area".
   Neither the division nor the label reflected anything about actual
   land area (that would need OSM polygon geometry, not a point/way
   count - a bigger change than this). Worse: the un-renormalised 0-20ish
   value was fed directly into Liveability's `averageScores` alongside
   four genuine 0-100 inputs, systematically dragging the section score
   down. **Renamed to `greenSpaceScore`** (0-100, matching every other
   *Score field's convention), dropped the `/5`, UI now shows a plain
   score with a hint explaining what it measures instead of a fake
   percentage. Touched: `types.ts`, `aggregate.ts`, `kpiRows.ts`,
   `criteria.ts`, `randomSeed.ts` - same full-rename discipline as the
   Wikidata/REST Countries work above.

**Shape-drift reminder, learned firsthand while fixing #2**: renaming a
`CityExploreData` field without clearing the cache shows `undefined` for
every already-cached city until it's re-aggregated - `clear-cache`'s own
doc comment already warns about exactly this. Cleared cache again after
this round of fixes landed, for the same reason.

## Demographics split into Country vs City, for real (2026-09-22)

User was "checking one by one" against real city research and asked, per
field, exactly where the data comes from and for how many cities - then,
looking at the answers, proposed a structural fix rather than more point
patches: **stop blending country-level and city-level numbers under one
label, show both, clearly separated, "Not available" per field rather
than silently substituting one tier for the other.**

`DemographicsFields` (`lib/types.ts`) is now two explicit groups instead
of one merged set - `countryPopulation`/`countryPopulationDensityPerKm2`/
`countryLandAreaKm2`/`countryAverageAge`/`countryPopulationTrend5yrPct`/
`countryMostWidelySpokenLanguage`, and separately `cityPopulation`/
`cityAreaKm2`/`cityPopulationDensityPerKm2`. Every field is independently
nullable; the city ones are null whenever Wikidata's exact-label match
doesn't resolve (~70% of cities do, per the earlier session's sample),
never backfilled from the country figures. `CityHeader.tsx` and the
printable report page (`app/explore/report/page.tsx`) both render this as
two mini-headed groups ("Country" / the city's own name) instead of one
flat grid with per-stat precision icons - the grouping itself now carries
that information, so the individual icons were redundant and dropped from
this specific block (still used elsewhere, e.g. `SectionDetail.tsx`'s KPI
rows).

Two new fields needed real sources that didn't exist before:

- **Country Land Area** - added `AG.LND.TOTL.K2` to the existing World
  Bank fetch in `worldbank.ts` (`landAreaKm2`). Trivial - same API,
  same pattern as every other WB indicator here. 167/171 shortlisted
  countries covered.
- **Country Average Age** - this one mattered more. The old `averageAge`
  field had **no real source at all**: World Bank doesn't publish median
  age directly, so `medianAgeProxy` was permanently `null` and the code
  fell back to a hardcoded `38` for literally every city, unconditionally
  - found while building the coverage table above, not something anyone
    had flagged before. World Bank has no substitute; the UN Population
    Division's Data Portal API does have a "Median age of population"
    indicator, but its live query endpoints need a bearer token
    (`WWW-Authenticate: Bearer` on every data request, confirmed by
    testing), which breaks this project's "no keys anywhere" rule. Its
    **bulk CSV downloads don't** - population.un.org/wpp/downloads serves
    `WPP2024_Demographic_Indicators_Medium.csv.gz` with no login, no key,
    16.5MB. Parsed the `MedianAgePop` column for `Time=2024`,
    `LocTypeName=Country/Area` (excludes UN's regional-aggregate rows)
    into `data/static/country-median-age.json`
    (`lib/data-sources/medianAge.ts` is the accessor) - same
    generate-once-and-bake-in pattern as `country-languages.json`.
    233 countries; 168/171 on this project's shortlist (missing only
    Taiwan/Hong Kong/Macau, which UN's dataset reports under China rather
    than separately - a political/statistical choice on UN's part, not a
    gap in this file). Spot-checked against public knowledge: Japan 49.4,
    Niger 15.4, UK 40 - all correct.

**What this replaced wasn't actually removed** - Liveability's per10k
ratios (see "City-level data reliability fixes" above) still need *some*
population figure to divide by. That's now `bestEffortPopulation`, a
local variable in `aggregate.ts` (city-preferred, country-fallback) used
only for that internal calculation - never part of the returned
`demographics` object, so it can't leak into the UI as an ambiguous
number the way the old merged fields did.

Also touched for the rename: `lib/advancedSearch/criteria.ts`'s 5
Demographics filter criteria now point at `cityPopulation` /
`cityPopulationDensityPerKm2` / `cityAreaKm2` (population/density/area -
these filter cities, so the city-level figure is the more useful one to
filter on, consistent with how they behaved before this split) and
`countryAverageAge` / `countryPopulationTrend5yrPct` (always were
country-only, no city equivalent exists). Not otherwise expanded - no new
filter criteria added for country land area/density/etc, since that
wasn't asked for; worth doing later if wanted. `randomSeed.ts`'s mock
data generator updated to the new shape too, with city fields present
~70% of the time (matching the real match rate) so Advanced search's
"Not available" handling gets exercised by the mock-data path too, not
just the live one.

## City land area from real OSM boundaries, not Wikidata (2026-09-22, later same session)

User asked whether satellite data (NASA et al.) would give a more
accurate land area/population/density than Wikidata. Answer landed on:
population from satellite imagery isn't actually more "true" than
Wikidata's census-sourced figures (products like NASA SEDAC's Gridded
Population of the World are themselves census data redistributed across
a grid using imagery as a weighting signal, not a raw headcount, and
need real GIS tooling to use at all) - but **land area was a genuine,
much smaller win, because the app already fetches a real OSM
administrative boundary polygon** (`lib/data-sources/nominatim.ts`
`getPlaceBoundary`, used for the map outline) that was sitting there
unused for anything but the map.

Tested live against 3 cities before committing to the approach: London
1589 km² (Wikidata: 1572 - close), Paris 105.06 km² (Wikidata: 105.4 -
very close), **Zagreb 639.69 km² vs Wikidata's 305.8** - Zagreb's real
official area is ~641 km², so Wikidata's figure was roughly half the
true value. Confirmed the accuracy call: a real boundary polygon,
computed the same way for every city, beats a single crowdsourced number
with no geometry behind it and no way to tell if it's stale or uses a
different definition (city proper vs. metro) than the next city's figure.

**Coverage isn't universal either way** - tested a real 25-city random
sample against Nominatim: only 16/25 (64%) had an actual polygon, the
rest matched a point/pin only. So this isn't "replace Wikidata," it's
"prefer OSM's polygon-derived area when it resolves, fall back to
Wikidata's stated figure otherwise" - maximising combined coverage
rather than picking one universal source, since neither alone reaches
100%.

**Why this needed different plumbing than every other field added this
session**: Nominatim's usage policy is a hard 1 request/second, strictly
enforced - not Overpass's "gentle concurrency + pause" tolerance. Fetching
all ~6,300 shortlisted cities at that pace is ~105+ minutes of continuous
requests, and a city's administrative boundary essentially never changes,
so redoing this on `city_scores`' normal 30-day refresh cycle would be
pure waste even if it fit in a serverless function's time limit (it
doesn't - one `warm-cache` tick's entire 30s budget wouldn't cover 30
Nominatim calls once other per-city work is accounted for). So:

- `cities.osm_land_area_km2` / `cities.osm_land_area_checked_at` -
  2 new columns on the *`cities`* table (not `city_scores`), added via a
  manual migration (Supabase doesn't expose DDL over the REST API this
  project otherwise uses - had to walk the user through running
  `alter table cities add column ...` in Supabase's SQL editor directly,
  same one-off manual step as the original `schema.sql` setup). Lives on
  `cities` specifically because it's permanent, per-city metadata, not a
  score that needs periodic refreshing.
- `lib/aggregation/backfillLandArea.ts` + `POST
  /api/admin/backfill-land-area` - a genuinely separate, one-time
  (resumable) job, structurally like `warmCache.ts` but sequential
  (1 request at a time, ~1.1s pacing) instead of concurrent-with-pauses,
  and tracking "checked" independently of "found a value" so a
  city with no OSM boundary isn't retried forever. Triggered manually
  from `/admin`'s new "Backfill city land area (OSM)" button - same
  click-until-`remaining`-is-0 pattern as "Warm everything stale".
- `getCityLandAreaKm2` (`nominatim.ts`) rejects any match that isn't
  `category: "boundary"` + `type: "administrative"` with real Polygon/
  MultiPolygon geometry, even if Nominatim's `limit=1` best-text-match
  happens to return *something* geometric - a landmark or the wrong kind
  of place with a real geometry attached is treated the same as no
  match, rather than risking silently computing the area of the wrong
  thing. Area itself via `@turf/area` (new dependency - small, focused,
  not worth hand-rolling geodesic polygon math for).
- `cache.ts`'s existing `cities` join (already read for `slug`) now also
  selects `osm_land_area_km2` and threads it into `aggregateCityData` as
  an optional `opts.osmLandAreaKm2` - a precomputed value passed in, never
  fetched live during normal aggregation. `aggregate.ts` prefers it over
  Wikidata's `areaKm2` for `demographics.cityAreaKm2`, and
  `cityPopulationDensityPerKm2` is recomputed from it (population is
  still Wikidata-only - only the area input changed).

**Real deployment gotcha worth remembering**: this genuinely could not be
deployed before the migration ran - `cache.ts`'s `cities!inner(slug,
osm_land_area_km2)` select would have failed for *every* city read, not
just this feature, breaking the whole site's Explore search until the
column existed. Held the push until the user confirmed the migration was
applied, rather than deploying speculatively.

## New: Resources — a 5th, deliberately unscored section (2026-09-23)

User's idea: a small, hand-curated list of external links per country -
official immigration/visa portals, national property listings, health
registration, job boards - shown as a 5th section alongside the 4 scored
ones, but clearly not part of the Piltri Score. 4 categories, chosen in
conversation: **Home, Immigration, Health, Jobs**. Deliberately kept
small by product decision (a soft ~10-links-per-country nudge in the
admin UI, not a hard limit) - this is meant to stay a curated shortlist,
not grow into a directory.

**Complexity assessment given to the user before building** (worth
keeping here since it turned out accurate): engineering is the *easy*
part - no external API, no rate limits, no aggregation pipeline, just a
small table and a CRUD form. The real cost is content: curating
genuinely useful, current, trustworthy links per country is a large,
open-ended manual effort, expected to grow gradually the same way city
data coverage has all session - not something to expect "done" any time
soon.

**Where it lives, and why it's structured differently from everything
else added this session**: Resources is *not* part of `SectionKey` (see
`lib/types.ts`'s `ResourceLinkCategory` doc comment) - there's no
sensible score for a links list, same reasoning that's kept Demographics
out of `SectionKey` since the start. It's also *not* part of the cached
`CityExploreData` blob in `city_scores`, unlike everything else -
deliberately, since these links are:
- **country-level** (shared across every city in that country, same
  pattern as `countryPopulation` etc.), and
- **hand-edited, expected to change often** while the user and Claude
  build the list out together.

Baking it into `city_scores` would mean an edited link doesn't show up
until that specific city's next 30-day cache refresh - the exact
"shape drift" pain point hit twice already this session (population/
language, then land area), except this time it's not a one-off schema
change, it's the *normal* way this data gets edited going forward. So
instead: its own table (`country_resource_links` - country_code,
category, title, url), read live via its own endpoint
(`GET /api/explore/resource-links?countryCode=..`), fetched client-side
by the results page independently of the main score fetch. An edit in
`/admin/resources` is visible on the site immediately - no cache-clear
dance needed, ever, for this one.

**New pieces**:
- `lib/types.ts` - `ResourceLinkCategory`, `ResourceLink`,
  `ResourceLinksByCategory`, `RESOURCE_LINK_CATEGORIES`,
  `RESOURCE_LINK_CATEGORY_LABELS`.
- `lib/data-sources/resourceLinks.ts` - `getCountryResourceLinks`, the
  one read function, used by both the public endpoint and (indirectly)
  nothing else - kept intentionally thin.
- `GET /api/explore/resource-links` (public) / `GET+POST+DELETE
  /api/admin/resource-links` (password-gated, same `isAdminRequest`
  pattern as every other admin route).
- `/admin/resources` - a dedicated back-office page (linked from the
  main `/admin` page), not folded into the main admin page - a country
  code field, an add-link form, and a delete-able list per category.
  Deliberately simple: no country picker, no bulk import, no pagination.
- `components/explore/ResourcesRow.tsx` / `ResourcesDetail.tsx` /
  `ResourcesDetailPanel.tsx` - same visual shell as the existing
  `SectionRow`/`SectionDetail`/`SectionDetailPanel` trio (identical
  padding, hover states, positioning) so Resources sits consistently
  alongside the 4 scored rows, but **the badge slot is a plain neutral
  pill showing the link count, never the green/amber/red `ScoreBadge`**
  - the whole point was "visible enough, but clearly not part of the
  score," so the row had to actually look different in that one specific
  way, not just internally be a different type. Wired into
  `SectionColumn.tsx` as a 5th row after the existing `ORDER.map` loop
  (which is why `SectionColumn` already exports an `OpenSectionKey =
  SectionKey | "resources"` type now, instead of every caller assuming
  the open section is always a scored one) - this also means Resources
  appears automatically on the Compare page (reuses `SectionColumn`) with
  no extra wiring. Also added to the printable report page, reusing
  `ResourcesDetail` directly rather than a 3rd rendering of the same
  fetch-and-list logic.
- `components/ui/icons.tsx` - `IconResources` (a signpost), kept out of
  `SECTION_ICONS` on purpose since that map is typed to `SectionKey`.

**Verified safe to deploy before the migration ran** (unlike the land-area
column, which broke every city read until the migration landed) -
`getCountryResourceLinks` treats a missing table as "no links," not an
error to propagate, so the feature degrades to an honest empty state
("No Resources links have been added for this country yet") rather than
breaking anything else. Tested live locally before the migration existed:
the public endpoint returned `{}` cleanly, the results page rendered the
empty state, and the admin add-link form surfaced the real Postgres error
("Could not find the table 'public.country_resource_links'...") without
crashing the page - confirmed the ordering didn't matter this time, but
still asked the user to run the migration before actually using it, since
the feature isn't useful without it.

Migration (2 new columns worth on `cities` from land area, this time a
whole new table):
```sql
create table if not exists country_resource_links (
  id uuid primary key default uuid_generate_v4(),
  country_code text not null,
  category text not null check (category in ('home', 'immigration', 'health', 'jobs')),
  title text not null,
  url text not null,
  created_at timestamptz not null default now()
);
create index if not exists country_resource_links_country_idx on country_resource_links (country_code);
alter table country_resource_links enable row level security;
create policy "public read country_resource_links" on country_resource_links for select using (true);
create policy "service role writes country_resource_links" on country_resource_links for insert with check (auth.role() = 'service_role');
create policy "service role updates country_resource_links" on country_resource_links for update using (auth.role() = 'service_role');
create policy "service role deletes country_resource_links" on country_resource_links for delete using (auth.role() = 'service_role');
```

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
