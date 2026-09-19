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
 *  logo's own width. */
export function NavBar({ center, right, logoSide = "left", border = true }: NavBarProps) {
  const logo = <Logo size="nav" />;

  return (
    <header
      className={cn(
        "grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-3 bg-surface",
        border && "border-b border-surface-border"
      )}
    >
      <div className={cn("flex items-center min-w-0", logoSide === "left" ? "justify-start" : "justify-end")}>
        {logoSide === "left" ? logo : right}
      </div>
      <div className="flex items-center justify-center min-w-0">{center}</div>
      <div className={cn("flex items-center min-w-0", logoSide === "left" ? "justify-end" : "justify-start")}>
        {logoSide === "left" ? right : logo}
      </div>
    </header>
  );
}
