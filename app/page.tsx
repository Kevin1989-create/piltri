import { Logo } from "@/components/ui/Logo";
import { LandingSectionCard } from "@/components/ui/LandingSectionCard";
import { CompassIcon, PulseIcon, TrendIcon } from "@/components/ui/icons";

/** Page 1 — Home. Ultra minimal, centred, Google-like. No search bar, no nav clutter. */
export default function HomePage() {
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
