# Piltri - backlog

The owner's requests and planned work, roughly in order. Updated
2026-10-28. When an item is done it leaves this list (the details live in
`HANDOFF.md` and the git history).

## Now

- **Next refresh** (owner to run): brings Advanced search's "in the city"
  filters and the local score into the world ranks, leaderboards and
  search results (the city pages already show the new scores).
- **WHO's data service is down** (since 2026-10-28): the national PM2.5
  estimate for small island countries outside the satellite map is left
  out (their towns show "No data" for air quality). The World Bank's copy
  is IHME's (non-commercial), so it waits for WHO or another source.
- **Real towns dropped as "no town here"** (checked 2026-10-29): of the
  ~1,300 places the ghost check drops, 28 claim 50,000+ people - most are
  duplicate GeoNames entries whose real town is kept (Marāgheh's copy in
  Khorasan, Kanpur, Shreveport...), but ~8 look real and are lost: Timika
  (ID), Bailundo (AO), Laojunmiao (CN), Krasnaya Glinka (RU), Akçapınar
  (TR), Sayyān (YE), Tshilenge (CD), Ārabī (ET). GeoNames puts their point
  in empty land (Timika's ~25 km from the town). Fix idea: for a "ghost"
  of 20,000+ people, move its point to the nearest built-up cluster of a
  matching size within ~25 km, or take Wikidata's coordinates.
- **Search engines: kept out until December** (owner, 2026-10-28: "not
  until it's clean"). Ready and waiting: page titles and descriptions,
  the sitemap of every place, robots.txt. Every page says noindex for now.
  To open up: `SEARCH_ENGINES_WELCOME = true` in `next.config.js`, the
  Sitemap line back in `public/robots.txt`, then the owner adds the site
  to Google Search Console and submits `https://www.piltri.me/sitemap.xml`.

## City page

Done 2026-10-30: Resources shows without scrolling - on a phone the map
takes the height left once the score card fits (never under 110 px), the
world rank sits beside the score, and rows and the top bar are a little
tighter on short screens. Phones under ~690 px of visible height still
scroll a little.

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

Done 2026-10-29 (live after the next refresh): Advanced search's
stations, schools... filters count "in the city" like the city pages
(assemble.ts inCity), with a hospital filter and filters for average age,
growth and armed conflict. On the map: tapping an icon opens
its card (name, kind, distance, Google Maps); ticking a kind the city has
none of shows the nearest, with "nearest 25 km" in the list - the map
doesn't move.

Done 2026-10-29: more names at a city's own zoom - main roads from zoom
11 (was 12.2), streets and notable places from 13.5 (was 15)
(EARLIER_LABELS in MapView).
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
Done 2026-10-30 (owner: "the Piltri score should be as local as
possible"): armed conflict nearby in Safety; healthcare access and
everyday services in Quality of Life. Regional GDP removed (too old,
whole regions); Economy goes local with phase 2's household income.

## Hosting

13. **Move from Vercel to Cloudflare's free hosting** - after the items
    above (owner, 2026-10-28). Vercel's free plan holds 10 GB of
    deployments (~350 MB each) and forbids commercial use. Note for later:
    one prerendered page per place (146,800 files) would exceed
    Cloudflare's 20,000-file free limit, so keep one page per kind as
    today.
