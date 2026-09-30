"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ClimateChart } from "@/components/explore/ClimateChart";
import { KpiInfoButton } from "@/components/explore/KpiInfo";
import { ResourcesDetail } from "@/components/explore/ResourcesDetail";
import { ReportSectionHeading, ReportSubheading } from "@/components/explore/ReportHeadings";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { buildKpiRows, noSectionDataNote, splitKpiRowsByTier, type KpiRow } from "@/lib/kpiRows";
import { computePiltriScore, normaliseWeights } from "@/lib/aggregation/scoring";
import { isCustomWeights, useScoreWeights, weightPercentagesToScores } from "@/lib/scoreWeights";
import { getCityExploreData } from "@/lib/dataset/cities";
import { cityUrl, HOME_URL, readCityRef, reportUrl } from "@/lib/urls";
import { formatUtcOffset } from "@/lib/timezone";
import { formatAreaKm2, formatDensityPerKm2, useUnitPreferences } from "@/lib/unitPreferences";
import { SECTION_LABELS, type CityExploreData, type SectionKey } from "@/lib/types";

const ORDER: SectionKey[] = ["safetyStability", "economy", "climate", "liveability"];

/** Printable, single-page-per-city data report — CityHeader's "View all
 *  data" eye icon opens this in a new tab. It's a plain view first: the
 *  print dialog no longer fires automatically on load (it used to - now
 *  that the link into here is framed as "view", not "download", popping a
 *  print dialog the moment the page opens fought with that). Downloading is
 *  an explicit action instead, via the "Download as PDF" button below,
 *  which still just calls the browser's own print dialog - its "Save as
 *  PDF" destination produces the actual file, rather than a bespoke
 *  server-side PDF pipeline (a real dependency commitment: either a heavy
 *  headless-browser render, or a hand-laid-out PDF library). */
