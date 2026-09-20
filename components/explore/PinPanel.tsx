"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CloseIcon } from "@/components/ui/icons";
import { isPinSaved, savePin } from "@/lib/savedPins";
import type { NearbyPlace, PinnedLocationData, TravelTimes } from "@/lib/types";

interface Destination {
  lat: number;
  lng: number;
  /** Only set when the pick actually resolved to a genuine named place -
   *  see page.tsx's handleDestinationPick. Undefined falls back to "Second
   *  pin" for display, same as MapView's marker popup. */
  label?: string;
}

interface PinPanelProps {
  /** `label`, if present, is a labelled map feature's name (POI, transit
   *  stop, neighbourhood) the pin click snapped to - shown in the
   *  coordinate caption below instead of just raw numbers when available. */
  coords: { lat: number; lng: number; label?: string };
  onClose: () => void;
  /** Second "directions" pin, if one has been set - shown on the map as a
   *  route line from `coords` (see MapView), not as an external Google Maps
   *  link anymore. */
  destination: Destination | null;
  routeInfo: TravelTimes | null;
  /** True while waiting for the user to click the map to place the second
   *  pin (started via the "+ 2nd pin" control below). */
  pickingDestination: boolean;
  /** Sets the second pin directly to a matched KPI place (e.g. clicking
   *  "Hyde Park" under Green space), rather than requiring a manual map
   *  click for every lookup. */
  onSelectDestination: (place: NearbyPlace, label: string) => void;
  onStartPickingDestination: () => void;
  onClearDestination: () => void;
}

interface RowDef {
  label: string;
  getPlace: (data: PinnedLocationData) => NearbyPlace;
}

interface SectionDef {
  title: string;
  rows: RowDef[];
}

// Row/section labels are static - they never depend on the fetched data,
// only the place values within each row do. Keeping them as a module-level
// constant (rather than building them from `data`, as before) means the
// panel's full structure - every category, every row, every column - can
// render at its final size from the very first paint, before the fetch
// even resolves. That's what makes the loading state reserve exactly the
// same space as the loaded state instead of the bar visibly growing once
// data arrives (see the "always render every row" comment below).
//
// Real estate was removed entirely (never genuinely point-specific - a flat
// placeholder shared with the city-level page). "High street" lives in its
// own "Amenities" section - it's a shopping destination, not a transport
// link.
//
// Both Transport and Nature & health use a 2-column grid with rows fed in
// row-major order (grid's default auto-flow), specifically so each column
// reads as its own intentional group top-to-bottom: Transport's left column
// is Train station -> Tramway -> Subway (rail-ish), right column is
// Domestic -> Intl airport; Nature & health's left column is Beach -> Green
// space, right column is Hospital -> Elderly care.
const SECTIONS: SectionDef[] = [
  {
    title: "Education",
    rows: [
      { label: "Nursery", getPlace: (d) => d.education.nearestNursery },
      { label: "School", getPlace: (d) => d.education.nearestSchool },
      { label: "University", getPlace: (d) => d.education.nearestUniversity },
    ],
  },
  {
    title: "Amenities",
    rows: [{ label: "High street", getPlace: (d) => d.transport.highStreet }],
  },
  {
    title: "Transport",
    rows: [
      { label: "Train station", getPlace: (d) => d.transport.trainStation },
      { label: "Domestic airport", getPlace: (d) => d.transport.domesticAirport },
      { label: "Tramway", getPlace: (d) => d.transport.tramway },
      { label: "Intl airport", getPlace: (d) => d.transport.internationalAirport },
      { label: "Subway", getPlace: (d) => d.transport.subwayStation },
    ],
  },
  {
    title: "Nature & health",
    rows: [
      { label: "Beach", getPlace: (d) => d.natureAndHealth.beach },
      { label: "Hospital", getPlace: (d) => d.natureAndHealth.hospital },
      { label: "Green space", getPlace: (d) => d.natureAndHealth.park },
      { label: "Elderly care", getPlace: (d) => d.natureAndHealth.elderlyCare },
    ],
  },
];

