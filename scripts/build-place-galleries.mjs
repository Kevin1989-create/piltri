// Up to 12 good photos of every place, the best first (2026-11-21, owner:
// "remove collage, improving quality of the pics where we can, adding more
// quality pictures where possible"). Wikimedia only - Wikidata and Commons,
// every file under a free licence, credited with its author.
//
// Where the photos come from, best first:
//   1. Commons' Featured pictures and Quality images taken in the place
//      (their camera position within the place's reach - wider for a
//      bigger place - and nearer this place than any other);
//   2. Wikidata's own image of the place (P18);
//   3. the images of the landmarks Wikidata places in it (P131: its
//      churches, squares, bridges, parks...), the better known first
//      (more Wikipedia articles), one photo each.
// Then, from every candidate:
//   - out: collages and montages (by name and by Commons category), maps,
//     flags, coats of arms, drawings, interiors, people, animals, plants,
//     food, vehicles; anything under 1,000 px wide; anything taller than
//     wide by more than 4:3, or a strip more than 3.2 times as wide as tall;
//   - one photo per series (the same file name but for its numbers), at
//     most 3 per photographer;
//   - ranked: Featured, the place's own image, Quality, landmarks (the
//     better known first); landscape shapes first; larger before smaller.
// The first is the place's photo (the map corner); a Wikivoyage banner
// (P948) only when there's nothing else.
//
// Writes:
//   pipeline/static/place-photos.json.gz     { "<geonameid>": PhotoTuple }   (the first)
//   pipeline/static/place-galleries.json.gz  { "<geonameid>": PhotoTuple[] } (all, the first included)
// PhotoTuple: ["4/4b", "<file name>", width, height, "<author>", "<licence>"]
// (lib/placePhoto.ts).
//
// Resumable (progress in <pipeline cache>/work/place-galleries/), polite (one
// request at a time). Usage:
//   node scripts/build-place-galleries.mjs

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { gzipSync } from "zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = process.env.PIPELINE_CACHE_DIR ?? path.join(os.homedir(), ".piltri-pipeline-cache");
const WORK = path.join(CACHE, "work", "place-galleries");
const OUT_MAIN = path.join(root, "pipeline", "static", "place-photos.json.gz");
const OUT_GALLERY = path.join(root, "pipeline", "static", "place-galleries.json.gz");
const UA = "PiltriDataBuilder/1.0 (https://www.piltri.me)";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const PER_PLACE = 12;
const MIN_WIDTH = 1000;
const LANDMARKS_PER_PLACE = 30;
mkdirSync(WORK, { recursive: true });

const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = (name, fallback) => (existsSync(path.join(WORK, name)) ? JSON.parse(readFileSync(path.join(WORK, name), "utf8")) : fallback);
const save = (name, value) => writeFileSync(path.join(WORK, name), JSON.stringify(value));

async function fetchJson(url, init, label, tries = 6) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(90_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} (not retried)`);
      const text = await res.text();
      if (text.startsWith("<")) throw new Error("HTML instead of JSON (timeout?)");
      const json = JSON.parse(text);
      if (json.error?.code === "maxlag") throw new Error("maxlag");
      return json;
    } catch (err) {
      if (attempt >= tries || /not retried/.test(String(err))) throw err;
      log(`${label}: ${String(err).slice(0, 90)} - retrying (${attempt})`);
      await sleep(4000 * attempt);
    }
  }
}

const sparql = (query, label, tries) =>
  fetchJson(
    "https://query.wikidata.org/sparql",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" }, body: new URLSearchParams({ query }) },
    label,
    tries
  );

/** A Commons API query, following every "continue" and merging the pages. */
async function commonsQuery(params, label) {
  const pages = new Map();
  let cont = {};
  for (;;) {
    const url = `${COMMONS}?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", maxlag: "5", ...params, ...cont })}`;
    const json = await fetchJson(url, {}, label);
    for (const p of json.query?.pages ?? []) {
      const prev = pages.get(p.title);
      if (!prev) pages.set(p.title, p);
      else {
        for (const key of ["categories", "coordinates"]) if (p[key]) prev[key] = [...(prev[key] ?? []), ...p[key]];
        if (p.imageinfo && !prev.imageinfo) prev.imageinfo = p.imageinfo;
      }
    }
    if (!json.continue) return { pages: [...pages.values()], normalized: json.query?.normalized ?? [] };
    cont = json.continue;
    await sleep(100);
  }
}

