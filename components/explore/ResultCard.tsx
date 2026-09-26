"use client";

import { useState } from "react";
import { SECTION_ICONS } from "@/components/ui/icons";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { useWikipediaThumbnail } from "@/lib/wikipediaThumbnail";
import { SECTION_LABELS, type SectionKey, type SectionScores } from "@/lib/types";

const SECTION_KEYS = Object.keys(SECTION_LABELS) as SectionKey[];

export interface DisplayResult {
  key: string;
  name: string;
  subtitle: string;
  piltriScore: number;
  sectionScores: SectionScores;
  /** Real coordinates for a city; a rough average-of-tracked-cities point
   *  for a country (see AdvancedSearchCountryResult.lat/lng) — used to plot
   *  this result on the results map. */
  lat: number;
  lng: number;
  /** Wikipedia page title to try first (bare city or country name). Unused
   *  for country results — see flagCountryCode below. */
  wikiTitle: string;
  /** Wikipedia page title to fall back to if the first lookup is empty or a
   *  disambiguation page (e.g. "City, Country"). Undefined for countries,
   *  which don't need the extra disambiguation attempt. With no photo at
   *  all, the card shows a neutral placeholder. */
  wikiFallbackTitle?: string;
  /** Set only for country results — an ISO 3166-1 alpha-2 code, used to show
   *  a real flag (via flagcdn.com) instead of Wikipedia's lead image. A
   *  country's Wikipedia thumbnail is often a map, a landscape photo, or a
   *  coat of arms rather than the flag ("Ireland" was the reported case) -
   *  flags are a much more consistent, recognisable choice for a whole
   *  country than whatever image happens to lead that country's article. */
  flagCountryCode?: string;
  /** Opens in a new tab on click — the same "View all data" report page
   *  used elsewhere in the app. */
  detailHref: string;
}

/** One result in the Advanced search results grid — a photo (city) or flag
 *  (country), the overall Piltri Score as a corner badge, and all 5 section
 *  scores in a row underneath. Clicking anywhere on the card opens the same
 *  "View all data" report page CityHeader's eye icon uses, in a new tab. */
export function ResultCard({ result }: { result: DisplayResult }) {
  if (result.flagCountryCode) {
    return <ResultCardShell result={result}>{<FlagImage countryCode={result.flagCountryCode} name={result.name} />}</ResultCardShell>;
  }
  return <ResultCardShell result={result}>{<CityPhoto result={result} />}</ResultCardShell>;
}

function FlagImage({ countryCode, name }: { countryCode: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <PlaceholderGlyph />;
  return (
    <img
      src={`https://flagcdn.com/w320/${countryCode.toLowerCase()}.png`}
      alt={`${name} flag`}
      // object-contain, not object-cover - flags are meaningful graphics
      // with a specific proportion (and some, like Nepal's, aren't even
      // rectangular); cropping one to fill the tile would cut off real
      // content instead of just cropping empty background the way a slight
      // crop on a landscape photo does.
      className="w-full h-full object-contain p-3"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function CityPhoto({ result }: { result: DisplayResult }) {
  const { src, loading } = useWikipediaThumbnail(result.wikiTitle, result.wikiFallbackTitle);
  if (src) return <img src={src} alt={result.name} className="w-full h-full object-cover" loading="lazy" />;
  if (loading) return <div className="w-full h-full animate-pulse bg-surface-muted" />;
  return <PlaceholderGlyph />;
}


function PlaceholderGlyph() {
  return (
    <div className="w-full h-full bg-gradient-to-br from-piltri-amber/10 to-surface-muted flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="w-8 h-8 text-piltri-amber/40" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21Z" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="9.5" r="2.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function ResultCardShell({ result, children }: { result: DisplayResult; children: React.ReactNode }) {
  return (
    <a
      href={result.detailHref}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-surface border border-surface-border rounded-card shadow-card overflow-hidden hover:shadow-lg hover:bg-ink-100 transition-colors"
    >
      <div className="relative aspect-[4/3] bg-surface-muted">
        {children}
        <div className="absolute top-1.5 right-1.5 rounded-pill bg-surface/95 shadow-card p-0.5">
          <ScoreBadge score={result.piltriScore} size="sm" />
        </div>
      </div>

      <div className="px-2.5 py-2">
        <p className="font-serif text-sm text-ink-900 truncate">{result.name}</p>
        <p className="text-[11px] text-ink-500 truncate">{result.subtitle}</p>

        <div className="mt-1.5 flex items-center justify-between gap-0.5">
          {SECTION_KEYS.map((key) => {
            const Icon = SECTION_ICONS[key];
            return (
              <div key={key} className="flex flex-col items-center gap-0.5" title={SECTION_LABELS[key]}>
                <Icon className="w-3 h-3 text-ink-300" />
                <span className="text-[10px] font-medium text-ink-700 tabular-nums">{Math.round(result.sectionScores[key])}</span>
              </div>
            );
          })}
        </div>
      </div>
    </a>
  );
}
