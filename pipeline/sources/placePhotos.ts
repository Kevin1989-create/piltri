/**
 * Each place's photo - Wikidata's image of it on Wikimedia Commons, with
 * its author and licence - collected by hand with
 * scripts/build-place-photos.mjs into pipeline/static/place-photos.json.gz
 * (2026-11-14, owner). Keyed by GeoNames id; ~40% of places have one.
 */

import { existsSync, readFileSync } from "fs";
import path from "path";
import { gunzipSync } from "zlib";
import type { PhotoTuple } from "@/lib/placePhoto";

const FILE = path.join(__dirname, "..", "static", "place-photos.json.gz");

export const PLACE_PHOTOS_SOURCE = "Photos: Wikidata's image of each place (CC0), the files on Wikimedia Commons (each under its own free licence, credited with its author)";

let table: Record<string, PhotoTuple> | null = null;

export function getPlacePhoto(geonameId: number | string): PhotoTuple | null {
  if (!table) table = existsSync(FILE) ? (JSON.parse(gunzipSync(readFileSync(FILE)).toString("utf8")) as Record<string, PhotoTuple>) : {};
  return table[String(geonameId)] ?? null;
}

export const hasPlacePhotos = () => existsSync(FILE);
