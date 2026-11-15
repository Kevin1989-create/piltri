// A photo for every place that has one (owner, 2026-11-14: a photo in the
// map's bottom-left corner, above the country, that expands on a tap):
// Wikidata's image (P18) for the place's GeoNames id (P1566) - its
// Wikivoyage banner (P948) when there's no image - with its size, author
// and licence from Wikimedia Commons (every Commons file is under a free
// licence; the author is credited on the site). Real photos only (JPEG,
// PNG, WebP of 400 px+ - no maps or drawings as SVG, no GIFs).
//
// Writes pipeline/static/place-photos.json.gz:
//   { "<geonameid>": ["4/4b", "<file name>", width, height, "<author>", "<licence>"] }
// the first two give the image's address on upload.wikimedia.org.
// Measured coverage before building (2026-11-14, a 1,200-place sample):
// ~42% of places; 39% of villages, 69% of 100k+ cities.
//
// Resumable (progress in <pipeline cache>/work/place-photos/), polite
// (one request at a time, a pause between). Usage:
//   node scripts/build-place-photos.mjs

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { gzipSync } from "zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = process.env.PIPELINE_CACHE_DIR ?? path.join(os.homedir(), ".piltri-pipeline-cache");
const WORK = path.join(CACHE, "work", "place-photos");
const OUT = path.join(root, "pipeline", "static", "place-photos.json.gz");
const UA = "PiltriDataBuilder/1.0 (https://www.piltri.me)";
const IDS_PER_QUERY = 300;
const FILES_PER_CALL = 50;
const MIN_WIDTH = 400;
mkdirSync(WORK, { recursive: true });

const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, init, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      return await res.json();
    } catch (err) {
      if (attempt >= 6 || /not retried/.test(String(err))) throw err;
      log(`${label}: ${String(err).slice(0, 80)} - retrying (${attempt})`);
      await sleep(5000 * attempt);
    }
  }
}

// ---- 1. Wikidata: each GeoNames id's image file name ----
const ids = [];
for (const line of readFileSync(path.join(CACHE, "work", "geonames", "cities1000.txt"), "utf8").split("\n")) {
  const id = line.split("\t", 1)[0];
  if (/^\d+$/.test(id)) ids.push(id);
}
const filesById = existsSync(path.join(WORK, "wikidata.json")) ? JSON.parse(readFileSync(path.join(WORK, "wikidata.json"), "utf8")) : {};
let done = existsSync(path.join(WORK, "wikidata-done.txt")) ? Number(readFileSync(path.join(WORK, "wikidata-done.txt"), "utf8")) : 0;
log(`${ids.length} places; Wikidata from ${done}`);
for (let start = done; start < ids.length; start += IDS_PER_QUERY) {
  const batch = ids.slice(start, start + IDS_PER_QUERY);
  const query = `SELECT ?gn (SAMPLE(?img) AS ?image) (SAMPLE(?banner) AS ?b) WHERE { VALUES ?gn { ${batch.map((id) => `"${id}"`).join(" ")} } ?item wdt:P1566 ?gn . OPTIONAL { ?item wdt:P18 ?img } OPTIONAL { ?item wdt:P948 ?banner } } GROUP BY ?gn`;
  const json = await fetchRetry(
    "https://query.wikidata.org/sparql",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" }, body: new URLSearchParams({ query }) },
    `wikidata ${start}`
  );
  for (const r of json.results.bindings) {
    const url = r.image?.value ?? r.b?.value;
    if (url) filesById[r.gn.value] = decodeURIComponent(url.split("/Special:FilePath/")[1]);
  }
  done = start + batch.length;
  if ((done / IDS_PER_QUERY) % 20 === 0 || done >= ids.length) {
    writeFileSync(path.join(WORK, "wikidata.json"), JSON.stringify(filesById));
    writeFileSync(path.join(WORK, "wikidata-done.txt"), String(done));
    log(`wikidata ${done}/${ids.length}: ${Object.keys(filesById).length} with a file`);
  }
  await sleep(1000);
}

// ---- 2. Commons: size, author, licence of each file ----
const infoPath = path.join(WORK, "commons.json");
const info = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, "utf8")) : {};
const files = [...new Set(Object.values(filesById))].filter((f) => !(f in info) && /\.(jpe?g|png|webp)$/i.test(f));
log(`commons: ${files.length} files to look up (${Object.keys(info).length} done)`);
const plainText = (html) =>
  String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
for (let k = 0; k < files.length; k += FILES_PER_CALL) {
  const batch = files.slice(k, k + FILES_PER_CALL);
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=size|mime|extmetadata&iiextmetadatafilter=Artist|LicenseShortName&titles=" +
    batch.map((f) => encodeURIComponent(`File:${f}`)).join("|");
  const json = await fetchRetry(url, {}, `commons ${k}`);
  const norm = new Map((json.query?.normalized ?? []).map((n) => [n.to, n.from]));
  for (const p of json.query?.pages ?? []) {
    const name = (norm.get(p.title) ?? p.title).replace(/^File:/, "");
    const ii = p.imageinfo?.[0];
    info[name] = ii
      ? [ii.width, ii.height, ii.mime, plainText(ii.extmetadata?.Artist?.value), plainText(ii.extmetadata?.LicenseShortName?.value)]
      : null;
  }
  for (const f of batch) if (!(f in info)) info[f] = null;
  if ((k / FILES_PER_CALL) % 40 === 0) {
    writeFileSync(infoPath, JSON.stringify(info));
    log(`commons ${k + batch.length}/${files.length}`);
  }
  await sleep(300);
}
writeFileSync(infoPath, JSON.stringify(info));

// ---- 3. The table ----
const out = {};
for (const [id, file] of Object.entries(filesById)) {
  const i = info[file];
  if (!i) continue;
  const [width, height, mime, author, licence] = i;
  if (!/^image\/(jpeg|png|webp)$/.test(mime) || width < MIN_WIDTH) continue;
  const name = file.replace(/ /g, "_");
  const md5 = createHash("md5").update(name).digest("hex");
  out[id] = [`${md5[0]}/${md5.slice(0, 2)}`, name, width, height, author || "Unknown author", licence || "See Wikimedia Commons"];
}
writeFileSync(OUT, gzipSync(JSON.stringify(out), { level: 9 }));
log(`wrote ${path.relative(root, OUT)}: ${Object.keys(out).length} of ${ids.length} places have a photo (${((Object.keys(out).length / ids.length) * 100).toFixed(0)}%)`);
