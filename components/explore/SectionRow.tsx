"use client";

import type { MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { ChevronDown, SECTION_ICONS } from "@/components/ui/icons";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SECTION_LABELS, type SectionKey } from "@/lib/types";

interface SectionRowProps {
  sectionKey: SectionKey;
  score: number;
  isOpen: boolean;
  /** True when a *different* section is open — renders this row as a thin,
   *  quiet line (no chevron, smaller text) instead of the full row, so the
   *  other 4 scores stay visible and glanceable without competing for
   *  space with the section that's actually expanded. The icon stays
   *  (2026-09-23, fixing a bug - it used to disappear too, making the
   *  other categories unrecognisable at a glance on mobile, where this
   *  compact state is the normal resting state for 4 of the 5 rows any
   *  time one is open) - just a touch smaller to fit the tighter row.
   *  Still clickable, so tapping a dimmed row switches which section is
   *  open. */
  compact?: boolean;
  /** Receives the click event (not just a plain callback) so the caller can
   *  scroll the clicked button into view via `e.currentTarget` when opening
   *  it - see SectionColumn's `autoScrollOnOpen`. */
  onToggle: (e: MouseEvent<HTMLButtonElement>) => void;
}

/** One row in the vertical section column: icon + name + score + chevron.
 *  Narrower than the old horizontal SectionCard — designed to stack 5-deep
 *  in a floating left column over the map. */
export function SectionRow({ sectionKey, score, isOpen, compact = false, onToggle }: SectionRowProps) {
  const Icon = SECTION_ICONS[sectionKey];
  return (
    <button
      onClick={onToggle}
      aria-expanded={isOpen}
      className={cn(
        "flex items-center gap-2.5 w-full text-left transition-colors border-t border-surface-border first:border-t-0 scroll-mt-4",
        compact ? "px-4 py-1.5" : "px-4 py-2",
        isOpen ? "bg-piltri-amber-light/40" : "hover:bg-surface-muted"
      )}
    >
      <Icon className={cn("text-ink-700 flex-shrink-0", compact ? "w-3.5 h-3.5" : "w-4 h-4")} />
      <span className={cn("text-ink-900 flex-1 truncate", compact ? "text-xs" : "text-sm")}>
        {SECTION_LABELS[sectionKey]}
      </span>
      <ScoreBadge score={score} size="sm" />
      {!compact && (
        <ChevronDown
          className={cn("w-3.5 h-3.5 text-ink-500 transition-transform flex-shrink-0", isOpen && "rotate-180")}
        />
      )}
    </button>
  );
}
