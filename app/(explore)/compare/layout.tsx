import type { Metadata } from "next";

// Any mix of places makes a page - not for search engines (robots.txt
// keeps them out too). The page itself is a client component.
export const metadata: Metadata = {
  title: "Compare places",
  robots: { index: false },
};

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
