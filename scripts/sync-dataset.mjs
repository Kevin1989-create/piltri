// Puts the current precomputed dataset where the site serves it from:
// public/data/<version>/ (static files on the CDN, cached forever - the
// version is in the path) plus lib/dataset/meta.generated.json (the
// manifest, bundled into the site so the browser knows the version, chunk
// counts and tile list without an extra request).
//
// Runs automatically before `next dev` and `next build` (predev/prebuild).
// Source, in order of preference:
//   DATASET_DIR=<pipeline output folder>   a locally built, unpublished dataset
//   the published dataset in Supabase Storage (NEXT_PUBLIC_SUPABASE_URL)
// A copy already in public/data is reused when it's the current version,
// or when Supabase can't be reached (offline development).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicData = path.join(root, "public", "data");
const metaFile = path.join(root, "lib", "dataset", "meta.generated.json");
const schemaSource = readFileSync(path.join(root, "lib", "dataset", "schema.ts"), "utf8");
const SCHEMA = Number(schemaSource.match(/DATASET_SCHEMA_VERSION = (\d+)/)[1]);
const BUCKET = schemaSource.match(/DATA_BUCKET = "([^"]+)"/)[1];

function supabaseUrl() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NEXT_PUBLIC_SUPABASE_URL;
  const envFile = path.join(root, ".env.local");
  if (!existsSync(envFile)) return null;
  const line = readFileSync(envFile, "utf8")
    .split("\n")
    .find((l) => l.startsWith("NEXT_PUBLIC_SUPABASE_URL="));
  return line ? line.slice(line.indexOf("=") + 1).trim() : null;
}

function install(manifest, files) {
  const dir = path.join(publicData, manifest.version);
  rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    if (rel === "bundle.json.gz") continue;
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  writeFileSync(path.join(dir, ".complete"), new Date().toISOString());
}

function finish(manifest) {
  if (manifest.schemaVersion !== SCHEMA) throw new Error(`Dataset ${manifest.version} is schema ${manifest.schemaVersion}; the site expects ${SCHEMA}`);
  // Only the current version is kept.
  for (const name of existsSync(publicData) ? readdirSync(publicData) : []) {
    if (name !== manifest.version) rmSync(path.join(publicData, name), { recursive: true, force: true });
  }
  writeFileSync(metaFile, JSON.stringify(manifest, null, 1) + "\n");
  writeSitemaps(manifest);
  console.log(`[dataset] ${manifest.version} (${manifest.cityCount} cities) ready in public/data`);
}

const SITE_URL = "https://www.piltri.me";
/** Google takes up to 50,000 addresses per sitemap file. */
const SITEMAP_SIZE = 45000;

/** Same as cityIdFor in lib/dataset/schema.ts. */
const cityIdFor = (name, countryCode) => `${name}-${countryCode}`.toLowerCase().replace(/\s+/g, "-");

/** public/sitemap.xml (an index) and public/sitemaps/*.xml: the main pages,
 *  every country and every place, from the dataset just installed - one
 *  static page serves them all (/city?id=...), so search engines learn the
 *  addresses only from here (2026-10-28). robots.txt points to the index. */
