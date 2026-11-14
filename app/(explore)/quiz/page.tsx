"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { BackLink, BackArrow } from "@/components/ui/BackLink";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { getPlaceTable, type PlaceTable } from "@/lib/advancedSearch/engine";
import { columnsFor, factsFor, finderQuery, runFinder, type FinderResult, type FinderState } from "@/lib/advancedSearch/finder";
import { normaliseWeights } from "@/lib/aggregation/scoring";
import { cn } from "@/lib/cn";
import { getCountries } from "@/lib/dataset/cities";
import { countryName } from "@/lib/dataset/files";
import { QUIZ, QUIZ_START, type QuizQuestion } from "@/lib/quiz";
import { useScoreWeights, weightPercentagesToScores } from "@/lib/scoreWeights";
import { useUnitPreferences } from "@/lib/unitPreferences";
import { cityUrl } from "@/lib/urls";
import type { CriterionValue } from "@/lib/types";

type Column = (i: number) => CriterionValue;

/** One step taken: the search after it, how many places fit, and a note
 *  when an answer had to be set aside. */
interface Step {
  state: FinderState;
  result: FinderResult | null;
  note: string | null;
}

/** "Find your Piltri" (2026-11-14, owner): a few questions, a live count of
 *  the places still in the running, then the three that fit best. The
 *  answers are an Advanced search (lib/quiz.ts) - "See all" opens it. */
