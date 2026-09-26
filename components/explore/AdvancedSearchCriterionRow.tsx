"use client";

import { kindForScope, labelForScope, rangeForScope, type CriterionDef } from "@/lib/advancedSearch/criteria";
import type { AdvancedSearchScope } from "@/lib/types";
import { cn } from "@/lib/cn";

export interface FilterInputValue {
  min?: string;
  max?: string;
  bool?: boolean;
  select?: string;
}

interface AdvancedSearchCriterionRowProps {
  def: CriterionDef;
  scope: AdvancedSearchScope;
  value: FilterInputValue | undefined;
  onChange: (next: FilterInputValue | undefined) => void;
  /** Bolds the label — used for a category's first row when it's the
   *  section's overall score (Piltri Score for Overall, or e.g. "Economy
   *  score" for Economy), so the one figure that rolls everything else up
   *  reads as the header stat it effectively is. */
  primary?: boolean;
}

/** True if this filter input currently carries any real constraint — used
 *  to decide whether to keep or drop it from the request payload / active
 *  filter count. */
function isActive(v: FilterInputValue | undefined): boolean {
  if (!v) return false;
  return v.min !== undefined && v.min !== "" || v.max !== undefined && v.max !== "" || v.bool !== undefined || (v.select !== undefined && v.select !== "");
}

/** Clamps a typed value into [lo, hi] on blur - the `min`/`max` attributes
 *  below already stop the native spinner arrows from going past the range,
 *  but a value typed directly (or pasted) bypasses the spinner entirely, so
 *  this catches that case too rather than silently accepting an out-of-
 *  range number. */
function clampToRange(raw: string, range: [number, number] | undefined): string {
  if (raw === "" || !range) return raw;
  const n = Number(raw);
  if (Number.isNaN(n)) return raw;
  const [lo, hi] = range;
  return String(Math.min(hi, Math.max(lo, n)));
}

/** One criterion's filter control — a min/max pair for "range", a 3-way
 *  Any/Yes/No pill for "boolean", or a small dropdown for "select". Which
 *  kind renders is decided per-scope (kindForScope): the "distance from city
 *  centre" fields are a minutes range at city scope but Yes/No at country scope,
 *  since "distance from a country's centre" isn't a meaningful question. */
export function AdvancedSearchCriterionRow({ def, scope, value, onChange, primary = false }: AdvancedSearchCriterionRowProps) {
  const kind = kindForScope(def, scope);
  const label = labelForScope(def, scope);
  const active = isActive(value);
  // rangeForScope resolves the country-scope override (e.g. Population's
  // wider countrySuggestedRange) when one exists, falling back to
  // suggestedRange otherwise.
  const range = rangeForScope(def, scope);
  // The `min`/`max` HTML attributes (not just placeholders) below are the
  // actual fix: with them set, the native spinner arrows simply stop doing
  // anything once they reach the bound instead of continuing past it (or,
  // per the report, wrapping oddly) - "nothing happens" when you click the
  // up arrow at the ceiling is the native, expected behaviour once these
  // are in place.
  const [lo, hi] = range ?? [-Infinity, Infinity];

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label className={cn("text-sm text-ink-700 flex-1 min-w-0", primary && "font-semibold text-ink-900")}>
        {label}
        {def.unit && kind === "range" && <span className="text-ink-300 text-xs ml-1.5">({def.unit})</span>}
        {active && <span className="inline-block w-1.5 h-1.5 rounded-full bg-piltri-amber ml-2 align-middle" />}
      </label>

      {kind === "range" && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <input
            type="number"
            min={range ? lo : undefined}
            max={range ? hi : undefined}
            placeholder={range ? undefined : "Min"}
            // Pre-filled with the criterion's real floor (not just shown as a
            // placeholder) so the native spinner's "current value" starts
            // exactly at the bound - clicking down steps to lo-1... i.e. lo+1
            // below it (99 from 100-max fields etc), clicking up at the
            // floor does nothing. Until the user actually moves it, this
            // stays undefined in state, so it isn't sent as an active filter.
            value={value?.min ?? (range ? String(lo) : "")}
            onChange={(e) => onChange({ ...value, min: e.target.value })}
            onBlur={(e) => onChange({ ...value, min: clampToRange(e.target.value, range) })}
            className="w-24 rounded-pill border border-surface-border bg-surface px-3 py-1.5 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-piltri-amber"
          />
          {/* Plain "to" instead of a dash/en-dash - a dash between two
           *  numbers reads as a minus sign at a glance ("looks like minus"),
           *  easy to misread as a single negative value rather than a
           *  min-max range separator. */}
          <span className="text-ink-300 text-xs">to</span>
          <input
            type="number"
            min={range ? lo : undefined}
            max={range ? hi : undefined}
            placeholder={range ? undefined : "Max"}
            // Same idea at the ceiling: pre-filled with hi (e.g. 100) so the
            // up arrow has nothing left to do, and down steps to 99.
            value={value?.max ?? (range ? String(hi) : "")}
            onChange={(e) => onChange({ ...value, max: e.target.value })}
            onBlur={(e) => onChange({ ...value, max: clampToRange(e.target.value, range) })}
            className="w-24 rounded-pill border border-surface-border bg-surface px-3 py-1.5 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-piltri-amber"
          />
        </div>
      )}

      {kind === "boolean" && (
        <div className="flex items-center rounded-pill border border-surface-border overflow-hidden flex-shrink-0 text-xs">
          {(["any", "yes", "no"] as const).map((opt) => {
            const selected = opt === "any" ? value?.bool === undefined : opt === "yes" ? value?.bool === true : value?.bool === false;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(opt === "any" ? { ...value, bool: undefined } : { ...value, bool: opt === "yes" })}
                className={cn(
                  "px-3 py-1.5 capitalize transition-colors",
                  selected ? "bg-piltri-amber text-white" : "bg-surface text-ink-500 hover:bg-surface-muted"
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {/* Pill buttons instead of a native <select> dropdown - same
       *  click-to-toggle pattern as the "boolean" Any/Yes/No group above,
       *  so picking a value doesn't drop into an OS-styled list control
       *  that looks and behaves like it belongs in a different app. */}
      {kind === "select" && (
        <div className="flex items-center rounded-pill border border-surface-border overflow-hidden flex-shrink-0 text-xs">
          {["Any", ...(def.selectOptions ?? [])].map((opt) => {
            const selected = opt === "Any" ? !value?.select : value?.select === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(opt === "Any" ? { ...value, select: undefined } : { ...value, select: opt })}
                className={cn(
                  "px-3 py-1.5 transition-colors",
                  selected ? "bg-piltri-amber text-white" : "bg-surface text-ink-500 hover:bg-surface-muted"
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { isActive as isFilterActive };
