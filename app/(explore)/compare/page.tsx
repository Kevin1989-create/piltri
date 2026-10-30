"use client";

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BACK_LINK_CLASS } from "@/components/ui/BackLink";
import { NavBar } from "@/components/ui/NavBar";
import { SearchBar } from "@/components/ui/SearchBar";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { KpiInfoButton } from "@/components/explore/KpiInfo";
import { ChevronDown, CloseIcon, IconDemographics, SECTION_ICONS } from "@/components/ui/icons";
import { computePiltriScore, normaliseWeights } from "@/lib/aggregation/scoring";
import { biggestDifferences, type Difference } from "@/lib/compareFacts";
import { cn } from "@/lib/cn";
import { getCityExploreData } from "@/lib/dataset/cities";
import { buildKpiRows, type KpiRow } from "@/lib/kpiRows";
import { useScoreWeights, weightPercentagesToScores } from "@/lib/scoreWeights";
import { formatUtcOffset } from "@/lib/timezone";
import { SECTION_LABELS, type CityExploreData, type CitySearchResult, type SectionKey } from "@/lib/types";
import { useUnitPreferences, type UnitPreferences } from "@/lib/unitPreferences";
import { cityUrl, compareUrl, HOME_URL, readCityRef, type CityRef } from "@/lib/urls";

const MAX_COLUMNS = 10;
const SECTION_ORDER: SectionKey[] = ["safetyStability", "economy", "climate", "liveability"];

/** One colour per place, so the score chart, the differences and the
 *  table's headers tie together. Chosen to stay clear of the green / amber
 *  / red score colours. */
const PLACE_COLORS = ["#BA7517", "#3B6EA8", "#2F8F83", "#8E4C8A", "#6B7F2A", "#C0563F", "#5A5A8C", "#2D6A4F", "#A0522D", "#4A6FA5"];

interface ColumnState {
  /** The place's city id once known (it's what the address lists). */
  id: string | null;
  data: CityExploreData | null;
  loading: boolean;
  error: string | null;
}

/** The places in the address: /compare?id=lyon-fr&id=paris-fr, or an older
 *  link's single place (lib/urls.ts). */
function refsFromParams(params: URLSearchParams): CityRef[] {
  const ids = params.getAll("id").filter(Boolean);
  if (ids.length) return ids.slice(0, MAX_COLUMNS).map((id) => readCityRef(new URLSearchParams({ id }))!);
  const legacy = readCityRef(params);
  return legacy ? [legacy] : [];
}

async function fetchPlace(ref: Pick<CityRef, "id" | "countryCode" | "lat" | "lng">): Promise<CityExploreData> {
  const data = await getCityExploreData(ref.countryCode, ref.id, ref.lat, ref.lng);
  if (!data) throw new Error("No data for this place.");
  return data;
}

/* ------------------------------------------------------------------ */
/* Table rows                                                          */
/* ------------------------------------------------------------------ */

interface Cell {
  value: string;
  suffix?: string;
  colorClass?: string;
}

interface Row {
  label: string;
  /** For the info button (section figures). */
  info?: KpiRow;
  cells: (Cell | null)[];
}

interface Group {
  key: SectionKey | "demographics";
  title: string;
  /** Section score per place (null: no data, or not loaded). */
  scores?: (number | null)[];
  rows: Row[];
}

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(n));

function demographicsRows(places: (CityExploreData | null)[]): Row[] {
  const grey = (value: string | null): Cell | null => (value == null ? null : { value, colorClass: "text-ink-500" });
  const row = (label: string, get: (d: CityExploreData) => string | null): Row => ({ label, cells: places.map((d) => (d ? grey(get(d)) : null)) });
  return [
    row("Population", (d) => (d.demographics.cityPopulation != null ? d.demographics.cityPopulation.toLocaleString("en-GB") : null)),
    row("Density (within 5 km)", (d) => (d.demographics.cityDensityPerKm2 != null ? `${compact(d.demographics.cityDensityPerKm2)}/km²` : null)),
    row("Time zone", (d) => (d.demographics.timezone ? formatUtcOffset(d.demographics.timezone) : null)),
    row("Average age (within 5 km)", (d) => (d.demographics.cityMedianAge != null ? String(Math.round(d.demographics.cityMedianAge)) : null)),
    row("Population growth 2020-25 (5 km)", (d) =>
      d.demographics.cityPopulationGrowth5yrPct != null ? `${d.demographics.cityPopulationGrowth5yrPct > 0 ? "+" : ""}${d.demographics.cityPopulationGrowth5yrPct}%` : null
    ),
    row("Country", (d) => d.country),
    row("Country population", (d) => (d.demographics.countryPopulation != null ? compact(d.demographics.countryPopulation) : null)),
    row("Country average age", (d) => (d.demographics.countryAverageAge != null ? String(d.demographics.countryAverageAge) : null)),
    row("Official language", (d) => (d.demographics.countryOfficialLanguages?.length ? d.demographics.countryOfficialLanguages.join(", ") : null)),
  ];
}

