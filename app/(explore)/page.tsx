import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { SearchBar } from "@/components/ui/SearchBar";
import { FilterIcon } from "@/components/ui/icons";
import { SETTINGS_URL, sourcesUrl } from "@/lib/urls";

/** Page 2 — Explore landing. Piltri logo top left (top right on Home only),
 *  centred search, no description line or Home link.
 *
 *  Uses the shared NavBar component (rather than its own custom header div,
 *  which it used to) so the logo's padding/position is pixel-identical to
 *  every other Explore page — previously this page had py-4 while NavBar's
 *  header used py-3, a small but real mismatch. border={false} keeps this
 *  page's original borderless, minimal top edge. */
export default function ExploreLandingPage() {
  return (
    <main className="min-h-dvh flex flex-col">
      <NavBar logoSide="left" border={false} />

      {/* -mt-12 only from sm: up (2026-09-26, on request - "the search bar
          is not fully centered right now on the phone"): this offset nudges
          the block up to visually center against the desktop NavBar's own
          height/whitespace, but on a tall phone viewport it overcorrected,
          pushing the search bar noticeably above true centre with a big
          empty gap below - unscoped, it was making every mobile visit look
          off, not just a one-off. */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 sm:-mt-12">
        {/* On phones the search bar itself is what sits in the middle of the
         *  screen (2026-09-30, on request): the heading hangs above it, out
         *  of the flow, so it doesn't count in the centring. From sm: up the
         *  heading is back in the flow, as before. -mt-8 lifts it 16px,
         *  making up for the logo bar being taller than the footer. */}
        <div className="relative w-full max-w-xl -mt-8 sm:mt-0">
          <h1 className="absolute inset-x-0 bottom-full mb-8 sm:static font-serif text-4xl sm:text-5xl text-ink-900 text-center">
            Find your Piltri.
          </h1>

          <SearchBar autoFocus placeholder="Search for a place you could call home" />

          {/* Settings (units and language), back under the search bar, icon
           *  only, bordered to match it (2026-09-30, on request). The score
           *  weighting is separate: Score settings, on the results page.
           *  Like the heading, it hangs outside the flow on phones so the
           *  search bar stays in the middle. */}
          <div className="absolute inset-x-0 top-full mt-3 flex justify-center sm:static">
            <Link
              href={SETTINGS_URL}
              aria-label="Settings: units and language"
              title="Settings"
              className="w-7 h-7 rounded-lg border-[1.5px] border-piltri-amber text-piltri-amber flex items-center justify-center hover:bg-piltri-amber hover:text-white transition-colors"
            >
              <FilterIcon className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>

      <footer className="pb-4 text-center">
        <Link href={sourcesUrl()} className="text-[11px] text-ink-300 hover:text-ink-500">
          Data &amp; Sources
        </Link>
      </footer>
    </main>
  );
}
