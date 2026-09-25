"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { prefetchResourceLinks } from "@/lib/resourceLinksCache";
import { DISPLAYED_RESOURCE_LINK_CATEGORIES, RESOURCE_LINK_CATEGORY_LABELS, type ResourceLinksByCategory } from "@/lib/types";

/** Expanded Resources detail - reads this country's curated links via
 *  `prefetchResourceLinks` rather than fetching them itself, since Resources
 *  deliberately isn't part of the cached CityExploreData payload (see
 *  lib/types.ts's ResourceLinkCategory doc comment). Callers that mount well
 *  ahead of time (SectionColumn) already kicked the same request off, so
 *  this usually resolves instantly instead of showing "Loading…" on open.
 *
 *  `bordered` mirrors SectionDetail's prop of the same name/purpose: on
 *  when this renders inline under its own row, off when it's the sole
 *  content of the results page's separate floating detail panel. */
export function ResourcesDetail({
  countryCode,
  bordered = true,
}: {
  countryCode: string;
  bordered?: boolean;
}) {
  const [links, setLinks] = useState<ResourceLinksByCategory | null>(null);

  useEffect(() => {
    let cancelled = false;
    prefetchResourceLinks(countryCode).then((data) => {
      if (!cancelled) setLinks(data);
    });
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  const totalCount = links ? DISPLAYED_RESOURCE_LINK_CATEGORIES.reduce((sum, c) => sum + links[c].length, 0) : null;

  return (
    <div className={cn("bg-piltri-amber-tint/40 px-4 py-2.5", bordered && "border-t border-piltri-amber/20")}>
      {links == null && <p className="text-xs text-ink-500">Loading…</p>}

      {links != null && totalCount === 0 && (
        <p className="text-xs text-ink-500">No Resources links have been added for this country yet.</p>
      )}

      {links != null &&
        totalCount !== 0 &&
        DISPLAYED_RESOURCE_LINK_CATEGORIES.map((category) => {
          const rows = links[category];
          if (rows.length === 0) return null;
          return (
            <div key={category} className="mb-3 last:mb-0">
              {/* Bold black section titles / non-bold grey site names
                  (2026-09-26, on request) - was uppercase grey for the
                  title and medium-weight amber for each link; titles now
                  read as the stronger element, links as plain secondary
                  text (still a real link - hover underline kept). */}
              <p className="text-[10px] font-bold text-ink-900 uppercase tracking-wide mb-1">{RESOURCE_LINK_CATEGORY_LABELS[category]}</p>
              <div className="flex flex-col gap-1">
                {rows.map((link) => (
                  <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="text-xs font-normal text-ink-500 hover:underline leading-snug">
                    {link.title}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}
