import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Piltri — Find your Piltri.",
  description:
    "Compare locations by what matters most — cost of living, safety, lifestyle, and opportunity — before you commit to a move.",
  metadataBase: new URL("https://piltri.me"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
