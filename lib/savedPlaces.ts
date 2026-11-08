/**
 * Places people save with the heart (2026-11-08, owner: "save a city ...
 * and a specific point within the city"): kept in this browser, and in the
 * person's account once signed in (lib/account.ts keeps the two in step).
 * A browser that blocks storage just doesn't keep them.
 */
export interface SavedPlace {
  /** The city page's id (`olivet-fr`). */
  id: string;
  name: string;
  country: string;
  /** Where it is, for the Saved page's globe (absent on early saves). */
  lat?: number | null;
  lng?: number | null;
  savedAt: string;
}

const STORAGE_KEY = "piltri:places";
/** Fired on window when saved places or spots change, so every heart on
 *  the page (and the Saved page) shows the same. */
export const SAVED_CHANGE = "piltri:saved-change";
/** Fired on window for a save or removal made here (detail: SavedOp), so
 *  a signed-in account can follow it. */
export const SAVED_OP = "piltri:saved-op";

/** One saved thing as an account stores it. */
export interface SavedItem {
  key: string;
  kind: "place" | "spot";
  placeId: string;
  name: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  savedAt: string;
}
export type SavedOp = { op: "add" | "remove"; item: SavedItem };

export const placeKey = (id: string) => `place:${id}`;

export function placeItem(p: SavedPlace): SavedItem {
  return { key: placeKey(p.id), kind: "place", placeId: p.id, name: p.name, country: p.country, lat: p.lat ?? null, lng: p.lng ?? null, savedAt: p.savedAt };
}

export function announceOp(detail: SavedOp): void {
  window.dispatchEvent(new CustomEvent<SavedOp>(SAVED_OP, { detail }));
}

export function savedPlaces(): SavedPlace[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as SavedPlace[]) : [];
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

/** Replaces the whole list (the account's sync), without announcing ops. */
export function writePlaces(places: SavedPlace[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
  } catch {
    // Storage blocked or full: the place just isn't kept.
  }
  window.dispatchEvent(new Event(SAVED_CHANGE));
}

export function isPlaceSaved(id: string): boolean {
  return savedPlaces().some((p) => p.id === id);
}

/** Saved now: true; unsaved: false. */
export function togglePlace(place: Omit<SavedPlace, "savedAt">): boolean {
  const all = savedPlaces();
  const found = all.find((p) => p.id === place.id);
  if (found) {
    writePlaces(all.filter((p) => p.id !== place.id));
    announceOp({ op: "remove", item: placeItem(found) });
    return false;
  }
  const saved = { ...place, savedAt: new Date().toISOString() };
  writePlaces([saved, ...all]);
  announceOp({ op: "add", item: placeItem(saved) });
  return true;
}

export function removePlace(id: string): void {
  const all = savedPlaces();
  const found = all.find((p) => p.id === id);
  if (!found) return;
  writePlaces(all.filter((p) => p.id !== id));
  announceOp({ op: "remove", item: placeItem(found) });
}
