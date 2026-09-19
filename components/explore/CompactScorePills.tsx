import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SECTION_LABELS, type CityExploreData } from "@/lib/types";

const ORDER: (keyof CityExploreData["sectionScores"])[] = [
  "safetyStability",
  "economy",
  "realEstate",
  "climate",
  "liveability",
];

/** Compact horizontal pills the section cards collapse to when the pin panel is open. */
export function CompactScorePills({ data }: { data: CityExploreData }) {
  return (
    <div className="flex flex-wrap gap-2 px-4 py-3 bg-surface/90 backdrop-blur rounded-pill absolute bottom-4 left-4">
      {ORDER.map((key) => (
        <div key={key} className="flex items-center gap-1.5 rounded-pill bg-surface border border-surface-border px-2.5 py-1">
          <span className="text-xs text-ink-700">{SECTION_LABELS[key]}</span>
          <ScoreBadge score={data.sectionScores[key]} size="sm" />
        </div>
      ))}
    </div>
  );
}
