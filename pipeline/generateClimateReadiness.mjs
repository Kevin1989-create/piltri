// Downloads Notre Dame Global Adaptation Initiative (ND-GAIN) country-level
// climate change vulnerability/readiness data and writes
// pipeline/static/climate-readiness.json (ISO2 country code -> latest-year
// scores) - a one-time/periodic ingestion, same spirit as
// generateDiscoverCities.mjs, since ND-GAIN publishes a downloadable
// dataset (updated annually), not a live API.
//
// Run with: node scripts/generateClimateReadiness.mjs
//
// ND-GAIN's own composite "gain" score is 0-100 (higher = more
// vulnerability-resistant AND more ready to adapt); readiness/vulnerability
// are separately published 0-1 sub-scores. Free, respected, widely cited in
// climate policy work - see https://gain.nd.edu.
//
// The download link requires browser-like headers (verified live
// 2026-09-24: a plain curl gets a 403, a request with a real User-Agent +
// Referer succeeds) - not a hard block, just basic anti-scraping.

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import path from "path";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, ".tmp-ndgain");
const OUT_PATH = path.join(__dirname, "static", "climate-readiness.json");
const ZIP_URL = "https://gain.nd.edu/assets/647440/ndgain_countryindex_2026.zip";

// Same ISO2->ISO3 map as pipeline/sources/countryCodes.ts (duplicated
// here rather than imported - this is a plain .mjs build script, not
// compiled through the app's TS pipeline).
const ISO2_TO_ISO3 = {"AF":"AFG","AL":"ALB","DZ":"DZA","AS":"ASM","AD":"AND","AO":"AGO","AI":"AIA","AQ":"ATA","AG":"ATG","AR":"ARG","AM":"ARM","AW":"ABW","AU":"AUS","AT":"AUT","AZ":"AZE","BS":"BHS","BH":"BHR","BD":"BGD","BB":"BRB","BY":"BLR","BE":"BEL","BZ":"BLZ","BJ":"BEN","BM":"BMU","BT":"BTN","BO":"BOL","BA":"BIH","BW":"BWA","BR":"BRA","BN":"BRN","BG":"BGR","BF":"BFA","BI":"BDI","CV":"CPV","KH":"KHM","CM":"CMR","CA":"CAN","KY":"CYM","CF":"CAF","TD":"TCD","CL":"CHL","CN":"CHN","CO":"COL","KM":"COM","CG":"COG","CD":"COD","CR":"CRI","CI":"CIV","HR":"HRV","CU":"CUB","CY":"CYP","CZ":"CZE","DK":"DNK","DJ":"DJI","DM":"DMA","DO":"DOM","EC":"ECU","EG":"EGY","SV":"SLV","GQ":"GNQ","ER":"ERI","EE":"EST","SZ":"SWZ","ET":"ETH","FJ":"FJI","FI":"FIN","FR":"FRA","GA":"GAB","GM":"GMB","GE":"GEO","DE":"DEU","GH":"GHA","GR":"GRC","GL":"GRL","GD":"GRD","GT":"GTM","GN":"GIN","GW":"GNB","GY":"GUY","HT":"HTI","HN":"HND","HK":"HKG","HU":"HUN","IS":"ISL","IN":"IND","ID":"IDN","IR":"IRN","IQ":"IRQ","IE":"IRL","IL":"ISR","IT":"ITA","JM":"JAM","JP":"JPN","JO":"JOR","KZ":"KAZ","KE":"KEN","KI":"KIR","KP":"PRK","KR":"KOR","KW":"KWT","KG":"KGZ","LA":"LAO","LV":"LVA","LB":"LBN","LS":"LSO","LR":"LBR","LY":"LBY","LI":"LIE","LT":"LTU","LU":"LUX","MO":"MAC","MG":"MDG","MW":"MWI","MY":"MYS","MV":"MDV","ML":"MLI","MT":"MLT","MH":"MHL","MR":"MRT","MU":"MUS","MX":"MEX","FM":"FSM","MD":"MDA","MC":"MCO","MN":"MNG","ME":"MNE","MA":"MAR","MZ":"MOZ","MM":"MMR","NA":"NAM","NR":"NRU","NP":"NPL","NL":"NLD","NZ":"NZL","NI":"NIC","NE":"NER","NG":"NGA","MK":"MKD","NO":"NOR","OM":"OMN","PK":"PAK","PW":"PLW","PA":"PAN","PG":"PNG","PY":"PRY","PE":"PER","PH":"PHL","PL":"POL","PT":"PRT","PR":"PRI","QA":"QAT","RO":"ROU","RU":"RUS","RW":"RWA","WS":"WSM","SM":"SMR","ST":"STP","SA":"SAU","SN":"SEN","RS":"SRB","SC":"SYC","SL":"SLE","SG":"SGP","SK":"SVK","SI":"SVN","SB":"SLB","SO":"SOM","ZA":"ZAF","SS":"SSD","ES":"ESP","LK":"LKA","SD":"SDN","SR":"SUR","SE":"SWE","CH":"CHE","SY":"SYR","TW":"TWN","TJ":"TJK","TZ":"TZA","TH":"THA","TL":"TLS","TG":"TGO","TO":"TON","TT":"TTO","TN":"TUN","TR":"TUR","TM":"TKM","TV":"TUV","UG":"UGA","UA":"UKR","AE":"ARE","GB":"GBR","US":"USA","UY":"URY","UZ":"UZB","VU":"VUT","VA":"VAT","VE":"VEN","VN":"VNM","YE":"YEM","ZM":"ZMB","ZW":"ZWE"};
const ISO3_TO_ISO2 = Object.fromEntries(Object.entries(ISO2_TO_ISO3).map(([iso2, iso3]) => [iso3, iso2]));

