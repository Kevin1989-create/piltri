# Known issues — pre-production

Logged 2026-07-27. To revisit before launch.

## 1. Loading performance (highest priority)
Left section and Pin panel take too long to appear/load. Root causes likely:
- Pin mode fires ~13 parallel lookups per pin (`lib/aggregation/pin.ts`), several hitting Mapbox category search + Overpass, with Overpass fallback chains (Beach now searches up to 4 radius tiers sequentially).
- No caching layer on repeated Overpass/Mapbox queries for the same area.
- Overpass public API itself is often slow/rate-limited server-side, outside our control.

Not yet scoped or started. Candidate next steps: add response caching (even short-TTL) per lat/lng bucket, tighten fetch timeouts, run more lookups in parallel where currently sequential, consider a loading skeleton so perceived latency drops even if actual latency doesn't.

Update (Advanced search, /explore/discover): the new "Nearby & distance" filter category (Beach, Subway, School, etc., evaluated at each candidate's city centre) adds ~13 more live lookups per candidate whenever at least one Nearby filter is active — on top of the existing per-city aggregation. It's only triggered when actually used, and results are cached in-memory per server process, but a cold-cache Advanced search using a Nearby filter across the full city shortlist will be noticeably slower than one that doesn't. Same root fix as above (real caching, tighter timeouts) applies here too.

## 2. Beach and Subway fields sometimes empty
Reported empty for London across multiple rounds despite three rounds of fixes (widened radius, tiered search, added coastline fallback, added Overground/light-rail/subway_entrance tags). Root cause never conclusively identified — sandbox used for this work has no network access to Mapbox/Overpass, so all fixes were static-analysis-only, never runtime-verified. Needs a real browser session: check Network tab response for `/api/explore/pin` to see what the aggregation actually returns for a known-bad pin, which would give ground truth instead of guessing.

## 3. Can't pin a specific map-flagged place (main or second pin)
Clicking a labelled feature on the map (a shop, station, neighbourhood name) is meant to snap the pin to it and show its name. Implemented via two-step resolution (rendered-feature query, then reverse-geocode fallback) for both the main and second pin, but never runtime-verified for the same sandbox-network reason as #2. Needs browser testing to confirm the click hit-test and popup actually behave as intended.

---
Common thread on #2 and #3: both were "fixed" repeatedly via code review and static typing only. Before production, they need an actual test pass in a browser with real Mapbox/Overpass traffic, not just another round of static changes.
