/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Pages used to live under /explore/ (2026-09-30 clean-up, see
    // lib/urls.ts). Old links and bookmarks keep working: the query string
    // is passed along, and each page still reads an older link's
    // parameters before swapping in its short address.
    const moved = {
      "/explore": "/",
      "/explore/results": "/city",
      "/explore/report": "/report",
      "/explore/compare": "/compare",
      "/explore/discover": "/search",
      "/explore/discover/results": "/search/results",
      "/explore/country-report": "/country",
      "/explore/settings": "/settings",
      "/explore/score-settings": "/score-settings",
      "/explore/weights": "/score-settings",
      "/explore/sources": "/sources",
    };
    return Object.entries(moved).map(([source, destination]) => ({ source, destination, permanent: true }));
  },
  async headers() {
    return [
      {
        // The dataset (public/data/<version>/...) never changes under a given
        // path - a new dataset gets a new version folder.
        source: "/data/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

module.exports = nextConfig;
