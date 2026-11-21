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
/** Up to 12 photos per place, the first being its photo (2026-11-21,
 *  scripts/build-place-galleries.mjs). */
const GALLERY_FILE = path.join(__dirname, "..", "static", "place-galleries.json.gz");

export const PLACE_PHOTOS_SOURCE = "Photos: Wikidata's image of each place (CC0), the files on Wikimedia Commons (each under its own free licence, credited with its author)";

let table: Record<string, PhotoTuple> | null = null;

export function getPlacePhoto(geonameId: number | string): PhotoTuple | null {
  if (!table) table = existsSync(FILE) ? (JSON.parse(gunzipSync(readFileSync(FILE)).toString("utf8")) as Record<string, PhotoTuple>) : {};
  return table[String(geonameId)] ?? null;
}

export const hasPlacePhotos = () => existsSync(FILE);

let galleries: Record<string, PhotoTuple[]> | null = null;

/** A place's photos when it has more than one, else null. */
export function getPlaceGallery(geonameId: number | string): PhotoTuple[] | null {
  if (!galleries)
    galleries = existsSync(GALLERY_FILE) ? (JSON.parse(gunzipSync(readFileSync(GALLERY_FILE)).toString("utf8")) as Record<string, PhotoTuple[]>) : {};
  const list = galleries[String(geonameId)];
  return list && list.length > 1 ? list : null;
}
