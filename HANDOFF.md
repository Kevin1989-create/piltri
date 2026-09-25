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

## Country/City header colour scheme, and Resources polish (2026-09-23, later same session)

Two follow-up rounds of UI feedback on the same day Resources shipped.

**Country/City colour scheme, round 2.** The first attempt (differentiate
Country from City by giving each its own colour - neutral ink for Country,
amber for City) still read as "not very clear" once seen live. Replaced
with a simpler rule in `CityHeader.tsx` and `app/explore/report/page.tsx`:
colour now signals *UI level*, not country-vs-city tier. The title block
(eyebrow country line + city headline) is the strongest amber
(`text-piltri-amber-dark`, both lines); both stat-group headers below it
("United Kingdom" and "London" as plain text, not colour, is what actually
says which tier a block is) share one lighter shade
(`text-piltri-amber`); and both stat blocks now share the exact same
background/border treatment (`bg-surface-muted`, `border-piltri-amber`)
instead of one being neutral and the other amber. Same change made in
both places that render this header (the results page's `CityHeader` and
the printable report page) so they stay visually identical.

**Resources row, two fixes.** The link-count pill added when Resources
first shipped ("visible enough, but clearly not part of the score") was
reversed on request - a plain neutral number in that exact badge slot
still read as score-like regardless of colour. Removed entirely from
`ResourcesRow.tsx`, along with the count-fetching machinery that existed
only to feed it (`SectionColumn.tsx`'s `resourcesLinkCount` state/effect,
and `ResourcesDetail.tsx`'s `onLinkCountChange` callback prop - nothing
calls it now, so it's gone rather than left as dead plumbing). In its
place, a permanent light amber-tint background
(`bg-piltri-amber-tint/50`, vs. the plain/hover-only background the 4
scored rows use) is the one subtle visual cue that Resources is a
different kind of row - proposed as an option rather than assumed to be
wanted, since the ask was explicitly "propose or not if you don't think
it's good."

**No scroll on the results page's left panel.** With 5 rows now (4 scored
+ Resources) plus the Country/City stat blocks, the floating panel had
started needing to scroll on shorter windows. Trimmed vertical rhythm
throughout `CityHeader.tsx` (stat block `py-1`→`py-0.5`, grid
`gap-y-1`→`gap-y-0.5`, outer `pt-3 pb-2`→`pt-2 pb-1.5`, score-line
`mt-2`→`mt-1.5`) and `SectionRow.tsx`/`ResourcesRow.tsx`'s non-compact row
padding (`py-2.5`→`py-2`, ×5 rows). Verified via the browser tool by
measuring the panel's `scrollHeight` vs `clientHeight` at emulated
viewport heights down to 600px (content now fits exactly, 0px to spare)
— it still overflows by ~20px at a deliberately extreme 560px, which
would need shrinking touch targets or text further to fix and wasn't
pursued, since 600px+ covers realistic laptop browser windows.

No `CityExploreData` shape change in this round (pure display/spacing) -
no cache clear needed, unlike the two data-model rounds earlier this
session.

## Country vs City split for the 4 scored sections' KPI detail (2026-09-23, later same session)

Same Country/City separation the Demographics block already used (see
"Demographics split into Country vs City, for real" above), extended to
each scored section's expanded KPI detail on request: "separate in 2
subsections when it's country vs city related... if the data only exists
for countries, don't add it to the city section, and vice versa."

The grouping isn't new manual work per section - every `KpiRow` already
carries a `precision: PrecisionTier` tag (`"country"` / `"pinned"` /
`"city"`, see `lib/kpiRows.ts`), so `splitKpiRowsByTier` (new, same file)
just partitions on that: `"country"` rows go to the Country group,
everything else (`"pinned"` - genuinely tied to this city's exact
coordinates, and the still-unused `"city"` tier) goes to City. A section
whose rows are 100% one tier renders only that one group - confirmed
live: Safety & Stability is Country-only (political stability, rule of
law, safety trend - all World Bank), Climate is City-only (temperature/
rainfall/sunshine/snowfall - all Open-Meteo, pinned to the exact
coordinate), Economy and Liveability are the mixed ones (Economy: 5
country stats + "Economy Type" as a one-row City group; Liveability: 1
country stat (healthcare quality) + 4 city density stats + the existing
"Local Signals" transport sub-block, all nested under City since they're
all pinned too).

Applied in both places these KPIs render, same as every other display
change this session: `components/explore/SectionDetail.tsx` (Compare
page inline, results page's floating panel) and
`app/explore/report/page.tsx` (printable report - got its own
`ReportGroup` component, parallel to `SectionDetail`'s inline grouping
logic since the report has always hand-rolled its own layout rather than
reusing `SectionDetail`). No `CityExploreData` shape change - this is
purely how already-fetched rows get grouped for display - so no cache
clear needed.

## Title simplified to city-only, City before Country everywhere (2026-09-23, later same session)

Final round of feedback on the results header for this session: drop
the "England, United Kingdom" eyebrow line above the city name
entirely, size the city name up since it's now the only line, and swap
the two Demographics stat blocks so the city's own block comes first
(country second) - matching the title now being city-first too.

Applied in the three places this header renders: `CityHeader.tsx`
(results page floating panel, Compare page columns) and the printable
report page's equivalent markup (`app/explore/report/page.tsx`). Since
the eyebrow line was the only thing reading `region`, `CityHeader`'s
`region` prop is now fully removed (from the component, its props
interface, and both call sites in `results/page.tsx` and
`compare/page.tsx`) rather than left as an unused prop - the region
name (e.g. "England") is simply no longer shown anywhere in this
header; `data.region` itself is untouched in `CityExploreData`, just
no longer read here.

Deliberately **not** touched: the 4 scored sections' own Country/City
KPI groups (`SectionDetail.tsx`, `ReportGroup` in the report page)
still show Country before City - that ordering wasn't part of this
round's request, only the top Demographics header was.

No `CityExploreData` shape change - no cache clear needed.

## City-before-Country extended to the 4 scored sections too (2026-09-23, later same session)

Follow-up to the header simplification above: once the top Demographics
header led with City, the user asked whether the 4 scored sections'
own Country/City KPI groups should match - they did, so
`SectionDetail.tsx` and the report page's per-section groups now also
render City before Country, same as CityHeader.

While making this change on the report page, found and fixed a real
inconsistency it exposed: Economy's "Economy Type" and Liveability's
"Local Signals" are both city-tier (pinned to the exact coordinates,
same as `cityRows`), but the report page rendered them as fully
separate `ReportSubBlock`s *after* both Country/City groups regardless
of order - so for Economy specifically, "United Kingdom" ended up
first and "Economy Type" last even with the City-first swap applied,
while the interactive `SectionDetail` panel (which nests these inside
its City `<div>`) correctly showed Economy Type first. Fixed by
computing a single `cityTierHasContent` flag (`cityRows.length > 0 ||
subBlockRows?.length`) and rendering the whole city-tier bundle - stat
grid plus its sub-block - together, ahead of Country whenever it has
anything at all. `ReportSubBlock` gained the same `spacing` prop
`ReportGroup` already had, so whichever piece renders first (grid or
sub-block) gets the tighter "mt-3".

## Mobile results page: compact-row icons, and less scrolling on open (2026-09-23, later same session)

Two mobile-only issues raised after the City-first work above.

**Bug: the other 4 rows' icons disappeared once one was open.**
`SectionRow`/`ResourcesRow`'s `compact` state (the "thin, quiet line"
the other rows drop to whenever a different one is open - the normal
resting state for 4 of 5 rows any time one is expanded, especially on
mobile where this is the *only* accordion, there's no separate desktop
side panel) was hiding the icon along with the chevron and shrinking
the text. Dropping the icon too made the collapsed rows unrecognisable
at a glance - fixed by keeping the icon always, just a size down
(`w-3.5 h-3.5` vs `w-4 h-4`) when compact.

**"A lot of scrolling needed" once a section opened.** Three compounding
causes, all fixed together:
1. `CityHeader`'s "sticky top-0" was unconditional. It's only meant to
   pin within the left column's own `overflow-y-auto` box, which only
   exists at `md` and up (`results/page.tsx`) - below `md` the whole
   page scrolls instead, so "sticky" was pinning the *entire* header
   (name, both Demographics boxes, score) to the top of the screen the
   moment you scrolled past it, permanently eating a few hundred px of
   a phone's viewport. Now `md:sticky md:top-0`.
