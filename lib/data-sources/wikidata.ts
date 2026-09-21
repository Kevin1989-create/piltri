/**
 * Wikidata SPARQL endpoint — free, no key required, CC0-licensed content.
 * Docs: https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service
 *
 * Used for two "how many notable X are near this city" counts that don't
 * have a clean free API of their own (Michelin's own API is proprietary,
 * QS/THE/ARWU don't offer one, and The World's 50 Best has no API at all -
 * scraping any of those would be a real terms-of-service risk, discussed
 * earlier in this project). Wikidata/Wikipedia already maintain
 * structured, openly-licensed summaries of all of them:
 *
 *  - "Ranked universities nearby": counts institutions within range that
 *    carry at least one of the 3 major global ranking IDs Wikidata tracks
 *    as a dedicated external-ID property - QS World University ID (P5584),
 *    Times Higher Education World University ID (P5586), or ARWU/Shanghai
 *    Ranking university ID (P5242). An institution with more than one of
 *    the three is still only counted once (COUNT DISTINCT ?item).
 *  - "Notable restaurants nearby": counts restaurants within range that
 *    either carry a Michelin Restaurants ID (P4160 - reflects Michelin
 *    Guide inclusion generally; Wikidata's star-tier qualifier coverage is
 *    inconsistent, so this is guide inclusion, not confirmed star status)
 *    OR have received an award (P166) that is itself part of (P361) The
 *    World's 50 Best Restaurants (Q2918929, e.g. a yearly "50 Best
 *    Restaurants 2024" award item).
 *
 * HONEST CAVEAT on the 50-Best half of the restaurant query specifically:
 * I could not confirm, from outside Wikidata's own query service, that
 * individual yearly award items actually use P361 ("part of") to point
 * back at Q2918929 - that's the documented general pattern for Wikidata
 * award series, but this specific series wasn't directly inspectable from
 * here. If it turns out to be modelled differently (or not modelled at
 * all for most restaurants), that half of the UNION will just silently
 * contribute 0 matches rather than error - the Michelin half is the more
 * solid of the two.
 *
 * IMPORTANT — none of this file's queries could be tested from the build
 * environment (query.wikidata.org is blocked by that sandbox's network
 * allowlist, confirmed for several other domains too - this is a general
 * sandbox limitation, not Wikidata-specific). They're written carefully
 * against Wikidata's documented SPARQL/box-service syntax but should be
 * watched for errors or unexpectedly-zero counts the first time this runs
 * against live traffic. Both calls are wrapped in the same safely()-style
 * try/catch the rest of the aggregation layer uses, so a failure here
 * degrades to a count of 0 rather than breaking the page.
 */

import { fetchWithTimeout } from "./fetchWithTimeout";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const CLIENT_TIMEOUT_MS = 8000;
// getCityPopulationAndArea's query is fast in the median case (~500ms
// tested live for several cities) but Wikidata's own query service has
// real, well-documented tail latency - the identical query for Paris
// measured 491ms once and 8000ms+ (timed out) minutes later with nothing
// about the query changed. This call is sequenced to run alone, ahead of
// the slower ranked-universities/notable-restaurants ones (see
// aggregate.ts's getWikidataFields), so a longer timeout here only costs
// its own wait, not anything else - worth it since this is the field the
// "London shows the UK's population" bug traced back to.
const POPULATION_TIMEOUT_MS = 20000;
// Roughly a 0.15 degree box (~15-16km at mid-latitudes) around the city
// centre - wider than Overpass's radius since Wikidata's coordinate
// coverage for individual venues is sparser than OpenStreetMap's.
const BOX_DEGREES = 0.15;

const WORLDS_50_BEST_RESTAURANTS_QID = "Q2918929";

function boxCorners(lat: number, lng: number) {
  return {
    west: (lng - BOX_DEGREES).toFixed(4),
    east: (lng + BOX_DEGREES).toFixed(4),
    south: (lat - BOX_DEGREES).toFixed(4),
    north: (lat + BOX_DEGREES).toFixed(4),
  };
}

async function runCountQuery(query: string): Promise<number> {
  const res = await fetchWithTimeout(
    `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`,
    {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "Piltri/1.0 (city comparison app)",
      },
      cache: "no-store",
    },
    CLIENT_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`Wikidata SPARQL request failed: ${res.status}`);
  const json = await res.json();
  const raw = json?.results?.bindings?.[0]?.count?.value;
  const count = Number(raw);
  return Number.isFinite(count) ? count : 0;
}

/** Count of institutions within range carrying a QS, THE, or ARWU ranking
 *  ID (see file header) - "noticeable schools" per the 3 major global
 *  university rankings Wikidata models as dedicated properties. */
