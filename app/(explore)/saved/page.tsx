"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { BackLink } from "@/components/ui/BackLink";
import { CloseIcon, HeartIcon } from "@/components/ui/icons";
import { getCityExploreData } from "@/lib/dataset/cities";
import { allSavedSpots, formatSpotParam, removeSpot, type SavedSpot } from "@/lib/spots";
import { removePlace, SAVED_CHANGE, savedPlaces, type SavedPlace } from "@/lib/savedPlaces";
import { cityUrl, countryCodeOfCityId } from "@/lib/urls";

/**
 * Saved (2026-11-08, owner: "save a city, but also a specific point within
 * the city"): the places saved with the heart and the spots saved on a
 * city's map, kept in this browser until accounts come. A place opens its
 * city page; a spot opens the map on it (`&spot=`).
 */
export default function SavedPage() {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [spots, setSpots] = useState<SavedSpot[]>([]);
  const [names, setNames] = useState<Record<string, { name: string; country: string }>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const read = () => {
      setPlaces(savedPlaces());
      setSpots(allSavedSpots());
      setReady(true);
    };
    read();
    window.addEventListener(SAVED_CHANGE, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(SAVED_CHANGE, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  // Spots grouped by their city, newest city first.
  const groups = useMemo(() => {
    const byPlace = new Map<string, SavedSpot[]>();
    for (const spot of spots) byPlace.set(spot.placeId, [...(byPlace.get(spot.placeId) ?? []), spot]);
    return [...byPlace.entries()];
  }, [spots]);

  // A spot's city that isn't itself saved: its name from the dataset.
  useEffect(() => {
    const missing = groups.map(([id]) => id).filter((id) => !names[id] && !places.some((p) => p.id === id));
    if (!missing.length) return;
    let live = true;
    Promise.all(
      missing.map((id) =>
        getCityExploreData(countryCodeOfCityId(id), id)
          .then((d) => [id, d ? { name: d.cityName, country: d.country } : null] as const)
          .catch(() => [id, null] as const)
      )
    ).then((found) => {
      if (!live) return;
      setNames((current) => ({ ...current, ...Object.fromEntries(found.filter(([, v]) => v).map(([id, v]) => [id, v!])) }));
    });
    return () => {
      live = false;
    };
  }, [groups, names, places]);

  const cityLabel = (id: string) => {
    const place = places.find((p) => p.id === id) ?? names[id];
    return place ? { name: place.name, country: place.country } : { name: id.replace(/-[a-z]{2}$/, "").replace(/-/g, " "), country: "" };
  };
  const nothing = ready && places.length === 0 && spots.length === 0;

  return (
    <main className="min-h-dvh flex flex-col bg-surface-muted">
      <NavBar logoSide="left" />
      <div className="px-4 sm:px-6 pt-6 sm:pt-8 pb-16">
        <div className="max-w-3xl mx-auto">
          <BackLink />
          <h1 className="font-serif text-3xl sm:text-4xl text-ink-900 mt-2">Saved</h1>
          <p className="text-sm text-ink-500 mt-1">The places and spots you keep an eye on - kept in this browser for now.</p>

          {nothing && (
            <div className="mt-6 rounded-card border border-surface-border bg-surface px-5 py-8 text-center">
              <HeartIcon className="mx-auto h-6 w-6 text-piltri-amber" />
              <p className="mt-2 text-sm text-ink-900">Nothing saved yet.</p>
              <p className="mt-1 text-xs text-ink-500">Tap the heart beside a city&apos;s name, or Save on a spot you dropped on its map.</p>
            </div>
          )}

          {places.length > 0 && (
            <section className="mt-6">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-500">Places</h2>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {places.map((p) => (
                  <li key={p.id} className="flex items-stretch rounded-card border border-surface-border bg-surface hover:border-piltri-amber-light transition-colors">
                    <Link href={cityUrl(p.id)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
                      <HeartIcon className="h-4 w-4 shrink-0 text-piltri-amber" fill="currentColor" />
                      <span className="min-w-0">
                        <span className="block truncate font-serif text-lg leading-tight text-ink-900">{p.name}</span>
                        <span className="block truncate text-[11px] text-ink-500">{p.country}</span>
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => removePlace(p.id)}
                      aria-label={`Remove ${p.name}`}
                      title="Remove"
                      className="flex w-10 shrink-0 items-center justify-center border-l border-surface-border text-ink-300 hover:text-ink-900"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {groups.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xs font-medium uppercase tracking-wide text-ink-500">Spots</h2>
              <div className="mt-2 space-y-3">
                {groups.map(([placeId, list]) => {
                  const city = cityLabel(placeId);
                  return (
                    <div key={placeId} className="rounded-card border border-surface-border bg-surface">
                      <Link href={cityUrl(placeId)} className="block border-b border-surface-border px-4 py-2.5 hover:bg-surface-muted/60">
                        <span className="font-serif text-base capitalize text-ink-900">{city.name}</span>
                        {city.country && <span className="text-[11px] text-ink-500"> · {city.country}</span>}
                      </Link>
                      <ul>
                        {list.map((s) => (
                          <li key={`${s.lat},${s.lng}`} className="flex items-center border-b border-surface-border last:border-b-0">
                            <Link href={`${cityUrl(placeId)}&spot=${formatSpotParam(s)}`} className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-2 hover:bg-surface-muted/60">
                              <HeartIcon className="h-3.5 w-3.5 shrink-0 text-piltri-amber" fill="currentColor" />
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-ink-900">{s.name ?? "Your spot"}</span>
                                <span className="block text-[11px] tabular-nums text-ink-500">
                                  {s.lat.toFixed(5)}, {s.lng.toFixed(5)} · open on the map
                                </span>
                              </span>
                            </Link>
                            <button
                              type="button"
                              onClick={() => {
                                removeSpot(s);
                                setSpots(allSavedSpots());
                              }}
                              aria-label="Remove this spot"
                              title="Remove"
                              className="flex h-10 w-10 shrink-0 items-center justify-center text-ink-300 hover:text-ink-900"
                            >
                              <CloseIcon className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {!nothing && ready && (
            <p className="mt-8 text-[11px] text-ink-500">
              Kept in this browser only - clearing your browser&apos;s data removes them. With an account (coming), they&apos;ll follow you to any device.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
