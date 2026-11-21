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
 *  are, the search, today's places to try, and the five ways in - named and
 *  explained.
 *
 *  Exactly one screen, no scroll (2026-11-21, owner: "we can scroll down a
 *  bit, but this is useless"): the page is the screen's height and tightens
 *  on short screens (the max-height steps) rather than running past it. On
 *  phones the ways in are one line each. Nothing clips: the search's
 *  suggestions can still drop below the fold while they're open. */

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
    <main className="h-dvh flex flex-col bg-surface-muted">
      <NavBar />

      <div
        className={cn(
          "flex-1 min-h-0 w-full mx-auto flex flex-col lg:justify-center pt-4 pb-4 sm:pt-8 sm:pb-8 lg:pb-14",
          "[@media(max-height:700px)]:pt-3 [@media(max-height:700px)]:pb-3",
          PAGE_WIDTH,
          PAGE_GUTTER
        )}
      >
        {/* Who we are and the search on the left; the ways in on the right
         *  from lg: up. On phones the ways in follow straight after. */}
        <div className={cn("grid gap-5 sm:gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12", "[@media(max-height:700px)]:gap-4")}>
          <section>
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
            <p className={cn("mt-3 sm:mt-4 max-w-xl text-[14.5px] sm:text-lg text-ink-700 leading-snug", "[@media(max-height:700px)]:mt-2 [@media(max-height:700px)]:sm:text-base")}>
              Where you live shapes everything. We believe choosing it deserves facts, not hearsay - so Piltri gathers open
              data on every town on Earth and scores it on safety, economy, environment and quality of life.
            </p>
            <div className={cn("mt-4 sm:mt-6 max-w-xl", "[@media(max-height:700px)]:mt-3")}>
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

          {/* The five ways in - all alike (2026-11-21, owner: no colour for
           *  the quiz; each one simply opens its page). */}
          <section aria-labelledby="ways-in" className="lg:pt-1">
            <h2 id="ways-in" className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500">
              Or start here
            </h2>
            <ul className="mt-2 sm:mt-3 grid grid-cols-2 gap-2 sm:gap-3">
              {WAYS_IN.map(({ href, title, text, Icon, wide }) => (
                <li key={href} className={cn(wide && "col-span-2")}>
                  <Link
                    href={href}
                    className={cn(
                      // Phones: one line - icon, name, arrow. Larger: the
                      // icon and arrow on top, the name and what it is below.
                      "group grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:content-start",
                      "border-[1.5px] border-ink-900 bg-surface px-3 py-2.5 sm:p-4",
                      "[@media(max-height:700px)]:sm:p-3",
                      "outline-none transition-[transform,box-shadow] duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_0_#1E1A16] focus-visible:shadow-[4px_4px_0_0_#1E1A16]"
                    )}
                  >
                    <Icon className="h-5 w-5 text-piltri-amber" />
                    <span
                      className={cn(
                        "truncate font-serif text-base leading-tight text-ink-900 sm:order-3 sm:col-span-2 sm:mt-3 sm:text-xl",
                        "[@media(max-height:700px)]:sm:mt-2 [@media(max-height:700px)]:sm:text-lg"
                      )}
                    >
                      {title}
                    </span>
                    <span aria-hidden className="text-lg leading-none text-ink-900 transition-transform group-hover:translate-x-0.5 sm:order-2 sm:justify-self-end">
                      →
                    </span>
                    <span className="hidden sm:block sm:order-4 sm:col-span-2 mt-1 text-xs leading-snug text-ink-500 [@media(max-height:600px)]:hidden">
                      {text}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <footer className={cn("flex-shrink-0 w-full mx-auto pb-4 sm:pb-5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-500", PAGE_WIDTH, PAGE_GUTTER)}>
        <span className="hidden sm:inline">Open data from the World Bank, OECD, WHO, Overture Maps, OpenStreetMap and more.</span>
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
