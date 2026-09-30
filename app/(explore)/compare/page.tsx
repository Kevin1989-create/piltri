"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { SearchBar } from "@/components/ui/SearchBar";
import { CityHeader } from "@/components/explore/CityHeader";
import { SectionColumn } from "@/components/explore/SectionColumn";
import { CloseIcon } from "@/components/ui/icons";
import { getCityExploreData } from "@/lib/dataset/cities";
import { cityUrl, compareUrl, HOME_URL, readCityRef, type CityRef } from "@/lib/urls";
import type { CityExploreData, CitySearchResult } from "@/lib/types";

const MAX_COLUMNS = 10;

interface ColumnState {
  /** The place's city id once known (it's what the address lists). */
  id: string | null;
  data: CityExploreData | null;
  loading: boolean;
  error: string | null;
}

/** The places in the address: /compare?id=lyon-fr&id=paris-fr, or an older
 *  link's single place (lib/urls.ts). */
function refsFromParams(params: URLSearchParams): CityRef[] {
  const ids = params.getAll("id").filter(Boolean);
  if (ids.length) return ids.slice(0, MAX_COLUMNS).map((id) => readCityRef(new URLSearchParams({ id }))!);
  const legacy = readCityRef(params);
  return legacy ? [legacy] : [];
}

async function fetchScore(ref: Pick<CityRef, "id" | "countryCode" | "lat" | "lng">): Promise<CityExploreData> {
  const data = await getCityExploreData(ref.countryCode, ref.id, ref.lat, ref.lng);
  if (!data) throw new Error("No data for this place.");
  return data;
}

/**
 * Compare Data — reuses the same left-column pieces from the results page
 * (CityHeader + SectionColumn) side by side, up to 10 at a time, with no
 * map. Reached via the "+" next to a place's name on a city page, which
 * pre-loads that place as the first column here. Every place is kept in the
 * address, so a comparison can be reloaded or shared.
 */
function CompareContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [columns, setColumns] = useState<ColumnState[]>([]);
  // The city this page was opened from (its first place), so "Back"
  // returns to that city's page rather than the home page.
  const [originId, setOriginId] = useState<string | null>(null);

  useEffect(() => {
    const refs = refsFromParams(params);
    if (!refs.length) return;
    setOriginId(refs[0].id);
    setColumns(refs.map((ref) => ({ id: ref.id, data: null, loading: true, error: null })));
    refs.forEach((ref, index) => {
      fetchScore(ref)
        .then((data) => setColumns((cur) => cur.map((slot, i) => (i === index ? { id: data.cityId, data, loading: false, error: null } : slot))))
        .catch((err) =>
          setColumns((cur) => cur.map((slot, i) => (i === index ? { ...slot, loading: false, error: err.message ?? "Failed to load." } : slot)))
        );
    });
    // Only meant to seed the columns once, from whatever the URL had on
    // first load — the address then follows the columns (below), not the
    // other way round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps the address listing the places shown (and tidies an older link).
  const idsKey = columns.map((c) => (c.loading ? "…" : c.id ?? "")).join(",");
  useEffect(() => {
    const ids = columns.flatMap((c) => (c.id ? [c.id] : []));
    if (!ids.length || columns.some((c) => c.loading)) return;
    const next = compareUrl(ids);
    if (`${window.location.pathname}${window.location.search}` !== next) router.replace(next, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  function addCity(city: CitySearchResult) {
    // Capture the exact slot index synchronously (rather than searching for
    // "whichever slot is loading" later) so adding several places quickly in
    // a row can't resolve into the wrong column.
    let insertedIndex = -1;
    setColumns((cur) => {
      insertedIndex = cur.length;
      return [...cur, { id: city.cityId, data: null, loading: true, error: null }];
    });

    fetchScore({ id: city.cityId, countryCode: city.countryCode, lat: city.lat, lng: city.lng })
      .then((data) => {
        setColumns((cur) => cur.map((slot, i) => (i === insertedIndex ? { id: data.cityId, data, loading: false, error: null } : slot)));
      })
      .catch((err) => {
        setColumns((cur) =>
          cur.map((slot, i) =>
            i === insertedIndex ? { ...slot, loading: false, error: err.message ?? "Failed to load." } : slot
          )
        );
      });
  }

  function removeColumn(index: number) {
    setColumns((cur) => cur.filter((_, i) => i !== index));
  }

  return (
    <main className="h-dvh flex flex-col">
      <NavBar logoSide="left" />

      <div className="px-6 pt-4 pb-3 flex items-end justify-between border-b border-surface-border">
        <div>
          <Link href={originId ? cityUrl(originId) : HOME_URL} className="text-xs text-ink-500 hover:text-ink-900">
            {originId ? "← Back to results" : "← Back to home"}
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
                      rank={slot.data.ranks ? { position: slot.data.ranks.piltri, outOf: slot.data.ranks.outOf } : undefined}
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
