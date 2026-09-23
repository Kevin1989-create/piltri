"use client";

import type { MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { ChevronDown, IconResources } from "@/components/ui/icons";

interface ResourcesRowProps {
  isOpen: boolean;
  compact?: boolean;
  /** Receives the click event (not just a plain callback) so the caller can
   *  scroll the clicked button into view via `e.currentTarget` when opening
   *  it - see SectionColumn's `autoScrollOnOpen`. */
  onToggle: (e: MouseEvent<HTMLButtonElement>) => void;
}

/** Same row shell as SectionRow (icon + name + chevron, identical padding)
 *  so Resources sits visually consistent with the 4 scored rows above it -
 *  but with no badge at all (2026-09-23, on request: even a plain neutral
 *  link-count pill still read as score-like sitting in that exact spot) and
 *  a permanent, very light amber-tint background rather than the plain/
 *  hover-only background the 4 scored rows use - the one deliberately
 *  subtle visual cue that this row is a different kind of thing, without
 *  needing a badge to say so. The icon stays when compact (2026-09-23,
 *  matching the same fix on SectionRow) - just a touch smaller. */
export function ResourcesRow({ isOpen, compact = false, onToggle }: ResourcesRowProps) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={isOpen}
      className={cn(
        "flex items-center gap-2.5 w-full text-left transition-colors border-t border-surface-border first:border-t-0 scroll-mt-4",
        compact ? "px-4 py-1.5" : "px-4 py-2",
        isOpen ? "bg-piltri-amber-light/40" : "bg-piltri-amber-tint/50 hover:bg-piltri-amber-tint"
      )}
    >
      <IconResources className={cn("text-ink-700 flex-shrink-0", compact ? "w-3.5 h-3.5" : "w-4 h-4")} />
      <span className={cn("text-ink-900 flex-1 truncate", compact ? "text-xs" : "text-sm")}>Resources</span>
      {!compact && (
        <ChevronDown className={cn("w-3.5 h-3.5 text-ink-500 transition-transform flex-shrink-0", isOpen && "rotate-180")} />
      )}
    </button>
  );
}
