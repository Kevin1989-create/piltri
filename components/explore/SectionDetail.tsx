"use client";

import { cn } from "@/lib/cn";
import { PrecisionCityIcon, PrecisionCountryIcon, PrecisionPinnedIcon } from "@/components/ui/icons";
import {
  PRECISION_LABEL,
  buildCityEconomyTypeRows,
  buildKpiRows,
  buildLiveabilityTransportRows,
  type KpiRow,
  type PrecisionTier,
} from "@/lib/kpiRows";
import { useUnitPreferences } from "@/lib/unitPreferences";
import type { CityExploreData, SectionKey } from "@/lib/types";

const PRECISION_ICON = {
  country: PrecisionCountryIcon,
  city: PrecisionCityIcon,
  pinned: PrecisionPinnedIcon,
} as const;

/** Small, neutral (uncoloured) glyph disclosing how precisely a stat is
 *  actually known — see lib/kpiRows.ts PrecisionTier. Sits at the right
 *  edge of the cell rather than glued to the value, so icons line up in a
 *  clean vertical column per grid column regardless of how long each
 *  value's text is (a "72 / 100" next to a "Yes" used to leave icons
 *  scattered when they sat immediately after the value). */
function PrecisionMark({ tier }: { tier: PrecisionTier }) {
  const Icon = PRECISION_ICON[tier];
  return (
    <span className="inline-flex flex-shrink-0" title={PRECISION_LABEL[tier]}>
      <Icon className="w-3 h-3 text-ink-300" />
    </span>
  );
}

function StatCell({ row, bold = false }: { row: KpiRow; bold?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-1.5">
        <p className={cn("text-xs leading-tight", bold ? "font-semibold" : "font-medium", row.colorClass ?? "text-ink-900")}>
          {row.value}
        </p>
        <PrecisionMark tier={row.precision} />
      </div>
      <p className="text-[10px] text-ink-500 leading-tight" title={row.hint}>
        {row.label}
      </p>
    </div>
  );
}

function SubBlock({ title, rows, cols }: { title: string; rows: KpiRow[]; cols: 2 | 3 }) {
  return (
    <div className="mt-2 pt-1.5 border-t border-piltri-amber/20">
      <p className="text-[10px] text-ink-500 uppercase tracking-wide mb-1">{title}</p>
      <div className={cn("grid gap-x-3 gap-y-3", cols === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {rows.map((row) => (
          <StatCell key={row.label} row={row} bold />
        ))}
      </div>
    </div>
  );
}

/** Expanded KPI detail for a section. Laid out as a grid of small stat
 *  cards (label under value, same pattern as the demographics grid in
 *  CityHeader) rather than a single tall column of rows, so a KPI-heavy
 *  section like Economy or Liveability never needs its own scrollbar:
 *  width absorbs the row count instead of height. Sections with more than
 *  6 items total get 3 columns instead of 2. Economy and Liveability each
 *  split their extra detail into labeled sub-blocks (Country/City Economy
 *  Type; Transport Access; Notable Institutions) rather than one long flat
 *  list, so a KPI-heavy section reads as a few small groups instead of a
 *  wall of rows.
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
  const cityEconomyTypeRows = section === "economy" ? buildCityEconomyTypeRows(data) : null;
  // Transport Access + Notable Institutions merged into one "Local
  // Signals" sub-block (was 2 separate labeled blocks) - one less header
  // to squeeze the panel's overall height, since this floating panel has
  // to share vertical space with a pinned location's info bar below it.
  const localSignalRows = section === "liveability" ? buildLiveabilityTransportRows(data) : null;
  const totalItems = rows.length + (cityEconomyTypeRows?.length ?? 0) + (localSignalRows?.length ?? 0);
  const cols = totalItems > 6 ? 3 : 2;

  return (
    <div className={cn("bg-piltri-amber-tint/40 px-4 py-2.5", bordered && "border-t border-piltri-amber/20")}>
      <div className={cn("grid gap-x-3 gap-y-3", cols === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {rows.map((row) => (
          <StatCell key={row.label} row={row} />
        ))}
      </div>

      {cityEconomyTypeRows && <SubBlock title="Economy Type" rows={cityEconomyTypeRows} cols={cols} />}
      {localSignalRows && <SubBlock title="Local Signals" rows={localSignalRows} cols={cols} />}
    </div>
  );
}
