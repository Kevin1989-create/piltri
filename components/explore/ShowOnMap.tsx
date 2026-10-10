"use client";

import { createContext, useContext } from "react";
import type { KpiRow } from "@/lib/kpiRows";

/** Set by the city page - the one page with a map: shows what a Yes/No or
 *  distance figure is about (its row's mapKind) on that map. Elsewhere
 *  (report, Compare) it's null and figures behave as before. */
export const ShowOnMapContext = createContext<((row: KpiRow) => void) | null>(null);

export const useShowOnMap = () => useContext(ShowOnMapContext);
