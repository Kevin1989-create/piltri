import path from "path";
import KDBush from "kdbush";
import { around } from "geokdbush";
import { assembleCityExploreData } from "@/lib/dataset/assemble";
import { NEARBY_KINDS, type CityRecord, type EncodedBoundary, type NearbyKind, type NearbyPoint } from "@/lib/dataset/schema";
import { PM25_SOURCE, samplePm25 } from "./airQuality";
import { AIRPORTS_SOURCE, loadAirports } from "./airports";
import { sampleBroadband } from "./broadband";
import { buildCountries, fetchWhoNationalPm25 } from "./countries";
import { LANGUAGES_SOURCE } from "./sources/languages";
import { BOUNDARY_SOURCE, sampleBoundaries } from "./boundaries";
import { BUILTUP_SOURCE, sampleBuiltUp } from "./builtup";
import { extractGeoNamesFeatures, MOUNTAIN_MIN_ELEVATION_M, MOUNTAIN_MIN_RISE_M, type PointSet } from "./geonames";
import { loadAllLakeShorePoints, loadCoastlinePoints, loadEarthquakes, loadRiverPoints } from "./hazards";
import { countNearCities, nearestFewNearCities, nearestNearCities } from "./nearCities";
import { writeDataset } from "./output";
import { extractOvertureBeaches, extractOverturePlaces, extractOvertureRail, loadOvertureCategory, POI, resolveOvertureRelease } from "./overture";
import { POPULATION_SOURCE, sampleDensity } from "./population";
import { KOPPEN_SOURCE, sampleKoppen } from "./koppenMap";
import { loadShortlist } from "./shortlist";
import { sampleUvIndex } from "./uv";
import { cached, log, OUT_DIR, pointsKey, round } from "./util";
import { openWaterNear, sampleClimate } from "./worldclim";

const LOCAL_RADIUS_KM = 5;
const AIRPORT_RADIUS_KM = 40; // airports sit well outside city centres
const PORT_RADIUS_KM = 10; // ports and ferry terminals sit on the water's edge
/** The city map's "nearest X": Overture places are searched this far out
 *  (they're many), GeoNames' anywhere up to NEARBY_MAX_KM. */
const NEARBY_OVERTURE_KM = 10;
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
/** A Yes figure's places on the city map: up to this many within its
 *  radius, nearest first, one per spot (points closer than DUP_KM are the
 *  same place from two sources). */
const MAX_FLAGS = 6;
const DUP_KM = 0.15;
const SMALL_COUNTRY_KM2 = 10_000;
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

