/**
 * OpenStreetMap / Overpass API — free, no key required.
 * Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
 *
 * Density fields are "per 10k population" per the data model — the caller
 * (aggregation layer) divides the raw counts returned here by city
 * population / 10,000.
 */

import { fetchWithTimeout } from "./fetchWithTimeout";

// Several independent public Overpass instances, tried in order. Overpass
// is a shared free service with no SLA — the primary instance in
// particular temporarily blocked this project's own IP entirely (406 on
// every request, including a plain status check) after a large batch job
// briefly burst too many requests at it. A single point of failure there
// was already flagged as a known limitation (KNOWN-ISSUES.md); mirror
// fallback is the actual fix, not just a today-specific workaround - any
// one instance being slow, down, or having temporarily rate-limited us no
// longer takes every Overpass-backed field down with it.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

async function overpassAttempt(endpoint: string, query: string, timeoutMs: number): Promise<Response> {
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
    timeoutMs
  );
  // A real Overpass response, including a query-level error, is still a
  // JSON body we can reason about - only a non-Overpass gateway/WAF
  // response (no JSON content-type at all - a block page, a 5xx from the
  // reverse proxy, etc.) is treated as "this endpoint didn't answer".
  const contentType = res.headers.get("content-type") ?? "";
  if (res.ok || contentType.includes("json")) return res;
  throw new Error(`Overpass endpoint ${endpoint} returned ${res.status}`);
}

/** POSTs an Overpass QL query — the primary endpoint first (the normal
 *  case: healthy, single request, no extra load on the other free public
 *  mirrors), and only if that fails does it race the remaining mirrors in
 *  parallel for whichever answers first. Two-phase rather than either
 *  "always race everything" (triples load on shared free services on
 *  every single call, most of it wasted) or "try each one after another"
 *  (a slow-but-not-quite-dead mirror ahead of a healthy one would
 *  compound this query's wait by however many mirrors come before it). */
async function overpassPost(query: string, timeoutMs: number): Promise<Response> {
  const [primary, ...fallbacks] = OVERPASS_ENDPOINTS;
  try {
    return await overpassAttempt(primary, query, timeoutMs);
  } catch (primaryErr) {
    if (fallbacks.length === 0) throw primaryErr;
    try {
      return await Promise.any(fallbacks.map((endpoint) => overpassAttempt(endpoint, query, timeoutMs)));
    } catch (err) {
      const first = err instanceof AggregateError ? err.errors[0] : err;
      throw first instanceof Error ? first : primaryErr;
    }
  }
}

const RADIUS_M = 5000; // 5km search radius around the city centroid
// Airports are routinely much further from a city centre than any other
// amenity checked here (a "city's airport" is commonly 20-40km out) - a
// wider dedicated radius avoids false negatives that the 5km default would
// produce for almost every city.
const AIRPORT_RADIUS_M = 40000;
// Overpass is a shared public instance and by far the slowest of Piltri's
// free data sources — a shorter query-level timeout (Overpass aborts its
// own search server-side after this many seconds) plus a client-side
// timeout below means a slow query fails fast into its fallback/default
// rather than dragging out the whole Explore search or pin lookup.
const OVERPASS_QUERY_TIMEOUT_S = 10;
const CLIENT_TIMEOUT_MS = 9000;

// Wider than the 5km default: sector signals like an industrial estate or
// out-of-town retail/office park are more spread out than restaurants/bars.
const SECTOR_RADIUS_M = 8000;
// A combined 14-group query does more work server-side than any single
// count query did - longer timeouts than the general-purpose ones above,
// matching the beach search's (the previous widest single query in this
// file).
const BATCH_QUERY_TIMEOUT_S = 20;
const BATCH_CLIENT_TIMEOUT_MS = 15000;

interface TagGroup {
  tags: string[];
  radiusM: number;
}

