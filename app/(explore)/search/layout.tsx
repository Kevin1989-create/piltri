import type { Metadata } from "next";
import { manifest } from "@/lib/dataset/files";

// The page itself is a client component, which can't carry metadata.
export const metadata: Metadata = {
  title: "Advanced search: find places that match what matters to you",
  description: `Filter ${manifest.cityCount.toLocaleString("en-US")} places by safety, climate, cost of living, beaches, mountains, schools, train stations and more, with live results.`,
};

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
