"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "./SectionCard";
import { SectionDetail } from "./SectionDetail";
import type { CityExploreData, SectionKey } from "@/lib/types";

const ORDER: SectionKey[] = ["safetyStability", "economy", "realEstate", "climate", "liveability"];

interface SectionGridProps {
  data: CityExploreData;
  /** Lets the parent know whether a section is expanded, so it can only
   *  allow the results panel to scroll (and shrink the map) once the
   *  extra detail actually needs the room. */
  onExpandedChange?: (isExpanded: boolean) => void;
}

/**
 * Section cards in a horizontal grid. Clicking a card expands its detail
 * below in that section's colour. Only one section open at a time.
 */
export function SectionGrid({ data, onExpandedChange }: SectionGridProps) {
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);

  useEffect(() => {
    onExpandedChange?.(openSection !== null);
  }, [openSection, onExpandedChange]);

  return (
    <div className="px-6 pb-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {ORDER.map((key) => (
          <SectionCard
            key={key}
            sectionKey={key}
            score={data.sectionScores[key]}
            isOpen={openSection === key}
            onToggle={() => setOpenSection((cur) => (cur === key ? null : key))}
          />
        ))}
      </div>
      {openSection && <SectionDetail section={openSection} data={data} />}
    </div>
  );
}
