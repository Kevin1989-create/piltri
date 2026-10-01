"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { SearchBar } from "@/components/ui/SearchBar";
import { DiscoverIcon } from "@/components/ui/icons";
import dynamic from "next/dynamic";

// Loaded separately (client-only), so the score panel renders without
// waiting for the map library's bundle to download and parse.
const MapView = dynamic(() => import("@/components/explore/MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-surface-muted" />,
});
import { CityHeader } from "@/components/explore/CityHeader";
import { SectionColumn, type OpenSectionKey } from "@/components/explore/SectionColumn";
import { SectionDetailPanel } from "@/components/explore/SectionDetailPanel";
import { ResourcesDetailPanel } from "@/components/explore/ResourcesDetailPanel";
import { PinPanel } from "@/components/explore/PinPanel";
import { useScoreWeights, weightPercentagesToScores } from "@/lib/scoreWeights";
import { computePiltriScore, normaliseWeights } from "@/lib/aggregation/scoring";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/cn";
import { getCityBoundary, getCityExploreData, type CityOutline } from "@/lib/dataset/cities";
import { cityIdFor } from "@/lib/dataset/schema";
import { cityUrl, compareUrl, readCityRef, reportUrl, scoreSettingsUrl, searchUrl, sourcesUrl } from "@/lib/urls";
import type { CityExploreData, NearbyPlace, TravelTimes } from "@/lib/types";

/** Pin mode (click the map for local details and directions) - switched
 *  off for now (2026-09-29, on request) while the rest is polished; the
 *  map is view-only and the pin panel never opens. Set to true to bring
 *  it back as it was. */
const PIN_MODE = false;

/** "Lyon, France" - with the region too for a town sharing its name with
 *  a bigger one in the same country ("Springfield, Illinois, United
 *  States"), whose id isn't the plain name-country one. */
function placeLabel(data: CityExploreData): string {
  const namesake = data.cityId !== cityIdFor(data.cityName, data.countryCode) && data.region;
  return [data.cityName, namesake ? data.region : null, data.country].filter(Boolean).join(", ");
}

