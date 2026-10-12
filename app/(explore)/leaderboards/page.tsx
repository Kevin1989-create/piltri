"use client";

import { useEffect, useMemo, useState, type ReactNode, type SVGProps } from "react";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { BackLink } from "@/components/ui/BackLink";
import { Chip } from "@/components/ui/Chip";
import { IconEconomy, IconLiveability, IconSafety, TrophyIcon } from "@/components/ui/icons";
import { getPlaceTable, type PlaceTable } from "@/lib/advancedSearch/engine";
import { normaliseWeights } from "@/lib/aggregation/scoring";
import { cn } from "@/lib/cn";
import { BOARDS, LEADERBOARD_COLUMNS, rankBoard, SIZE_LABELS, SIZE_ORDER, type BoardKey, type Entry, type Filters } from "@/lib/leaderboards";
import { REGION_LABELS, REGION_ORDER } from "@/lib/regions";
import { useScoreWeights, weightPercentagesToScores } from "@/lib/scoreWeights";
import { useUnitPreferences } from "@/lib/unitPreferences";
import { cityUrl } from "@/lib/urls";
import type { CriterionValue } from "@/lib/types";

/* ---- Board icons: the section icons where there is one, simple line
 *      drawings for the rest. ---- */
const line = (props: SVGProps<SVGSVGElement>, children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    {children}
  </svg>
);
const ICONS: Record<BoardKey, (p: SVGProps<SVGSVGElement>) => ReactNode> = {
  overall: (p) => <TrophyIcon {...p} />,
  safest: (p) => <IconSafety {...p} />,
  qualityOfLife: (p) => <IconLiveability {...p} />,
  economy: (p) => <IconEconomy {...p} />,
  eternalSpring: (p) => line(p, <><circle cx="12" cy="12" r="2.2" /><path d="M12 4.5c1.8 1.8 1.8 3.6 0 5.3-1.8-1.7-1.8-3.5 0-5.3zM12 14.2c1.8 1.7 1.8 3.5 0 5.3-1.8-1.8-1.8-3.6 0-5.3zM4.5 12c1.8-1.8 3.6-1.8 5.3 0-1.7 1.8-3.5 1.8-5.3 0zM14.2 12c1.7-1.8 3.5-1.8 5.3 0-1.8 1.8-3.6 1.8-5.3 0z" /></>),
  sunniest: (p) => line(p, <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>),
  cleanAir: (p) => line(p, <path d="M3 8.5h11a2.5 2.5 0 10-2.5-2.5M3 12.5h15a2.5 2.5 0 11-2.5 2.5M3 16.5h7" />),
  fastInternet: (p) => line(p, <path d="M13 2.5L5 13.5h6l-1 8 8-11h-6l1-8z" />),
  beachLife: (p) => line(p, <><path d="M3 18c2 0 2-1.5 4.5-1.5S9.5 18 12 18s2.5-1.5 4.5-1.5S19 18 21 18" /><path d="M12 15V6M12 6c-2.5 0-4.5 1.5-5 3.5 1.5-1 3.5-1 5-.5M12 6c2.5 0 4.5 1.5 5 3.5-1.5-1-3.5-1-5-.5" /></>),
  familyFriendly: (p) => line(p, <><circle cx="8" cy="6.5" r="2.2" /><circle cx="16.5" cy="9" r="1.8" /><path d="M4.5 20v-4.5A3.5 3.5 0 018 12a3.5 3.5 0 013.5 3.5V20M13.5 20v-3a3 3 0 016 0v3" /></>),
};

/* ---- One board ---- */
const PODIUM = [
  // Shown left to right: 2nd, 1st, 3rd.
  { place: 1, block: "h-10 bg-ink-100 text-ink-700" },
  { place: 0, block: "h-14 bg-piltri-amber text-white" },
  { place: 2, block: "h-7 bg-piltri-amber-light/50 text-piltri-amber-dark" },
];

