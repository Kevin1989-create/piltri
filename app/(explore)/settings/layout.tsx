import type { Metadata } from "next";

// The page itself is a client component, which can't carry metadata.
export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false },
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
