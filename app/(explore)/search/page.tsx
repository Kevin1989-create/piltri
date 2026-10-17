"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { NavBar } from "@/components/ui/NavBar";
import { BackLink } from "@/components/ui/BackLink";
import { Chip } from "@/components/ui/Chip";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { CloseIcon, FilterIcon, PlusIcon, SECTION_ICONS } from "@/components/ui/icons";
import type { MapPoint } from "@/components/explore/DiscoverResultsMap";
import { getPlaceTable, piltriRanks, type PlaceTable } from "@/lib/advancedSearch/engine";
import {
  activeFilterCount,
  available,
  CLIMATE,
  columnsFor,
  EMPTY_STATE,
  factsFor,
  GROUP_KM,
  finderQuery,
  LANGUAGES,
  NEARBY,
  readFinderState,
  runFinder,
  SIZE_BANDS,
  SORTS,
  STRONG,
  type FinderResult,
  type FinderState,
  type SortKey,
  type View,
} from "@/lib/advancedSearch/finder";
import { normaliseWeights } from "@/lib/aggregation/scoring";
import { cn } from "@/lib/cn";
import { getCountries } from "@/lib/dataset/cities";
import { manifest } from "@/lib/dataset/files";
import { scoreColor } from "@/lib/design-tokens";
import { REGION_LABELS, REGION_ORDER } from "@/lib/regions";
import { useScoreWeights, weightPercentagesToScores } from "@/lib/scoreWeights";
import { SECTION_LABELS, type CriterionValue, type SectionKey } from "@/lib/types";
import { formatDistanceKm, useUnitPreferences } from "@/lib/unitPreferences";
import { cityUrl, compareUrl, countryUrl, readFrom } from "@/lib/urls";

const DiscoverResultsMap = dynamic(() => import("@/components/explore/DiscoverResultsMap").then((m) => m.DiscoverResultsMap), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-surface-muted" />,
});

type Column = (i: number) => CriterionValue;

const PAGE = 30;
const MAP_POINTS = 200;
const MAX_COMPARE = 10;
const SECTION_ORDER: SectionKey[] = ["safetyStability", "economy", "climate", "liveability"];
const countryName = (cc: string) => manifest.countryNames[cc] ?? cc;

/** 520 (thousands) -> "520k"; 1,234 -> "1.2M". */
function populationText(k: number | null): string {
  if (k == null) return "";
  return k >= 1000 ? `${(k / 1000).toFixed(1).replace(/\.0$/, "")}M people` : `${Math.max(1, Math.round(k))}k people`;
}

