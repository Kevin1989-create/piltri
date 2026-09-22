"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PrecisionCityIcon, PrecisionCountryIcon, PrecisionPinnedIcon } from "@/components/ui/icons";
import { ResourcesDetail } from "@/components/explore/ResourcesDetail";
import {
  PRECISION_LABEL,
  buildCityEconomyTypeRows,
  buildKpiRows,
  buildLiveabilityTransportRows,
  splitKpiRowsByTier,
  type KpiRow,
  type PrecisionTier,
} from "@/lib/kpiRows";
import { computePiltriScore, normaliseWeights } from "@/lib/aggregation/scoring";
import { isCustomWeights, useScoreWeights, weightPercentagesToScores } from "@/lib/scoreWeights";
import { formatAreaKm2, formatDensityPerKm2, useUnitPreferences } from "@/lib/unitPreferences";
import { SECTION_LABELS, type CityExploreData, type SectionKey } from "@/lib/types";

const ORDER: SectionKey[] = ["safetyStability", "economy", "climate", "liveability"];

const PRECISION_ICON = {
  country: PrecisionCountryIcon,
  city: PrecisionCityIcon,
  pinned: PrecisionPinnedIcon,
} as const;

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
  const cityId = params.get("cityId") ?? "";
  const cityName = params.get("city") ?? "";
  const region = params.get("region") ?? "";
  const country = params.get("country") ?? "";
  const countryCode = params.get("countryCode") ?? "";
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));

  const [data, setData] = useState<CityExploreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { weights } = useScoreWeights();
  const { prefs } = useUnitPreferences();

  useEffect(() => {
    if (!cityName || Number.isNaN(lat) || Number.isNaN(lng)) return;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ cityId, city: cityName, region, country, countryCode, lat: String(lat), lng: String(lng) });
    fetch(`/api/explore/score?${qs.toString()}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok || body?.error) throw new Error(body?.error ?? "Failed to load this city's data.");
        setData(body as CityExploreData);
      })
      .catch((err) => setError(err.message ?? "Something went wrong loading this city."))
      .finally(() => setLoading(false));
  }, [cityId, cityName, region, country, countryCode, lat, lng]);

  if (Number.isNaN(lat) || Number.isNaN(lng) || !cityName) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 text-center">
        <p className="text-ink-500">No location selected.</p>
      </main>
    );
  }

  const isCustomised = isCustomWeights(weights);
  const displayedScore = data
    ? computePiltriScore(data.sectionScores, normaliseWeights(weightPercentagesToScores(weights)))
    : 0;

  return (
    <main className="min-h-screen bg-surface-muted print:bg-white">
      {/* Screen-only toolbar — never appears in the printed/saved output. */}
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
        {loading && <p className="text-sm text-ink-500">Loading report…</p>}
        {error && <p className="text-sm text-score-weak">Couldn't load this city's data: {error}</p>}

        {data && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 pb-4 border-b border-surface-border">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-500">Piltri score report</p>
                {/* Country before City, matching the order of the two
                 *  Demographics groups below and CityHeader.tsx's title.
                 *  Colour signals UI level (title vs. group header), not
                 *  country-vs-city tier - see CityHeader.tsx's comment. */}
                <p className="text-xs uppercase tracking-wide text-ink-900 font-medium mt-1">
                  {data.region ? `${data.region}, ` : ""}
                  {data.country}
                </p>
                <h1 className="font-serif text-2xl sm:text-3xl text-ink-900 mt-0.5">{data.cityName}</h1>
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
              <h2 className="text-xs uppercase tracking-wide text-ink-500 mb-2">Demographics</h2>

              {/* Country and City are two genuinely separate data tiers
               *  (see lib/types.ts's DemographicsFields comment) - shown
               *  as two clearly labelled groups, same as CityHeader.tsx,
               *  rather than blended into one set of stats. */}
              <p className="font-serif text-base text-piltri-amber-dark mb-1.5">{data.country}</p>
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
                  label="Population trend (5 yr)"
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
                <ReportStat label="Main language" value={data.demographics.countryMostWidelySpokenLanguage ?? "Not available"} />
              </div>

              <p className="font-serif text-base text-piltri-amber-dark mb-1.5 mt-4">{data.cityName}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6 gap-y-3 text-sm">
                <ReportStat
                  label="Population"
                  value={data.demographics.cityPopulation != null ? data.demographics.cityPopulation.toLocaleString() : "Not available"}
                />
                <ReportStat
                  label="Land area"
                  value={data.demographics.cityAreaKm2 != null ? formatAreaKm2(data.demographics.cityAreaKm2, prefs) : "Not available"}
                />
                <ReportStat
                  label="Population density"
                  value={
                    data.demographics.cityPopulationDensityPerKm2 != null
                      ? formatDensityPerKm2(data.demographics.cityPopulationDensityPerKm2, prefs, (n) => Math.round(n).toLocaleString())
                      : "Not available"
                  }
                />
              </div>
            </section>

            {ORDER.map((section) => {
              const rows = buildKpiRows(section, data, prefs);
              const cityEconomyTypeRows = section === "economy" ? buildCityEconomyTypeRows(data) : null;
              const localSignalRows = section === "liveability" ? buildLiveabilityTransportRows(data) : null;
              const { countryRows, cityRows } = splitKpiRowsByTier(rows);
              const countryFirst = countryRows.length > 0;
              return (
                <section key={section} className="mt-8 break-inside-avoid">
                  <div className="flex items-baseline justify-between border-b border-surface-border pb-1.5">
                    <h2 className="text-sm font-medium text-ink-900">{SECTION_LABELS[section]}</h2>
                    <span className="text-sm font-medium text-piltri-amber tabular-nums">
                      {Math.round(data.sectionScores[section])}
                    </span>
                  </div>
                  <ReportGroup title={data.country} rows={countryRows} spacing={countryFirst ? "mt-3" : "mt-4"} />
                  <ReportGroup title={data.cityName} rows={cityRows} spacing={countryFirst ? "mt-4" : "mt-3"} />
                  <ReportSubBlock title="Economy Type" rows={cityEconomyTypeRows} />
                  <ReportSubBlock title="Local Signals" rows={localSignalRows} />
                </section>
              );
            })}

            {/* Resources isn't a SectionKey (see lib/types.ts's
             *  ResourceLinkCategory doc comment) - no score badge here,
             *  unlike the 4 sections above, since it isn't scored. */}
            <section className="mt-8 break-inside-avoid">
              <div className="flex items-baseline justify-between border-b border-surface-border pb-1.5">
                <h2 className="text-sm font-medium text-ink-900">Resources</h2>
              </div>
              <div className="mt-3 -mx-4 sm:-mx-6">
                <ResourcesDetail countryCode={data.countryCode} bordered={false} />
              </div>
            </section>

            <p className="mt-10 pt-4 border-t border-surface-border text-[11px] text-ink-300">
              Generated by Piltri. Scores reflect the weighting shown above and are subject to change as source data updates.
              <span className="block mt-1">
                Icons mark data precision — country outline: country-wide figure. Skyline: city-specific. Pin: computed from
                this city's exact location.
              </span>
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
 *  "United Kingdom", "London"), not the generic word "Country"/"City" -
 *  styled the same serif-amber way as the Demographics headings above,
 *  just one size down. `spacing` lets the caller give whichever group
 *  lands first the tighter "mt-3" the original single grid used, since an
 *  empty group renders nothing and shouldn't leave a gap in its place. */
function ReportGroup({ title, rows, spacing = "mt-4" }: { title: string; rows: KpiRow[]; spacing?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className={spacing}>
      <p className="font-serif text-sm text-piltri-amber-dark mb-1.5">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6 gap-y-3 text-sm">
        {rows.map((row) => (
          <ReportStat
            key={row.label}
            label={row.label}
            value={row.value}
            precision={row.precision}
            colorClass={row.colorClass}
            hint={row.hint}
          />
        ))}
      </div>
    </div>
  );
}

function ReportSubBlock({ title, rows }: { title: string; rows: KpiRow[] | null }) {
  if (!rows) return null;
  return (
    <div className="mt-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-500 mb-2">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6 gap-y-3 text-sm">
        {rows.map((row) => (
          <ReportStat
            key={row.label}
            label={row.label}
            value={row.value}
            precision={row.precision}
            colorClass={row.colorClass}
            hint={row.hint}
          />
        ))}
      </div>
    </div>
  );
}

function ReportStat({
  label,
  value,
  precision,
  colorClass,
  hint,
}: {
  label: string;
  value: string;
  precision?: PrecisionTier;
  colorClass?: string;
  hint?: string;
}) {
  const Icon = precision ? PRECISION_ICON[precision] : null;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-1.5">
        <p className={`font-medium leading-snug ${colorClass ?? "text-ink-900"}`}>{value}</p>
        {Icon && (
          <span className="inline-flex flex-shrink-0" title={PRECISION_LABEL[precision as PrecisionTier]}>
            <Icon className="w-2.5 h-2.5 text-ink-300" />
          </span>
        )}
      </div>
      <p className="text-[11px] text-ink-500 leading-snug" title={hint}>
        {label}
      </p>
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
