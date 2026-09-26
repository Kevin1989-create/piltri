import { normalise } from "@/lib/aggregation/scoring";
import { countScore } from "@/lib/dataset/assemble";

/**
 * How a KPI's value maps to green / amber / red - defined once per row, and
 * used both to colour the value and to write its "colour guide" (the info
 * popover), so the explanation can never drift from what's on screen.
 *
 * Numeric scales go through the same 0-100 normalisation the section scores
 * use, split at 67 and 34: 67+ is good, 34-66 moderate, below 34 poor.
 */

export type Tier = "good" | "moderate" | "poor";

export const TIER_CLASS: Record<Tier, string> = {
  good: "text-score-strong",
  moderate: "text-score-moderate",
  poor: "text-score-weak",
};

export const TIER_LABEL: Record<Tier, string> = { good: "Good", moderate: "Moderate", poor: "Poor" };

export type NumericScale =
  /** More is better, linear between min and max. */
  | { kind: "higher"; min: number; max: number }
  /** Less is better, linear between min and max. */
  | { kind: "lower"; min: number; max: number }
  /** Closest to `ideal` is best; `range` away from it scores 0. */
  | { kind: "ideal"; ideal: number; range: number; floor?: number }
  /** Place counts on a log scale; `cap` scores 100 (see countScore). */
  | { kind: "count"; cap: number }
  /** More is better on a log10 scale (GDP). */
  | { kind: "log"; minLog: number; maxLog: number }
  /** Less is better, with explicit cut-offs (PM2.5, after WHO targets). */
  | { kind: "bands"; goodMax: number; moderateMax: number }
  /** A rank, 1 = best, out of `of`. */
  | { kind: "rank"; of: number }
  /** Already a 0-100 score, higher is better (or lower, with `invert`). */
  | { kind: "score"; invert?: boolean };

export interface LegendLine {
  tier: Tier;
  text: string;
}

function tierFromScore(score: number): Tier {
  if (score >= 67) return "good";
  if (score >= 34) return "moderate";
  return "poor";
}

export function tierOf(scale: NumericScale, value: number): Tier {
  switch (scale.kind) {
    case "higher":
      return tierFromScore(normalise(value, scale.min, scale.max));
    case "lower":
      return tierFromScore(normalise(value, scale.min, scale.max, true));
    case "ideal":
      return tierFromScore(normalise(Math.abs(value - scale.ideal), 0, scale.range, true));
    case "count":
      return tierFromScore(countScore(value, scale.cap));
    case "log":
      return tierFromScore(normalise(Math.log10(Math.max(value, 1)), scale.minLog, scale.maxLog));
    case "bands":
      return value <= scale.goodMax ? "good" : value <= scale.moderateMax ? "moderate" : "poor";
    case "rank":
      return tierFromScore(normalise(value, 1, scale.of, true));
    case "score":
      return tierFromScore(scale.invert ? 100 - value : value);
  }
}

/** The raw values where a 0-100 normalised score crosses 67 and 34 (it
 *  rounds, so the exact crossings are at 66.5 and 33.5). */
const at = (min: number, max: number, pct: number) => min + (pct / 100) * (max - min);

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "10.1 to 20 per 100k" rather than "10.1 per 100k to 20 per 100k": the
 *  unit after the number is written once when both ends share it. */
function span(from: string, to: string): string {
  const a = from.match(/^(\D*?[\d.,]+)(.*)$/);
  const b = to.match(/^(\D*?[\d.,]+)(.*)$/);
  return a && b && a[2] && a[2] === b[2] ? `${a[1]} to ${to}` : `${from} to ${to}`;
}

/** Plain-language cut-offs for each colour, formatted with `fmt` (which
 *  applies the viewer's units - °F, miles, their currency). */
