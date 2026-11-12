"use client";

import { useEffect, useRef, useState } from "react";
import { CloseButton } from "@/components/ui/CloseButton";
import { ADDRESS_ATTRIBUTION, ADDRESS_MIN_LETTERS, ADDRESS_PAUSE_MS, searchAddresses, type AddressResult, type SearchBox } from "@/lib/geocode";
import { searchMapNames } from "@/lib/mapPlaces";
import { cn } from "@/lib/cn";

/** How far around the centre the fallback reads the map's tiles: ~16 of
 *  them, the town or a big city's middle. */
const FALLBACK_RADIUS_KM = 4;
/** What a fallback line is, in a word. */
const KIND_WORDS: Record<string, string> = {
  street: "Street",
  bus: "Bus stop",
  railway: "Station",
  school: "School",
  college: "University",
  hospital: "Hospital",
  town_hall: "Town hall",
  park: "Park",
  shop: "Shop",
  restaurant: "Restaurant",
  cafe: "Café",
  place_of_worship: "Place of worship",
  sports_centre: "Sports centre",
  suburb: "Area",
  quarter: "Area",
  neighbourhood: "Area",
  hamlet: "Area",
  village: "Village",
  town: "Town",
};

/**
 * The map's address box (2026-11-11, owner: "an additional level of
 * search, at address level once in a city"): type a street, a house number
 * or a place's name, pick a line, and the map drops a spot there - what's
 * near it, journeys, save and share, like any spot. Searches the city and
 * just around it (lib/geocode.ts - Photon, a live service, asked only
 * after a pause in typing). Arrow keys and Enter work; Escape closes it.
 */
export function AddressSearch({
  placeName,
  box,
  near,
  autoFocus,
  onPick,
  onClose,
}: {
  /** "Olivet" - for the box's hint. */
  placeName?: string;
  box: SearchBox;
  near: { lat: number; lng: number };
  /** Opened with its own button: ready to type. (Not when it only comes
   *  along with "tap the map" - a phone's keyboard would cover the map.) */
  autoFocus?: boolean;
  onPick: (result: AddressResult) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<AddressResult[] | null>(null);
  // "fallback": Photon didn't answer, the lines are the map's own names.
  const [state, setState] = useState<"idle" | "searching" | "failed" | "fallback">("idle");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Asked after a pause in typing; an earlier question still in the air is
  // dropped, so answers can't arrive out of order.
  const boxKey = box.map((v) => v.toFixed(3)).join(",");
  useEffect(() => {
    const q = text.trim();
    if (q.length < ADDRESS_MIN_LETTERS) {
      setResults(null);
      setState("idle");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState("searching");
      searchAddresses(q, box, near, placeName, controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          setResults(found);
          setActive(0);
          setState("idle");
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          // Photon not answering (2026-11-12: it went quiet for minutes):
          // the streets and places in the map's own tiles around the city
          // instead - no house numbers, but the box still finds things.
          searchMapNames(q, near, FALLBACK_RADIUS_KM, controller.signal)
            .then((names) => {
              if (controller.signal.aborted) return;
              setResults(
                names.map((n, i) => ({
                  id: `map-${i}-${n.name}`,
                  lat: n.lat,
                  lng: n.lng,
                  title: n.name,
                  subtitle: [KIND_WORDS[n.kind] ?? "", `${n.km < 1 ? "<1" : Math.round(n.km)} km from the centre`].filter(Boolean).join(" · "),
                }))
              );
              setActive(0);
              setState(names.length ? "fallback" : "failed");
            })
            .catch(() => {
              if (controller.signal.aborted) return;
              setResults(null);
              setState("failed");
            });
        });
    }, ADDRESS_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, boxKey, near.lat, near.lng]);

  const typed = text.trim().length >= ADDRESS_MIN_LETTERS;
  const note =
    state === "failed"
      ? "The address search isn't answering - try again in a moment."
      : state === "fallback"
        ? "The address search isn't answering - these are streets and places from the map, without house numbers."
        : typed && results && results.length === 0 && state === "idle"
        ? `Nothing found${placeName ? ` in or around ${placeName}` : " here"} - try the street's name alone.`
        : null;

  return (
    <div className="rounded-2xl bg-surface shadow-card">
      <div className="flex items-center gap-2 py-1 pl-3 pr-1">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="shrink-0 text-ink-500">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // Not the page's Escape too, which would shrink the map.
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              onClose();
            } else if (e.key === "ArrowDown" && results?.length) {
              e.preventDefault();
              setActive((i) => (i + 1) % results.length);
            } else if (e.key === "ArrowUp" && results?.length) {
              e.preventDefault();
              setActive((i) => (i - 1 + results.length) % results.length);
            } else if (e.key === "Enter" && results?.[active]) {
              e.preventDefault();
              onPick(results[active]);
            }
          }}
          placeholder={placeName ? `An address in ${placeName}` : "An address here"}
          aria-label={placeName ? `Search an address in ${placeName}` : "Search an address"}
          // 16 px on a phone: smaller, and iPhones zoom the page on focus.
          className="min-w-0 flex-1 bg-transparent py-1.5 text-base text-ink-900 placeholder:text-ink-300 focus:outline-none sm:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        {state === "searching" && <span className="shrink-0 text-[11px] text-ink-500">Searching…</span>}
        <CloseButton label="Close the address search" onClick={onClose} className="-my-1" />
      </div>
      {(note || (results && results.length > 0)) && (
        <div className="border-t border-surface-border pb-1">
          {results && results.length > 0 && (
            <ul role="listbox" aria-label="Addresses found" className="max-h-[40vh] overflow-y-auto py-1">
              {results.map((r, i) => (
                <li key={r.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onClick={() => onPick(r)}
                    onMouseEnter={() => setActive(i)}
                    className={cn("block w-full px-3 py-1.5 text-left", i === active ? "bg-surface-muted" : "hover:bg-surface-muted")}
                  >
                    <span className="block truncate text-sm font-medium text-ink-900">{r.title}</span>
                    {r.subtitle && <span className="block truncate text-[11px] text-ink-500">{r.subtitle}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {note && <p className="px-3 py-2 text-xs text-ink-500">{note}</p>}
          <p className="px-3 pt-0.5 text-[10px] text-ink-300">{ADDRESS_ATTRIBUTION}</p>
        </div>
      )}
    </div>
  );
}
