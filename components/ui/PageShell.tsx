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
  centered,
  fit,
  mainClassName,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** A reading-width column (~42rem), left-aligned with the header. */
  narrow?: boolean;
  /** The header and content in one column in the middle of the page, this
   *  wide ("max-w-2xl") - the quiz (2026-11-21, owner: "not centered"). */
  centered?: string;
  /** Exactly one screen tall, never a page scroll (the quiz, 2026-11-21,
   *  owner: "I want the adjustment to be perfect"): tighter spacing, the
   *  subtitle only on tall screens, and anything that still can't fit
   *  scrolls inside the content area rather than the page. */
  fit?: boolean;
  mainClassName?: string;
  children: ReactNode;
}) {
  const column = narrow ? "max-w-2xl" : centered ? cn("w-full mx-auto", centered) : undefined;
  return (
    <main className={cn("flex flex-col bg-surface-muted", fit ? "h-dvh overflow-hidden" : "min-h-dvh", mainClassName)}>
      <NavBar />
      <div
        className={cn(
          "flex-1 w-full mx-auto",
          PAGE_WIDTH,
          PAGE_GUTTER,
          fit ? "min-h-0 flex flex-col pt-3 sm:pt-4 [@media(max-height:700px)]:pt-2 pb-3" : "pt-4 sm:pt-6 pb-16"
        )}
      >
        <div className={cn("flex-shrink-0", column)}>
          <BackLink />
          <h1
            className={cn(
              "font-serif text-ink-900 leading-tight",
              fit ? "mt-2 text-2xl sm:text-4xl [@media(max-height:760px)]:sm:text-3xl" : "mt-3 text-3xl sm:text-4xl"
            )}
          >
            {title}
          </h1>
          {subtitle && <p className={cn("mt-1 text-sm text-ink-500", fit && "hidden sm:block [@media(max-height:820px)]:hidden")}>{subtitle}</p>}
        </div>
        <div className={cn(fit ? "mt-3 sm:mt-4 flex-1 min-h-0 overflow-y-auto no-scrollbar" : "mt-6", narrow && "max-w-2xl", centered && cn("w-full mx-auto", centered))}>{children}</div>
      </div>
    </main>
  );
}
