"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";
import { BackArrow } from "@/components/ui/BackLink";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { getPlaceTable, type PlaceTable } from "@/lib/advancedSearch/engine";
import { columnsFor, factsFor, finderQuery, runFinder, type FinderResult, type FinderState } from "@/lib/advancedSearch/finder";
import { normaliseWeights } from "@/lib/aggregation/scoring";
import { cn } from "@/lib/cn";
import { getCountries } from "@/lib/dataset/cities";
import { countryName } from "@/lib/dataset/files";
import { drawQuiz, personaTitle, pickOne, PLACE_LINES, QUIZ_START, RESULT_INTROS, SET_ASIDE_NOTES, type QuizAnswer, type QuizQuestion } from "@/lib/quiz";
import { useScoreWeights, weightPercentagesToScores } from "@/lib/scoreWeights";
import { useUnitPreferences } from "@/lib/unitPreferences";
import { cityUrl } from "@/lib/urls";
import type { CriterionValue } from "@/lib/types";

type Column = (i: number) => CriterionValue;

/** One step taken: the search after it, how many places are left, the
 *  answer given, and a note when it had to be set aside. */
interface Step {
  state: FinderState;
  result: FinderResult | null;
  answer: QuizAnswer | null;
  note: string | null;
}

const FIRST: Step = { state: QUIZ_START, result: null, answer: null, note: null };
/** How long a tapped answer stays lit before the next question. */
const TAP_MS = 220;

/** "Find your Piltri" (2026-11-14, owner: fun, different every time, one
 *  tap per answer, no skipping) - lib/quiz.ts holds the questions. */