/** Counts several independent tag groups around one point in a SINGLE
 *  Overpass HTTP request, via named result sets (`->.s0`, `->.s1`, ...)
 *  each followed by its own `out count`- Overpass returns one count
 *  element per `out count` statement, in the order they appear, which is
 *  how the groups are matched back up to their counts below. This is what
 *  lets getCityOverpassData combine what used to be 14 separate round
 *  trips against a shared, rate-limited public instance into 1 - the
 *  single biggest lever for scaling how many cities can realistically be
 *  aggregated without hitting Overpass's limits. */
async function countTagsBatch(lat: number, lng: number, groups: TagGroup[]): Promise<number[]> {
  const sets = groups
    .map((g, i) => {
      const clauses = g.tags
        .map((tag) => `node[${tag}](around:${g.radiusM},${lat},${lng});way[${tag}](around:${g.radiusM},${lat},${lng});`)
        .join("");
      return `(${clauses})->.s${i};`;
    })
    .join("\n");
  const outs = groups.map((_, i) => `.s${i} out count;`).join("\n");
  const query = `[out:json][timeout:${BATCH_QUERY_TIMEOUT_S}];\n${sets}\n${outs}`;

  const res = await overpassPost(query, BATCH_CLIENT_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Overpass request failed: ${res.status}`);
  const json = await res.json();
  const elements: any[] = json?.elements ?? [];
  return groups.map((_, i) => {
    const total = elements[i]?.tags?.total;
    return total ? Number(total) : 0;
  });
}

export interface OverpassRawCounts {
  restaurantsBars: number;
  culturalVenues: number;
  familyKidsActivities: number;
  greenSpaceCount: number; // proxy count; green space % is estimated from this
}

export interface OverpassTransportPresence {
  hasTrainStation: boolean;
  hasSubway: boolean;
  hasTramway: boolean;
  hasAirport: boolean;
}

export interface EconomySectorCounts {
  technologyAndInnovation: number;
  tourismAndHospitality: number;
  financeAndServices: number;
  manufacturingAndIndustry: number;
  governmentAndPublicSector: number;
  naturalResourcesAndAgriculture: number;
}

export interface CityOverpassData {
  raw: OverpassRawCounts;
  transport: OverpassTransportPresence;
  economySectors: EconomySectorCounts;
}

// Index of each of the 14 groups in the single batched query below - named
// so the response-parsing code reads as labels, not magic numbers.
const GROUP = {
  restaurantsBars: 0,
  culturalVenues: 1,
  familyKidsActivities: 2,
  greenSpaceCount: 3,
  trainStation: 4,
  subway: 5,
  tramway: 6,
  airport: 7,
  techAndInnovation: 8,
  tourismAndHospitality: 9,
  financeAndServices: 10,
  manufacturingAndIndustry: 11,
  governmentAndPublicSector: 12,
  naturalResourcesAndAgriculture: 13,
} as const;

/** Every Overpass-sourced field a city needs (amenity/cultural/family
 *  density, green space, transport presence flags, and economy-sector POI
 *  counts) in ONE HTTP request instead of the 14 separate ones this used
 *  to take (see countTagsBatch above) - transport presence flags favour
 *  the single most consistently-used OSM tag per mode rather than
 *  enumerating every regional tagging variant: railway=station
 *  (heavy/mainline rail), station=subway (the standard sub-tag
 *  distinguishing a metro/subway stop from a mainline station) plus
 *  railway=subway_entrance as a second, very consistently tagged signal,
 *  railway=tram_stop, and aeroway=aerodrome.
 *
 *  Economy-sector counts are a point-of-interest density proxy, not real
 *  GDP or employment-share data - no free source for true city-level
 *  economic composition exists. Tag choices are a reasonable
 *  single-tag-per-concept mapping, not an exhaustive enumeration of every
 *  regional tagging variant, and OSM tagging density itself varies a lot
 *  by region (much richer in Western Europe/North America than
 *  elsewhere) - so a "no signal" result for smaller or less-mapped cities
 *  is expected and reported honestly (see pickMainEconomyType) rather
 *  than guessed at. */
export async function getCityOverpassData(lat: number, lng: number): Promise<CityOverpassData> {
  const counts = await countTagsBatch(lat, lng, [
    { tags: ['"amenity"="restaurant"', '"amenity"="bar"', '"amenity"="cafe"'], radiusM: RADIUS_M },
    { tags: ['"amenity"="theatre"', '"amenity"="cinema"', '"tourism"="museum"', '"amenity"="arts_centre"'], radiusM: RADIUS_M },
    { tags: ['"leisure"="playground"', '"amenity"="childcare"', '"leisure"="water_park"'], radiusM: RADIUS_M },
    { tags: ['"leisure"="park"', '"leisure"="garden"'], radiusM: RADIUS_M },
    { tags: ['"railway"="station"'], radiusM: RADIUS_M },
    { tags: ['"station"="subway"', '"railway"="subway_entrance"'], radiusM: RADIUS_M },
    { tags: ['"railway"="tram_stop"'], radiusM: RADIUS_M },
    { tags: ['"aeroway"="aerodrome"'], radiusM: AIRPORT_RADIUS_M },
    { tags: ['"office"="it"', '"office"="coworking"', '"office"="research"'], radiusM: SECTOR_RADIUS_M },
    { tags: ['"tourism"="hotel"', '"tourism"="attraction"', '"tourism"="museum"', '"tourism"="guest_house"'], radiusM: SECTOR_RADIUS_M },
    {
      tags: ['"amenity"="bank"', '"office"="insurance"', '"office"="financial"', '"office"="lawyer"', '"office"="accountant"'],
      radiusM: SECTOR_RADIUS_M,
    },
    { tags: ['"landuse"="industrial"', '"man_made"="works"'], radiusM: SECTOR_RADIUS_M },
    { tags: ['"office"="government"', '"amenity"="townhall"', '"amenity"="courthouse"'], radiusM: SECTOR_RADIUS_M },
    {
      tags: ['"landuse"="farmland"', '"landuse"="orchard"', '"landuse"="vineyard"', '"landuse"="quarry"'],
      radiusM: SECTOR_RADIUS_M,
    },
  ]);

  return {
    raw: {
      restaurantsBars: counts[GROUP.restaurantsBars],
      culturalVenues: counts[GROUP.culturalVenues],
      familyKidsActivities: counts[GROUP.familyKidsActivities],
      greenSpaceCount: counts[GROUP.greenSpaceCount],
    },
    transport: {
      hasTrainStation: counts[GROUP.trainStation] > 0,
      hasSubway: counts[GROUP.subway] > 0,
      hasTramway: counts[GROUP.tramway] > 0,
      hasAirport: counts[GROUP.airport] > 0,
    },
    economySectors: {
      technologyAndInnovation: counts[GROUP.techAndInnovation],
      tourismAndHospitality: counts[GROUP.tourismAndHospitality],
      financeAndServices: counts[GROUP.financeAndServices],
      manufacturingAndIndustry: counts[GROUP.manufacturingAndIndustry],
      governmentAndPublicSector: counts[GROUP.governmentAndPublicSector],
      naturalResourcesAndAgriculture: counts[GROUP.naturalResourcesAndAgriculture],
    },
  };
}

/** Picks the single highest-count bucket as the city's likely dominant
 *  local sector. Returns null when every bucket is 0 (no local OSM signal
 *  at all for this city) rather than defaulting to an arbitrary category -
 *  the caller/UI shows that honestly as "not enough local data". */
export function pickMainEconomyType(counts: EconomySectorCounts): keyof EconomySectorCounts | null {
  const entries = Object.entries(counts) as [keyof EconomySectorCounts, number][];
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total === 0) return null;
  return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

export interface NearestFeatureResult {
  km: number;
  lat: number;
  lng: number;
  /** OSM `name` tag, if the matched node/way has one - many do (train
   *  stations, parks, hospitals), some don't (an anonymous kindergarten
   *  node, an unnamed beach segment). Null when absent, not guessed. */
  name: string | null;
}

function haversineKmInternal(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Nearest-feature distance (km) plus its coordinates and OSM name (if
 *  tagged) — used as a fallback if Mapbox's category search/directions are
 *  unavailable, and to let the caller show what was actually matched
 *  rather than just a number. Radius reduced from an earlier 20km default
 *  to 8km: still generous for city-scale lookups, but a much faster query
 *  against the shared Overpass instance.
 *
 *  `tagFilters` accepts multiple alternative tag filters (OR'd together,
 *  same pattern as countTags below) - e.g. matching both underground and
 *  light-rail/overground metro stations under one "subway" lookup, rather
 *  than a single rigid tag. */
export async function nearestFeatureWithDetails(
  lat: number,
  lng: number,
  tagFilters: string | string[],
  radiusM = 8000
): Promise<NearestFeatureResult | null> {
  const filters = Array.isArray(tagFilters) ? tagFilters : [tagFilters];
  const clauses = filters
    .map((tag) => `node[${tag}](around:${radiusM},${lat},${lng});way[${tag}](around:${radiusM},${lat},${lng});`)
    .join("\n");
  const query = `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];(${clauses});out center 1;`;
  const res = await overpassPost(query, CLIENT_TIMEOUT_MS);
  if (!res.ok) return null;
  const json = await res.json();
  const el = json?.elements?.[0];
  if (!el) return null;
  const elLat = el.lat ?? el.center?.lat;
  const elLng = el.lon ?? el.center?.lon;
  if (elLat == null || elLng == null) return null;

  return { km: Number(haversineKmInternal(lat, lng, elLat, elLng).toFixed(2)), lat: elLat, lng: elLng, name: el.tags?.name ?? null };
}

// A generous 8km search window keeps us within a plausible city commuting
// area — anywhere inside that from a genuine sea coastline or lake shore is
// treated as "real" water, not a river/canal.
const COASTAL_CHECK_RADIUS_M = 8000;

/** Is this point within COASTAL_CHECK_RADIUS_M of a sea coastline or a lake?
 *  Used to filter out `natural=beach` tags that sit on a river/canal bank in
 *  the middle of a city (e.g. London's "Bermondsey Beach", a small Thames
 *  foreshore spot, not a swimmable beach) - those get tagged `natural=beach`
 *  in OSM just as legitimately as a real coastal or lakeside beach, so the
 *  tag alone can't tell them apart. `natural=coastline` is specifically
 *  reserved for sea coastlines in OSM tagging convention (never used for
 *  rivers), and `natural=water`+`water=lake` for lakes - so a hit on either
 *  is a reasonably reliable signal, though not perfect (e.g. a very large
 *  tidal river estuary could still pass this check). */
export async function isNearCoastOrLake(lat: number, lng: number): Promise<boolean> {
  const query =
    `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];` +
    `(way["natural"="coastline"](around:${COASTAL_CHECK_RADIUS_M},${lat},${lng});` +
    `way["natural"="water"]["water"="lake"](around:${COASTAL_CHECK_RADIUS_M},${lat},${lng}););out count;`;
  try {
    const res = await overpassPost(query, CLIENT_TIMEOUT_MS);
    if (!res.ok) return false;
    const json = await res.json();
    const total = json?.elements?.[0]?.tags?.total;
    return total ? Number(total) > 0 : false;
  } catch {
    return false;
  }
}

// A real beach can genuinely be very far from a major city's centre - e.g.
// London's nearest coastal beaches (Southend-on-Sea, Whitstable) are 60-80km
// out. Escalating radius tiers keep the common case fast (most cities
// resolve at the first tier or two) while still reaching out to
// BEACH_RADIUS_TIERS_M's last, very wide tier for "even if it's 10 hours
// away" cases; a genuinely far-inland city will still honestly come back
// with none beyond that.
//
// This also queries `natural=coastline` directly, not just `natural=beach`:
// `natural=beach` tagging turned out to be inconsistent/patchy in some
// regions, and worse, a handful of closer non-coastal false positives
// (river/canal "beaches") could fill up a small candidate pool before a
// real coastal one was ever even considered. `natural=coastline` is far
// more consistently mapped (it's fundamental to how OSM renders land/sea
// at all) and, being the coastline itself, trivially passes the "is this
// coastal" check by definition - no separate isNearCoastOrLake round trip
// needed for it. Untagged/unnamed coastline points fall back to a plain
// "Nearby coast" label rather than a blank one.
const BEACH_RADIUS_TIERS_M = [20000, 60000, 150000, 500000];
const BEACH_CANDIDATE_POOL = 40; // how many raw elements to fetch per tag per tier
const BEACH_CANDIDATES_TO_VET = 10; // how many of the closest `natural=beach` candidates to vet per tier
// Wider radius = more area for Overpass to scan, so this gets its own more
// generous timeouts rather than sharing the general-purpose ones above.
const BEACH_QUERY_TIMEOUT_S = 20;
const BEACH_CLIENT_TIMEOUT_MS = 15000;

interface BeachCandidate {
  km: number;
  lat: number;
  lng: number;
  name: string | null;
  isCoastline: boolean;
}

async function fetchBeachCandidates(lat: number, lng: number, radiusM: number): Promise<BeachCandidate[]> {
  const query =
    `[out:json][timeout:${BEACH_QUERY_TIMEOUT_S}];` +
    `(node["natural"="beach"](around:${radiusM},${lat},${lng});` +
    `way["natural"="beach"](around:${radiusM},${lat},${lng});` +
    `way["natural"="coastline"](around:${radiusM},${lat},${lng}););` +
    `out center ${BEACH_CANDIDATE_POOL};`;
  const res = await overpassPost(query, BEACH_CLIENT_TIMEOUT_MS);
  if (!res.ok) return [];
  const json = await res.json();
  const elements: any[] = json?.elements ?? [];

  return elements
    .map((el): BeachCandidate | null => {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      if (elLat == null || elLng == null) return null;
      return {
        km: haversineKmInternal(lat, lng, elLat, elLng),
        lat: elLat,
        lng: elLng,
        name: el.tags?.name ?? null,
        isCoastline: el.tags?.natural === "coastline",
      };
    })
    .filter((c): c is BeachCandidate => c !== null)
    .sort((a, b) => a.km - b.km);
}

/** Nearest genuine beach or, failing that, nearest point of coast - see the
 *  comment above BEACH_RADIUS_TIERS_M for why both are searched together.
 *  Searches in escalating radius tiers, and within each tier: accepts the
 *  closest coastline candidate immediately (no vetting needed - it IS the
 *  coast), while `natural=beach` candidates are vetted against
 *  isNearCoastOrLake in parallel (not one at a time) to keep this from
 *  being any slower than it has to be, then the closest one that actually
 *  passed is used. Only escalates to a wider tier once a tier turns up
 *  nothing usable at all. */
export async function nearestVerifiedBeach(lat: number, lng: number): Promise<NearestFeatureResult | null> {
  for (const radiusM of BEACH_RADIUS_TIERS_M) {
    const candidates = await fetchBeachCandidates(lat, lng, radiusM).catch(() => []);

    const nearestCoastline = candidates.find((c) => c.isCoastline);
    const beaches = candidates.filter((c) => !c.isCoastline).slice(0, BEACH_CANDIDATES_TO_VET);

    const verified = await Promise.all(beaches.map((c) => isNearCoastOrLake(c.lat, c.lng).catch(() => false)));
    const verifiedBeach = beaches.find((_, i) => verified[i]);

    // Prefer an actual named/tagged beach over a bare coastline point when
    // both exist and the beach isn't meaningfully further away.
    const best =
      verifiedBeach && (!nearestCoastline || verifiedBeach.km <= nearestCoastline.km + 5)
        ? verifiedBeach
        : nearestCoastline;

    if (best) {
      return {
        km: Number(best.km.toFixed(2)),
        lat: best.lat,
        lng: best.lng,
        name: best.name ?? (best.isCoastline ? "Nearby coast" : null),
      };
    }
  }
  return null;
}
