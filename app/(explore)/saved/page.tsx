"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { NavBar } from "@/components/ui/NavBar";
import { BackLink } from "@/components/ui/BackLink";
import { CloseIcon, HeartIcon } from "@/components/ui/icons";
import { AccountCard } from "@/components/saved/AccountCard";
import type { GlobePoint } from "@/components/saved/SavedGlobe";
import { getCityExploreData } from "@/lib/dataset/cities";
import { allSavedSpots, formatSpotParam, removeSpot, type SavedSpot } from "@/lib/spots";
import { removePlace, SAVED_CHANGE, savedPlaces, type SavedPlace } from "@/lib/savedPlaces";
import { cityUrl, countryCodeOfCityId } from "@/lib/urls";
import { cn } from "@/lib/cn";

const SavedGlobe = dynamic(() => import("@/components/saved/SavedGlobe").then((m) => m.SavedGlobe), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-full bg-surface-muted" />,
});

type View = "globe" | "list";
type Kind = "all" | "place" | "spot";
const VIEW_KEY = "piltri:saved-view";

/**
 * Saved (2026-11-08, owner: "a personal account ... on which all the likes
 * would be displayed either on a list on which we could filter, either on
 * a beautiful 3D world map"): the places saved with the heart and the
 * spots saved on a city's map - on a globe, or as a list that filters by
 * kind, country and name. Kept in the browser and, once signed in, in the
 * account (lib/account.ts).
 */
