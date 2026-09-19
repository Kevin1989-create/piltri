import { cn } from "@/lib/cn";

interface LogoProps {
  /** "wordmark" = home page hero size, "nav" = ~28px nav bar size */
  size?: "wordmark" | "nav";
  withTagline?: boolean;
  href?: string;
  className?: string;
}

/**
 * Tracked (letter-spaced) uppercase text, built from individual character
 * spans joined with flexbox `gap` instead of CSS `letter-spacing`.
 *
 * `letter-spacing` adds space after every character including the last one
 * in most browsers, which silently widens the element to the right and
 * throws off centering (the visible text ends up looking shifted left).
 * `gap` only ever adds space *between* flex items — never before the first
 * or after the last — so the rendered box's edges always match the visible
 * text exactly, and centering is correct by construction, with no need to
 * guess at or compensate for browser-specific trailing-space behaviour.
 */
function Tracked({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("inline-flex", className)} style={{ gap: "0.2em" }}>
      {text.split("").map((ch, i) => (
        <span key={i} style={ch === " " ? { whiteSpace: "pre" } : undefined}>
          {ch}
        </span>
      ))}
    </span>
  );
}

/**
 * Piltri wordmark. Split colour: "Pil" in ink-900, "tri" in brand amber.
 * Playfair Display, centred, colour split sits at the wordmark midpoint.
 *
 * Navigation: a bare native <a href>, no onClick / JS.
 *
 * Hit-area: a real fixed height + width box (h-12 for nav, h-24 for
 * wordmark), flex-centred — see git history for why the earlier
 * padding/negative-margin trick was abandoned (Chrome's computed box model
 * showed its numbers were correct, but it still didn't line up in
 * practice).
 *
 * NUDGE_DOWN_PX: the anchor's clickable box is already generously sized and
 * fully clickable everywhere within it — this transform only moves where
 * the *visible glyph* sits within that box, closer to where users actually
 * click. Adjust this one number up/down if it still doesn't line up
 * perfectly; it doesn't affect the click area itself, only the text's
 * paint position inside it. Only applied to the clickable (nav) version —
 * Home's wordmark (no href) never had this issue and shouldn't shift.
 */
const NUDGE_DOWN_PX = 10;

export function Logo({ size = "nav", withTagline = false, href = "/", className }: LogoProps) {
  const textSizeClass = size === "wordmark" ? "text-wordmark" : "text-wordmark-nav";
  const hitSize = size === "wordmark" ? "h-24 min-w-[12rem]" : "h-12 min-w-[6rem]";

  const mark = (
    <span className={cn("wordmark-split font-serif font-normal select-none", textSizeClass, className)}>
      <span className="text-ink-900">Pil</span>
      <span className="text-piltri-amber">tri</span>
    </span>
  );

  return (
    <div className="flex flex-col items-center">
      {href ? (
        <a
          href={href}
          aria-label="Piltri home"
          className={cn("cursor-pointer no-underline select-none flex items-center justify-center", hitSize)}
        >
          <span style={{ display: "inline-block", transform: `translateY(${NUDGE_DOWN_PX}px)` }}>{mark}</span>
        </a>
      ) : (
        mark
      )}
      {withTagline && (
        <p className="mt-3 text-xs uppercase text-ink-500 font-sans">
          <Tracked text="Find your Piltri" />
        </p>
      )}
    </div>
  );
}
