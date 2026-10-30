import path from "path";
import KDBush from "kdbush";
import { around } from "geokdbush";
import { AIRPORT_REACH_KM, assembleCityExploreData } from "@/lib/dataset/assemble";
import { INSIDE_KINDS, INSIDE_TRACK_ONLY, NEARBY_KINDS, type CityRecord, type EncodedBoundary, type InsideKind, type NearbyKind, type NearbyPoint } from "@/lib/dataset/schema";
import { AGE_SOURCE, downloadAgeGroups, sampleMedianAge } from "./ageStructure";
import { PM25_SOURCE, samplePm25 } from "./airQuality";
import { AIRPORTS_SOURCE, loadAirports } from "./airports";
import { sampleBroadband } from "./broadband";
import { CONFLICT_SOURCE, sampleConflict } from "./conflict";
import { buildCountries, fetchWhoNationalPm25 } from "./countries";
import { LANGUAGES_SOURCE } from "./sources/languages";
import { BOUNDARY_SOURCE, sampleBoundaries } from "./boundaries";
import { BUILTUP_SOURCE, sampleBuiltUp } from "./builtup";
import { extractGeoNamesFeatures, MOUNTAIN_MIN_ELEVATION_M, MOUNTAIN_MIN_RISE_M, type PointSet } from "./geonames";
import { loadAllLakeShorePoints, loadCoastlinePoints, loadEarthquakes, loadRiverPoints } from "./hazards";
import { countNearCities } from "./nearCities";
import { writeDataset } from "./output";
import { extractOvertureBeaches, extractOverturePlaces, extractOvertureRail, loadOvertureCategory, POI, resolveOvertureRelease } from "./overture";
import { POPULATION_GROWTH_SOURCE, POPULATION_SOURCE, sampleDensity, samplePopulationGrowth } from "./population";
import { REGIONAL_GDP_SOURCE, sampleRegionalGdp } from "./regionalGdp";
import { anyInside, circleArea, cityArea, placesInside, type PlaceIndex } from "./insidePlaces";
import { KOPPEN_SOURCE, sampleKoppen } from "./koppenMap";
import { loadShortlist } from "./shortlist";
import { sampleUvIndex } from "./uv";
import { cached, log, OUT_DIR, pointsKey, round } from "./util";
import { openWaterNear, sampleClimate } from "./worldclim";

const LOCAL_RADIUS_KM = 5;
const AIRPORT_RADIUS_KM = 40; // airports sit well outside city centres
const PORT_RADIUS_KM = 10; // ports and ferry terminals sit on the water's edge
/** The city map's "nearest X", and a No's distance: anywhere up to this. */
const NEARBY_MAX_KM = 500;
const EARTHQUAKE_RADIUS_KM = 200;
const LARGE_CITY_POPULATION = 500_000;
/** A beach counts as a sea beach within this of the sea coast, a lake beach
 *  within this of a lake shore - and as neither (a river or estuary bank)
 *  within RIVER_CLEAR_KM of a major river (2026-10-14, on request: river
 *  beaches were being shown as "the beach"). */
const BEACH_SHORE_KM = 1;
const RIVER_CLEAR_KM = 1;
/** Lake beaches further than this aren't shown. */
const LAKE_BEACH_MAX_KM = 100;
const SMALL_COUNTRY_KM2 = 10_000;
/** Overture's categories are broad: its train stations include bus stops
 *  and training academies, its universities language schools and gyms,
 *  its hospitals clinics and practices (2026-10-29: "929 universities" in
 *  London). The places a city page lists "in the city" keep the ones
 *  whose name says what they are. */
const STATION_NAME = /station|railway|rail|bahnhof|gare|estaci[oó]n|stazione|esta[çc][aã]o|halte?|dworzec|n[aá]dra[žz]|вокзал|станция|stanica|駅|站/i;
const NOT_STATION_NAME = /bus stop|bus station|coach station|police station|fire station|petrol|gas station|charging/i;
const UNIVERSITY_NAME = /univers|hochschule|polytechn|大学|大學|университет|الجامعة/i;
const NOT_HOSPITAL_NAME = /(clinic|practice|surgery|dental|dentist|pharmacy|medical cent(?:er|re)|health cent(?:er|re)|laborator|physio|optic|veterinar|GP)/i;
const GHOST_MAX_PEOPLE = 1000;

type Points = { lng: ArrayLike<number>; lat: ArrayLike<number>; names?: ArrayLike<string | null> | null };
type Index = { kd: KDBush; points: Points; size: number };

function buildIndex(points: Points): Index {
  const kd = new KDBush(Math.max(points.lng.length, 1));
  for (let i = 0; i < points.lng.length; i++) kd.add(points.lng[i], points.lat[i]);
  if (points.lng.length === 0) kd.add(0, -89.999); // KDBush can't be empty; unreachable filler
  kd.finish();
  return { kd, points, size: points.lng.length };
}

