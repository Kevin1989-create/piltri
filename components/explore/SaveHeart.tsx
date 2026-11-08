"use client";

import { useEffect, useState } from "react";
import { HeartIcon } from "@/components/ui/icons";
import { isPlaceSaved, SAVED_CHANGE, togglePlace, type SavedPlace } from "@/lib/savedPlaces";
import { cn } from "@/lib/cn";

/** The heart beside a city's name (2026-11-08, owner): saves the place in
 *  this browser (lib/savedPlaces.ts) - filled amber once saved, with a
 *  small beat; listed on the Saved page. */
export function SaveHeart({ place, className }: { place: Omit<SavedPlace, "savedAt">; className?: string }) {
  const [saved, setSaved] = useState(false);
  const [beat, setBeat] = useState(false);
  useEffect(() => {
    const sync = () => setSaved(isPlaceSaved(place.id));
    sync();
    window.addEventListener(SAVED_CHANGE, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SAVED_CHANGE, sync);
      window.removeEventListener("storage", sync);
    };
  }, [place.id]);
  const label = saved ? `Saved - remove ${place.name} from your saved places` : `Save ${place.name}`;
  return (
    <button
      type="button"
      onClick={() => {
        const now = togglePlace(place);
        setSaved(now);
        setBeat(now);
      }}
      onAnimationEnd={() => setBeat(false)}
      aria-pressed={saved}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
        saved ? "border-piltri-amber bg-piltri-amber-tint text-piltri-amber" : "border-surface-border text-ink-500 hover:border-piltri-amber hover:text-piltri-amber",
        beat && "motion-safe:animate-heart-beat",
        className
      )}
    >
      <HeartIcon className="h-3.5 w-3.5" fill={saved ? "currentColor" : "none"} />
    </button>
  );
}
