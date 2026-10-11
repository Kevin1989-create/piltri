import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A pill that toggles on and off - filters on Advanced search and
 *  Leaderboards. `hint` is a second, smaller line (e.g. "within 10 km"). */
export function Chip({
  active,
  onClick,
  hint,
  icon,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  hint?: string;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-shrink-0 rounded-pill border px-3 py-1.5 text-xs transition-colors whitespace-nowrap flex items-center gap-1.5",
        active ? "border-piltri-amber bg-piltri-amber text-white" : "border-surface-border bg-surface text-ink-700 hover:border-piltri-amber-light",
        className
      )}
    >
      {icon}
      <span>{children}</span>
      {hint && <span className={cn("text-[10px]", active ? "text-white/80" : "text-ink-300")}>{hint}</span>}
    </button>
  );
}
