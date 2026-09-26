import path from "path";
import KDBush from "kdbush";
import { around } from "geokdbush";
import { assembleCityExploreData } from "@/lib/dataset/assemble";
import type { CityRecord } from "@/lib/dataset/schema";
import { PM25_SOURCE, samplePm25 } from "./airQuality";
import { sampleBroadband } from "./broadband";
import { buildCountries } from "./countries";
import { extractGeoNamesFeatures, MOUNTAIN_MIN_ELEVATION_M, MOUNTAIN_MIN_RISE_M, type PointSet } from "./geonames";
import { loadCoastlinePoints, loadEarthquakes } from "./hazards";
import { countNearCities } from "./nearCities";
import { writeDataset } from "./output";
import { extractOverturePlaces, extractOvertureRail, loadOvertureCategory, POI } from "./overture";
import { POPULATION_SOURCE, sampleDensity } from "./population";
import { KOPPEN_SOURCE, sampleKoppen } from "./koppenMap";
import { loadShortlist } from "./shortlist";
import { sampleUvIndex } from "./uv";
import { log, OUT_DIR, round } from "./util";
import { sampleClimate } from "./worldclim";

const LOCAL_RADIUS_KM = 5;
const AIRPORT_RADIUS_KM = 40; // airports sit well outside city centres
const EARTHQUAKE_RADIUS_KM = 200;
const LARGE_CITY_POPULATION = 500_000;

