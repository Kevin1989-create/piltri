import type { Metadata } from "next";

// The printable copy of a city page - not for search engines (robots.txt
// keeps it out too). The page itself is a client component.
export const metadata: Metadata = {
  title: "Report",
  robots: { index: false },
};

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