export function legendOf(scale: NumericScale, fmt: (value: number) => string): LegendLine[] {
  const between = (a: number, b: number) => span(fmt(a), fmt(b));
  switch (scale.kind) {
    case "higher": {
      const hi = at(scale.min, scale.max, 66.5);
      const lo = at(scale.min, scale.max, 33.5);
      return [
        { tier: "good", text: `${fmt(hi)} or more` },
        { tier: "moderate", text: between(lo, hi) },
        { tier: "poor", text: `under ${fmt(lo)}` },
      ];
    }
    case "lower": {
      const lo = at(scale.min, scale.max, 33.5);
      const hi = at(scale.min, scale.max, 66.5);
      return [
        { tier: "good", text: `under ${fmt(lo)}` },
        { tier: "moderate", text: between(lo, hi) },
        { tier: "poor", text: `${fmt(hi)} or more` },
      ];
    }
    case "ideal": {
      const { ideal, range, floor = -Infinity } = scale;
      const d1 = 0.335 * range;
      const d2 = 0.665 * range;
      const lowGood = Math.max(floor, ideal - d1);
      const lowModerate = ideal - d2;
      const moderate =
        lowGood > floor
          ? `${between(Math.max(floor, lowModerate), lowGood)}, or ${between(ideal + d1, ideal + d2)}`
          : between(ideal + d1, ideal + d2);
      const poor = lowModerate > floor ? `below ${fmt(lowModerate)} or above ${fmt(ideal + d2)}` : `above ${fmt(ideal + d2)}`;
      return [
        { tier: "good", text: `${between(lowGood, ideal + d1)} (closest to ${fmt(ideal)})` },
        { tier: "moderate", text: moderate },
        { tier: "poor", text: poor },
      ];
    }
    case "count": {
      let good = 0;
      while (countScore(good, scale.cap) < 67) good++;
      let moderate = 0;
      while (countScore(moderate, scale.cap) < 34) moderate++;
      return [
        { tier: "good", text: `${good.toLocaleString()} or more` },
        { tier: "moderate", text: `${moderate.toLocaleString()} to ${(good - 1).toLocaleString()}` },
        { tier: "poor", text: moderate <= 1 ? "none" : `${(moderate - 1).toLocaleString()} or fewer` },
      ];
    }
    case "log": {
      const hi = 10 ** at(scale.minLog, scale.maxLog, 66.5);
      const lo = 10 ** at(scale.minLog, scale.maxLog, 33.5);
      return [
        { tier: "good", text: `${fmt(hi)} or more` },
        { tier: "moderate", text: between(lo, hi) },
        { tier: "poor", text: `under ${fmt(lo)}` },
      ];
    }
    case "bands":
      return [
        { tier: "good", text: `up to ${fmt(scale.goodMax)}` },
        { tier: "moderate", text: between(scale.goodMax, scale.moderateMax) },
        { tier: "poor", text: `above ${fmt(scale.moderateMax)}` },
      ];
    case "rank": {
      // Largest rank still in each tier, found the same way tierOf decides.
      let goodTo = 1;
      while (goodTo < scale.of && tierOf(scale, goodTo + 1) === "good") goodTo++;
      let moderateTo = goodTo;
      while (moderateTo < scale.of && tierOf(scale, moderateTo + 1) !== "poor") moderateTo++;
      return [
        { tier: "good", text: `1st to ${ordinal(goodTo)}` },
        { tier: "moderate", text: `${ordinal(goodTo + 1)} to ${ordinal(moderateTo)}` },
        { tier: "poor", text: `${ordinal(moderateTo + 1)} or lower` },
      ];
    }
    case "score":
      return scale.invert
        ? [
            { tier: "good", text: "0 to 33" },
            { tier: "moderate", text: "34 to 66" },
            { tier: "poor", text: "67 to 100" },
          ]
        : [
            { tier: "good", text: "67 to 100" },
            { tier: "moderate", text: "34 to 66" },
            { tier: "poor", text: "0 to 33" },
          ];
  }
}
