"use client";

import { cn } from "@/lib/cn";
import { ChevronDown, IconResources } from "@/components/ui/icons";

interface ResourcesRowProps {
  isOpen: boolean;
  compact?: boolean;
  /** Total link count across all 4 categories, once loaded - null while
   *  still fetching, so the row doesn't flash "0" before the real count
   *  arrives. */
  linkCount: number | null;
  onToggle: () => void;
}

/** Same row shell as SectionRow (icon + name + badge + chevron, identical
 *  padding/hover states) so Resources sits visually consistent with the 4
 *  scored rows above it - but the "badge" slot is a plain neutral pill
 *  showing the link count, never the green/amber/red ScoreBadge, since
 *  Resources isn't scored and shouldn't look like it is (see
 *  lib/types.ts's ResourceLinkCategory doc comment). */
export function ResourcesRow({ isOpen, compact = false, linkCount, onToggle }: ResourcesRowProps) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={isOpen}
      className={cn(
        "flex items-center gap-2.5 w-full text-left transition-colors border-t border-surface-border first:border-t-0",
        compact ? "px-4 py-1.5" : "px-4 py-2.5",
        isOpen ? "bg-piltri-amber-light/40" : "hover:bg-surface-muted"
      )}
    >
      {!compact && <IconResources className="w-4 h-4 text-ink-700 flex-shrink-0" />}
      <span className={cn("text-ink-900 flex-1 truncate", compact ? "text-xs" : "text-sm")}>Resources</span>
      {linkCount != null && (
        <span className="inline-flex items-center justify-center rounded-pill px-2 py-0.5 text-xs font-medium tabular-nums text-ink-500 bg-ink-100">
          {linkCount}
        </span>
      )}
      {!compact && (
        <ChevronDown className={cn("w-3.5 h-3.5 text-ink-500 transition-transform flex-shrink-0", isOpen && "rotate-180")} />
      )}
    </button>
  );
}
