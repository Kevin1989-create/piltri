/**
 * One point per stop or station (2026-11-08): OpenStreetMap maps a tram
 * stop as a stop position per direction plus a platform or two, and a
 * station as the station and its platforms - the same name within a few
 * hundred metres. Kept: the first of each name per SAME_SITE_KM, so a
 * city's list counts each stop once; unnamed ones only where no named one
 * is that close.
 */
const SAME_SITE_KM = 0.35;

export function onePerSite<T extends { lng: ArrayLike<number>; lat: ArrayLike<number>; names?: ArrayLike<string | null> | null }>(
  points: T,
  km = SAME_SITE_KM
): { lng: number[]; lat: number[]; names: string[] } {
  const order = Array.from({ length: points.lng.length }, (_, i) => i);
  // Named first, so an unnamed platform never stands for a named stop.
  order.sort((a, b) => Number(!points.names?.[a]) - Number(!points.names?.[b]));
  const cellDeg = km / 111.32;
  const taken = new Map<string, { lng: number; lat: number; name: string }[]>();
  const out = { lng: [] as number[], lat: [] as number[], names: [] as string[] };
  for (const i of order) {
    const lng = points.lng[i];
    const lat = points.lat[i];
    const name = (points.names?.[i] ?? "").trim();
    const key = name.toLowerCase();
    const cx = Math.floor(lng / cellDeg);
    const cy = Math.floor(lat / cellDeg);
    const kx = Math.cos((lat * Math.PI) / 180);
    let same = false;
    for (let dx = -1; dx <= 1 && !same; dx++)
      for (let dy = -1; dy <= 1 && !same; dy++)
        for (const q of taken.get(`${cx + dx},${cy + dy}`) ?? []) {
          if ((key === "" || q.name === key) && Math.hypot((lng - q.lng) * kx, lat - q.lat) * 111.32 < km) {
            same = true;
            break;
          }
        }
    if (same) continue;
    const cell = `${cx},${cy}`;
    if (!taken.has(cell)) taken.set(cell, []);
    taken.get(cell)!.push({ lng, lat, name: key });
    out.lng.push(lng);
    out.lat.push(lat);
    out.names.push(name);
  }
  return out;
}