const fileName = (url) => decodeURIComponent(url.split("/Special:FilePath/")[1]).replace(/_/g, " ");

// ---- 0. The places -------------------------------------------------------
const places = [];
for (const line of readFileSync(path.join(CACHE, "work", "geonames", "cities1000.txt"), "utf8").split("\n")) {
  const f = line.split("\t");
  if (!/^\d+$/.test(f[0] ?? "")) continue;
  places.push({ id: f[0], lat: Number(f[4]), lng: Number(f[5]), pop: Number(f[14]) || 0 });
}
log(`${places.length} places`);

// ---- 1. Wikidata: each place's item, image(s) and banner -----------------
const items = load("items.json", {}); // geonameid -> { q, img: [], banner }
let itemsDone = load("items-done.json", 0);
for (let start = itemsDone; start < places.length; start += 300) {
  const batch = places.slice(start, start + 300);
  const query = `SELECT ?gn ?item ?img ?banner WHERE { VALUES ?gn { ${batch.map((p) => `"${p.id}"`).join(" ")} } ?item wdt:P1566 ?gn . OPTIONAL { ?item wdt:P18 ?img } OPTIONAL { ?item wdt:P948 ?banner } }`;
  const json = await sparql(query, `items ${start}`);
  for (const r of json.results.bindings) {
    const gn = r.gn.value;
    const q = r.item.value.split("/").pop();
    const entry = (items[gn] ??= { q, img: [], banner: null });
    if (entry.q !== q) continue; // two items for one place: the first
    if (r.img && !entry.img.includes(fileName(r.img.value))) entry.img.push(fileName(r.img.value));
    if (r.banner) entry.banner = fileName(r.banner.value);
  }
  itemsDone = start + batch.length;
  if ((itemsDone / 300) % 25 === 0 || itemsDone >= places.length) {
    save("items.json", items);
    save("items-done.json", itemsDone);
    log(`items ${itemsDone}/${places.length}: ${Object.keys(items).length} on Wikidata`);
  }
  await sleep(500);
}

// ---- 2. Wikidata: the landmarks in each place ----------------------------
const landmarks = load("landmarks.json", {}); // q -> [[file, sitelinks], ...] best known first
const qs = [...new Set(Object.values(items).map((e) => e.q))].filter((q) => !(q in landmarks));
log(`landmarks: ${qs.length} places to look up (${Object.keys(landmarks).length} done)`);
const landmarkQuery = (batch, limit) =>
  `SELECT ?city ?x ?img ?sl WHERE { VALUES ?city { ${batch.map((q) => `wd:${q}`).join(" ")} } ?x wdt:P131 ?city ; wdt:P18 ?img ; wikibase:sitelinks ?sl . }${limit ? ` ORDER BY DESC(?sl) LIMIT ${limit}` : ""}`;
async function lookUpLandmarks(batch) {
  let json;
  try {
    json = await sparql(landmarkQuery(batch), `landmarks (${batch.length})`, batch.length > 1 ? 2 : 3);
  } catch (err) {
    if (batch.length > 1) {
      const half = Math.ceil(batch.length / 2);
      await lookUpLandmarks(batch.slice(0, half));
      await lookUpLandmarks(batch.slice(half));
      return;
    }
    // One huge place: its best known only.
    json = await sparql(landmarkQuery(batch, 400), `landmarks ${batch[0]} (top)`).catch(() => null);
    if (!json) {
      landmarks[batch[0]] = [];
      return;
    }
  }
  const found = new Map(batch.map((q) => [q, new Map()]));
  for (const r of json.results.bindings) {
    const by = found.get(r.city.value.split("/").pop());
    const x = r.x.value;
    // One image per landmark.
    if (by && !by.has(x)) by.set(x, [fileName(r.img.value), Number(r.sl.value)]);
  }
  for (const [q, by] of found)
    landmarks[q] = [...by.values()].sort((a, b) => b[1] - a[1]).slice(0, LANDMARKS_PER_PLACE);
}
for (let k = 0; k < qs.length; k += 80) {
  await lookUpLandmarks(qs.slice(k, k + 80));
  if ((k / 80) % 25 === 0 || k + 80 >= qs.length) {
    save("landmarks.json", landmarks);
    log(`landmarks ${Math.min(k + 80, qs.length)}/${qs.length}`);
  }
  await sleep(300);
}
save("landmarks.json", landmarks);

