"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";
import { MOTION_CSS, MOTION_MS, prefersReducedMotion } from "@/lib/motion";
import type { PlacePhoto } from "@/lib/placePhoto";

/** The place's photo in the map's bottom-left corner, beside the country
 *  (2026-11-14, owner): a square thumbnail; a tap opens it over the map
 *  (PhotoCover). Loaded from Wikimedia's servers, no referrer sent. */
export function PlacePhotoCorner({
  photo,
  placeName,
  size,
  onOpen,
  onFail,
}: {
  photo: PlacePhoto;
  placeName?: string;
  /** The thumbnail's side, px (the country square's). */
  size: number;
  onOpen: () => void;
  /** The image didn't load - the corner then hides it. */
  onFail: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const alt = placeName ? `A photo of ${placeName}` : "A photo of the place";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${alt} - tap to open it`}
      title={`${alt} - tap to open it`}
      style={{ width: size, height: size }}
      className={cn(
        "relative block flex-shrink-0 overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-black/5 transition-[transform,box-shadow,opacity] duration-200 hover:-translate-y-0.5 hover:shadow-lg",
        loaded ? "opacity-100" : "opacity-0"
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia's own thumbnails, not ours to optimise */}
      <img
        src={photo.src(330)}
        alt={alt}
        referrerPolicy="no-referrer"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={onFail}
        className="h-full w-full object-cover"
      />
    </button>
  );
}

/** A square in the map's bottom-right corner: px from the map's right and
 *  bottom edges, and its side. */
export interface CornerSquare {
  right: number;
  bottom: number;
  size: number;
}

/** Whether a photo is shown whole in a box of that shape (over a blurred
 *  copy of itself) rather than cut to fill it: when filling would cut off
 *  more than about a quarter of it (2026-11-21, owner: "cut poorly"). */
function showWhole(photo: PlacePhoto, box: { w: number; h: number } | null): boolean {
  if (!box || !box.w || !box.h) return false;
  const ratio = photo.width / photo.height / (box.w / box.h);
  return ratio < 0.75 || ratio > 1.33;
}

/**
 * The photo over the whole map you can see (2026-11-17, owner: "it opens
 * quite direct, I want it smooth ... open strictly instead of the map"):
 * it grows out of its thumbnail on the map's curve and fills the map right
 * of `freeLeft` (a computer's place column), its author and licence along
 * the bottom. A tap or Escape shrinks it back into `to`, then `onClosed`.
 *
 * The place's other photos (2026-11-21, owner: "a lot of very nice
 * pictures for each city"): `loadGallery` brings up to 12, the first being
 * this one; arrows, a swipe or the arrow keys go through them, a counter
 * says where you are, and each is credited. A photo whose shape is far from
 * the map's is shown whole over a blurred copy of itself, not cut.
 */
export function PhotoCover({
  photo,
  placeName,
  from,
  to,
  freeLeft = 0,
  reserveRight = 0,
  closeSignal = 0,
  loadGallery,
  onClosed,
}: {
  photo: PlacePhoto;
  placeName?: string;
  from: CornerSquare;
  to: CornerSquare;
  freeLeft?: number;
  /** Px on the right the corner's squares take over the photo: the
   *  caption stops short of them. */
  reserveRight?: number;
  /** Changes when something else asks it to close (the city's square). */
  closeSignal?: number;
  /** The place's photos, its own first - null when it has only the one. */
  loadGallery?: () => Promise<PlacePhoto[] | null>;
  onClosed: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const [photos, setPhotos] = useState<PlacePhoto[]>([photo]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const current = photos[index] ?? photo;
  const count = photos.length;
  const alt = placeName ? `A photo of ${placeName}` : "A photo of the place";

  const square = (s: CornerSquare): Keyframe => ({ right: `${s.right}px`, bottom: `${s.bottom}px`, width: `${s.size}px`, height: `${s.size}px`, borderRadius: "12px" });
  const FULL: Keyframe = { right: "0px", bottom: "0px", width: `calc(100% - ${freeLeft}px)`, height: "100%", borderRadius: "0px" };

  useLayoutEffect(() => {
    const el = boxRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    // The box's full size (not mid-animation): the map's, less freeLeft.
    const measure = () => setBox({ w: parent.clientWidth - freeLeft, h: parent.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    const grow = prefersReducedMotion() ? null : el.animate([square(from), FULL], { duration: MOTION_MS, easing: MOTION_CSS });
    return () => {
      grow?.cancel();
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadGallery?.()
      .then((list) => {
        if (cancelled || !list || list.length < 2) return;
        // This photo first, then the rest in their order.
        setPhotos([photo, ...list.filter((p) => p.page !== photo.page)]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (step: number) => setIndex((i) => (i + step + count) % count);
  const goRef = useRef(go);
  goRef.current = go;
  const countRef = useRef(count);
  countRef.current = count;

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const el = boxRef.current;
    if (!el || prefersReducedMotion()) {
      onClosed();
      return;
    }
    el.animate([FULL, square(to)], { duration: Math.round(MOTION_MS * 0.85), easing: MOTION_CSS, fill: "forwards" }).finished.then(onClosed, onClosed);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        closeRef.current();
      } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && countRef.current > 1) {
        e.stopImmediatePropagation();
        e.preventDefault();
        goRef.current(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const firstSignal = useRef(closeSignal);
  useEffect(() => {
    if (closeSignal !== firstSignal.current) closeRef.current();
  }, [closeSignal]);

  // A swipe goes to the next or previous photo; a tap closes.
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    swipeRef.current = { x: e.clientX, y: e.clientY };
  };
  const onClick = (e: MouseEvent) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (start && countRef.current > 1) {
      const dx = e.clientX - start.x;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
        go(dx < 0 ? 1 : -1);
        return;
      }
    }
    close();
  };

  const whole = showWhole(current, box);
  const sharp = loaded[current.page];
  // The next photo starts loading while this one is looked at.
  const next = count > 1 ? photos[(index + 1) % count] : null;
  const fit = whole ? "object-contain" : "object-cover";
  const arrow =
    "pointer-events-auto absolute top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70";

  return (
    <div
      ref={boxRef}
      className="pointer-events-auto absolute overflow-hidden bg-ink-900 shadow-card"
      style={{ right: 0, bottom: 0, width: `calc(100% - ${freeLeft}px)`, height: "100%" }}
    >
      <button
        type="button"
        onPointerDown={onPointerDown}
        onClick={onClick}
        aria-label="Close the photo"
        title="Close the photo"
        className="absolute inset-0 block h-full w-full touch-pan-y"
      >
        {/* Shown whole: a blurred, darker copy of it fills the rest. */}
        {whole && (
          // eslint-disable-next-line @next/next/no-img-element -- Wikimedia's own thumbnails
          <img
            key={`bg-${current.page}`}
            src={current.src(330)}
            alt=""
            aria-hidden
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-[0.55]"
          />
        )}
        {/* The small one at once, the sharp one over it as it comes. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia's own thumbnails */}
        <img
          key={`lo-${current.page}`}
          src={current.src(330)}
          alt=""
          referrerPolicy="no-referrer"
          className={cn("absolute inset-0 h-full w-full", fit, sharp && "invisible")}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia's own thumbnails */}
        <img
          key={`hi-${current.page}`}
          src={current.src(1280)}
          srcSet={current.srcSet}
          sizes="100vw"
          alt={alt}
          referrerPolicy="no-referrer"
          decoding="async"
          onLoad={() => setLoaded((l) => ({ ...l, [current.page]: true }))}
          className={cn("absolute inset-0 h-full w-full transition-opacity duration-500", fit, sharp ? "opacity-100" : "opacity-0")}
        />
        {next && (
          // eslint-disable-next-line @next/next/no-img-element -- loads the next photo ahead
          <img key={`next-${next.page}`} src={next.src(1280)} srcSet={next.srcSet} sizes="100vw" alt="" aria-hidden referrerPolicy="no-referrer" className="hidden" />
        )}
      </button>
      <span aria-hidden className="pointer-events-none absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
      {count > 1 && (
        <>
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[12px] font-medium tabular-nums text-white">
            {index + 1} / {count}
          </span>
          <button type="button" onClick={() => go(-1)} aria-label="Previous photo" title="Previous photo" className={cn(arrow, "left-3")}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next photo" title="Next photo" className={cn(arrow, "right-3")}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}
      <p
        className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-3 pb-6 pt-8 text-[11px] leading-4 text-white/90"
        style={reserveRight ? { paddingRight: reserveRight } : undefined}
      >
        {placeName && <span className="font-serif text-[15px] text-white">{placeName}</span>}
        {placeName && " · "}
        Photo: {current.author !== "Unknown author" && `${current.author} · `}
        {current.licence} ·{" "}
        <a href={current.page} target="_blank" rel="noopener noreferrer" className="pointer-events-auto underline underline-offset-2 hover:text-white">
          Wikimedia Commons
        </a>
      </p>
    </div>
  );
}
