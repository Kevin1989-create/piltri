/**
 * Piltri design tokens — single source of truth for brand values used
 * outside Tailwind's CSS pipeline (map styling, canvas, emails, etc).
 * Keep in sync with tailwind.config.ts.
 */
export const colors = {
  amber: "#BA7517",
  amberDark: "#96600F",
  amberLight: "#E3B27A",
  amberTint: "#FBF3E8",
  ink900: "#1E1A16",
  ink700: "#3D362E",
  ink500: "#6B6155",
  ink300: "#A79C8C",
  ink100: "#EDE7DC",
  surface: "#FFFFFF",
  surfaceMuted: "#FAF7F2",
  surfaceBorder: "#E6DFD2",
  scoreStrong: "#3F8557",
  scoreModerate: "#BA7517",
  scoreWeak: "#B4472F",
} as const;

export const fonts = {
  serif: "'Playfair Display', Georgia, serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif",
} as const;

/** Score band thresholds — 0-100 scale, drives colour coding across the app. */
export function scoreBand(score: number): "strong" | "moderate" | "weak" {
  if (score >= 70) return "strong";
  if (score >= 45) return "moderate";
  return "weak";
}

export function scoreColor(score: number): string {
  const band = scoreBand(score);
  if (band === "strong") return colors.scoreStrong;
  if (band === "moderate") return colors.scoreModerate;
  return colors.scoreWeak;
}
