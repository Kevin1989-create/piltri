"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { prefetchSearch, searchCities } from "@/lib/dataset/search";
import type { CitySearchResult } from "@/lib/types";

interface SearchBarProps {
  initialValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  variant?: "landing" | "compact";
  className?: string;
  /** If provided, selecting a result calls this instead of navigating to
   *  the results page — used by the Compare page to add a city to the
   *  current comparison rather than leaving it. */
  onSelectCity?: (city: CitySearchResult) => void;
}

/**
 * Search bar behaviour (locked spec, piltri-project-brief.md):
 * - Empty state: search bar only, no suggestions
 * - On focus only: no suggestions until user types
 * - First character typed: suggestions appear
 * - Input cleared: suggestions disappear immediately
 * - Escape key: closes suggestions
 * - Suggestions show city name + region/country context
 *
 * `hasUserTyped` is the guard for this: it is set ONLY inside the input's
 * onChange handler (an actual keystroke), and the search-fetch effect below
 * is a no-op until it's true. This is deliberately stronger than gating on
 * "is this the first render" — it means mounting this component pre-filled
 * (the compact nav bar on the results page, initialised with the already
 * selected city) can never open the suggestions list, no matter how the
 * effect happens to be scheduled.
 */
export function SearchBar({
  initialValue = "",
  placeholder = "Search for a city, region, country or continent",
  autoFocus = false,
  variant = "landing",
  className,
  onSelectCity,
}: SearchBarProps) {
  const [value, setValue] = useState(initialValue);
  const [results, setResults] = useState<CitySearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hasUserTyped, setHasUserTyped] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef("");
  const router = useRouter();

  useEffect(() => {
    if (!hasUserTyped) return;

    if (value.length === 0) {
      setResults([]);
      setOpen(false);
      return;
    }

    // Search runs in the browser over a small per-letter index (see
    // lib/dataset/search.ts) - the short debounce just skips work while
    // keys are still arriving; a stale answer never overwrites a newer one.
    prefetchSearch(value);
    latestQueryRef.current = value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchCities(value);
        if (latestQueryRef.current !== value) return;
        setResults(data);
        setOpen(data.length > 0);
        setActiveIndex(-1);
      } catch {
        // A failed index load just means no suggestions.
      }
    }, 60);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, hasUserTyped]);

  function selectCity(city: CitySearchResult) {
    setOpen(false);
    setHasUserTyped(false);
    if (onSelectCity) {
      // Reset the box back to empty rather than leaving whatever was typed
      // to find this result — the Compare page's "add a place" box reuses
      // this same input for the next addition, so it should read as fresh
      // rather than pre-filled with the last thing you searched.
      setValue("");
      setResults([]);
      onSelectCity(city);
      return;
    }
    setValue(`${city.cityName}, ${city.country}`);
    const qs = new URLSearchParams({
      cityId: city.cityId,
      city: city.cityName,
      region: city.region ?? "",
      country: city.country,
      countryCode: city.countryCode,
      lat: String(city.lat),
      lng: String(city.lng),
    });
    router.push(`/explore/results?${qs.toString()}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
      e.preventDefault();
      selectCity(results[activeIndex]);
    }
  }

  // No default width on the wrapper below, on purpose — this sits inside a
  // flex row on the results page nav bar, where a base "w-full" would tie in
  // specificity with the "w-[300px]" passed via className and (depending on
  // Tailwind's generated CSS order) can silently win, stretching the bar
  // across the whole header. Every other usage sits in normal block flow,
  // where a plain div naturally fills its container's width anyway, so
  // dropping the default costs nothing there.
  return (
    <div className={cn("relative", className)}>
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          setHasUserTyped(true);
          setValue(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (hasUserTyped && value.length > 0 && results.length > 0) setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className={cn(
          // Same border as the Card component (Home page's Explore card):
          // plain border-surface-border, not the brand amber.
          "w-full rounded-pill border border-surface-border bg-surface font-sans text-ink-900",
          "placeholder:text-ink-300 focus:outline-none transition-colors",
          variant === "landing" ? "px-6 py-4 text-base shadow-card" : "px-4 py-2 text-sm"
        )}
        aria-label="Search locations"
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
      />

      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-2 w-full rounded-card border border-surface-border bg-surface shadow-card overflow-hidden"
        >
          {results.map((city, i) => (
            <li
              key={city.cityId}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={() => selectCity(city)}
              className={cn(
                "cursor-pointer px-5 py-3 text-sm border-b border-surface-border last:border-b-0",
                i === activeIndex ? "bg-piltri-amber-tint" : "hover:bg-surface-muted"
              )}
            >
              <span className="font-medium text-ink-900">{city.cityName}</span>
              <span className="text-ink-500">
                {city.region ? `, ${city.region}` : ""}, {city.country}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
