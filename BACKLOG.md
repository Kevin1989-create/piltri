# Piltri - backlog

The owner's requests and planned work, roughly in order. Updated
2026-10-28. When an item is done it leaves this list (the details live in
`HANDOFF.md` and the git history).

## Now

- **Data refresh with phase 1** (local figures): re-run on 2026-10-28
  after WHO's API outage failed the first attempt; check Lyon, Kharkiv,
  Lagos and a village on the live site afterwards.
- **Findable on Google** (done 2026-10-28): the owner adds the site to
  Google Search Console and submits `https://www.piltri.me/sitemap.xml`.

## Map (owner, 2026-10-28)

Done 2026-10-28: a Yes shows every place of its kind within its radius
(from the map's own tiles - `lib/mapPlaces.ts`; care homes aren't in them
and keep the dataset's nearest 6), an icon per kind
(`components/explore/mapIcons.ts`), a small permanent credit line instead
of the pop-up (`MapCredit`), and an expand button.

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
