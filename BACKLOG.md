# Piltri - backlog

The owner's requests and planned work, roughly in order. Updated
2026-10-28. When an item is done it leaves this list (the details live in
`HANDOFF.md` and the git history).

## Now

- **Data refresh with phase 1** (local figures): re-run on 2026-10-28
  after WHO's API outage failed the first attempt; check Lyon, Kharkiv,
  Lagos and a village on the live site afterwards.
- **Findable on Google**: a title and description for each place and
  country page, a sitemap of every place, robots.txt (2026-10-28).

## Map (owner, 2026-10-28)

1. **A Yes shows only a few places (defect).** In London, "Train
   station: Yes" or "School: Yes" flags a handful of places where there
   are hundreds. Cause: since 2026-10-14 the dataset keeps the 6 nearest
   of each kind per place (`nearby/`) and the map flags only those. Fix:
   draw every one from the map's own OpenStreetMap layer (the OpenFreeMap
   tiles already carry schools, stations, hospitals...) filtered to the
   figure's kind, so all of them show, without growing the dataset. The
   Yes and the counts stay as computed (Overture); check that the two
   agree on London, Lyon and a village.
2. **An icon per kind instead of the amber flag**: a school for schools, a
   child for nurseries, a train for stations, a cross for hospitals, a
   tree for parks... It has to look good: one consistent set (Maki, CC0 -
   the set the map's own style uses - or drawn to match), in Piltri's
   colours, readable at small sizes.
3. **No message at the bottom of the map on load.** It's OpenStreetMap's
   credit, opened for 4 seconds on purpose (`lib/mapAttribution.ts`). OSM's
   licence needs a visible credit, but a small permanent "© OpenStreetMap"
   line in a corner meets it without the pop-up.
4. **A button to expand the map** (desktop and phone), with a close button.
   Phones already open the map full screen for a figure (`mapFullScreen`
   on the city page); this extends it.
5. **More detail on the map**: names of key streets, buildings, stations.
   The style (OpenFreeMap "liberty") has them, but at the default zoom
   (the whole 5 km area) most labels are hidden. Options: show the key
   labels from a lower zoom, start a little closer, and the expanded map
   (4) for exploring.
6. **Search an address inside a city** (owner's question; recommended).
   - Free and offline: search the street and place names in the map tiles
     already loaded for the city - streets, stations, shops, but no house
     numbers. No new service.
   - Full addresses with house numbers need a geocoding service while
     people browse (Photon by Komoot or Nominatim, free with fair-use
     limits): a second exception to the "no runtime data APIs" rule, like
     the road journeys on 2026-10-16 - the owner's call.
   Suggested: the offline search first.

## Accounts (owner, 2026-10-28)

7. **Accounts and saved spots**: sign in, save exact spots on the map
   (with a note), find them again on any device. Fits the zero-cost rule
   with Supabase's free sign-in and database, which would also keep
   Supabase active. Needs a privacy notice (emails and saved places are
   personal data - GDPR), account deletion, and a choice of sign-in
   (email link, Google...). Suggested after the Cloudflare move; a first
   step without accounts: spots saved in the browser and shared by link.

## Data

8. **Phase 2 - Europe and the US** (licence checks done 2026-10-28; see the
   assessment doc linked in `HANDOFF.md`). Eurostat regions first, then
   France, UK, Spain, Italy, Germany, US federal sources. No GISCO region
   maps (non-commercial): match places through commune codes or
   OpenStreetMap's NUTS-tagged regions.
9. **Phase 3** - other data-rich countries (Canada, Australia, Japan,
   Mexico, Brazil...).
10. **Advanced search filters** for the phase 1 local figures (age,
    growth, hospital, armed conflict, regional GDP).
11. **Owner to decide: local figures in the scores.** Suggested: armed
    conflict nearby in Safety, nearest hospital in Quality of Life; not
    regional GDP (86% coverage, high in commuter centres).

## Hosting

12. **Move from Vercel to Cloudflare's free hosting** - after the items
    above (owner, 2026-10-28). Vercel's free plan holds 10 GB of
    deployments (~350 MB each) and forbids commercial use. Note for later:
    one prerendered page per place (146,800 files) would exceed
    Cloudflare's 20,000-file free limit, so keep one page per kind as
    today.
