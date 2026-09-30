"use client";

import { SettingRow } from "@/components/explore/SettingsLayout";
import { cn } from "@/lib/cn";
import { SECTION_LABELS, type SectionKey } from "@/lib/types";

const SECTION_KEYS = Object.keys(SECTION_LABELS) as SectionKey[];

interface WeightEditorProps {
  weights: Record<SectionKey, number>;
  onChange: (weights: Record<SectionKey, number>) => void;
}

/** "% weight per section" control on /score-settings, as rows of a
 *  SettingsSection (plus a Total row). Values are
 *  whole percentages that can't add up to more than 100.
 *
 *  Each `<input>`'s `max` attribute is deliberately kept fixed at 100, not
 *  shrunk to "whatever's left" — an earlier version set max dynamically,
 *  which meant a section already near its budget rendered with a track
 *  that was ALSO short, so the thumb looked already maxed-out even when
 *  the value was well under 100. That made it look like the slider was
 *  stuck rather than like there just wasn't budget left. With a fixed 0-100
 *  track, every slider always shows the true 0-100 range, and the actual
 *  constraint is enforced by clamping the stored value in `setWeight` —
 *  dragging past the available budget just stops increasing the number,
 *  which reads clearly as "no room left" rather than "broken".
 *
 *  The running total is its own row with the same value column as each
 *  slider row, so it lands directly under the individual percentages. */
export function WeightEditor({ weights, onChange }: WeightEditorProps) {
  const total = SECTION_KEYS.reduce((sum, key) => sum + (weights[key] ?? 0), 0);

  function maxFor(key: SectionKey): number {
    const otherTotal = total - (weights[key] ?? 0);
    return Math.max(0, 100 - otherTotal);
  }

  function setWeight(key: SectionKey, value: number) {
    const clamped = Math.min(value, maxFor(key));
    onChange({ ...weights, [key]: clamped });
  }

  return (
    <>
      {SECTION_KEYS.map((key) => (
        <SettingRow key={key} label={SECTION_LABELS[key]} htmlFor={`weight-${key}`} labelWidth="w-28 sm:w-36">
          <input
            id={`weight-${key}`}
            type="range"
            min={0}
            max={100}
            value={weights[key] ?? 0}
            onChange={(e) => setWeight(key, Number(e.target.value))}
            className="flex-1 min-w-0 accent-piltri-amber"
          />
          <span className="text-sm font-medium text-ink-900 w-12 text-right tabular-nums">{weights[key] ?? 0}%</span>
        </SettingRow>
      ))}
      <div className="flex items-center gap-4 py-3">
        <span className={cn("flex-1 text-xs", total < 100 ? "text-score-weak" : "text-ink-500")}>
          Total{total < 100 ? " - must reach 100%" : ""}
        </span>
        <span className="text-sm font-medium text-ink-900 w-12 text-right tabular-nums">{total}%</span>
      </div>
    </>
  );
}