function CityContent() {
  const params = useSearchParams();
  const router = useRouter();
  // Which city: /city?id=lyon-fr, or an older link's parameters (see
  // lib/urls.ts) - the name, country and position all come from the data.
  const ref = readCityRef(params);
  const refKey = ref ? [ref.countryCode, ref.id, ref.lat, ref.lng].join("|") : "";
  const cityId = ref?.id ?? "";
  // The city on screen, so tidying an older address (below) doesn't load
  // it all over again.
  const loadedIdRef = useRef<string | null>(null);
  // Where the map looks: the loaded city's position, kept while the next
  // city loads so the map moves across rather than starting over.
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const compareHref = compareUrl([cityId]);
  // Opens in a new tab (see CityHeader) — a print-styled page that lays out
  // the same score/KPI data as the results column, meant to be saved as a
  // PDF via the browser's own print dialog rather than a bespoke PDF
  // pipeline in the app itself.
  const reportHref = reportUrl(cityId);
  // `from` lets Advanced search and Score settings offer a way
  // back to this city.
  const searchHref = searchUrl(cityId);
  const scoreSettingsHref = scoreSettingsUrl(cityId);

  const [data, setData] = useState<CityExploreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `label`, if present, is a labelled map feature's name (POI, transit
  // stop, neighbourhood) the click snapped to - see handleMapClick below.
  const [pin, setPin] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  // Second "directions" pin - set either by clicking a KPI's place name in
  // PinPanel, or by clicking the map while pickingDestination is true. The
  // route between it and `pin` is drawn on the map itself (see MapView),
  // not sent out to an external Google Maps tab.
  // `label` is only set when the pick actually resolved to a genuine named
  // place (a labelled map feature, or a matched Pin-mode place) - MapView's
  // marker popup uses that same "is there a real label" distinction to
  // decide whether to show a "View on Google Maps" link, so a plain
  // unnamed click doesn't get a meaningless generic-text link.
  const [destination, setDestination] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const [pickingDestination, setPickingDestination] = useState(false);
  const [routeInfo, setRouteInfo] = useState<TravelTimes | null>(null);
  // Live-measured height of the PinPanel bar (+ its coordinate caption
  // below it), so a route's fitBounds on the map can reserve exactly enough
  // bottom space to clear it - the bar's height varies with content
  // (loading vs. loaded, how many place names matched), so this is measured
  // rather than guessed as a fixed pixel value.
  const pinPanelWrapperRef = useRef<HTMLDivElement | null>(null);
  const [pinPanelHeight, setPinPanelHeight] = useState(0);
  // The left column's visible box is content-sized (it doesn't stretch to
  // fill its own top-4..bottom-4 wrapper - see the comment on that div
  // below), so its actual bottom edge isn't reliably at the same "bottom-4"
  // line the PinPanel wrapper used to just assume. Measuring it directly
  // and applying the result as PinPanel's own `bottom` keeps the two
  // flush with each other regardless of how tall the left column's content
  // ends up being, rather than guessing a fixed offset.
  const leftColumnBoxRef = useRef<HTMLDivElement | null>(null);
  const mapAreaRef = useRef<HTMLDivElement | null>(null);
  const [pinPanelBottomPx, setPinPanelBottomPx] = useState(16);
  // Which section's detail panel is showing, if any. On desktop the main
  // column (CityHeader + 5 section rows) is a fixed size and never reacts
  // to this — it only controls whether the separate SectionDetailPanel is
  // rendered. On mobile, opening a section hides the map (only the map:
  // header, city and country info and the other rows stay) and returns to
  // the top, so the open section sits right under the city info; closing
  // it brings the map back (2026-09-30, on request).
  const [openSectionKey, setOpenSectionKey] = useState<OpenSectionKey | null>(null);
  // Persisted, shared preference (lib/scoreWeights.ts) — same weighting
  // applies here, in Discover mode's ranking, and on every other city you
  // look at. Read-only here: editing lives on /score-settings only, to
  // keep it clear this is a global setting, not a per-city control.
  const { weights } = useScoreWeights();
  // Below `md`, the floating map-overlay layout (score column pinned over
  // the map, pin details as a bar beside it, section detail as a side
  // panel) gives way to a stacked one: map on top at a fixed height, then
  // the score card and pin details in normal document flow below it, with
  // section detail reusing SectionColumn's own built-in inline accordion
  // instead of a separate floating panel. See the JSX below and
  // MapView's `compact` prop for the other half of this.
  const isDesktop = useMediaQuery("(min-width: 768px)");
  useEffect(() => {
    if (!isDesktop) window.scrollTo({ top: 0 });
  }, [openSectionKey, isDesktop]);
  // Phone, with a section open: the page is exactly one screen tall, the
  // map folds away, and the open section takes the height that's left,
  // scrolling inside its own box (see SectionColumn's `fill`) while the
  // header, city info and other rows stay where they are (2026-09-30, on
  // request).
  const sectionView = !isDesktop && openSectionKey !== null;

  // Clears the dropped pin and everything that depends on it (destination
  // pin, computed route, "picking a second pin" mode) - used whenever the
  // main pin goes away, since a stale destination/route pointing at the old
  // pin's location wouldn't make sense once it's gone.
  function closePin() {
    setPin(null);
    setDestination(null);
    setRouteInfo(null);
    setPickingDestination(false);
  }

  // `name` carries a labelled map feature's name (POI, transit stop,
  // neighbourhood) if the click snapped to one - see MapView's
  // resolveClickedFeature, shared with the second-pin path below - so the
  // very first pin gets the same "click Greenwich, pin Greenwich" treatment
  // the second pin already had, instead of just raw coordinates.
  function handleMapClick(coords: { lat: number; lng: number }, name: string | null) {
    // Locked once a second pin exists: with both pins placed, further plain
    // map clicks are ignored rather than silently relocating the main pin
    // out from under an already-computed route - "Clear" (back to just the
    // main pin) or the panel's close button are the only ways out of this
    // state, not a stray click elsewhere on the map.
    if (destination) return;
    setPin(name ? { ...coords, label: name } : coords);
  }

  // Called by MapView when a click lands during pickingDestination mode -
  // `name` carries a labelled map feature's name (POI, transit stop,
  // neighbourhood) if the click hit one, so the second pin can be tied to
  // an actual place rather than just an anonymous coordinate.
  function handleDestinationPick(coords: { lat: number; lng: number }, name: string | null) {
    setDestination({ ...coords, label: name ?? undefined });
    setPickingDestination(false);
  }

  function handleSelectDestination(place: NearbyPlace, label: string) {
    if (place.lat == null || place.lng == null) return;
    setDestination({ lat: place.lat, lng: place.lng, label: place.name ?? label });
    setPickingDestination(false);
  }

  useEffect(() => {
    if (!ref) return;
    // Already showing it: the address was only tidied (see below).
    if (ref.id && !ref.legacy && ref.id === loadedIdRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    closePin();
    // Start the outline's download alongside the city's data.
    if (ref.id) getCityBoundary(ref.countryCode, ref.id).catch(() => null);
    getCityExploreData(ref.countryCode, ref.id, ref.lat, ref.lng)
      .then((result) => {
        if (cancelled) return;
        if (!result) throw new Error("No data for this place.");
        loadedIdRef.current = result.cityId;
        setData(result);
        setCenter({ lat: result.lat, lng: result.lng });
        setLoading(false);
        // An older link: swap in the short address.
        if (ref.legacy) router.replace(cityUrl(result.cityId), { scroll: false });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message ?? "Something went wrong loading this city.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // refKey stands for `ref`, which is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey]);

  // The map's outline of the place: undefined while loading, null when the
  // dataset has none (the map then draws the 5 km circle).
  const [outline, setOutline] = useState<CityOutline | null | undefined>(undefined);
  useEffect(() => {
    setOutline(undefined);
    if (!data) return;
    let cancelled = false;
    getCityBoundary(data.countryCode, data.cityId)
      .catch(() => null)
      .then((found) => !cancelled && setOutline(found));
    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") closePin();
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  // Track the PinPanel wrapper's actual rendered height so MapView's route
  // fitBounds (see the prop passed below) can reserve exactly enough bottom
  // clearance to keep the route from disappearing behind the bar.
  useEffect(() => {
    if (!pin) {
      setPinPanelHeight(0);
      return;
    }
    const el = pinPanelWrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setPinPanelHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pin]);

  // Keeps pinPanelBottomPx in sync with the left column box's actual
  // rendered bottom edge (see the ref comment above) - recalculates on any
  // size change to that box (e.g. loading -> loaded content) or the
  // surrounding map area (e.g. window resize).
  useEffect(() => {
    const box = leftColumnBoxRef.current;
    const area = mapAreaRef.current;
    if (!box || !area) return;

    function recalc() {
      if (!box || !area) return;
      const boxRect = box.getBoundingClientRect();
      const areaRect = area.getBoundingClientRect();
      setPinPanelBottomPx(Math.max(16, areaRect.bottom - boxRect.bottom));
    }

    recalc();
    const observer = new ResizeObserver(recalc);
    observer.observe(box);
    observer.observe(area);
    return () => observer.disconnect();
  }, [loading, data]);

  if (!ref) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 text-center">
        <p className="text-ink-500">No location selected.</p>
      </main>
    );
  }

  const displayedScore = data
    ? computePiltriScore(data.sectionScores, normaliseWeights(weightPercentagesToScores(weights)))
    : 0;

  return (
    <main className={cn("flex flex-col md:h-screen", sectionView && "h-dvh")}>
      <NavBar
        logoSide="left"
        center={
          // Truly centred across the whole header now (see NavBar's 3-column
          // grid), at the same vertical level as the logo, rather than
          // right-aligned in the space left over after it. Full-width row of
          // its own below the logo on mobile (see NavBar) — the search bar
          // itself shrinks to fill whatever's left after the "Advanced
          // search" link instead of the desktop's fixed 300px.
          <div className="flex items-center gap-2 md:gap-3 w-full max-w-md md:max-w-none md:w-auto">
            <SearchBar
              // Remounted once the city has loaded, to show its name.
              key={data?.cityId ?? "loading"}
              variant="compact"
              initialValue={data ? placeLabel(data) : ""}
              placeholder="Search for a place you will call home"
              className="flex-1 min-w-0 md:w-[300px] md:flex-none"
            />
            {/* Discover mode's entry point, relocated here from the Explore
             *  landing page and relabelled — makes more sense reachable
             *  while you're already looking at a city, if you want to widen
             *  the search with criteria instead of another single lookup.
             *  Carries this city along (searchHref) so Advanced search's
             *  "Back" link can return here instead of the home page. */}
            <Link
              href={searchHref}
              className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-piltri-amber-dark whitespace-nowrap flex-shrink-0"
            >
              <DiscoverIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Advanced search</span>
            </Link>
          </div>
        }
        right={
          data && (
            // Top right on phones too (2026-09-30, on request - visible without
            // scrolling): the logo row has room beside the logo, and it adds
            // no height. Nudged down on phones to line up with the logo's
            // lettering, which sits low in its box.
            <div className="flex flex-col items-end gap-0.5 translate-y-1.5 md:translate-y-0">
              {/* Data & Sources is linked from the home page only (2026-09-30,
               *  on request); the date stays, as plain text. */}
              <span className="text-[11px] text-ink-300 whitespace-nowrap">
                Updated {new Date(data.lastUpdated).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </span>
              <Link href={scoreSettingsHref} className="text-[11px] text-ink-300 hover:text-ink-500 whitespace-nowrap" title="How much each section counts in the Piltri score">
                Score settings
              </Link>
            </div>
          )
        }
      />

      {/* Desktop: the map fills all remaining height, with the score column,
       *  section detail, and pin panel floating on top of it via absolute
       *  positioning (`md:absolute` below). Mobile: none of that floating
       *  works on a phone-width screen, so this becomes a plain stacked
       *  column instead — a fixed-height map, then the score card, then the
       *  pin panel, each in normal flow, with the whole page scrolling
       *  (`main` above drops `h-screen` below `md` for exactly this reason).
       *  `relative` stays on unconditionally since it's still needed as the
       *  positioning context for the `md:absolute` children. */}
      <div ref={mapAreaRef} className={cn("relative flex flex-col md:flex-1 md:overflow-hidden", sectionView && "flex-1")}>
        {/* Mobile: 23dvh - leaves a safety margin for the rows below on
         *  real phones - folding smoothly away while a section is open and
         *  back when it closes. Only this outer box changes height: the map
         *  inside keeps its size and is just uncovered or covered, since a
         *  live WebGL map resizing on every frame read as janky. It stays
         *  mounted, so it comes back as it was. */}
        <div
          aria-hidden={sectionView || undefined}
          className={cn(
            "relative overflow-hidden md:h-full md:flex-1 transition-[height,opacity] duration-300 ease-out motion-reduce:transition-none md:transition-none",
            sectionView ? "h-0 opacity-0" : "h-[23dvh]"
          )}
        >
          <div className="h-[23dvh] md:h-full relative">
            {center ? (
              <MapView
                lat={center.lat}
                lng={center.lng}
                outline={outline === undefined ? undefined : outline?.geometry ?? null}
                outlineIsBuiltUp={outline?.builtUp ?? false}
                outlineInfoHref={`${sourcesUrl(cityId)}#map-outlines`}
                onMapClick={PIN_MODE ? handleMapClick : undefined}
                pinnedCoords={pin}
                destinationCoords={destination}
                pickingDestination={pickingDestination}
                onDestinationPick={handleDestinationPick}
                onRouteInfo={setRouteInfo}
                reservedBottomPx={isDesktop && pin ? pinPanelHeight : 0}
                compact={!isDesktop}
              />
            ) : (
              <div className="w-full h-full bg-surface-muted" />
            )}
          </div>
        </div>

        {/* Score column — floats on top of the map on desktop (fixed size
            at all times: expanding a section opens a separate
            SectionDetailPanel beside it instead of this column growing, so
            nothing about the score list itself ever moves there). On
            mobile it's just the next block in the page, full width, and
            expanding a section uses SectionColumn's own inline accordion
            (`externalDetail={isDesktop}` below) since there's no room for a
            side panel. */}
        <div
          className={cn(
            "static md:absolute md:top-4 md:left-4 md:bottom-4 flex flex-col w-full md:w-[320px] px-4 md:px-0 mt-3 md:mt-0 pb-3 md:pb-0",
            sectionView && "flex-1"
          )}
        >
          <div
            ref={leftColumnBoxRef}
            className={cn(
              "bg-surface md:bg-surface/95 md:backdrop-blur rounded-card shadow-card md:overflow-y-auto md:flex-shrink",
              sectionView && "flex-1 flex flex-col overflow-hidden"
            )}
          >
            {loading && <p className="px-4 py-6 text-sm text-ink-500">Loading Piltri score…</p>}
            {error && (
              <p className="px-4 py-6 text-sm text-score-weak">Couldn't load this city's score: {error}</p>
            )}
            {data && (
              <>
                {/* Always in full - on mobile too while a section is open
                 *  (the map is what makes room; see the map div above). */}
                <CityHeader
                  cityName={data.cityName}
                  country={data.country}
                  piltriScore={displayedScore}
                  demographics={data.demographics}
                  compareHref={compareHref}
                  reportHref={reportHref}
                  scoreSettingsHref={scoreSettingsHref}
                  weights={weights}
                  rank={data.ranks ? { position: data.ranks.piltri, outOf: data.ranks.outOf } : undefined}
                />
                <SectionColumn data={data} externalDetail={isDesktop} fill onOpenSectionChange={setOpenSectionKey} />
              </>
            )}
          </div>
        </div>

        {data && openSectionKey && openSectionKey !== "resources" && isDesktop && (
          <SectionDetailPanel section={openSectionKey} data={data} />
        )}
        {data && openSectionKey === "resources" && isDesktop && <ResourcesDetailPanel countryCode={data.countryCode} />}

        {/* Pin marker itself stays on the map (MapView); its details show
            as a horizontal bar. On desktop that bar floats at the bottom,
            to the right of the score column — fixed at 344px (16px column
            offset + 320px column width + 8px gap) at all times, on request.
            On mobile it's just the next stacked block after the score card. */}
        {pin && (
          <div
            ref={pinPanelWrapperRef}
            className="static md:absolute md:left-[344px] md:right-4 md:pointer-events-none px-4 md:px-0 mt-3 md:mt-0"
            style={isDesktop ? { bottom: pinPanelBottomPx } : undefined}
          >
            <PinPanel
              coords={pin}
              onClose={closePin}
              destination={destination}
              routeInfo={routeInfo}
              pickingDestination={pickingDestination}
              onSelectDestination={handleSelectDestination}
              onStartPickingDestination={() => setPickingDestination(true)}
              onClearDestination={() => {
                setDestination(null);
                setRouteInfo(null);
                setPickingDestination(false);
              }}
            />
          </div>
        )}
      </div>
    </main>
  );
}

export default function CityPage() {
  return (
    <Suspense fallback={null}>
      <CityContent />
    </Suspense>
  );
}
