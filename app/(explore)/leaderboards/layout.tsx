import type { Metadata } from "next";

// The page itself is a client component, which can't carry metadata.
export const metadata: Metadata = {
  title: "Leaderboards: the best places to live, ten ways",
  description: "The top places for safety, economy, environment, quality of life and more, worldwide, by region and by size, from Piltri's open data.",
};

export default function LeaderboardsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