export default function SavedPage() {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [spots, setSpots] = useState<SavedSpot[]>([]);
  // A city's name, country and position from the dataset, where the saved
  // copy lacks them (a spot's city that isn't itself saved, early saves).
  const [cities, setCities] = useState<Record<string, { name: string; country: string; lat: number; lng: number }>>({});
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("globe");
  const [kind, setKind] = useState<Kind>("all");
  const [country, setCountry] = useState("");
  const [query, setQuery] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      setPlaces(savedPlaces());
      setSpots(allSavedSpots());
      setReady(true);
    };
    read();
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "list" || v === "globe") setView(v);
    } catch {}
    window.addEventListener(SAVED_CHANGE, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(SAVED_CHANGE, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  const chooseView = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  useEffect(() => {
    const need = new Set<string>();
    for (const p of places) if (p.lat == null && !cities[p.id]) need.add(p.id);
    for (const s of spots) if (!cities[s.placeId] && !places.some((p) => p.id === s.placeId && p.country)) need.add(s.placeId);
    if (!need.size) return;
    let live = true;
    Promise.all(
      [...need].map((id) =>
        getCityExploreData(countryCodeOfCityId(id), id)
          .then((d) => [id, d ? { name: d.cityName, country: d.country, lat: d.lat, lng: d.lng } : null] as const)
          .catch(() => [id, null] as const)
      )
    ).then((found) => {
      if (live) setCities((c) => ({ ...c, ...Object.fromEntries(found.filter(([, v]) => v).map(([id, v]) => [id, v!])) }));
    });
    return () => {
      live = false;
    };
  }, [places, spots, cities]);

  const cityOf = (id: string) => {
    const p = places.find((q) => q.id === id);
    const c = cities[id];
    return { name: p?.name ?? c?.name ?? id.replace(/-[a-z]{2}$/, "").replace(/-/g, " "), country: p?.country || c?.country || "" };
  };

  // Every saved thing, as one list for the filters and the globe.
  const items = useMemo(() => {
    // Every row's second line alike (2026-11-09, owner: "clean and
    // consistent"): what it is, the country, the city.
    const line = (...parts: string[]) => parts.filter(Boolean).join(" · ");
    const out: (GlobePoint & { country: string; savedAt: string; remove: () => void; lat: number; lng: number; hasPosition: boolean })[] = [];
    for (const p of places) {
      const lat = p.lat ?? cities[p.id]?.lat;
      const lng = p.lng ?? cities[p.id]?.lng;
      out.push({
        key: `place:${p.id}`,
        kind: "place",
        lat: lat ?? 0,
        lng: lng ?? 0,
        hasPosition: lat != null && lng != null,
        title: p.name,
        subtitle: line("City", p.country, p.name),
        country: p.country,
        href: cityUrl(p.id),
        savedAt: p.savedAt,
        remove: () => removePlace(p.id),
      });
    }
    for (const s of spots) {
      const city = cityOf(s.placeId);
      out.push({
        key: `spot:${formatSpotParam(s)}`,
        kind: "spot",
        lat: s.lat,
        lng: s.lng,
        hasPosition: true,
        // Its name where the map gave one, else where it is.
        title: s.name ?? `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`,
        subtitle: line("Spot", city.country, city.name),
        country: city.country,
        href: `${cityUrl(s.placeId)}&spot=${formatSpotParam(s)}`,
        savedAt: s.savedAt,
        remove: () => removeSpot(s),
      });
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, spots, cities]);

  const countries = useMemo(() => [...new Set(items.map((i) => i.country).filter(Boolean))].sort(), [items]);
  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (i) => (kind === "all" || i.kind === kind) && (!country || i.country === country) && (!q || `${i.title} ${i.subtitle}`.toLowerCase().includes(q))
  );
  const globePoints = shown.filter((i) => i.hasPosition);
  const nothing = ready && items.length === 0;

  return (
    <main className="min-h-dvh flex flex-col bg-surface-muted">
      <NavBar logoSide="left" />
      <div className="px-4 sm:px-6 pt-6 sm:pt-8 pb-16">
        <div className="max-w-5xl mx-auto">
          <BackLink />
          <h1 className="font-serif text-3xl sm:text-4xl text-ink-900 mt-2">Saved</h1>
          <p className="text-sm text-ink-500 mt-1">The cities and spots you keep an eye on.</p>

          <AccountCard />

          {nothing && (
            <div className="mt-6 rounded-card border border-surface-border bg-surface px-5 py-8 text-center">
              <HeartIcon className="mx-auto h-6 w-6 text-piltri-amber" />
              <p className="mt-2 text-sm text-ink-900">Nothing saved yet.</p>
              <p className="mt-1 text-xs text-ink-500">Tap the heart beside a city&apos;s name, or Save on a spot you dropped on its map.</p>
            </div>
          )}

          {items.length > 0 && (
            <>
              {/* View, and the filters both views follow. */}
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <div className="flex overflow-hidden rounded-pill border border-surface-border bg-surface text-xs">
                  {(["globe", "list"] as View[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => chooseView(v)}
                      className={cn("px-3.5 py-1.5 capitalize transition-colors", view === v ? "bg-piltri-amber text-white" : "text-ink-500 hover:bg-surface-muted")}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div className="flex overflow-hidden rounded-pill border border-surface-border bg-surface text-xs">
                  {(
                    [
                      ["all", "All"],
                      ["place", "Cities"],
                      ["spot", "Spots"],
                    ] as [Kind, string][]
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={cn("px-3 py-1.5 transition-colors", kind === k ? "bg-ink-900 text-white" : "text-ink-500 hover:bg-surface-muted")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {countries.length > 1 && (
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    aria-label="Country"
                    className="rounded-pill border border-surface-border bg-surface px-3 py-1.5 text-xs text-ink-900 focus:border-piltri-amber focus:outline-none"
                  >
                    <option value="">Every country</option>
                    {countries.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find…"
                  aria-label="Find a saved place"
                  className="min-w-0 flex-1 basis-32 rounded-pill border border-surface-border bg-surface px-3 py-1.5 text-xs text-ink-900 placeholder:text-ink-300 focus:border-piltri-amber focus:outline-none"
                />
                <span className="text-[11px] tabular-nums text-ink-500">
                  {shown.length} of {items.length}
                </span>
              </div>

              {view === "globe" ? (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
                  <div className="aspect-square max-h-[78vh] w-full rounded-card border border-surface-border bg-gradient-to-b from-surface to-surface-muted sm:aspect-[4/3]">
                    <SavedGlobe points={globePoints} focusKey={focusKey} />
                  </div>
                  {/* Beside the globe: the list to fly to one. */}
                  <ul className="max-h-[78vh] space-y-1 overflow-y-auto">
                    {shown.map((i) => (
                      <li key={i.key}>
                        <button
                          type="button"
                          onClick={() => setFocusKey(i.key === focusKey ? `${i.key}#` : i.key)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-surface",
                            focusKey?.startsWith(i.key) && "bg-surface shadow-card"
                          )}
                        >
                          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", i.kind === "place" ? "bg-piltri-amber" : "bg-piltri-amber-dark")} />
                          <span className="min-w-0">
                            <span className="block truncate font-serif text-base leading-tight text-ink-900 tabular-nums lining-nums">{i.title}</span>
                            <span className="block truncate text-[11px] text-ink-500">{i.subtitle}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {shown.map((i) => (
                    <li key={i.key} className="flex items-stretch rounded-card border border-surface-border bg-surface hover:border-piltri-amber-light transition-colors">
                      <Link href={i.href} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
                        <HeartIcon className="h-4 w-4 shrink-0 text-piltri-amber" fill="currentColor" />
                        <span className="min-w-0">
                          <span className="block truncate font-serif text-lg leading-tight text-ink-900 tabular-nums lining-nums">{i.title}</span>
                          <span className="block truncate text-[11px] text-ink-500">{i.subtitle}</span>
                        </span>
                      </Link>
                      <button
                        type="button"
                        onClick={i.remove}
                        aria-label={`Remove ${i.title}`}
                        title="Remove"
                        className="flex w-12 shrink-0 items-center justify-center border-l border-surface-border text-ink-500 transition-colors hover:bg-ink-100/60 hover:text-ink-900"
                      >
                        <CloseIcon className="h-5 w-5" strokeWidth={2} />
                      </button>
                    </li>
                  ))}
                  {!shown.length && <li className="text-sm text-ink-500">Nothing matches - try another filter.</li>}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
