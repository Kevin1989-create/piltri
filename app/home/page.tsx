import { Logo } from "@/components/ui/Logo";
import { LandingSectionCard } from "@/components/ui/LandingSectionCard";
import { CompassIcon, PulseIcon, TrendIcon } from "@/components/ui/icons";

/** Original marketing home page - moved here from "/" (2026-09-26, on
 *  request: "remove the current Home page (keep it in mind for later
 *  though) and replace it by the current Piltri explore page" - the root
 *  domain now goes straight to Explore (see app/page.tsx re-exporting
 *  app/explore/page.tsx) so a piltri.me visit lands on a working search,
 *  not a 3-card teaser for 2 products that don't exist yet. Kept here,
 *  fully intact and unlinked from anywhere else in the app, in case this
 *  is wanted back (e.g. once Assess/Invest actually ship) rather than
 *  deleted outright. */
export default function LegacyHomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-20">
      <Logo size="wordmark" withTagline href="" />

      {/* Grid (not flex) guarantees exactly equal-width columns regardless of
          whether a card is wrapped in a <Link> (Explore) or not (Assess/Invest coming soon). */}
      <div className="mt-14 w-full max-w-4xl grid grid-cols-1 sm:grid-cols-3 gap-4">
        <LandingSectionCard
          icon={CompassIcon}
          name="Explore"
          description="Compare locations by what matters most — cost of living, safety, lifestyle, and opportunity — before you commit to a move."
          href="/explore"
        />
        <LandingSectionCard
          icon={PulseIcon}
          name="Assess"
          description="Get a clear health score on any physical business — revenue signals, foot traffic, reviews, and operational stability."
          comingSoon
        />
        <LandingSectionCard
          icon={TrendIcon}
          name="Invest"
          description="Browse curated businesses ranked by investment potential, with risk ratings and return projections grounded in real data."
          comingSoon
        />
      </div>
    </main>
  );
}
