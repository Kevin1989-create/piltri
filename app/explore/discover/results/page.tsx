"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { ResultCard, type DisplayResult } from "@/components/explore/ResultCard";
import { DiscoverResultsMap, type MapPoint } from "@/components/explore/DiscoverResultsMap";
import { SECTION_LABELS, type AdvancedSearchResponse, type SectionKey } from "@/lib/types";
import { cn } from "@/lib/cn";

const SECTION_KEYS = Object.keys(SECTION_LABELS) as SectionKey[];
const PAGE_SIZE = 40;

type SortKey = "piltri" | "alpha" | SectionKey;

const SORT_LABELS: Record<SortKey, string> = {
  piltri: "Piltri Score",
  alpha: "Alphabetical",
  economy: "Economy score",
  realEstate: "Real Estate score",
  safetyStability: "Safety & Stability score",
  climate: "Climate score",
  liveability: "Liveability score",
};
const SORT_ORDER: SortKey[] = ["piltri", ...SECTION_KEYS, "alpha"];

/** Turns the raw API response into one flat, scope-agnostic list the grid
 *  and map can both render without caring whether each entry started as a
 *  city or a country. `detailHref` always opens the same kind of "View all
 *  data" report page CityHeader's eye icon uses elsewhere — a country
 *  equivalent (/explore/country-report) since there wasn't one before. */
function buildDisplayResults(response: AdvancedSearchResponse): DisplayResult[] {
  if (response.scope === "city") {
    return (response.cityResults ?? []).map((r) => {
      const qs = new URLSearchParams({
        cityId: r.cityId,
        city: r.cityName,
        region: r.region ?? "",
        country: r.country,
        countryCode: r.countryCode,
        lat: String(r.lat),
        lng: String(r.lng),
      });
      return {
        key: r.cityId,
        name: r.cityName,
        subtitle: [r.region, r.country].filter(Boolean).join(", "),
        piltriScore: r.piltriScore,
        sectionScores: r.sectionScores,
        lat: r.lat,
        lng: r.lng,
        wikiTitle: r.cityName,
        wikiFallbackTitle: `${r.cityName}, ${r.country}`,
        detailHref: `/explore/report?${qs.toString()}`,
      };
    });
  }

  return (response.countryResults ?? []).map((r) => {
    const qs = new URLSearchParams({
      country: r.country,
      countryCode: r.countryCode,
      citiesTracked: String(r.citiesTracked),
      piltriScore: String(r.piltriScore),
      sectionScores: JSON.stringify(r.sectionScores),
      allValues: JSON.stringify(r.allValues),
    });
    return {
      key: r.countryCode,
      name: r.country,
      subtitle: `Based on ${r.citiesTracked} tracked ${r.citiesTracked === 1 ? "city" : "cities"}`,
      piltriScore: r.piltriScore,
      sectionScores: r.sectionScores,
      lat: r.lat,
      lng: r.lng,
      wikiTitle: r.country,
      flagCountryCode: r.countryCode,
      detailHref: `/explore/country-report?${qs.toString()}`,
    };
  });
}

function buildMapPoints(results: DisplayResult[]): MapPoint[] {
  return results.map((r) => ({ key: r.key, lat: r.lat, lng: r.lng, name: r.name, piltriScore: r.piltriScore, detailHref: r.detailHref }));
}

/**
 * Advanced search results — its own page (not inline under the criteria
 * form) so a search's ~50 results get real room: a photo-forward grid with
 * sort/pagination, or a map of every match at once. Re-runs the search
 * itself from the scope/filters/weights carried in the URL (see
 * discover/page.tsx's "Search" button) rather than passing the (potentially
 * large) result set through the URL directly.
 */
