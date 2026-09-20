import { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Logo } from "./Logo";

interface NavBarProps {
  /** Content centred across the full header width, at the same vertical
   *  level as the logo — e.g. the search bar + Advanced search link on the
   *  results page. True centring (via the 3-column grid below) rather than
   *  "centred in whatever space is left after the logo", so it stays
   *  centred regardless of how wide the logo or `right` content are. */
  center?: ReactNode;
  /** Content pinned to the corner opposite the logo — e.g. the "Updated"
   *  date on the results page. */
  right?: ReactNode;
  /** Which side the logo sits on; `right` sits on the other side. Default
   *  "left" (Home/Explore landing behaviour). */
  logoSide?: "left" | "right";
  /** Whether to show the bottom border. Default true. Pages that already
   *  draw their own divider directly under the nav (or want a borderless,
   *  more open header) can turn it off to avoid two lines stacked
   *  together. */
  border?: boolean;
}

/** Nav bar: Piltri logo on one side, optional corner content on the other,
 *  and optional centred content in between - a 3-column grid (not a flex
 *  row) so the centre column is genuinely centred across the whole header,
 *  not just centred within whatever space happens to be left after the
 *  logo's own width.
 *
 *  Below `md`, the 3-column grid collapses to two stacked rows instead: the
 *  logo and corner content share a top row (`justify-between`, same as the
 *  grid's outer two columns would read), and `center` — often a search bar
 *  plus a link, too wide to squeeze into a third of a phone's width — gets
 *  its own full-width row underneath. `md:contents` is what makes this work
 *  with a single markup tree rather than two: at `md` and up it removes the
 *  mobile row wrapper from layout entirely, so its two children rejoin
 *  `center` as direct grid items (placed via `md:order-*`, not DOM order,
 *  since the wrapper's children come first in the DOM either way). */
export function NavBar({ center, right, logoSide = "left", border = true }: NavBarProps) {
  const logo = <Logo size="nav" />;
  const leftSlot = logoSide === "left" ? logo : right;
  const rightSlot = logoSide === "left" ? right : logo;

  return (
    <header
      className={cn(
        "flex flex-col gap-2 px-4 py-3 bg-surface",
        "md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4 md:px-6",
        border && "border-b border-surface-border"
      )}
    >
      <div className="flex items-center justify-between gap-3 md:contents">
        <div className={cn("flex items-center min-w-0 md:order-1", logoSide === "left" ? "justify-start" : "justify-end")}>
          {leftSlot}
        </div>
        <div className={cn("flex items-center min-w-0 md:order-3", logoSide === "left" ? "justify-end" : "justify-start")}>
          {rightSlot}
        </div>
      </div>
      {center && <div className="flex items-center justify-center min-w-0 w-full md:order-2">{center}</div>}
    </header>
  );
}