export async function countRankedUniversities(lat: number, lng: number): Promise<number> {
  const { west, east, south, north } = boxCorners(lat, lng);
  const query = `
    SELECT (COUNT(DISTINCT ?item) AS ?count) WHERE {
      ?item wdt:P625 ?coord .
      SERVICE wikibase:box {
        ?item wdt:P625 ?coord .
        bd:serviceParam wikibase:cornerWest "Point(${west} ${south})"^^geo:wktLiteral .
        bd:serviceParam wikibase:cornerEast "Point(${east} ${north})"^^geo:wktLiteral .
      }
      {
        ?item wdt:P5584 ?qsId .
      } UNION {
        ?item wdt:P5586 ?theId .
      } UNION {
        ?item wdt:P5242 ?arwuId .
      }
    }
  `;
  return runCountQuery(query);
}

/** Count of restaurants within range that are Michelin-Guide-listed
 *  (P4160) or have a World's 50 Best Restaurants award (see file header
 *  caveat on this second half). */
export async function countNotableRestaurants(lat: number, lng: number): Promise<number> {
  const { west, east, south, north } = boxCorners(lat, lng);
  const query = `
    SELECT (COUNT(DISTINCT ?item) AS ?count) WHERE {
      ?item wdt:P625 ?coord .
      SERVICE wikibase:box {
        ?item wdt:P625 ?coord .
        bd:serviceParam wikibase:cornerWest "Point(${west} ${south})"^^geo:wktLiteral .
        bd:serviceParam wikibase:cornerEast "Point(${east} ${north})"^^geo:wktLiteral .
      }
      {
        ?item wdt:P4160 ?michelinId .
      } UNION {
        ?item wdt:P166 ?award .
        ?award wdt:P361 wd:${WORLDS_50_BEST_RESTAURANTS_QID} .
      }
    }
  `;
  return runCountQuery(query);
}

// Wikidata quantity-unit QIDs that P2046 (area) statements commonly use,
// each mapped to its km² conversion factor. An area statement in any other
// unit is treated as unrecognised (null) rather than guessed at - wrong
// unit handling would silently produce a badly-wrong number (e.g. treating
// a hectare figure as km² is a 100x error), which is worse than admitting
// "not available".
const KM2_PER_UNIT: Record<string, number> = {
  "http://www.wikidata.org/entity/Q712226": 1, // square kilometre
  "http://www.wikidata.org/entity/Q35852": 0.01, // hectare
  "http://www.wikidata.org/entity/Q25343": 0.000001, // square metre
  "http://www.wikidata.org/entity/Q232291": 2.58999, // square mile
};

// How far (km) from the search coordinate to look for a matching Wikidata
// city/settlement entity - same rough city-scale radius as BOX_DEGREES
// above, expressed in wikibase:around's native km radius parameter instead.
const CITY_MATCH_RADIUS_KM = 15;

