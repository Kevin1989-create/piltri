/** Search engines stay out until the owner says the site is ready
 *  (2026-10-28: "not until it's clean" - December): every response says
 *  noindex. Set to true to let them in, put the Sitemap line back in
 *  public/robots.txt, and submit /sitemap.xml in Google Search Console. */
const SEARCH_ENGINES_WELCOME = false;

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
      "/explore/discover/results": "/search",
      // Advanced search is one page since 2026-10-11.
      "/search/results": "/search",
      "/explore/country-report": "/country",
      "/explore/settings": "/settings",
      "/explore/score-settings": "/settings",
      "/explore/weights": "/settings",
      // Score settings are part of Settings since 2026-10-14.
      "/score-settings": "/settings",
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
      ...(SEARCH_ENGINES_WELCOME ? [] : [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }]),
    ];
  },
};

module.exports = nextConfig;
