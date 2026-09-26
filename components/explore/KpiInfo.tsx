"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TIER_LABEL, type Tier } from "@/lib/colorScales";
import { cn } from "@/lib/cn";
import type { KpiRow } from "@/lib/kpiRows";

const DOT: Record<Tier, string> = {
  good: "bg-score-strong",
  moderate: "bg-score-moderate",
  poor: "bg-score-weak",
};

const WIDTH = 288;
const GAP = 6;

export interface KpiInfoHandle {
  toggle: () => void;
}

/** The small "i" next to a KPI label. Hover (or keyboard focus) shows a
 *  popover with the full value, what the metric means, how its colours are
 *  decided and where the data comes from; a click or tap pins it open
 *  (phones have no hover), and a tap anywhere else or Escape closes it.
 *  Rendered into document.body so scrolling panels can't clip it. */
export const KpiInfoButton = forwardRef<KpiInfoHandle, { row: KpiRow; className?: string }>(function KpiInfoButton({ row, className }, ref) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = hovering || pinned;

  const toggle = useCallback(() => setPinned((p) => !p), []);
  useImperativeHandle(ref, () => ({ toggle }), [toggle]);

  // Hover in and out with a short grace period, so the pointer can travel
  // from the button into the popover without it closing.
  const hover = (on: boolean) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovering(on), on ? 80 : 150);
  };
  useEffect(() => () => void (hoverTimer.current && clearTimeout(hoverTimer.current)), []);

  // Place below the button, or above when there isn't room; keep on screen.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setPosition(null);
      return;
    }
    const b = buttonRef.current.getBoundingClientRect();
    const height = popoverRef.current?.offsetHeight ?? 220;
    const below = b.bottom + GAP;
    const top = below + height > window.innerHeight - 8 && b.top - GAP - height > 8 ? b.top - GAP - height : below;
    const left = Math.min(Math.max(8, b.left + b.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
    setPosition({ top, left });
  }, [open]);

  // Close on outside tap, Escape, scroll or resize (the anchor would move).
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setPinned(false);
      setHovering(false);
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!buttonRef.current?.contains(t) && !popoverRef.current?.contains(t) && !buttonRef.current?.closest("[data-kpi-cell]")?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const { info } = row;
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`About ${row.label}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        onMouseEnter={() => hover(true)}
        onMouseLeave={() => hover(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        className={cn(
          "inline-flex items-center justify-center w-3 h-3 flex-shrink-0 rounded-full border border-ink-300 text-ink-300 text-[8px] font-semibold leading-none",
          "hover:border-piltri-amber hover:text-piltri-amber focus:outline-none focus-visible:ring-1 focus-visible:ring-piltri-amber",
          open && "border-piltri-amber text-piltri-amber",
          className
        )}
      >
        i
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            onMouseEnter={() => hover(true)}
            onMouseLeave={() => hover(false)}
            style={{ position: "fixed", top: position?.top ?? -9999, left: position?.left ?? -9999, width: WIDTH }}
            className="z-[1000] rounded-lg border border-surface-border bg-surface shadow-card p-3 text-[11px] leading-snug text-ink-700"
          >
            <p className="text-[10px] uppercase tracking-wide text-ink-500">{row.label}</p>
            <p className={cn("mt-0.5 text-sm font-semibold", row.colorClass ?? "text-ink-900")}>
              {row.value}
              {row.valueSuffix && <span className="ml-1 text-[11px] font-normal">{row.valueSuffix}</span>}
            </p>
            <p className="mt-2">{info.definition}</p>
            {info.legend ? (
              <div className="mt-2.5">
                <p className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">Colour guide</p>
                <ul className="space-y-1">
                  {info.legend.map((line) => (
                    <li key={line.tier} className="flex items-start gap-1.5">
                      <span className={cn("mt-[3px] w-2 h-2 rounded-full flex-shrink-0", DOT[line.tier])} />
                      <span>
                        <span className="font-medium text-ink-900">{TIER_LABEL[line.tier]}:</span> {line.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-2.5 text-ink-500">Shown in grey: a descriptive fact, neither better nor worse.</p>
            )}
            <p className="mt-2.5 pt-2 border-t border-surface-border text-[10px] text-ink-500">Source: {info.source}</p>
          </div>,
          document.body
        )}
    </>
  );
});
