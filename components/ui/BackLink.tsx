"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { cityUrl, HOME_URL, readFrom } from "@/lib/urls";

/** Every page's "Back" link: a comfortable size and tap area (2026-10-16,
 *  on request - it was too small), a light pill with a border since
 *  2026-11-09 (owner: "can be bigger"), and on 2026-11-11 (owner: "still
 *  too big, a bit ugly, the arrow not centred with the text") a quieter,
 *  smaller one: 32 px tall, 13 px text, no shadow, a drawn arrow in the
 *  text's middle (BackArrow) instead of the "←" character, which sits high
 *  in most fonts. */
export const BACK_LINK_CLASS =
  "inline-flex h-8 items-center gap-1.5 rounded-pill border border-surface-border bg-surface pl-2.5 pr-3.5 text-[13px] font-medium leading-none text-ink-700 transition-colors hover:border-piltri-amber-light hover:text-ink-900";
const CLASS = BACK_LINK_CLASS;

/** The arrow every Back link starts with. */
export function BackArrow() {
  return <ArrowLeftIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />;
}

function FromLink() {
  const from = readFrom(useSearchParams());
  return (
    <Link href={from ? cityUrl(from) : HOME_URL} className={CLASS}>
      <BackArrow />
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
          <BackArrow />
          Back to home
        </Link>
      }
    >
      <FromLink />
    </Suspense>
  );
}
