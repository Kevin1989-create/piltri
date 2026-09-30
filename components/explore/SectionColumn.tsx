"use client";

import { type ReactNode, useEffect, useState } from "react";
import { SectionRow } from "./SectionRow";
import { SectionDetail } from "./SectionDetail";
import { ResourcesRow } from "./ResourcesRow";
import { ResourcesDetail } from "./ResourcesDetail";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { cn } from "@/lib/cn";
import { prefetchResourceLinks } from "@/lib/resourceLinksCache";
import type { CityExploreData, SectionKey } from "@/lib/types";

const ORDER: SectionKey[] = ["safetyStability", "economy", "climate", "liveability"];

/** The 4 scored sections plus Resources (see lib/types.ts's
 *  ResourceLinkCategory doc comment for why Resources isn't part of
 *  SectionKey itself - it isn't scored, so it doesn't belong in the same
 *  union as the 4 that are). */
export type OpenSectionKey = SectionKey | "resources";

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
  onOpenSectionChange?: (key: OpenSectionKey | null) => void;
  /** Inline detail only: while a section is open, this column fills the
   *  height its parent gives it, and the open section scrolls inside its
   *  own box (with a visible bar) while the rows above and below stay put.
   *  The results page uses this on phones (2026-09-30, on request); the
   *  parent has to give the column a height (e.g. as a flex-1 item). */
  fill?: boolean;
}

/** Single-open accordion: only one section can be open at a time (a Set of
 *  open keys used to allow several at once, which is what made this column
 *  tall enough to need scrolling in the first place). Opening a new section
 *  closes whichever one was open. Resources (2026-09-23) is a 5th row after
 *  the 4 scored ones, sharing this same single-open state machine even
 *  though it isn't itself a SectionKey. It no longer needs a link-count
 *  fetch of its own here (see ResourcesRow's doc comment - the badge that
 *  needed this was removed), so this column stays a plain accordion with
 *  no extra data-fetching responsibility beyond opening/closing rows — it
 *  does still kick off `prefetchResourceLinks` as soon as it mounts, purely
 *  so the request is already in flight (or done) by the time a user
 *  actually opens Resources, rather than starting fresh on click. */
export function SectionColumn({ data, externalDetail = false, onOpenSectionChange, fill = false }: SectionColumnProps) {
  const [openKey, setOpenKey] = useState<OpenSectionKey | null>(null);

  useEffect(() => {
    onOpenSectionChange?.(openKey);
  }, [openKey, onOpenSectionChange]);

  useEffect(() => {
    prefetchResourceLinks(data.countryCode);
  }, [data.countryCode]);

  function toggle(key: OpenSectionKey) {
    setOpenKey((cur) => (cur === key ? null : key));
  }

  const filling = fill && !externalDetail && openKey !== null;
  // The open section's detail: in its own scroll box when filling, at
  // least 200px tall (about five lines of figures) - on a short phone the
  // page scrolls a little rather than squeezing it further.
  function detail(content: (className?: string) => ReactNode) {
    if (!filling) return content();
    return (
      <ScrollArea className="flex-1 min-h-[200px] border-t border-piltri-amber/20 motion-safe:animate-fade-in">
        {content("flex-1")}
      </ScrollArea>
    );
  }

  return (
    <div className={cn(filling && "flex-1 flex flex-col")}>
      {ORDER.map((key) => {
        const isOpen = openKey === key;
        const isOtherRow = openKey !== null && !isOpen;
        return (
          <div key={key} className={cn(filling && isOpen && "flex-1 flex flex-col")}>
            <SectionRow
              sectionKey={key}
              score={data.sectionsWithoutData.includes(key) ? null : data.sectionScores[key]}
              isOpen={isOpen}
              compact={!externalDetail && isOtherRow}
              onToggle={() => toggle(key)}
              rank={data.ranks ? { position: data.ranks[key], outOf: data.ranks.outOf } : undefined}
            />
            {!externalDetail &&
              isOpen &&
              detail((className) => <SectionDetail section={key} data={data} bordered={!filling} className={className} />)}
          </div>
        );
      })}
      {(() => {
        const isOpen = openKey === "resources";
        const isOtherRow = openKey !== null && !isOpen;
        return (
          <div className={cn(filling && isOpen && "flex-1 flex flex-col")}>
            <ResourcesRow isOpen={isOpen} compact={!externalDetail && isOtherRow} onToggle={() => toggle("resources")} />
            {!externalDetail &&
              isOpen &&
              detail((className) => (
                <ResourcesDetail countryCode={data.countryCode} bordered={!filling} className={className} />
              ))}
          </div>
        );
      })()}
    </div>
  );
}
