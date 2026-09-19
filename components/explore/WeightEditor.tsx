"use client";

import { SECTION_LABELS, type SectionKey } from "@/lib/types";

const SECTION_KEYS = Object.keys(SECTION_LABELS) as SectionKey[];

interface WeightEditorProps {
  weights: Record<SectionKey, number>;
  onChange: (weights: Record<SectionKey, number>) => void;
}

/** Shared "% weight per section" control — used by the dedicated score
 *  weights page and the quick-edit panel on the results page. Values are
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
 *  The running total is rendered as its own row using the same label /
 *  spacer / value-column layout as each slider row, so the total lands
 *  directly under the individual percentages instead of as a stray line
 *  of text below everything. */
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
    <div>
      <div className="space-y-2.5">
        {SECTION_KEYS.map((key) => (
          <div key={key} className="flex items-center gap-3">
            <label htmlFor={`weight-${key}`} className="text-sm text-ink-700 w-36 flex-shrink-0">
              {SECTION_LABELS[key]}
            </label>
            <input
              id={`weight-${key}`}
              type="range"
              min={0}
              max={100}
              value={weights[key] ?? 0}
              onChange={(e) => setWeight(key, Number(e.target.value))}
              className="flex-1 accent-piltri-amber"
            />
            <span className="text-sm font-medium text-ink-900 w-12 text-right tabular-nums">
              {weights[key] ?? 0}%
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 flex items-center gap-3">
        <span className="text-xs text-ink-500 w-36 flex-shrink-0">
          Total{total < 100 ? " — must reach 100%" : ""}
        </span>
        <span className="flex-1" />
        <span className="text-sm font-medium text-ink-900 w-12 text-right tabular-nums">
          {total}%
        </span>
      </div>
    </div>
  );
}
