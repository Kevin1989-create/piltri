/**
 * OpenStreetMap / Overpass API — free, no key required.
 * Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
 *
 * Density fields are "per 10k population" per the data model — the caller
 * (aggregation layer) divides the raw counts returned here by city
 * population / 10,000.
 */

import { fetchWithTimeout } from "./fetchWithTimeout";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
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
const CLIENT_TIMEOUT_MS = 7000;

async function countTags(lat: number, lng: number, tagFilters: string[], radiusM: number = RADIUS_M): Promise<number> {
  const clauses = tagFilters
    .map((tag) => `node[${tag}](around:${radiusM},${lat},${lng});way[${tag}](around:${radiusM},${lat},${lng});`)
    .join("\n");
  const query = `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_S}];(${clauses});out count;`;

  const res = await fetchWithTimeout(
    OVERPASS_ENDPOINT,
    {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      next: { revalidate: 60 * 60 * 24 * 14 },
    },
    CLIENT_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`Overpass request failed: ${res.status}`);
  const json = await res.json();
  const total = json?.elements?.[0]?.tags?.total;
  return total ? Number(total) : 0;
}

export interface OverpassRawCounts {
  restaurantsBars: number;
  culturalVenues: number;
  familyKidsActivities: number;
  greenSpaceCount: number; // proxy count; green space % is estimated from this
}

export async function getOverpassCounts(lat: number, lng: number): Promise<OverpassRawCounts> {
  const [restaurantsBars, culturalVenues, familyKidsActivities, greenSpaceCount] = await Promise.all([
    countTags(lat, lng, ['"amenity"="restaurant"', '"amenity"="bar"', '"amenity"="cafe"']),
    countTags(lat, lng, ['"amenity"="theatre"', '"amenity"="cinema"', '"tourism"="museum"', '"amenity"="arts_centre"']),
    countTags(lat, lng, ['"leisure"="playground"', '"amenity"="childcare"', '"leisure"="water_park"']),
    countTags(lat, lng, ['"leisure"="park"', '"leisure"="garden"']),
  ]);

  return { restaurantsBars, culturalVenues, familyKidsActivities, greenSpaceCount };
}

export interface OverpassTransportPresence {
  hasTrainStation: boolean;
  hasSubway: boolean;
  hasTramway: boolean;
  hasAirport: boolean;
}

/** Simple yes/no presence flags for a city's transport infrastructure —
 *  same 5km radius as the other density fields, except airport (see
 *  AIRPORT_RADIUS_M). Tag choices favour the single most consistently-used
 *  OSM tag per mode rather than trying to enumerate every regional tagging
 *  variant: railway=station (heavy/mainline rail), station=subway (the
 *  standard sub-tag distinguishing a metro/subway stop from a mainline
 *  station) plus railway=subway_entrance as a second, very consistently
 *  tagged signal, railway=tram_stop, and aeroway=aerodrome. */
export async function getTransportPresence(lat: number, lng: number): Promise<OverpassTransportPresence> {
  const [trainCount, subwayCount, tramCount, airportCount] = await Promise.all([
    countTags(lat, lng, ['"railway"="station"']),
    countTags(lat, lng, ['"station"="subway"', '"railway"="subway_entrance"']),
    countTags(lat, lng, ['"railway"="tram_stop"']),
    countTags(lat, lng, ['"aeroway"="aerodrome"'], AIRPORT_RADIUS_M),
  ]);

  return {
    hasTrainStation: trainCount > 0,
    hasSubway: subwayCount > 0,
    hasTramway: tramCount > 0,
    hasAirport: airportCount > 0,
  };
}

// Wider than the 5km default: sector signals like an industrial estate or
// out-of-town retail/office park are more spread out than restaurants/bars.
const SECTOR_RADIUS_M = 8000;

export interface EconomySectorCounts {
  technologyAndInnovation: number;
  tourismAndHospitality: number;
  financeAndServices: number;
  manufacturingAndIndustry: number;
  governmentAndPublicSector: number;
  naturalResourcesAndAgriculture: number;
}

/** Raw OSM POI/land-use counts per economic-sector bucket, within
 *  SECTOR_RADIUS_M of the city centre - used to flag the city's likely
 *  dominant local sector (see pickMainEconomyType below), as a genuinely
 *  city-level supplement to the country-level economyTypeProfile estimate.
 *
 *  HONEST CAVEAT: this is a point-of-interest density proxy, not real GDP
 *  or employment-share data - no free source for true city-level economic
 *  composition exists. Tag choices are a reasonable single-tag-per-concept
 *  mapping, not an exhaustive enumeration of every regional tagging
 *  variant, and OSM tagging density itself varies a lot by region (much
 *  richer in Western Europe/North America than elsewhere) - so a "no
 *  signal" result for smaller or less-mapped cities is expected and
 *  reported honestly (see pickMainEconomyType) rather than guessed at. */
export async function getEconomySectorCounts(lat: number, lng: number): Promise<EconomySectorCounts> {
  const [
    technologyAndInnovation,
    tourismAndHospitality,
    financeAndServices,
    manufacturingAndIndustry,
    governmentAndPublicSector,
    naturalResourcesAndAgriculture,
  ] = await Promise.all([
    countTags(lat, lng, ['"office"="it"', '"office"="coworking"', '"office"="research"'], SECTOR_RADIUS_M),
    countTags(
      lat,
      lng,
      ['"tourism"="hotel"', '"tourism"="attraction"', '"tourism"="museum"', '"tourism"="guest_house"'],
      SECTOR_RADIUS_M
    ),
    countTags(
      lat,
      lng,
      ['"amenity"="bank"', '"office"="insurance"', '"office"="financial"', '"office"="lawyer"', '"office"="accountant"'],
      SECTOR_RADIUS_M
    ),
    countTags(lat, lng, ['"landuse"="industrial"', '"man_made"="works"'], SECTOR_RADIUS_M),
    countTags(lat, lng, ['"office"="government"', '"amenity"="townhall"', '"amenity"="courthouse"'], SECTOR_RADIUS_M),
    countTags(
      lat,
      lng,
      ['"landuse"="farmland"', '"landuse"="orchard"', '"landuse"="vineyard"', '"landuse"="quarry"'],
      SECTOR_RADIUS_M
    ),
  ]);

  return {
    technologyAndInnovation,
    tourismAndHospitality,
    financeAndServices,
    manufacturingAndIndustry,
    governmentAndPublicSector,
    naturalResourcesAndAgriculture,
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
  const res = await fetchWithTimeout(
    OVERPASS_ENDPOINT,
    {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
    CLIENT_TIMEOUT_MS
  );
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
    const res = await fetchWithTimeout(
      OVERPASS_ENDPOINT,
      { method: "POST", body: `data=${encodeURIComponent(query)}`, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      CLIENT_TIMEOUT_MS
    );
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
  const res = await fetchWithTimeout(
    OVERPASS_ENDPOINT,
    { method: "POST", body: `data=${encodeURIComponent(query)}`, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    BEACH_CLIENT_TIMEOUT_MS
  );
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
