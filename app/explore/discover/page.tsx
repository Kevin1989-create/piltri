"use client";

import { Suspense, useEffect, useState } from "react";
import type { SVGProps } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { CompassIcon, IconDemographics, PrecisionCityIcon, PrecisionCountryIcon, PrecisionPinnedIcon, SECTION_ICONS } from "@/components/ui/icons";
import { AdvancedSearchCategoryCard } from "@/components/explore/AdvancedSearchCategoryCard";
import { isFilterActive, type FilterInputValue } from "@/components/explore/AdvancedSearchCriterionRow";
import { getScoreWeights, weightPercentagesToScores } from "@/lib/scoreWeights";
import type { AdvancedSearchCriterionFilter, AdvancedSearchScope } from "@/lib/types";
import { CATEGORY_ORDER, criteriaByCategory, getCriterion, kindForScope, type CategoryKey } from "@/lib/advancedSearch/criteria";
import { cn } from "@/lib/cn";
import { countMatches, prefetchAdvancedSearch } from "@/lib/advancedSearch/engine";

const CATEGORY_ICONS: Record<CategoryKey, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  overall: CompassIcon,
  economy: SECTION_ICONS.economy,
  safetyStability: SECTION_ICONS.safetyStability,
  climate: SECTION_ICONS.climate,
  liveability: SECTION_ICONS.liveability,
  demographics: IconDemographics,
  nearby: PrecisionPinnedIcon,
};

type FiltersState = Record<string, FilterInputValue>;

function buildRequestFilters(scope: AdvancedSearchScope, filters: FiltersState): AdvancedSearchCriterionFilter[] {
  const result: AdvancedSearchCriterionFilter[] = [];
  for (const [key, v] of Object.entries(filters)) {
    if (!isFilterActive(v)) continue;
    const def = getCriterion(key);
    if (!def) continue;
    const kind = kindForScope(def, scope);
    if (kind === "range") {
      const min = v.min !== undefined && v.min !== "" ? Number(v.min) : undefined;
      const max = v.max !== undefined && v.max !== "" ? Number(v.max) : undefined;
      const entry: AdvancedSearchCriterionFilter = { key };
      if (min !== undefined && !Number.isNaN(min)) entry.min = min;
      if (max !== undefined && !Number.isNaN(max)) entry.max = max;
      if (entry.min !== undefined || entry.max !== undefined) result.push(entry);
    } else if (kind === "boolean") {
      if (v.bool !== undefined) result.push({ key, bool: v.bool });
    } else if (v.select) {
      result.push({ key, select: v.select });
    }
  }
  return result;
}

/**
 * Advanced search - every criterion in the app as a filter (see
 * lib/advancedSearch/criteria.ts), over cities or countries. Scope comes
 * first: it changes what a result is. Country results are roll-ups of each
 * country's tracked cities (mean for numbers, "found in at least one" for
 * Yes/No), disclosed on every card via how many cities it tracks.
 */
