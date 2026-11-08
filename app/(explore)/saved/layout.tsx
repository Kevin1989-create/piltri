import type { Metadata } from "next";

// The page itself is a client component, which can't carry metadata.
export const metadata: Metadata = {
  title: "Saved places and spots",
  description: "The places and spots you saved on Piltri.",
  robots: { index: false },
};

export default function SavedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