// ---- 3. Commons: every Featured picture and Quality image with a place --
const rated = load("rated.json", {}); // file -> [rank, lat, lng]  (rank 2 featured, 1 quality)
for (const [rank, category] of [
  [2, "Featured_pictures_on_Wikimedia_Commons"],
  [1, "Quality_images"],
]) {
  const doneKey = `rated-${rank}-done.json`;
  if (load(doneKey, false) === true) continue;
  let cont = load(`rated-${rank}-continue.json`, {});
  let n = 0;
  for (;;) {
    const url = `${COMMONS}?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", maxlag: "5", generator: "categorymembers", gcmtitle: `Category:${category}`, gcmtype: "file", gcmlimit: "500", prop: "coordinates", colimit: "max", ...cont })}`;
    const json = await fetchJson(url, {}, `${category} ${n}`);
    for (const p of json.query?.pages ?? []) {
      const c = p.coordinates?.[0];
      const name = p.title.replace(/^File:/, "");
      if (c && (!(name in rated) || rated[name][0] < rank)) rated[name] = [rank, c.lat, c.lon];
    }
    n++;
    if (!json.continue) break;
    cont = json.continue;
    if (n % 20 === 0) {
      save("rated.json", rated);
      save(`rated-${rank}-continue.json`, cont);
      log(`${category}: ${n} pages, ${Object.keys(rated).length} with a position`);
    }
    await sleep(150);
  }
  save("rated.json", rated);
  save(doneKey, true);
  log(`${category}: done, ${Object.keys(rated).length} rated files with a position`);
}