export interface CityPopulationAndArea {
  /** City-level population (Wikidata P1082), or null if no matching entity
   *  with a population statement was found within range. */
  population: number | null;
  /** City-level land area in km² (Wikidata P2046, unit-converted - see
   *  KM2_PER_UNIT), or null if no matching entity with a recognised-unit
   *  area statement was found. */
  areaKm2: number | null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const WKT_POINT_RE = /^Point\(([-\d.]+)\s+([-\d.]+)\)$/;

/** Resolves the city named `cityName` to the nearest same-named Wikidata
 *  entity within CITY_MATCH_RADIUS_KM of (lat, lng), then reads its
 *  population (P1082) and land area (P2046) directly off that entity -
 *  genuinely city-level figures, replacing the World Bank country-level
 *  fallback used when this doesn't resolve (see aggregate.ts).
 *
 *  This looks up the exact English label first (`?item rdfs:label
 *  "cityName"@en`), which hits Wikidata's label index directly, then
 *  disambiguates same-named places by computing real distance to
 *  (lat, lng) in JS. An earlier version did this the other way round -
 *  `SERVICE wikibase:around` first, label filter second - which forces
 *  Wikidata to materialise every coordinate-tagged entity within the
 *  radius before it can filter by name. For a densely-mapped city like
 *  London that's tens of thousands of candidates (shops, stations,
 *  plaques...) and the query measured 39+ seconds against live Wikidata -
 *  comfortably past this function's timeout, so it always fell back to
 *  World Bank's country-level population. Label-first was tested against
 *  live Wikidata for London (~540ms), Paris (~20ms, 106 rows - many
 *  same-named towns worldwide) and Springfield (~2.1s, 248 rows). Median
 *  latency is well under a second, but Wikidata's own query service has
 *  real tail latency independent of query design - the identical Paris
 *  query measured 491ms once and 8000ms+ (timed out) minutes later with
 *  nothing about the query changed - hence POPULATION_TIMEOUT_MS being
 *  more generous than a "this should be fast" query might suggest.
 *
 *  Matching caveats, honestly: this requires an exact (case-insensitive
 *  in practice, since search-provided names are Title Case) English-label
 *  match, so a city known to Wikidata only under a non-English label, or
 *  under different punctuation/spelling than what the search UI passed
 *  in, won't match - it'll fall back to the country figure rather than
 *  silently picking a wrong entity. Population statements on Wikidata
 *  aren't always marked with a single "preferred" rank, so where a city
 *  has several dated population figures on file, this picks the largest
 *  value on file as a "most recent is usually biggest" heuristic - an
 *  earlier version tried to disambiguate properly via each statement's
 *  P585 (point in time) qualifier, but that reintroduces exactly the
 *  per-statement join cross-product this rewrite exists to avoid (see
 *  above): tested live, it pushed a single London lookup from ~500ms to
 *  a 502 from Wikidata's own gateway. Not worth it for a heuristic that's
 *  already "good enough, not guaranteed" either way. */
export async function getCityPopulationAndArea(lat: number, lng: number, cityName: string): Promise<CityPopulationAndArea> {
  const escapedName = cityName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const query = `
    SELECT ?item ?location ?population ?areaAmount ?areaUnit WHERE {
      ?item rdfs:label "${escapedName}"@en .
      ?item wdt:P625 ?location .
      OPTIONAL { ?item wdt:P1082 ?population . }
      OPTIONAL {
        ?item p:P2046 ?areaStatement .
        ?areaStatement psv:P2046 ?areaNode .
        ?areaNode wikibase:quantityAmount ?areaAmount .
        ?areaNode wikibase:quantityUnit ?areaUnit .
      }
    }
  `;

  const res = await fetchWithTimeout(
    `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`,
    {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "Piltri/1.0 (city comparison app)",
      },
      cache: "no-store",
    },
    POPULATION_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`Wikidata SPARQL request failed: ${res.status}`);
  const json = await res.json();
  const rows: Array<Record<string, { value: string }>> = json?.results?.bindings ?? [];
  if (rows.length === 0) return { population: null, areaKm2: null };

  // Same label can belong to many unrelated places, and not just other
  // cities (Springfield, London, Paris...) - a same-named landmark or
  // institution can too, and can sit even closer to the search point than
  // the city itself. Wikidata's "Paris" mint (Q127430952, the Monnaie de
  // Paris) is pinned essentially exactly at central Paris's coordinate -
  // closer than the city entity (Q90) itself - but carries no population
  // or area statement, so picking purely by proximity latched onto it and
  // returned nothing every time. Only candidates that actually carry a
  // population or area value are considered; among those, nearest wins.
  let nearestItem: string | null = null;
  let nearestKm = Infinity;
  for (const row of rows) {
    if (row.population?.value == null && row.areaAmount?.value == null) continue;
    const match = row.location?.value ? WKT_POINT_RE.exec(row.location.value) : null;
    if (!match) continue;
    const rowLng = Number(match[1]);
    const rowLat = Number(match[2]);
    if (!Number.isFinite(rowLat) || !Number.isFinite(rowLng)) continue;
    const km = haversineKm(lat, lng, rowLat, rowLng);
    if (km < nearestKm) {
      nearestKm = km;
      nearestItem = row.item.value;
    }
  }
  if (nearestItem == null || nearestKm > CITY_MATCH_RADIUS_KM) return { population: null, areaKm2: null };

  const itemRows = rows.filter((row) => row.item.value === nearestItem);

  let population: number | null = null;
  for (const row of itemRows) {
    const populationRaw = row.population?.value;
    if (populationRaw == null || !Number.isFinite(Number(populationRaw))) continue;
    const candidate = Math.round(Number(populationRaw));
    if (population == null || candidate > population) population = candidate;
  }

  let areaKm2: number | null = null;
  for (const row of itemRows) {
    const areaAmountRaw = row.areaAmount?.value;
    const areaUnitUri = row.areaUnit?.value;
    const unitFactor = areaUnitUri ? KM2_PER_UNIT[areaUnitUri] : undefined;
    if (areaAmountRaw != null && unitFactor != null && Number.isFinite(Number(areaAmountRaw))) {
      areaKm2 = Number((Number(areaAmountRaw) * unitFactor).toFixed(2));
      break;
    }
  }

  return { population, areaKm2 };
}
