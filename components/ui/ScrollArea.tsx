"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** A box that scrolls its own content, with a bar that is always visible
 *  while there's more to see - phones otherwise hide scroll bars until you
 *  scroll. The thumb can be dragged, and pressing elsewhere on the track
 *  jumps there. Scrolling stops at the box's edges instead of carrying on
 *  into the page.
 *
 *  The content sits in a layer positioned over the box, so however long it
 *  is it never adds to the box's own size: the box takes whatever size the
 *  surrounding layout gives it (e.g. `flex-1 min-h-[200px]` via
 *  `className`) and the content scrolls within that. */
export function ScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Thumb position and length, as fractions of the track; null when
  // everything fits and there's nothing to scroll.
  const [thumb, setThumb] = useState<{ top: number; size: number } | null>(null);
  // While dragging: where on the thumb the finger took hold, in px.
  const grabRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      setThumb(null);
      return;
    }
    const size = Math.max(clientHeight / scrollHeight, 0.12);
    setThumb({ top: (scrollTop / (scrollHeight - clientHeight)) * (1 - size), size });
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [measure]);

  function scrollToPointer(track: DOMRect, clientY: number, grab: number) {
    const el = viewportRef.current;
    if (!el || !thumb) return;
    const thumbPx = thumb.size * track.height;
    const fraction = (clientY - track.top - grab) / (track.height - thumbPx);
    el.scrollTop = Math.min(Math.max(fraction, 0), 1) * (el.scrollHeight - el.clientHeight);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!thumb) return;
    e.preventDefault();
    const track = e.currentTarget.getBoundingClientRect();
    const thumbTop = thumb.top * track.height;
    const thumbPx = thumb.size * track.height;
    const y = e.clientY - track.top;
    // On the thumb: keep hold of it where it was touched. Elsewhere on the
    // track: jump so the thumb is centred under the finger.
    grabRef.current = y >= thumbTop && y <= thumbTop + thumbPx ? y - thumbTop : thumbPx / 2;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrollToPointer(track, e.clientY, grabRef.current);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (grabRef.current == null) return;
    scrollToPointer(e.currentTarget.getBoundingClientRect(), e.clientY, grabRef.current);
  }

  function onPointerUp() {
    grabRef.current = null;
  }

  return (
    <div className={cn("relative", className)}>
      <div ref={viewportRef} onScroll={measure} className="absolute inset-0 overflow-y-auto overscroll-contain no-scrollbar">
        <div ref={contentRef} className="min-h-full flex flex-col">
          {children}
        </div>
      </div>
      {thumb && (
        // 16px wide to be easy to catch with a finger; the bar drawn inside
        // it is 4px.
        <div
          aria-hidden
          className="absolute top-1.5 bottom-1.5 right-0 w-4 touch-none cursor-pointer"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="absolute inset-y-0 right-1 w-1 rounded-full bg-ink-900/10" />
          <div
            className="absolute right-1 w-1 rounded-full bg-ink-500/70"
            style={{ top: `${thumb.top * 100}%`, height: `${thumb.size * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
