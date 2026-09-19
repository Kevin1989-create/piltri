"use client";

import { cn } from "@/lib/cn";
import { ChevronDown } from "@/components/ui/icons";
import { MiniBar } from "@/components/ui/MiniBar";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SECTION_ICONS } from "@/components/ui/icons";
import { SECTION_LABELS, type SectionKey } from "@/lib/types";

interface SectionCardProps {
  sectionKey: SectionKey;
  score: number;
  isOpen: boolean;
  onToggle: () => void;
}

/** One of the 6 horizontal section cards: icon + name + score + mini bar + chevron. */
export function SectionCard({ sectionKey, score, isOpen, onToggle }: SectionCardProps) {
  const Icon = SECTION_ICONS[sectionKey];
  return (
    <button
      onClick={onToggle}
      aria-expanded={isOpen}
      className={cn(
        "flex flex-col gap-2 rounded-card border p-4 text-left transition-colors w-full",
        isOpen
          ? "border-piltri-amber bg-piltri-amber-tint"
          : "border-surface-border bg-surface hover:bg-surface-muted"
      )}
    >
      <div className="flex items-center justify-between">
        <Icon className="w-5 h-5 text-ink-700" />
        <ChevronDown
          className={cn("w-4 h-4 text-ink-500 transition-transform", isOpen && "rotate-180")}
        />
      </div>
      <p className="text-sm font-medium text-ink-900">{SECTION_LABELS[sectionKey]}</p>
      <div className="flex items-center gap-2">
        <ScoreBadge score={score} size="sm" />
      </div>
      <MiniBar score={score} />
    </button>
  );
}
