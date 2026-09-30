"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cityUrl, HOME_URL, readFrom } from "@/lib/urls";

const CLASS = "text-xs text-ink-500 hover:text-ink-900";

function FromLink() {
  const from = readFrom(useSearchParams());
  return (
    <Link href={from ? cityUrl(from) : HOME_URL} className={CLASS}>
      {from ? "← Back to results" : "← Back to home"}
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
          ← Back to home
        </Link>
      }
    >
      <FromLink />
    </Suspense>
  );
}