/** A section's figures for every place, lined up by label. */
function sectionRows(section: SectionKey, places: (CityExploreData | null)[], prefs: UnitPreferences): Row[] {
  const perPlace = places.map((d) => (d ? buildKpiRows(section, d, prefs) : []));
  const labels: string[] = [];
  for (const rows of perPlace) for (const r of rows) if (!labels.includes(r.label)) labels.push(r.label);
  return labels.map((label) => {
    const found = perPlace.map((rows) => rows.find((r) => r.label === label) ?? null);
    return {
      label,
      info: found.find((r) => r != null) ?? undefined,
      cells: found.map((r) => (r ? { value: r.value, suffix: r.valueSuffix ?? (r.note ? `· ${r.note}` : undefined), colorClass: r.colorClass } : null)),
    };
  });
}

/** Every loaded place shows the same thing (nothing to compare). */
const isSame = (row: Row) => {
  const shown = row.cells.filter((c): c is Cell => c != null).map((c) => `${c.value}|${c.suffix ?? ""}`);
  return shown.length === row.cells.length && shown.every((s) => s === shown[0]);
};

/* ------------------------------------------------------------------ */
/* At a glance: score chart + biggest differences                      */
/* ------------------------------------------------------------------ */

function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block w-2.5 h-2.5 rounded-full flex-shrink-0", className)} style={{ backgroundColor: color }} />;
}

/** Each score as a dot on a 0-100 line, one colour per place: the gaps
 *  read at a glance. */
