"use client";

import { useState } from "react";
import type { SVGProps } from "react";
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  type CategoryKey,
  type CriterionDef,
} from "@/lib/advancedSearch/criteria";
import type { AdvancedSearchScope } from "@/lib/types";
import { AdvancedSearchCriterionRow, isFilterActive, type FilterInputValue } from "./AdvancedSearchCriterionRow";
import { ChevronDown } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

interface AdvancedSearchCategoryCardProps {
  category: CategoryKey;
  Icon: (props: SVGProps<SVGSVGElement>) => JSX.Element;
  criteria: CriterionDef[];
  scope: AdvancedSearchScope;
  filters: Record<string, FilterInputValue>;
  onChange: (key: string, next: FilterInputValue | undefined) => void;
  defaultOpen?: boolean;
}

/** One collapsible category card in the Advanced search filter panel — a
 *  section like "Economy" or "Nearby & distance from city centre", holding
 *  every criterion that belongs to it. Collapsed by default (except the
 *  first one) so the full ~45-criterion list doesn't read as an overwhelming
 *  wall of inputs — the active-filter count badge on the header means a
 *  collapsed card still shows at a glance whether it has anything set. */
export function AdvancedSearchCategoryCard({
  category,
  Icon,
  criteria,
  scope,
  filters,
  onChange,
  defaultOpen = false,
}: AdvancedSearchCategoryCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const activeCount = criteria.filter((c) => isFilterActive(filters[c.key])).length;
  const description = CATEGORY_DESCRIPTIONS[category];

  return (
    <div className="rounded-card border border-surface-border bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left select-none hover:bg-surface-muted transition-colors"
      >
        <Icon className="w-4 h-4 text-piltri-amber flex-shrink-0" />
        <span className="flex-1 text-sm font-medium text-ink-900">{CATEGORY_LABELS[category]}</span>
        {activeCount > 0 && (
          <span className="text-[11px] font-medium text-piltri-amber bg-piltri-amber/10 rounded-pill px-2 py-0.5">
            {activeCount} active
          </span>
        )}
        <ChevronDown className={cn("w-4 h-4 text-ink-300 transition-transform flex-shrink-0", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-4 pb-3 border-t border-surface-border">
          {description && <p className="text-xs text-ink-500 pt-3 pb-1">{description}</p>}
          <div className="divide-y divide-surface-border/60">
            {criteria.map((def, index) => (
              <AdvancedSearchCriterionRow
                key={def.key}
                def={def}
                scope={scope}
                value={filters[def.key]}
                onChange={(next) => onChange(def.key, next)}
                primary={index === 0 && (def.key === "overall.piltriScore" || def.key.endsWith(".sectionScore"))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
