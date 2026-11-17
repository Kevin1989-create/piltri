"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { MOTION_CSS, MOTION_MS, prefersReducedMotion } from "@/lib/motion";
import type { PlacePhoto } from "@/lib/placePhoto";
import { CityCorner } from "@/components/explore/CountryLocator";

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

/**
 * The photo over the whole map you can see (2026-11-17, owner: "it opens
 * quite direct, I want it smooth ... open strictly instead of the map"):
 * it grows out of its thumbnail on the map's curve and fills the map right
 * of `freeLeft` (a computer's place column), always the same way, whatever
 * the photo's shape - cropped to fill, its author and licence along the
 * bottom. A tap or Escape shrinks it back into `to`, then `onClosed`.
 */
export function PhotoCover({
  photo,
  placeName,
  from,
  to,
  freeLeft = 0,
  back,
  onClosed,
}: {
  photo: PlacePhoto;
  placeName?: string;
  from: CornerSquare;
  to: CornerSquare;
  freeLeft?: number;
  /** The city's map waiting in the corner, a tap away (2026-11-17, owner):
   *  where, and its picture (CityCorner). */
  back?: { at: CornerSquare; shot: string | null };
  onClosed: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const [big, setBig] = useState(false);
  const [closing, setClosing] = useState(false);
  const alt = placeName ? `A photo of ${placeName}` : "A photo of the place";

  const square = (s: CornerSquare): Keyframe => ({ right: `${s.right}px`, bottom: `${s.bottom}px`, width: `${s.size}px`, height: `${s.size}px`, borderRadius: "12px" });
  const FULL: Keyframe = { right: "0px", bottom: "0px", width: `calc(100% - ${freeLeft}px)`, height: "100%", borderRadius: "0px" };

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || prefersReducedMotion()) return;
    const grow = box.animate([square(from), FULL], { duration: MOTION_MS, easing: MOTION_CSS });
    return () => grow.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const box = boxRef.current;
    if (!box || prefersReducedMotion()) {
      onClosed();
      return;
    }
    box.animate([FULL, square(to)], { duration: Math.round(MOTION_MS * 0.85), easing: MOTION_CSS, fill: "forwards" }).finished.then(onClosed, onClosed);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <>
    <div
      ref={boxRef}
      className="pointer-events-auto absolute overflow-hidden bg-ink-900 shadow-card"
      style={{ right: 0, bottom: 0, width: `calc(100% - ${freeLeft}px)`, height: "100%" }}
    >
      <button type="button" onClick={close} aria-label="Close the photo" title="Close the photo" className="absolute inset-0 block h-full w-full">
        {/* The thumbnail at once (already loaded), the big one over it as it comes. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia's own thumbnails */}
        <img src={photo.src(330)} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
        {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia's own thumbnails */}
        <img
          src={photo.src(1280)}
          alt={alt}
          referrerPolicy="no-referrer"
          decoding="async"
          onLoad={() => setBig(true)}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-500", big ? "opacity-100" : "opacity-0")}
        />
        <span aria-hidden className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </span>
      </button>
      <p
        className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-3 pb-6 pt-8 text-[11px] leading-4 text-white/90"
        style={back ? { paddingRight: back.at.right + back.at.size + 12 } : undefined}
      >
        {placeName && <span className="font-serif text-[15px] text-white">{placeName}</span>}
        {placeName && " · "}
        Photo: {photo.author !== "Unknown author" && `${photo.author} · `}
        {photo.licence} ·{" "}
        <a href={photo.page} target="_blank" rel="noopener noreferrer" className="pointer-events-auto underline underline-offset-2 hover:text-white">
          Wikimedia Commons
        </a>
      </p>
    </div>
    {back && (
      <div
        className={cn("pointer-events-auto absolute transition-opacity duration-300", closing ? "opacity-0" : "opacity-100")}
        style={{ right: back.at.right, bottom: back.at.bottom }}
      >
        <CityCorner shot={back.shot} placeName={placeName} size={back.at.size} onBack={close} />
      </div>
    )}
    </>
  );
}
