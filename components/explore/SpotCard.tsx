"use client";

import { ExternalLinkIcon, HeartIcon } from "@/components/ui/icons";
import { CloseButton } from "@/components/ui/CloseButton";
import { mapIconUrl } from "@/components/explore/mapIcons";
import { cn } from "@/lib/cn";
import type { MapKind } from "@/lib/kpiRows";

/** A line of the card: the centre, the nearest place of a kind, or the
 *  second spot - with how far, and roughly how long. */
export interface SpotRow {
  /** "centre", "second", or the kind. */
  key: string;
  kind: MapKind | "spot";
  label: string;
  name: string;
  distance: string;
  time: string;
}

interface SpotCardProps {
  name: string | null;
  coords: string;
  /** Null while the nearest places are being found. */
  rows: SpotRow[] | null;
  second: SpotRow | null;
  placingSecond: boolean;
  /** The row whose journey is on the map, and that journey by road
   *  ("12 min by car · 4.1 km", or "Finding the roads…"). */
  target: string | null;
  journey: string | null;
  journeyUrl: string | null;
  saved: boolean;
  /** "Link copied", briefly. */
  shareNote: string | null;
  onPick: (key: string) => void;
  onAddSecond: () => void;
  onClearSecond: () => void;
  onToggleSave: () => void;
  onShare: () => void;
  onClose: () => void;
}

/** The teardrop the spots wear on the map, small. */
function SpotPin({ color }: { color: string }) {
  return (
    <svg viewBox="-2 -2 28 36" width="14" height="18" aria-hidden className="shrink-0">
      <path d="M12 0C5.383 0 0 5.383 0 12c0 9 12 20 12 20s12-11 12-20C24 5.383 18.617 0 12 0z" fill="#FFFFFF" stroke={color} strokeWidth="2.5" />
      <circle cx="12" cy="12" r="5" fill={color} />
    </svg>
  );
}

/** A spot dropped on the expanded map (2026-10-31, owner): what's near it
 *  - the centre and the nearest station, school, hospital... from the
 *  city's own lists - a second spot's journey, save and share. Tapping a
 *  line draws its journey by road. */
export function SpotCard(props: SpotCardProps) {
  const { name, coords, rows, second, placingSecond, target, journey, journeyUrl, saved, shareNote } = props;

  const row = (r: SpotRow, clear?: () => void) => {
    const selected = r.key === target;
    return (
      <div key={r.key}>
        <div className={cn("group flex items-center rounded-lg hover:bg-surface-muted", selected && "bg-surface-muted")}>
          <button
            type="button"
            onClick={() => props.onPick(r.key)}
            aria-label={`${r.label}: ${r.name}, ${r.distance} - show the journey on the map`}
            className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left"
          >
            {r.kind === "spot" ? (
              <SpotPin color="#3B6E8F" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mapIconUrl(r.kind)} alt="" width={16} height={16} className="shrink-0" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] leading-tight text-ink-500">{r.label}</span>
              {/* A long name ends in "…" - and unfolds in full under the
                  pointer, or once tapped on a phone (2026-11-12, owner:
                  "when we hover over, it should give the full name
                  directly" - not the browser's slow tooltip). */}
              <span
                className={cn(
                  "block text-xs font-medium leading-tight text-ink-900 [overflow-wrap:anywhere]",
                  selected ? "whitespace-normal" : "truncate group-hover:overflow-visible group-hover:whitespace-normal"
                )}
              >
                {r.name}
              </span>
            </span>
            <span className="shrink-0 text-right tabular-nums">
              <span className="block text-xs leading-tight text-ink-900">{r.distance}</span>
              <span className="block text-[10px] leading-tight text-ink-500">{r.time}</span>
            </span>
          </button>
          {clear && (
            <CloseButton label="Remove the second spot" onClick={clear} className="-my-1.5 mr-0.5" />
          )}
        </div>
        {selected && journey && (
          <p className="flex flex-wrap items-center gap-x-2 pb-1 pl-8 pr-2 text-[11px] text-ink-700">
            <span>{journey}</span>
            {journeyUrl && (
              <a href={journeyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-piltri-amber-dark underline-offset-2 hover:underline">
                Google Maps
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            )}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-surface shadow-card">
      <div className="flex items-start gap-2 border-b border-surface-border px-3 pb-2 pt-2.5">
        <span className="pt-0.5">
          <SpotPin color="#BA7517" />
        </span>
        <div className="min-w-0 flex-1">
          {/* The spot's name over two lines, then "…" - in full under the
              pointer. */}
          <p className="line-clamp-2 text-[13px] font-semibold leading-tight text-ink-900 [overflow-wrap:anywhere] hover:line-clamp-none">{name ?? "Your spot"}</p>
          <p className="text-[11px] leading-tight text-ink-500 tabular-nums">
            {name && "Your spot · "}
            {coords}
          </p>
          {/* 2026-11-07, owner: move it without closing the card. */}
          <p className="pt-0.5 text-[10px] leading-tight text-piltri-amber-dark">Tap anywhere on the map to move it</p>
        </div>
        <CloseButton label="Remove the spot" onClick={props.onClose} className="-mb-1.5 -mr-2 -mt-1.5" />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {second ? (
          row(second, props.onClearSecond)
        ) : (
          <button
            type="button"
            onClick={props.onAddSecond}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs hover:bg-surface-muted",
              placingSecond ? "font-medium text-piltri-amber-dark" : "text-ink-700"
            )}
          >
            <SpotPin color="#3B6E8F" />
            {placingSecond ? "Tap the map for your second spot…" : "Add a second spot - work, a school…"}
          </button>
        )}
        <p className="px-1.5 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">Nearest from here</p>
        {rows ? rows.map((r) => row(r)) : <p className="animate-pulse px-1.5 py-1 text-xs text-ink-500">Finding what's near…</p>}
      </div>

      <div className="flex items-center gap-1.5 border-t border-surface-border px-2 py-1.5">
        <button
          type="button"
          onClick={props.onToggleSave}
          aria-pressed={saved}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
            saved ? "bg-piltri-amber text-white" : "bg-surface-muted text-ink-900 hover:bg-surface-border"
          )}
        >
          {/* The same heart as a saved city's (2026-11-08, owner). */}
          <HeartIcon width={12} height={12} fill={saved ? "currentColor" : "none"} aria-hidden />
          {saved ? "Saved" : "Save"}
        </button>
        <button type="button" onClick={props.onShare} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-900 hover:bg-surface-border">
          Share link
        </button>
        <span className="ml-auto truncate pr-1 text-[10px] text-ink-500">{shareNote ?? (saved ? "Kept in this browser" : "")}</span>
      </div>
    </div>
  );
}
