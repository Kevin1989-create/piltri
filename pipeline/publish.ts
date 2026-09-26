import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { DATA_BUCKET, DATASET_SCHEMA_VERSION, type DatasetManifest } from "@/lib/dataset/schema";
import { log, OUT_DIR } from "./util";

/** Uploads a built dataset (pipeline/build.ts output) to the public Supabase
 *  Storage bucket: v<schema>/<version>/bundle.json.gz, then
 *  v<schema>/manifest.json LAST, so the switch is atomic. The site picks it
 *  up on its next build (the monthly workflow triggers one). Keeps the
 *  previous version too (rollback = re-upload its manifest) and deletes
 *  anything older. */

function readEnv(): Record<string, string> {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env as Record<string, string>;
  const text = readFileSync(path.resolve(__dirname, "..", ".env.local"), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  );
}

async function main() {
  const env = readEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const bucket = supabase.storage.from(DATA_BUCKET);
  const prefix = `v${DATASET_SCHEMA_VERSION}`;
  const version =
    process.argv[2] ??
    readdirSync(OUT_DIR)
      .filter((d) => statSync(path.join(OUT_DIR, d)).isDirectory())
      .sort()
      .pop();
  if (!version) throw new Error("No built dataset found - run `npm run pipeline:build` first.");
  const dir = path.join(OUT_DIR, version);
  const manifest: DatasetManifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== DATASET_SCHEMA_VERSION) throw new Error(`Dataset ${version} is schema ${manifest.schemaVersion}, expected ${DATASET_SCHEMA_VERSION}`);

  const bundle = readFileSync(path.join(dir, "bundle.json.gz"));
  log("publish", `uploading ${prefix}/${version}/bundle.json.gz (${(bundle.length / 1e6).toFixed(1)} MB)...`);
  for (let attempt = 1; ; attempt++) {
    const { error } = await bucket.upload(`${prefix}/${version}/bundle.json.gz`, bundle, {
      upsert: true,
      contentType: "application/gzip",
      cacheControl: "31536000",
    });
    if (!error) break;
    if (attempt >= 5) throw new Error(`bundle upload: ${error.message}`);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
  const { error: manifestError } = await bucket.upload(`${prefix}/manifest.json`, JSON.stringify(manifest), {
    upsert: true,
    contentType: "application/json",
    cacheControl: "60",
  });
  if (manifestError) throw new Error(`manifest: ${manifestError.message}`);
  log("publish", `dataset ${version} is published - the site uses it from its next build`);

  // Keep the current + previous version.
  const { data: entries } = await bucket.list(prefix, { limit: 1000 });
  const versions = (entries ?? []).filter((e) => e.id == null).map((e) => e.name).sort();
  for (const old of versions.slice(0, Math.max(0, versions.length - 2))) {
    log("publish", `removing old dataset ${old}`);
    await bucket.remove([`${prefix}/${old}/bundle.json.gz`]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
