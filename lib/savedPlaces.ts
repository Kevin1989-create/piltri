/**
 * Places people save with the heart (2026-11-08, owner: "save a city ...
 * and a specific point within the city"): kept in this browser for now,
 * like spots (lib/spots.ts) - no account yet, so nothing about the person
 * leaves their device. Accounts (BACKLOG) will carry both across devices.
 * A browser that blocks storage just doesn't keep them.
 */
export interface SavedPlace {
  /** The city page's id (`olivet-fr`). */
  id: string;
  name: string;
  country: string;
  savedAt: string;
}

const STORAGE_KEY = "piltri:places";
/** Fired on window when the saved places change, so every heart on the
 *  page (and the Saved page) shows the same. */
export const SAVED_CHANGE = "piltri:saved-change";

export function savedPlaces(): SavedPlace[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as SavedPlace[]) : [];
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

function writeAll(places: SavedPlace[]): void {
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
  if (all.some((p) => p.id === place.id)) {
    writeAll(all.filter((p) => p.id !== place.id));
    return false;
  }
  writeAll([{ ...place, savedAt: new Date().toISOString() }, ...all]);
  return true;
}

export function removePlace(id: string): void {
  writeAll(savedPlaces().filter((p) => p.id !== id));
}
