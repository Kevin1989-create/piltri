import { IconResources } from "@/components/ui/icons";
import { ResourcesDetail } from "./ResourcesDetail";

interface ResourcesDetailPanelProps {
  countryCode: string;
}

/** Same floating side panel as SectionDetailPanel (identical positioning/
 *  sizing), for the Resources row specifically - kept separate rather
 *  than generalising SectionDetailPanel to accept Resources, since that
 *  component is built entirely around SectionKey (score badge, KPI rows)
 *  and Resources has neither. No score badge in the header here - see
 *  ResourcesRow's doc comment for why that matters. */
export function ResourcesDetailPanel({ countryCode }: ResourcesDetailPanelProps) {
  return (
    <div className="absolute top-4 left-[344px] bottom-4 flex flex-col w-[320px]">
      <div className="bg-surface/95 backdrop-blur rounded-card shadow-card overflow-y-auto flex-shrink">
        <div className="px-4 py-3 flex items-center gap-2.5 border-b border-surface-border sticky top-0 bg-surface/95 backdrop-blur">
          <IconResources className="w-4 h-4 text-ink-700 flex-shrink-0" />
          <span className="text-sm font-medium text-ink-900 flex-1 truncate">Resources</span>
        </div>
        <ResourcesDetail countryCode={countryCode} bordered={false} />
      </div>
    </div>
  );
}
