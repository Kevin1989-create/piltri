# Piltri - backlog

The owner's requests and planned work, roughly in order. Updated
2026-10-28. When an item is done it leaves this list (the details live in
`HANDOFF.md` and the git history).

## Now

- **Phase 1, regional GDP left out**: refreshes #14 and #15 (2026-10-28)
  left out regional GDP (Kummu, Zenodo), which works locally - most likely
  Zenodo's download from GitHub's machines. Since `ab679fa` downloads wait
  as long as a busy server asks and GitHub keeps the files; run #16 and
  check the run page's annotations if it's still missing. (Average age
  failed in #14 only and is live since #15.)
- **Search engines: kept out until December** (owner, 2026-10-28: "not
  until it's clean"). Ready and waiting: page titles and descriptions,
  the sitemap of every place, robots.txt. Every page says noindex for now.
  To open up: `SEARCH_ENGINES_WELCOME = true` in `next.config.js`, the
  Sitemap line back in `public/robots.txt`, then the owner adds the site
  to Google Search Console and submits `https://www.piltri.me/sitemap.xml`.

## Map (owner, 2026-10-28)

Done 2026-10-28: a Yes shows every place of its kind within its radius
(from the map's own tiles - `lib/mapPlaces.ts`; care homes aren't in them
and keep the dataset's nearest 6), an icon per kind
(`components/explore/mapIcons.ts`), a small permanent credit line instead
of the pop-up (`MapCredit`), and an expand button.
Done 2026-10-29: a layer list on the map (several kinds at once); zoomed
in, every one in view anywhere in the city, not only the 5 km around the
centre (owner: London's Yes stopped at "zone 1"); a Yes draws its 5 km
circle.

Built 2026-10-29, live after the next refresh: "Yes / No in the city"
(owner: "within the border of the city", "1 km as the basis", every kind).
A Yes = in the city's outline or within 1 km of it (5 km of the centre
with no outline), its places all on the map; a No = "nearest 12 km", its
journey on the map. One row per kind (16, airports and nature included),
replacing the old Yes/No and distance pairs. No count shown: Overture
lists university departments and clinics, so numbers would mislead.
Size: +42 MB compressed (151 MB), ~530 MB per Vercel deployment.

4. **Advanced search and leaderboards still use "within 5 km"** for
   stations, schools... - align them with "in the city" (needs search
   columns from insideCounts).

5. **More detail on the map**: names of key streets, buildings, stations.
   The style (OpenFreeMap "liberty") has them, but at the default zoom
   (the whole 5 km area) most labels are hidden. Options: show the key
   labels from a lower zoom, start a little closer; the expanded map
   helps for exploring.
6. **Search an address inside a city** (owner's question; recommended).
   - Free and offline: search the street and place names in the map tiles
     already loaded for the city - streets, stations, shops, but no house
     numbers. No new service.
   - Full addresses with house numbers need a geocoding service while
     people browse (Photon by Komoot or Nominatim, free with fair-use
     limits): a second exception to the "no runtime data APIs" rule, like
     the road journeys on 2026-10-16 - the owner's call.
   Suggested: the offline search first.
7. **City outlines: fewer estimated ones** (owner, 2026-10-28: "not only a
   London issue"). Of 146,800 places, 63% get an official border
   (OpenStreetMap, via Overture), 34% the built-up area estimated from the
   population grid, 3% the 5 km circle. London is estimated: OpenStreetMap's
   only "London" is the 3 km² City of London. No other map fixes this -
   Google doesn't share its outlines, Mapbox / HERE / TomTom sell theirs
   under paid licences. Two steps here (the rest is in phases 2-3):
   - Match OpenStreetMap borders by their Wikidata id, not only by name
     (would find "Greater London" and the like), worldwide - ~1 session.
   - Say on the map when an outline is the built-up area, not a legal
     border.

## Accounts (owner, 2026-10-28)

8. **Accounts and saved spots**: sign in, save exact spots on the map
   (with a note), find them again on any device. Fits the zero-cost rule
   with Supabase's free sign-in and database, which would also keep
   Supabase active. Needs a privacy notice (emails and saved places are
   personal data - GDPR), account deletion, and a choice of sign-in
   (email link, Google...). Suggested after the Cloudflare move; a first
   step without accounts: spots saved in the browser and shared by link.

## Data

9. **Phase 2 - Europe and the US** (licence checks done 2026-10-28; see the
   assessment doc linked in `HANDOFF.md`). Eurostat regions first, then
   France, UK, Spain, Italy, Germany, US federal sources. No GISCO region
   maps (non-commercial): match places through commune codes or
   OpenStreetMap's NUTS-tagged regions. **Official town borders too**
   (owner, 2026-10-28): the same units the local figures are published
   for, so one piece of work attaches the figures and draws the outline -
   US Census places (public domain, ~4,500 estimated outlines today), UK
   ONS built-up areas and local authorities (OGL, ~1,600), Italy ISTAT
   municipalities (~2,000); licences to confirm per dataset.
10. **Phase 3** - other data-rich countries (Canada, Australia, Japan,
   Mexico, Brazil...), with their official borders where open: Canada
   (Statistics Canada, ~700 estimated today), Mexico (INEGI localities,
   ~6,100), Philippines (official borders on HDX, ~3,100) - licences to
   check. India and China mostly stay estimated: their town borders
   aren't openly published.
11. **Advanced search filters** for the phase 1 local figures (age,
    growth, hospital, armed conflict, regional GDP).
12. **Owner to decide: local figures in the scores.** Suggested: armed
    conflict nearby in Safety, nearest hospital in Quality of Life; not
    regional GDP (86% coverage, high in commuter centres).

## Hosting

13. **Move from Vercel to Cloudflare's free hosting** - after the items
    above (owner, 2026-10-28). Vercel's free plan holds 10 GB of
    deployments (~350 MB each) and forbids commercial use. Note for later:
    one prerendered page per place (146,800 files) would exceed
    Cloudflare's 20,000-file free limit, so keep one page per kind as
    today.
