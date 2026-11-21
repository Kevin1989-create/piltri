"use client";

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { cityUrl, HOME_URL, readFrom } from "@/lib/urls";

/** The arrow on its own, for small inline links ("Change last answer"). */
export function BackArrow() {
  return <ArrowLeftIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />;
}

/** Every page's way back (2026-11-21, owner: the pill buttons were
 *  "horrible - make them look a lot nicer"): in the home page's hard-edged
 *  style, a small square with the arrow, ink-outlined, that fills dark on
 *  hover, and the destination beside it as plain text - no box around the
 *  words. 32 px tall, the whole thing one tap target. */
export function BackButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex h-8 items-center gap-2.5 text-[13px] font-medium leading-none text-ink-700 outline-none transition-colors hover:text-ink-900 focus-visible:text-ink-900">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center border-[1.5px] border-ink-900 bg-surface text-ink-900 transition-colors group-hover:bg-ink-900 group-hover:text-white group-focus-visible:bg-ink-900 group-focus-visible:text-white">
        <ArrowLeftIcon aria-hidden className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
      </span>
      <span className="underline-offset-4 group-hover:underline">{children}</span>
    </Link>
  );
}

function FromLink() {
  const from = readFrom(useSearchParams());
  return <BackButton href={from ? cityUrl(from) : HOME_URL}>{from ? "Back to results" : "Home"}</BackButton>;
}

/** The "Back" link on pages reachable from both home and a city page:
 *  back to the city when the address says which (`from`, see lib/urls.ts),
 *  otherwise home. Reading the address needs the browser, so the home link
 *  stands in until then (and on the server-rendered page). */
export function BackLink() {
  return (
    <Suspense fallback={<BackButton href={HOME_URL}>Home</BackButton>}>
      <FromLink />
    </Suspense>
  );
}
