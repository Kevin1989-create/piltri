import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { NavBar } from "@/components/ui/NavBar";
import { SearchBar } from "@/components/ui/SearchBar";
import { DailyPicks } from "@/components/ui/DailyPicks";
import { PAGE_GUTTER, PAGE_WIDTH } from "@/components/ui/PageShell";
import { CogIcon, FilterIcon, HeartIcon, QuizIcon, SECTION_ICONS, TrophyIcon } from "@/components/ui/icons";
import { manifest } from "@/lib/dataset/files";
import { SECTION_LABELS, SECTION_WEIGHTS, type SectionKey } from "@/lib/types";
import { leaderboardsUrl, savedUrl, searchUrl, SETTINGS_URL, sourcesUrl } from "@/lib/urls";
import { cn } from "@/lib/cn";

/** Home (2026-11-21, owner: "a bit sad ... still clean and brutalist, but
 *  for the user to understand what is going on"). Plain blocks with hard
 *  ink edges, on the same width and margins as every page it opens: what
 *  Piltri is and how many places it covers, the search, a few places to
 *  try, the five ways in - named and explained, no longer bare icons - and
 *  how the score is made. */


const WAYS_IN: { href: string; title: string; text: string; Icon: ComponentType<SVGProps<SVGSVGElement>>; main?: boolean }[] = [
  { href: "/quiz", title: "Take the quiz", text: "Eight silly questions, your best matches.", Icon: QuizIcon, main: true },
  { href: searchUrl(), title: "Advanced search", text: "Filter by region, size, climate, what's near.", Icon: FilterIcon },
  { href: leaderboardsUrl(), title: "Leaderboards", text: "The best places, fourteen ways.", Icon: TrophyIcon },
  { href: savedUrl(), title: "Saved", text: "The places you keep an eye on.", Icon: HeartIcon },
  { href: SETTINGS_URL, title: "Settings", text: "Your score weights and units.", Icon: CogIcon },
];

const SECTION_BLURBS: Record<SectionKey, string> = {
  safetyStability: "Crime, stability, rule of law, conflict nearby.",
  economy: "Growth, jobs, wages, prices, taxes, businesses.",
  climate: "Weather, air, water, nature within reach.",
  liveability: "Health, schools, transport, things to do.",
};
const SECTIONS: SectionKey[] = ["safetyStability", "economy", "climate", "liveability"];

/** The hard-edged block every part of the page is built from. */
const BLOCK = "border-[1.5px] border-ink-900";

