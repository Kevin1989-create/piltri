/**
 * Stub / manual data-source adapters.
 *
 * These 6 sources (per Phase 3.1 of the checklist) don't expose a simple,
 * free, keyless REST API the way World Bank / Open-Meteo / Overpass do:
 *
 *  - UNODC              — crime stats published as downloadable datasets, not a live API
 *  - Global Property Guide — real estate figures published on-site, no public API
 *  - UNDRR               — disaster risk index requires registration (INFORM Risk Index)
 *  - NASA / Climate Central — sea-level data via NASA APIs needs an API key (Phase 3.1)
 *  - Expatistan          — cost of living index has no public free API
 *  - PISA / UNESCO       — school quality published as periodic reports, not an API
 *  - EF EPI               — English Proficiency Index is an annual PDF report (manual entry)
 *
 * Each function below returns a clearly-flagged placeholder so the rest of
 * the pipeline (scoring, caching, UI) works end-to-end today. Replace the
 * body of each function once the founder has:
 *   1. Registered for API access where available (UNDRR, NASA, Expatistan), or
 *   2. Manually transcribed the latest published figures into
 *      /data/static/*.json (EF EPI, PISA/UNESCO, WHO fallback).
 *
 * None of these block launch — Explore will run on partial data and simply
 * show these fields as "data pending" until sourced.
 */

export interface ManualFieldResult<T> {
  value: T;
  isPlaceholder: true;
  source: string;
  note: string;
}

function placeholder<T>(value: T, source: string, note: string): ManualFieldResult<T> {
  return { value, isPlaceholder: true, source, note };
}

export function getCriminalityScore(): ManualFieldResult<number> {
  // TODO(3.1): source from UNODC's published dataset (Global Study on Homicide)
  // or an equivalent per-country intentional-homicide-rate CSV, normalised 0-100.
  return placeholder(50, "UNODC", "No live API — needs manual dataset import.");
}

export function getCriminalityTrend(): ManualFieldResult<"Improving" | "Stable" | "Worsening"> {
  return placeholder("Stable", "UNODC", "Derived from year-over-year change once dataset is imported.");
}

export function getGeopoliticalTensionScore(): ManualFieldResult<number> {
  // TODO: consider Global Peace Index or Fragile States Index as concrete sources.
  return placeholder(50, "World Bank (WGI proxy)", "Needs a chosen concrete index — placeholder mid-score.");
}

export function getRealEstatePricePerM2(): ManualFieldResult<number> {
  // TODO(3.1): Global Property Guide — register for access, or scrape/licence data.
  return placeholder(3000, "Global Property Guide", "No public API — register for access.");
}

export function getAvgMonthlyRent1Bed(): ManualFieldResult<number> {
  return placeholder(900, "Global Property Guide", "No public API — register for access.");
}

export function getRealEstateTrend3yr(): ManualFieldResult<number> {
  return placeholder(0, "Global Property Guide", "No public API — register for access.");
}

export function getCostOfLivingIndex(): ManualFieldResult<number> {
  // TODO(3.1): Expatistan — no public free API; consider Numbeo (~$99/mo, post-launch)
  // as the paid upgrade path noted in the brief once revenue justifies it.
  return placeholder(50, "Expatistan", "No public API — needs manual/paid data source.");
}

export function getNaturalDisasterRiskScore(): ManualFieldResult<number> {
  // TODO(3.1): UNDRR INFORM Risk Index — register for access.
  return placeholder(50, "UNDRR", "Register for access to INFORM Risk Index.");
}

export function getSeaLevelRiseExposure(): ManualFieldResult<number> {
  // TODO(3.1): NASA sea level / Climate Central Coastal Risk Screening Tool — needs API key.
  return placeholder(30, "NASA / Climate Central", "Needs NASA API key (Phase 3.1).");
}

export function getExtremeWeatherRisk(): ManualFieldResult<number> {
  // EM-DAT (per brief's APIs table) — free but requires manual export/registration.
  return placeholder(40, "EM-DAT", "Register for EM-DAT export access.");
}

export function getSchoolQualityScore(): ManualFieldResult<number> {
  // TODO: import latest PISA country scores into /data/static/pisa-scores.json
  return placeholder(60, "PISA / UNESCO", "Import latest published PISA country scores.");
}

export function getEnglishProficiencyScore(): ManualFieldResult<number> {
  // TODO: import EF EPI's latest annual report into /data/static/ef-epi.json
  return placeholder(55, "EF English Proficiency Index", "Manual annual report — import into /data/static.");
}

export function getPublicTransportScore(): ManualFieldResult<number> {
  // TODO: Moovit / GTFS feeds per city — no single global free API.
  return placeholder(55, "Moovit / GTFS", "Needs per-city GTFS feed integration.");
}

export function getNdGainScore(): ManualFieldResult<number> {
  // TODO: ND-GAIN Country Index — free, official (University of Notre
  // Dame), covers 185 countries, updated annually. Unlike the other
  // placeholders here, this one is genuinely a quick real import: download
  // the CSV from https://gain.nd.edu/our-work/country-index/download-data/
  // and key it by country code into /data/static/nd-gain-scores.json.
  return placeholder(50, "ND-GAIN Country Index", "Download the annual CSV and import by country code.");
}
