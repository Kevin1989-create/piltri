/**
 * Address search inside a city (2026-11-11, owner: "an additional level of
 * search, at address level once in a city" - full addresses with house
 * numbers, through a live service, on the owner's say). Photon, Komoot's
 * free search over OpenStreetMap (photon.komoot.io): no key, no account;
 * its terms ask for fair use - "extensive usage will be throttled".
 *
 * The second live service the site calls, after the road journeys
 * (lib/routing.ts): only while someone types in the map's address box -
 * after a pause in typing, three letters at least, one request at a time,
 * answers reused. Kept to the city: results come from a box around it
 * only, nearest its centre first. When Photon is down or slow the box
 * says so - nothing else depends on it.
 */

const BASE = "https://photon.komoot.io/api/";
/** Photon not answering by then: the map's own names instead
 *  (components/explore/AddressSearch.tsx). */
const TIMEOUT_MS = 4000;
export const ADDRESS_MIN_LETTERS = 3;
export const ADDRESS_PAUSE_MS = 450;
/** Shown; more are asked for (ASKED), so the city's own aren't crowded out
 *  by nearer-sounding ones around it. */
const LIMIT = 6;
const ASKED = 12;

export const ADDRESS_ATTRIBUTION = "Search: Photon by Komoot · © OpenStreetMap";

export interface AddressResult {
  /** Stable enough for a list key. */
  id: string;
  lat: number;
  lng: number;
  /** "12 Rue de la Source", "Mairie d'Olivet". */
  title: string;
  /** "283 Rue du Général de Gaulle · 45160 Olivet" - what's left to say. */
  subtitle: string;
}

/** [west, south, east, north]. */
export type SearchBox = [number, number, number, number];

/** Countries that write the house number before the street ("12 Rue de la
 *  Source", "10 Downing Street"); the rest after it ("Hauptstraße 5"). */
const NUMBER_FIRST = new Set([
  "FR", "GB", "IE", "US", "CA", "AU", "NZ", "LU", "MC", "IN", "ZA", "SG", "HK", "MY", "PH", "NG", "KE", "GH", "TH", "LK", "PK", "BD", "MA", "DZ", "TN", "SN", "CI", "CM", "MG", "RE",
  "IL", "EG", "SA", "AE", "JM", "TT",
]);

interface PhotonProperties {
  osm_type?: string;
  osm_id?: number;
  name?: string;
  housenumber?: string;
  street?: string;
  postcode?: string;
  city?: string;
  district?: string;
  locality?: string;
  county?: string;
  state?: string;
  countrycode?: string;
  type?: string;
}

function streetLine(p: PhotonProperties): string {
  if (!p.street) return "";
  if (!p.housenumber) return p.street;
  return NUMBER_FIRST.has((p.countrycode ?? "").toUpperCase()) ? `${p.housenumber} ${p.street}` : `${p.street} ${p.housenumber}`;
}

function describe(p: PhotonProperties): { title: string; subtitle: string } | null {
  const street = streetLine(p);
  const town = [p.postcode, p.city ?? p.locality ?? p.county].filter(Boolean).join(" ");
  const quarter = p.district && p.district !== p.city ? p.district : "";
  // A named place: its name, then where it is. An address: the address,
  // then its quarter and town.
  const title = p.name ?? street;
  if (!title) return null;
  const rest = p.name ? [street && street !== p.name ? street : "", town] : [quarter, town];
  return { title, subtitle: rest.filter(Boolean).join(" · ") };
}

const cache = new Map<string, AddressResult[]>();

/** "Orléans" and "orleans" alike. */
const plainName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Addresses and named places matching `text` in `box` - those in
 *  `placeName` itself first (Photon puts an exact name before a near one:
 *  "mairie" in the next village came before "Mairie d'Olivet"), each group
 *  in Photon's order. Throws when Photon can't answer (the caller says
 *  so); an aborted call throws too (the caller dropped it). */
export async function searchAddresses(
  text: string,
  box: SearchBox,
  near: { lat: number; lng: number },
  placeName?: string,
  signal?: AbortSignal
): Promise<AddressResult[]> {
  const q = text.trim();
  if (q.length < ADDRESS_MIN_LETTERS) return [];
  const key = `${q.toLowerCase()}|${box.map((v) => v.toFixed(3)).join(",")}|${placeName ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const params = new URLSearchParams({
    q,
    limit: String(ASKED),
    lat: near.lat.toFixed(5),
    lon: near.lng.toFixed(5),
    zoom: "14",
    location_bias_scale: "0.1",
    bbox: box.map((v) => v.toFixed(5)).join(","),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`${BASE}?${params}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Photon ${res.status}`);
    const json = (await res.json()) as { features?: { geometry?: { coordinates?: [number, number] }; properties?: PhotonProperties }[] };
    const seen = new Set<string>();
    const here: AddressResult[] = [];
    const around: AddressResult[] = [];
    const place = placeName ? plainName(placeName) : "";
    for (const f of json.features ?? []) {
      const at = f.geometry?.coordinates;
      const p = f.properties;
      const said = p && describe(p);
      if (!at || !p || !said) continue;
      // The same place twice (a building and its entrance): once.
      const same = `${said.title}|${said.subtitle}`;
      if (seen.has(same)) continue;
      seen.add(same);
      const inPlace = !!place && [p.city, p.district, p.locality, p.county].some((v) => v && plainName(v) === place);
      (inPlace ? here : around).push({ id: `${p.osm_type ?? ""}${p.osm_id ?? seen.size}`, lng: at[0], lat: at[1], ...said });
    }
    const results = [...here, ...around].slice(0, LIMIT);
    cache.set(key, results);
    return results;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** The box to search for a place: its outline's, a little wider (what's
 *  just across its edge still counts), or ~12 km around its centre. */
export function searchBoxFor(center: { lat: number; lng: number }, outline?: { west: number; south: number; east: number; north: number } | null): SearchBox {
  const kx = Math.cos((center.lat * Math.PI) / 180) || 1;
  if (outline) {
    const padLat = 3 / 111.32;
    const padLng = padLat / kx;
    return [outline.west - padLng, outline.south - padLat, outline.east + padLng, outline.north + padLat];
  }
  const dLat = 12 / 111.32;
  const dLng = dLat / kx;
  return [center.lng - dLng, center.lat - dLat, center.lng + dLng, center.lat + dLat];
}
