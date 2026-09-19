import { SECTION_ICONS } from "@/components/ui/icons";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { SectionDetail } from "./SectionDetail";
import { SECTION_LABELS, type CityExploreData, type SectionKey } from "@/lib/types";

interface SectionDetailPanelProps {
  section: SectionKey;
  data: CityExploreData;
}

/** Separate floating card that appears to the right of the main results
 *  column when a section is expanded. The main column (CityHeader + the 5
 *  section rows) never changes size at all — this is a distinct panel that
 *  simply appears/disappears next to it, rather than the main column
 *  growing. Trade-off accepted deliberately: only one section's detail can
 *  show at a time, since there's only one of these panels.
 *
 *  Structured the same way as the main column (an outer top-4/bottom-4
 *  bounding box with flex-col, and the actual visible card inside sized
 *  with flex-shrink) so it only takes up as much height as its own content
 *  needs — matching the main column's height instead of stretching to fill
 *  the full available height, which read as noticeably taller/bigger. */
export function SectionDetailPanel({ section, data }: SectionDetailPanelProps) {
  const Icon = SECTION_ICONS[section];
  return (
    <div className="absolute top-4 left-[344px] bottom-4 flex flex-col w-[320px]">
      <div className="bg-surface/95 backdrop-blur rounded-card shadow-card overflow-y-auto flex-shrink">
        <div className="px-4 py-3 flex items-center gap-2.5 border-b border-surface-border sticky top-0 bg-surface/95 backdrop-blur">
          <Icon className="w-4 h-4 text-ink-700 flex-shrink-0" />
          <span className="text-sm font-medium text-ink-900 flex-1 truncate">{SECTION_LABELS[section]}</span>
          <ScoreBadge score={data.sectionScores[section]} size="sm" />
        </div>
        <SectionDetail section={section} data={data} bordered={false} />
      </div>
    </div>
  );
}
