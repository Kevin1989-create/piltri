"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { placeSummary, type SummaryChip } from "@/lib/placeSummary";
import { useUnitPreferences } from "@/lib/unitPreferences";
import type { CityExploreData } from "@/lib/types";

/** The place in a few plain words, under its name (BACKLOG P1): strengths
 *  in green, things to watch in amber (the "Best for" line went 2026-11-14,
 *  owner: not useful, took space). Each chip's
 *  figure shows on hover, or under the chips on a tap (phones). */
export function PlaceSummaryLine({ data }: { data: CityExploreData }) {
  const { prefs } = useUnitPreferences();
  const summary = useMemo(() => placeSummary(data, prefs), [data, prefs]);
  const [shown, setShown] = useState<SummaryChip | null>(null);
  const { strengths, watchOuts } = summary;
  if (!strengths.length && !watchOuts.length) return null;

  const chip = (c: SummaryChip, tone: "good" | "watch") => (
    <button
      key={c.text}
      type="button"
      title={c.why}
      aria-label={`${c.text}: ${c.why}`}
      aria-pressed={shown === c}
      onClick={() => setShown((s) => (s === c ? null : c))}
      className={cn(
        "rounded-pill px-2 py-0.5 text-[11px] leading-tight font-medium transition-colors",
        tone === "good" ? "bg-[#EAF3EC] text-score-strong hover:bg-[#DCEBDF]" : "bg-piltri-amber-tint text-piltri-amber-dark hover:bg-[#F6E6CF]",
        shown === c && "ring-1 ring-current"
      )}
    >
      {c.text}
    </button>
  );

  return (
    <div className="mt-1">
      {(strengths.length > 0 || watchOuts.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {strengths.map((c) => chip(c, "good"))}
          {watchOuts.map((c) => chip(c, "watch"))}
        </div>
      )}
      {shown && <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{shown.why}</p>}
    </div>
  );
}
