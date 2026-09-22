"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { RESOURCE_LINK_CATEGORIES, RESOURCE_LINK_CATEGORY_LABELS, type ResourceLinksByCategory } from "@/lib/types";

/** Expanded Resources detail - fetches this country's curated links
 *  (GET /api/explore/resource-links) itself rather than expecting them on
 *  `data`, since Resources deliberately isn't part of the cached
 *  CityExploreData payload (see lib/types.ts's ResourceLinkCategory doc
 *  comment). Only fetches once actually opened, same as the rest of this
 *  page waits to fetch pin/nearby data until it's needed.
 *
 *  `bordered` mirrors SectionDetail's prop of the same name/purpose: on
 *  when this renders inline under its own row, off when it's the sole
 *  content of the results page's separate floating detail panel. */
export function ResourcesDetail({
  countryCode,
  bordered = true,
  onLinkCountChange,
}: {
  countryCode: string;
  bordered?: boolean;
  onLinkCountChange?: (count: number) => void;
}) {
  const [links, setLinks] = useState<ResourceLinksByCategory | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/explore/resource-links?countryCode=${countryCode}`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        const data = body.links as ResourceLinksByCategory;
        setLinks(data);
        onLinkCountChange?.(RESOURCE_LINK_CATEGORIES.reduce((sum, c) => sum + data[c].length, 0));
      })
      .catch(() => {
        if (!cancelled) setLinks({ home: [], immigration: [], health: [], jobs: [] });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryCode]);

  const totalCount = links ? RESOURCE_LINK_CATEGORIES.reduce((sum, c) => sum + links[c].length, 0) : null;

  return (
    <div className={cn("bg-piltri-amber-tint/40 px-4 py-2.5", bordered && "border-t border-piltri-amber/20")}>
      {links == null && <p className="text-xs text-ink-500">Loading…</p>}

      {links != null && totalCount === 0 && (
        <p className="text-xs text-ink-500">No Resources links have been added for this country yet.</p>
      )}

      {links != null &&
        totalCount !== 0 &&
        RESOURCE_LINK_CATEGORIES.map((category) => {
          const rows = links[category];
          if (rows.length === 0) return null;
          return (
            <div key={category} className="mb-3 last:mb-0">
              <p className="text-[10px] text-ink-500 uppercase tracking-wide mb-1">{RESOURCE_LINK_CATEGORY_LABELS[category]}</p>
              <div className="flex flex-col gap-1">
                {rows.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-piltri-amber-dark hover:underline leading-snug"
                  >
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
