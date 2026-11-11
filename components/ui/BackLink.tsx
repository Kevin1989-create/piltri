"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cityUrl, HOME_URL, readFrom } from "@/lib/urls";

/** Every page's "Back" link: a comfortable size and tap area (2026-10-16,
 *  on request - it was too small), since 2026-11-09 (owner: "can be
 *  bigger") a proper button - a light pill with a border - and on
 *  2026-11-10 (owner: "a bit too big now") a step down: the text size of
 *  the page's other buttons, a little less padding. */
export const BACK_LINK_CLASS =
  "inline-flex items-center gap-1.5 rounded-pill border border-surface-border bg-surface px-3.5 py-1.5 text-sm font-medium text-ink-900 shadow-sm hover:border-piltri-amber-light transition-colors [&>span:first-child]:text-base";
const CLASS = BACK_LINK_CLASS;

function FromLink() {
  const from = readFrom(useSearchParams());
  return (
    <Link href={from ? cityUrl(from) : HOME_URL} className={CLASS}>
      <span aria-hidden className="text-base leading-none">←</span>
      {from ? "Back to results" : "Back to home"}
    </Link>
  );
}

/** The "Back" link on pages reachable from both home and a city page:
 *  back to the city when the address says which (`from`, see lib/urls.ts),
 *  otherwise home. Reading the address needs the browser, so the home link
 *  stands in until then (and on the server-rendered page). */
export function BackLink() {
  return (
    <Suspense
      fallback={
        <Link href={HOME_URL} className={CLASS}>
          <span aria-hidden className="text-base leading-none">←</span>
          Back to home
        </Link>
      }
    >
      <FromLink />
    </Suspense>
  );
}
