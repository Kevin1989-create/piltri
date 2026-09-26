import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline as streamPipeline } from "stream/promises";

/** Outside OneDrive on purpose: the raw downloads are ~2 GB, and a synced
 *  folder would try to upload every byte. Override with PIPELINE_CACHE_DIR. */
export const CACHE_DIR = process.env.PIPELINE_CACHE_DIR ?? path.join(os.homedir(), ".piltri-pipeline-cache");
export const RAW_DIR = path.join(CACHE_DIR, "raw");
export const WORK_DIR = path.join(CACHE_DIR, "work");
export const OUT_DIR = path.join(CACHE_DIR, "out");

for (const dir of [RAW_DIR, WORK_DIR, OUT_DIR]) if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

export function log(step: string, message: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${step.padEnd(10)} ${message}`);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fetch with retries + backoff - bulk sources (World Bank especially)
 *  occasionally drop a request; a batch job can afford to just try again. */
export async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 5): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) });
      if (res.ok) return res;
      lastError = new Error(`${res.status} ${res.statusText} for ${url}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(2000 * (i + 1));
  }
  throw lastError;
}

export async function fetchJson<T = any>(url: string): Promise<T> {
  const res = await fetchWithRetry(url);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
}

/** Downloads `url` to RAW_DIR/`fileName` unless it's already there (a
 *  zero-byte leftover from an interrupted run is re-downloaded). */
export async function downloadOnce(url: string, fileName: string): Promise<string> {
  const dest = path.join(RAW_DIR, fileName);
  if (existsSync(dest) && statSync(dest).size > 0) return dest;
  log("download", `${fileName} <- ${url}`);
  const res = await fetchWithRetry(url);
  await streamPipeline(Readable.fromWeb(res.body as any), createWriteStream(dest));
  return dest;
}

export function unzipOnce(zipPath: string, destDir: string, marker: string): string {
  const markerPath = path.join(destDir, marker);
  if (existsSync(markerPath)) return destDir;
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  log("unzip", `${path.basename(zipPath)} -> ${destDir}`);
  execSync(`unzip -o -q "${zipPath}" -d "${destDir}"`, { stdio: "inherit" });
  return destDir;
}

/** Caches an expensive step's JSON result in WORK_DIR so re-running the
 *  pipeline after fixing a later step doesn't redo the slow early ones.
 *  Delete the file (or the whole work dir) to force a recompute. */
export async function cached<T>(name: string, compute: () => Promise<T>): Promise<T> {
  const file = path.join(WORK_DIR, `${name}.json`);
  if (existsSync(file) && !process.env.PIPELINE_FRESH) {
    log("cache", `reusing ${name}`);
    return JSON.parse(readFileSync(file, "utf8")) as T;
  }
  const value = await compute();
  writeFileSync(file, JSON.stringify(value));
  return value;
}

export function round(value: number | null | undefined, digits = 1): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
