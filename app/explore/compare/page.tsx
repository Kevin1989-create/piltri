"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { SearchBar } from "@/components/ui/SearchBar";
import { CityHeader } from "@/components/explore/CityHeader";
import { SectionColumn } from "@/components/explore/SectionColumn";
import { CloseIcon } from "@/components/ui/icons";
import type { CityExploreData, CitySearchResult } from "@/lib/types";

const MAX_COLUMNS = 10;

interface ColumnState {
  data: CityExploreData | null;
  loading: boolean;
  error: string | null;
}

function paramsToCity(params: URLSearchParams): CitySearchResult | null {
  const cityName = params.get("city");
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!cityName || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return {
    cityId: params.get("cityId") ?? "",
    cityName,
    region: params.get("region") || null,
    country: params.get("country") ?? "",
    countryCode: params.get("countryCode") ?? "",
    lat,
    lng,
  };
}

async function fetchScore(city: CitySearchResult): Promise<CityExploreData> {
  const qs = new URLSearchParams({
    cityId: city.cityId,
    city: city.cityName,
    region: city.region ?? "",
    country: city.country,
    countryCode: city.countryCode,
    lat: String(city.lat),
    lng: String(city.lng),
  });
  const res = await fetch(`/api/explore/score?${qs.toString()}`);
  const body = await res.json();
  if (!res.ok || body?.error) throw new Error(body?.error ?? "Failed to load this place's score.");
  return body as CityExploreData;
}

/**
 * Compare Data — reuses the same left-column pieces from the results page
 * (CityHeader + SectionColumn) side by side, up to 6 at a time, with no map.
 * Reached via the "+" next to a place's name on the results page, which
 * pre-loads that place as the first column here.
 */
function CompareContent() {
  const params = useSearchParams();
  const [columns, setColumns] = useState<ColumnState[]>([]);
  // Reconstructs the results-page URL for whichever place was pre-loaded
  // here (this page's own query params are exactly that place's), so "Back"
  // returns to the actual map/research view rather than the generic
  // Explore landing search page.
  const backHref = `/explore/results?${params.toString()}`;

  useEffect(() => {
    const initialCity = paramsToCity(params);
    if (!initialCity) return;
    setColumns([{ data: null, loading: true, error: null }]);
    fetchScore(initialCity)
      .then((data) => setColumns([{ data, loading: false, error: null }]))
      .catch((err) => setColumns([{ data: null, loading: false, error: err.message ?? "Failed to load." }]));
    // Only meant to seed the initial column once, from whatever the URL had
    // on first load — not on every params identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addCity(city: CitySearchResult) {
    // Capture the exact slot index synchronously (rather than searching for
    // "whichever slot is loading" later) so adding several places quickly in
    // a row can't resolve into the wrong column.
    let insertedIndex = -1;
    setColumns((cur) => {
      insertedIndex = cur.length;
      return [...cur, { data: null, loading: true, error: null }];
    });

    fetchScore(city)
      .then((data) => {
        setColumns((cur) => cur.map((slot, i) => (i === insertedIndex ? { data, loading: false, error: null } : slot)));
      })
      .catch((err) => {
        setColumns((cur) =>
          cur.map((slot, i) =>
            i === insertedIndex ? { data: null, loading: false, error: err.message ?? "Failed to load." } : slot
          )
        );
      });
  }

  function removeColumn(index: number) {
    setColumns((cur) => cur.filter((_, i) => i !== index));
  }

  return (
    <main className="h-screen flex flex-col">
      <NavBar logoSide="left" />

      <div className="px-6 pt-4 pb-3 flex items-end justify-between border-b border-surface-border">
        <div>
          <Link href={backHref} className="text-xs text-ink-500 hover:text-ink-900">
            ← Back to Explore
          </Link>
          <h1 className="font-serif text-2xl text-ink-900 mt-1">Compare Data</h1>
        </div>
        <p className="text-xs text-ink-500 pb-1">
          {columns.length} / {MAX_COLUMNS} places
        </p>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-6">
        <div className="flex gap-4 h-full items-start w-max">
          {columns.map((slot, i) => (
            <div key={i} className="w-[300px] flex-shrink-0 h-full">
              <div className="relative bg-surface rounded-card shadow-card overflow-y-auto h-full">
                <button
                  onClick={() => removeColumn(i)}
                  aria-label="Remove from comparison"
                  className="absolute top-3 right-3 z-20 text-ink-400 hover:text-ink-900"
                >
                  <CloseIcon className="w-4 h-4" />
                </button>
                {slot.loading && <p className="px-4 py-6 text-sm text-ink-500">Loading…</p>}
                {slot.error && <p className="px-4 py-6 pr-8 text-sm text-score-weak">{slot.error}</p>}
                {slot.data && (
                  <>
                    <CityHeader
                      cityName={slot.data.cityName}
                      country={slot.data.country}
                      piltriScore={slot.data.piltriScore}
                      demographics={slot.data.demographics}
                    />
                    <SectionColumn data={slot.data} />
                  </>
                )}
              </div>
            </div>
          ))}

          {columns.length < MAX_COLUMNS && (
            <div className="w-[300px] flex-shrink-0 h-full">
              <div className="bg-surface-muted border border-dashed border-surface-border rounded-card px-4 py-6 h-full">
                <p className="text-[11px] uppercase tracking-wide text-ink-500 mb-2">Add a place to compare</p>
                <SearchBar variant="compact" placeholder="Search for a place…" onSelectCity={addCity} />
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareContent />
    </Suspense>
  );
}