function DiscoverContent() {
  const router = useRouter();
  const params = useSearchParams();
  // If we arrived here from a city's results page (see discoverHref there),
  // its query params are carried along so "Back" can return to that same
  // city instead of the generic /explore landing page - going back to
  // "somewhere that isn't where you came from" doesn't make sense.
  const originCityName = params.get("city");
  const backHref = originCityName ? `/explore/results?${params.toString()}` : "/explore";
  const backLabel = originCityName ? "← Back to results" : "← Back to Explore";

  const [scope, setScope] = useState<AdvancedSearchScope | null>(null);
  const [filters, setFilters] = useState<FiltersState>({});
  const [navigating, setNavigating] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  const categories = criteriaByCategory();
  // Nearby only makes sense at city scope - "distance from a country's
  // centre" isn't a meaningful question, so the whole category is left out
  // of the list entirely at country scope rather than switching each of its
  // 13 rows to a Yes/No that would just confuse things.
  const visibleCategoryOrder = scope === "country" ? CATEGORY_ORDER.filter((c) => c !== "nearby") : CATEGORY_ORDER;
  // Two genuinely independent columns, not a CSS grid's row-major cells -
  // in a grid, expanding a card in row N pushes every later row down on
  // *both* sides, since row-mates share the same row track regardless of
  // which one actually grew (see the "expand Economy, Real Estate/Climate/
  // Demographics shift down too" report). Splitting into two separate
  // vertically-stacked flex columns means each column's own height is
  // entirely its own business - expanding a card only ever moves the cards
  // below it in that same column, never anything in the other one.
  const leftCategories = visibleCategoryOrder.filter((_, i) => i % 2 === 0);
  const rightCategories = visibleCategoryOrder.filter((_, i) => i % 2 === 1);
  const activeFilterCount = Object.values(filters).filter(isFilterActive).length;

  // Most searches are city searches - start downloading before a scope is
  // even picked, so the count and results are ready by the time they're asked for.
  useEffect(() => prefetchAdvancedSearch("city"), []);

  // Live match count: the search runs in the browser, so every filter
  // change is re-counted over all cities in a few milliseconds (once the
  // data - prefetched as soon as a scope is picked - has arrived).
  useEffect(() => {
    if (!scope) return;
    prefetchAdvancedSearch(scope);
    let cancelled = false;
    const timer = setTimeout(() => {
      countMatches({ scope, filters: buildRequestFilters(scope, filters), weights: weightPercentagesToScores(getScoreWeights()) })
        .then((n) => !cancelled && setMatchCount(n))
        .catch(() => !cancelled && setMatchCount(null));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scope, filters]);

  function handleScopeChange(next: AdvancedSearchScope) {
    if (next === scope) return;
    // Nearby criteria mean something different under each scope (a minutes
    // range vs a Yes/No) — carrying stale filter state across a scope
    // switch would silently misinterpret it, so this is a clean slate.
    setScope(next);
    setFilters({});
    setMatchCount(null);
  }

  function updateFilter(key: string, next: FilterInputValue | undefined) {
    setFilters((prev) => {
      const copy = { ...prev };
      if (next && isFilterActive(next)) copy[key] = next;
      else delete copy[key];
      return copy;
    });
  }

  function resetFilters() {
    setFilters({});
  }

  // Results now live on their own page (list/map, sort, pagination — see
  // discover/results/page.tsx) rather than rendered inline here, so this
  // just hands off scope/filters/weights via the URL and navigates - the
  // actual search request happens on the destination page. Origin params
  // (e.g. `city` from the results page's "Advanced search" link) are
  // carried along unchanged so the results page's own "Back" link can
  // still return to where this page's "Back" link would have.
  function goToResults() {
    if (!scope) return;
    setNavigating(true);
    const qs = new URLSearchParams(params.toString());
    qs.set("scope", scope);
    qs.set("filters", JSON.stringify(buildRequestFilters(scope, filters)));
    qs.set("weights", JSON.stringify(weightPercentagesToScores(getScoreWeights())));
    router.push(`/explore/discover/results?${qs.toString()}`);
  }

  return (
    <main className="min-h-screen flex flex-col">
      <NavBar logoSide="left" border={false} />

      <div className="px-6 pt-4 pb-3">
        <Link href={backHref} className="text-xs text-ink-500 hover:text-ink-900 select-none">
          {backLabel}
        </Link>
        <h1 className="font-serif text-2xl text-ink-900 mt-1 select-none">Advanced search</h1>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
        {/* Scope + actions rail - narrow, on the left, on request. Criteria
         *  used to live in this column too; they've moved into the wider
         *  middle/right area so each card has real room to breathe instead
         *  of a cramped 400px-wide stack. Below `md` there's no room for a
         *  side rail next to the criteria columns, so it becomes its own
         *  full-width block stacked above them instead. */}
        <div className="w-full md:w-[260px] flex-shrink-0 md:overflow-y-auto px-5 py-6 border-b md:border-b-0 border-surface-border">
          <h2 className="text-xs uppercase tracking-wide text-ink-500 mb-3">Scope</h2>
          <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 mb-6">
            {(["city", "country"] as const).map((s) => {
              const Icon = s === "city" ? PrecisionCityIcon : PrecisionCountryIcon;
              const selected = scope === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleScopeChange(s)}
                  className={cn(
                    "flex-1 rounded-card border-2 px-4 py-3 text-left transition-colors",
                    selected ? "border-piltri-amber bg-piltri-amber/5" : "border-surface-border hover:border-ink-300"
                  )}
                >
                  <Icon className={cn("w-5 h-5", selected ? "text-piltri-amber" : "text-ink-300")} />
                  <p className="font-serif text-base text-ink-900 mt-2">{s === "city" ? "Cities" : "Countries"}</p>
                  <p className="text-xs text-ink-500 mt-0.5">
                    {s === "city" ? "Search individual cities from our shortlist." : "Search whole countries, rolled up from the cities we track in each."}
                  </p>
                </button>
              );
            })}
          </div>

          {scope && (
            <div className="flex flex-col gap-2.5">
              <Button onClick={goToResults} disabled={navigating} className="w-full">
                {navigating ? "Opening…" : activeFilterCount > 0 ? `Search (${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"})` : "Search all"}
              </Button>
              <p className="text-xs text-ink-500 text-center tabular-nums min-h-[1rem]" aria-live="polite">
                {matchCount != null && `${matchCount.toLocaleString()} ${scope === "city" ? (matchCount === 1 ? "city" : "cities") : matchCount === 1 ? "country" : "countries"} match`}
              </p>
              <Button variant="ghost" size="sm" onClick={resetFilters} disabled={navigating || activeFilterCount === 0} className="w-full">
                Reset filters
              </Button>
            </div>
          )}
        </div>

        {/* Criteria (middle/right, wide) - results open on their own page
         *  (see discover/results/page.tsx) once "Search" is clicked, rather
         *  than rendering inline here. */}
        <div className="flex-1 md:overflow-y-auto px-6 py-6">
          {!scope ? (
            <p className="text-sm text-ink-500">First choose between Cities or Countries</p>
          ) : (
            <>
              <h2 className="text-xs uppercase tracking-wide text-ink-500 mb-3">Criteria</h2>
              {/* Two independent columns (see leftCategories/rightCategories
               *  above), not a shared grid - each stacks its own cards top
               *  to bottom with zero effect on the other column. */}
              <div className="flex flex-col lg:flex-row gap-3 mb-8 items-start">
                <div className="flex-1 w-full flex flex-col gap-3 min-w-0">
                  {leftCategories.map((category) => (
                    <AdvancedSearchCategoryCard
                      key={category}
                      category={category}
                      Icon={CATEGORY_ICONS[category]}
                      criteria={categories[category]}
                      scope={scope}
                      filters={filters}
                      onChange={updateFilter}
                    />
                  ))}
                </div>
                <div className="flex-1 w-full flex flex-col gap-3 min-w-0">
                  {rightCategories.map((category) => (
                    <AdvancedSearchCategoryCard
                      key={category}
                      category={category}
                      Icon={CATEGORY_ICONS[category]}
                      criteria={categories[category]}
                      scope={scope}
                      filters={filters}
                      onChange={updateFilter}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={null}>
      <DiscoverContent />
    </Suspense>
  );
}
