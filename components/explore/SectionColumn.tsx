"use client";

import { useEffect, useState } from "react";
import { SectionRow } from "./SectionRow";
import { SectionDetail } from "./SectionDetail";
import { ResourcesRow } from "./ResourcesRow";
import { ResourcesDetail } from "./ResourcesDetail";
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
  onAnyExpandedChange?: (anyExpanded: boolean) => void;
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
export function SectionColumn({ data, externalDetail = false, onOpenSectionChange, onAnyExpandedChange }: SectionColumnProps) {
  const [openKey, setOpenKey] = useState<OpenSectionKey | null>(null);

  useEffect(() => {
    onAnyExpandedChange?.(openKey !== null);
    onOpenSectionChange?.(openKey);
  }, [openKey, onAnyExpandedChange, onOpenSectionChange]);

  useEffect(() => {
    prefetchResourceLinks(data.countryCode);
  }, [data.countryCode]);

  function toggle(key: OpenSectionKey) {
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
      <div>
        <ResourcesRow
          isOpen={openKey === "resources"}
          compact={!externalDetail && openKey !== null && openKey !== "resources"}
          onToggle={() => toggle("resources")}
        />
        {!externalDetail && openKey === "resources" && <ResourcesDetail countryCode={data.countryCode} />}
      </div>
    </div>
  );
}
