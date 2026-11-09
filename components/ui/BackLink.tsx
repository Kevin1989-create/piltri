"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cityUrl, HOME_URL, readFrom } from "@/lib/urls";

/** Every page's "Back" link: a comfortable size and tap area (2026-10-16,
 *  on request - it was too small), and since 2026-11-09 (owner: "can be
 *  bigger") a proper button - a light pill with a border, larger text and
 *  arrow. */
export const BACK_LINK_CLASS =
  "inline-flex items-center gap-2 rounded-pill border border-surface-border bg-surface px-4 py-2 text-[15px] font-medium text-ink-900 shadow-sm hover:border-piltri-amber-light transition-colors [&>span:first-child]:text-lg";
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
