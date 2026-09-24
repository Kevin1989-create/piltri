// Regenerates data/static/discover-cities.json from GeoNames' free,
// public-domain "cities5000" export (every city with population > 5000,
// or a national capital regardless of size - see
// https://download.geonames.org/export/dump/) - replaces the previous
// cities15000-based cut (~6,300 cities, population >= 15,000) with a
// materially larger, still-genuinely-curated shortlist (~69,700 cities,
// population >= 5,000), per user request (2026-09-24) after asking why
// the shortlist was so much smaller than GeoNames' own coverage.
//
// Run with: node scripts/generateDiscoverCities.mjs
// Safe to re-run any time GeoNames' own data refreshes - this always
// downloads fresh source files rather than reusing a stale local copy.
//
// Not part of the app's runtime - a one-off/periodic build step, same
// spirit as the admin backfill scripts but for the shortlist itself
// rather than per-city enrichment data.

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import path from "path";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, ".tmp-geonames");
const OUT_PATH = path.join(__dirname, "..", "data", "static", "discover-cities.json");
// Capitals are pulled from this same cities5000.txt download (GeoNames
// feature code PPLC = "seat of a primary state/national capital") rather
// than a separate fetch - added 2026-09-24 for Quality of Life's
// "Distance to capital city" field (lib/data-sources/capitals.ts).
const CAPITALS_OUT_PATH = path.join(__dirname, "..", "data", "static", "country-capitals.json");

if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  await pipeline(res.body, createWriteStream(destPath));
}

function parseTsv(text) {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t"));
}

async function main() {
  console.log("Downloading GeoNames source files...");
  const citiesZipPath = path.join(TMP_DIR, "cities5000.zip");
  const citiesTxtPath = path.join(TMP_DIR, "cities5000.txt");
  const admin1Path = path.join(TMP_DIR, "admin1CodesASCII.txt");
  const countryInfoPath = path.join(TMP_DIR, "countryInfo.txt");

  await download("https://download.geonames.org/export/dump/cities5000.zip", citiesZipPath);
  await download("https://download.geonames.org/export/dump/admin1CodesASCII.txt", admin1Path);
  await download("https://download.geonames.org/export/dump/countryInfo.txt", countryInfoPath);

  console.log("Unzipping cities5000.zip...");
  execSync(`unzip -o "${citiesZipPath}" -d "${TMP_DIR}"`, { stdio: "inherit" });

  console.log("Parsing reference files...");
  // admin1CodesASCII.txt: "CC.admin1code" \t name \t asciiname \t geonameid
  const admin1Rows = parseTsv(readFileSync(admin1Path, "utf8"));
  const admin1NameByCode = new Map(admin1Rows.map(([code, name]) => [code, name]));

  // countryInfo.txt: ISO \t ISO3 \t ISO-Numeric \t fips \t Country \t ... (# comment lines)
  const countryInfoLines = readFileSync(countryInfoPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0 && !line.startsWith("#"));
  const countryNameByCode = new Map(countryInfoLines.map((line) => line.split("\t")).map(([iso, , , , country]) => [iso, country]));

  console.log("Parsing cities5000.txt...");
  const cityRows = parseTsv(readFileSync(citiesTxtPath, "utf8"));
  console.log(`  ${cityRows.length} raw rows`);

  const bySlug = new Map();
  const capitalsByCountry = new Map();
  for (const cols of cityRows) {
    const [, name, , , latStr, lngStr, , featureCode, countryCode, , admin1Code, , , , populationStr] = cols;
    const population = Number(populationStr);
    if (!name || !countryCode || !Number.isFinite(population) || population <= 0) continue;
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const country = countryNameByCode.get(countryCode) ?? countryCode;
    const region = admin1Code ? (admin1NameByCode.get(`${countryCode}.${admin1Code}`) ?? null) : null;
    const cityId = `${name}-${countryCode}`.toLowerCase().replace(/\s+/g, "-");

    // Same-named city in the same country (rare but real, e.g. multiple
    // small towns sharing a name) - keep whichever has the larger
    // population rather than silently overwrite with whichever happened
    // to sort last, and rather than emit a duplicate cityId (used as
    // cities.slug's unique key downstream - see lib/aggregation/cache.ts).
    const existing = bySlug.get(cityId);
    if (existing && existing.population >= population) continue;

    bySlug.set(cityId, { cityId, cityName: name, region, country, countryCode, lat, lng, population });

    // PPLC = "seat of a primary state/national capital" - GeoNames' own
    // feature-code convention. A handful of countries have no PPLC row at
    // all (disputed/unusual capital arrangements) - those are simply
    // absent from the output rather than guessed at.
    if (featureCode === "PPLC") capitalsByCountry.set(countryCode, { name, lat, lng });
  }

  const cities = Array.from(bySlug.values()).sort((a, b) => b.population - a.population);
  console.log(`  ${cities.length} unique cities after dedup`);

  writeFileSync(OUT_PATH, JSON.stringify(cities, null, 2) + "\n");
  console.log(`Wrote ${cities.length} cities to ${OUT_PATH}`);

  const capitals = Object.fromEntries(capitalsByCountry);
  writeFileSync(CAPITALS_OUT_PATH, JSON.stringify(capitals, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(capitals).length} country capitals to ${CAPITALS_OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
