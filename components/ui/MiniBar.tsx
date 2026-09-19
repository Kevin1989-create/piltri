import { scoreColor } from "@/lib/design-tokens";

/** Small horizontal fill bar shown inside a section card. */
export function MiniBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="h-1.5 w-full rounded-pill bg-surface-border overflow-hidden">
      <div
        className="h-full rounded-pill transition-all"
        style={{ width: `${pct}%`, backgroundColor: scoreColor(score) }}
      />
    </div>
  );
}
