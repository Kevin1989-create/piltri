import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Piltri — Find your Piltri.", template: "%s · Piltri" },
  description:
    "Compare locations by what matters most — cost of living, safety, lifestyle, and opportunity — before you commit to a move.",
  metadataBase: new URL("https://www.piltri.me"),
  // The logo's "P" (public/icons, 2026-11-06, on request: a proper icon
  // when adding Piltri to a phone's home screen); the manifest is
  // app/manifest.ts.
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { title: "Piltri", capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#FAF7F2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
