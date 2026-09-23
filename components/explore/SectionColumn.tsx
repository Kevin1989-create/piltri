"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
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
  /** Scrolls the row just opened to the top of the viewport, and scrolls
   *  the whole page back to the top when the last open row closes
   *  (2026-09-23, on request - closing should return to exactly the
   *  "nothing expanded" layout the page started at, not leave it wherever
   *  the scroll happened to land) - mobile results only, where this
   *  column's inline detail is the only place a section's data ever
   *  shows, so opening a row several rows down otherwise leaves its
   *  newly-revealed content mostly or entirely below the fold. Left off
   *  by default: Compare page's columns sit side by side, and
   *  auto-scrolling the whole page from one column's click would fight
   *  whatever the other columns are showing. */
  autoScrollOnOpen?: boolean;
  /** Removes the other 4 rows entirely (not just dims them to a thin
   *  "compact" line - see SectionRow's `compact` prop) while one is open
   *  (2026-09-23, on request, alongside CityHeader's Demographics blocks
   *  disappearing in results/page.tsx - the same "only show what's
   *  actually relevant right now" idea applied to this column's own
   *  rows). Mobile results only, same reasoning as `autoScrollOnOpen`:
   *  Compare page's columns need their compact siblings to stay
   *  glanceable since there's no separate place their scores show. */
  hideOthersOnOpen?: boolean;
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
export function SectionColumn({
  data,
  externalDetail = false,
  onOpenSectionChange,
  autoScrollOnOpen = false,
  hideOthersOnOpen = false,
}: SectionColumnProps) {
  const [openKey, setOpenKey] = useState<OpenSectionKey | null>(null);
  // The button that triggered the most recent toggle - only read when a
  // section just opened (see the scroll effect below), so a plain ref
  // rather than state is fine here; it doesn't need to trigger a render.
  const lastToggledRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    onOpenSectionChange?.(openKey);
  }, [openKey, onOpenSectionChange]);

  useEffect(() => {
    prefetchResourceLinks(data.countryCode);
  }, [data.countryCode]);

  // Runs after the open/close state has committed, so the on-screen layout
  // already reflects it (a section's detail added or removed, CityHeader
  // shown/hidden on mobile results - see results/page.tsx) before
  // scrolling. No artificial delay needed here (there used to be one, to
  // ride out a CSS transition on the map that no longer exists - see
  // MapView's ResizeObserver comment for why that got removed): nothing
  // left in this layout animates, so the DOM already reflects its final
  // position by the time this effect runs.
  //
  // Opening a row scrolls it to the top of the viewport. Closing the last
  // open one - back to nothing expanded - scrolls the whole page back to
  // the top instead, on request: this returns the page to the exact
  // "nothing open" layout it started at, rather than leaving it wherever
  // the scroll happened to land while a section was open.
  useEffect(() => {
    if (!autoScrollOnOpen) return;
    if (openKey) {
      lastToggledRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [openKey, autoScrollOnOpen]);

  function toggle(key: OpenSectionKey, e: MouseEvent<HTMLButtonElement>) {
    lastToggledRef.current = e.currentTarget;
    setOpenKey((cur) => (cur === key ? null : key));
  }

  return (
    <div>
      {ORDER.map((key) => {
        const isOpen = openKey === key;
        const isOtherRow = openKey !== null && !isOpen;
        if (isOtherRow && hideOthersOnOpen) return null;
        return (
          <div key={key}>
            <SectionRow
              sectionKey={key}
              score={data.sectionScores[key]}
              isOpen={isOpen}
              compact={!externalDetail && isOtherRow}
              onToggle={(e) => toggle(key, e)}
            />
            {!externalDetail && isOpen && <SectionDetail section={key} data={data} />}
          </div>
        );
      })}
      {(() => {
        const isOpen = openKey === "resources";
        const isOtherRow = openKey !== null && !isOpen;
        if (isOtherRow && hideOthersOnOpen) return null;
        return (
          <div>
            <ResourcesRow isOpen={isOpen} compact={!externalDetail && isOtherRow} onToggle={(e) => toggle("resources", e)} />
            {!externalDetail && isOpen && <ResourcesDetail countryCode={data.countryCode} />}
          </div>
        );
      })()}
    </div>
  );
}