function DiscoverResultsContent() {
  const params = useSearchParams();
  const scope = params.get("scope") === "country" ? "country" : "city";
  const backHref = `/explore/discover?${params.toString()}`;

  const [response, setResponse] = useState<AdvancedSearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [sort, setSort] = useState<SortKey>("piltri");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    let filters: unknown[] = [];
    let weights: Record<string, number> | undefined;
    try {
      filters = JSON.parse(params.get("filters") ?? "[]");
    } catch {
      filters = [];
    }
    try {
      const rawWeights = params.get("weights");
      weights = rawWeights ? JSON.parse(rawWeights) : undefined;
    } catch {
      weights = undefined;
    }

    fetch("/api/explore/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, filters, weights }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || body?.error) throw new Error(body?.error ?? "Advanced search failed.");
        if (!cancelled) setResponse(body as AdvancedSearchResponse);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  const allResults = useMemo(() => (response ? buildDisplayResults(response) : []), [response]);

  const sortedResults = useMemo(() => {
    const copy = [...allResults];
    if (sort === "alpha") copy.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "piltri") copy.sort((a, b) => b.piltriScore - a.piltriScore);
    else copy.sort((a, b) => b.sectionScores[sort] - a.sectionScores[sort]);
    return copy;
  }, [allResults, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedResults.length / PAGE_SIZE));
  const pageResults = sortedResults.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const mapPoints = useMemo(() => buildMapPoints(sortedResults), [sortedResults]);

  useEffect(() => {
    setPage(1);
  }, [sort, response]);

  return (
    <main className="min-h-screen flex flex-col">
      <NavBar logoSide="left" border={false} />

      <div className="px-6 pt-4 pb-3 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href={backHref} className="text-xs text-ink-500 hover:text-ink-900 select-none">
            ← Back to Advanced search
          </Link>
          <h1 className="font-serif text-2xl text-ink-900 mt-1 select-none">
            {scope === "city" ? "Matching cities" : "Matching countries"}
          </h1>
          {response && (
            <p className="text-sm text-ink-700 mt-1">
              <span className="font-medium text-ink-900">{response.matchCount}</span>{" "}
              {scope === "city" ? "cities" : "countries"} match, out of {response.checked} checked
              {response.failed > 0 ? ` (${response.failed} couldn't be scored and were skipped)` : ""}.
            </p>
          )}
        </div>

        {response && response.matchCount > 0 && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-pill border border-surface-border bg-surface px-3 py-1.5 text-sm text-ink-900 focus:outline-none focus:border-piltri-amber"
            >
              {SORT_ORDER.map((key) => (
                <option key={key} value={key}>
                  Sort: {SORT_LABELS[key]}
                </option>
              ))}
            </select>
            <div className="flex items-center rounded-pill border border-surface-border overflow-hidden text-xs">
              {(["list", "map"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "px-4 py-1.5 capitalize transition-colors",
                    view === v ? "bg-piltri-amber text-white" : "bg-surface text-ink-500 hover:bg-surface-muted"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 px-6 pb-8">
        {loading && <p className="text-sm text-ink-500 select-none">Loading</p>}

        {error && <p className="text-sm text-score-weak select-none">{error}</p>}

        {response && response.matchCount === 0 && (
          <p className="text-sm text-ink-500 select-none">Nothing matched — try loosening a filter.</p>
        )}

        {!loading && !error && response && response.matchCount > 0 && (
          <>
            {view === "list" ? (
              <>
                {/* Small blocks, left-to-right then top-to-bottom, as many
                 *  columns as fit - a photo-forward grid rather than the
                 *  wide result cards the inline version used to show. */}
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3">
                  {pageResults.map((result) => (
                    <ResultCard key={result.key} result={result} />
                  ))}
                </div>

                {totalPages > 1 && (
                  <div className="mt-6 flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      disabled={page === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1.5 rounded-pill border border-surface-border text-sm text-ink-700 disabled:opacity-40 hover:bg-surface-muted"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-ink-500 px-2">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={page === totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="px-3 py-1.5 rounded-pill border border-surface-border text-sm text-ink-700 disabled:opacity-40 hover:bg-surface-muted"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="h-[70vh] rounded-card overflow-hidden border border-surface-border">
                <DiscoverResultsMap points={mapPoints} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function DiscoverResultsPage() {
  return (
    <Suspense fallback={null}>
      <DiscoverResultsContent />
    </Suspense>
  );
}
