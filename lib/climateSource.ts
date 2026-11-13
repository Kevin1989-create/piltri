import { manifest } from "@/lib/dataset/files";

/** The climate figures' source and years, read from the dataset's own
 *  source line - so the page never says 1991-2020 over a dataset built
 *  before the switch from WorldClim (1970-2000) to TerraClimate
 *  (1991-2020, 2026-11-13), nor the other way round. */
const text = manifest.sources?.climate ?? "";

export const CLIMATE_YEARS = text.match(/\b(?:19|20)\d\d-(?:19|20)\d\d\b/)?.[0] ?? "1991-2020";

export const CLIMATE_SOURCE = text.startsWith("WorldClim")
  ? `WorldClim 2.1 climate normals, ${CLIMATE_YEARS} averages`
  : `TerraClimate (University of Idaho), ${CLIMATE_YEARS} averages`;
