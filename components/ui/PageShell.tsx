import type { ReactNode } from "react";
import { NavBar } from "@/components/ui/NavBar";
import { BackLink } from "@/components/ui/BackLink";
import { cn } from "@/lib/cn";

/** The one frame of the pages opened from home - Quiz, Advanced search,
 *  Leaderboards, Saved, Settings (2026-11-21, owner: "all buttons below
 *  when open have different designs, layout, fitting"). The same top bar,
 *  background, width, margins, Back link, title and subtitle on every one,
 *  so moving between them nothing jumps. `narrow` keeps a reading-width
 *  column (the quiz, settings) on the same left edge as the wide pages'
 *  content, rather than centred on its own. */
export const PAGE_WIDTH = "max-w-6xl";
export const PAGE_GUTTER = "px-4 sm:px-6";

export function PageShell({
  title,
  subtitle,
  narrow,
  compact,
  mainClassName,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** A reading-width column (~42rem), left-aligned with the header. */
  narrow?: boolean;
  /** Tighter spacing above and below the title (the quiz: everything on one screen). */
  compact?: boolean;
  mainClassName?: string;
  children: ReactNode;
}) {
  return (
    <main className={cn("min-h-dvh flex flex-col bg-surface-muted", mainClassName)}>
      <NavBar />
      <div className={cn("flex-1 w-full mx-auto", PAGE_WIDTH, PAGE_GUTTER, compact ? "pt-3 sm:pt-4 pb-3" : "pt-4 sm:pt-6 pb-16")}>
        <div className={cn(narrow && "max-w-2xl")}>
          <BackLink />
          <h1 className={cn("font-serif text-ink-900 leading-tight", compact ? "mt-2 text-2xl sm:text-4xl" : "mt-3 text-3xl sm:text-4xl")}>{title}</h1>
          {subtitle && <p className={cn("mt-1 text-sm text-ink-500", compact && "hidden sm:block")}>{subtitle}</p>}
        </div>
        <div className={cn(compact ? "mt-3 sm:mt-5" : "mt-6", narrow && "max-w-2xl")}>{children}</div>
      </div>
    </main>
  );
}
