"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PrecisionCityIcon, PrecisionCountryIcon, PrecisionPinnedIcon } from "@/components/ui/icons";
import {
  PRECISION_LABEL,
  buildCityEconomyTypeRows,
  buildKpiRows,
  buildLiveabilityTransportRows,
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
                <h1 className="font-serif text-2xl sm:text-3xl text-ink-900 mt-1">{data.cityName}</h1>
                <p className="text-sm text-ink-500 mt-0.5">
                  {data.region ? `${data.region}, ` : ""}
                  {data.country}
                </p>
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
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6 gap-y-3 text-sm">
                <ReportStat label="Population" value={data.demographics.population.toLocaleString()} precision="city" />
                <ReportStat
                  label="Population density"
                  value={formatDensityPerKm2(data.demographics.populationDensityPerKm2, prefs, (n) => Math.round(n).toLocaleString())}
                  precision="city"
                />
                <ReportStat
                  label="Land area"
                  value={data.demographics.areaKm2 != null ? formatAreaKm2(data.demographics.areaKm2, prefs) : "Not available"}
                  precision="city"
                />
                <ReportStat
                  label="Population trend (5 yr)"
                  value={`${data.demographics.populationTrend5yrPct > 0 ? "+" : ""}${data.demographics.populationTrend5yrPct}%`}
                  precision="country"
                />
                <ReportStat label="Population avg age" value={String(data.demographics.averageAge)} precision="country" />
                <ReportStat label="Main language" value={data.demographics.mostWidelySpokenLanguage} precision="country" />
              </div>
            </section>

            {ORDER.map((section) => {
              const rows = buildKpiRows(section, data, prefs);
              const cityEconomyTypeRows = section === "economy" ? buildCityEconomyTypeRows(data) : null;
              const localSignalRows = section === "liveability" ? buildLiveabilityTransportRows(data) : null;
              return (
                <section key={section} className="mt-8 break-inside-avoid">
                  <div className="flex items-baseline justify-between border-b border-surface-border pb-1.5">
                    <h2 className="text-sm font-medium text-ink-900">{SECTION_LABELS[section]}</h2>
                    <span className="text-sm font-medium text-piltri-amber tabular-nums">
                      {Math.round(data.sectionScores[section])}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 sm:gap-x-6 gap-y-3 text-sm">
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
                  <ReportSubBlock title="Economy Type" rows={cityEconomyTypeRows} />
                  <ReportSubBlock title="Local Signals" rows={localSignalRows} />
                </section>
              );
            })}

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