function Board({ boardKey, title, blurb, entries }: { boardKey: BoardKey; title: string; blurb: string; entries: Entry[] }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ICONS[boardKey];
  const rest = entries.slice(3, expanded ? 50 : 10);
  return (
    <section id={boardKey} className="scroll-mt-4 rounded-card border border-surface-border bg-surface flex flex-col">
      <header className="px-5 pt-5 flex items-start gap-3">
        <span className="w-9 h-9 flex-shrink-0 rounded-full bg-piltri-amber-tint text-piltri-amber flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-serif text-xl font-semibold text-ink-900 leading-tight">{title}</h2>
          <p className="text-[11px] text-ink-500 leading-snug mt-0.5">{blurb}</p>
        </div>
      </header>

      {entries.length === 0 ? (
        <p className="px-5 py-10 text-sm text-ink-500 text-center">No place matches these filters.</p>
      ) : (
        <>
          {/* Podium: the top three, the winner in the middle. */}
          <div className="mt-4 px-4 grid grid-cols-3 gap-2 items-end">
            {PODIUM.map(({ place, block }) => {
              const e = entries[place];
              if (!e) return <div key={place} />;
              return (
                <div key={place} className="min-w-0 flex flex-col items-center text-center">
                  <Link href={cityUrl(e.id)} className="min-w-0 max-w-full group" title={`${e.name}, ${e.country}`}>
                    <p className={cn("font-medium text-ink-900 leading-tight line-clamp-2 group-hover:text-piltri-amber-dark", place === 0 ? "text-sm" : "text-xs")}>
                      {e.name}
                    </p>
                    <p className="text-[10px] text-ink-500 truncate">{e.country}</p>
                  </Link>
                  <p className="font-serif text-piltri-amber-dark tabular-nums lining-nums text-sm mt-1">{e.shown}</p>
                  <div className={cn("mt-1.5 w-full rounded-t-lg flex items-start justify-center pt-1 font-serif font-semibold lining-nums text-sm", block)}>
                    {place + 1}
                  </div>
                </div>
              );
            })}
          </div>

          <ol className="border-t border-surface-border divide-y divide-surface-border">
            {rest.map((e) => (
              <li key={e.id}>
                <Link href={cityUrl(e.id)} className="flex items-center gap-3 px-5 py-2 hover:bg-surface-muted">
                  <span className="w-6 text-xs text-ink-300 tabular-nums text-right flex-shrink-0">{e.rank}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm text-ink-900">{e.name}</span>
                    <span className="text-[11px] text-ink-500"> · {e.country}</span>
                  </span>
                  <span className="text-sm text-ink-700 tabular-nums flex-shrink-0">{e.shown}</span>
                </Link>
              </li>
            ))}
          </ol>
          {entries.length > 10 && (
            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              className="mt-auto border-t border-surface-border px-5 py-2.5 text-xs text-ink-500 hover:text-piltri-amber-dark text-left"
            >
              {expanded ? "Show the top 10" : `Show the top ${entries.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Leaderboards (/leaderboards, reached from a city page): ten rankings of
 * every place - overall, safety, quality of life, economy, and six of a
 * kind (eternal spring, sun, clean air, internet, beach life, family) -
 * worked out in the browser from the same files as Advanced search
 * (lib/leaderboards.ts). Region and size filters; at most 3 per country by
 * default, so a ranking driven by country-level figures (safety, economy)
 * isn't one country's towns all tied at the top.
 */
export default function LeaderboardsPage() {
  const { weights } = useScoreWeights();
  const { prefs } = useUnitPreferences();
  const [table, setTable] = useState<PlaceTable | null>(null);
  const [columns, setColumns] = useState<Record<string, (i: number) => CriterionValue> | null>(null);
  const [failed, setFailed] = useState(false);
  const [filters, setFilters] = useState<Filters>({ region: "world", size: "50k", perCountry: 3 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await getPlaceTable();
      const loaded = await Promise.all(LEADERBOARD_COLUMNS.map(async (key) => [key, await t.values(key)] as const));
      if (cancelled) return;
      setTable(t);
      setColumns(Object.fromEntries(loaded));
    })().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const boards = useMemo(() => {
    if (!table || !columns) return null;
    const ctx = { table, weights: normaliseWeights(weightPercentagesToScores(weights)), col: (key: string) => columns[key] ?? (() => null) };
    return BOARDS.map((def) => ({ def, entries: rankBoard(def, ctx, filters, prefs) }));
  }, [table, columns, weights, filters, prefs]);

  return (
    <main className="min-h-dvh flex flex-col bg-surface-muted">
      <NavBar logoSide="left" />
      <div className="px-4 sm:px-6 pt-6 sm:pt-8 pb-16">
        <div className="max-w-6xl mx-auto">
          <BackLink />
          <h1 className="font-serif text-3xl sm:text-4xl text-ink-900 mt-2">Leaderboards</h1>
          <p className="text-sm text-ink-500 mt-1">The world&apos;s best places, ten ways.</p>

          {/* Filters: region, size, one per country. */}
          <div className="mt-6 space-y-2.5">
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
              <Chip active={filters.region === "world"} onClick={() => setFilters((f) => ({ ...f, region: "world" }))}>
                World
              </Chip>
              {REGION_ORDER.map((r) => (
                <Chip key={r} active={filters.region === r} onClick={() => setFilters((f) => ({ ...f, region: r }))}>
                  {REGION_LABELS[r]}
                </Chip>
              ))}
            </div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap items-center">
              {SIZE_ORDER.map((s) => (
                <Chip key={s} active={filters.size === s} onClick={() => setFilters((f) => ({ ...f, size: s }))}>
                  {SIZE_LABELS[s]}
                </Chip>
              ))}
            </div>
            <label className="w-fit flex items-center gap-2 text-xs text-ink-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filters.perCountry != null}
                onChange={(e) => {
                  const capped = e.target.checked;
                  setFilters((f) => ({ ...f, perCountry: capped ? 3 : null }));
                }}
                className="accent-piltri-amber"
              />
              At most 3 per country
            </label>
          </div>

          {/* Jump to a board - ten of them make a long page on a phone. */}
          <nav aria-label="Boards" className="mt-5 flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
            {BOARDS.map((b) => {
              const Icon = ICONS[b.key];
              return (
                <a
                  key={b.key}
                  href={`#${b.key}`}
                  className="flex-shrink-0 flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] text-ink-500 hover:text-piltri-amber-dark hover:bg-piltri-amber-tint whitespace-nowrap"
                >
                  <Icon className="w-3.5 h-3.5 text-piltri-amber" />
                  {b.title}
                </a>
              );
            })}
          </nav>

          {failed ? (
            <p className="mt-10 text-sm text-score-weak">Couldn&apos;t load the rankings - please try again.</p>
          ) : !boards ? (
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              {BOARDS.map((b) => (
                <div key={b.key} className="h-[420px] rounded-card border border-surface-border bg-surface animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="mt-4 grid gap-5 md:grid-cols-2 items-start">
              {boards.map(({ def, entries }) => (
                <Board key={def.key} boardKey={def.key} title={def.title} blurb={def.blurb} entries={entries} />
              ))}
            </div>
          )}

          <p className="mt-8 text-xs text-ink-500 leading-relaxed">
            Rankings use Piltri&apos;s open data for {(table?.count ?? 0).toLocaleString("en-GB")} places, one per metro area.
            Safety and economy are mostly measured country-wide, hence the limit of 3 per country by default, and only
            countries with most of those figures are ranked. &quot;Best overall&quot; and &quot;Beach life&quot; use your
            score settings.
          </p>
        </div>
      </div>
    </main>
  );
}
