import type { MetadataRoute } from "next";

/** What a phone or computer uses when Piltri is added to a home screen or
 *  installed (2026-11-06, on request): its name, the logo's "P" as the
 *  icon, and opening like an app. The icons (public/icons) were rendered
 *  from Playfair Display (the logo's font) with Next's image engine:
 *  cream #FAF7F2 on amber #BA7517 - the maskable one smaller, as Android
 *  may cut it to a circle. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Piltri",
    short_name: "Piltri",
    description: "Compare places to live by what matters to you.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAF7F2",
    theme_color: "#FAF7F2",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
