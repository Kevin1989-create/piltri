"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { SearchBar } from "@/components/ui/SearchBar";
import { DiscoverIcon } from "@/components/ui/icons";
import { MapView } from "@/components/explore/MapView";
import { CityHeader } from "@/components/explore/CityHeader";
import { SectionColumn } from "@/components/explore/SectionColumn";
import { SectionDetailPanel } from "@/components/explore/SectionDetailPanel";
import { PinPanel } from "@/components/explore/PinPanel";
import { useScoreWeights, weightPercentagesToScores } from "@/lib/scoreWeights";
import { computePiltriScore, normaliseWeights } from "@/lib/aggregation/scoring";
import type { CityExploreData, NearbyPlace, SectionKey, TravelTimes } from "@/lib/types";

function ResultsContent() {
  const params = useSearchParams();
  const cityId = params.get("cityId") ?? "";
  const cityName = params.get("city") ?? "";
  const region = params.get("region") ?? "";
  const country = params.get("country") ?? "";
  const countryCode = params.get("countryCode") ?? "";
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const boundaryQuery = [cityName, region, country].filter(Boolean).join(", ");
  const cityQueryParams = {
    cityId,
    city: cityName,
    region,
    country,
    countryCode,
    lat: String(lat),
    lng: String(lng),
  };
  const compareHref = `/explore/compare?${new URLSearchParams(cityQueryParams).toString()}`;
  // Opens in a new tab (see CityHeader) — a print-styled page that lays out
  // the same score/KPI data as the results column, meant to be saved as a
  // PDF via the browser's own print dialog rather than a bespoke PDF
  // pipeline in the app itself.
  const reportHref = `/explore/report?${new URLSearchParams(cityQueryParams).toString()}`;
  // Carries this city's context along so Advanced search's "Back" link can
  // return here instead of the generic /explore landing page.
  const discoverHref = `/explore/discover?${new URLSearchParams(cityQueryParams).toString()}`;

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
  // Which section's detail panel is showing, if any — the main column
  // (CityHeader + 5 section rows) is a fixed size and never reacts to this;
  // it only controls whether the separate SectionDetailPanel is rendered.
  const [openSectionKey, setOpenSectionKey] = useState<SectionKey | null>(null);
  // Persisted, shared preference (lib/scoreWeights.ts) — same weighting
  // applies here, in Discover mode's ranking, and on every other city you
  // look at. Read-only here: editing lives on /explore/weights only, to
  // keep it clear this is a global setting, not a per-city control.
  const { weights } = useScoreWeights();

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
    if (!cityName || Number.isNaN(lat) || Number.isNaN(lng)) return;
    setLoading(true);
    setError(null);
    setData(null);
    closePin();
    const qs = new URLSearchParams({
      cityId,
      city: cityName,
      region,
      country,
      countryCode,
      lat: String(lat),
      lng: String(lng),
    });
    fetch(`/api/explore/score?${qs.toString()}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok || body?.error) {
          throw new Error(body?.error ?? "Failed to load this city's score.");
        }
        setData(body as CityExploreData);
      })
      .catch((err) => setError(err.message ?? "Something went wrong loading this city."))
      .finally(() => setLoading(false));
  }, [cityId, cityName, region, country, countryCode, lat, lng]);

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

  if (Number.isNaN(lat) || Number.isNaN(lng) || !cityName) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <p className="text-ink-500">No location selected.</p>
      </main>
    );
  }

  const displayedScore = data
    ? computePiltriScore(data.sectionScores, normaliseWeights(weightPercentagesToScores(weights)))
    : 0;

  return (
    <main className="h-screen flex flex-col">
      <NavBar
        logoSide="left"
        center={
          // Truly centred across the whole header now (see NavBar's 3-column
          // grid), at the same vertical level as the logo, rather than
          // right-aligned in the space left over after it.
          <div className="flex items-center gap-3">
            <SearchBar
              variant="compact"
              initialValue={`${cityName}${country ? `, ${country}` : ""}`}
              placeholder="Explore a place here"
              className="w-[300px]"
            />
            {/* Discover mode's entry point, relocated here from the Explore
             *  landing page and relabelled — makes more sense reachable
             *  while you're already looking at a city, if you want to widen
             *  the search with criteria instead of another single lookup.
             *  Carries this city's context via discoverHref so Advanced
             *  search's "Back" link can return here instead of the generic
             *  /explore landing page. */}
            <Link
              href={discoverHref}
              className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-piltri-amber-dark whitespace-nowrap"
            >
              <DiscoverIcon className="w-3.5 h-3.5" />
              Advanced search
            </Link>
          </div>
        }
        right={
          data && (
            <p className="text-[11px] text-ink-300 whitespace-nowrap">
              Updated {new Date(data.lastUpdated).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </p>
          )
        }
      />

      <div ref={mapAreaRef} className="flex-1 relative overflow-hidden">
        <MapView
          lat={lat}
          lng={lng}
          boundaryQuery={boundaryQuery}
          onMapClick={handleMapClick}
          pinnedCoords={pin}
          destinationCoords={destination}
          pickingDestination={pickingDestination}
          onDestinationPick={handleDestinationPick}
          onRouteInfo={setRouteInfo}
          reservedBottomPx={pin ? pinPanelHeight : 0}
        />

        {/* Floating left column — sits on top of the map rather than
            resizing it. Fixed size at all times, whether or not a section is
            expanded: expanding a section opens a separate SectionDetailPanel
            to its right instead of this column growing, so nothing about
            the score list itself ever moves. */}
        <div className="absolute top-4 left-4 bottom-4 flex flex-col w-[320px]">
          <div ref={leftColumnBoxRef} className="bg-surface/95 backdrop-blur rounded-card shadow-card overflow-y-auto flex-shrink">
            {loading && <p className="px-4 py-6 text-sm text-ink-500">Loading Piltri score…</p>}
            {error && (
              <p className="px-4 py-6 text-sm text-score-weak">Couldn't load this city's score: {error}</p>
            )}
            {data && (
              <>
                <CityHeader
                  cityName={data.cityName}
                  region={data.region}
                  country={data.country}
                  piltriScore={displayedScore}
                  demographics={data.demographics}
                  compareHref={compareHref}
                  reportHref={reportHref}
                  weights={weights}
                />
                <SectionColumn data={data} externalDetail onOpenSectionChange={setOpenSectionKey} />
              </>
            )}
          </div>
        </div>

        {data && openSectionKey && <SectionDetailPanel section={openSectionKey} data={data} />}

        {/* Pin marker itself stays on the map (MapView); its details show
            as a horizontal bar pinned to the bottom, to the right of the
            main column. Fixed at 344px (16px column offset + 320px column
            width + 8px gap) at all times now, on request — it no longer
            shifts over when a section detail panel opens alongside it. */}
        {pin && (
          <div
            ref={pinPanelWrapperRef}
            className="absolute left-[344px] right-4 pointer-events-none"
            style={{ bottom: pinPanelBottomPx }}
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

export default function ExploreResultsPage() {
  return (
    <Suspense fallback={null}>
      <ResultsContent />
    </Suspense>
  );
}
