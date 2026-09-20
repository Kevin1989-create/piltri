"use client";

import { useEffect, useState } from "react";

/** True/false reflecting whether `query` currently matches, kept live via
 *  the MediaQueryList change event (not a resize listener) so it only
 *  re-renders on an actual breakpoint crossing, not every pixel of a
 *  window drag. Starts `false` (matches server-rendered markup) and syncs
 *  to the real value on mount — used to switch between the results page's
 *  desktop map-overlay layout and its mobile stacked layout, which differ
 *  enough (absolute positioning vs. normal flow) that plain CSS breakpoints
 *  alone can't express the difference in component behaviour. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    function handler(e: MediaQueryListEvent) {
      setMatches(e.matches);
    }
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
