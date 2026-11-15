"use client";

import { cn } from "@/lib/cn";
import { ChevronDown, IconResources } from "@/components/ui/icons";

interface ResourcesRowProps {
  isOpen: boolean;
  onToggle: () => void;
}

/** The header of the open Resources list (opened from the button beside
 *  the place's name since 2026-11-15) - the same look as a SectionRow
 *  (icon + name + chevron) but with no badge: Resources isn't scored.
 *  Tapping it closes the list. */
export function ResourcesRow({ isOpen, onToggle }: ResourcesRowProps) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={isOpen}
      className={cn(
        "flex items-center gap-2.5 w-full text-left transition-colors border-t border-surface-border first:border-t-0 scroll-mt-4",
        "px-4 py-2 [@media(max-height:820px)]:py-1.5",
        isOpen ? "bg-piltri-amber-light/40" : "hover:bg-surface-muted"
      )}
    >
      <IconResources className="w-4 h-4 text-ink-700 flex-shrink-0" />
      <span className="text-sm text-ink-900 flex-1 truncate">Resources</span>
      <ChevronDown className={cn("w-3.5 h-3.5 text-ink-500 transition-transform flex-shrink-0", isOpen && "rotate-180")} />
    </button>
  );
}