if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

async function download(url, destPath) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://gain.nd.edu/our-work/country-index/download-data/",
    },
  });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  await pipeline(res.body, createWriteStream(destPath));
}

function parseCsv(text) {
  // Simple quoted-CSV parser - good enough for ND-GAIN's own plain
  // "field","field",... rows (no embedded commas within a quoted field
  // beyond what a basic split-on-quote handles).
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()));
}

/** Returns ISO3 -> latest non-empty year's numeric value from one of
 *  ND-GAIN's per-metric CSVs (columns: ISO3, Name, 1995, 1996, ..., 2024). */
function latestValueByIso3(csvText) {
  const rows = parseCsv(csvText);
  const header = rows[0];
  const yearCols = header.slice(2).map((y, i) => ({ year: Number(y), col: i + 2 })).filter((y) => Number.isFinite(y.year));
  yearCols.sort((a, b) => b.year - a.year); // most recent first

  const out = new Map();
  for (const row of rows.slice(1)) {
    const iso3 = row[0];
    if (!iso3) continue;
    for (const { col } of yearCols) {
      const raw = row[col];
      const val = Number(raw);
      if (raw && Number.isFinite(val)) {
        out.set(iso3, val);
        break;
      }
    }
  }
  return out;
}

async function main() {
  console.log("Downloading ND-GAIN country index...");
  const zipPath = path.join(TMP_DIR, "ndgain.zip");
  await download(ZIP_URL, zipPath);

  console.log("Unzipping...");
  // -j (junk paths) flattens everything into one directory, sidestepping
  // the zip's space-containing "resources 2/..." folder names and the
  // __MACOSX resource-fork clutter mixed in with the real CSVs - only 3
  // files (gain.csv, readiness.csv, vulnerability.csv) are actually
  // needed, and their basenames alone are unique enough for -j to work.
  execFileSync("unzip", ["-o", "-j", zipPath, "resources 2/gain/gain.csv", "resources 2/readiness/readiness.csv", "resources 2/vulnerability/vulnerability.csv", "-d", TMP_DIR], {
    stdio: "inherit",
  });

  console.log("Reading CSVs...");
  const gain = latestValueByIso3(readFileSync(path.join(TMP_DIR, "gain.csv"), "utf8"));
  const readiness = latestValueByIso3(readFileSync(path.join(TMP_DIR, "readiness.csv"), "utf8"));
  const vulnerability = latestValueByIso3(readFileSync(path.join(TMP_DIR, "vulnerability.csv"), "utf8"));

  const out = {};
  let matched = 0;
  let unmatchedIso3 = [];
  for (const [iso3, gainScore] of gain) {
    const iso2 = ISO3_TO_ISO2[iso3];
    if (!iso2) {
      unmatchedIso3.push(iso3);
      continue;
    }
    out[iso2] = {
      gainScore: Number(gainScore.toFixed(1)),
      readinessScore: readiness.has(iso3) ? Number(readiness.get(iso3).toFixed(3)) : null,
      vulnerabilityScore: vulnerability.has(iso3) ? Number(vulnerability.get(iso3).toFixed(3)) : null,
    };
    matched++;
  }

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${matched} countries to ${OUT_PATH}`);
  if (unmatchedIso3.length > 0) {
    console.log(`  ${unmatchedIso3.length} ISO3 codes had no ISO2 match (not in our country-codes map): ${unmatchedIso3.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
