import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { SearchBar } from "@/components/ui/SearchBar";
import { FilterIcon } from "@/components/ui/icons";

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
    <main className="min-h-screen flex flex-col">
      <NavBar logoSide="left" border={false} />

      <div className="flex-1 flex flex-col items-center justify-center px-6 -mt-12">
        <h1 className="font-serif text-4xl sm:text-5xl text-ink-900 text-center">Find your Piltri.</h1>

        <div className="mt-8 w-full max-w-xl">
          <SearchBar autoFocus placeholder="Explore a place here" />

          {/* Discover mode's entry point moved to the results page ("Advanced
           *  search"), so only Settings remains here — it inherits Discover's
           *  old square-with-border treatment and icon (sliders), icon-only
           *  now (no caption), centred under the search bar. Border colour
           *  matches the search bar exactly (border-piltri-amber, 1.5px). */}
          <div className="mt-3 flex justify-center">
            <Link
              href="/explore/weights"
              aria-label="Customise score settings"
              title="Settings"
              className="w-7 h-7 rounded-lg border-[1.5px] border-piltri-amber text-piltri-amber flex items-center justify-center hover:bg-piltri-amber hover:text-white transition-colors"
            >
              <FilterIcon className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
