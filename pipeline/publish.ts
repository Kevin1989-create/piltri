import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { gzipSync } from "zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DatasetManifest } from "@/lib/dataset/schema";
import { DATA_BUCKET } from "@/lib/dataset/load";
import { log, OUT_DIR } from "./util";

/** Uploads a built dataset (pipeline/build.ts output) to the public
 *  Supabase Storage bucket the site reads from. Versioned files go under
 *  `<version>/` and are cached forever; manifest.json at the bucket root
 *  is uploaded LAST, so the site switches to the new version atomically.
 *  Keeps the previous version too (instant rollback: re-upload its
 *  manifest) and deletes anything older, to stay well inside the free 1 GB. */
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

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full).replace(/\\/g, "/")];
  });
}

async function main() {
  const env = readEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const version =
    process.argv[2] ??
    readdirSync(OUT_DIR)
      .filter((d) => statSync(path.join(OUT_DIR, d)).isDirectory())
      .sort()
      .pop();
  if (!version) throw new Error("No built dataset found - run `npm run pipeline:build` first.");
  const dir = path.join(OUT_DIR, version);
  const manifest: DatasetManifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const files = listFiles(dir).filter((f) => f !== "manifest.json");
  log("publish", `uploading ${files.length} files for dataset ${version}...`);

  let done = 0;
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const body = gzipSync(readFileSync(path.join(dir, f)), { level: 9 });
      for (let attempt = 1; ; attempt++) {
        const { error } = await supabase.storage
          .from(DATA_BUCKET)
          .upload(`${version}/${f}.gz`, body, { upsert: true, contentType: "application/gzip", cacheControl: "31536000" });
        if (!error) break;
        if (attempt >= 5) throw new Error(`upload ${f}: ${error.message}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
      if (++done % 200 === 0) log("publish", `${done}/${files.length}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  const { error: manifestError } = await supabase.storage
    .from(DATA_BUCKET)
    .upload("manifest.json", JSON.stringify(manifest), { upsert: true, contentType: "application/json", cacheControl: "60" });
  if (manifestError) throw new Error(`manifest: ${manifestError.message}`);
  log("publish", `dataset ${version} is live`);

  // Keep the current + previous version, remove older ones.
  const { data: top } = await supabase.storage.from(DATA_BUCKET).list("", { limit: 1000 });
  const versions = (top ?? [])
    .filter((o) => !o.name.includes(".") && o.id == null)
    .map((o) => o.name)
    .sort();
  for (const old of versions.slice(0, Math.max(0, versions.length - 2))) {
    log("publish", `removing old dataset ${old}`);
    await removePrefix(supabase, old);
  }
}

async function removePrefix(supabase: SupabaseClient<any, any, any>, prefix: string): Promise<void> {
  const { data } = await supabase.storage.from(DATA_BUCKET).list(prefix, { limit: 1000 });
  for (const entry of data ?? []) {
    const full = `${prefix}/${entry.name}`;
    if (entry.id == null) await removePrefix(supabase, full);
    else await supabase.storage.from(DATA_BUCKET).remove([full]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
