/** OpenStreetMap's licence - and OpenMapTiles' and OpenFreeMap's terms -
 *  ask for a visible credit on the map. MapLibre's own control opened over
 *  the bottom of the map for a few seconds on every new place; removed on
 *  request (2026-10-28) for this small permanent line in the corner, which
 *  also credits the routing server while a journey is drawn. */
export function MapCredit({ routes = false }: { routes?: boolean }) {
  const link = "hover:underline underline-offset-2";
  return (
    <div className="pointer-events-auto absolute bottom-1 right-1 z-[1] max-w-[calc(100%-0.5rem)] truncate rounded bg-white/75 px-1.5 text-[10px] leading-4 text-ink-500">
      <a className={link} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
        © OpenStreetMap
      </a>
      {" · "}
      <a className={link} href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">
        OpenMapTiles
      </a>
      {" · "}
      <a className={link} href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">
        OpenFreeMap
      </a>
      {routes && (
        <>
          {" · "}
          <a className={link} href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener noreferrer">
            Routes: FOSSGIS
          </a>
        </>
      )}
    </div>
  );
}
