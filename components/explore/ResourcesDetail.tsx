"use client";

import { useEffect, useState } from "react";
import { ExternalLinkIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { prefetchResourceLinks } from "@/lib/resourceLinksCache";
import { DISPLAYED_RESOURCE_LINK_CATEGORIES, RESOURCE_LINK_CATEGORY_LABELS, type ResourceLink, type ResourceLinksByCategory } from "@/lib/types";

/** "SeLoger - French property search" -> name + description. */
function splitTitle(title: string): { name: string; description: string | null } {
  const [name, ...rest] = title.split(/\s+[-–]\s+/);
  return { name, description: rest.length ? rest.join(" - ") : null };
}

/** The address as people type it: "www.seloger.com", "fr.indeed.com". */
function siteAddress(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname.replace(/\/$/, "") : "");
  } catch {
    return url;
  }
}

/** One site: its name, then its address and what it's for (cut to one
 *  line in the narrow panels, in full on the report). */
function LinkRow({ link, wrap }: { link: ResourceLink; wrap: boolean }) {
  const { name, description } = splitTitle(link.title);
  return (
    <li>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-piltri-amber-tint/70"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-ink-900 leading-tight truncate group-hover:underline underline-offset-2">{name}</span>
          <span className={cn("block text-[10px] text-ink-500 leading-tight", wrap ? "break-words" : "truncate")}>
            <span className="text-piltri-amber-dark">{siteAddress(link.url)}</span>
            {description && ` · ${description}`}
          </span>
        </span>
        <ExternalLinkIcon className="w-3 h-3 flex-shrink-0 text-ink-300 transition-colors group-hover:text-piltri-amber print:hidden" />
      </a>
    </li>
  );
}

/** Resources: each country's hand-curated links, grouped (immigration,
 *  property, jobs), read via `prefetchResourceLinks` rather than fetched
 *  here - they're not part of the cached city data (see lib/types.ts's
 *  ResourceLinkCategory), and callers that mount ahead of time
 *  (SectionColumn) have usually already started the request.
 *
 *  `bordered`: the top divider used inline under its own row (Compare,
 *  mobile). `variant="report"`: plain background, groups side by side -
 *  for the full-data report page. */
export function ResourcesDetail({
  countryCode,
  bordered = true,
  variant = "panel",
}: {
  countryCode: string;
  bordered?: boolean;
  variant?: "panel" | "report";
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

  const categories = links ? DISPLAYED_RESOURCE_LINK_CATEGORIES.filter((c) => links[c].length > 0) : [];
  const report = variant === "report";

  return (
    <div className={cn(!report && "bg-piltri-amber-tint/40 px-4 py-2.5", !report && bordered && "border-t border-piltri-amber/20")}>
      {links == null && <p className="text-xs text-ink-500">Loading…</p>}
      {links != null && categories.length === 0 && <p className="text-xs text-ink-500">No Resources links have been added for this country yet.</p>}
      {categories.length > 0 && (
        <div className={cn(report ? "grid gap-4 sm:grid-cols-3" : "space-y-3")}>
          {categories.map((category) => (
            <section key={category} className="min-w-0 break-inside-avoid">
              <p className="text-[11px] font-semibold text-ink-900 mb-1">{RESOURCE_LINK_CATEGORY_LABELS[category]}</p>
              <ul className={cn("rounded-lg border border-surface-border divide-y divide-surface-border overflow-hidden", !report && "bg-surface/80")}>
                {links![category].map((link) => (
                  <LinkRow key={link.id} link={link} wrap={report} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