function writeSitemaps(manifest) {
  const dir = path.join(publicData, manifest.version, "adv");
  const scores = JSON.parse(readFileSync(path.join(dir, "scores.json"), "utf8"));
  const places = JSON.parse(readFileSync(path.join(dir, "places.json"), "utf8"));
  const codes = scores.countryCodes.flatMap((code, i) => Array(scores.countryCounts[i]).fill(code));
  const cityUrls = places.name.map((name, i) => `/city?${new URLSearchParams({ id: places.customIds?.[i] ?? cityIdFor(name, codes[i]) })}`);
  const pageUrls = ["/", "/search", "/leaderboards", "/sources", ...Object.keys(manifest.countryNames).sort().map((code) => `/country?code=${code}`)];

  const lastmod = manifest.generatedAt.slice(0, 10);
  const urlset = (urls) =>
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `<url><loc>${SITE_URL}${u}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n") +
    "\n</urlset>\n";

  const out = path.join(root, "public", "sitemaps");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const names = ["pages.xml"];
  writeFileSync(path.join(out, "pages.xml"), urlset(pageUrls));
  for (let i = 0; i * SITEMAP_SIZE < cityUrls.length; i++) {
    names.push(`places-${i + 1}.xml`);
    writeFileSync(path.join(out, names[names.length - 1]), urlset(cityUrls.slice(i * SITEMAP_SIZE, (i + 1) * SITEMAP_SIZE)));
  }
  writeFileSync(
    path.join(root, "public", "sitemap.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      names.map((n) => `<sitemap><loc>${SITE_URL}/sitemaps/${n}</loc><lastmod>${lastmod}</lastmod></sitemap>`).join("\n") +
      "\n</sitemapindex>\n"
  );
  console.log(`[dataset] sitemap: ${pageUrls.length} pages and ${cityUrls.length} places in ${names.length} files`);
}

async function main() {
  if (process.env.DATASET_DIR) {
    const dir = path.resolve(process.env.DATASET_DIR);
    const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    const { files } = JSON.parse(gunzipSync(readFileSync(path.join(dir, "bundle.json.gz"))).toString("utf8"));
    install(manifest, files);
    return finish(manifest);
  }

  const url = supabaseUrl();
  const base = url ? `${url}/storage/v1/object/public/${BUCKET}/v${SCHEMA}` : null;
  let manifest = null;
  try {
    if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
    const res = await fetch(`${base}/manifest.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    // Offline: keep whatever copy is already installed.
    const installed = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : null;
    if (installed && existsSync(path.join(publicData, installed.version, ".complete"))) {
      console.warn(`[dataset] couldn't check for a newer dataset (${err.message}); using ${installed.version}`);
      return finish(installed);
    }
    throw new Error(`No dataset available: ${err.message}`);
  }

  if (!existsSync(path.join(publicData, manifest.version, ".complete"))) {
    install(manifest, JSON.parse(gunzipSync(await bundleFor(base, manifest)).toString("utf8")).files);
  }
  finish(manifest);
}

// Vercel keeps .next/cache from one build to the next (public/ it doesn't),
// so the bundle is kept there: a deploy only downloads the dataset when it
// has changed, instead of every time (Supabase's free plan counts every
// download).
const BUNDLE_CACHE = path.join(root, ".next", "cache", "piltri-dataset");

async function bundleFor(base, manifest) {
  const { version } = manifest;
  const cached = path.join(BUNDLE_CACHE, `${version}.json.gz`);
  if (existsSync(cached)) {
    console.log(`[dataset] ${version} from the build cache`);
    return readFileSync(cached);
  }
  console.log(`[dataset] downloading ${version}...`);
  // Published in pieces (Supabase's free plan takes files up to 50 MB),
  // or as one file for datasets before 2026-10-01.
  const names = manifest.bundleParts ? Array.from({ length: manifest.bundleParts }, (_, i) => `bundle.json.gz.${i}`) : ["bundle.json.gz"];
  const pieces = [];
  for (const name of names) {
    const res = await fetch(`${base}/${version}/${name}`);
    if (!res.ok) throw new Error(`${name} ${res.status}`);
    pieces.push(Buffer.from(await res.arrayBuffer()));
  }
  const bundle = Buffer.concat(pieces);
  try {
    rmSync(BUNDLE_CACHE, { recursive: true, force: true });
    mkdirSync(BUNDLE_CACHE, { recursive: true });
    writeFileSync(cached, bundle);
  } catch (err) {
    console.warn(`[dataset] couldn't keep a copy in the build cache: ${err.message}`);
  }
  return bundle;
}

main().catch((err) => {
  console.error(`[dataset] ${err.message}`);
  process.exit(1);
});
