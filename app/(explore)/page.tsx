import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { NavBar } from "@/components/ui/NavBar";
import { SearchBar } from "@/components/ui/SearchBar";
import { DailyPicks } from "@/components/ui/DailyPicks";
import { PAGE_GUTTER, PAGE_WIDTH } from "@/components/ui/PageShell";
import { CogIcon, FilterIcon, HeartIcon, QuizIcon, TrophyIcon } from "@/components/ui/icons";
import { manifest } from "@/lib/dataset/files";
import { leaderboardsUrl, savedUrl, searchUrl, SETTINGS_URL, sourcesUrl } from "@/lib/urls";
import { cn } from "@/lib/cn";

/** Home (2026-11-21, owner: "a bit sad ... still clean and brutalist, but
 *  for the user to understand what is going on"). Plain blocks with hard
 *  ink edges, on the same width and margins as every page it opens: who we
 *  are, the search, the five ways in, and today's places to try.
 *
 *  Exactly one screen, never a scroll (2026-11-21/22, owner): the page is
 *  the screen's height and tightens on short screens (the max-height
 *  steps). On a phone (2026-11-22, owner: "use the full page ... the section
 *  right below the intro + research") the ways in come straight after the
 *  search and stretch to fill the screen, today's places along the bottom;
 *  on a laptop, as before - the intro, search and today's places on the
 *  left, the ways in on the right. */

const WAYS_IN: { href: string; title: string; text: string; Icon: ComponentType<SVGProps<SVGSVGElement>>; wide?: boolean }[] = [
  { href: "/quiz", title: "Take the quiz", text: "Eight silly questions, your best matches.", Icon: QuizIcon, wide: true },
  { href: searchUrl(), title: "Advanced search", text: "Filter by region, size, climate, what's near.", Icon: FilterIcon },
  { href: leaderboardsUrl(), title: "Leaderboards", text: "The best places, fourteen ways.", Icon: TrophyIcon },
  { href: savedUrl(), title: "Saved", text: "The places you keep an eye on.", Icon: HeartIcon },
  { href: SETTINGS_URL, title: "Settings", text: "Your score weights and units.", Icon: CogIcon },
];

