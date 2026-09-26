"use client";

import { useEffect, useState } from "react";
import { getPinnedLocationData } from "@/lib/dataset/pin";
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
  /** Sets the second pin directly to a matched nearby place (e.g. clicking
   *  "Camber Sands" under Beach), rather than requiring a manual map click. */
  onSelectDestination: (place: NearbyPlace, label: string) => void;
  onStartPickingDestination: () => void;
  onClearDestination: () => void;
}

interface RowDef {
  label: string;
  getPlace: (data: PinnedLocationData) => NearbyPlace;
}

// Deliberately just 4 rows — the sea, a mountain, an airport, and a train
// station, the exact 4 things people actually asked to see for a dropped
// pin. An earlier 13-field version (schools, subway, high street,
// hospitals, etc.) fired ~13 parallel lookups per pin and was the single
// biggest source of slow/unreliable pins.
const ROWS: RowDef[] = [
  { label: "Beach", getPlace: (d) => d.nearestBeach },
  { label: "Mountain", getPlace: (d) => d.nearestMountain },
  { label: "Train station", getPlace: (d) => d.nearestTrainStation },
  { label: "Airport", getPlace: (d) => d.nearestAirport },
];

/** Pin details — the pin marker itself lives on the map (see MapView); this
 *  is just its detail readout, a horizontal bar on desktop (below the map
 *  area, to the right of the score column) or a stacked block on mobile
 *  (see the results page's md: breakpoints). */
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
    getPinnedLocationData(coords.lat, coords.lng)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {});
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
      <div className="flex flex-col md:flex-row w-full md:justify-between bg-surface rounded-card shadow-card items-stretch divide-y md:divide-y-0 md:divide-x divide-surface-border overflow-hidden">
        <div className="grid grid-cols-2 md:flex md:flex-1 min-w-0 gap-x-6 gap-y-3 md:gap-x-10 px-4 md:px-5 py-3 md:py-2.5">
          {ROWS.map((row) => {
            const place = data ? row.getPlace(data) : null;
            const canRoute = data != null && place?.lat != null && place?.lng != null;
            // "~" + distance-based estimate: travel times come from straight-
            // line distance, not a routing engine (see lib/dataset/pin.ts).
            const minutesText = data == null ? "···" : place?.minutes != null ? `~${place.minutes} min` : "N/A";
            return (
              <div key={row.label} className="min-w-0">
                <dt className="text-[9px] font-semibold uppercase tracking-wide text-ink-600 leading-tight">{row.label}</dt>
                <dd className="text-xs font-normal leading-tight max-w-[160px] mt-0.5">
                  {data == null ? (
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
                    <span className="block truncate text-ink-900">{place?.name ?? "Not found nearby"}</span>
                  )}
                </dd>
                <dd className={`text-[10px] text-ink-500 leading-tight tabular-nums ${data == null ? "animate-pulse" : ""}`}>
                  {minutesText}
                </dd>
              </div>
            );
          })}
        </div>

        <div className="w-full md:w-[150px] flex-shrink-0 px-4 py-3 md:py-2 flex flex-col items-center gap-1.5">
          <button onClick={onClose} aria-label="Close pin details" className="text-ink-500 hover:text-ink-900">
            <CloseIcon className="w-4 h-4" />
          </button>
          <Button size="sm" onClick={handleSave} disabled={saved}>
            {saved ? "Saved" : "Save"}
          </Button>

          <div className="min-h-[52px] w-full flex flex-col items-center justify-center gap-0.5">
            {destination ? (
              <div className="flex flex-col items-center gap-0.5 w-full">
                <p
                  className="text-[9px] text-ink-500 text-center leading-tight max-w-[160px] truncate"
                  title={destination.label ?? "Second pin"}
                >
                  → {destination.label ?? "Second pin"}
                </p>
                <p
                  className="text-[10px] font-semibold text-piltri-amber tabular-nums text-center leading-tight"
                  title="Estimated from straight-line distance (no live routing) - roughly 40 km/h driving, 5 km/h walking"
                >
                  {routeInfo
                    ? `~${routeInfo.car.minutes} min driving / ${routeInfo.walkingMinutes != null ? `~${routeInfo.walkingMinutes} min walking` : "walking n/a"}`
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

      <p className="absolute top-full mt-1 px-1 text-[10px] text-ink-500 tabular-nums whitespace-nowrap">
        {coords.label ? `${coords.label} · ` : "Dropped pin "}
        {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
      </p>
    </div>
  );
}