// Capped, not fixed, pixel widths: minmax(0, 112px) instead of a bare
// 112px. A bare fixed px value never yields - with 4 sections and no
// shrinking allowed, their combined minimum width (~820px) could genuinely
// exceed the space actually available on a narrower browser window, and the
// overflow had nowhere to go but get clipped (Hospital/Elderly care simply
// not rendering - see the screenshot report). minmax(0, 112px) still caps
// each column at 112px when there's room, but lets the grid track shrink
// (all the way to 0 in the extreme) when there isn't, same as the section
// wrapper below dropping flex-shrink-0 - so on a tight window every column
// shrinks together proportionally instead of the last one being cut off
// entirely. Still driven purely by available space, not by any pin's own
// content, so it stays identical across pins at a given window size - the
// "never moves between pins" property this whole redesign was for.
const SECTION_COLUMNS: Record<string, string> = {
  Education: "grid-cols-[minmax(0,112px)]",
  Amenities: "grid-cols-[minmax(0,112px)]",
  Transport: "grid-cols-[minmax(0,112px)_minmax(0,112px)]",
  "Nature & health": "grid-cols-[minmax(0,112px)_minmax(0,112px)]",
};

/** Pin details — the pin marker itself lives on the map (see MapView); this
 *  is just its detail readout, always a horizontal bar pinned to the bottom
 *  of the map area (to the right of the section column — the parent page
 *  positions this so it never overlaps the column).
 *
 *  Every dimension here is fixed regardless of which pin is showing or what
 *  state it's in (loading, no destination, destination with directions) -
 *  see SECTION_COLUMNS above, the fixed-width controls block, and the
 *  reserved min-height around the destination/`+2nd pin` swap below. */