function mergePoints(...sets: Points[]): Points {
  const lng: number[] = [];
  const lat: number[] = [];
  const names: string[] = [];
  for (const s of sets) {
    for (let i = 0; i < s.lng.length; i++) {
      lng.push(s.lng[i]);
      lat.push(s.lat[i]);
      names.push(s.names?.[i] ?? "");
    }
  }
  return { lng, lat, names };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Nearest point (optionally passing `accept`) - id and km, or null. */
function nearest(index: Index, lng: number, lat: number, accept?: (id: number) => boolean): { id: number; km: number } | null {
  if (index.size === 0) return null;
  const [id] = around(index.kd, lng, lat, 1, Infinity, (i: number) => i < index.size && (!accept || accept(i)));
  return id == null ? null : { id, km: haversineKm(lat, lng, index.points.lat[id], index.points.lng[id]) };
}

const anyWithin = (index: Index, lng: number, lat: number, km: number) =>
  index.size > 0 && around(index.kd, lng, lat, 1, km, (i: number) => i < index.size).length > 0;

const countWithin = (index: Index, lng: number, lat: number, km: number) =>
  index.size === 0 ? 0 : around(index.kd, lng, lat, Infinity, km, (i: number) => i < index.size).length;

/** The points whose name passes `keep` (unnamed ones only with `unnamed`). */
function keepNamed(points: Points, keep: (name: string) => boolean, unnamed = false): Points {
  const out = { lng: [] as number[], lat: [] as number[], names: [] as string[] };
  for (let i = 0; i < points.lng.length; i++) {
    const name = points.names?.[i] ?? "";
    if (name ? !keep(name) : !unnamed) continue;
    out.lng.push(points.lng[i]);
    out.lat.push(points.lat[i]);
    out.names.push(name);
  }
  return out;
}

function filterPoints(points: PointSet, keep: (lng: number, lat: number) => boolean): PointSet {
  const out: PointSet = { lng: [], lat: [], names: [] };
  for (let i = 0; i < points.lng.length; i++) {
    if (!keep(points.lng[i], points.lat[i])) continue;
    out.lng.push(points.lng[i]);
    out.lat.push(points.lat[i]);
    out.names.push(points.names[i]);
  }
  return out;
}

/** Keeps only the highest peak per `cellDeg` grid cell (~2 km) - the Alps
 *  alone have ~9,000 named 1,000 m+ peaks, most within a few hundred
 *  metres of a higher one. Pin mode's nearest-mountain distance moves by at
 *  most a cell; its tiles shrink by more than half. */
function highestPerCell(peaks: PointSet, cellDeg: number): PointSet {
  const best = new Map<string, number>();
  const elev = peaks.elev ?? [];
  for (let i = 0; i < peaks.lng.length; i++) {
    const key = `${Math.floor(peaks.lat[i] / cellDeg)}|${Math.floor(peaks.lng[i] / cellDeg)}`;
    const current = best.get(key);
    if (current == null || elev[i] > elev[current]) best.set(key, i);
  }
  const keep = [...best.values()];
  return {
    lng: keep.map((i) => peaks.lng[i]),
    lat: keep.map((i) => peaks.lat[i]),
    names: keep.map((i) => peaks.names[i]),
    elev: keep.map((i) => elev[i]),
  };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

/** A local source added in phase 1 (2026-10-24) that fails leaves its
 *  figures out this month - empty, and missing from the manifest, so the
 *  site hides them - rather than stopping the whole refresh. */
async function optional<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    log("build", `WARNING: ${name} failed and is left out of this dataset: ${String(err).slice(0, 300)}`);
    // On GitHub, an annotation too: it shows on the run's page, which -
    // unlike the log - needs no sign-in (2026-10-28: two sources were left
    // out and the reason was only in the log).
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=${name} left out::${String(err).slice(0, 300).replace(/\r?\n/g, " ")}`);
    return null;
  }
}

async function main() {
  const startedAt = Date.now();
  // WorldPop's age grids are slow to download: started now, alongside the
  // outlines, and awaited when the median age is computed.
  const ageFiles = downloadAgeGroups();
  ageFiles.catch(() => {}); // reported where it's awaited
  const { cities: shortlist, countries: countryInfo } = await loadShortlist();
  const points = shortlist.map((c) => ({ lat: c.lat, lng: c.lng }));
  const countries = await buildCountries(countryInfo);
  // Outlines first, while the build holds little else in memory: matching
  // and measuring ~100k polygons is the heaviest step, and late in the
  // build it ran the GitHub runner out of memory (2026-10-01).
  const outlines = await sampleBoundaries(shortlist);
  // A town with no border of its own in the map data gets the outline of
  // its built-up area instead (drawn differently on the site).
  const withoutOutline = shortlist.flatMap((c, i) => (outlines[i] ? [] : [i]));
  const builtUpList = await cached(`builtup-v2-${await resolveOvertureRelease()}-${pointsKey(shortlist)}`, () =>
    sampleBuiltUp(shortlist.map((c) => ({ lat: c.lat, lng: c.lng, population: c.population })), withoutOutline)
  );
  log("build", `outlines: ${shortlist.length - withoutOutline.length} borders + ${builtUpList.filter(Boolean).length} built-up areas, of ${shortlist.length} cities`);

  const [gn, coast, lakeShores, rivers, quakes] = await Promise.all([
    extractGeoNamesFeatures(),
    loadCoastlinePoints(),
    loadAllLakeShorePoints(),
    loadRiverPoints(),
    loadEarthquakes(),
  ]);
  const climate = await sampleClimate(points);
  const koppen = await sampleKoppen(points);
  const uv = await sampleUvIndex(points);
  const pm25 = await samplePm25(points);
  // Small island nations are mostly outside the satellite PM2.5 map's land
  // mask: their towns fall back to WHO's national estimate, labelled as
  // such. Only for small countries - an island of a big one (Lakshadweep)
  // would be badly misdescribed by its national average, so stays empty.
  const uncovered = new Set(
    shortlist
      .filter((c, i) => pm25[i] == null && (countries[c.countryCode]?.demographics.countryLandAreaKm2 ?? Infinity) < SMALL_COUNTRY_KM2)
      .map((c) => c.countryCode)
  );
  if (uncovered.size) {
    // WHO's API can be down (2026-10-28: a 500 for every request); those
    // towns then show no figure rather than failing the refresh.
    const national = (await optional("WHO national PM2.5", fetchWhoNationalPm25)) ?? {};
    for (const cc of uncovered) countries[cc].pm25NationalEstimate = national[countryInfo[cc].iso3 ?? ""] ?? null;
    log("build", `PM2.5 national fallback: ${[...uncovered].map((cc) => `${cc}=${countries[cc].pm25NationalEstimate}`).join(" ")}`);
  }
  const density = await sampleDensity(points);
  const broadband = await sampleBroadband(points);
  // Local versions of country figures (2026-10-24, phase 1): reported or
  // counted for the place itself, never estimated - null where there is
  // no such figure.
  const populationGrowth = await optional("population growth", () => samplePopulationGrowth(points));
  const medianAge = await optional("median age", async () => sampleMedianAge(points, await ageFiles));
  const conflict = await optional("armed conflict", () => sampleConflict(points));
  // Regional GDP per head (Kummu et al.) is switched off (2026-10-30, owner):
  // 2018-2021 figures - Lyon's from the pandemic year - for a whole region,
  // counted where people work. Local household income comes in phase 2.
  const regionGdp = null as Awaited<ReturnType<typeof sampleRegionalGdp>> | null;

  const { glob: placesGlob, release } = await extractOverturePlaces();
  const { glob: railGlob } = await extractOvertureRail();
  // Counting within 5 km runs inside DuckDB (millions of restaurants never
  // enter JavaScript); only points needed for nearest distances are loaded.
  log("build", "counting Overture places within 5 km of every city (DuckDB)...");
  const counted = [POI.eating, POI.cultural, POI.family, POI.park, POI.school, POI.university, POI.train, POI.bus, POI.nursery, POI.careHome];
  const counts = await countNearCities(`SELECT cat, lat, lng FROM read_parquet('${placesGlob}') WHERE cat IN (${counted.join(",")})`, points, LOCAL_RADIUS_KM);
  const ovCount = (i: number, cat: number) => counts.get(i)?.get(cat) ?? 0;
  const ovTrain = await loadOvertureCategory(placesGlob, POI.train, true);
  const tramTrack = mergePoints(await loadOvertureCategory(railGlob, "tram"), await loadOvertureCategory(railGlob, "light_rail"));
  const metroTrack = mergePoints(await loadOvertureCategory(railGlob, "subway"), await loadOvertureCategory(railGlob, "monorail"));
  log("build", `rail points: tram/light rail ${tramTrack.lng.length}, metro ${metroTrack.lng.length}`);

  log("build", "indexing...");
  const trainPoints = mergePoints(gn.rail, ovTrain);
  const large = shortlist.filter((c) => c.population >= LARGE_CITY_POPULATION);
  // Beaches: GeoNames' and OpenStreetMap's (Overture), sorted by the water
  // they're on. A sea beach is near the sea coast, a lake beach near a lake
  // shore - and a "beach" near a major river is a river or estuary bank,
  // neither (GeoNames' also include bathing spots and pools).
  const coastIdx = buildIndex(coast);
  const lakeIdx = buildIndex(lakeShores);
  const riverIdx = buildIndex(rivers);
  const ovBeaches = await loadOvertureCategory((await extractOvertureBeaches()).glob, "beach", true);
  const airports = await loadAirports();
  const hospitals = await loadOvertureCategory(placesGlob, POI.hospital, true);
  log("build", `hospitals: ${hospitals.lng.length}`);
  // Every Overture place of the kinds a city page counts "in the city"
  // (2026-10-29) - their places in each city, and the nearest anywhere.
  const ovAll = {
    school: buildIndex(await loadOvertureCategory(placesGlob, POI.school, true)),
    university: buildIndex(keepNamed(await loadOvertureCategory(placesGlob, POI.university, true), (n) => UNIVERSITY_NAME.test(n))),
    bus: buildIndex(await loadOvertureCategory(placesGlob, POI.bus, true)),
    nursery: buildIndex(await loadOvertureCategory(placesGlob, POI.nursery, true)),
    careHome: buildIndex(await loadOvertureCategory(placesGlob, POI.careHome, true)),
    metro: buildIndex(await loadOvertureCategory(placesGlob, POI.metro, true)),
  };
  log("build", `in-the-city sources: ${Object.entries(ovAll).map(([k, v]) => `${k} ${v.size}`).join(", ")}`);
  const allBeaches = mergePoints(gn.beach, ovBeaches) as PointSet;
  const onRiver = (lng: number, lat: number) => anyWithin(riverIdx, lng, lat, RIVER_CLEAR_KM);
  const onCoast = (lng: number, lat: number) => anyWithin(coastIdx, lng, lat, BEACH_SHORE_KM);
  // A sea beach also needs open water beside it: the coastline follows
  // estuaries far inland (see openWaterNear).
  const seaCandidates = filterPoints(allBeaches, (lng, lat) => onCoast(lng, lat) && !onRiver(lng, lat));
  const open = await openWaterNear(Array.from(seaCandidates.lng, (lng, k) => ({ lng, lat: seaCandidates.lat[k] })));
  let k = 0;
  const beaches = filterPoints(seaCandidates, () => open[k++]);
  const lakeBeaches = filterPoints(
    allBeaches,
    (lng, lat) => !onCoast(lng, lat) && anyWithin(lakeIdx, lng, lat, BEACH_SHORE_KM) && !onRiver(lng, lat)
  );
  log("build", `beaches: ${beaches.lng.length} on the sea, ${lakeBeaches.lng.length} on lakes, of ${allBeaches.lng.length}`);
  const idx = {
    school: buildIndex(gn.school),
    university: buildIndex(gn.university),
    train: buildIndex(trainPoints),
    metro: buildIndex(mergePoints(gn.metro, metroTrack)),
    // Stations only, for the map's flags (the track is lines).
    metroStation: buildIndex(gn.metro),
    tram: buildIndex(tramTrack),
    bus: buildIndex(gn.bus),
    airport: buildIndex(gn.airport),
    peak: buildIndex(gn.peak1000),
    forest: buildIndex(gn.forest),
    volcano: buildIndex(gn.volcano),
    port: buildIndex(gn.port),
    // Mapped beaches (GeoNames, OpenStreetMap natural=beach via Overture's
    // base theme) - not the Overture places "beach" category, which
    // includes beach bars and volleyball courts.
    beach: buildIndex(beaches),
    lakeBeach: buildIndex(lakeBeaches),
    intlAirport: buildIndex(airports.international),
    localAirport: buildIndex(airports.local),
    hospital: buildIndex(hospitals),
    coast: coastIdx,
    quakes: buildIndex(quakes),
    large: buildIndex({ lng: large.map((c) => c.lng), lat: large.map((c) => c.lat) }),
  };
  const peakElev = gn.peak1000.elev ?? [];
  const metroTrackIdx = buildIndex(metroTrack);
  // The listed stations and hospitals: by name (see STATION_NAME).
  const trainListed = buildIndex(mergePoints(gn.rail, keepNamed(ovTrain, (n) => STATION_NAME.test(n) && !NOT_STATION_NAME.test(n))));
  const hospitalListed = buildIndex(keepNamed(hospitals, (n) => !NOT_HOSPITAL_NAME.test(n), true));
  /** Where each kind's places in a city come from (the same sources as its
   *  figures), and a line that alone makes it a Yes (tram and metro track). */
  const INSIDE_SOURCES: Record<InsideKind, { sources: PlaceIndex[]; track?: PlaceIndex }> = {
    train: { sources: [trainListed] },
    metro: { sources: [idx.metroStation, ovAll.metro], track: metroTrackIdx },
    tram: { sources: [], track: idx.tram },
    bus: { sources: [idx.bus, ovAll.bus] },
    port: { sources: [idx.port] },
    nursery: { sources: [ovAll.nursery] },
    school: { sources: [idx.school, ovAll.school] },
    university: { sources: [idx.university, ovAll.university] },
    careHome: { sources: [ovAll.careHome] },
    hospital: { sources: [hospitalListed] },
    intlAirport: { sources: [idx.intlAirport] },
    localAirport: { sources: [idx.localAirport] },
    beach: { sources: [idx.beach] },
    lakeBeach: { sources: [idx.lakeBeach] },
    mountain: { sources: [idx.peak] },
    forest: { sources: [idx.forest] },
  };
  // A town with no border of its own uses its built-up area.
  const builtUpOf = new Map(withoutOutline.map((i, k) => [i, builtUpList[k]]));
  const outline = (i: number) => outlines[i] ?? builtUpOf.get(i) ?? null;
  const insideById = new Map<string, (NearbyPoint[] | 0)[]>();
  let insidePlacesTotal = 0;

  // Each city's nearest place of every NEARBY_KINDS kind (pipeline output
  // nearby/<CC>-<n>.json): what its Yes/No and distance figures show on
  // the map. GeoNames and Overture both count where both do - the nearer
  // one wins.
  const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
  type Found = { lng: number; lat: number; name: string; km: number } | null;
  const fromIndex = (index: Index, hit: { id: number; km: number } | null, suffix = ""): Found =>
    hit ? { lng: index.points.lng[hit.id], lat: index.points.lat[hit.id], name: String(index.points.names?.[hit.id] ?? "") + suffix, km: hit.km } : null;
  const closer = (a: Found, b: Found): Found => (!a ? b : !b ? a : a.km <= b.km ? a : b);
  const nearbyById = new Map<string, (NearbyPoint | NearbyPoint[] | 0)[]>();

  log("build", "computing per-city fields...");
  const allRecords: { cc: string; record: CityRecord }[] = shortlist.map((c, i) => {
    const { lng, lat } = c;
    const km = (hit: { km: number } | null, digits = 1) => (hit ? round(hit.km, digits) : null);
    // Present if GeoNames or Overture has one within range.
    const has = (index: Index, overtureCat?: number, radius = LOCAL_RADIUS_KM) =>
      (overtureCat != null && ovCount(i, overtureCat) > 0) || anyWithin(index, lng, lat, radius);
    const coastKm = nearest(idx.coast, lng, lat)?.km ?? null;
    const beachKm = nearest(idx.beach, lng, lat)?.km ?? null;
    const lakeBeachHit = nearest(idx.lakeBeach, lng, lat);
    const lakeBeachKm = lakeBeachHit && lakeBeachHit.km <= LAKE_BEACH_MAX_KM ? lakeBeachHit.km : null;
    // A mountain is a 1,000 m+ peak that also rises 500 m+ above the city.
    const minPeak = Math.max(MOUNTAIN_MIN_ELEVATION_M, (c.elevationM ?? 0) + MOUNTAIN_MIN_RISE_M);
    const nearestLarge = c.population >= LARGE_CITY_POPULATION ? null : nearest(idx.large, lng, lat);
    const capital = countries[c.countryCode]?.capital;
    const capitalKm = capital ? haversineKm(lat, lng, capital.lat, capital.lng) : null;
    const geo = (index: Index) => fromIndex(index, nearest(index, lng, lat));
    const peakHit = nearest(idx.peak, lng, lat, (id) => peakElev[id] >= minPeak);
    const largeHit = nearestLarge ? { lng: large[nearestLarge.id].lng, lat: large[nearestLarge.id].lat, name: large[nearestLarge.id].cityName, km: nearestLarge.km } : null;
    // The same places as the "in the city" lists (INSIDE_SOURCES).
    const found: Record<NearbyKind, Found> = {
      train: geo(trainListed),
      metro: geo(idx.metro),
      tram: geo(idx.tram),
      airport: geo(idx.airport),
      bus: closer(geo(idx.bus), geo(ovAll.bus)),
      port: geo(idx.port),
      nursery: geo(ovAll.nursery),
      school: closer(geo(idx.school), geo(ovAll.school)),
      university: closer(geo(idx.university), geo(ovAll.university)),
      careHome: geo(ovAll.careHome),
      beach: geo(idx.beach),
      mountain: fromIndex(idx.peak, peakHit, peakHit ? ` (${Math.round(peakElev[peakHit.id]).toLocaleString("en-GB")} m)` : ""),
      forest: geo(idx.forest),
      large: largeHit,
      lakeBeach: lakeBeachKm != null ? geo(idx.lakeBeach) : null,
      intlAirport: geo(idx.intlAirport),
      localAirport: geo(idx.localAirport),
      hospital: geo(hospitalListed),
    };
    const encode = (f: NonNullable<Found>): NearbyPoint => [round4(f.lng), round4(f.lat), f.name.slice(0, 60)];
    // In the city or within 1 km of it: every place of each kind, how
    // many, and the nearest anywhere (for a No).
    const area = cityArea(lat, lng, outline(i));
    // Airports: within reach of the centre (owner, 2026-10-30: London's
    // Gatwick, Luton, Stansted...), not in the city.
    const airportArea = circleArea(lat, lng, AIRPORT_REACH_KM);
    const insideLists = INSIDE_KINDS.map((kind) => {
      const { sources } = INSIDE_SOURCES[kind];
      if (kind === "intlAirport" || kind === "localAirport") return placesInside(airportArea, sources);
      return kind === "mountain"
        ? placesInside(area, sources, (_, id) => peakElev[id] >= minPeak, (_, id) => ` (${Math.round(peakElev[id]).toLocaleString("en-GB")} m)`)
        : placesInside(area, sources);
    });
    const insideCounts = INSIDE_KINDS.map((kind, k) => {
      const { track } = INSIDE_SOURCES[kind];
      return insideLists[k].length || (track && anyInside(area, track) ? INSIDE_TRACK_ONLY : 0);
    });
    const insideNearestKm = INSIDE_KINDS.map((kind) => {
      const f = found[kind];
      return f && f.km <= NEARBY_MAX_KM ? round(f.km, 1) : null;
    });
    insideById.set(c.cityId, insideLists.map((list) => (list.length ? list : 0)));
    insidePlacesTotal += insideLists.reduce((sum, list) => sum + list.length, 0);
    nearbyById.set(
      c.cityId,
      // The nearest of each kind - a No's journey on the map (a Yes shows
      // its whole list, inside/).
      NEARBY_KINDS.map((kind) => {
        const f = found[kind];
        return f && f.km <= NEARBY_MAX_KM ? encode(f) : 0;
      })
    );
    if (i > 0 && i % 10000 === 0) log("build", `${i}/${shortlist.length}`);
    return {
      cc: c.countryCode,
      record: {
        id: c.cityId,
        customId: c.customId,
        name: c.cityName,
        region: c.region,
        lat,
        lng,
        population: c.population,
        elevationM: c.elevationM,
        timezone: c.timezone,
        densityPerKm2: density[i],
        ...climate[i],
        koppenCode: koppen.today[i],
        koppenCode2085: koppen.future[i],
        avgAnnualPm25: pm25[i],
        avgAnnualUvIndexMax: uv[i],
        earthquakeCount50yr: countWithin(idx.quakes, lng, lat, EARTHQUAKE_RADIUS_KM),
        distanceToVolcanoKm: km(nearest(idx.volcano, lng, lat)),
        distanceToCoastKm: round(coastKm, 1),
        distanceToBeachKm: round(beachKm, 1),
        distanceToLakeBeachKm: round(lakeBeachKm, 1),
        distanceToMountainKm: km(nearest(idx.peak, lng, lat, (id) => peakElev[id] >= minPeak)),
        distanceToForestKm: km(nearest(idx.forest, lng, lat)),
        // Under 1 km is the capital itself (two geocodes of one centre).
        distanceToCapitalKm: capitalKm == null ? null : capitalKm < 1 ? 0 : round(capitalKm, 1),
        distanceToAirportKm: km(nearest(idx.airport, lng, lat)),
        distanceToIntlAirportKm: km(nearest(idx.intlAirport, lng, lat)),
        distanceToLocalAirportKm: km(nearest(idx.localAirport, lng, lat)),
        distanceToTrainStationKm: km(nearest(idx.train, lng, lat)),
        distanceToHospitalKm: km(nearest(idx.hospital, lng, lat)),
        populationGrowth5yrPct: populationGrowth?.[i] ?? null,
        medianAge: medianAge?.[i] ?? null,
        conflictEvents5yr: conflict?.events[i] ?? null,
        conflictDeaths5yr: conflict?.deaths[i] ?? null,
        regionGdpPerHeadPpp: regionGdp?.[i].perHead ?? null,
        regionGdpYear: regionGdp?.[i].year ?? null,
        regionGdpVsNationalPct: regionGdp?.[i].vsNationalPct ?? null,
        insideCounts,
        insideNearestKm,
        nearestLargeCityName: nearestLarge ? large[nearestLarge.id].cityName : null,
        nearestLargeCityKm: nearestLarge ? round(nearestLarge.km, 0) : null,
        restaurantsBarsWithin5km: ovCount(i, POI.eating),
        parksWithin5km: ovCount(i, POI.park),
        culturalVenuesWithin5km: ovCount(i, POI.cultural),
        familyActivitiesWithin5km: ovCount(i, POI.family),
        hasTrainStation: has(idx.train, POI.train),
        hasSubway: has(idx.metro),
        hasTramway: has(idx.tram),
        hasAirport: has(idx.airport, undefined, AIRPORT_RADIUS_KM),
        hasBusStation: has(idx.bus, POI.bus),
        hasSchool: has(idx.school, POI.school),
        hasUniversity: has(idx.university, POI.university),
        hasNursery: ovCount(i, POI.nursery) > 0,
        hasCareHome: ovCount(i, POI.careHome) > 0,
        hasPort: anyWithin(idx.port, lng, lat, PORT_RADIUS_KM),
        broadbandDownloadMbps: broadband.fixed.mbps[i],
        broadbandRadiusKm: broadband.fixed.radiusKm[i],
        mobileDownloadMbps: broadband.mobile.mbps[i],
        mobileRadiusKm: broadband.mobile.radiusKm[i],
        rankPiltri: null,
        rankEconomy: null,
        rankSafetyStability: null,
        rankClimate: null,
        rankLiveability: null,
      },
    };
  });

  // Some GeoNames entries aren't towns at the point given: a municipality's
  // centre point in empty land (Angola's Chitato, "246,880 people"), a
  // national park, an abandoned city (Aghdam). Every local figure would
  // describe empty countryside, so they're left out - but only with no
  // sign of a town at all: under 1,000 people within 5 km (GHS-POP), no
  // restaurant and no school, and inland (the population grid undercounts
  // small islands, whose towns are real).
  const isGhost = ({ record: r }: { record: CityRecord }) =>
    (r.densityPerKm2 ?? 0) * Math.PI * LOCAL_RADIUS_KM ** 2 < GHOST_MAX_PEOPLE &&
    !r.restaurantsBarsWithin5km &&
    !r.hasSchool &&
    (r.distanceToCoastKm ?? Infinity) > 5;
  log("build", `in the city: ${insidePlacesTotal.toLocaleString("en-GB")} places listed; ${INSIDE_KINDS.map((kind, k) => `${kind} yes ${allRecords.filter((r) => (r.record.insideCounts?.[k] ?? 0) !== 0).length}`).join(", ")}`);
  const ghosts = allRecords.filter(isGhost);
  const records = allRecords.filter((r) => !isGhost(r));
  log("build", `left out ${ghosts.length} places with no town at the listed point, e.g. ${ghosts.slice(0, 5).map((g) => `${g.record.name} (${g.cc})`).join(", ")}`);

  // Distribution report - for sanity-checking and calibrating scales.
  const report = (label: string, values: (number | null)[]) => {
    const v = values.filter((x): x is number => x != null);
    log("dist", `${label}: n=${v.length} p10=${percentile(v, 0.1)} p50=${percentile(v, 0.5)} p90=${percentile(v, 0.9)} p99=${percentile(v, 0.99)}`);
  };
  report("PM2.5", records.map((r) => r.record.avgAnnualPm25));
  report("UV index", records.map((r) => r.record.avgAnnualUvIndexMax));
  report("density /km2", records.map((r) => r.record.densityPerKm2));
  report("broadband Mbps", records.map((r) => r.record.broadbandDownloadMbps));
  report("mobile Mbps", records.map((r) => r.record.mobileDownloadMbps));
  report("population growth 2020-2025 %", records.map((r) => r.record.populationGrowth5yrPct));
  report("median age", records.map((r) => r.record.medianAge));
  report("hospital km", records.map((r) => r.record.distanceToHospitalKm));
  report("conflict events 50 km", records.map((r) => r.record.conflictEvents5yr));
  report("regional GDP vs national %", records.map((r) => r.record.regionGdpVsNationalPct));
  log("dist", `tram: ${records.filter((r) => r.record.hasTramway).length} cities, metro: ${records.filter((r) => r.record.hasSubway).length} cities`);

  // World ranks: score every city exactly as the site does, then rank.
  // Ties share a rank (1, 2, 2, 4...).
  log("build", "scoring and ranking...");
  const generatedAt = new Date().toISOString();
  const scored = records.map(({ cc, record }) => ({ cc, record, data: assembleCityExploreData(cc, record, countries[cc], generatedAt) }));
  // For calibrating AMENITY_RATIOS (lib/dataset/assemble.ts).
  report("places to eat per 1,000 residents", scored.map((x) => x.data.liveability.restaurantsBarsPer1k));
  report("parks per 10,000 residents", scored.map((x) => x.data.liveability.parksPer10k));
  const assignRanks = (value: (x: (typeof scored)[number]) => number, set: (r: CityRecord, rank: number) => void) => {
    const sorted = [...scored].sort((a, b) => value(b) - value(a));
    let rank = 0;
    sorted.forEach((x, i) => {
      if (i === 0 || value(x) !== value(sorted[i - 1])) rank = i + 1;
      set(x.record, rank);
    });
  };
  assignRanks((x) => x.data.piltriScore, (r, k) => (r.rankPiltri = k));
  assignRanks((x) => x.data.sectionScores.economy, (r, k) => (r.rankEconomy = k));
  assignRanks((x) => x.data.sectionScores.safetyStability, (r, k) => (r.rankSafetyStability = k));
  assignRanks((x) => x.data.sectionScores.climate, (r, k) => (r.rankClimate = k));
  assignRanks((x) => x.data.sectionScores.liveability, (r, k) => (r.rankLiveability = k));

  const version = generatedAt.slice(0, 10).replace(/-/g, "") + "-" + Date.now().toString(36);
  const outDir = path.join(OUT_DIR, version);
  const bounds = new Map<string, EncodedBoundary>();
  shortlist.forEach((c, i) => {
    const outline = outlines[i];
    if (outline) bounds.set(c.cityId, outline);
  });
  const builtUp = new Map<string, EncodedBoundary>();
  withoutOutline.forEach((i, k) => {
    const outline = builtUpList[k];
    if (outline) builtUp.set(shortlist[i].cityId, outline);
  });
  await writeDataset(outDir, {
    version,
    generatedAt,
    countries,
    cities: scored,
    bounds,
    builtUp,
    nearby: nearbyById,
    inside: insideById,
    poi: {
      airport: gn.airport,
      // GeoNames stations only, since pin mode shows the NAME: Overture's
      // train_station category includes kiosks and ticket machines.
      train: gn.rail,
      beach: beaches,
      coast: { ...coast, names: [] } as PointSet,
      mountain: highestPerCell(gn.peak1000, 0.02),
      // Towns: pin mode's "near <town>" label and local ground elevation.
      city: {
        lng: records.map((c) => c.record.lng),
        lat: records.map((c) => c.record.lat),
        names: records.map((c) => c.record.name),
        elev: records.map((c) => c.record.elevationM),
      },
    },
    sources: {
      shortlist: "GeoNames cities1000 (CC BY 4.0) - every place with 1,000+ people; time zones, capitals, currencies",
      country: "World Bank Open Data (CC BY 4.0); WHO UHC service coverage index (via World Bank WDI, CC BY 4.0); ND-GAIN country index; UN World Population Prospects 2024 median age",
      languages: LANGUAGES_SOURCE,
      climate: "WorldClim 2.1 monthly normals 1970-2000 (CC BY 4.0); sunshine estimated from solar radiation (FAO-56), snowfall from sub-zero monthly precipitation",
      climateType: KOPPEN_SOURCE,
      uv: "NASA POWER all-sky UV index climatology 2001-2020 (CERES SYN1deg), converted to noon peak",
      airQuality: PM25_SOURCE,
      density: POPULATION_SOURCE,
      ...(broadband.quarter
        ? { internet: `Speedtest by Ookla Global Fixed and Mobile Network Performance Maps, quarter starting ${broadband.quarter} (CC BY-NC-SA 4.0)` }
        : {}),
      elevation: "GeoNames SRTM elevation",
      places: `Overture Maps places and transportation ${release} (CDLA-Permissive-2.0 / ODbL) + GeoNames features`,
      mountains: `GeoNames peaks of ${MOUNTAIN_MIN_ELEVATION_M} m+ that rise ${MOUNTAIN_MIN_RISE_M} m+ above the city`,
      coast: "Natural Earth 1:10m coastline, lakes and rivers (public domain); beaches from GeoNames and OpenStreetMap (Overture Maps base theme, ODbL) - within 1 km of the sea coast a sea beach, of a lake shore a lake beach, and within 1 km of a major river neither",
      earthquakes: "USGS earthquake catalogue, magnitude 5+ since 1970 (public domain)",
      outlines: `${BOUNDARY_SOURCE}, release ${release}`,
      builtUp: BUILTUP_SOURCE,
      airports: AIRPORTS_SOURCE,
      // The site shows a local figure's rows only when its source is here.
      ...(populationGrowth ? { populationGrowth: POPULATION_GROWTH_SOURCE } : {}),
      ...(medianAge ? { age: AGE_SOURCE } : {}),
      hospitals: `Overture Maps places ${release} - hospitals and emergency departments (CDLA-Permissive-2.0)`,
      inside: `In the city or within 1 km of its outline (5 km of the centre without one), airports within ${AIRPORT_REACH_KM} km: GeoNames, Overture Maps places ${release}, OurAirports, mapped beaches and peaks`,
      ...(conflict ? { conflict: CONFLICT_SOURCE } : {}),
      ...(regionGdp ? { regionGdp: REGIONAL_GDP_SOURCE } : {}),
    },
  });
  log("build", `dataset ${version} written to ${outDir} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