export default function QuizPage() {
  const { weights } = useScoreWeights();
  const { prefs } = useUnitPreferences();
  const normalised = useMemo(() => normaliseWeights(weightPercentagesToScores(weights)), [weights]);

  const [table, setTable] = useState<PlaceTable | null>(null);
  const [languagesOf, setLanguagesOf] = useState<Record<string, string[]>>({});
  const columns = useRef<Record<string, Column>>({});
  const [failed, setFailed] = useState(false);

  // Drawn once mounted (a server render would draw different ones).
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [steps, setSteps] = useState<Step[]>([FIRST]);
  const [tapped, setTapped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setQuestions(drawQuiz()), []);
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
  const total = questions?.length ?? 8;
  const question = questions?.[index];
  const done = !!questions && index >= questions.length;
  const col = (key: string): Column => columns.current[key] ?? (() => null);

  async function choose(answer: QuizAnswer) {
    if (!table || busy) return;
    setBusy(true);
    setTapped(answer.key);
    try {
      const next = answer.apply(current.state);
      const missing = columnsFor(next).filter((key) => !columns.current[key]);
      const [loaded] = await Promise.all([
        Promise.all(missing.map(async (key) => [key, await table.values(key)] as const)),
        new Promise((r) => setTimeout(r, TAP_MS)),
      ]);
      for (const [key, values] of loaded) columns.current[key] = values;
      const result = runFinder(table, col, languagesOf, normalised, next);
      const kept = result.indices.length > 0;
      setSteps((s) => [
        ...s,
        kept
          ? { state: next, result, answer, note: null }
          : { state: current.state, result: current.result, answer, note: pickOne(SET_ASIDE_NOTES, Math.random) },
      ]);
    } catch {
      setFailed(true);
    } finally {
      setTapped(null);
      setBusy(false);
    }
  }

  const back = () => steps.length > 1 && setSteps((s) => s.slice(0, -1));
  const playAgain = () => {
    setQuestions(drawQuiz());
    setSteps([FIRST]);
  };

  const count = current.result?.indices.length ?? table?.count ?? null;

  return (
    // Everything on one screen, laptop or phone (2026-11-21, owner: "I do
    // not want to have to scroll for quizz"): the questions in a reading
    // column, "Change my last answer" on the progress line rather than under
    // the card; the results across the page's full width, side by side.
    <PageShell title="Find your Piltri" subtitle="Eight silly questions. One very serious answer. Different every time." compact>
        <div className={cn(!done && "max-w-2xl")}>
          {!done && (
            <div>
              <div className="h-1.5 rounded-pill bg-ink-100 overflow-hidden">
                <div className="h-full bg-piltri-amber transition-[width] duration-300" style={{ width: `${(Math.min(index, total) / total) * 100}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-500">
                <span className="flex items-center gap-3">
                  {`Question ${index + 1} of ${total}`}
                  {index > 0 && (
                    <button type="button" onClick={back} disabled={busy} className="inline-flex items-center gap-1 text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline">
                      <BackArrow />
                      Change last answer
                    </button>
                  )}
                </span>
                <span className="tabular-nums text-right" aria-live="polite">
                  {busy ? "Thinking…" : count != null ? `${count.toLocaleString("en-GB")} ${count === 1 ? "place" : "places"} left` : ""}
                </span>
              </div>
            </div>
          )}

          {current.note && <p className={cn("rounded-lg bg-piltri-amber-tint px-3 py-2 text-xs text-piltri-amber-dark", done ? "mb-4" : "mt-3")}>{current.note}</p>}

          {failed ? (
            <p className="mt-10 text-sm text-score-weak">Couldn&apos;t load the places - please try again.</p>
          ) : !done && question ? (
            <section key={question.key} className="mt-4 rounded-card border border-surface-border bg-surface p-4 sm:p-6 shadow-card animate-fade-up">
              <h2 className="font-serif text-[22px] sm:text-[26px] text-ink-900 leading-snug">{question.title}</h2>
              <div className="mt-3 sm:mt-4 grid gap-2">
                {question.answers.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    disabled={!table || busy}
                    onClick={() => choose(o)}
                    className={cn(
                      "min-h-[48px] sm:min-h-[52px] rounded-xl border px-4 py-2 sm:py-2.5 text-left flex items-center gap-3 transition-all disabled:cursor-default",
                      tapped === o.key
                        ? "border-piltri-amber bg-piltri-amber-tint scale-[1.01]"
                        : "border-surface-border hover:border-piltri-amber-light hover:bg-surface-muted",
                      busy && tapped !== o.key && "opacity-50"
                    )}
                  >
                    <span className="text-2xl leading-none" aria-hidden>
                      {o.emoji}
                    </span>
                    <span className="text-sm font-medium text-ink-900">{o.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : done && table ? (
            <Results
              key={steps.length}
              table={table}
              col={col}
              state={current.state}
              result={current.result}
              answers={steps.filter((s) => s.answer && !s.note).map((s) => s.answer!)}
              normalised={normalised}
              prefs={prefs}
              onBack={back}
              onPlayAgain={playAgain}
            />
          ) : (
            <div className="mt-4 h-72 rounded-card border border-surface-border bg-surface animate-pulse" />
          )}
        </div>
    </PageShell>
  );
}

function Results({
  table,
  col,
  state,
  result,
  answers,
  normalised,
  prefs,
  onBack,
  onPlayAgain,
}: {
  table: PlaceTable;
  col: (key: string) => Column;
  state: FinderState;
  result: FinderResult | null;
  answers: QuizAnswer[];
  normalised: ReturnType<typeof normaliseWeights>;
  prefs: ReturnType<typeof useUnitPreferences>["prefs"];
  onBack: () => void;
  onPlayAgain: () => void;
}) {
  // The results' words, drawn once per result.
  const [title] = useState(() => personaTitle(answers));
  const [intro] = useState(() => pickOne(RESULT_INTROS, Math.random));
  const [lines] = useState(() => [...PLACE_LINES].sort(() => Math.random() - 0.5));
  const [page, setPage] = useState(0);

  // Best first - three countries at a time where the answers allow.
  const ordered = useMemo(() => {
    const heads = result?.heads ?? Array.from({ length: table.count }, (_, i) => i);
    const out: number[] = [];
    const seen = new Set<string>();
    const rest: number[] = [];
    for (const i of heads.slice(0, 300)) {
      if (seen.has(table.cc[i])) rest.push(i);
      else {
        seen.add(table.cc[i]);
        out.push(i);
      }
    }
    return [...out, ...rest];
  }, [result, table]);
  const shown = ordered.slice(page * 3, page * 3 + 3);
  const more = ordered.length > (page + 1) * 3;
  const total = result?.indices.length ?? table.count;
  const query = finderQuery(state, null);

  return (
    <section className="animate-fade-up">
      <p className="text-xs uppercase tracking-wide text-piltri-amber-dark">{intro}</p>
      <h2 className="font-serif text-2xl sm:text-3xl text-ink-900 mt-1 leading-tight">You&apos;re {title}.</h2>
      <p className="text-sm text-ink-500 mt-1">
        {total === 1
          ? "Exactly one place in the world fits you. Here it is:"
          : `${total.toLocaleString("en-GB")} places fit you. ${page > 0 ? "A few more:" : total === 2 ? "Here are both:" : "Here are your top three:"}`}
      </p>
      {/* Side by side from md: up, so the three and the buttons fit on a
       *  laptop screen; a tight list on phones. */}
      <ol className="mt-3 sm:mt-4 grid gap-2 sm:gap-3 md:grid-cols-3">
        {shown.map((i, k) => {
          const facts = factsFor(col, i, state, prefs).slice(0, 3);
          return (
            <li key={i} className="animate-fade-up" style={{ animationDelay: `${k * 90}ms` }}>
              <Link
                href={cityUrl(table.id(i))}
                className="h-full flex items-start gap-3 rounded-card border border-surface-border bg-surface p-3 sm:p-4 shadow-card hover:border-piltri-amber-light transition-colors"
              >
                <span
                  className={cn(
                    "w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center font-serif text-base",
                    page === 0 && k === 0 ? "bg-piltri-amber text-white" : "bg-piltri-amber-tint text-piltri-amber-dark"
                  )}
                >
                  {page * 3 + k + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-serif text-lg sm:text-xl text-ink-900 leading-tight truncate">{table.name[i]}</span>
                  <span className="block text-xs text-ink-500 mt-0.5 truncate">{[table.region[i], countryName(table.cc[i])].filter(Boolean).join(", ")}</span>
                  <span className="hidden sm:block text-xs italic text-piltri-amber-dark mt-1">{lines[(page * 3 + k) % lines.length]}</span>
                  {facts.length > 0 && (
                    <span className="mt-1.5 sm:mt-2 flex flex-wrap gap-1">
                      {facts.map((f, n) => (
                        <span key={f} className={cn("rounded-pill bg-surface-muted px-2 py-0.5 text-[11px] text-ink-700", n > 1 && "hidden sm:inline")}>
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
      <div className="mt-4 sm:mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        {more && (
          <button type="button" onClick={() => setPage((p) => p + 1)} className="rounded-pill bg-piltri-amber px-5 py-2 text-sm font-medium text-white hover:bg-piltri-amber-dark">
            Show me 3 others
          </button>
        )}
        <button type="button" onClick={onPlayAgain} className="rounded-pill border border-surface-border bg-surface px-5 py-2 text-sm text-ink-700 hover:border-piltri-amber-light">
          Play again
        </button>
        {query && (
          <Link href={`/search?${query}`} className="text-sm text-ink-500 underline underline-offset-2 hover:text-ink-900">
            See all {total.toLocaleString("en-GB")}
          </Link>
        )}
        <button type="button" onClick={onBack} className="text-sm text-ink-500 underline underline-offset-2 hover:text-ink-900">
          Change my last answer
        </button>
      </div>
    </section>
  );
}
