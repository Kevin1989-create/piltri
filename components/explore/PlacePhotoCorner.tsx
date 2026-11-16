"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { PlacePhoto } from "@/lib/placePhoto";

/** The place's photo in the map's bottom-left corner, above the country
 *  (2026-11-14, owner): a square thumbnail; a tap opens it big with its
 *  author and licence (every Commons file asks for them), another closes
 *  it. Loaded from Wikimedia's servers, no referrer sent. */
export function PlacePhotoCorner({
  photo,
  placeName,
  size,
  open,
  onToggle,
  onFail,
}: {
  photo: PlacePhoto;
  placeName?: string;
  /** The thumbnail's side, px (the country square's). */
  size: number;
  open: boolean;
  onToggle: () => void;
  /** The image didn't load - the corner then hides it. */
  onFail: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const alt = placeName ? `A photo of ${placeName}` : "A photo of the place";
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
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
  return (
    <figure className="relative overflow-hidden rounded-xl bg-surface shadow-lg ring-1 ring-black/5 motion-safe:animate-fade-in" style={{ width: "min(420px, 100%)" }}>
      <button type="button" onClick={onToggle} aria-label="Close the photo" title="Close the photo" className="block w-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia's own thumbnails, not ours to optimise */}
        <img
          src={photo.src(960)}
          alt={alt}
          referrerPolicy="no-referrer"
          decoding="async"
          onError={onFail}
          className="block w-full object-cover"
          style={{ aspectRatio: `${photo.width} / ${photo.height}`, maxHeight: "min(320px, 50vh)" }}
        />
      </button>
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
      <figcaption className="truncate px-2.5 py-1.5 text-[10px] leading-4 text-ink-500">
        {/* No author on record for ~1% of files: the file's page has the full credit. */}
        Photo: {photo.author !== "Unknown author" && `${photo.author} · `}
        {photo.licence} ·{" "}
        <a href={photo.page} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-piltri-amber">
          Wikimedia Commons
        </a>
      </figcaption>
    </figure>
  );
}