export default function QuizPage() {
  const { weights } = useScoreWeights();
  const { prefs } = useUnitPreferences();
  const normalised = useMemo(() => normaliseWeights(weightPercentagesToScores(weights)), [weights]);

  const [table, setTable] = useState<PlaceTable | null>(null);
  const [languagesOf, setLanguagesOf] = useState<Record<string, string[]>>({});
  const columns = useRef<Record<string, Column>>({});
  const [failed, setFailed] = useState(false);

  const [steps, setSteps] = useState<Step[]>([{ state: QUIZ_START, result: null, note: null }]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

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

  const current = steps[steps.length - 1];
  const index = steps.length - 1;
  const question: QuizQuestion | undefined = QUIZ[index];
  const done = index >= QUIZ.length;
  const col = (key: string): Column => columns.current[key] ?? (() => null);

  /** The search with `chosen` answers to the current question, if any place
   *  is left with them - else the search as it was, and a note. */
  async function answer(chosen: string[]) {
    if (!table || busy) return;
    setBusy(true);
    try {
      let next = current.state;
      for (const key of chosen) next = question!.options.find((o) => o.key === key)!.apply(next);
      const missing = columnsFor(next).filter((key) => !columns.current[key]);
      const loaded = await Promise.all(missing.map(async (key) => [key, await table.values(key)] as const));
      for (const [key, values] of loaded) columns.current[key] = values;
      const result = runFinder(table, col, languagesOf, normalised, next);
      const kept = result.indices.length > 0 || !chosen.length;
      setSteps((s) => [
        ...s,
        kept
          ? { state: next, result: chosen.length ? result : current.result, note: null }
          : { state: current.state, result: current.result, note: "No place has all of that - we set this answer aside and kept the others." },
      ]);
      setPicked([]);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const back = () => {
    if (steps.length > 1) {
      setSteps((s) => s.slice(0, -1));
      setPicked([]);
    }
  };

  const count = current.result?.indices.length ?? table?.count ?? null;
  const progress = Math.min(index, QUIZ.length) / QUIZ.length;

  return (
    <main className="min-h-dvh flex flex-col bg-surface-muted">
      <NavBar />
      <div className="flex-1 px-4 sm:px-6 pt-6 sm:pt-8 pb-16">
        <div className="max-w-xl mx-auto">
          <BackLink />
          <h1 className="font-serif text-3xl sm:text-4xl text-ink-900 mt-2">Find your Piltri</h1>
          <p className="text-sm text-ink-500 mt-1">A few questions, and the places that fit you best.</p>

          {/* Progress and the live count: the places still in the running. */}
          <div className="mt-6">
            <div className="h-1 rounded-pill bg-ink-100 overflow-hidden">
              <div className="h-full bg-piltri-amber transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-ink-500">
              <span>{done ? "Done" : `Question ${index + 1} of ${QUIZ.length}`}</span>
              <span className="tabular-nums" aria-live="polite">
                {busy ? "Counting…" : count != null ? `${count.toLocaleString("en-GB")} ${count === 1 ? "place" : "places"} in the running` : ""}
              </span>
            </div>
          </div>

          {current.note && <p className="mt-4 rounded-lg bg-piltri-amber-tint px-3 py-2 text-xs text-piltri-amber-dark">{current.note}</p>}

          {failed ? (
            <p className="mt-10 text-sm text-score-weak">Couldn&apos;t load the places - please try again.</p>
          ) : !done && question ? (
            <section className="mt-6 rounded-card border border-surface-border bg-surface p-5 sm:p-6 shadow-card">
              <h2 className="font-serif text-2xl text-ink-900 leading-snug">{question.title}</h2>
              {question.multi && <p className="mt-1 text-xs text-ink-500">Pick as many as you like.</p>}
              <div className="mt-4 grid gap-2">
                {question.options.map((o) => {
                  const on = picked.includes(o.key);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      disabled={!table || busy}
                      aria-pressed={question.multi ? on : undefined}
                      onClick={() => (question.multi ? setPicked((p) => (on ? p.filter((k) => k !== o.key) : [...p, o.key])) : answer([o.key]))}
                      className={cn(
                        "min-h-[44px] rounded-xl border px-4 py-2.5 text-left transition-colors disabled:opacity-60",
                        on ? "border-piltri-amber bg-piltri-amber-tint" : "border-surface-border hover:border-piltri-amber-light hover:bg-surface-muted"
                      )}
                    >
                      <span className="block text-sm font-medium text-ink-900">{o.label}</span>
                      {o.hint && <span className="block text-xs text-ink-500 mt-0.5">{o.hint}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  {index > 0 && (
                    <button type="button" onClick={back} disabled={busy} className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900">
                      <BackArrow />
                      Back
                    </button>
                  )}
                  <button type="button" onClick={() => answer([])} disabled={!table || busy} className="text-sm text-ink-500 underline underline-offset-2 hover:text-ink-900">
                    {question.multi ? "Doesn't matter" : "Skip"}
                  </button>
                </div>
                {question.multi && (
                  <button
                    type="button"
                    onClick={() => answer(picked)}
                    disabled={!table || busy || !picked.length}
                    className="rounded-pill bg-piltri-amber px-5 py-2 text-sm font-medium text-white hover:bg-piltri-amber-dark disabled:opacity-40"
                  >
                    Next
                  </button>
                )}
              </div>
            </section>
          ) : table ? (
            <Results table={table} col={col} state={current.state} result={current.result} normalised={normalised} prefs={prefs} onBack={back} onRestart={() => setSteps((s) => s.slice(0, 1))} />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function Results({
  table,
  col,
  state,
  result,
  normalised,
  prefs,
  onBack,
  onRestart,
}: {
  table: PlaceTable;
  col: (key: string) => Column;
  state: FinderState;
  result: FinderResult | null;
  normalised: ReturnType<typeof normaliseWeights>;
  prefs: ReturnType<typeof useUnitPreferences>["prefs"];
  onBack: () => void;
  onRestart: () => void;
}) {
  // The best three, from three countries when the answers allow.
  const top = useMemo(() => {
    const heads = result?.heads ?? [];
    const out: number[] = [];
    const seen = new Set<string>();
    for (const i of heads) {
      if (out.length === 3) break;
      if (!seen.has(table.cc[i])) {
        seen.add(table.cc[i]);
        out.push(i);
      }
    }
    for (const i of heads) {
      if (out.length === 3) break;
      if (!out.includes(i)) out.push(i);
    }
    return out;
  }, [result, table]);
  const total = result?.indices.length ?? 0;
  const query = finderQuery(state, null);

  return (
    <section className="mt-6">
      <h2 className="font-serif text-2xl text-ink-900">{top.length ? "Your Piltri" : "Every place fits"}</h2>
      <p className="text-sm text-ink-500 mt-1">
        {top.length
          ? `The places that fit you best, of ${total.toLocaleString("en-GB")} that match your answers.`
          : "You didn't rule anything out - try again with a few answers, or browse the leaderboards."}
      </p>
      <ol className="mt-4 grid gap-3">
        {top.map((i, k) => {
          const facts = factsFor(col, i, state, prefs);
          return (
            <li key={i}>
              <Link
                href={cityUrl(table.id(i))}
                className="flex items-start gap-4 rounded-card border border-surface-border bg-surface p-4 shadow-card hover:border-piltri-amber-light transition-colors"
              >
                <span
                  className={cn(
                    "w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center font-serif text-base",
                    k === 0 ? "bg-piltri-amber text-white" : "bg-piltri-amber-tint text-piltri-amber-dark"
                  )}
                >
                  {k + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-serif text-xl text-ink-900 leading-tight">{table.name[i]}</span>
                  <span className="block text-xs text-ink-500 mt-0.5">{[table.region[i], countryName(table.cc[i])].filter(Boolean).join(", ")}</span>
                  {facts.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-1">
                      {facts.map((f) => (
                        <span key={f} className="rounded-pill bg-surface-muted px-2 py-0.5 text-[11px] text-ink-700">
                          {f}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <ScoreBadge score={Math.round(table.piltri(i, normalised))} />
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {total > 0 && query && (
          <Link href={`/search?${query}`} className="rounded-pill bg-piltri-amber px-5 py-2 text-sm font-medium text-white hover:bg-piltri-amber-dark">
            See all {total.toLocaleString("en-GB")} matches
          </Link>
        )}
        <button type="button" onClick={onRestart} className="rounded-pill border border-surface-border bg-surface px-5 py-2 text-sm text-ink-700 hover:border-piltri-amber-light">
          Start again
        </button>
        <button type="button" onClick={onBack} className="text-sm text-ink-500 underline underline-offset-2 hover:text-ink-900">
          Change my last answer
        </button>
      </div>
    </section>
  );
}
