"use client";

import { useRef } from "react";
import { ClimateChart } from "@/components/explore/ClimateChart";
import { KpiInfoButton, type KpiInfoHandle } from "@/components/explore/KpiInfo";
import { cn } from "@/lib/cn";
import { buildKpiRows, noSectionDataNote, splitKpiRowsByTier, type KpiRow } from "@/lib/kpiRows";
import { useUnitPreferences } from "@/lib/unitPreferences";
import type { CityExploreData, SectionKey } from "@/lib/types";

/** Value over label, both shown in full (wrapping if they must). The small
 *  "i" sits at the same spot in every cell, top right, so they line up
 *  down each column; it explains the metric - definition, colour guide and
 *  source - on hover, and tapping anywhere on the cell opens it on a phone. */
function StatCell({ row }: { row: KpiRow }) {
  const info = useRef<KpiInfoHandle>(null);
  return (
    <div data-kpi-cell className="min-w-0 flex items-start gap-1.5 cursor-default" onClick={() => info.current?.toggle()}>
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-medium leading-tight break-words", row.colorClass ?? "text-ink-900")}>
          {row.value}
          {/* The space lets a long suffix drop to its own line whole. */}
          {row.valueSuffix && (
            <>
              {" "}
              <span className="text-[10px] font-normal whitespace-nowrap">{row.valueSuffix}</span>
            </>
          )}
        </p>
        <p className="text-[10px] text-ink-500 leading-tight break-words">{row.label}</p>
      </div>
      <KpiInfoButton ref={info} row={row} className="mt-px" />
    </div>
  );
}

/** Two per line, so every label and value fits in full. */
function StatGrid({ rows }: { rows: KpiRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {rows.map((row) => (
        <StatCell key={row.label} row={row} />
      ))}
    </div>
  );
}

/** A section's KPIs as a grid of small stat cells, two per line, split
 *  into this city's own values, then its country's (from
 *  each row's precision tier). A tier with no rows isn't rendered.
 *  `bordered` adds the top divider used when this sits inline under its
 *  SectionRow (Compare page). */
export function SectionDetail({
  section,
  data,
  bordered = true,
}: {
  section: SectionKey;
  data: CityExploreData;
  bordered?: boolean;
}) {
  const { prefs } = useUnitPreferences();
  const { countryRows, cityRows } = splitKpiRowsByTier(buildKpiRows(section, data, prefs));
  const hasCountry = countryRows.length > 0;
  const hasCity = cityRows.length > 0;
  const noDataNote = noSectionDataNote(section, data);

  return (
    <div className={cn("bg-piltri-amber-tint/40 px-4 py-2.5", bordered && "border-t border-piltri-amber/20")}>
      {noDataNote && <p className="text-[11px] leading-snug text-ink-500 mb-2">{noDataNote}</p>}
      {hasCity && (
        <div>
          <p className="font-serif font-semibold text-xs text-black leading-tight mb-1">{data.cityName}</p>
          <StatGrid rows={cityRows} />
          {section === "climate" && data.climate.monthly && (
            <div className="mt-3 mx-auto max-w-[280px]">
              <ClimateChart monthly={data.climate.monthly} />
            </div>
          )}
        </div>
      )}

      {hasCountry && (
        <div className={cn(hasCity && "mt-2 pt-1.5 border-t border-piltri-amber/20")}>
          <p className="font-serif font-semibold text-xs text-black leading-tight mb-1">{data.country}</p>
          <StatGrid rows={countryRows} />
        </div>
      )}
    </div>
  );
}
