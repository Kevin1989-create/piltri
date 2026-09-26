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
  console.log(`[dataset] ${manifest.version} (${manifest.cityCount} cities) ready in public/data`);
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
    console.log(`[dataset] downloading ${manifest.version}...`);
    const res = await fetch(`${base}/${manifest.version}/bundle.json.gz`);
    if (!res.ok) throw new Error(`bundle ${res.status}`);
    const { files } = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
    install(manifest, files);
  }
  finish(manifest);
}

main().catch((err) => {
  console.error(`[dataset] ${err.message}`);
  process.exit(1);
});
