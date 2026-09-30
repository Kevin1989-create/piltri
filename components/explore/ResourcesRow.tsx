"use client";

import { cn } from "@/lib/cn";
import { ChevronDown, IconResources } from "@/components/ui/icons";

interface ResourcesRowProps {
  isOpen: boolean;
  compact?: boolean;
  onToggle: () => void;
}

/** Same row as SectionRow (icon + name + chevron, identical padding and
 *  backgrounds - the tint it used to have was dropped on request,
 *  2026-09-30) but with no badge at all: even a neutral link-count pill
 *  read as a score in that spot. The icon stays when compact, a touch
 *  smaller. */
export function ResourcesRow({ isOpen, compact = false, onToggle }: ResourcesRowProps) {
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
      <IconResources className={cn("text-ink-700 flex-shrink-0", compact ? "w-3.5 h-3.5" : "w-4 h-4")} />
      <span className={cn("text-ink-900 flex-1 truncate", compact ? "text-xs" : "text-sm")}>Resources</span>
      {!compact && (
        <ChevronDown className={cn("w-3.5 h-3.5 text-ink-500 transition-transform flex-shrink-0", isOpen && "rotate-180")} />
      )}
    </button>
  );
}