export default function ExploreLandingPage() {
  const places = manifest.cityCount.toLocaleString("en-GB");
  return (
    <main className="h-dvh overflow-hidden flex flex-col bg-surface-muted">
      <NavBar />

      <div
        className={cn(
          "flex-1 min-h-0 w-full mx-auto flex flex-col lg:justify-center pt-4 pb-3 sm:pt-8 sm:pb-8 lg:pb-14",
          "[@media(max-height:700px)]:pt-3 [@media(max-height:700px)]:pb-2",
          PAGE_WIDTH,
          PAGE_GUTTER
        )}
      >
        {/* Phones: intro, ways in (filling what's left), today's places.
         *  Laptops: intro and today's places on the left, ways in on the right. */}
        <div
          className={cn(
            "flex-1 min-h-0 grid gap-4 sm:gap-6 grid-rows-[auto_minmax(0,1fr)_auto] [grid-template-areas:'intro'_'ways'_'picks']",
            "lg:flex-none lg:grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:[grid-template-areas:'intro_ways'_'picks_ways'] lg:gap-x-12 lg:gap-y-3",
            "[@media(max-height:700px)]:gap-3"
          )}
        >
          <section className="[grid-area:intro]">
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500">
              <span className="inline-block h-2 w-2 bg-piltri-amber" aria-hidden />
              {places} places · free, open data
            </p>
            <h1
              className={cn(
                "mt-2 sm:mt-3 font-serif text-[38px] leading-[1.02] sm:text-6xl xl:text-7xl text-ink-900",
                "[@media(max-height:700px)]:text-[34px] [@media(max-height:700px)]:sm:text-5xl"
              )}
            >
              Find your Piltri.
            </h1>
            {/* 2026-11-22, owner: "To move we need sparks, love, passions...
             *  and also facts". */}
            <p className={cn("mt-3 sm:mt-4 max-w-xl text-[14.5px] sm:text-lg text-ink-700 leading-snug", "[@media(max-height:700px)]:mt-2 [@media(max-height:700px)]:sm:text-base")}>
              Every move starts with a spark - a love, a passion, a dream of somewhere new. Piltri brings what makes it last:
              the facts. Open data on every town on Earth, scored on safety, economy, environment and quality of life.
            </p>
            <div className={cn("mt-4 sm:mt-6 max-w-xl", "[@media(max-height:700px)]:mt-3")}>
              <SearchBar autoFocus variant="block" placeholder="Search for a place you will call home…" />
            </div>
          </section>

          {/* The five ways in - all alike (2026-11-21, owner: no colour for
           *  the quiz; each one simply opens its page). */}
          <section aria-labelledby="ways-in" className="[grid-area:ways] min-h-0 flex flex-col lg:pt-1">
            <h2 id="ways-in" className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500">
              Or start here
            </h2>
            <ul className="mt-2 sm:mt-3 flex-1 min-h-0 grid grid-cols-2 grid-rows-3 gap-2 sm:gap-3 lg:flex-none lg:grid-rows-none">
              {WAYS_IN.map(({ href, title, text, Icon, wide }) => (
                <li key={href} className={cn("min-h-0", wide && "col-span-2")}>
                  <Link
                    href={href}
                    className={cn(
                      // Phones: icon, name and arrow on a line, what it is
                      // below when the screen is tall enough. Larger: the
                      // icon and arrow on top, the name and what it is below.
                      "group grid h-full grid-cols-[auto_minmax(0,1fr)_auto] content-center items-center gap-x-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:content-start",
                      "border-[1.5px] border-ink-900 bg-surface px-3 py-2.5 sm:p-4",
                      "[@media(max-height:700px)]:sm:p-3",
                      "outline-none transition-[transform,box-shadow] duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_#1E1A16] focus-visible:shadow-[4px_4px_0_0_#1E1A16]"
                    )}
                  >
                    <Icon className="h-5 w-5 text-piltri-amber" />
                    <span
                      className={cn(
                        "font-serif text-base leading-tight text-ink-900 sm:order-3 sm:col-span-2 sm:mt-3 sm:text-xl",
                        "[@media(max-height:700px)]:sm:mt-2 [@media(max-height:700px)]:sm:text-lg"
                      )}
                    >
                      {title}
                    </span>
                    <span aria-hidden className="text-lg leading-none text-ink-900 transition-transform group-hover:translate-x-0.5 sm:order-2 sm:justify-self-end">
                      →
                    </span>
                    <span
                      className={cn(
                        "col-span-3 mt-1 text-xs leading-snug text-ink-500 sm:order-4 sm:col-span-2",
                        // Phones: only with room for it; larger screens: unless short.
                        "hidden [@media(min-height:760px)]:block sm:block [@media(max-height:600px)]:hidden"
                      )}
                    >
                      {text}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <p className="[grid-area:picks] flex flex-wrap items-center gap-x-1 gap-y-2 text-sm text-ink-500 lg:self-start">
            <span className="mr-1">Today, let&apos;s try</span>
            <DailyPicks
              chipClassName="inline-block border border-ink-900/80 bg-surface px-2.5 py-0.5 text-[13px] text-ink-900 transition-colors hover:bg-ink-900 hover:text-white"
              lastClassName="hidden sm:inline-block"
            />
          </p>
        </div>
      </div>

      <footer className={cn("flex-shrink-0 w-full mx-auto pb-3 sm:pb-5 flex flex-wrap items-center justify-end gap-2 text-[11px] text-ink-500", PAGE_WIDTH, PAGE_GUTTER)}>
        {/* The sources are on Data & Sources (2026-11-21, owner). */}
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
