"use client";

import type { MouseEvent } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/** Every close / remove cross on the site, one size (2026-11-10, owner:
 *  "all crosses are too small"; a step bigger on 2026-11-11, "can still be
 *  bigger"): a 20 px cross, a little heavier, in a 40 px round tap area
 *  that lights up under the finger or pointer. In a tight row, pass
 *  negative margins in className so the row keeps its height. */
export function CloseButton({
  label,
  onClick,
  className,
  large,
}: {
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  /** A sheet's or panel's own close: 44 px, a 24 px cross. */
  large?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 active:bg-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-piltri-amber",
        large ? "h-11 w-11" : "h-10 w-10",
        className
      )}
    >
      <CloseIcon className={large ? "h-6 w-6" : "h-5 w-5"} strokeWidth={2} />
    </button>
  );
}
