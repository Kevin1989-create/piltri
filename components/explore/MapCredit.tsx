/** OpenStreetMap's licence - and OpenMapTiles' and OpenFreeMap's terms -
 *  ask for a visible credit on the map. MapLibre's own control opened over
 *  the bottom of the map for a few seconds on every new place; removed on
 *  request (2026-10-28) for this small permanent line in the corner, which
 *  also credits the routing server while a journey is drawn. Bottom left,
 *  flush with the edge (2026-10-30, owner) - below the score card on a
 *  computer, which stops 16 px above the map's bottom. */
export function MapCredit({ routes = false }: { routes?: boolean }) {
  const link = "hover:underline underline-offset-2";
  return (
    <div className="pointer-events-auto absolute bottom-0 left-0 z-[1] max-w-full truncate rounded-tr bg-white/75 px-1.5 text-[10px] leading-4 text-ink-500">
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
