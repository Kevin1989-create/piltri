"use client";

import { useRef } from "react";
import { ClimateChart } from "@/components/explore/ClimateChart";
import { KpiInfoButton, type KpiInfoHandle } from "@/components/explore/KpiInfo";
import { cn } from "@/lib/cn";
import { buildGdpSectorRows, buildKpiRows, buildLiveabilityTransportRows, noSectionDataNote, splitKpiRowsByTier, type KpiRow } from "@/lib/kpiRows";
import { useUnitPreferences } from "@/lib/unitPreferences";
import type { CityExploreData, SectionKey } from "@/lib/types";

/** Value over label, both shown in full (wrapping if they must). The small
 *  "i" sits at the same spot in every cell, top right, so they line up
 *  down each column; it explains the metric - definition, colour guide and
 *  source - on hover, and tapping anywhere on the cell opens it on a phone. */
function StatCell({ row, bold = false }: { row: KpiRow; bold?: boolean }) {
  const info = useRef<KpiInfoHandle>(null);
  return (
    <div data-kpi-cell className="min-w-0 flex items-start gap-1.5 cursor-default" onClick={() => info.current?.toggle()}>
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs leading-tight break-words", bold ? "font-semibold" : "font-medium", row.colorClass ?? "text-ink-900")}>
          {row.value}
          {row.valueSuffix && <span className="text-[10px] font-normal ml-1 whitespace-nowrap">{row.valueSuffix}</span>}
        </p>
        <p className="text-[10px] text-ink-500 leading-tight break-words">{row.label}</p>
      </div>
      <KpiInfoButton ref={info} row={row} className="mt-px" />
    </div>
  );
}

function StatGrid({ rows, cols, bold = false }: { rows: KpiRow[]; cols: 2 | 3; bold?: boolean }) {
  return (
    <div className={cn("grid gap-x-4 gap-y-3", cols === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {rows.map((row) => (
        <StatCell key={row.label} row={row} bold={bold} />
      ))}
    </div>
  );
}

/** A section's KPIs as a grid of small stat cells (two per line; the GDP
 *  sectors three), split into this city's own values, then its country's (from
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
  const rows = buildKpiRows(section, data, prefs);
  const localSignalRows = section === "liveability" ? buildLiveabilityTransportRows(data) : null;
  // GDP sectors always render as their own row of 3.
  const gdpSectorRows = section === "economy" ? buildGdpSectorRows(data) : null;
  // Two per line, so every label and value fits in full.
  const cols = 2;

  const { countryRows: allCountryRows, cityRows: cityRowsOwn } = splitKpiRowsByTier(rows);
  const cityRows = localSignalRows ? [...cityRowsOwn, ...localSignalRows] : cityRowsOwn;
  // Economy: GDP and GDP rank first (one line), then the sectors, then the rest.
  const countryRows = section === "economy" ? allCountryRows.slice(0, 2) : allCountryRows;
  const countryRowsAfterSectors = section === "economy" ? allCountryRows.slice(2) : [];

  const hasCountry = countryRows.length > 0 || !!gdpSectorRows?.length;
  const hasCity = cityRows.length > 0;
  const noDataNote = noSectionDataNote(section, data);

  return (
    <div className={cn("bg-piltri-amber-tint/40 px-4 py-2.5", bordered && "border-t border-piltri-amber/20")}>
      {noDataNote && <p className="text-[11px] leading-snug text-ink-500 mb-2">{noDataNote}</p>}
      {hasCity && (
        <div>
          <p className="font-serif font-semibold text-xs text-black leading-tight mb-1">{data.cityName}</p>
          <StatGrid rows={cityRows} cols={cols} />
          {section === "climate" && data.climate.monthly && (
            <div className="mt-3">
              <ClimateChart monthly={data.climate.monthly} />
            </div>
          )}
        </div>
      )}

      {hasCountry && (
        <div className={cn(hasCity && "mt-2 pt-1.5 border-t border-piltri-amber/20")}>
          <p className="font-serif font-semibold text-xs text-black leading-tight mb-1">{data.country}</p>
          {countryRows.length > 0 && <StatGrid rows={countryRows} cols={cols} />}
          {!!gdpSectorRows?.length && (
            <div className={cn(countryRows.length > 0 && "mt-3")}>
              <StatGrid rows={gdpSectorRows} cols={3} />
            </div>
          )}
          {countryRowsAfterSectors.length > 0 && (
            <div className="mt-3">
              <StatGrid rows={countryRowsAfterSectors} cols={cols} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
