"use client";

import { cn } from "@/lib/cn";
import { buildGdpSectorRows, buildKpiRows, buildLiveabilityTransportRows, splitKpiRowsByTier, type KpiRow } from "@/lib/kpiRows";
import { useUnitPreferences } from "@/lib/unitPreferences";
import type { CityExploreData, SectionKey } from "@/lib/types";

function StatCell({ row, bold = false }: { row: KpiRow; bold?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={cn("text-xs leading-tight", bold ? "font-semibold" : "font-medium", row.colorClass ?? "text-ink-900")}>
        {row.value}
        {row.valueSuffix && <span className="text-[10px] font-normal ml-1">{row.valueSuffix}</span>}
      </p>
      <p className="text-[10px] text-ink-500 leading-tight" title={row.hint}>
        {row.label}
      </p>
    </div>
  );
}

function StatGrid({ rows, cols, bold = false }: { rows: KpiRow[]; cols: 2 | 3; bold?: boolean }) {
  return (
    <div className={cn("grid gap-x-3 gap-y-3", cols === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {rows.map((row) => (
        <StatCell key={row.label} row={row} bold={bold} />
      ))}
    </div>
  );
}

/** Expanded KPI detail for a section. Laid out as a grid of small stat
 *  cards (label under value, same pattern as the demographics grid in
 *  CityHeader) rather than a single tall column of rows, so a KPI-heavy
 *  section like Economy or Liveability never needs its own scrollbar:
 *  width absorbs the row count instead of height. Sections with more than
 *  6 items total get 3 columns instead of 2.
 *
 *  Split into Country vs City groups (2026-09-23, mirrors CityHeader's
 *  Demographics split) using each row's precision tier - see
 *  lib/kpiRows.ts's splitKpiRowsByTier. City renders before Country
 *  (2026-09-23, on request) to match CityHeader's own City-before-Country
 *  order. A section with data at only one tier (Climate is 100%
 *  city/pinned, Safety & Stability is 100% country) renders only that one
 *  group, never a padded-out empty other one. Liveability's "Local
 *  Signals" is genuinely city-tier (pinned to this city's exact
 *  coordinates), so it nests inside the City group as a labeled sub-block
 *  rather than sitting beside it - Economy's single city-tier row ("Main
 *  economy type") used to get the same treatment under an "Economy Type"
 *  heading, but that extra heading for one row read as confusing
 *  (2026-09-24, on request), so it's now just a plain row in the City
 *  group's main grid instead. Each group is headed by the actual
 *  country/city name (not the generic word "Country"/"City"), serif like
 *  CityHeader's Demographics block - but plain black and bold here
 *  (2026-09-23, on request), not the darker amber CityHeader itself
 *  settled on, since these smaller per-section panels don't have a
 *  separate amber-vs-black title of their own for the amber to contrast
 *  against.
 *
 *  `bordered` controls the top divider: on (default) when this renders
 *  inline directly under its own SectionRow (Compare page); off when it's
 *  the sole content of a standalone panel that already has its own header
 *  and card edge (the results page's separate detail panel). */
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
  // Transport Access + Notable Institutions merged into one "Local
  // Signals" sub-block (was 2 separate labeled blocks) - one less header
  // to squeeze the panel's overall height, since this floating panel has
  // to share vertical space with a pinned location's info bar below it.
  const localSignalRows = section === "liveability" ? buildLiveabilityTransportRows(data) : null;
  // GDP sector ranking ("1st/2nd/3rd GDP sector") is split out of the main
  // row list and always rendered at a fixed 3 columns (below), not the
  // shared `cols` this grid picks for everything else - see
  // buildGdpSectorRows's own comment for why.
  const gdpSectorRows = section === "economy" ? buildGdpSectorRows(data) : null;
  const totalItems = rows.length + (localSignalRows?.length ?? 0);
  const cols = totalItems > 6 ? 3 : 2;

  const { countryRows: allCountryRows, cityRows } = splitKpiRowsByTier(rows);
  // Economy's Country group interleaves GDP sector ranking as its own line
  // right after GDP/GDP world rank/Economic growth (2026-09-25, on request
  // - "second line the 3 GDP sector") rather than always trailing every
  // other country row, so the first 3 rows (built in that exact order by
  // buildKpiRows) and the remainder split around it.
  const countryRows = section === "economy" ? allCountryRows.slice(0, 3) : allCountryRows;
  const countryRowsAfterSectors = section === "economy" ? allCountryRows.slice(3) : [];
  const cityExtraBlocks = [localSignalRows && { title: "Local Signals", rows: localSignalRows }].filter(
    (b): b is { title: string; rows: KpiRow[] } => !!b
  );

  const hasCountry = countryRows.length > 0 || !!gdpSectorRows?.length;
  const hasCity = cityRows.length > 0 || cityExtraBlocks.length > 0;

  return (
    <div className={cn("bg-piltri-amber-tint/40 px-4 py-2.5", bordered && "border-t border-piltri-amber/20")}>
      {hasCity && (
        <div>
          <p className="font-serif font-semibold text-xs text-black leading-tight mb-1">{data.cityName}</p>
          {cityRows.length > 0 && <StatGrid rows={cityRows} cols={cols} />}
          {cityExtraBlocks.map((block, i) => (
            <div key={block.title} className={cn((i > 0 || cityRows.length > 0) && "mt-2 pt-1.5 border-t border-piltri-amber/20")}>
              <p className="text-[10px] text-ink-500 uppercase tracking-wide mb-1">{block.title}</p>
              <StatGrid rows={block.rows} cols={cols} bold />
            </div>
          ))}
        </div>
      )}

      {hasCountry && (
        <div className={cn(hasCity && "mt-2 pt-1.5 border-t border-piltri-amber/20")}>
          <p className="font-serif font-semibold text-xs text-black leading-tight mb-1">{data.country}</p>
          {countryRows.length > 0 && <StatGrid rows={countryRows} cols={cols} />}
          {!!gdpSectorRows?.length && (
            // mt-3, not mt-2 (2026-09-24, on request - the main grid's own
            // row-to-row gap is gap-y-3 (12px); mt-2 (8px) made this block
            // sit visibly closer to the row above it than rows within the
            // grid sit to each other).
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
