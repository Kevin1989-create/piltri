/**
 * Local-only "saved pins" — persisted in the browser's localStorage, no
 * account or server-side storage involved. Deliberately simple for launch:
 * no auth, no user table, no data retention/deletion policy to worry about,
 * since nothing about the user ever leaves their own browser. Trade-off:
 * saved pins don't sync across devices and are lost if the user clears
 * their browser data.
 */
export interface SavedPin {
  lat: number;
  lng: number;
  neighbourhoodName: string | null;
  savedAt: string;
}

const STORAGE_KEY = "piltri:saved-pins";

function readAll(): SavedPin[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedPin[]) : [];
  } catch {
    return [];
  }
}

function writeAll(pins: SavedPin[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // Storage unavailable (private browsing, quota, etc.) — fail silently,
    // saving is a nice-to-have, not core functionality.
  }
}

// Coordinates are floating point — treat anything within ~1m as the same pin
// rather than requiring an exact match.
function sameSpot(a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean {
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}

export function getSavedPins(): SavedPin[] {
  return readAll();
}

export function isPinSaved(lat: number, lng: number): boolean {
  return readAll().some((p) => sameSpot(p, { lat, lng }));
}

export function savePin(pin: { lat: number; lng: number; neighbourhoodName: string | null }): void {
  const all = readAll();
  if (all.some((p) => sameSpot(p, pin))) return;
  all.push({ ...pin, savedAt: new Date().toISOString() });
  writeAll(all);
}

export function removeSavedPin(lat: number, lng: number): void {
  writeAll(readAll().filter((p) => !sameSpot(p, { lat, lng })));
}
