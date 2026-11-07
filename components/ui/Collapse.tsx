import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Folds its content away (and back) smoothly - height and opacity
 *  together, at the pace of a section opening (2026-11-07, owner: "super
 *  super smooth" - the rows used to vanish at once). Folded, it takes no
 *  room and can't be tabbed to. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden={!open || undefined}
      className={cn(
        "grid transition-[grid-template-rows,opacity,visibility] duration-[280ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none",
        open ? "visible grid-rows-[1fr] opacity-100" : "invisible grid-rows-[0fr] opacity-0",
        className
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