function ScoreGaps({ places, piltri }: { places: { data: CityExploreData; color: string }[]; piltri: number[] }) {
  const rows: { label: string; scores: (number | null)[] }[] = [
    { label: "Piltri score", scores: piltri },
    ...SECTION_ORDER.map((key) => ({
      label: SECTION_LABELS[key],
      scores: places.map(({ data }) => (data.sectionsWithoutData.includes(key) ? null : data.sectionScores[key])),
    })),
  ];
  return (
    <div className="space-y-3">
      {rows.map(({ label, scores }) => {
        const known = scores.map((s, i) => ({ s, i })).filter((x): x is { s: number; i: number } => x.s != null);
        const best = known.length ? known.reduce((a, b) => (b.s > a.s ? b : a)) : null;
        const worst = known.length ? known.reduce((a, b) => (b.s < a.s ? b : a)) : null;
        const gap = best && worst ? Math.round(best.s) - Math.round(worst.s) : 0;
        return (
          <div key={label}>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-ink-700">{label}</span>
              {best && gap > 0 && (
                <span className="text-ink-500 truncate">
                  {places[best.i].data.cityName} <span className="tabular-nums">+{gap}</span>
                </span>
              )}
            </div>
            <div className="relative h-4 mt-1">
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-surface-border" />
              {known.length > 1 && worst && best && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-1 rounded-pill bg-ink-100"
                  style={{ left: `${worst.s}%`, width: `${Math.max(0, best.s - worst.s)}%` }}
                />
              )}
              {known.map(({ s, i }) => (
                <span
                  key={i}
                  title={`${places[i].data.cityName}: ${Math.round(s)}`}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-surface"
                  style={{ left: `${s}%`, backgroundColor: places[i].color }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DifferenceItem({ diff, places, prefs }: { diff: Difference; places: { data: CityExploreData; color: string }[]; prefs: UnitPreferences }) {
  const two = places.length === 2;
  const { fact, high, low } = diff;
  const leadUp = fact.lead === "up";
  const lead = leadUp ? high : low;
  const other = leadUp ? low : high;
  const phrase = (leadUp ? fact.up : fact.down)[two ? 0 : 1];
  const otherPhrase = (leadUp ? fact.down : fact.up)[1];
  return (
    <li className="py-2.5">
      <p className="text-sm text-ink-900 leading-snug flex items-start gap-2">
        <Dot color={places[lead.index].color} className="mt-1.5" />
        <span>
          <span className="font-medium">{places[lead.index].data.cityName}</span> {phrase}
        </span>
      </p>
      <p className="text-[11px] text-ink-500 mt-0.5 pl-[18px]">
        {two
          ? `${fact.show(lead.value, prefs)} vs ${fact.show(other.value, prefs)} · ${fact.label.toLowerCase()}`
          : `${fact.show(lead.value, prefs)} · ${places[other.index].data.cityName} ${otherPhrase} (${fact.show(other.value, prefs)})`}
      </p>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/**
 * Compare (/compare?id=…&id=…, redesigned 2026-10-11): the places side by
 * side in one table, every figure on its own row so values line up, with
 * an "At a glance" panel - each score as a dot on one line per section,
 * and the biggest differences in words (lib/compareFacts.ts). Sections
 * fold away; "Hide rows that are the same" drops what doesn't tell them
 * apart (two French cities share every country figure). Up to 10 places;
 * the address lists them, so a comparison can be reloaded or shared.
 */
function CompareContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { prefs } = useUnitPreferences();
  const { weights } = useScoreWeights();
  const [columns, setColumns] = useState<ColumnState[]>([]);
  const [originId, setOriginId] = useState<string | null>(null);
  const [hideSame, setHideSame] = useState(false);
  const [closed, setClosed] = useState<string[]>([]);
  // Set once places have been added or removed here: only then may an
  // empty list clear the address (not on the first render, before the
  // address's places are even read).
  const edited = useRef(false);

  useEffect(() => {
    const refs = refsFromParams(params);
    if (!refs.length) return;
    setOriginId(refs[0].id);
    setColumns(refs.map((ref) => ({ id: ref.id, data: null, loading: true, error: null })));
    refs.forEach((ref, index) => {
      fetchPlace(ref)
        .then((data) => setColumns((cur) => cur.map((slot, i) => (i === index ? { id: data.cityId, data, loading: false, error: null } : slot))))
        .catch((err) => setColumns((cur) => cur.map((slot, i) => (i === index ? { ...slot, loading: false, error: err.message ?? "Failed to load." } : slot))));
    });
    // Seeds the columns once, from the first address - the address then
    // follows the columns (below), not the other way round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps the address listing the places shown (and tidies an older link).
  const idsKey = columns.map((c) => (c.loading ? "…" : c.id ?? "")).join(",");
  useEffect(() => {
    const ids = columns.flatMap((c) => (c.id ? [c.id] : []));
    if (columns.some((c) => c.loading) || (!ids.length && !edited.current)) return;
    const next = ids.length ? compareUrl(ids) : "/compare";
    if (`${window.location.pathname}${window.location.search}` !== next) router.replace(next, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  function addCity(city: CitySearchResult) {
    if (columns.length >= MAX_COLUMNS || columns.some((c) => c.id === city.cityId)) return;
    edited.current = true;
    // The new slot's index, fixed now, so adding several places quickly
    // can't resolve into the wrong column.
    let index = -1;
    setColumns((cur) => {
      index = cur.length;
      return [...cur, { id: city.cityId, data: null, loading: true, error: null }];
    });
    fetchPlace({ id: city.cityId, countryCode: city.countryCode, lat: city.lat, lng: city.lng })
      .then((data) => setColumns((cur) => cur.map((slot, i) => (i === index ? { id: data.cityId, data, loading: false, error: null } : slot))))
      .catch((err) => setColumns((cur) => cur.map((slot, i) => (i === index ? { ...slot, loading: false, error: err.message ?? "Failed to load." } : slot))));
  }

  const removeColumn = (index: number) => {
    edited.current = true;
    setColumns((cur) => cur.filter((_, i) => i !== index));
  };

  const normalised = useMemo(() => normaliseWeights(weightPercentagesToScores(weights)), [weights]);
  const datas = columns.map((c) => c.data);
  const piltri = datas.map((d) => (d ? computePiltriScore(d.sectionScores, normalised) : null));
  const loaded = columns.flatMap((c, i) => (c.data ? [{ data: c.data, color: PLACE_COLORS[i % PLACE_COLORS.length], piltri: piltri[i]! }] : []));

  const groups: Group[] = useMemo(
    () => [
      { key: "demographics", title: "Demographics", rows: demographicsRows(datas) },
      ...SECTION_ORDER.map((key) => ({
        key,
        title: SECTION_LABELS[key],
        scores: datas.map((d) => (d && !d.sectionsWithoutData.includes(key) ? d.sectionScores[key] : null)),
        rows: sectionRows(key, datas, prefs),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey, prefs]
  );
  const differences = useMemo(() => biggestDifferences(loaded.map((p) => p.data)), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroup = (key: string) => setClosed((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));

  return (
    <main className="min-h-dvh flex flex-col bg-surface-muted">
      <NavBar logoSide="left" />

      <div className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 pt-5 pb-10">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <Link href={originId ? cityUrl(originId) : HOME_URL} className={BACK_LINK_CLASS}>
              <span aria-hidden className="text-base leading-none">←</span>
              {originId ? "Back to results" : "Back to home"}
            </Link>
            <h1 className="font-serif text-3xl text-ink-900 mt-1">Compare</h1>
          </div>
          {columns.length < MAX_COLUMNS && (
            <div className="w-full md:w-[320px]">
              <SearchBar variant="compact" placeholder={columns.length ? "Add a place to compare" : "Search for a place to compare"} onSelectCity={addCity} />
            </div>
          )}
        </div>

        {columns.length === 0 ? (
          <p className="mt-10 text-sm text-ink-500">Search for two or more places to see them side by side.</p>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
            {/* At a glance - first on phones, a side panel on desktop. */}
            <aside className="lg:order-2 lg:sticky lg:top-4 rounded-card border border-surface-border bg-surface p-4">
              <h2 className="font-serif text-lg text-ink-900">At a glance</h2>
              {loaded.length < 2 ? (
                <p className="text-xs text-ink-500 mt-2">Add another place to see where they differ.</p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                    {loaded.map((p) => (
                      <span key={p.data.cityId} className="flex items-center gap-1.5 text-[11px] text-ink-700">
                        <Dot color={p.color} />
                        {p.data.cityName}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3">
                    <ScoreGaps places={loaded} piltri={loaded.map((p) => p.piltri)} />
                  </div>
                  <h3 className="mt-5 text-[11px] uppercase tracking-wide text-ink-500">Biggest differences</h3>
                  {differences.length ? (
                    <ul className="divide-y divide-surface-border">
                      {differences.map((d) => (
                        <DifferenceItem key={d.fact.key} diff={d} places={loaded} prefs={prefs} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-500 mt-2">These places are much alike - no big gaps in the main figures.</p>
                  )}
                </>
              )}
            </aside>

            {/* The table: a row per figure, a column per place. */}
            <section className="lg:order-1 min-w-0 rounded-card border border-surface-border bg-surface overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-surface-border">
                <p className="text-xs text-ink-500">
                  {columns.length} / {MAX_COLUMNS} places
                </p>
                <label className="flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
                  <input type="checkbox" checked={hideSame} onChange={(e) => setHideSame(e.target.checked)} className="accent-piltri-amber" />
                  Hide rows that are the same
                </label>
              </div>
              <div className="overflow-auto max-h-[80dvh] lg:max-h-[calc(100dvh-9rem)]">
                <table className="border-separate border-spacing-0 w-max min-w-full text-sm">
                  <thead>
                    <tr>
                      <th className="sticky top-0 left-0 z-30 bg-surface border-b border-surface-border w-[112px] min-w-[112px] sm:w-[180px] sm:min-w-[180px]" />
                      {columns.map((slot, i) => (
                        <th
                          key={i}
                          className="sticky top-0 z-20 bg-surface border-b border-l border-surface-border px-2 sm:px-3 py-3 text-left align-top font-normal w-[114px] min-w-[114px] sm:w-[180px] sm:min-w-[180px]"
                        >
                          <div className="flex items-start gap-1 sm:gap-2">
                            <Dot color={PLACE_COLORS[i % PLACE_COLORS.length]} className="mt-2" />
                            <div className="min-w-0 flex-1">
                              {slot.data ? (
                                <>
                                  <Link href={cityUrl(slot.data.cityId)} className="block font-serif text-base text-ink-900 leading-tight hover:text-piltri-amber-dark break-words">
                                    {slot.data.cityName}
                                  </Link>
                                  <p className="text-[11px] text-ink-500 truncate">{slot.data.country}</p>
                                  <div className="mt-1.5 flex items-center gap-1.5">
                                    <span className="text-[10px] uppercase tracking-wide text-ink-300">Piltri</span>
                                    <ScoreBadge score={piltri[i]} size="sm" />
                                  </div>
                                </>
                              ) : (
                                <p className={cn("text-xs pt-1", slot.error ? "text-score-weak" : "text-ink-500")}>{slot.error ?? "Loading…"}</p>
                              )}
                            </div>
                            <button type="button" onClick={() => removeColumn(i)} aria-label="Remove from comparison" className="text-ink-300 hover:text-ink-900 mt-0.5">
                              <CloseIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => {
                      const open = !closed.includes(group.key);
                      const Icon = group.key === "demographics" ? IconDemographics : SECTION_ICONS[group.key];
                      const rows = hideSame ? group.rows.filter((r) => !isSame(r)) : group.rows;
                      return (
                        <Fragment key={group.key}>
                          <tr className="cursor-pointer group" onClick={() => toggleGroup(group.key)}>
                            <th className="sticky left-0 z-10 bg-piltri-amber-tint border-b border-surface-border px-2 sm:px-3 py-2 text-left font-normal">
                              <span className="flex items-center gap-2">
                                <Icon className="hidden sm:block w-4 h-4 text-piltri-amber flex-shrink-0" />
                                <span className="font-serif font-semibold text-piltri-amber-dark text-[13px] sm:text-sm leading-tight">{group.title}</span>
                                <ChevronDown className={cn("hidden sm:block w-3.5 h-3.5 text-ink-300 transition-transform ml-auto", open && "rotate-180")} />
                              </span>
                            </th>
                            {columns.map((slot, i) => (
                              <td key={i} className="bg-piltri-amber-tint border-b border-l border-surface-border px-2 sm:px-3 py-2">
                                {group.scores && slot.data && <ScoreBadge score={group.scores[i]} size="sm" />}
                              </td>
                            ))}
                          </tr>
                          {open &&
                            rows.map((row) => (
                              <tr key={row.label} className="hover:bg-surface-muted/60">
                                <th className="sticky left-0 z-10 bg-surface border-b border-surface-border px-2 sm:px-3 py-2 text-left font-normal align-top">
                                  <span className="flex items-start gap-1">
                                    <span className="text-[11px] text-ink-500 leading-snug">{row.label}</span>
                                    {row.info && <KpiInfoButton row={row.info} className="hidden sm:inline-flex ml-auto flex-shrink-0" />}
                                  </span>
                                </th>
                                {row.cells.map((cell, i) => (
                                  <td key={i} className="border-b border-l border-surface-border px-2 sm:px-3 py-2 align-top">
                                    {cell ? (
                                      <span className={cn("text-[13px] font-medium leading-snug break-words", cell.colorClass ?? "text-ink-900")}>
                                        {cell.value}
                                        {cell.suffix && <span className="text-[11px] font-normal"> {cell.suffix}</span>}
                                      </span>
                                    ) : (
                                      columns[i].data && <span className="text-[11px] text-ink-300">-</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          {open && hideSame && rows.length === 0 && (
                            <tr>
                              <td colSpan={columns.length + 1} className="border-b border-surface-border px-3 py-2 text-[11px] text-ink-300">
                                Every figure here is the same for these places.
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareContent />
    </Suspense>
  );
}