export function PinPanel({
  coords,
  onClose,
  destination,
  routeInfo,
  pickingDestination,
  onSelectDestination,
  onStartPickingDestination,
  onClearDestination,
}: PinPanelProps) {
  const [data, setData] = useState<PinnedLocationData | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setSaved(isPinSaved(coords.lat, coords.lng));
    fetch(`/api/explore/pin?lat=${coords.lat}&lng=${coords.lng}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d);
      });
    return () => {
      cancelled = true;
    };
  }, [coords.lat, coords.lng]);

  function handleSave() {
    savePin({ lat: coords.lat, lng: coords.lng, neighbourhoodName: data?.neighbourhoodName ?? null });
    setSaved(true);
  }

  return (
    <div className="pointer-events-auto relative">
      {/* `w-full` + `justify-between`, not the earlier shrink-to-content
       *  `inline-flex`: the bar's right edge now reaches the container's
       *  actual right boundary (right-4 on the parent - 16px from the
       *  screen edge), mirroring the left column's 16px inset, rather than
       *  stopping wherever the last section's content happened to end and
       *  leaving a large dead gap of bare map before the screen edge. The
       *  controls block is pushed flush right via justify-between; the
       *  divider (divide-x) then sits right at its left edge, wherever that
       *  ends up, rather than hugging the last section.
       *
       *  No max-h / scroll anymore - on request, the bar just sizes itself
       *  to its content naturally instead of capping height and scrolling
       *  internally.
       *
       *  Below `md` (the results page's mobile layout, where this bar sits
       *  in normal document flow under the score card rather than floating
       *  beside it), the whole thing stacks into a single column instead of
       *  a side-by-side bar - there's no room for 4 sections plus a control
       *  column across a phone's width. */}
      <div className="flex flex-col md:flex-row w-full md:justify-between bg-surface rounded-card shadow-card items-stretch divide-y md:divide-y-0 md:divide-x divide-surface-border overflow-hidden">
        {/* The sections laid out side by side on desktop. Capped-but-shrinkable
         *  column widths (SECTION_COLUMNS) plus dropping flex-shrink-0 here
         *  (each section is now a normal shrinkable flex item, `min-w-0` so
         *  it's actually allowed to shrink below its content size) mean the
         *  4 sections share whatever space is really available and shrink
         *  together on a narrower window, rather than each demanding its
         *  full 112px regardless and having the excess either overlap the
         *  controls block or get silently clipped off (both tried, both
         *  wrong - see history). gap-x-10 spends the space that used to
         *  just sit empty between the last section and the controls block
         *  (now that the bar is full-width) on more breathing room between
         *  the 4 subsections themselves instead, rather than one big
         *  leftover gap at the end. Stacked vertically on mobile instead
         *  (gap-y-4), each section full width. */}
        <div className="flex flex-col md:flex-row flex-1 min-w-0 gap-y-4 md:gap-y-0 md:gap-x-10 px-4 md:px-5 py-3 md:py-2.5">
          {SECTIONS.map((section) => (
            <div key={section.title} className="w-full md:w-auto break-inside-avoid min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-ink-500 mb-1">{section.title}</p>
              <div className={`grid ${SECTION_COLUMNS[section.title] ?? "grid-cols-2"} gap-x-4 gap-y-2`}>
                {section.rows.map((row) => {
                  // Always rendered, whether or not `data` has loaded yet -
                  // this row's own label/position never depends on it, only
                  // the place name/minutes cells below do. That's what lets
                  // the whole bar sit at its final size immediately, rather
                  // than starting tiny (a single "Loading…" line) and
                  // jumping to full size once the fetch resolves.
                  const place = data ? row.getPlace(data) : null;
                  const canRoute = data != null && place?.lat != null && place?.lng != null;
                  const minutesText = data == null ? "···" : place?.minutes != null ? `${place.minutes} min` : "N/A";
                  return (
                    <div key={row.label} className="min-w-0">
                      {/* Label ("School") is deliberately styled quite
                       *  differently from the place name below it
                       *  (uppercase + letter-spacing vs. plain prose) so
                       *  the two don't read as visually interchangeable. */}
                      <dt className="text-[9px] font-semibold uppercase tracking-wide text-ink-600 leading-tight">
                        {row.label}
                      </dt>
                      {/* The place name is the clickable element - clicking
                       *  it sets it as the second pin and draws a route to
                       *  it on our own map (see PinPanel's directions
                       *  control below / MapView), instead of opening an
                       *  external Google Maps tab. Always rendered, even
                       *  with no name matched (e.g. High street
                       *  sometimes) or still loading, so every row reserves
                       *  the same line height and stays aligned with its
                       *  neighbours.
                       *
                       *  `truncate` (and the width it needs to clip
                       *  against) lives on the button/span themselves, not
                       *  this wrapping dd - text-overflow only produces a
                       *  clean "…" for the element whose own box is being
                       *  clipped. */}
                      <dd className="text-xs font-normal leading-tight max-w-[200px] md:max-w-[112px] mt-0.5">
                        {data == null ? (
                          // animate-pulse - a still, static "···" reads as
                          // "empty/broken" the longer a slow Overpass/Mapbox
                          // lookup takes; a gentle pulse at least signals
                          // "actively loading" rather than looking stuck.
                          <span className="block truncate text-ink-300 animate-pulse">···</span>
                        ) : canRoute && place ? (
                          <button
                            type="button"
                            onClick={() => onSelectDestination(place, row.label)}
                            title={`Show directions to ${place.name ?? row.label} on the map`}
                            className="block w-full truncate text-left text-piltri-amber hover:underline"
                          >
                            {place.name ?? "Get directions"}
                          </button>
                        ) : (
                          <span className="block truncate text-ink-900">{place?.name ?? " "}</span>
                        )}
                      </dd>
                      {/* Minutes is the secondary, muted line - the place
                       *  name above carries the primary attention and the
                       *  interactivity. */}
                      <dd className={`text-[10px] text-ink-500 leading-tight tabular-nums ${data == null ? "animate-pulse" : ""}`}>
                        {minutesText}
                      </dd>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Fixed width on desktop, not shrink-to-content - without it, this
         *  block's own width varied with whatever it currently held (a short
         *  "+2nd pin" trigger vs. a destination label + travel time + Clear
         *  button), which shifted the whole bar's total width/shape between
         *  pins and even between states on the *same* pin. Full width on
         *  mobile, where it's its own stacked row rather than a side column. */}
        <div className="w-full md:w-[150px] flex-shrink-0 px-4 py-3 md:py-2 flex flex-col items-center gap-1.5">
          <button onClick={onClose} aria-label="Close pin details" className="text-ink-500 hover:text-ink-900">
            <CloseIcon className="w-4 h-4" />
          </button>
          <Button size="sm" onClick={handleSave} disabled={saved}>
            {saved ? "Saved" : "Save"}
          </Button>

          {/* Reserved height sized to the taller of the two states
           *  (destination set) so swapping between "+2nd pin" and a full
           *  destination block doesn't change the controls block's - and
           *  therefore the bar's - height. */}
          <div className="min-h-[52px] w-full flex flex-col items-center justify-center gap-0.5">
            {destination ? (
              <div className="flex flex-col items-center gap-0.5 w-full">
                <p
                  className="text-[9px] text-ink-500 text-center leading-tight max-w-[200px] md:max-w-[112px] truncate"
                  title={destination.label ?? "Second pin"}
                >
                  → {destination.label ?? "Second pin"}
                </p>
                {/* Driving and walking on one line, on request - simpler to
                 *  scan than separate labelled lines. Driving is real
                 *  Mapbox data (the drawn route); walking is a separate
                 *  duration-only lookup (see MapView's route effect). No
                 *  public-transport figure - dropped on request, and there
                 *  was never real data behind it anyway: Mapbox's free
                 *  Directions API (the only routing source this app uses)
                 *  has no transit profile at all. */}
                <p className="text-[10px] font-semibold text-piltri-amber tabular-nums text-center leading-tight">
                  {routeInfo
                    ? `${routeInfo.car.minutes} min driving / ${routeInfo.walkingMinutes != null ? `${routeInfo.walkingMinutes} min walking` : "walking n/a"}`
                    : "Calculating…"}
                </p>

                <button
                  type="button"
                  onClick={onClearDestination}
                  className="text-[9px] text-ink-500 underline hover:text-ink-900 mt-0.5"
                >
                  Clear
                </button>
              </div>
            ) : (
              // Manual "second pin" control - lets the user pick any point
              // on the map (not just a matched KPI place) to get directions
              // to, same as clicking a KPI place name above.
              <button
                type="button"
                onClick={onStartPickingDestination}
                className={`text-[9px] text-center leading-tight ${
                  pickingDestination ? "text-piltri-amber" : "text-ink-500 hover:text-ink-900"
                }`}
              >
                {pickingDestination ? "Click the map…" : "+ 2nd pin"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Below-left of the bar, not above it. `absolute top-full` takes it
       *  out of normal flow entirely, rather than sitting in-flow below the
       *  bar (which used to push the whole wrapper's content taller than
       *  just the bar itself) - the parent page positions this wrapper with
       *  `bottom-4`, so as long as the caption doesn't count toward the
       *  wrapper's own height, the bar's bottom edge lands exactly on that
       *  bottom-4 line, flush with the left column's bottom edge, instead
       *  of sitting visibly higher than it because of the caption's height
       *  underneath. Kept small/muted since it's supplementary, not part of
       *  the data grid. */}
      <p className="absolute top-full mt-1 px-1 text-[10px] text-ink-500 tabular-nums whitespace-nowrap">
        {coords.label ? `${coords.label} · ` : "Dropped pin "}
        {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
      </p>
    </div>
  );
}
