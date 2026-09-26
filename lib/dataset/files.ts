import manifestJson from "./meta.generated.json";
import type { DatasetManifest } from "./schema";

/** The dataset manifest, bundled at build time by scripts/sync-dataset.mjs. */
export const manifest = manifestJson as unknown as DatasetManifest;

const BASE = `/data/${manifest.version}`;
const cache = new Map<string, Promise<unknown>>();

/** One dataset file, fetched once per page session. Files are static assets
 *  on the site's own CDN with immutable caching, so after the first visit
 *  they come straight from the browser cache. */
export function loadFile<T>(relativePath: string): Promise<T> {
  let promise = cache.get(relativePath);
  if (!promise) {
    promise = fetch(`${BASE}/${relativePath}`).then((res) => {
      if (!res.ok) throw new Error(`Couldn't load ${relativePath} (${res.status})`);
      return res.json();
    });
    promise.catch(() => cache.delete(relativePath));
    cache.set(relativePath, promise);
  }
  return promise as Promise<T>;
}

/** Memoises a derived value per input key (e.g. decoded chunk rows). */
export function memo<T>(store: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let promise = store.get(key);
  if (!promise) {
    promise = make();
    promise.catch(() => store.delete(key));
    store.set(key, promise);
  }
  return promise;
}