async function main() {
  const startedAt = Date.now();
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
    const national = await fetchWhoNationalPm25();
    for (const cc of uncovered) countries[cc].pm25NationalEstimate = national[countryInfo[cc].iso3 ?? ""] ?? null;
    log("build", `PM2.5 national fallback: ${[...uncovered].map((cc) => `${cc}=${countries[cc].pm25NationalEstimate}`).join(" ")}`);
  }
  const density = await sampleDensity(points);
  const broadband = await sampleBroadband(points);

  const { glob: placesGlob, release } = await extractOverturePlaces();
  const { glob: railGlob } = await extractOvertureRail();
  // Counting within 5 km runs inside DuckDB (millions of restaurants never
  // enter JavaScript); only points needed for nearest distances are loaded.
  log("build", "counting Overture places within 5 km of every city (DuckDB)...");
  const counted = [POI.eating, POI.cultural, POI.family, POI.park, POI.school, POI.university, POI.train, POI.bus, POI.nursery, POI.careHome];
  const counts = await countNearCities(`SELECT cat, lat, lng FROM read_parquet('${placesGlob}') WHERE cat IN (${counted.join(",")})`, points, LOCAL_RADIUS_KM);
  const ovCount = (i: number, cat: number) => counts.get(i)?.get(cat) ?? 0;
  const ovTrain = await loadOvertureCategory(placesGlob, POI.train, true);
  // Up to MAX_FLAGS nearest of the kinds Overture covers best, within 5 km
  // - where a Yes figure's places are, on the city map.
  const ovFew = await nearestFewNearCities(
    `SELECT cat, lat, lng, name FROM read_parquet('${placesGlob}') WHERE cat IN (${[POI.school, POI.university, POI.bus, POI.nursery, POI.careHome].join(",")})`,
    points,
    LOCAL_RADIUS_KM,
    MAX_FLAGS * 2
  );
  // The nearest named place of the kinds Overture covers best, for the
  // city map ("nearest nursery: ..." - see nearbyOf below).
  const ovNearest = await nearestNearCities(
    `SELECT cat, lat, lng, name FROM read_parquet('${placesGlob}') WHERE cat IN (${[POI.school, POI.university, POI.bus, POI.nursery, POI.careHome].join(",")})`,
    points,
    NEARBY_OVERTURE_KM
  );
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
    coast: coastIdx,
    quakes: buildIndex(quakes),
    large: buildIndex({ lng: large.map((c) => c.lng), lat: large.map((c) => c.lat) }),
  };
  const peakElev = gn.peak1000.elev ?? [];

  // Each city's nearest place of every NEARBY_KINDS kind (pipeline output
  // nearby/<CC>-<n>.json): what its Yes/No and distance figures show on
  // the map. GeoNames and Overture both count where both do - the nearer
  // one wins.
  const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
  type Found = { lng: number; lat: number; name: string; km: number } | null;
  const fromIndex = (index: Index, hit: { id: number; km: number } | null, suffix = ""): Found =>
    hit ? { lng: index.points.lng[hit.id], lat: index.points.lat[hit.id], name: String(index.points.names?.[hit.id] ?? "") + suffix, km: hit.km } : null;
  const closer = (a: Found, b: Found): Found => (!a ? b : !b ? a : a.km <= b.km ? a : b);
  /** Several sources' places, nearest first, one per spot (the named one
   *  where two sources have the same place), at most MAX_FLAGS. */
  const pick = (...lists: Found[][]): NonNullable<Found>[] => {
    const all = lists.flat().filter((f): f is NonNullable<Found> => f != null).sort((a, b) => a.km - b.km);
    const kept: NonNullable<Found>[] = [];
    for (const f of all) {
      const same = kept.find((k) => haversineKm(k.lat, k.lng, f.lat, f.lng) < DUP_KM);
      if (same) {
        if (!same.name && f.name) same.name = f.name;
        continue;
      }
      kept.push({ ...f });
      if (kept.length >= MAX_FLAGS) break;
    }
    return kept;
  };
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
    const ov = (cat: number): Found => {
      const p = ovNearest.get(i)?.get(cat);
      return p ? { lng: p.lng, lat: p.lat, name: p.name, km: p.km } : null;
    };
    const geo = (index: Index) => fromIndex(index, nearest(index, lng, lat));
    // Up to MAX_FLAGS within `radius`, nearest first (around() sorts).
    const geoFew = (index: Index, radius = LOCAL_RADIUS_KM): Found[] =>
      index.size === 0
        ? []
        : around(index.kd, lng, lat, MAX_FLAGS * 3, radius, (id: number) => id < index.size).map((id: number) =>
            fromIndex(index, { id, km: haversineKm(lat, lng, index.points.lat[id], index.points.lng[id]) })
          );
    const ovFewOf = (cat: number): Found[] => (ovFew.get(i)?.get(cat) ?? []).map((p) => ({ ...p }));
    const peakHit = nearest(idx.peak, lng, lat, (id) => peakElev[id] >= minPeak);
    const largeHit = nearestLarge ? { lng: large[nearestLarge.id].lng, lat: large[nearestLarge.id].lat, name: large[nearestLarge.id].cityName, km: nearestLarge.km } : null;
    const found: Record<NearbyKind, Found> = {
      train: geo(idx.train),
      metro: geo(idx.metro),
      tram: geo(idx.tram),
      airport: geo(idx.airport),
      bus: closer(geo(idx.bus), ov(POI.bus)),
      port: geo(idx.port),
      nursery: ov(POI.nursery),
      school: closer(geo(idx.school), ov(POI.school)),
      university: closer(geo(idx.university), ov(POI.university)),
      careHome: ov(POI.careHome),
      beach: geo(idx.beach),
      mountain: fromIndex(idx.peak, peakHit, peakHit ? ` (${Math.round(peakElev[peakHit.id]).toLocaleString("en-GB")} m)` : ""),
      forest: geo(idx.forest),
      large: largeHit,
      lakeBeach: lakeBeachKm != null ? geo(idx.lakeBeach) : null,
      intlAirport: geo(idx.intlAirport),
      localAirport: geo(idx.localAirport),
    };
    // A Yes figure's places: all of them within its radius (up to
    // MAX_FLAGS), not just the nearest. Trams stay single - only their
    // track is mapped.
    const many: Partial<Record<NearbyKind, NonNullable<Found>[]>> = {
      train: pick(geoFew(idx.train)),
      metro: pick(geoFew(idx.metroStation)),
      bus: pick(geoFew(idx.bus), ovFewOf(POI.bus)),
      port: pick(geoFew(idx.port, PORT_RADIUS_KM)),
      nursery: pick(ovFewOf(POI.nursery)),
      school: pick(geoFew(idx.school), ovFewOf(POI.school)),
      university: pick(geoFew(idx.university), ovFewOf(POI.university)),
      careHome: pick(ovFewOf(POI.careHome)),
    };
    const encode = (f: NonNullable<Found>): NearbyPoint => [round4(f.lng), round4(f.lat), f.name.slice(0, 60)];
    nearbyById.set(
      c.cityId,
      NEARBY_KINDS.map((kind) => {
        const list = many[kind];
        if (list?.length) return list.map(encode);
        // None within the radius: the nearest further away, for the
        // distance figure ("Nearest train station").
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
      country: "World Bank Open Data (CC BY 4.0); WHO UHC service coverage index (data.who.int, CC BY 4.0); ND-GAIN country index; UN World Population Prospects 2024 median age",
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
    },
  });
  log("build", `dataset ${version} written to ${outDir} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