const toggle = <T,>(values: T[], value: T) => (values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="py-4 border-b border-surface-border last:border-b-0">
      <h3 className="text-[11px] uppercase tracking-wide text-ink-500 mb-2.5">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** Type a country, pick it: narrows the search to it (several allowed). */
function CountryPicker({ selected, onAdd }: { selected: string[]; onAdd: (cc: string) => void }) {
  const [text, setText] = useState("");
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return Object.entries(manifest.countryNames)
      .filter(([cc, name]) => !selected.includes(cc) && name.toLowerCase().includes(q))
      .sort(([, a], [, b]) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)) || a.localeCompare(b))
      .slice(0, 6);
  }, [text, selected]);
  return (
    <div className="relative w-full">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) {
            onAdd(matches[0][0]);
            setText("");
          }
        }}
        placeholder="Add a country"
        className="w-full rounded-pill border border-surface-border bg-surface px-3 py-1.5 text-xs text-ink-900 placeholder:text-ink-300 focus:outline-none focus:border-piltri-amber"
      />
      {matches.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-card border border-surface-border bg-surface shadow-card py-1">
          {matches.map(([cc, name]) => (
            <li key={cc}>
              <button
                type="button"
                onClick={() => {
                  onAdd(cc);
                  setText("");
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-ink-700 hover:bg-surface-muted"
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Filters({ state, set }: { state: FinderState; set: (patch: Partial<FinderState>) => void }) {
  const { prefs } = useUnitPreferences();
  return (
    <div>
      <Group title="Where">
        {REGION_ORDER.map((r) => (
          <Chip key={r} active={state.regions.includes(r)} onClick={() => set({ regions: toggle(state.regions, r) })}>
            {REGION_LABELS[r]}
          </Chip>
        ))}
        {state.countries.map((cc) => (
          <Chip key={cc} active onClick={() => set({ countries: toggle(state.countries, cc) })} icon={<CloseIcon className="w-3 h-3" />}>
            {countryName(cc)}
          </Chip>
        ))}
        <div className="w-full mt-1">
          <CountryPicker selected={state.countries} onAdd={(cc) => set({ countries: [...state.countries, cc] })} />
        </div>
      </Group>

      <Group title="Size">
        {SIZE_BANDS.map((b) => (
          <Chip key={b.key} active={state.sizes.includes(b.key)} onClick={() => set({ sizes: toggle(state.sizes, b.key) })} hint={b.hint}>
            {b.label}
          </Chip>
        ))}
      </Group>

      <Group title="Climate">
        {CLIMATE.map((t) => (
          <Chip key={t.key} active={state.climate.includes(t.key)} onClick={() => set({ climate: toggle(state.climate, t.key) })} hint={t.hint(prefs)}>
            {t.label}
          </Chip>
        ))}
      </Group>

      <Group title="Within reach">
        {NEARBY.filter(available).map((t) => (
          <Chip key={t.key} active={state.nearby.includes(t.key)} onClick={() => set({ nearby: toggle(state.nearby, t.key) })} hint={t.hint(prefs)}>
            {t.label}
          </Chip>
        ))}
      </Group>

      <Group title="Strong in (score 70+)">
        {STRONG.map(({ key, section }) => {
          const Icon = SECTION_ICONS[section];
          return (
            <Chip key={key} active={state.strong.includes(key)} onClick={() => set({ strong: toggle(state.strong, key) })} icon={<Icon className="w-3.5 h-3.5" />}>
              {SECTION_LABELS[section]}
            </Chip>
          );
        })}
      </Group>

      <Group title="Official language">
        {LANGUAGES.map((l) => (
          <Chip key={l} active={state.languages.includes(l)} onClick={() => set({ languages: toggle(state.languages, l) })}>
            {l}
          </Chip>
        ))}
      </Group>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

function ResultRow({
  table,
  i,
  position,
  worldRank,
  score,
  population,
  facts,
  nearby,
  radius,
  picked,
  onPick,
}: {
  table: PlaceTable;
  i: number;
  /** Its place in this list (1 = first). */
  position: number;
  /** Its place among every city, by Piltri score with your score settings. */
  worldRank: number | null;
  score: number;
  population: number | null;
  facts: string[];
  nearby: number;
  radius: string;
  picked: boolean;
  onPick: () => void;
}) {
  const id = table.id(i);
  const sections = table.sections(i);
  const where = [table.region[i], countryName(table.cc[i])].filter(Boolean).join(", ");
  return (
    <li className="rounded-card border border-surface-border bg-surface flex items-stretch hover:border-piltri-amber-light transition-colors">
      <Link href={cityUrl(id)} className="flex-1 min-w-0 px-4 py-3 flex gap-3">
        <span className="w-6 flex-shrink-0 pt-1 text-right font-serif text-sm text-ink-300 tabular-nums lining-nums">{position}</span>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-lg text-ink-900 leading-tight truncate">{table.name[i]}</p>
          <p className="text-[11px] text-ink-500 truncate mt-0.5">
            {where}
            {population != null && <span className="text-ink-300"> · {populationText(population)}</span>}
          </p>
          <div className="mt-2 flex items-center gap-3">
            {SECTION_ORDER.map((key) => {
              const Icon = SECTION_ICONS[key];
              return (
                <span key={key} className="flex items-center gap-1 text-[11px] tabular-nums" title={SECTION_LABELS[key]} style={{ color: scoreColor(sections[key]) }}>
                  <Icon className="w-3.5 h-3.5 text-ink-300" />
                  {Math.round(sections[key])}
                </span>
              );
            })}
          </div>
          {facts.length > 0 && <p className="mt-1.5 text-[11px] text-piltri-amber-dark truncate">{facts.join(" · ")}</p>}
          {nearby > 0 && (
            <p className="mt-1 text-[11px] text-ink-300">
              + {nearby} more {nearby === 1 ? "match" : "matches"} within {radius}
            </p>
          )}
        </div>
        {/* The score, and where that puts it among every city - #1 here
         *  can be #77 overall (2026-10-16, on request). */}
        <div className="self-start flex flex-col items-end gap-1 flex-shrink-0">
          <ScoreBadge score={score} />
          {worldRank != null && (
            <span className="text-[10px] text-ink-500 tabular-nums whitespace-nowrap" title="Its rank among every city, by Piltri score">
              #{worldRank.toLocaleString("en-GB")} overall
            </span>
          )}
        </div>
      </Link>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={picked}
        title={picked ? "Remove from comparison" : "Add to comparison"}
        className={cn(
          "w-11 flex-shrink-0 border-l border-surface-border flex items-center justify-center transition-colors rounded-r-card",
          picked ? "bg-piltri-amber text-white" : "text-ink-300 hover:text-piltri-amber-dark hover:bg-piltri-amber-tint"
        )}
      >
        <PlusIcon className={cn("w-4 h-4 transition-transform", picked && "rotate-45")} />
      </button>
    </li>
  );
}

function CountriesView({ result, table, onOnly }: { result: FinderResult; table: PlaceTable; onOnly: (cc: string) => void }) {
  const max = result.byCountry[0]?.count ?? 1;
  return (
    <ul className="rounded-card border border-surface-border bg-surface divide-y divide-surface-border">
      {result.byCountry.slice(0, 100).map(({ cc, count, best }) => (
        <li key={cc} className="px-4 py-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <button type="button" onClick={() => onOnly(cc)} className="font-serif text-base text-ink-900 hover:text-piltri-amber-dark truncate">
                {countryName(cc)}
              </button>
              <span className="text-xs text-ink-500 tabular-nums flex-shrink-0">
                {count.toLocaleString("en-GB")} {count === 1 ? "place" : "places"}
              </span>
            </div>
            <div className="mt-1.5 h-1 rounded-pill bg-surface-muted overflow-hidden">
              <div className="h-full bg-piltri-amber-light rounded-pill" style={{ width: `${Math.max(2, (count / max) * 100)}%` }} />
            </div>
            <p className="text-[11px] text-ink-500 mt-1 truncate">
              Top match:{" "}
              <Link href={cityUrl(table.id(best))} className="text-ink-700 hover:text-piltri-amber-dark">
                {table.name[best]}
              </Link>
            </p>
          </div>
          <Link href={countryUrl(cc)} className="text-[11px] text-ink-500 hover:text-piltri-amber-dark whitespace-nowrap flex-shrink-0">
            Country data →
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/**
 * Advanced search (/search, redesigned 2026-10-11, on request: the old
 * page - pick a scope, fill in min/max boxes for 60 criteria, then open a
 * results page - was too hard to use). Now one page: plain choices as
 * chips on the left (lib/advancedSearch/finder.ts), matching places on the
 * right, updated on every tap. Results as a list, a map, or counted by
 * country (which replaces the old "search countries" scope). Every choice
 * is kept in the address, so a search can be shared or bookmarked. Tap "+"
 * on places to compare them side by side.
 */
function SearchContent() {
  const params = useSearchParams();
  const from = readFrom(params);
  const [state, setState] = useState<FinderState>(() => readFinderState(params));
  const set = (patch: Partial<FinderState>) => setState((s) => ({ ...s, ...patch }));
  const { weights } = useScoreWeights();
  const { prefs } = useUnitPreferences();

  const [table, setTable] = useState<PlaceTable | null>(null);
  const [languagesOf, setLanguagesOf] = useState<Record<string, string[]>>({});
  const [columns, setColumns] = useState<Record<string, Column>>({});
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // The address follows the choices (replaced, not pushed: Back leaves the
  // page rather than undoing taps one by one).
  useEffect(() => {
    const q = finderQuery(state, from);
    window.history.replaceState(window.history.state, "", q ? `/search?${q}` : "/search");
  }, [state, from]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPlaceTable(), getCountries()])
      .then(([t, countries]) => {
        if (cancelled) return;
        setTable(t);
        setLanguagesOf(Object.fromEntries(Object.entries(countries).map(([cc, c]) => [cc, c.demographics?.countryOfficialLanguages ?? []])));
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Columns the current choices read, fetched once each.
  const needed = columnsFor(state);
  const neededKey = needed.join("|");
  useEffect(() => {
    if (!table) return;
    const missing = needed.filter((key) => !columns[key]);
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map(async (key) => [key, await table.values(key)] as const))
      .then((loaded) => !cancelled && setColumns((c) => ({ ...c, ...Object.fromEntries(loaded) })))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, neededKey]);

  const normalised = useMemo(() => normaliseWeights(weightPercentagesToScores(weights)), [weights]);
  // Every city's rank by Piltri score (your weighting), for "#77 overall".
  const worldRank = useMemo(() => (table ? piltriRanks(table, normalised) : null), [table, normalised]);
  const ready = table != null && needed.every((key) => columns[key]);
  const fresh = useMemo(
    () => (ready ? runFinder(table, (key) => columns[key] ?? (() => null), languagesOf, normalised, state) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, table, columns, languagesOf, normalised, state.regions, state.countries, state.sizes, state.climate, state.nearby, state.strong, state.languages, state.sort]
  );
  // While a new column downloads, keep showing the last results.
  const last = useRef<FinderResult | null>(null);
  if (fresh) last.current = fresh;
  const result = fresh ?? last.current;

  useEffect(() => setShown(PAGE), [fresh]);

  const col = (key: string): Column => columns[key] ?? (() => null);
  const listed = result ? (state.every ? result.indices : result.heads) : [];
  const population = columns["demographics.population"];
  const count = result?.indices.length ?? 0;
  const filterCount = activeFilterCount(state);
  const countText = `${count.toLocaleString("en-GB")} ${count === 1 ? "place" : "places"}`;

  const mapPoints: MapPoint[] = useMemo(
    () =>
      table && result
        ? listed.slice(0, MAP_POINTS).map((i) => ({
            key: table.id(i),
            lat: table.lat[i],
            lng: table.lng[i],
            name: table.name[i],
            piltriScore: table.piltri(i, normalised),
            detailHref: cityUrl(table.id(i)),
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, result, normalised, state.every]
  );

  // Removable chips for what's chosen - shown above the results on phones,
  // where the filters sit behind a button.
  const chosen: { label: string; remove: () => void }[] = [
    ...state.regions.map((r) => ({ label: REGION_LABELS[r], remove: () => set({ regions: toggle(state.regions, r) }) })),
    ...state.countries.map((cc) => ({ label: countryName(cc), remove: () => set({ countries: toggle(state.countries, cc) }) })),
    ...SIZE_BANDS.filter((b) => state.sizes.includes(b.key)).map((b) => ({ label: b.label, remove: () => set({ sizes: toggle(state.sizes, b.key) }) })),
    ...CLIMATE.filter((t) => state.climate.includes(t.key)).map((t) => ({ label: t.label, remove: () => set({ climate: toggle(state.climate, t.key) }) })),
    ...NEARBY.filter((t) => state.nearby.includes(t.key)).map((t) => ({ label: t.label, remove: () => set({ nearby: toggle(state.nearby, t.key) }) })),
    ...STRONG.filter((s) => state.strong.includes(s.key)).map((s) => ({ label: `Strong ${SECTION_LABELS[s.section]}`, remove: () => set({ strong: toggle(state.strong, s.key) }) })),
    ...state.languages.map((l) => ({ label: l, remove: () => set({ languages: toggle(state.languages, l) }) })),
  ];

  const clearAll = () => setState((s) => ({ ...EMPTY_STATE, sort: s.sort, view: s.view, every: s.every }));

  return (
    <main className={cn("min-h-dvh flex flex-col bg-surface-muted", picked.length > 0 && "pb-20")}>
      <NavBar logoSide="left" />
      <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-10">
        <BackLink />
        <h1 className="font-serif text-3xl text-ink-900 mt-1">Advanced search</h1>

        <div className="mt-5 md:flex md:gap-6 md:items-start">
          {/* Filters: a side panel on desktop, a full-screen sheet on phones. */}
          <aside className="hidden md:block w-[320px] flex-shrink-0 sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto no-scrollbar rounded-card border border-surface-border bg-surface px-4">
            <div className="flex items-center justify-between pt-4">
              <h2 className="text-sm font-medium text-ink-900">Filters</h2>
              {filterCount > 0 && (
                <button type="button" onClick={clearAll} className="text-xs text-ink-500 hover:text-piltri-amber-dark">
                  Clear all
                </button>
              )}
            </div>
            <Filters state={state} set={set} />
          </aside>

          {sheetOpen && (
            <div className="md:hidden fixed inset-0 z-50 bg-surface flex flex-col">
              <div className="flex items-center justify-between px-4 h-14 border-b border-surface-border flex-shrink-0">
                <h2 className="font-serif text-xl text-ink-900">Filters</h2>
                <div className="flex items-center gap-4">
                  {filterCount > 0 && (
                    <button type="button" onClick={clearAll} className="text-xs text-ink-500">
                      Clear all
                    </button>
                  )}
                  <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close filters" className="text-ink-500">
                    <CloseIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4">
                <Filters state={state} set={set} />
              </div>
              <div className="p-4 border-t border-surface-border flex-shrink-0">
                <button type="button" onClick={() => setSheetOpen(false)} className="w-full rounded-pill bg-piltri-amber text-white py-3 text-sm font-medium">
                  Show {countText}
                </button>
              </div>
            </div>
          )}

          <section className="flex-1 min-w-0">
            {/* Count, sort and view */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="md:hidden flex items-center gap-1.5 rounded-pill border border-surface-border bg-surface px-3 py-1.5 text-xs text-ink-900"
              >
                <FilterIcon className="w-3.5 h-3.5" />
                Filters
                {filterCount > 0 && <span className="rounded-pill bg-piltri-amber text-white px-1.5 text-[10px] tabular-nums">{filterCount}</span>}
              </button>
              <p className="text-sm text-ink-900 tabular-nums mr-auto" aria-live="polite">
                {result ? <span className="font-medium">{countText}</span> : <span className="text-ink-500">Loading places…</span>}
              </p>
              <select
                value={state.sort}
                onChange={(e) => set({ sort: e.target.value as SortKey })}
                aria-label="Sort"
                className="rounded-pill border border-surface-border bg-surface px-3 py-1.5 text-xs text-ink-900 focus:outline-none focus:border-piltri-amber"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    Sort: {s.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center rounded-pill border border-surface-border bg-surface overflow-hidden text-xs">
                {(["list", "map", "countries"] as View[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => set({ view: v })}
                    className={cn("px-3 py-1.5 capitalize transition-colors", state.view === v ? "bg-piltri-amber text-white" : "text-ink-500 hover:bg-surface-muted")}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {result && count > 0 && state.view !== "countries" && (
              <label className="mt-2.5 w-fit flex items-center gap-2 text-[11px] text-ink-500 cursor-pointer select-none">
                <input type="checkbox" checked={!state.every} onChange={(e) => set({ every: !e.target.checked })} className="accent-piltri-amber" />
                One per neighbourhood ({formatDistanceKm(GROUP_KM, prefs)})
                {!state.every && result.heads.length < count && <span className="text-ink-300">· {result.heads.length.toLocaleString("en-GB")} shown</span>}
              </label>
            )}

            {chosen.length > 0 && (
              <div className="md:hidden mt-3 flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4">
                {chosen.map((c) => (
                  <Chip key={c.label} active onClick={c.remove} icon={<CloseIcon className="w-3 h-3" />}>
                    {c.label}
                  </Chip>
                ))}
              </div>
            )}

            <div className="mt-4">
              {failed ? (
                <p className="text-sm text-score-weak">Couldn&apos;t load the places - please try again.</p>
              ) : !table || !result ? (
                <ul className="grid gap-3 lg:grid-cols-2">
                  {Array.from({ length: 8 }, (_, k) => (
                    <li key={k} className="h-[104px] rounded-card border border-surface-border bg-surface animate-pulse" />
                  ))}
                </ul>
              ) : count === 0 ? (
                <div className="rounded-card border border-surface-border bg-surface px-5 py-8 text-center">
                  <p className="text-sm text-ink-900">No place has all of these.</p>
                  <p className="text-xs text-ink-500 mt-1">Remove one to widen the search:</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    {chosen.map((c) => (
                      <Chip key={c.label} active onClick={c.remove} icon={<CloseIcon className="w-3 h-3" />}>
                        {c.label}
                      </Chip>
                    ))}
                  </div>
                </div>
              ) : state.view === "map" ? (
                <div>
                  <div className="h-[65dvh] md:h-[calc(100dvh-14rem)] rounded-card overflow-hidden border border-surface-border">
                    <DiscoverResultsMap points={mapPoints} />
                  </div>
                  {listed.length > MAP_POINTS && <p className="mt-2 text-[11px] text-ink-500">Showing the top {MAP_POINTS}.</p>}
                </div>
              ) : state.view === "countries" ? (
                <CountriesView result={result} table={table} onOnly={(cc) => set({ countries: [cc], regions: [], view: "list" })} />
              ) : (
                <>
                  <ul className="grid gap-3 lg:grid-cols-2">
                    {listed.slice(0, shown).map((i, k) => {
                      const id = table.id(i);
                      return (
                        <ResultRow
                          key={id}
                          table={table}
                          i={i}
                          position={k + 1}
                          worldRank={worldRank ? worldRank[i] : null}
                          score={table.piltri(i, normalised)}
                          population={population ? (population(i) as number | null) : null}
                          facts={factsFor(col, i, state, prefs)}
                          nearby={state.every ? 0 : (result.nearby.get(i) ?? 0)}
                          radius={formatDistanceKm(GROUP_KM, prefs)}
                          picked={picked.includes(id)}
                          onPick={() => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_COMPARE ? [...p, id] : p))}
                        />
                      );
                    })}
                  </ul>
                  {listed.length > shown && (
                    <button
                      type="button"
                      onClick={() => setShown((n) => n + PAGE)}
                      className="mt-4 w-full rounded-pill border border-surface-border bg-surface py-2.5 text-xs text-ink-700 hover:border-piltri-amber-light"
                    >
                      Show more ({(listed.length - shown).toLocaleString("en-GB")} left)
                    </button>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Compare tray: places picked with "+". */}
      {picked.length > 0 && table && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-surface-border bg-surface/95 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
            <p className="text-xs text-ink-700 min-w-0 truncate flex-1">
              <span className="font-medium text-ink-900">{picked.length} picked</span>
              <span className="hidden sm:inline text-ink-500"> · up to {MAX_COMPARE}</span>
            </p>
            <button type="button" onClick={() => setPicked([])} className="text-xs text-ink-500 hover:text-ink-900">
              Clear
            </button>
            <Link
              href={compareUrl(picked)}
              className={cn(
                "rounded-pill px-4 py-2 text-xs font-medium",
                picked.length > 1 ? "bg-piltri-amber text-white" : "bg-surface-muted text-ink-300 pointer-events-none"
              )}
              aria-disabled={picked.length < 2}
            >
              Compare {picked.length > 1 ? picked.length : ""} →
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchContent />
    </Suspense>
  );
}