type Points = { lng: ArrayLike<number>; lat: ArrayLike<number> };
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
  for (const s of sets) {
    for (let i = 0; i < s.lng.length; i++) {
      lng.push(s.lng[i]);
      lat.push(s.lat[i]);
    }
  }
  return { lng, lat };
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

  const [gn, coast, quakes] = await Promise.all([extractGeoNamesFeatures(), loadCoastlinePoints(), loadEarthquakes()]);
  const climate = await sampleClimate(points);
  const koppen = await sampleKoppen(points);
  const uv = await sampleUvIndex(points);
  const pm25 = await samplePm25(points);
  const density = await sampleDensity(points);
  const broadband = await sampleBroadband(points);

  const { glob: placesGlob, release } = await extractOverturePlaces();
  const { glob: railGlob } = await extractOvertureRail();
  // Counting within 5 km runs inside DuckDB (millions of restaurants never
  // enter JavaScript); only points needed for nearest distances are loaded.
  log("build", "counting Overture places within 5 km of every city (DuckDB)...");
  const counted = [POI.eating, POI.cultural, POI.family, POI.park, POI.school, POI.university, POI.train, POI.bus];
  const counts = await countNearCities(`SELECT cat, lat, lng FROM read_parquet('${placesGlob}') WHERE cat IN (${counted.join(",")})`, points, LOCAL_RADIUS_KM);
  const ovCount = (i: number, cat: number) => counts.get(i)?.get(cat) ?? 0;
  const ovTrain = await loadOvertureCategory(placesGlob, POI.train);
  const tramTrack = mergePoints(await loadOvertureCategory(railGlob, "tram"), await loadOvertureCategory(railGlob, "light_rail"));
  const metroTrack = mergePoints(await loadOvertureCategory(railGlob, "subway"), await loadOvertureCategory(railGlob, "monorail"));
  log("build", `rail points: tram/light rail ${tramTrack.lng.length}, metro ${metroTrack.lng.length}`);

  log("build", "indexing...");
  const trainPoints = mergePoints(gn.rail, ovTrain);
  const large = shortlist.filter((c) => c.population >= LARGE_CITY_POPULATION);
  const idx = {
    school: buildIndex(gn.school),
    university: buildIndex(gn.university),
    train: buildIndex(trainPoints),
    metro: buildIndex(mergePoints(gn.metro, metroTrack)),
    tram: buildIndex(tramTrack),
    bus: buildIndex(gn.bus),
    airport: buildIndex(gn.airport),
    peak: buildIndex(gn.peak1000),
    forest: buildIndex(gn.forest),
    volcano: buildIndex(gn.volcano),
    // Natural beach features (GeoNames) + the sea coast. Overture's
    // "beach" category includes beach bars and volleyball courts.
    beach: buildIndex(gn.beach),
    coast: buildIndex(coast),
    quakes: buildIndex(quakes),
    large: buildIndex({ lng: large.map((c) => c.lng), lat: large.map((c) => c.lat) }),
  };
  const peakElev = gn.peak1000.elev ?? [];

  log("build", "computing per-city fields...");
  const records: { cc: string; record: CityRecord }[] = shortlist.map((c, i) => {
    const { lng, lat } = c;
    const km = (hit: { km: number } | null, digits = 1) => (hit ? round(hit.km, digits) : null);
    // Present if GeoNames or Overture has one within range.
    const has = (index: Index, overtureCat?: number, radius = LOCAL_RADIUS_KM) =>
      (overtureCat != null && ovCount(i, overtureCat) > 0) || anyWithin(index, lng, lat, radius);
    const coastKm = nearest(idx.coast, lng, lat)?.km ?? null;
    const beachKm = Math.min(coastKm ?? Infinity, nearest(idx.beach, lng, lat)?.km ?? Infinity);
    // A mountain is a 1,000 m+ peak that also rises 500 m+ above the city.
    const minPeak = Math.max(MOUNTAIN_MIN_ELEVATION_M, (c.elevationM ?? 0) + MOUNTAIN_MIN_RISE_M);
    const nearestLarge = c.population >= LARGE_CITY_POPULATION ? null : nearest(idx.large, lng, lat);
    const capital = countries[c.countryCode]?.capital;
    const capitalKm = capital ? haversineKm(lat, lng, capital.lat, capital.lng) : null;
    if (i > 0 && i % 10000 === 0) log("build", `${i}/${shortlist.length}`);
    return {
      cc: c.countryCode,
      record: {
        id: c.cityId,
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
        distanceToBeachKm: Number.isFinite(beachKm) ? round(beachKm, 1) : null,
        distanceToMountainKm: km(nearest(idx.peak, lng, lat, (id) => peakElev[id] >= minPeak)),
        distanceToForestKm: km(nearest(idx.forest, lng, lat)),
        // Under 1 km is the capital itself (two geocodes of one centre).
        distanceToCapitalKm: capitalKm == null ? null : capitalKm < 1 ? 0 : round(capitalKm, 1),
        distanceToAirportKm: km(nearest(idx.airport, lng, lat)),
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
        broadbandDownloadMbps: broadband.fixedMbps[i],
        mobileDownloadMbps: broadband.mobileMbps[i],
        rankPiltri: null,
        rankEconomy: null,
        rankSafetyStability: null,
        rankClimate: null,
        rankLiveability: null,
      },
    };
  });

  // Distribution report - for calibrating COUNT_CAPS and sanity-checking.
  const big = records.filter((r) => (r.record.population ?? 0) >= 100000);
  const report = (label: string, values: (number | null)[]) => {
    const v = values.filter((x): x is number => x != null);
    log("dist", `${label}: n=${v.length} p10=${percentile(v, 0.1)} p50=${percentile(v, 0.5)} p90=${percentile(v, 0.9)} p99=${percentile(v, 0.99)}`);
  };
  report("restaurants (100k+)", big.map((r) => r.record.restaurantsBarsWithin5km));
  report("parks (100k+)", big.map((r) => r.record.parksWithin5km));
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
  writeDataset(outDir, {
    version,
    generatedAt,
    countries,
    cities: scored,
    poi: {
      airport: gn.airport,
      // GeoNames stations only, since pin mode shows the NAME: Overture's
      // train_station category includes kiosks and ticket machines.
      train: gn.rail,
      beach: gn.beach,
      coast: { ...coast, names: [] } as PointSet,
      mountain: highestPerCell(gn.peak1000, 0.02),
      // Towns: pin mode's "near <town>" label and local ground elevation.
      city: {
        lng: shortlist.map((c) => c.lng),
        lat: shortlist.map((c) => c.lat),
        names: shortlist.map((c) => c.cityName),
        elev: shortlist.map((c) => c.elevationM),
      },
    },
    sources: {
      shortlist: "GeoNames cities5000 (CC BY 4.0) - every place with 5,000+ people; time zones, capitals, currencies",
      country: "World Bank Open Data (CC BY 4.0), WHO GHO UHC index, ND-GAIN, UN median age",
      climate: "WorldClim 2.1 monthly normals 1970-2000 (CC BY 4.0); sunshine estimated from solar radiation (FAO-56), snowfall from sub-zero monthly precipitation",
      climateType: KOPPEN_SOURCE,
      uv: "NASA POWER all-sky UV index climatology 2001-2020 (CERES SYN1deg), converted to noon peak",
      airQuality: PM25_SOURCE,
      density: POPULATION_SOURCE,
      internet: `Ookla Speedtest open data, quarter starting ${broadband.quarter} (CC BY-NC-SA 4.0)`,
      elevation: "GeoNames SRTM elevation",
      places: `Overture Maps places and transportation ${release} (CDLA-Permissive-2.0 / ODbL) + GeoNames features`,
      mountains: `GeoNames peaks of ${MOUNTAIN_MIN_ELEVATION_M} m+ that rise ${MOUNTAIN_MIN_RISE_M} m+ above the city`,
      coast: "Natural Earth 1:10m coastline (public domain)",
      earthquakes: "USGS earthquake catalogue, magnitude 5+ since 1970 (public domain)",
    },
  });
  log("build", `dataset ${version} written to ${outDir} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
