# Piltri - backlog

The owner's requests and planned work, roughly in order. Updated
2026-11-11. When an item is done it leaves this list (the details live in
`HANDOFF.md` and the git history).

## Now

- **Next refresh** (owner to run; the one of 2026-11-11 ran before these):
  "Bus stops" counted from every OpenStreetMap stop (London ~24,000, where
  it showed 61 bus stations); OpenStreetMap hospitals kept only when
  acute care (no rehab, psychiatric, long-stay or no-emergency grounds -
  Olivet's rehab clinic came back through OpenStreetMap); "Patna, Kurji
  Hospital" out of London; the last "Klinik"s out of Indonesia.
- **Vercel's 10 GB of deployments is full again** (2026-11-11; ~530 MB a
  deployment). Deployments still went through. Until item 13: delete old
  deployments in Vercel, push in batches. Quicker than moving the site:
  serve `public/data` from Cloudflare R2 (free to 10 GB, no download
  fees), so a deployment is a few MB.
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

Done 2026-10-30 (owner's review of London): the layer list scrolls inside
the map when it's not expanded; a No reads "No" with "nearest 58 km ·
~1 h by car" under it, not a distance in the Yes column; beaches,
mountains, forests and airports are coloured by how near they are and
count in the score (Environment: nature nearby; Quality of Life: an
international airport within reach); airports count every one within
80 km of the centre (they sit outside towns), "6 within 80 km · nearest
Heathrow" (live after the next refresh); a cleaner icon card (the kind in
its icon's colour, a drawn close cross).

5. **Tram and metro lines on the map** (owner, 2026-10-30: London's Tram
   shows one stop). Overture has tram track but not its stops, and
   OpenFreeMap's tiles carry rail lines only from zoom 14, so London's
   Tramlink (Croydon) appears as a single tile stop. Fix: store the tram
   and metro lines in the city's data (simplified, from Overture rail)
   and draw them when the kind is ticked. ~1 session; adds to the dataset
   size.
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
   - Seen in the worldwide audit of 2026-11-10: some big places' outlines
     are far too small, so their station or hospital counts as "nearest
     2 km" rather than in the city - Bangkok (station 2.2 km from the
     centre), Kinshasa (2.6 km), Tokyo's Shinagawa (21 km?), Hamburg-Nord.
     Same fix: match by Wikidata id, and never keep an outline much
     smaller than the built-up area around the centre.
7b. **Data checks after the 2026-11-10 audit** (owner: "the same rigorous
   approach on all cities in the world"). Done in the pipeline, live after
   the next refresh: OpenStreetMap hospitals added (China 14% -> ~59% of
   50k+ places with a hospital in the city, Iran 26% -> ~88%, Uzbekistan
   16% -> ~86%), ~7,700 non-hospitals left out (Indonesia's and
   Malaysia's small "Klinik"s, animal, dental and cosmetic hospitals in
   Asia, vets in Brazil and France, booking desks, imaging units,
   fundraising foundations), listings placed in the wrong country left
   out ("... In Hyderabad" in London), "Bus station" became "Bus stops"
   (2026-11-11, owner: London's 61 "way below reality" - it counts every
   OpenStreetMap bus stop now, ~24,000 in London, ~200 in Olivet, which had
   no bus station; only 22% of places had a bus station in the city, and
   how bus stations get tagged varies by country), funiculars and museum lines no
   longer train stations. Still open:
   - Hospitals misplaced within their own country ("Hospital Geral de
     Benguela" listed in Luanda; Saskatoon's "Royal University Hospital"
     in Ottawa): names can't tell a town from a saint or a province
     ("Hospital de São José"), so these stay until a second source
     (official hospital registers) can confirm them.
   - North Korea, Mali, DR Congo, Ethiopia: still under half of big places
     with a hospital in the city - few hospitals are mapped at all.
   - Re-run the audit after each refresh (station and hospital shares per
     country, odd names, big places with none):
     `npx tsx scripts/audit-places.ts public/data/<version> <out dir>`.

## Accounts (owner, 2026-10-28)

Done 2026-11-04 (step 1, no account): spots on the expanded map - what's
near, journeys by road, a second spot, saved in the browser, shared by
link (HANDOFF "Spots").

Done 2026-11-08 (step 2, code): accounts by email link (Supabase Auth),
saved places and spots in the account (`supabase/saved-items.sql`,
`lib/account.ts`), the Saved page's globe and filtered list, a privacy
notice (`/privacy`) and "Delete my account".

8. **Accounts - to switch on and finish** (owner): run
   `supabase/saved-items.sql`; add `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Vercel
   and `.env.local`); Supabase Authentication > URL Configuration: site
   `https://www.piltri.me`, redirects `https://www.piltri.me/**` and
   `http://localhost:3000/**`. Before opening to the public: an email
   sender (Supabase's own sends only a few an hour - e.g. Resend or Brevo's
   free plan, with DNS records at Hostinger), and the privacy notice
   reviewed (a contact address). Later: Google sign-in (a free Google Cloud
   client).

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

11. **Real-estate prices and a momentum score** (owner, 2026-11-08: "can
   we predict gentrification ... and real estate prices at city level
   everywhere?"). Agreed plan, in order:
   1. **Real prices where official open data exists** - France DVF (every
      sale since 2014, Licence Ouverte), England & Wales Land Registry
      (every sale since 1995, OGL), US Census ACS median home value
      (every place, public domain) first; then the Netherlands, Belgium,
      the Nordic statistics offices, Ireland's price register, Spain,
      Portugal, Italy (OMI), Japan (official land prices). ~56,000 of
      147,500 places (38%). Shown with source and year like the other
      local figures; elsewhere "No data" - no worldwide modelled price
      (a model trained on these countries would mostly echo national
      income elsewhere, errors of 50%+; it breaks the no-estimates rule).
   2. **Momentum score** - where a place is heading, not how it is today:
      night-time lights 2014-2024 (NOAA VIIRS annual, CC BY 4.0), new
      construction (GHSL built-up 2015 vs 2025, CC BY 4.0), population
      change and the 25-39 share's change (GHS-POP, WorldPop - in the
      pipeline already), "next door to a boom" (smaller places within an
      hour by train of a growing big city), and later amenity growth
      (start archiving Overture's monthly counts now). 0-100 with a label
      (Rising fast / Growing / Steady / Slowing / Declining) and the
      measured changes behind it. Coverage measured 2026-11-08: ~99% of
      places; solid for 81% (5,000+ people within 5 km), "small place,
      less certain" for 14%, "Too small to tell" under 2,000 (4.8%).
      Kept apart from the Piltri Score; its own leaderboard ("Rising
      places") and search filter.
   3. **Validate it** against step 1: does the score measured on
      2015-2020 predict 2020-2025 price growth in France, England & Wales
      and the US? Set its weights from what did; call it a forecast only
      if it does, else "momentum".
   4. Later: more price countries; a 1 km neighbourhood layer on big
      cities' maps (gentrification happens street by street).
   Considered and set aside: UNSW's Sydney gentrification model (Cities,
   2023) - Sydney only, ~80 inputs (Australian census, sales reports,
   business registers, Airbnb) that don't exist openly worldwide; its
   approach (train on real past change) is the one above.

## Hosting

13. **Move from Vercel to Cloudflare's free hosting** - after the items
    above (owner, 2026-10-28). Vercel's free plan holds 10 GB of
    deployments (~350 MB each) and forbids commercial use. Note for later:
    one prerendered page per place (146,800 files) would exceed
    Cloudflare's 20,000-file free limit, so keep one page per kind as
    today.
