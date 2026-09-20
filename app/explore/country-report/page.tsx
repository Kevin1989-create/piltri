"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  criteriaByCategory,
  formatCriterionValue,
  type CategoryKey,
} from "@/lib/advancedSearch/criteria";
import { SECTION_LABELS, type CriterionValue, type SectionKey, type SectionScores } from "@/lib/types";

const ORDER: SectionKey[] = ["safetyStability", "economy", "climate", "liveability"];
// Piltri Score (Overall) and each section's own "X score" criterion are
// already shown at the top of the page (the big number + the 5 section
// scores below it) - skipped here so they don't also show up a second time
// as a KPI row further down.
const SKIP_CATEGORIES: CategoryKey[] = ["overall"];

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Country-scope counterpart to /explore/report — opens in a new tab from
 *  an Advanced search country result card, same "view first, download if
 *  you want it" pattern (see report/page.tsx). Shows every criterion in the
 *  registry (allValues), not just whichever ones the search happened to
 *  filter on, grouped into the same categories Advanced search itself uses
 *  — grouped roll-ups across tracked cities rather than an authoritative
 *  national statistic (see AdvancedSearchCountryResult's doc comment in
 *  lib/types.ts). Nearby & distance criteria are the one exception: they're
 *  simply absent unless this particular search actually used a Nearby
 *  filter (computing them otherwise would mean fetching pin data for every
 *  city just for this page, undoing the search-speed work elsewhere). All
 *  of this page's data is carried in via the URL rather than re-fetched,
 *  since the result card already has everything it needs. */
function CountryReportContent() {
  const params = useSearchParams();
  const country = params.get("country") ?? "";
  const countryCode = params.get("countryCode") ?? "";
  const citiesTracked = Number(params.get("citiesTracked") ?? "0");
  const piltriScore = Number(params.get("piltriScore") ?? "0");
  const sectionScores = safeParse<SectionScores | null>(params.get("sectionScores"), null);
  const allValues = safeParse<Record<string, CriterionValue>>(params.get("allValues"), {});
  const categories = criteriaByCategory();

  if (!country || !sectionScores) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 text-center">
        <p className="text-ink-500">No country selected.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface-muted print:bg-white">
      <div className="print:hidden sticky top-0 z-10 bg-surface border-b border-surface-border px-6 py-3 flex items-center justify-between">
        <Link href="/explore" className="text-xs text-ink-500 hover:text-ink-900">
          ← Back to Explore
        </Link>
        <button
          onClick={() => window.print()}
          className="text-xs px-3 py-1.5 rounded-pill border border-piltri-amber text-piltri-amber-dark hover:bg-piltri-amber hover:text-white transition-colors"
        >
          Download as PDF
        </button>
      </div>

      <div className="max-w-[720px] mx-auto px-4 sm:px-8 py-10 print:px-0 print:py-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 pb-4 border-b border-surface-border">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-500">Piltri score report — country</p>
            <h1 className="font-serif text-2xl sm:text-3xl text-ink-900 mt-1">{country}</h1>
            <p className="text-sm text-ink-500 mt-0.5">{countryCode}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <span className="font-serif text-3xl sm:text-4xl text-piltri-amber tabular-nums">{Math.round(piltriScore)}</span>
            <p className="text-[11px] text-ink-500">Piltri score</p>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-ink-500">
          Based on {citiesTracked} tracked {citiesTracked === 1 ? "city" : "cities"} in our shortlist — every figure below
          is a roll-up (mean for scores, "found in at least one" for Yes/No fields) across those cities, not an
          authoritative national statistic.
        </p>

        <section className="mt-8">
          <h2 className="text-xs uppercase tracking-wide text-ink-500 mb-2">Section scores</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6 gap-y-4 text-sm">
            {ORDER.map((section) => (
              <div key={section} className="min-w-0">
                <p className="font-serif text-2xl text-piltri-amber tabular-nums">{Math.round(sectionScores[section])}</p>
                <p className="text-[11px] text-ink-500 leading-snug">{SECTION_LABELS[section]}</p>
              </div>
            ))}
          </div>
        </section>

        {CATEGORY_ORDER.filter((category) => !SKIP_CATEGORIES.includes(category)).map((category) => {
          // Each category's own "X score" criterion is already shown in the
          // Section scores block above; Nearby criteria are absent from
          // allValues entirely (not just empty) when this particular search
          // never fetched pin data - see the doc comment on
          // AdvancedSearchCountryResult.allValues in lib/types.ts.
          const rows = categories[category].filter((def) => !def.key.endsWith(".sectionScore") && def.key in allValues);
          if (rows.length === 0) return null;
          return (
            <section key={category} className="mt-8 break-inside-avoid">
              <h2 className="text-xs uppercase tracking-wide text-ink-500 mb-2">{CATEGORY_LABELS[category]}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6 gap-y-3 text-sm">
                {rows.map((def) => (
                  <div key={def.key} className="min-w-0">
                    <p className="font-medium text-ink-900 leading-snug">{formatCriterionValue(def, allValues[def.key])}</p>
                    <p className="text-[11px] text-ink-500 leading-snug">{def.label}</p>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        <section className="mt-8 break-inside-avoid opacity-60">
          <div className="flex items-baseline justify-between border-b border-surface-border pb-1.5">
            <h2 className="text-sm font-medium text-ink-900">Real Estate</h2>
            <span className="text-[10px] uppercase tracking-wide text-ink-500 bg-surface-muted rounded-pill px-2 py-1">Coming soon</span>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            No reliable free, global real-estate pricing source exists yet — this section will return once one is wired in.
          </p>
        </section>

        <p className="mt-10 pt-4 border-t border-surface-border text-[11px] text-ink-300">
          Generated by Piltri. Country-scope figures are a roll-up of tracked cities, not a separate national data
          source — see the disclosure above.
        </p>
      </div>
    </main>
  );
}

export default function CountryReportPage() {
  return (
    <Suspense fallback={null}>
      <CountryReportContent />
    </Suspense>
  );
}
