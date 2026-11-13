// Assembles the folder deployed to Cloudflare Pages, which serves the
// dataset's files to the site (owner, 2026-11-13: Vercel stored a ~350 MB
// copy of them with every deploy, filling its free 10 GB; the site reads
// them from NEXT_PUBLIC_DATA_URL instead - see scripts/sync-dataset.mjs).
//
//   <out>/data/<version>/...   each version served
//   <out>/_headers             any site may read them, and browsers keep
//                              them for good (a new dataset gets a new
//                              version folder)
//
// Versions served: the one live now (Supabase's manifest; its files from
// its published bundle) and, when given, a freshly built one (its pipeline
// output folder) - so the live site keeps finding its files until it's
// redeployed onto the new one. A Pages deployment replaces the whole site,
// so anything older goes.
//
// Usage: node scripts/stage-data-site.mjs <out folder> [<pipeline output folder>]
// Then:  npx wrangler pages deploy <out folder> --project-name=piltri-data
// (the "Refresh dataset" and "Data on Cloudflare" workflows do both).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { bundleFiles, datasetSettings, downloadBundle, fetchManifest } from "./datasetBundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { schema: SCHEMA, bucket: BUCKET } = datasetSettings(root);
/** Cloudflare Pages' free plan: files per deployment, and bytes per file. */
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const [outArg, builtArg] = process.argv.slice(2);
if (!outArg) throw new Error("usage: node scripts/stage-data-site.mjs <out folder> [<pipeline output folder>]");
const out = path.resolve(outArg);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let files = 0;
const write = (version, rel, content) => {
  const file = path.join(out, "data", version, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  files++;
};

const versions = [];

// The version live now.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/v${SCHEMA}`;
const live = await fetchManifest(base).catch((err) => {
  console.warn(`[data site] no live dataset to keep (${err.message})`);
  return null;
});
const built = builtArg ? JSON.parse(readFileSync(path.join(builtArg, "manifest.json"), "utf8")) : null;
if (live && live.version !== built?.version) {
  console.log(`[data site] ${live.version} (live): downloading its bundle...`);
  for (const [rel, content] of bundleFiles(await downloadBundle(base, live))) {
    if (rel !== "bundle.json.gz") write(live.version, rel, content);
  }
  versions.push(live.version);
}

// A freshly built one.
if (built) {
  const copy = (dir, rel = "") => {
    for (const name of readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === "bundle.json.gz") continue;
      if (statSync(path.join(dir, r)).isDirectory()) copy(dir, r);
      else {
        const file = path.join(out, "data", built.version, r);
        mkdirSync(path.dirname(file), { recursive: true });
        copyFileSync(path.join(dir, r), file);
        files++;
      }
    }
  };
  copy(path.resolve(builtArg));
  versions.push(built.version);
}
if (!versions.length) throw new Error("nothing to serve: no live dataset and no built one given");

writeFileSync(
  path.join(out, "_headers"),
  ["/data/*", "  Access-Control-Allow-Origin: *", "  Cache-Control: public, max-age=31536000, immutable", ""].join("\n")
);
writeFileSync(path.join(out, "index.html"), "<!doctype html><title>Piltri data</title><p>The data behind <a href=\"https://www.piltri.me\">piltri.me</a>.</p>\n");

// Cloudflare's limits, checked before uploading anything.
if (files + 2 > MAX_FILES) throw new Error(`${files} files - over Cloudflare Pages' ${MAX_FILES} per deployment`);
const tooBig = [];
const scan = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) scan(p);
    else if (s.size > MAX_FILE_BYTES) tooBig.push(path.relative(out, p));
  }
};
scan(out);
if (tooBig.length) throw new Error(`over Cloudflare Pages' 25 MiB per file: ${tooBig.join(", ")}`);
if (!existsSync(path.join(out, "data", versions[versions.length - 1], "manifest.json"))) throw new Error("staged version has no manifest.json");

console.log(`[data site] ${versions.join(" + ")}: ${files} files in ${out}`);
