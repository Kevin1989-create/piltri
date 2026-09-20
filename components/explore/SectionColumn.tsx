"use client";

import { useEffect, useState } from "react";
import { SectionRow } from "./SectionRow";
import { SectionDetail } from "./SectionDetail";
import { IconRealEstate } from "@/components/ui/icons";
import type { CityExploreData, SectionKey } from "@/lib/types";

const ORDER: SectionKey[] = ["safetyStability", "economy", "climate", "liveability"];

interface SectionColumnProps {
  data: CityExploreData;
  /** When true, this column never renders a section's detail inline under
   *  its row, and never dims the other rows — the row list stays exactly
   *  the same regardless of what's open. Instead it only reports which
   *  section is open via `onOpenSectionChange`, so the parent can show that
   *  section's detail somewhere else entirely (the results page's separate
   *  floating panel to the right). Compare page leaves this off: each
   *  comparison column has no adjacent space for a second panel, so it
   *  keeps the original inline-detail-with-dimmed-siblings behaviour. */
  externalDetail?: boolean;
  onOpenSectionChange?: (key: SectionKey | null) => void;
  onAnyExpandedChange?: (anyExpanded: boolean) => void;
}

/** Single-open accordion: only one section can be open at a time (a Set of
 *  open keys used to allow several at once, which is what made this column
 *  tall enough to need scrolling in the first place). Opening a new section
 *  closes whichever one was open.
 *
 *  Real Estate isn't part of the scored model (see lib/types.ts's file
 *  header comment — no reliable free global pricing source exists) so it
 *  isn't in ORDER above; it's appended as a plain, non-interactive
 *  "Coming soon" row instead, same visual treatment the home page already
 *  uses for Assess/Invest. */
export function SectionColumn({ data, externalDetail = false, onOpenSectionChange, onAnyExpandedChange }: SectionColumnProps) {
  const [openKey, setOpenKey] = useState<SectionKey | null>(null);

  useEffect(() => {
    onAnyExpandedChange?.(openKey !== null);
    onOpenSectionChange?.(openKey);
  }, [openKey, onAnyExpandedChange, onOpenSectionChange]);

  function toggle(key: SectionKey) {
    setOpenKey((cur) => (cur === key ? null : key));
  }

  return (
    <div>
      {ORDER.map((key) => (
        <div key={key}>
          <SectionRow
            sectionKey={key}
            score={data.sectionScores[key]}
            isOpen={openKey === key}
            compact={!externalDetail && openKey !== null && openKey !== key}
            onToggle={() => toggle(key)}
          />
          {!externalDetail && openKey === key && <SectionDetail section={key} data={data} />}
        </div>
      ))}
      <div className="flex items-center gap-2.5 w-full px-4 py-2.5 border-t border-surface-border opacity-60">
        <IconRealEstate className="w-4 h-4 text-ink-700 flex-shrink-0" />
        <span className="text-sm text-ink-900 flex-1 truncate">Real Estate</span>
        <span className="text-[10px] uppercase tracking-wide text-ink-500 bg-surface-muted rounded-pill px-2 py-1">Coming soon</span>
      </div>
    </div>
  );
}
