import { cn } from "@/lib/cn";
import { scoreBand } from "@/lib/design-tokens";

interface ScoreBadgeProps {
  score: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const bandClasses = {
  strong: "text-score-strong bg-score-strong/10",
  moderate: "text-score-moderate bg-score-moderate/10",
  weak: "text-score-weak bg-score-weak/10",
} as const;

/** Colour-coded score pill: green (strong) / amber (moderate) / red (weaker). */
export function ScoreBadge({ score, size = "md", className }: ScoreBadgeProps) {
  const band = scoreBand(score);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-pill font-semibold tabular-nums",
        bandClasses[band],
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-3 py-1 text-sm",
        size === "lg" && "px-4 py-1.5 text-lg",
        className
      )}
    >
      {Math.round(score)}
    </span>
  );
}

/** Amber Piltri score used at the top of the results left column (0-100).
 *  text-2xl rather than text-3xl — CityHeader as a whole was asked to be
 *  more compact, to leave more visible room for the section list below it
 *  in the same scrollable panel. */
export function PiltriScoreDisplay({ score }: { score: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-serif text-2xl text-piltri-amber tabular-nums">
        {Math.round(score)}
      </span>
    </div>
  );
}
