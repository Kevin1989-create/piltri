/**
 * Spots people drop on a city's map (2026-10-31, owner): kept in this
 * browser, and in the person's account once signed in (2026-11-08,
 * lib/account.ts) - and shared by link (`?spot=lat,lng&to=lat,lng`). A
 * browser that blocks storage just doesn't keep them.
 */
import { announceOp, SAVED_CHANGE, type SavedItem } from "@/lib/savedPlaces";

export interface SavedSpot {
  /** The city page it was saved on (`london-gb`). */
  placeId: string;
  lat: number;
  lng: number;
  /** What the map showed under it, if anything. */
  name: string | null;
  savedAt: string;
}

const STORAGE_KEY = "piltri:spots";

function readAll(): SavedSpot[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as SavedSpot[]) : [];
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

/** Replaces the whole list (the account's sync), without announcing ops. */
export function writeSpots(spots: SavedSpot[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(spots));
  } catch {
    // Storage blocked or full: the spot just isn't kept.
  }
  window.dispatchEvent(new Event(SAVED_CHANGE));
}

export const spotKey = (spot: { lat: number; lng: number }) => `spot:${formatSpotParam(spot)}`;

export function spotItem(s: SavedSpot): SavedItem {
  return { key: spotKey(s), kind: "spot", placeId: s.placeId, name: s.name, country: null, lat: s.lat, lng: s.lng, savedAt: s.savedAt };
}

/** Within about a metre: the same spot. */
export function sameSpot(a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean {
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}

export function savedSpotsFor(placeId: string): SavedSpot[] {
  return readAll().filter((s) => s.placeId === placeId);
}

export function saveSpot(spot: Omit<SavedSpot, "savedAt">): void {
  const all = readAll();
  if (all.some((s) => sameSpot(s, spot))) return;
  const saved = { ...spot, savedAt: new Date().toISOString() };
  writeSpots([...all, saved]);
  announceOp({ op: "add", item: spotItem(saved) });
}

export function removeSpot(spot: { lat: number; lng: number }): void {
  const all = readAll();
  const gone = all.filter((s) => sameSpot(s, spot));
  if (!gone.length) return;
  writeSpots(all.filter((s) => !sameSpot(s, spot)));
  for (const s of gone) announceOp({ op: "remove", item: spotItem(s) });
}

/** A spot in a link: "51.50735,-0.12776" (about a metre). */
export function formatSpotParam(spot: { lat: number; lng: number }): string {
  return `${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}`;
}

export function parseSpotParam(value: string | null): { lat: number; lng: number } | null {
  if (!value) return null;
  const [lat, lng] = value.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Every spot saved in this browser, newest first (the Saved page). */
export function allSavedSpots(): SavedSpot[] {
  return readAll().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
