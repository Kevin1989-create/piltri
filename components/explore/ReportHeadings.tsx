import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A section's title on the full-data pages (/report and /country):
 *  serif, bold, in the Piltri brown (2026-09-30, on request), with its
 *  score pill, if any, on the right. */
export function ReportSectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-surface-border pb-2">
      <h2 className="font-serif text-xl font-semibold text-piltri-amber">{title}</h2>
      {children}
    </div>
  );
}

/** The place a group of figures is about ("London", "United Kingdom"): the
 *  same black serif in every section, Demographics included. */
export function ReportSubheading({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-serif font-semibold text-sm text-black mb-1.5", className)}>{children}</p>;
}
