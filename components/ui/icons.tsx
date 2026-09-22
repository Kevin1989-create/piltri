import { SVGProps } from "react";

/** Minimal, dependency-free line icon set — matches the "book cover, not dashboard" tone. */

export function ChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} {...props}>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} {...props}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} {...props}>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CompassIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.5l-2 5-3 1.5 2-5 3-1.5z" />
    </svg>
  );
}

export function PulseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path d="M3 12h4l2-6 4 12 2-6h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7h6v6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Filter/sliders icon — kept for potential reuse, no longer used for the
 *  Discover entry point (see DiscoverIcon below). */
export function FilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path d="M4 6h16M4 12h10M4 18h6" strokeLinecap="round" />
      <circle cx="17" cy="6" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="13" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Magnifying glass — used for the Discover cities entry point. Both the
 *  circle and the handle are built symmetrically around the same optical
 *  centre so it sits well inside a centred square button. */
export function DiscoverIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.3 15.3L20 20" strokeLinecap="round" />
    </svg>
  );
}

/** Wrench/tool icon — used for the Customise score settings entry point.
 *  A proper tool glyph rather than a gear, per feedback that the gear read
 *  more like a sun burst than a mechanical icon. */
export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path
        d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Simple tray-with-arrow download glyph — kept for reuse elsewhere, no
 *  longer used for CityHeader's report link (see EyeIcon below). */
export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} {...props}>
      <path d="M12 4v11M7.5 11l4.5 4.5L16.5 11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Open-eye glyph — used for the "View all data" link in CityHeader
 *  (opens the full data report; that page itself now offers a "Download as
 *  PDF" action, rather than this being a download button up front). */
export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Data-precision icon set — shown next to individual stats in
 *  SectionDetail / the report page to disclose whether a figure is genuine
 *  to this city, or a wider country-level figure shown as the best
 *  available proxy. Deliberately not colour-coded (colour is reserved for
 *  score tiers elsewhere in the app) — same neutral ink-300 tone for all
 *  three, distinguished by shape only. A dashed, irregular territory
 *  outline for Country (not a specific real country — just reads as "an
 *  area with a border" at the small size these render at), a small
 *  skyline for City, and a map pin for Pinned (finer than city — climate
 *  and local amenity density are already computed from an exact
 *  coordinate, not averaged across the whole city). */
export function PrecisionCountryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 2L15 3L17 6L15.5 10L17 13L14 19L12.5 22L10 18L8 12L9.5 6Z" strokeDasharray="2 2" />
    </svg>
  );
}

export function PrecisionCityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 21V11l3.5-2 3.5 2v-4l3.5-2 3.5 2v9.5" />
      <path d="M4 21h16" />
      <path d="M8.2 13.5h.01M8.2 16.5h.01M14.8 11.5h.01M14.8 14.5h.01M14.8 17.5h.01" strokeWidth={2} />
    </svg>
  );
}

export function PrecisionPinnedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 21.5S5 14.8 5 9.8a7 7 0 1114 0c0 5-7 11.7-7 11.7z" />
      <circle cx="12" cy="9.3" r="2.4" />
    </svg>
  );
}

// Section icons
export function IconDemographics(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" strokeLinecap="round" />
      <path d="M15 14.5c2.5.3 4.5 2.5 4.5 5.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconEconomy(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSafety(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconClimate(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconLiveability(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path
        d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0112 5.5 5.5 5.5 0 0121.5 12c-2.5 4.5-9.5 9-9.5 9z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const SECTION_ICONS = {
  economy: IconEconomy,
  safetyStability: IconSafety,
  climate: IconClimate,
  liveability: IconLiveability,
} as const;

/** Resources section (2026-09-23) - a signpost, distinct from the 4 scored
 *  sections' icons above since Resources is deliberately not one of them
 *  (see SectionKey in lib/types.ts) - kept out of SECTION_ICONS on purpose
 *  rather than forcing it into that scored-sections-only map. */
export function IconResources(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path d="M12 3v18M12 6l6-1.5v9L12 15M12 6L6 4.5v9L12 15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