export default function ExploreLandingPage() {
  const places = manifest.cityCount.toLocaleString("en-GB");
  return (
    <main className="min-h-dvh flex flex-col bg-surface-muted">
      <NavBar />

      <div className={cn("flex-1 w-full mx-auto pt-5 sm:pt-10 pb-10", PAGE_WIDTH, PAGE_GUTTER)}>
        {/* Who we are and the search on the left; the ways in on the right
         *  from lg: up, so both are on screen without scrolling (2026-11-21,
         *  owner). On phones the ways in follow straight after the search. */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
          <section>
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500">
              <span className="inline-block h-2 w-2 bg-piltri-amber" aria-hidden />
              {places} places · {manifest.countryCount} countries<span className="hidden sm:inline"> · free, open data</span>
            </p>
            <h1 className="mt-3 font-serif text-[42px] leading-[1.02] sm:text-6xl xl:text-7xl text-ink-900">Find your Piltri.</h1>
            <p className="mt-4 max-w-xl text-[15px] sm:text-lg text-ink-700 leading-snug">
              Where you live shapes everything. We believe choosing it deserves facts, not hearsay - so Piltri gathers open
              data on every town on Earth and scores it on safety, economy, environment and quality of life. Free, and every
              figure shown.
            </p>
            <div className="mt-5 sm:mt-6 max-w-xl">
              <SearchBar autoFocus variant="block" placeholder="Search for a place you will call home…" />
            </div>
            <p className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2 text-sm text-ink-500">
              <span className="mr-1">Today, let&apos;s try</span>
              <DailyPicks
                chipClassName="inline-block border border-ink-900/80 bg-surface px-2.5 py-0.5 text-[13px] text-ink-900 transition-colors hover:bg-ink-900 hover:text-white"
                lastClassName="hidden sm:inline-block"
              />
            </p>
          </section>

          {/* The five ways in. */}
          <section aria-labelledby="ways-in" className="lg:pt-1">
            <h2 id="ways-in" className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500">
              Or start here
            </h2>
            <ul className="mt-3 grid grid-cols-2 gap-3">
              {WAYS_IN.map(({ href, title, text, Icon, main }) => (
                <li key={href} className={cn(main && "col-span-2")}>
                  <Link
                    href={href}
                    className={cn(
                      main ? "border-[1.5px] border-ink-900 bg-piltri-amber text-white" : cn(BLOCK, "bg-surface"),
                      "group flex h-full flex-col p-3.5 sm:p-4 transition-[transform,box-shadow] duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_#1E1A16] focus-visible:shadow-[4px_4px_0_0_#1E1A16] outline-none"
                    )}
                  >
                    <span className="flex items-center justify-between">
                      <Icon className={cn("h-5 w-5", main ? "text-white" : "text-piltri-amber")} />
                      <span aria-hidden className={cn("text-lg leading-none transition-transform group-hover:translate-x-0.5", main ? "text-white" : "text-ink-900")}>
                        →
                      </span>
                    </span>
                    <span className={cn("font-serif leading-tight", main ? "mt-3 text-2xl text-white" : "mt-3 text-lg sm:text-xl text-ink-900")}>{title}</span>
                    <span className={cn("mt-1 text-xs leading-snug", main ? "text-white/90" : "text-ink-500")}>{text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* How the score is made. */}
        <section className="mt-12 sm:mt-16" aria-labelledby="how">
          <h2 id="how" className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500">
            How a place is scored
          </h2>
          <div className={cn(BLOCK, "bg-surface mt-3 grid grid-cols-2 lg:grid-cols-4")}>
            {SECTIONS.map((key, i) => {
              const Icon = SECTION_ICONS[key];
              return (
                <div
                  key={key}
                  className={cn(
                    "p-4 sm:p-5 border-ink-900",
                    i % 2 === 1 && "border-l-[1.5px]",
                    i >= 2 && "border-t-[1.5px] lg:border-t-0",
                    i === 2 && "lg:border-l-[1.5px]"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <Icon className="h-5 w-5 text-piltri-amber" />
                    <span className="font-serif text-2xl text-ink-900 tabular-nums">{Math.round(SECTION_WEIGHTS[key] * 100)}%</span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-ink-900">{SECTION_LABELS[key]}</p>
                  <p className="mt-0.5 text-xs leading-snug text-ink-500">{SECTION_BLURBS[key]}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-col gap-2 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Every figure is coloured:</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-score-strong" aria-hidden /> Good
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-score-moderate" aria-hidden /> Middling
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 bg-score-weak" aria-hidden /> Weak
              </span>
            </p>
            <p>
              The weights are yours to change in{" "}
              <Link href={SETTINGS_URL} className="text-ink-900 underline underline-offset-2 hover:text-piltri-amber-dark">
                Settings
              </Link>
              .
            </p>
          </div>
        </section>
      </div>

      <footer className={cn("w-full mx-auto pb-5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-500", PAGE_WIDTH, PAGE_GUTTER)}>
        <span>Open data from the World Bank, OECD, WHO, Overture Maps, OpenStreetMap and more.</span>
        <span className="flex gap-4">
          <Link href={sourcesUrl()} className="hover:text-ink-900">
            Data &amp; Sources
          </Link>
          <Link href="/privacy" className="hover:text-ink-900">
            Privacy
          </Link>
        </span>
      </footer>
    </main>
  );
}