2. The map (`h-[45vh]` fixed, always) now shrinks to `h-[18vh]` on
   mobile whenever any of the 5 rows is expanded (`SectionColumn`'s
   existing but previously-unused `onAnyExpandedChange` callback, now
   wired up in `results/page.tsx` as `anySectionExpanded` state driving
   the map wrapper's className, with a 300ms height transition) -
   freeing real space back for the newly-opened detail instead of
   pushing it further below the fold.
3. New `SectionColumn` prop `autoScrollOnOpen` (passed as `!isDesktop`
   from `results/page.tsx` only - Compare page's side-by-side columns
   leave it off, since auto-scrolling the whole page from one column's
   click would fight the others). `SectionRow`/`ResourcesRow`'s
   `onToggle` now receives the click event so `SectionColumn` can capture
   `e.currentTarget` and, once open, `scrollIntoView({block: "start"})`
   it - delayed ~320ms past the map's own shrink transition, since
   scrolling to a target mid-transition raced against it and could land
   scrollY back at 0 (the target kept moving for the next ~300ms after
   the scroll's first frame - confirmed live while testing this fix,
   not just theorised).

Together: opening any of the 5 rows on mobile now needs zero manual
scrolling in the common case - the page auto-scrolls to put the newly-
open row (and usually the rest of the list below it) on screen, with
the map shrunk out of the way. Desktop is untouched (`md:h-full`
already overrides the mobile map height at that breakpoint regardless
of `anySectionExpanded`, and `autoScrollOnOpen` is never true there).

## Mobile results: zero-scroll default layout, and closing returns to it (2026-09-23, later same session)

Follow-up to the mobile scrolling fixes above. Two more asks: the
*default* view (nothing expanded - nav, map, city name, both
Demographics blocks, all 5 rows) should fit on one phone screen with
no scrolling at all, not just "less scrolling once something's open";
and closing the last open row should return to exactly that layout,
not leave the page wherever it happened to be scrolled to.

**Zero-scroll default.** Measured the actual overflow locally (a
reliable read, unlike the live site mid the slow-deploy episode below)
at a 375×812 viewport (iPhone 12-14 standard, the baseline this was
tuned against): 152px of forced scroll before any change. Traced it to
three fixed-size pieces plus one relative one:
- The map's default (nothing-expanded) mobile height was still `45vh`
  (365px at this viewport) - dropped to `26vh` (~211px). Combined with
  the already-`18vh` expanded height from the previous round, this
  reads as one continuous idea now: the map is *always* smaller on
  mobile than it used to be, shrinking further still while something's
  open.
- `CityHeader`'s outer padding `pt-2 pb-1.5` → `pt-1.5 pb-1`.
That closed it exactly to 0px overflow at 375×812. Shorter phones
(iPhone SE's 667px, for one) still need some scroll - closing that gap
too would mean shrinking the map to the point of being nearly
decorative on the far more common 800px+ class of screens, judged not
worth it unless asked.

**Closing returns to the top.** `SectionColumn`'s `autoScrollOnOpen`
effect (previous round) only handled the *opening* case - closing the
last open row left the page at whatever scroll position it was at.
Extended the same effect: when `openKey` goes back to `null`, scroll
the whole page to `{top: 0}` instead of a specific row, on the same
~320ms delay past the map's resize transition as the open case (same
race condition, same fix). Net effect: opening and closing any of the
5 rows now always lands on a deliberate, complete layout - either "this
section's detail, scrolled into view" or "the exact nothing-expanded
view the page started at" - never a half-scrolled in-between state.

**Aside: a live-site scare that turned out unrelated.** While chasing
the very slow deploy for the previous round's commit (`fc5b461` - it
took over 20 minutes to go out, versus this session's usual ~60-90s),
the user separately reported the live site itself feeling slow/
unstable. Checked network activity on the live site during that window
and confirmed it was still serving the *old*, previously-fine build
(chunk hash unchanged) - meaning whatever was slow was happening to
already-deployed code, not anything from this session. Most likely a
transient Vercel/Supabase platform issue rather than an app bug -
flagged to the user to check Vercel's dashboard/status page directly,
since that's outside what's visible from here.

## Three more mobile/perf fixes: cold-cache load time, dvh, resize jank (2026-09-23, later same session)

**Cold-cache load time was the real "2-3s (or much worse) loading" cause.**
The 6 data sources `aggregateCityData` calls already ran in parallel
(`Promise.all`), so the theory that they were serialised was wrong - the
actual problem was that two of them had deliberately generous timeouts to
ride out documented tail latency on their free upstream APIs, and
`Promise.all` is only as fast as its slowest member:
- Wikidata's city population/area lookup: `POPULATION_TIMEOUT_MS` was
  20000ms (`lib/data-sources/wikidata.ts`).
- Overpass's combined amenity/transport/economy query
  (`getCityOverpassData`, what `aggregate.ts` actually calls): its
  `BATCH_CLIENT_TIMEOUT_MS` was 6000ms, but `overpassPost`'s two-phase
  fallback (primary, then race the remaining mirrors if it fails) means
  the real worst case for one call is ~2x that value - so ~12000ms, and
  each of the 3 public mirrors can independently be slow or (confirmed
  live, mid-testing) rate-limited (`429`).
Measured live on production before touching anything: a genuinely
uncached city (Ballarat, Australia - not touched all session, unlike
London) took **17.2 seconds** end to end. Reduced both: Wikidata's
timeout to 6000ms (matching `fetchWithTimeout`'s own default, used by
every other source), Overpass's `BATCH_CLIENT_TIMEOUT_MS`/
`BATCH_QUERY_TIMEOUT_S` to 3000ms/3s (worst case ~6s, brought in line
with everything else rather than left as the one outlier). Re-measured
live (locally, so includes some dev-only compile overhead the first
hit doesn't pay in production) across two more fresh cities as the
fix landed in two rounds: 17.2s → 11.6s → 7.4s. The general-purpose
sources' own 6000ms default (`fetchWithTimeout.ts`) was left alone -
only the two sources that were measurably the actual bottleneck got
touched. This is a deliberate speed-over-completeness tradeoff:
a cache-miss city may now show "Not available"/"Not enough Data" for
Overpass- or Wikidata-city-sourced fields slightly more often (a
genuinely slow-but-real response now sometimes gets cut off where it
wouldn't have been before) - judged the right trade given the
complaint was specifically about load time. Once a city is cached
(Supabase `city_scores`, 30-day TTL), none of this matters - subsequent
loads are ~100ms regardless, confirmed live (Whyalla's second identical
request during testing: 128ms vs. the first request's 11.6s).

**Resources wasn't visible without scrolling on a real phone**, despite
the previous round measuring 0px overflow at 375×812 in this browser
tooling. Root cause: that measurement used `vh` units and a desktop-
style viewport with no address bar to account for - `vh` is defined
against the *largest possible* viewport (address bar collapsed), not
the *actual initially-visible* one (address bar showing), so a real
phone's true usable height on arrival is meaningfully less than
`100vh` reports. Switched the map's mobile height classes from
`h-[26vh]`/`h-[18vh]` to `h-[26dvh]`/`h-[18dvh]` (dynamic viewport
height - responds to the address bar actually showing or hidden,
well-supported on real mobile browsers for years now) in
`results/page.tsx`. Not fully verifiable from this tooling (no real
address-bar simulation available here) - the theory is solid and the
change is a strict improvement with no downside, but this one is worth
the user confirming on an actual phone.

**The expand/collapse animation was janky ("small movements").** Root
cause: the map's mobile height already animates via a CSS transition
(`transition-[height] duration-300`), and `MapView.tsx`'s
`ResizeObserver` was calling `map.resize()` - a synchronous, expensive
WebGL canvas resize + repaint - on *every single frame* of that
transition (ResizeObserver fires on essentially every layout change,
so ~18 times over a 300ms transition). Each call competed with the
CSS transition's own rendering for the main thread, producing the
stutter. Fixed by debouncing: the observer now waits 350ms (past the
transition's own 300ms) since the last size change before calling
`map.resize()` once, rather than on every frame. The map canvas may
show a brief size mismatch (clipped or with a small gap at the edges)
*during* the animation now instead of live-tracking it, but the CSS
transition itself runs unobstructed - judged the right trade, since a
briefly-clipped-but-smooth transition reads far better than a
correctly-sized-but-stuttery one. Also added `ease-out` to the
transition's timing function for a slightly more natural deceleration.

## Mobile expand animation: stopped resizing the map, hide CityHeader instead (2026-09-23, later same session)

The debounced-resize fix above helped but didn't fully solve the janky
expand animation - the user's own diagnosis was right: resizing a live
WebGL map via a CSS transition was never going to read as smooth, no
matter how the resize calls were throttled. Their proposed fix: stop
moving the map (and the nav bar) on expand/collapse at all, and instead
free up the space that used to come from shrinking the map by hiding
CityHeader (the city name + both Demographics blocks) while a section
is open on mobile - reappearing the instant it closes.

Implemented exactly that in `results/page.tsx`:
- The map's mobile height is now a single fixed `h-[26dvh]` always - no
  more `anySectionExpanded`-driven `h-[18dvh]`/`h-[26dvh]` toggle, no
  more `transition-[height]` on it at all. It simply never moves.
- `CityHeader` only renders when `isDesktop || !openSectionKey` - gone
  the instant any of the 5 rows opens on mobile, back the instant
  everything closes. No transition on this either - a plain DOM block
  disappearing/reappearing isn't expensive the way a WebGL canvas
  resize was, so there was nothing to smooth out in the first place.
- `anySectionExpanded` state and `SectionColumn`'s `onAnyExpandedChange`
  callback are gone entirely (nothing needs "is anything open" as a
  bare boolean anymore - `openSectionKey` already carries strictly more
  information and was the only thing actually consulted). Removed
  rather than left dead.
- `SectionColumn`'s auto-scroll effect (previous round) no longer needs
  the artificial ~320ms delay that existed specifically to ride out the
  map's now-deleted CSS transition - scrolls immediately once the
  open/close state (and CityHeader's visibility) has committed.

MapView's debounced `ResizeObserver` (previous round) is left in place
even though this specific interaction no longer triggers it - it's
still a reasonable safeguard for other resize triggers (window resize,
the pin panel changing width on desktop), just no longer load-bearing
for the mobile expand/collapse case specifically.

## Genuine safety margin for zero-scroll, and a leaner expand view (2026-09-23, later same session)

Two more rounds of feedback on the mobile results page's default and
expanded layouts.

**Resources was still getting cut off on a real phone**, even after the
`vh` → `dvh` fix. Measured this session's own testing tooling again: the
"fit" was real but razor-thin - Resources' own bottom edge landed only
~6px above the viewport's bottom edge, essentially an exact 0px-overflow
fit with no margin. `dvh` correctly accounts for the browser chrome
showing/hiding, but a fit that tight is still fragile against small
real-device differences (a slightly taller status bar, on-screen nav
buttons, etc.) this tooling can't reproduce. Traded a bit more map for a
genuine buffer: the map's mobile height dropped from `26dvh` to `23dvh`,
which measured out to ~32px of clear space below Resources instead of ~6px.

**The expanded view got leaner still.** Hiding CityHeader's Demographics
blocks (previous round) helped, but the city name and view/compare
buttons disappearing too, and the other 4 rows staying as thin "compact"
lines, still added up to more motion/content change than wanted. Revised
per explicit direction: on mobile, opening a row now keeps the city name
+ Piltri score + the view/compare buttons in place (only the two
Demographics stat blocks disappear - `CityHeader`'s `demographics` prop
goes to `undefined` rather than the whole component unmounting), and the
other 4 rows are removed entirely rather than shown compact
(`SectionColumn`'s new `hideOthersOnOpen` prop, mirroring
`autoScrollOnOpen`'s "mobile results only" scoping - Compare page's
columns still show their compact siblings, since there's nowhere else
those scores would be visible). Net effect on mobile: expanding a row
now shows just nav + map (both still completely static) + city name/
score/buttons + the one open row and its detail - nothing else.

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

## Safety & Stability: added homicide rate, reviewed data quality (2026-09-23, later same session)

Went through the "review each scored category" exercise for Safety &
Stability first (user's own framing: work through the 4 scored categories
one at a time). Findings, for the record:

- All 3 existing fields (Political stability score, Rule of law score,
  Safety trend) trace back to World Bank's Worldwide Governance Indicators
  (`GOV_WGI_PV.SC` / `GOV_WGI_RL.SC`) — country-level only, and correctly
  so: governance/rule-of-law describe national institutions, there's no
  meaningful city-level equivalent. Safety trend isn't independent data —
  it's derived from Political stability's own multi-year trend (see
  `trendFromPctChange` in `lib/data-sources/worldbank.ts`).
- WGI's quality/coverage are both good (~214 economies, internationally
  respected composite indicator), so no change needed there.
- Added one genuinely new field: **intentional homicide rate per 100k**
  (`VC.IHR.PSRC.P5`, UNODC via the same World Bank API already in use —
  zero new integration cost). It's a hard crime statistic, complementing
  WGI's two perception-based governance scores. Still country-level —
  looked for a free, reliable city-level crime source and found none worth
  shipping (Numbeo's city Safety Index is crowdsourced and needs a paid
  API, the same reason Real Estate skipped Numbeo earlier; an Overpass
  police/fire-station-density proxy is free and city-level but too
  ambiguous a signal — more stations could mean more crime or more
  investment, no clean "higher = safer" read).

Wired end to end: `lib/data-sources/worldbank.ts` fetches
`VC.IHR.PSRC.P5`; `lib/types.ts`'s `SafetyStabilityFields` gained
`homicideRatePer100k`; `lib/aggregation/aggregate.ts` normalises it
(0-30 range, inverted — lower is better) into the Safety & Stability
section score alongside the other two; `lib/kpiRows.ts` shows it as a new
KPI row; `lib/advancedSearch/criteria.ts` and `lib/aggregation/randomSeed.ts`
got the matching criterion/mock-data updates.

**Cached rows predate this field.** Supabase's 30-day `city_scores` cache
has rows serialized before `homicideRatePer100k` existed, so reading it off
a cached row is `undefined` until that city naturally re-aggregates.
Confirmed this crashes `kpiRows.ts`'s `.toFixed(1)` call on a real cached
city (London) during verification — fixed with a `?? 0` fallback at the
display site, same pattern as this file's other cached/optional fields.
Worth remembering for any future "new field on an existing section" change:
grep for anywhere the new field is read and nullish-guard it, since old
cache rows won't have it for up to 30 days after the field ships.

## Confirmed live homicide data, removed the per-stat precision icons (2026-09-23, later same session)

Two quick follow-ups after the homicide-rate addition above.

**"It shows zero for United Kingdom" turned out to be the stale-cache
fallback, not fake data.** Queried World Bank's `VC.IHR.PSRC.P5` and
`GOV_WGI_PV.SC` directly for GB to confirm — real, current data (UK's
latest homicide rate: 1.12/100k, 2021; political stability: 70.3, 2024).
The `0.0` on screen was purely `kpiRows.ts`'s `?? 0` fallback for cached
rows that predate the field (see previous entry). Cleared production's
`city_scores` cache via `POST /api/admin/clear-cache` (18 rows) so every
city re-aggregates and shows real figures going forward — confirmed live
locally afterwards (London: 1.1/100k, matching the API directly).

**Removed the small precision glyphs** (country outline / skyline / pin)
that sat next to every KPI value flagging its data tier — no longer
wanted. Removed from the two places they rendered per-stat:
`components/explore/SectionDetail.tsx`'s `StatCell` (dropped the
`PrecisionMark` sub-component entirely) and `app/explore/report/page.tsx`'s
`ReportStat` (dropped its `Icon`/`precision` prop and the explanatory
footnote paragraph). `lib/kpiRows.ts`'s now-unused `PRECISION_LABEL`
export went with it. Left alone: the Country-vs-City *grouping* (headed by
the actual country/city name) that `splitKpiRowsByTier` drives — that's a
separate, still-wanted layout decision, not a per-stat icon. Also left
alone: `PrecisionCityIcon`/`PrecisionCountryIcon`/`PrecisionPinnedIcon` in
`components/ui/icons.tsx` and their unrelated uses in
`app/explore/discover/page.tsx` (the City/Country **scope** toggle buttons,
and the "Nearby" category's icon) — different feature, same glyphs.

## Economy review: dropped "Economy Type" heading, fixed a real GDP-growth bug (2026-09-24)

Same "review each scored category" exercise, now for Economy. Findings:

- **Tier review**: of the 6 fields, only Main economy type is genuinely
  city-level (OSM sector-density, see overpass.ts). The other 5 (growth,
  salary, unemployment, cost of living, purchasing power) have no viable
  free/global/reliable city-level alternative — same recurring Numbeo/paid-
  API wall as Real Estate and Safety's crime data. Nothing added on this
  front; OSM sector-density already is the best available option, it just
  needed fixing (below).
- **Removed the "ECONOMY TYPE" sub-heading** (on request — confusing for a
  single row). "Main economy type" is now just a plain row in `buildKpiRows`
  (precision `"pinned"`), routed into the City group automatically via
  `splitKpiRowsByTier` instead of through its own labeled sub-block.
  `buildCityEconomyTypeRows` (the special-cased helper that used to build
  it) is gone from `lib/kpiRows.ts`, along with its `cityExtraBlocks` wiring
  in `SectionDetail.tsx` and `report/page.tsx` (Liveability's "Local
  Signals" sub-block mechanism stays — it still groups several rows).
- **Found and fixed a real bug**: "Economic growth (5yr GDP)" showed
  `+113.8%` for the UK — obviously wrong. Traced it to
  `gdpGrowth5yrPct: pctChange(gdpGrowth) ?? latest(gdpGrowth)` in
  `lib/data-sources/worldbank.ts` taking a % change of `NY.GDP.MKTP.KD.ZG`,
  which is *already* an annual growth RATE, not a level — a "% change of a
  %" is mathematically unstable, and every current 6-year window includes
  2020's COVID crash as its base year, blowing the number up. Confirmed
  this affects every country, not just the UK (verified UK's raw WB series
  directly: 2020 -10.0%, 2021 +8.5%, ..., 2025 +1.4% — pctChange of that
  series is meaningless). Fixed by switching to `NY.GDP.MKTP.KD` (GDP,
  constant 2015 US$ — a LEVEL series) and taking `pctChange` of *that*,
  the same pattern already used correctly for population. UK now shows a
  sane `+17.3%` cumulative 6-year growth, matching the World Bank API
  directly. Recalibrated `RANGES.gdpGrowth`/`COLOR_RANGES.gdpGrowth` from
  the old annual-rate scale (-5/8) to a cumulative-growth scale (-10/40) in
  `aggregate.ts` and `kpiRows.ts`, plus `randomSeed.ts`'s mock generator and
  `criteria.ts`'s Advanced Search suggested range, so nothing was left
  pointing at the old, now-wrong scale. Cleared the production cache
  afterwards (`POST /api/admin/clear-cache`) so this isn't stuck behind the
  30-day TTL — same "shape/semantics changed, invalidate the cache" pattern
  as the homicide-rate addition above.
- **Known, not yet fixed (user declined this round)**: Main economy type
  still shows "Not enough Data" for London — traced to this session's own
  earlier 3s Overpass timeout cut (see "Three more mobile/perf fixes"
  above) very likely being too tight for this specific 14-tag-group query,
  which is heavier than any other Overpass call in the app. Confirmed live
  on both localhost and piltri.me. Proposed giving this one call its own
  longer timeout, separate from the lighter general-purpose Overpass calls
  — user chose not to take this fix this round, so it's still broken as of
  this entry. Worth revisiting.

## Added a country-level companion for Main economy type (2026-09-24, later same session)

Follow-up to the Economy review above: asked whether any other economic
classification exists, even at country level, given OSM's Main economy
type keeps returning "Not enough Data" for well-mapped cities like London
(that's the timeout issue, still unfixed - see previous entry).

Found a genuine one: World Bank publishes GDP composition by sector
(`NV.AGR.TOTL.ZS` / `NV.IND.TOTL.ZS` / `NV.SRV.TOTL.ZS` - Agriculture/
Industry/Services, each % of GDP), same API already wired in everywhere
else. Verified it's real and meaningfully differentiated before proposing
it: UK is Services-dominant (73%), Saudi Arabia Industry-heavy (43%,
oil-driven), Ethiopia has a notably high Agriculture share (33%).

Added as `dominantGdpSector` (`lib/types.ts`'s new `DominantGdpSector` type)
- whichever of the 3 sectors is largest, via
`pickDominantGdpSector` in `lib/data-sources/worldbank.ts`. Explicitly a
**companion** to `mainEconomyType`, not a replacement - coarser (3 buckets
vs OSM's 6) but near-universally available where OSM's regional density
isn't.

**Both fields now follow an "omit, never placeholder" rule** (on request):
previously `mainEconomyType` showed "Not enough Data" in muted grey when
null; now the row for either field is simply left out of the list when it
doesn't resolve, rather than shown with a placeholder. `buildKpiRows`'s
economy case builds a `(KpiRow | null)[]` and filters nulls at the end -
see that function for the pattern if another field needs the same
treatment later. Both still route into their correct group automatically
via `splitKpiRowsByTier` (`mainEconomyType` precision `"pinned"` → City
group, `dominantGdpSector` precision `"country"` → Country group) - no
component changes needed beyond kpiRows.ts and the usual
types.ts/aggregate.ts/worldbank.ts/randomSeed.ts wiring.

## Dominant GDP sector: coverage check, colour/position fix (2026-09-24, later same session)

Two follow-ups on the field added above.

**Coverage, checked directly against the World Bank API** (not assumed):
queried all 3 indicators (`NV.AGR/IND/SRV.TOTL.ZS`) for every real economy
World Bank tracks (217, excluding aggregate regions like "Arab World").
At least one of the 3 resolves for 208/217 (~96%) — the 9 with none at all
are small territories with no WB reporting (American Samoa, Gibraltar,
Guam, etc.) plus North Korea. All 3 resolve simultaneously for 203/217
(~94%), so a fuller "Agriculture X% / Industry Y% / Services Z%" breakdown
(the "top 3" idea floated) would cost only ~2 points of coverage versus
just picking the largest — genuinely worth doing if a richer breakdown is
wanted later; not implemented this round since only the colour/position
fix was asked for.

**Colour and position fix**: the row rendered in plain black
(`text-ink-900`, this file's default when no `colorClass` is set), which
read as a continuation of the "United Kingdom" country-group heading
directly above it — that heading is also near-black. Two fixes: moved
`dominantGdpSector` from first to last in the economy case's row array (so
it's no longer immediately under the heading), and gave both it and
`mainEconomyType` `text-piltri-amber-dark` (the existing brand accent
colour, already used at country-name-heading size in `CityHeader.tsx`) —
deliberately outside the red-green score spectrum other rows use, since
both are plain descriptive labels, not good/bad values.

## GDP sector: single "Dominant" row → full 1st/2nd/3rd ranking (2026-09-24, later same session)

Following the coverage numbers above (94% of countries have all 3 of
Agriculture/Industry/Services), the user asked for the full ranked
breakdown instead of just the single largest sector.

`lib/types.ts`: `DominantGdpSector` (a bare `"Agriculture"|"Industry"|
"Services"` union) replaced by `GdpSector` (the same union, renamed) plus
a new `GdpSectorShare { sector: GdpSector; sharePct: number }`.
`EconomyFields.dominantGdpSector: DominantGdpSector | null` replaced by
`gdpSectorRanking: GdpSectorShare[]` - always an array (0-3 entries),
largest share first, never padded with a placeholder for a sector that
didn't resolve.

`lib/data-sources/worldbank.ts`: `pickDominantGdpSector` (returned one
winner) replaced by `rankGdpSectors` (returns all resolved entries,
sorted). Still the same 3 indicators (`NV.AGR/IND/SRV.TOTL.ZS`), no new
API calls.

`lib/kpiRows.ts`: renders one row per entry present -
`e.gdpSectorRanking.slice(0, 3).map(...)` → "1st GDP sector" / "2nd GDP
sector" / "3rd GDP sector", each showing `"Services (73%)"` style values.
Genuinely 0-3 rows depending on what resolved for that country, not
always 3.

**Colour, changed again**: the previous round put both this and Main
economy type in brand amber, to get them off black (which read as the
same colour as the country/city heading above them). This round: grey
instead (`text-ink-500`) - the same grey already used for every row's
own label text underneath its value, on request. Both descriptive-label
rows (`mainEconomyType`, and now each `gdpSectorRanking` entry) use it.

## GDP sector rows forced onto one line, app-wide 1-decimal-max rule (2026-09-24, later same session)

**GDP sector rows now always render on one row together.** They used to
be mixed into Economy's main flat KPI list, so where they landed depended
on how many other rows came before them and what column count the shared
grid picked - fragile, and in practice they weren't lining up as one row.
Fixed by pulling them out into their own function,
`buildGdpSectorRows` (`lib/kpiRows.ts`), rendered as a separate,
always-3-column grid appended after the main country grid - in both
`SectionDetail.tsx` (results page / Compare) and `report/page.tsx`
(printable report, via a new `extraRows` prop on `ReportGroup`). Same
pattern already established for Liveability's "Local Signals" sub-block,
just without a heading of its own (three rows have no need for one, and
the user had specifically asked to remove "Economy Type" the day before
for exactly this "unnecessary heading" reason).

**The % share is now visibly smaller than the sector name.** `KpiRow`
gained an optional `valueSuffix` field - rendered in a smaller,
`font-normal` span right after the main value, inheriting the row's own
colour rather than getting one of its own. `buildGdpSectorRows` uses it:
`value: "Services"`, `valueSuffix: "(73.1%)"`. Available for any future
row that wants the same "big label + small detail" shape.

**App-wide rule from here on: no field shows more than 1 decimal place.**
Fixed 3 real violations found this round (there may be others not yet
surfaced - watch for this pattern with any new field):
- Unemployment rate showed raw World Bank precision, e.g. "4.746%" -
  `lib/kpiRows.ts` now calls `.toFixed(1)` on it (the *stored* value stays
  full precision in `EconomyFields.unemploymentRatePct`; only the display
  rounds).
- `CityHeader.tsx`'s `formatCompactNumber` fell through to a bare
  `n.toLocaleString()` for any value under 1000 (its "abbreviate to k/M"
  logic only kicks in at 1000+) - a population density like 283.247/km²
  passed straight through with 3 decimals. Capped at
  `maximumFractionDigits: 1`.
- `lib/unitPreferences.ts`'s `formatAreaKm2` had the same bare
  `toLocaleString()` gap on its metric branch (the imperial branch already
  capped decimals) - a real OSM polygon area like 1,589.23 km² rendered
  with 2 decimals on the printable report page. Same
  `maximumFractionDigits` fix, matching the imperial branch's existing
  pattern.

Deliberately left alone: `PinPanel.tsx`'s dropped-pin lat/lng
(`toFixed(4)`) - that's coordinate precision, not a KPI value, a different
category from what this rule is about.

## Wikidata population/area: shortlist backfill, no more live per-search calls (2026-09-24, later same session)

Triggered by a Supabase email about Data API grants changing Oct 30
(unrelated - see below), which led to a real conversation about *why*
"Not available" kept showing up for city population/density (London,
specifically). Traced it to Wikidata's query service (WDQS) itself:
confirmed live that even a trivial `ASK { ?s ?p ?o }` query timed out
after 30s, while Wikidata's own wiki pages loaded fine - WDQS
specifically, not Wikidata/Wikimedia broadly. `getCityPopulationAndArea`
(lib/data-sources/wikidata.ts) was being called live on every cache miss,
so any city not already cached depended on WDQS answering within
POPULATION_TIMEOUT_MS (6s) - a bad bet given what was just observed.

**The Supabase email is unrelated to any of this** - it's about Data API
grants for *new tables Piltri itself creates* from Oct 30 onward (existing
tables keep their current grants, no action needed there). Worth
remembering for any future migration that creates a new table: add
`grant select on public.<table> to anon;` /
`grant select, insert, update, delete ... to authenticated, service_role;`
in the same migration, or PostgREST returns permission denied. Not
relevant to Wikidata/Overpass/World Bank - those are external APIs called
directly from server code, nothing to do with Supabase's own Data API.

**What shipped**: a true global bulk mirror (every settlement on Earth) was
considered and explicitly rejected - large paginated WDQS queries would
hit the exact same fragility as the trivial query above, worse. Instead,
scoped to what's actually buildable and high-value: a resumable backfill
of the existing ~6,300-city shortlist, exact same shape as
`backfillLandArea.ts` (see that file - this is its Wikidata-population
sibling):

- `schema.sql`: `cities` gains `wikidata_population`, `wikidata_area_km2`,
  `wikidata_checked_at` (same "not attempted vs. real checked negative"
  distinction `osm_land_area_checked_at` already makes). **This needs to be
  run manually in the Supabase SQL editor before this code goes live** - no
  direct DB connection available to this session, only the REST API keys
  (which can't run DDL) - see the `alter table ... add column if not
  exists` block schema.sql now has, safe to run against the already-
  provisioned production database at any time.
- `lib/aggregation/backfillWikidataPopulation.ts` /
  `POST /api/admin/backfill-wikidata-population` / a matching button and
  coverage stats on `/admin` - all mirroring the land-area backfill's
  existing pattern exactly (paced, resumable, stop/resume from the admin
  page).
- `aggregate.ts`: `getCityPopulationAndArea` is now ONLY called live for a
  city the backfill hasn't reached yet (new search, or backfill still in
  progress) - `opts.wikidataChecked` (threaded through from `cache.ts`'s
  read of the `cities` row) skips straight to the stored value otherwise.
  Explore's "search any place on Earth" behaviour is unchanged for a
  genuinely new/unlisted city - only shortlisted, already-backfilled
  cities stop depending on WDQS at request time.

No population floor, no "Less than 1,000" placeholder text - each
shortlisted city gets its real Wikidata figure once backfilled (whatever
it is), and "Not available" stays reserved for a genuine data gap (same
honesty convention as everywhere else), not a stand-in for "we didn't
bother downloading it."

**Not yet done**: the actual backfill run itself (needs WDQS to recover
enough to be usable - it was still failing trivial queries as of this
entry) and someone with Supabase dashboard access to run the schema
migration above.

## Shortlist widened 6,277 -> 66,295 cities, plus two real bugs caught fixing London (2026-09-24, later same session)

User asked why the shortlist was only ~6,300 when GeoNames (already the
source, per `discoverCities.ts`'s own comment) covers far more - it was
built from GeoNames' `cities15000` cut (population >= 15,000). Switched to
`cities5000` (population >= 5,000, or a national capital regardless of
size) - same free source, lower floor. New:
`scripts/generateDiscoverCities.mjs` - downloads fresh cities5000.zip +
admin1CodesASCII.txt + countryInfo.txt from GeoNames every run (not a
one-off script that goes stale; re-run any time to refresh), parses and
cross-references them into `data/static/discover-cities.json`'s
`DiscoverCity[]` shape, de-duplicating same-named-city-in-same-country
collisions by keeping the larger population (protects `cities.slug`'s
unique constraint downstream). Result: 66,295 unique cities across 245
countries/territories (up from 191), file size 14MB (server-only import -
confirmed via grep that every `getDiscoverCities()` caller is an API route
or aggregation module, never a client component, so this doesn't touch
the browser bundle).

**Real consequence worth knowing**: the daily warm-cache cron and both
backfill jobs (land area, Wikidata population) process a bounded batch per
run - the same per-tick throughput now has ~10.5x more cities to reach
full coverage over. Nothing broke, but "how long until the whole shortlist
is warm/backfilled" got proportionally longer in wall-clock terms. Worth
factoring in before assuming the site's coverage stats are further along
than they are.

**Caught while chasing London's still-"Not available" population** (the
Wikidata backfill from two entries up hadn't reached it yet - only ~30 of
the OLD 6,277-city list had been checked, and WDQS's tail latency was
still eating most attempts): manually backfilled London by hand (queried
WDQS directly with a generous timeout - succeeded this time, 8,799,728
people / 1,572 km² - then wrote it straight into Supabase's `cities` row
via a direct REST PATCH, bypassing the slow general sweep for this one
city) - a concrete, verifiable "does the pipeline actually work" proof
before waiting on the full sweep. **Found and fixed a real bug in the
process**: `backfillWikidataPopulation`'s per-call `DEADLINE_MS` (50s)
didn't account for one more in-flight Wikidata lookup already being
allowed to run up to its own `PER_CITY_TIMEOUT_MS` (20s) past that
deadline check - worst-case wall time (70s) blew past
`maxDuration=60`, so Vercel killed the function outright and the
admin page reported "Request failed" with zero progress, even though
individual lookups were succeeding. Fixed by reducing `DEADLINE_MS` to
30s (30+20=50s, genuine margin under 60), same reasoning
`backfill-land-area`'s own deadline already uses.

## Renamed the 4 scored sections (display labels only) (2026-09-24, later same session)

User wanted better names ahead of adding new fields to two of them
(geography/coastal-proximity to Climate, healthcare/education to
Liveability - not yet built, just planned). Renamed:

- Safety & Stability -> **Safety**
- Climate -> **Environment** (broader, ahead of adding terrain/coastal fields)
- Liveability -> **Quality of Life** (matches the term other city-comparison
  tools, e.g. Numbeo's Quality of Life Index, already use for this bucket)
- Economy unchanged

**Display-only, deliberately.** The underlying `SectionKey` identifiers
(`safetyStability`/`climate`/`liveability`) and every JSONB field name in
already-cached Supabase rows are untouched - renaming those would be a much
bigger, riskier refactor (every cached city_scores row, every criteria.ts
key, every component prop) for what was asked as a naming/copy change.
Updated `SECTION_LABELS` (`lib/types.ts`) and `CATEGORY_LABELS` +
individual criterion labels/section-comments (`lib/advancedSearch/criteria.ts`).

Found and fixed one real drift bug while checking for other hardcoded
copies of the old names: `app/explore/discover/results/page.tsx`'s
`SORT_LABELS` had its own separate hardcoded `"Safety & Stability score"` /
`"Climate score"` / `"Liveability score"` strings instead of reusing
`SECTION_LABELS` - would have silently kept showing the old names in that
one dropdown even after this rename. Now derives them from
`SECTION_LABELS` directly so a future rename can't drift there again.

## Environment: distance to beach/mountain, Köppen climate type (2026-09-24, later same session)

Reviewed Environment's 4 existing fields (asked: are these reliable for
every city, and could we have a country-level equivalent). Confirmed live
against extreme cases (Svalbard, McMurdo Station/Antarctica, Nauru, high-
altitude La Paz) that Open-Meteo's reanalysis-based archive has genuine
global coverage - no gaps to worry about. Looked into a country-level
equivalent (World Bank's Climate Change Knowledge Portal API) but couldn't
get clean results from it in testing; the fallback of using each country's
capital-city climate as a stand-in was explicitly proposed and explicitly
rejected on request - too easy to misread as a real national average.
**No country-level climate fields exist, by design, not by gap.**

**Added 3 new city-level fields**, all city/pinned-tier only (see
`lib/types.ts`'s `ClimateFields` comment for why none of these have -or
should have- a country-level equivalent either):

- **`distanceToBeachKm`** / **`distanceToMountainKm`** - genuinely not new
  data engineering: `nearestVerifiedBeach` and `nearestFeatureWithDetails`
  (`natural=peak`) already existed in `overpass.ts`, built and proven for
  the Pin/"Nearby" Advanced Search feature (`lib/aggregation/pin.ts`).
  Reused directly, skipping the Mapbox-POI-name-resolution half of that
  feature (Environment wants a distance, not a place name) - just the
  Overpass path. **Needed a new safety mechanism**: `nearestVerifiedBeach`
  can try up to 4 widening search radii sequentially, each with its own
  ~15s internal budget - a landlocked city's worst case is well over a
  minute, wildly out of step with every other source in `aggregateCityData`
  (already tuned to a ~6s ceiling this session). Added `withTimeout()` (a
  plain `Promise.race` against a timer - doesn't cancel the underlying
  request, just stops the aggregation waiting on it) capping both lookups
  at `FAR_LOOKUP_TIMEOUT_MS` (8s). A city where it can't resolve in time
  gets `null` (row omitted, not a placeholder - same convention as
  `mainEconomyType`), not a wrong answer.
- **`koppenCode`** (Köppen-Geiger climate type, e.g. "Cfb" = temperate
  oceanic) - new file `lib/data-sources/koppen.ts`, a deterministic
  classification formula (Peel/Finlayson/McMahon 2007 formulation) run
  against monthly temperature/precipitation, **not a separate downloaded
  dataset**. The standard alternative (a static Köppen-Geiger raster,
  e.g. Beck et al. 2018) would've meant parsing a large GeoTIFF - computing
  it from data already being fetched is both less work and zero new
  external dependency. **Real methodological catch found while validating**:
  tested against 8 reference cities with known classifications: a 1-year
  window (the same window `getClimateAverages` already uses for the other
  4 fields) misclassified London ("Csa" instead of "Cfb") and Phoenix
  ("BSh" instead of "BWh") - single-year weather noise flipping a
  borderline monthly threshold, when Köppen is properly defined over
  long-term climate normals. Fixed by giving `koppenCode` its own separate
  Open-Meteo call over a 10-year window (`getKoppenClimateType`, not
  `getClimateAverages` - the existing 4 fields' 1-year window is
  unchanged, still "this past year's actual weather", not a climate
  normal) - re-tested, London and Phoenix both corrected. Measured live:
  10 years of daily data is ~83KB/~0.3s, not a latency concern on its own.
  One known-imprecise case remains (Nairobi comes back "Cfb", real-world
  Köppen maps show "Cwb" - a well-documented genuinely borderline case in
  the literature, high-altitude equatorial climates are hard to classify
  cleanly), disclosed as a formula-precision limitation, not chased
  further this round.

Also added: `formatDistanceKm` (`lib/unitPreferences.ts`, metric/imperial
toggle, same 1-decimal-max convention as `formatAreaKm2`), 2 new Advanced
Search range criteria (`climate.distanceToBeachKm`/`distanceToMountainKm`
- climate type itself isn't a filter criterion, ~30 possible codes is too
many for a clean dropdown, same reasoning `mainEconomyType`/
`gdpSectorRanking` are also left out of `criteria.ts`). None of the 3 new
fields feed the Environment score - descriptive facts, not judged
good/bad, same treatment as `mainEconomyType`.

## 4 more Environment fields: humidity, elevation, PM2.5, UV index (2026-09-24, later same session)

Also fixed: Distance to beach/mountain/Climate type were rendering in
black - now grey (`text-ink-500`), same fix already applied to Economy's
descriptive rows, same reasoning (no consensus good/bad direction, so
black read as an implied judgement these rows don't make).

User asked for more candidate fields; proposed and verified 4 before
building anything:

- **Avg annual humidity** - zero extra cost, same `getClimateAverages`
  call as the original 4 fields (`relative_humidity_2m_mean` added to its
  existing `daily=` param list).
- **Elevation** - zero extra cost, free response metadata
  (`json.elevation`) already present on that same call, never read before.
- **Air quality (PM2.5)** and **Avg UV index** - new file
  `lib/data-sources/airQuality.ts`, Open-Meteo's companion Air Quality API
  (CAMS atmospheric reanalysis - same free/keyless provider family as the
  weather archive, separate host/dataset). Verified globally reliable
  before building: London, remote Pacific Nauru, and McMurdo Station/
  Antarctica all returned real data, and a full 1-year historical window
  works (`hourly=pm2_5` averaged across the year; `daily=uv_index_max`
  averaged - a daily max, not raw hourly, since night-time zeros would
  otherwise dilute UV into a meaningless number).

All 4 are city/pinned-tier only (same "no meaningful country-level value"
reasoning as the rest of Environment) and don't feed the section score
except PM2.5, which does get the usual colour treatment (WHO guideline:
under 5 µg/m³ is "good") since lower is unambiguously healthier - humidity/
elevation/UV stay grey/uncoloured, no consensus direction. Both PM2.5 and
UV index are independently-fetched (one API call can fail without the
other), nullable, omitted rather than placeholdered on a genuine miss -
same convention as everything else added this round.

## "What's nearby" moved Environment -> Quality of Life, +forest/capital distance, humidity/UV get colour (2026-09-24, later same session)

User's own instinct, and a good one: `distanceToBeachKm`/`distanceToMountainKm`
were on `ClimateFields`, but "what's nearby" is a Quality of Life question
(same bucket as restaurant density, transport presence), not a climate/
geography fact about the place itself. Moved both to `LiveabilityFields`,
updated `kpiRows.ts` (rows now render under Quality of Life, not
Environment), `criteria.ts` (category + key both changed from
`climate.*` to `liveability.*`), `randomSeed.ts`, `aggregate.ts`.

**Added 2 more distances while moving these**, both landing straight in
Quality of Life from the start:

- **Distance to forest** - same Overpass pattern as mountain
  (`nearestFeatureWithDetails`, tags `natural=wood` + `landuse=forest`,
  same `withTimeout`/`FAR_LOOKUP_TIMEOUT_MS` cap).
- **Distance to capital city** - genuinely different shape: pure geometry
  (haversine), never a live API call. New file
  `lib/data-sources/capitals.ts` reads a static
  `data/static/country-capitals.json` (239 countries), generated
  alongside the city shortlist itself -
  `scripts/generateDiscoverCities.mjs` now also extracts GeoNames feature
  code `PPLC` ("seat of a primary state/national capital") rows from the
  same already-downloaded `cities5000.txt`, no new download. Null only for
  the handful of countries GeoNames has no PPLC row for - never a timeout
  case the way the 3 Overpass-based distances are.

**Humidity and UV now get the usual colour treatment** (were grey/
uncoloured) - user explicitly said "it's okay if we are subjective" when
asked. Both use the same "distance from a disclosed-subjective ideal
centre" shape temperature/rainfall already use: humidity centred on ~50%
(common HVAC comfort figure), UV centred on ~3/"moderate" (balances sun-
exposure benefit against sunburn/skin-cancer risk). Reasonable people can
disagree with either centre - flip on request, same as temperature/
rainfall's own disclosed judgment calls. PM2.5 stays a plain monotonic
"lower is healthier" colour (WHO guideline), not an ideal-centre shape -
there's no amount of particulate pollution that's "too little".

## 4 hazard/readiness fields: seismic, volcanic, coastal flood proxy, ND-GAIN (2026-09-24, later same session)

User asked to research sea-level-rise exposure, climate-change
preparedness, and geological risk for Environment. Researched before
building anything - findings and what shipped:

- **Seismic activity** - real data, not modelled. New file
  `lib/data-sources/usgs.ts`: USGS's free `/count` endpoint, magnitude-5+
  earthquakes within 200km since 1970 (a fixed 55-year window - a
  geological property of the place, not something that should visibly
  change year to year the way a rolling window would). Verified live:
  Tokyo 500, Los Angeles 16, London 0 (5 at magnitude-4+) - real,
  meaningfully differentiated. City-level.
- **Volcanic risk (distance to nearest volcano)** - turned out not to need
  a new dataset at all: OSM directly tags volcanoes (`natural=volcano`,
  even with a `volcano:status` field) - confirmed live via Mt Fuji.
  Reused the exact same `nearestFeatureWithDetails`/`withTimeout` pattern
  already built for mountain/forest, just a different tag and a 100km
  radius (volcanoes are rarer than mountains). City-level.
- **Coastal flood exposure** - explicitly a PROXY, disclosed as one (see
  `ClimateFields.coastalFloodExposure`'s comment and its KPI row's hint).
  A real flood model (NOAA Digital Coast, Climate Central) needs
  high-resolution inundation mapping - real geospatial engineering, not
  attempted here. What shipped instead: bucket `elevationM` +
  `nearestVerifiedBeach`'s own distance (reused, not a second lookup) into
  High (≤5m elevation, ≤2km from coast) / Moderate (≤15m, ≤10km) / Low.
  Only computed when BOTH inputs genuinely resolved - null (not "Low")
  when either is unresolved, since a real "far from any coast" and a
  timed-out lookup must never look the same. City-level.
- **Climate change readiness (ND-GAIN)** - genuinely, inherently
  country-level (national institutional/economic adaptive capacity), not
  a city-data gap - same category as Safety's WGI scores. New script
  `scripts/generateClimateReadiness.mjs` downloads Notre Dame's free,
  annually-updated country index (a zip of CSVs, not a live API - the
  download link needs browser-like headers, a plain curl gets 403) and
  writes `data/static/climate-readiness.json` (187 countries). New reader
  `lib/data-sources/climateReadiness.ts`. Sanity-checked the real numbers
  before shipping: Norway 71.8 (most ready), UK 68.6, US 65.7, Bangladesh
  37 (much more vulnerable) - matches well-known reality.

None of the 4 feed the Environment score (descriptive facts, same
treatment as Köppen/mainEconomyType) - only affects display.

## Longest/shortest day, label simplification, City-group reorder (2026-09-25)

User asked about "hours of light" - clarified into Longest Day/Shortest
Day (day length swing) vs light pollution before building either.

**Longest Day / Shortest Day** - new file `lib/data-sources/daylight.ts`,
pure astronomy (solar declination/hour-angle formula), zero external
dependency, computed from latitude alone. Deliberately NOT an "avg annual
daylight" field - averaged over a full year every location gets almost
exactly 12 hours (orbital mechanics), which wouldn't differentiate any
two cities. Shows the summer/winter solstice day length instead (the
actual seasonal swing). Verified against known reference values before
shipping: London 16.4h/7.6h (real ~16.5/~7.7), Singapore 12.1h/11.9h,
Oslo 18.5h/5.5h, Longyearbyen (Arctic) 24.0h/0.0h (correct polar-day/
polar-night clamping) - all within expected precision of the
approximation formula.

**Light pollution - not built, no free source found.** Checked
lightpollutionmap.info's point-query API - requires a paid/registered key,
unlike every other source in this app. Flagged to the user rather than
silently skip or ship a weak proxy; no further action unless they want to
register for a key themselves or accept a disclosed proxy (e.g. population
density, which we already have per city).

**Label simplification** (on request - raw values read as too technical):
- Seismic activity: was "0 quakes (M5+)" -> now "Low"/"Moderate"/"High"
  (thresholds calibrated against real tested cities: London 0 = Low, LA 16
  = Moderate, Tokyo 500-800+ = High). Real count moved to the hint.
- Air quality: was "8 µg/m³ (PM2.5)" -> now "Good"/"Moderate"/"Poor"/"Very
  poor" (WHO's own <5 µg/m³ = "Good" guideline anchors the low end). Real
  µg/m³ figure moved to the hint.

**Reorder**: Climate type and Elevation moved to the end of Environment's
City group (were mid-list) - on request, so the more comparative/human
stats (temperature, air quality, daylight, hazards) read first.

## Reverted seismic/air-quality labels back to real numbers (2026-09-25)

The Low/Moderate/High and Good/Moderate/Poor wording from the previous
entry read as inconsistent with every other Environment row showing an
actual figure (temperature, rainfall, UV index, etc.) - reverted. Seismic
activity now shows "N quakes" again, air quality "N µg/m³" again - just
the unnecessary "(M5+)"/"(PM2.5)" bracket suffixes dropped from the
label/value themselves (still in each row's hint for anyone who wants the
technical detail). Removed the now-unused `airQualityLabel`/
`seismicActivityLabel` helpers from `lib/kpiRows.ts`.

## Economy: GDP (current US$), GDP world rank, tax revenue % of GDP (2026-09-25, later same session)

Three new country-level Economy fields, all from World Bank (already the
Economy/Safety country-data provider, no new integration needed):
- **GDP** (`NY.GDP.MKTP.CD`, current US$) - shown headline-style, e.g.
  "$4.0 trillion" / "$312.5 billion" (new `formatGdpUsd` helper in
  `lib/kpiRows.ts`). Deliberately a separate World Bank series from the
  existing `economicGrowth5yrGdpPct`, which uses constant-2015-$ GDP
  (`NY.GDP.MKTP.KD`) to isolate real growth from inflation/FX noise - this
  one wants the actual current-dollar size people recognise.
- **GDP world rank** (e.g. "5th") - NOT a per-country World Bank call.
  `getGdpWorldRanking()` in `lib/data-sources/worldbank.ts` does ONE bulk
  request for every country's current-$ GDP, filters out the aggregate
  regions World Bank mixes into that endpoint (World, OECD members, Euro
  area, ...) via a new `REAL_ISO3_CODES` set (cross-referenced against the
  app's existing `ISO2_TO_ISO3` map, zero extra requests), sorts
  descending, returns an ISO3->rank Map. Wrapped in `memoize()` with a
  fixed shared key (`"gdp-world-ranking"`, not per-country) in
  `aggregate.ts` - same result for every city, no reason to refetch per
  country. Verified live: 214 real countries, US #1 (~$30.8tn), China #2,
  ..., UK #5 (~$4.0tn) - matches known reality.
- **Tax revenue** (`GC.TAX.TOTL.GD.ZS`, % of GDP) - standard taxation-level
  measure, shown as "N.N% of GDP".

All 3 are grey/descriptive (`text-ink-500`), same reasoning as Main
economy type and GDP sector ranking above them: a country's GDP size,
world rank, and tax share are plain facts with no universal "better"
direction, not a red/green judgement. Added to `EconomyFields`
(`lib/types.ts`), `randomSeed.ts` mocks, and 3 new range criteria in
`lib/advancedSearch/criteria.ts` (GDP in billions, world rank 1-214, tax
revenue %), following the exact pattern every other field addition this
session has used.

## Economy row reorder + colour for GDP/rank + salary "/ year" (2026-09-25, later same session)

On request, restructured the Economy Country group's row order and added
colour to 2 of the 3 new fields from the previous entry:
- **Line 1: GDP, GDP world rank, Economic growth** - the 3 lead. GDP and
  GDP world rank are now coloured (they were plain grey before) - "higher
  the better": GDP uses a **log10** scale in `COLOR_RANGES.gdpUsdLog10`
  ($1bn-$30tn, `lib/kpiRows.ts`) rather than linear, since GDP spans ~4
  orders of magnitude across countries and a linear 0-100 scale would
  clamp almost every country below the US/China into the same "weak"
  bucket. GDP world rank uses `normalise(rank, 1, 214, invert: true)` -
  rank 1 (largest economy) is the best outcome, so the colour direction is
  inverted relative to the raw number. Tax revenue stays grey/descriptive
  (a policy choice, not a good/bad outcome).
- **Line 2: the 3 GDP sectors** (Services/Industry/Agriculture) - this
  block already existed as its own always-3-column grid
  (`buildGdpSectorRows`), rendered unconditionally AFTER all country rows.
  To land it as line 2 specifically (between GDP/rank/growth and the rest)
  rather than always-last, `SectionDetail.tsx` and `report/page.tsx` now
  split Economy's country rows at index 3 (`countryRows` /
  `countryRowsAfterSectors`) and render: first 3 -> GDP sectors -> the
  remaining country rows. Every other section is untouched - this split
  only activates when `section === "economy"`.
- **Line 3: Tax revenue, Average salary, Unemployment rate.**
- **Line 4: Cost of living index, Purchasing power index.**
- **Average salary** now shows a small `/ year` suffix (new `valueSuffix`
  on that row) - it was previously an unlabelled annual figure, easy to
  misread as monthly.

`buildKpiRows`'s economy row array in `lib/kpiRows.ts` now literally
returns rows in this final order (bar GDP sectors, which is a separate
function/grid) - the components no longer reorder anything, only split.

## Sea level rise exposure: researched real datasets, shipped as a second disclosed proxy (2026-09-25, later same session)

User asked specifically about sea-level-rise exposure at city level. Researched real free global datasets first (on request, before building anything):
- **[Young & Kirezci 2024 extreme sea levels dataset](https://doi.org/10.26188/25874179)** (Univ. Melbourne, CC BY 4.0, free) - 574MB zip, NetCDF extreme-sea-level grid + flood-extent polygons, but its socioeconomic impact numbers are only aggregated to national/regional level - wouldn't actually deliver city-level answers.
- **[DeltaDTM](https://research.tudelft.nl/en/datasets/deltadtm-a-global-coastal-digital-terrain-model/)** (TU Delft, public domain) - genuinely city-precise 30m coastal elevation model, but ships as multi-GB-per-continent GeoTIFF tiles - needs raster-reading tooling (GDAL-equivalent) this Node stack doesn't have, a materially bigger lift than every other data source here (all fetch-and-parse JSON/CSV).

Conclusion: no free, lightweight, per-city API/dataset exists the way every other field here has one. Shipped the disclosed-proxy option instead (agreed with the user to revisit if/when GeoTIFF support is worth adding).

Added `seaLevelRiseExposure: "High" | "Moderate" | "Low" | null` to `ClimateFields` (`lib/types.ts`) - reuses the exact same 2 inputs as the existing `coastalFloodExposure` (elevationM + beach/coastline distance from Overpass, computed in `aggregate.ts`), but with deliberately different, wider thresholds so the 2 fields don't read as duplicates of each other:
- `coastalFloodExposure` asks "could a storm surge/high tide flood this place today" (≤5m elev/≤2km coast = High, ≤15m/≤10km = Moderate) - a short-range flood proxy.
- `seaLevelRiseExposure` asks "is this place low-lying enough near the coast to be a long-term concern" (≤2m elev/≤10km coast = High, ≤10m/≤25km = Moderate) - thresholds referenced against IPCC AR6's published ~1m high-end 2100 sea-rise projection, not a storm event.

Both stay null (not "Low") when either input didn't resolve - same "unresolved ≠ safe" convention as every proxy field this session. Wired into `kpiRows.ts` (Low=green/Moderate=amber/High=red, same colour pattern as coastalFloodExposure), `randomSeed.ts` mock, and a new `climate.seaLevelRiseExposure` select criterion in `criteria.ts`.

## Quality of Life: removed "Local Signals" heading, fixed capital-distance rounding, stopped hiding Overpass outages as fake zeros (2026-09-26, later same session)

User reported "most of the fields aren't working at the moment" in Quality of Life. Investigation found 3 separate issues, all fixed:

1. **"Local Signals" sub-heading removed** - read as confusing, not clarifying. Transport Access rows (Train station/Subway/Tramway/Airport) now fold directly into the main City grid in `SectionDetail.tsx` and `report/page.tsx` - no separate labeled sub-block. `ReportSubBlock` (now unused) removed from `report/page.tsx`.

2. **Distance to capital city showed "0.2 km" for London itself, not "0 km"** - the searched city's coordinate (from Mapbox geocoding) and this app's own static GeoNames capital-coordinate table are two independent geocodes of the same real-world point, so a small sub-km gap between them is noise, not a genuine distance. `distanceToCapitalKm` (`lib/data-sources/capitals.ts`) now snaps to exactly 0 under a 1km threshold.

3. **The real "most fields aren't working" cause**: `restaurantsBarsDensityPer10k`/`greenSpaceScore`/`culturalVenuesDensityPer10k`/`familyKidsActivitiesDensityPer10k`/`hasTrainStation`/`hasSubway`/`hasTramway`/`hasAirport` all come from ONE combined Overpass call (`getCityOverpassData`). When that single call fails - which Overpass has been doing on and off all session (see the seismic/coastal-flood/volcano entries above) - these 8 fields were silently defaulting to `0`/`50`/`false` instead of `null`, so a live Overpass outage showed as confidently wrong data ("0 restaurants", "No train station" - for London). Fixed: all 8 fields are now genuinely nullable in `LiveabilityFields` (`lib/types.ts`), default to `null` (not a fake value) in `aggregate.ts` when `overpassData` is null, and are **omitted** from the KPI list in `kpiRows.ts`/`buildLiveabilityTransportRows` rather than rendered as misleading zeros - same "omit, don't guess" convention `distanceToBeachKm` etc. already used. The Liveability section *score* still needs a number to average, so `aggregate.ts`'s score calculation keeps its own internal 0/50 fallback for scoring only - never exposed to what's displayed. Verified live during an actual Overpass outage: Quality of Life for London correctly showed only Healthcare quality score + Distance to capital city (0 km), nothing fabricated.

Given how much of this section leans on one single point of failure (Overpass), also reviewed for new, more reliable Quality of Life data to propose - see the conversation for that writeup (not yet built, pending the user's choice of which to pursue).

## Quality of Life resilience: stale-cache fallback + 2 new World-Bank-only fields (2026-09-26, later same session)

Followed up on the previous entry's proposal with both parts the user asked for:

**A. Cache resilience** - `lib/aggregation/cache.ts`'s `getOrAggregateCityData` now has `preserveStaleOverpassFields()`, called on every stale-cache REFRESH (not a brand-new city). Reasoning: these Overpass-derived facts (restaurant/green-space/cultural/family density, transport presence flags, distance to beach/mountain/forest, plus Environment's distanceToVolcanoKm/coastalFloodExposure/seaLevelRiseExposure) don't actually change on a 30-day timescale - a freshly-null field on a refresh is far more likely to be "Overpass didn't answer this time" than "this city moved". So a null on refresh now falls back field-by-field to whatever the previous cache row had, instead of overwriting up to CACHE_TTL_DAYS of good data with a null the moment Overpass has a bad minute. A genuinely improved/changed value on any field that DID resolve still overwrites as normal - this only fills gaps.

**B. Two new Overpass-independent fields** - added to `LiveabilityFields`/Quality of Life, both from World Bank (same reliable API already powering Economy/Safety, zero new integration):
- **Life expectancy** (`SP.DYN.LE00.IN`, years)
- **Internet access** (`IT.NET.USER.ZS`, % of population)

Also considered and rejected: literacy rate (`SE.ADT.LITR.ZS`) - verified live that the UK and US both come back with an empty series (most developed countries simply don't report it), too patchy to be reliable. World Happiness Report (a genuinely good fit) was also considered but needs a heavier one-time CSV ingestion (like ND-GAIN) - not done in this pass, flagged as a possible follow-up.

Both new fields are country-tier, coloured (higher = better), and deliberately NOT fed into the Liveability section score (informational only, same as GDP/GDP world rank/tax revenue in Economy) - adding them to the score would be a scoring-weight decision, not a data-reliability one. Verified live: UK 81.4yrs/95.5% internet, US 78.9yrs/94.7%, India 72.2yrs/70%.

Net effect, verified live during an actual Overpass outage: Quality of Life for London now shows Healthcare quality score, Life expectancy, Internet access, and Distance to capital city - real content instead of an almost-empty card.

## PISA schooling-quality scores added to Quality of Life AND the score (2026-09-26, later same session)

User asked whether real school-system rankings exist and, if so, to count them in the Piltri Score (not just display them - unlike every other field added this session). They do: **OECD PISA** mean scores (mathematics/reading/science, 15-year-olds), and it's mirrored directly into World Bank's own API (`LO.PISA.MAT`/`LO.PISA.REA`/`LO.PISA.SCI`) - same reliable source already used for Economy/Safety/the other new Quality of Life fields, zero new integration.

Coverage caveat, verified live: only the ~80 countries that actually sit the PISA test have any value (Nigeria/India/South Africa genuinely have none - not a data gap, non-participation) and the latest cycle World Bank has mirrored is **2018** - PISA has run newer 2022 and 2025 cycles, but World Bank hasn't picked those up yet. Still a legitimate, consistent cross-country comparison, just not current-year (flagged to the user as a known limitation of this integration path vs. a heavier direct-OECD ingestion).

Added `pisaMathScore`/`pisaReadingScore`/`pisaScienceScore` to `LiveabilityFields` - shown as 3 separate rows (not a single composite), coloured on a `{min: 350, max: 590}` range matching the real observed global spread. **Unlike GDP/life expectancy/internet access, these DO feed the Liveability section score** (`aggregate.ts`'s new `pisaAverage` - mean of whichever subjects resolved, defaulting to ~470/the OECD-wide average for a non-participating country so non-participation neither rewards nor penalises a score). Verified live: London/UK math 502, reading 504, science 505, Quality of Life score moved 28 -> 34 with PISA included.

## Distance to capital city moved to the City group (2026-09-26, later same session)

`kpiRows.ts`'s "Distance to capital city" row was `precision: "country"`, grouping it with United Kingdom-level facts even though it's genuinely a statement about THIS city's own position (same conceptual group as Distance to beach/mountain/forest right above it) - just sourced from a static country-level lookup table rather than a live per-city API, which shouldn't determine its display group. Changed to `precision: "pinned"` so it renders under the City heading. Verified live: for London, "Distance to capital city — 0 km" now sits under "London", not "United Kingdom".

## Overpass amenities backfill: eliminates the live-request dependency for 11 Quality of Life fields + 3 new presence flags (2026-09-26, later same session)

Directly followed up on "digging" into why Distance to beach/green space/transport presence kept coming back empty (Overpass has been unreliable all session - confirmed multiple outages). Built the same resumable-backfill architecture already proven for `backfillWikidataPopulation.ts`, applied to Overpass:

- **New**: `lib/aggregation/backfillOverpassAmenities.ts` + `POST /api/admin/backfill-overpass-amenities` + an "/admin" page button, all mirroring the Wikidata backfill's exact shape (resumable via `cities.overpass_checked_at`, paced at 1.5s/city, 20s per-city timeout for a background job that can afford to wait longer than a live page load).
- Runs the SAME 4 Overpass calls `aggregateCityData` makes live (`getCityOverpassData` + `nearestVerifiedBeach` + 2x `nearestFeatureWithDetails` for mountain/forest) per shortlisted city, once, and stores the combined result as one `cities.overpass_amenities` JSONB blob (`OverpassAmenitiesBackfill` in `lib/data-sources/overpass.ts`) - schema migration (`overpass_amenities jsonb`, `overpass_checked_at timestamptz`) run manually in the Supabase SQL editor before this deployed.
- `aggregate.ts`'s `aggregateCityData` now accepts `opts.overpassChecked`/`overpassAmenities` (same pattern as `osmLandAreaKm2`/`wikidataChecked`) - a shortlisted, already-backfilled city skips ALL 4 live Overpass calls entirely and reads its stored value instead; a city outside the shortlist still falls back to the live call, unchanged. `withTimeout` exported from `aggregate.ts` so the backfill can reuse it rather than duplicating.

**Also added 3 presence flags that didn't exist at all before** (user explicitly asked for Bus/School/University alongside the existing Train/Subway/Tram/Airport): `hasBusStation` (`highway=bus_station`/`amenity=bus_station`, deliberately NOT the far more common `highway=bus_stop`, which is too ubiquitous to be a meaningful "does this city have one" signal), `hasSchool` (`amenity=school`), `hasUniversity` (`amenity=university`) - folded into the same single batched Overpass query (`getCityOverpassData`, now 17 tag groups instead of 14, still 1 HTTP request), same null-means-unresolved convention as the other 4 flags.

The stale-cache-fallback resilience fix from 2 entries up and the cache-resilience Overpass field list in `cache.ts` were both extended to cover these 3 new flags automatically.

## Fixed a real bug: all 3 backfills' cities-upsert step was sequential at 66k-city scale (2026-09-26, later same session)

First live run of the new Overpass amenities backfill (previous entry) came back `attempted: 0, remaining: 66295, stoppedReason: "deadline"` - the whole 30s deadline was eaten before a single city's actual Overpass lookup even started. Root cause: the "ensure every shortlisted city has a `cities` row" upsert step (shared code shape across all 3 backfills) looped through ~221 chunks of 300 cities each with a plain sequential `for...await`, not `Promise.all` - fine at the original ~6,300-city shortlist size, but the shortlist widened to ~66,300 cities (2026-09-24 entry above) and nobody had re-run any backfill against it since. Same exact regression class `cache.ts`'s `getCachedCityDataBatch` and `admin/status` already hit and fixed after that widening - just not yet applied to the 3 backfill files, since 2 of them predate the widening and the 3rd (Overpass) was only just built.

Fixed in all 3: `backfillLandArea.ts`, `backfillWikidataPopulation.ts`, `backfillOverpassAmenities.ts` now `Promise.all` their upsert chunks instead of awaiting one at a time.

## Resources: section titles bold/black, site names non-bold/grey; top-5 job board + real estate sites pushed for ~40 major countries (2026-09-26, later same session)

**Styling** (`components/explore/ResourcesDetail.tsx`, used by both `ResourcesDetailPanel` and the printable report page) - section titles ("Property"/"Visa and Immigration"/"Health System"/"Jobs") were grey/uppercase; site name links were amber/medium-weight. Swapped: titles now `font-bold text-ink-900` (black), links now `font-normal text-ink-500` (grey) - titles read as the stronger element, links as plain secondary text (hover-underline kept).

**Content**: user asked for the top 5 job board sites and top 5 real estate sites pushed per country. The existing `home`/`jobs` categories (already in `ResourceLinkCategory`, no new category needed) had exactly 1 curated link each from an earlier "curate all 171 shortlisted countries" pass (2026-09-23) - mostly a government job portal + one property portal. Added up to 4 more of each for **~40 major countries** (US, UK, Canada, Australia, most of Western/Northern/Central Europe, Japan, India, UAE, Brazil, Mexico, Argentina, South Africa, New Zealand, Singapore, Malaysia, Philippines, Thailand, Turkey, Israel, Greece, Czechia, Hungary, Romania, South Korea) via the existing `POST /api/admin/resource-links/bulk` endpoint, reaching 5 per category for most of them - a few countries only reached 3-4 where a confidently-accurate 5th site wasn't available from general knowledge (Norway, Sweden, Hungary in particular - real estate markets there are dominated by 1-2 portals, no fabricated site was added to force the count).

**Important caveat, told to the user directly**: this batch is built from general knowledge, not independently verified live (no site-by-site check that every URL still resolves and is still the current market leader) - the other ~130 shortlisted countries were deliberately NOT touched in this pass, since fabricating plausible-sounding site names for markets without solid confidence would violate this app's own "never guess/fabricate" standard applied everywhere else. Worth a spot-check pass, and a follow-up session to extend coverage to more countries with real per-country research rather than from-memory recall.

## Getting oriented fast

Start with `lib/types.ts` (the whole data model — read its file header
comment first), `lib/aggregation/aggregate.ts` (the real data-fetching
orchestration — every field's source is named directly in comments there),
`lib/advancedSearch/criteria.ts` (every filterable criterion, its ranges,
and per-scope overrides), and `app/api/explore/discover/route.ts` (the
Advanced search matching engine). `lib/aggregation/cache.ts` is the
caching layer — see "After changing CityExploreData's shape" above before
you touch it.
