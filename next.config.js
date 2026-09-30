/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // The score weighting used to live at /explore/weights; keep old links
    // and bookmarks working. Not permanent: browsers keep permanent
    // redirects, and this one already changed target once.
    return [{ source: "/explore/weights", destination: "/explore/score-settings", permanent: false }];
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
