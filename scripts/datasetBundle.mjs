// The published dataset bundle, shared by scripts/sync-dataset.mjs (the
// site's build) and scripts/stage-data-site.mjs (the Cloudflare Pages copy).

import { readFileSync } from "fs";
import path from "path";
import { gunzipSync } from "zlib";

/** The dataset schema version and Supabase bucket, from lib/dataset/schema.ts. */
export function datasetSettings(root) {
  const schemaSource = readFileSync(path.join(root, "lib", "dataset", "schema.ts"), "utf8");
  return {
    schema: Number(schemaSource.match(/DATASET_SCHEMA_VERSION = (\d+)/)[1]),
    bucket: schemaSource.match(/DATA_BUCKET = "([^"]+)"/)[1],
  };
}

/** The current manifest from Supabase Storage (`base` = .../<bucket>/v<schema>). */
export async function fetchManifest(base) {
  const res = await fetch(`${base}/manifest.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  return res.json();
}

/** A version's gzipped bundle from Supabase Storage - in pieces (the free
 *  plan takes files up to 50 MB), or one file for datasets before 2026-10-01. */
export async function downloadBundle(base, manifest) {
  const names = manifest.bundleParts ? Array.from({ length: manifest.bundleParts }, (_, i) => `bundle.json.gz.${i}`) : ["bundle.json.gz"];
  const pieces = [];
  for (const name of names) {
    const res = await fetch(`${base}/${manifest.version}/${name}`);
    if (!res.ok) throw new Error(`${name} ${res.status}`);
    pieces.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(pieces);
}

/** The bundle's files, one at a time - {"files":{"<path>":"<contents>",...}}
 *  (pipeline/output.ts writeBundle) read straight from the decompressed
 *  bytes, each name and file decoded on its own: as one string the bundle
 *  had reached 96% of the longest string Node can hold (2026-11-13, 529 MB),
 *  and parsing it held two copies on top. A quote or backslash byte can't
 *  be part of a multi-byte UTF-8 character, so scanning bytes is safe. */
export function* bundleFiles(gz) {
  const buf = gunzipSync(gz);
  const head = Buffer.from('{"files":{');
  if (!buf.subarray(0, head.length).equals(head)) throw new Error("bundle: unexpected format");
  let i = head.length;
  const readString = () => {
    if (buf[i] !== 0x22) throw new Error(`bundle: expected a string at byte ${i}`);
    const start = i++;
    while (buf[i] !== 0x22) {
      if (i >= buf.length) throw new Error("bundle: cut short");
      i += buf[i] === 0x5c ? 2 : 1;
    }
    i++;
    return JSON.parse(buf.toString("utf8", start, i));
  };
  while (buf[i] !== 0x7d) {
    const rel = readString();
    if (buf[i++] !== 0x3a) throw new Error(`bundle: expected ":" at byte ${i - 1}`);
    yield [rel, readString()];
    if (buf[i] === 0x2c) i++;
  }
}
