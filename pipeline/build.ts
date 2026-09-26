import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import KDBush from "kdbush";
import { around } from "geokdbush";
import { CITY_FIELDS, DATASET_SCHEMA_VERSION, encodeCity, type CityRecord, type CityRow, type DatasetManifest } from "@/lib/dataset/schema";
import { assembleCityExploreData, RANGES } from "@/lib/dataset/assemble";
import type { DiscoverCity } from "@/lib/types";
import { buildCountries } from "./countries";
import { extractGeoNamesFeatures, loadCityElevations, MOUNTAIN_MIN_ELEVATION_M, MOUNTAIN_MIN_RISE_M, type PointSet } from "./geonames";
import { loadCoastlinePoints, loadEarthquakes } from "./hazards";
import { countPlacesNearCities, extractOverturePlaces, loadOvertureCategory, POI } from "./overture";
import { sampleClimate } from "./worldclim";
import { buildPoiTiles } from "./poiTiles";
import { log, OUT_DIR, round } from "./util";

const LOCAL_RADIUS_KM = 5; // same 5 km radius the old live Overpass queries used
const AIRPORT_RADIUS_KM = 40; // airports sit well outside city centres
const EARTHQUAKE_RADIUS_KM = 200;

type Index = { kd: KDBush; size: number };

function buildIndex(lng: ArrayLike<number>, lat: ArrayLike<number>): Index {
  const kd = new KDBush(Math.max(lng.length, 1));
  for (let i = 0; i < lng.length; i++) kd.add(lng[i], lat[i]);
  if (lng.length === 0) kd.add(0, -89.999); // KDBush can't be empty; unreachable filler
  kd.finish();
  return { kd, size: lng.length };
}