function ReportContent() {
  const params = useSearchParams();
  const router = useRouter();
  // /report?id=lyon-fr, or an older link's parameters (lib/urls.ts).
  const ref = readCityRef(params);
  const refKey = ref ? [ref.countryCode, ref.id, ref.lat, ref.lng].join("|") : "";

  const [data, setData] = useState<CityExploreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { weights } = useScoreWeights();
  const { prefs } = useUnitPreferences();

  useEffect(() => {
    if (!ref) return;
    if (ref.id && !ref.legacy && ref.id === data?.cityId) return;
    setLoading(true);
    setError(null);
    getCityExploreData(ref.countryCode, ref.id, ref.lat, ref.lng)
      .then((result) => {
        if (!result) throw new Error("No data for this place.");
        setData(result);
        setLoading(false);
        // An older link: swap in the short address.
        if (ref.legacy) router.replace(reportUrl(result.cityId), { scroll: false });
      })
      .catch((err) => {
        setError(err.message ?? "Something went wrong loading this city.");
        setLoading(false);
      });
    // refKey stands for `ref`, a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey]);

  if (!ref) {
    return (
      <main className="min-h-dvh flex items-center justify-center px-6 text-center">
        <p className="text-ink-500">No location selected.</p>
      </main>
    );
  }

  const isCustomised = isCustomWeights(weights);
  const displayedScore = data
    ? computePiltriScore(data.sectionScores, normaliseWeights(weightPercentagesToScores(weights)))
    : 0;

  return (
    <main className="min-h-dvh bg-surface-muted print:bg-white">
      {/* Screen-only toolbar — never appears in the printed/saved output. */}
      <div className="print:hidden sticky top-0 z-10 bg-surface border-b border-surface-border px-6 py-3 flex items-center justify-between">
        {/* Opened in a new tab (from a city, or an Advanced search result):
         *  the way back is to the city itself. */}
        <Link href={data ? cityUrl(data.cityId) : HOME_URL} className="text-xs text-ink-500 hover:text-ink-900">
          {data ? `← Back to ${data.cityName}` : "← Back to home"}
        </Link>
        <button
          onClick={() => window.print()}
          className="text-xs px-3 py-1.5 rounded-pill border border-piltri-amber text-piltri-amber-dark hover:bg-piltri-amber hover:text-white transition-colors"
        >
          Download as PDF
        </button>
      </div>

      <div className="max-w-[720px] mx-auto px-4 sm:px-8 py-10 print:px-0 print:py-0">
        {loading && <p className="text-sm text-ink-500">Loading report…</p>}
        {error && <p className="text-sm text-score-weak">Couldn't load this city's data: {error}</p>}

        {data && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 pb-4 border-b border-surface-border">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-500">Piltri score report</p>
                {/* Region/country eyebrow line removed (2026-09-23, on
                 *  request), matching CityHeader.tsx's title - the city
                 *  name is sized up since it's the only line left. */}
                <h1 className="font-serif text-3xl sm:text-4xl text-ink-900 mt-1">{data.cityName}</h1>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="flex items-baseline gap-1.5 justify-end">
                  <span className="font-serif text-3xl sm:text-4xl text-piltri-amber tabular-nums">{Math.round(displayedScore)}</span>
                </div>
                <p className="text-[11px] text-ink-500">Piltri score{isCustomised ? " (custom weighting)" : ""}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
              <span>Generated {new Date().toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
              <span>Data updated {new Date(data.lastUpdated).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
              <span>
                Weighting: {ORDER.map((key) => `${SECTION_LABELS[key]} ${weights[key]}%`).join(" · ")}
              </span>
            </div>

            <section className="mt-8">
              <ReportSectionHeading title="Demographics" />

              <ReportSubheading className="mt-3">{data.cityName}</ReportSubheading>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6 gap-y-3 text-sm">
                <ReportStat
                  label="Population"
                  value={data.demographics.cityPopulation != null ? data.demographics.cityPopulation.toLocaleString() : "Not available"}
                />
                {data.demographics.cityDensityPerKm2 != null && (
                  <ReportStat
                    label="Density (within 5 km)"
                    value={formatDensityPerKm2(data.demographics.cityDensityPerKm2, prefs, (n) => Math.round(n).toLocaleString())}
                  />
                )}
                {data.demographics.timezone && formatUtcOffset(data.demographics.timezone) && (
                  <ReportStat label="Time zone" value={`${formatUtcOffset(data.demographics.timezone)} (${data.demographics.timezone})`} />
                )}
              </div>

              <ReportSubheading className="mt-4">{data.country}</ReportSubheading>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6 gap-y-3 text-sm">
                <ReportStat
                  label="Population"
                  value={data.demographics.countryPopulation != null ? data.demographics.countryPopulation.toLocaleString() : "Not available"}
                />
                <ReportStat
                  label="Population density"
                  value={
                    data.demographics.countryPopulationDensityPerKm2 != null
                      ? formatDensityPerKm2(data.demographics.countryPopulationDensityPerKm2, prefs, (n) => Math.round(n).toLocaleString())
                      : "Not available"
                  }
                />
                <ReportStat
                  label="Land area"
                  value={
                    data.demographics.countryLandAreaKm2 != null ? formatAreaKm2(data.demographics.countryLandAreaKm2, prefs) : "Not available"
                  }
                />
                <ReportStat
                  label="Population growth (5 yrs)"
                  value={
                    data.demographics.countryPopulationTrend5yrPct != null
                      ? `${data.demographics.countryPopulationTrend5yrPct > 0 ? "+" : ""}${data.demographics.countryPopulationTrend5yrPct}%`
                      : "Not available"
                  }
                />
                <ReportStat
                  label="Average age"
                  value={data.demographics.countryAverageAge != null ? String(data.demographics.countryAverageAge) : "Not available"}
                />
                <ReportStat
                  label={data.demographics.countryOfficialLanguages?.length === 1 ? "Official language" : "Official languages"}
                  value={data.demographics.countryOfficialLanguages?.join(", ") || "Not available"}
                />
              </div>
            </section>

            {ORDER.map((section) => {
              // Same rows, in the same order, as the results page.
              const { countryRows, cityRows } = splitKpiRowsByTier(buildKpiRows(section, data, prefs));
              const cityTierHasContent = cityRows.length > 0;
              const noDataNote = noSectionDataNote(section, data);
              return (
                <section key={section} className="mt-8 break-inside-avoid">
                  {/* Colour-coded like the section rows on the city page. */}
                  <ReportSectionHeading title={SECTION_LABELS[section]}>
                    <ScoreBadge score={noDataNote ? null : data.sectionScores[section]} />
                  </ReportSectionHeading>
                  {noDataNote && <p className="mt-2 text-xs text-ink-500">{noDataNote}</p>}
                  {cityTierHasContent && <ReportGroup title={data.cityName} rows={cityRows} spacing="mt-3" />}
                  {section === "climate" && data.climate.monthly && (
                    <div className="mt-4 mx-auto max-w-[300px]">
                      <ClimateChart monthly={data.climate.monthly} />
                    </div>
                  )}
                  <ReportGroup title={data.country} rows={countryRows} spacing={cityTierHasContent ? "mt-4" : "mt-3"} />
                </section>
              );
            })}

            {/* Resources isn't a SectionKey (see lib/types.ts's
             *  ResourceLinkCategory doc comment) - no score badge here,
             *  unlike the 4 sections above, since it isn't scored. */}
            <section className="mt-8 break-inside-avoid">
              <ReportSectionHeading title="Resources" />
              <div className="mt-3">
                <ResourcesDetail countryCode={data.countryCode} variant="report" />
              </div>
            </section>

            <p className="mt-10 pt-4 border-t border-surface-border text-[11px] text-ink-300">
              Generated by Piltri. Scores reflect the weighting shown above and are subject to change as source data updates. Data
              sources and licences: piltri.me/sources.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

/** Country vs City split (2026-09-23, mirrors the Demographics block above
 *  and SectionDetail.tsx's same split) - a section with data at only one
 *  tier (Climate is 100% city, Safety & Stability is 100% country) renders
 *  only that one group. `title` is the actual country/city name (e.g.
 *  "United Kingdom", "London"), not the generic word "Country"/"City",
 *  as a ReportSubheading like Demographics' own. `spacing`
 *  lets the caller give whichever group lands first the tighter "mt-3"
 *  the original single grid used, since an empty group renders nothing
 *  and shouldn't leave a gap in its place. */
function ReportGroup({ title, rows, spacing = "mt-4" }: { title: string; rows: KpiRow[]; spacing?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className={spacing}>
      <ReportSubheading>{title}</ReportSubheading>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6 gap-y-3 text-sm">
        {rows.map((row) => (
          <ReportStat key={row.label} label={row.label} value={row.value} valueSuffix={row.valueSuffix} colorClass={row.colorClass} row={row} />
        ))}
      </div>
    </div>
  );
}

function ReportStat({
  label,
  value,
  valueSuffix,
  colorClass,
  row,
}: {
  label: string;
  value: string;
  valueSuffix?: string;
  colorClass?: string;
  /** A section KPI - adds the info button (screen only, not printed). */
  row?: KpiRow;
}) {
  // The info button sits top right of every cell, so they line up.
  return (
    <div className="min-w-0 flex items-start gap-1.5">
      <div className="min-w-0 flex-1">
        <p className={`font-medium leading-snug break-words ${colorClass ?? "text-ink-900"}`}>
          {value}
          {valueSuffix && (
            <>
              {" "}
              <span className="text-[11px] font-normal whitespace-nowrap">{valueSuffix}</span>
            </>
          )}
        </p>
        <p className="text-[11px] text-ink-500 leading-snug break-words">{label}</p>
      </div>
      {row && <KpiInfoButton row={row} className="mt-1 print:hidden" />}
    </div>
  );
}

export default function ExploreReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportContent />
    </Suspense>
  );
}
