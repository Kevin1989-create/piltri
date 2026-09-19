import type { Config } from "tailwindcss";

// Piltri design tokens.
// Brand colour: amber/ochre #BA7517 (warm, earthy, Patagonian feel).
// Serif wordmark: Playfair Display. Body/UI: system sans for a calm, minimal,
// "book cover not dashboard" feel.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        piltri: {
          amber: "#BA7517",
          "amber-dark": "#96600F",
          "amber-light": "#E3B27A",
          "amber-tint": "#FBF3E8",
        },
        // Neutral / text scale — warm-tinted greys, not cold corporate greys
        ink: {
          900: "#1E1A16",
          700: "#3D362E",
          500: "#6B6155",
          300: "#A79C8C",
          100: "#EDE7DC",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          muted: "#FAF7F2",
          border: "#E6DFD2",
        },
        // Score colour coding (green / amber / red) per Explore results spec
        score: {
          strong: "#3F8557",
          moderate: "#BA7517",
          weak: "#B4472F",
        },
      },
      fontFamily: {
        serif: ["'Playfair Display'", "Georgia", "serif"],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "Inter",
          "sans-serif",
        ],
      },
      fontSize: {
        wordmark: ["3.5rem", { lineHeight: "1.1", letterSpacing: "-0.01em" }],
        "wordmark-nav": ["1.75rem", { lineHeight: "1", letterSpacing: "-0.01em" }],
      },
      borderRadius: {
        card: "16px",
        pill: "999px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(30, 26, 22, 0.04), 0 8px 24px rgba(30, 26, 22, 0.06)",
        panel: "-8px 0 32px rgba(30, 26, 22, 0.08)",
      },
      spacing: {
        18: "4.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