// Each rated photo to the place it was taken in: within the place's reach
// (1.5 km for a village, ~5 km at 100,000, 12 km at most), the nearest
// relative to its reach.
const reachKm = (pop) => Math.min(12, 1.5 + Math.sqrt(pop) / 100);
const CELL = 0.25; // degrees
const grid = new Map();
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)},${Math.floor(lng / CELL)}`;
for (const p of places) {
  const key = cellKey(p.lat, p.lng);
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(p);
}
const kmBetween = (a, b, c, d) => {
  const toRad = Math.PI / 180;
  const x = (d - b) * toRad * Math.cos(((a + c) / 2) * toRad);
  const y = (c - a) * toRad;
  return Math.sqrt(x * x + y * y) * 6371;
};
const ratedByPlace = new Map(); // geonameid -> [[file, rank, km]]
for (const [file, [rank, lat, lng]] of Object.entries(rated)) {
  const cy = Math.floor(lat / CELL);
  const cx = Math.floor(lng / CELL);
  let best = null;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      for (const p of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
        const km = kmBetween(lat, lng, p.lat, p.lng);
        const rel = km / reachKm(p.pop);
        if (rel <= 1 && (!best || rel < best.rel)) best = { p, rel, km };
      }
  if (!best) continue;
  if (!ratedByPlace.has(best.p.id)) ratedByPlace.set(best.p.id, []);
  ratedByPlace.get(best.p.id).push([file, rank, best.km]);
}
log(`rated photos: ${[...ratedByPlace.values()].reduce((s, l) => s + l.length, 0)} in ${ratedByPlace.size} places`);

// ---- 4. The candidates of each place --------------------------------------
const RATED_PER_PLACE = 40;
const candidates = new Map(); // geonameid -> [{ file, kind, weight }]
for (const p of places) {
  const list = [];
  const rs = (ratedByPlace.get(p.id) ?? []).sort((a, b) => b[1] - a[1] || a[2] - b[2]).slice(0, RATED_PER_PLACE);
  for (const [file, rank] of rs) list.push({ file, kind: rank === 2 ? "featured" : "quality" });
  const item = items[p.id];
  if (item) {
    for (const file of item.img) list.push({ file, kind: "own" });
    for (const [file, sl] of landmarks[item.q] ?? []) list.push({ file, kind: "landmark", sl });
    if (item.banner) list.push({ file: item.banner, kind: "banner" });
  }
  if (list.length) candidates.set(p.id, list);
}
const allFiles = [...new Set([...candidates.values()].flat().map((c) => c.file))];
log(`${candidates.size} places with candidates, ${allFiles.length} files`);

// ---- 5. Commons: each candidate's size, author, licence, categories ------
const info = load("info.json", {}); // file -> [w, h, mime, author, licence, categories[]] | null
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
const todo = allFiles.filter((f) => !(f in info) && /\.(jpe?g|png|webp|tiff?)$/i.test(f));
log(`commons: ${todo.length} files to look up (${Object.keys(info).length} done)`);
for (let k = 0; k < todo.length; k += 50) {
  const batch = todo.slice(k, k + 50);
  const { pages, normalized } = await commonsQuery(
    {
      prop: "imageinfo|categories",
      iiprop: "size|mime|extmetadata",
      iiextmetadatafilter: "Artist|LicenseShortName",
      clshow: "!hidden",
      cllimit: "max",
      titles: batch.map((f) => `File:${f}`).join("|"),
    },
    `commons ${k}`
  );
  const norm = new Map(normalized.map((n) => [n.to, n.from]));
  for (const p of pages) {
    const name = (norm.get(p.title) ?? p.title).replace(/^File:/, "");
    const ii = p.imageinfo?.[0];
    info[name] = ii
      ? [
          ii.width,
          ii.height,
          ii.mime,
          plainText(ii.extmetadata?.Artist?.value),
          plainText(ii.extmetadata?.LicenseShortName?.value),
          (p.categories ?? []).map((c) => c.title.replace(/^Category:/, "")),
        ]
      : null;
  }
  for (const f of batch) if (!(f in info)) info[f] = null;
  if ((k / 50) % 100 === 0) {
    save("info.json", info);
    log(`commons ${k + batch.length}/${todo.length}`);
  }
  await sleep(100);
}
save("info.json", info);

// ---- 6. Choose and rank ---------------------------------------------------
// Not a photo of the place: collages, maps, symbols, drawings, insides,
// people, animals, plants, food, vehicles, objects.
const NOT_A_VIEW =
  /montage|collage|composite|photomontage|mosaic of|coats? of arms|\bflags?\b|\bmaps?\b|\blogos?\b|diagram|\bseals? of|\bplans?\b|drawings?|engravings?|paintings?|lithograph|postcards?|\binteriors?\b|inside|\bnaves?\b|altars?|altarpiece|pulpits?|organs? \(music|stained glass|ceilings?|crypts?|exhibits?|museum objects|collections of|portraits?|\bpeople\b|\bmen\b|\bwomen\b|children|players|musicians|politicians|actors|insects?|butterfl|moths?|beetles?|spiders?|birds?|mammals?|animals?|dogs?|cats?|horses?|cattle|fungi|mushrooms?|flowers?|plants?|trees? of|leaves|food|dishes|cuisine|aircraft|locomotives?|rolling stock|automobiles?|\bcars\b|motorcycles?|buses|ships?\b|boats?\b|signs?\b|plaques?|inscriptions?|documents?|manuscripts?|graves?|tombs?|gravestones?|sculptures? by|statues? of|busts? of|coins?|stamps?|microscop|astronom|night sky|fireworks|concerts?|events? in|festivals?|demonstrations?|protests?/i;

const stem = (file) =>
  file
    .toLowerCase()
    .replace(/\.[a-z]+$/, "")
    .replace(/[\d_().,\-–]+/g, " ")
    .replace(/\b(img|dsc|dscn|dscf|p|pano|panorama|jpg|cropped|crop|edit|edited|retouched)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const BASE = { featured: 100, own: 85, quality: 80, landmark: 0, banner: -100 };
function score(c, i) {
  const [w, h] = i;
  const a = w / h;
  let s = BASE[c.kind];
  if (c.kind === "landmark") s = Math.min(78, 45 + 6 * Math.log2(1 + c.sl));
  if (a < 1.2) s -= 12; // squarish or upright: a landscape frame cuts it
  if (a > 2.3) s -= 10; // a wide strip
  if (w >= 2400) s += 4;
  else if (w < 1600) s -= 6;
  return s;
}

const md5Folder = (name) => {
  const md5 = createHash("md5").update(name).digest("hex");
  return `${md5[0]}/${md5.slice(0, 2)}`;
};
const tuple = (file, i) => {
  const name = file.replace(/ /g, "_");
  return [md5Folder(name), name, i[0], i[1], i[3] || "Unknown author", i[4] || "See Wikimedia Commons"];
};

const outMain = {};
const outGallery = {};
const stats = { places: 0, photos: 0, dropped: { small: 0, shape: 0, notView: 0, notPhoto: 0 }, kinds: {} };
for (const [id, list] of candidates) {
  const seenFile = new Set();
  const ranked = [];
  let banner = null;
  for (const c of list) {
    if (seenFile.has(c.file)) continue;
    seenFile.add(c.file);
    const i = info[c.file];
    if (!i || !/^image\/(jpeg|png|webp|tiff)$/.test(i[2])) {
      stats.dropped.notPhoto++;
      continue;
    }
    const [w, h] = i;
    if (NOT_A_VIEW.test(c.file) || i[5].some((cat) => NOT_A_VIEW.test(cat))) {
      stats.dropped.notView++;
      continue;
    }
    if (c.kind === "banner") {
      if (w >= MIN_WIDTH) banner = { c, i };
      continue;
    }
    if (w < MIN_WIDTH) {
      stats.dropped.small++;
      continue;
    }
    if (w / h < 0.75 || w / h > 3.2) {
      stats.dropped.shape++;
      continue;
    }
    ranked.push({ c, i, s: score(c, i) });
  }
  ranked.sort((a, b) => b.s - a.s);
  const chosen = [];
  const stems = new Set();
  const byAuthor = new Map();
  for (const r of ranked) {
    if (chosen.length >= PER_PLACE) break;
    const st = stem(r.c.file);
    const author = r.i[3] || "?";
    if (st && stems.has(st)) continue;
    if ((byAuthor.get(author) ?? 0) >= 3) continue;
    stems.add(st);
    byAuthor.set(author, (byAuthor.get(author) ?? 0) + 1);
    chosen.push(r);
  }
  if (!chosen.length && banner) chosen.push(banner);
  if (!chosen.length) continue;
  // The place's photo: the best landscape one among the first four.
  const lead = chosen.slice(0, 4).findIndex((r) => r.i[0] / r.i[1] >= 1.2);
  if (lead > 0) chosen.unshift(...chosen.splice(lead, 1));
  outGallery[id] = chosen.map((r) => tuple(r.c.file, r.i));
  outMain[id] = outGallery[id][0];
  stats.places++;
  stats.photos += chosen.length;
  for (const r of chosen) stats.kinds[r.c.kind] = (stats.kinds[r.c.kind] ?? 0) + 1;
}
writeFileSync(OUT_MAIN, gzipSync(JSON.stringify(outMain), { level: 9 }));
const galleryGz = gzipSync(JSON.stringify(outGallery), { level: 9 });
writeFileSync(OUT_GALLERY, galleryGz);
log(`wrote ${stats.places} of ${places.length} places with a photo (${((stats.places / places.length) * 100).toFixed(0)}%), ${stats.photos} photos (${(stats.photos / Math.max(1, stats.places)).toFixed(1)} each), gallery file ${(galleryGz.length / 1e6).toFixed(1)} MB`);
log(`kinds ${JSON.stringify(stats.kinds)}; dropped ${JSON.stringify(stats.dropped)}`);
