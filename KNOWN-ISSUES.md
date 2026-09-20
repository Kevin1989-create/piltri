# Known issues — pre-production

Logged 2026-07-27. Updated 2026-09-20 after the data-model simplification
(see HANDOFF.md) — several items below were resolved as a side effect of
that work, not independently fixed.

## 1. Loading performance — largely resolved for Pin mode
Pin mode used to fire ~13 parallel lookups per pin (schools, subway, high
street, hospitals, etc.), several hitting Mapbox category search + Overpass
with multi-tier fallback chains — the main source of slow/inconsistent pin
loads. Pin mode (`lib/aggregation/pin.ts`) now resolves just 4 fields (Beach,
Mountain, Train station, Airport), cutting the per-pin lookup count by ~70%.
Not yet addressed: no caching layer on repeated Overpass/Mapbox queries for
the same area, and Overpass's public API itself is still often slow/rate-
limited server-side, outside our control — a real fix (short-TTL response
caching per lat/lng bucket, tighter timeouts) is still worth doing if pin
loads are still felt to be slow in practice.

Advanced search's "Nearby & distance" filter category is trimmed the same
way (4 fields: Beach, Mountain, Train station, Airport — was 13), so the
same "~13 extra live lookups per candidate" cost described here previously
no longer applies at anywhere near that scale.

## 2. Beach field sometimes empty
Reported empty for London across multiple rounds despite several fixes
(widened radius, tiered search, coastline fallback). Root cause never
conclusively identified in earlier sessions (no network access to verify
at the time). Subway is no longer part of Pin mode at all (dropped in the
September 2026 simplification — see HANDOFF.md), so that half of the
original issue title is moot. Beach itself uses the same verification logic
as before (`isNearCoastOrLake` / `nearestVerifiedBeach` in
`lib/data-sources/overpass.ts`) and was runtime-verified working correctly
for at least one pin during this session (correctly reported "Not found
nearby" for a pin with no real beach in range) — but London specifically
hasn't been re-tested. Worth a specific check before calling this resolved.

## 3. Can't pin a specific map-flagged place (main or second pin)
Clicking a labelled feature on the map (a shop, station, neighbourhood name)
is meant to snap the pin to it and show its name. Implemented via two-step
resolution (rendered-feature query, then reverse-geocode fallback) for both
the main and second pin. Still not specifically runtime-verified — pins
dropped during this session's testing landed on arbitrary map points, not
deliberately on a labelled POI, so this hasn't actually been exercised yet.
Needs a deliberate test: click directly on a labelled shop/station icon and
confirm the pin snaps to it with the correct name in the popup.