function mergeSets(...sets: { lng: ArrayLike<number>; lat: ArrayLike<number> }[]) {
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

function nearestKm(index: Index, lng: ArrayLike<number>, lat: ArrayLike<number>, cLng: number, cLat: number): number | null {
  if (index.size === 0) return null;
  const [id] = around(index.kd, cLng, cLat, 1);
  if (id == null || id >= index.size) return null;
  return haversineKm(cLat, cLng, lat[id], lng[id]);
}

function countWithin(index: Index, cLng: number, cLat: number, km: number): number {
  if (index.size === 0) return 0;
  return around(index.kd, cLng, cLat, Infinity, km).filter((id: number) => id < index.size).length;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

async function main() {
  const startedAt = Date.now();
  const repoRoot = path.resolve(__dirname, "..");
  const shortlist: DiscoverCity[] = JSON.parse(readFileSync(path.join(repoRoot, "data/static/discover-cities.json"), "utf8"));
  log("build", `${shortlist.length} shortlisted cities`);

  const countryNames = new Map<string, string>();
  for (const c of shortlist) if (!countryNames.has(c.countryCode)) countryNames.set(c.countryCode, c.country);
  const countries = await buildCountries(countryNames);

  const [elevations, gn, coast, quakes] = await Promise.all([
    loadCityElevations(),
    extractGeoNamesFeatures(),
    loadCoastlinePoints(),
    loadEarthquakes(),
  ]);
  const climate = await sampleClimate(shortlist.map((c) => ({ lat: c.lat, lng: c.lng })));

  const { glob: overtureFile, release: overtureRelease } = await extractOverturePlaces();
  // Counting within 5 km happens inside DuckDB (millions of restaurant
  // points never enter JavaScript); only the two categories we need
  // nearest-DISTANCES for (train stations, beaches) are loaded as points.
  log("build", "counting Overture places within 5 km of every city (DuckDB)...");
  const overtureCounts = await countPlacesNearCities(
    overtureFile,
    shortlist.map((c) => ({ lat: c.lat, lng: c.lng })),
    LOCAL_RADIUS_KM,
    [POI.eating, POI.cultural, POI.family, POI.park, POI.school, POI.university, POI.train, POI.metro, POI.bus, POI.tram]
  );
  const ovCount = (i: number, cat: number) => overtureCounts.get(i)?.get(cat) ?? 0;
  const ov = {
    train: await loadOvertureCategory(overtureFile, POI.train, true),
  };
  log("build", `overture points: train=${ov.train.lng.length}`);

  log("build", "indexing...");
  const trainSet = mergeSets(gn.rail, ov.train);
  const idx = {
    school: buildIndex(gn.school.lng, gn.school.lat),
    university: buildIndex(gn.university.lng, gn.university.lat),
    train: buildIndex(trainSet.lng, trainSet.lat),
    metro: buildIndex(gn.metro.lng, gn.metro.lat),
    bus: buildIndex(gn.bus.lng, gn.bus.lat),
    tram: buildIndex(gn.tram.lng, gn.tram.lat),
    airport: buildIndex(gn.airport.lng, gn.airport.lat),
    peak: buildIndex(gn.peak1000.lng, gn.peak1000.lat),
    forest: buildIndex(gn.forest.lng, gn.forest.lat),
    volcano: buildIndex(gn.volcano.lng, gn.volcano.lat),
    coast: buildIndex(coast.lng, coast.lat),
    quakes: buildIndex(quakes.lng, quakes.lat),
  };
  // Natural beach features only (GeoNames) + the sea coast. Overture's
  // "beach" category turned out to include beach bars, beach-volleyball
  // venues etc. - it put central London 0.2 km from a "beach".
  const beachSet = mergeSets(gn.beach);
  const beachIdx = buildIndex(beachSet.lng, beachSet.lat);
  const peakElev = gn.peak1000.elev ?? [];
  /** Nearest peak that is both >= 1,000 m and rises >= 500 m above the city. */
  const nearestMountainKm = (cLng: number, cLat: number, cityElevM: number): number | null => {
    const minElev = Math.max(MOUNTAIN_MIN_ELEVATION_M, cityElevM + MOUNTAIN_MIN_RISE_M);
    const [id] = around(idx.peak.kd, cLng, cLat, 1, Infinity, (i: number) => i < idx.peak.size && peakElev[i] >= minElev);
    return id == null ? null : haversineKm(cLat, cLng, gn.peak1000.lat[id], gn.peak1000.lng[id]);
  };

  log("build", "computing per-city fields...");
  const raw = shortlist.map((c, i) => {
    const counts = {
      eating: ovCount(i, POI.eating),
      cultural: ovCount(i, POI.cultural),
      family: ovCount(i, POI.family),
      park: ovCount(i, POI.park),
    };
    // Present if either source has one within range (GeoNames via the JS
    // index, Overture via the DuckDB counts).
    const has = (index: Index, overtureCat?: number, km = LOCAL_RADIUS_KM) =>
      (overtureCat != null && ovCount(i, overtureCat) > 0) ||
      (index.size > 0 && around(index.kd, c.lng, c.lat, 1, km).some((id: number) => id < index.size));
    const coastKm = nearestKm(idx.coast, coast.lng, coast.lat, c.lng, c.lat);
    const beachFeatureKm = nearestKm(beachIdx, beachSet.lng, beachSet.lat, c.lng, c.lat);
    if (i > 0 && i % 10000 === 0) log("build", `${i}/${shortlist.length}`);
    return {
      c,
      counts,
      has: {
        train: has(idx.train, POI.train),
        metro: has(idx.metro, POI.metro),
        tram: has(idx.tram, POI.tram),
        bus: has(idx.bus, POI.bus),
        school: has(idx.school, POI.school),
        university: has(idx.university, POI.university),
        airport: has(idx.airport, undefined, AIRPORT_RADIUS_KM),
      },
      coastKm,
      beachKm: [coastKm, beachFeatureKm].filter((v): v is number => v != null).reduce((a, b) => Math.min(a, b), Infinity),
      mountainKm: nearestMountainKm(c.lng, c.lat, elevations.get(`${c.lat}|${c.lng}`) ?? 0),
      airportKm: nearestKm(idx.airport, gn.airport.lng, gn.airport.lat, c.lng, c.lat),
      trainKm: nearestKm(idx.train, trainSet.lng, trainSet.lat, c.lng, c.lat),
      forestKm: nearestKm(idx.forest, gn.forest.lng, gn.forest.lat, c.lng, c.lat),
      volcanoKm: nearestKm(idx.volcano, gn.volcano.lng, gn.volcano.lat, c.lng, c.lat),
      quakes: countWithin(idx.quakes, c.lng, c.lat, EARTHQUAKE_RADIUS_KM),
      climate: climate[i],
      elevation: elevations.get(`${c.lat}|${c.lng}`) ?? null,
    };
  });

  // Distribution report - used to calibrate COUNT_CAPS in lib/dataset/assemble.ts.
  const big = raw.filter((r) => r.c.population >= 100000);
  const report = (label: string, values: number[]) =>
    log(
      "dist",
      `${label}: p10=${percentile(values, 0.1)} p50=${percentile(values, 0.5)} p90=${percentile(values, 0.9)} p95=${percentile(values, 0.95)} p99=${percentile(values, 0.99)}`
    );
  for (const key of ["eating", "cultural", "family", "park"] as const) {
    report(`${key} within 5 km (all cities)`, raw.map((r) => r.counts[key]));
    report(`${key} within 5 km (100k+ cities)`, big.map((r) => r.counts[key]));
  }

  const records: { cc: string; record: CityRecord }[] = raw.map((r) => {
    const pop = r.c.population;
    const record: CityRecord = {
      id: r.c.cityId,
      name: r.c.cityName,
      region: r.c.region,
      lat: r.c.lat,
      lng: r.c.lng,
      population: pop,
      elevationM: r.elevation != null ? Math.round(r.elevation) : null,
      ...r.climate,
      avgAnnualPm25: null,
      avgAnnualUvIndexMax: null,
      earthquakeCount50yr: r.quakes,
      distanceToVolcanoKm: round(r.volcanoKm, 1),
      distanceToCoastKm: round(r.coastKm, 1),
      distanceToBeachKm: Number.isFinite(r.beachKm) ? round(r.beachKm, 1) : null,
      distanceToMountainKm: round(r.mountainKm, 1),
      distanceToForestKm: round(r.forestKm, 1),
      restaurantsBarsWithin5km: r.counts.eating,
      parksWithin5km: r.counts.park,
      culturalVenuesWithin5km: r.counts.cultural,
      familyActivitiesWithin5km: r.counts.family,
      hasTrainStation: r.has.train,
      hasSubway: r.has.metro,
      // Deliberately unknown (null -> row hidden): neither GeoNames (83 tram
      // stops worldwide) nor Overture maps tram stops - the first build
      // flagged only 62 cities, with Melbourne, Amsterdam, Vienna, Prague,
      // Lisbon and Milan all wrongly "No". Light rail is covered by the
      // "Metro / light rail" flag instead.
      hasTramway: null,
      hasAirport: r.has.airport,
      hasBusStation: r.has.bus,
      hasSchool: r.has.school,
      hasUniversity: r.has.university,
      mainEconomyType: null,
      cityAreaKm2: null,
      distanceToAirportKm: round(r.airportKm, 1),
      distanceToTrainStationKm: round(r.trainKm, 1),
      rankPiltri: null,
      rankEconomy: null,
      rankSafetyStability: null,
      rankClimate: null,
      rankLiveability: null,
    };
    return { cc: r.c.countryCode, record };
  });

  // World ranks: score every city exactly as the site will (same assemble
  // + scoring code), then rank. Ties share a rank (1, 2, 2, 4...).
  log("build", "ranking...");
  const scored = records.map(({ cc, record }) => {
    const data = assembleCityExploreData(cc, record, countries[cc], "");
    return { record, piltri: data.piltriScore, s: data.sectionScores };
  });
  const assignRanks = (value: (x: (typeof scored)[number]) => number, set: (r: CityRecord, rank: number) => void) => {
    const sorted = [...scored].sort((a, b) => value(b) - value(a));
    let rank = 0;
    sorted.forEach((x, i) => {
      if (i === 0 || value(x) !== value(sorted[i - 1])) rank = i + 1;
      set(x.record, rank);
    });
  };
  assignRanks((x) => x.piltri, (r, k) => (r.rankPiltri = k));
  assignRanks((x) => x.s.economy, (r, k) => (r.rankEconomy = k));
  assignRanks((x) => x.s.safetyStability, (r, k) => (r.rankSafetyStability = k));
  assignRanks((x) => x.s.climate, (r, k) => (r.rankClimate = k));
  assignRanks((x) => x.s.liveability, (r, k) => (r.rankLiveability = k));

  // --- Write the dataset -------------------------------------------------
  const version = new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Date.now().toString(36);
  const outDir = path.join(OUT_DIR, version);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, "cities"), { recursive: true });

  const byCountry = new Map<string, CityRow[]>();
  for (const { cc, record } of records) {
    if (!byCountry.has(cc)) byCountry.set(cc, []);
    byCountry.get(cc)!.push(encodeCity(record));
  }
  for (const [cc, rows] of byCountry) {
    writeFileSync(path.join(outDir, "cities", `${cc}.json`), JSON.stringify({ countryCode: cc, rows }));
  }
  writeFileSync(path.join(outDir, "countries.json"), JSON.stringify(countries));
  writeFileSync(path.join(outDir, "all-cities.json"), JSON.stringify({ fields: CITY_FIELDS, countries: Object.fromEntries(byCountry) }));

  await buildPoiTiles(path.join(outDir, "poi"), {
    airport: gn.airport,
    // GeoNames stations only for pin mode, where the station's NAME is shown:
    // Overture's train_station category includes ticket machines, kiosks
    // and shops inside stations ("Kew Gardens QBM" turned up in central
    // Westminster). City pages still use both sources for presence.
    train: gn.rail,
    beach: gn.beach,
    coast: coast as PointSet,
    mountain: gn.peak1000,
  });

  const manifest: DatasetManifest = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    version,
    generatedAt: new Date().toISOString(),
    cityCount: records.length,
    countryCount: Object.keys(countries).length,
    sources: {
      shortlist: "GeoNames cities5000 (CC BY 4.0) - every place with 5,000+ people",
      country: "World Bank Open Data (CC BY 4.0), WHO GHO UHC index, ND-GAIN, UN median age",
      climate: "WorldClim 2.1 monthly normals 1970-2000 (CC BY 4.0); sunshine hours estimated from solar radiation (FAO-56 Angström-Prescott), snowfall estimated from sub-zero monthly precipitation",
      elevation: "GeoNames SRTM elevation",
      places: `Overture Maps places ${overtureRelease} (CDLA-Permissive-2.0) + GeoNames features`,
      mountains: `GeoNames peaks of ${MOUNTAIN_MIN_ELEVATION_M} m+ that rise ${MOUNTAIN_MIN_RISE_M} m+ above the city`,
      coast: "Natural Earth 1:10m coastline (public domain)",
      earthquakes: "USGS earthquake catalogue, magnitude 5+ since 1970 (public domain)",
    },
  };
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  log("build", `dataset ${version} written to ${outDir} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  console.log(`DATASET_DIR=${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
