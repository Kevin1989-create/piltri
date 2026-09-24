/**
 * Piltri — Explore data model
 *
 * 4 scored sections (Economy, Safety & Stability, Climate, Liveability) +
 * Demographics as supplementary info (not scored). There is no Real Estate
 * section — no free, reliable, globally-open pricing data source exists
 * (the one viable option, Numbeo, is a paid API); rather than fabricate
 * numbers or leave a permanent "Coming soon" placeholder, it's left out of
 * the app entirely for now. Add it back (a new SectionKey, its own
 * *Fields interface, a real per-city price source wired into
 * lib/aggregation/aggregate.ts) if that changes.
 *
 * Every field that DOES appear in the scored model is backed by a real, live
 * (or at minimum genuinely computed) source today — see
 * lib/aggregation/aggregate.ts for exactly which API feeds which field.
 */

export type EconomyTypeProfile = {
  technologyAndInnovation: number; // %
  tourismAndHospitality: number; // %
  financeAndServices: number; // %
  manufacturingAndIndustry: number; // %
  governmentAndPublicSector: number; // %
  naturalResourcesAndAgriculture: number; // %
};

/** Direction of a metric's recent trend — shared by Safety's political
 *  stability trend (see aggregate.ts, derived from World Bank's own
 *  multi-year Political Stability series). */
export type TrendDirection = "Improving" | "Stable" | "Worsening";

/** Supplementary city info shown next to the name/region on the results
 *  page — not part of the scored sections (see SectionKey).
 *
 *  Split into genuinely separate country-level and city-level groups
 *  (2026-09-22) - an earlier version silently preferred the city-level
 *  Wikidata figure for population/density and fell back to the World
 *  Bank country figure on a miss, both displayed under one "Population"
 *  label with no way to tell which you were looking at. That's exactly
 *  the kind of blend this project has otherwise been removing all
 *  session: a country's number and a city's number don't mean the same
 *  thing, so now both are kept and shown side by side, honestly, with
 *  "Not available" wherever a given tier's source doesn't resolve -
 *  never silently substituting one tier for the other. */
export interface DemographicsFields {
  /** World Bank (SP.POP.TOTL). Null only on a genuine per-country gap -
   *  see lib/data-sources/worldbank.ts. */
  countryPopulation: number | null;
  /** World Bank (EN.POP.DNST). */
  countryPopulationDensityPerKm2: number | null;
  /** World Bank (AG.LND.TOTL.K2). */
  countryLandAreaKm2: number | null;
  /** UN World Population Prospects 2024, median age - see
   *  lib/data-sources/medianAge.ts for why this isn't a World Bank
   *  indicator like the others here. */
  countryAverageAge: number | null;
  /** World Bank (SP.POP.TOTL, derived multi-year trend). */
  countryPopulationTrend5yrPct: number | null;
  /** GeoNames countryInfo.txt - see lib/data-sources/languages.ts. */
  countryMostWidelySpokenLanguage: string | null;

  /** Wikidata (P1082), exact-label city match - see
   *  lib/data-sources/wikidata.ts getCityPopulationAndArea. Null
   *  whenever the match doesn't resolve (label mismatch, or a match with
   *  no population statement) - never backfilled from
   *  countryPopulation above. */
  cityPopulation: number | null;
  /** OSM/Nominatim real boundary-polygon area (geodesic, via
   *  lib/data-sources/nominatim.ts getCityLandAreaKm2 - a one-time,
   *  separately-stored backfill, see schema.sql's cities.osm_land_area_km2)
   *  when available; falls back to Wikidata's manually-entered P2046
   *  figure otherwise. The polygon-derived figure is preferred as more
   *  accurate and consistently computed - see aggregate.ts's
   *  resolvedCityAreaKm2 comment for a concrete before/after example. */
  cityAreaKm2: number | null;
  /** Only set when BOTH cityPopulation and cityAreaKm2 resolve for the
   *  same matched entity - never mixes a city figure with a country one
   *  or vice versa. */
  cityPopulationDensityPerKm2: number | null;
}

/** Broad national GDP composition (World Bank NV.AGR/IND/SRV.TOTL.ZS - value
 *  added by sector, % of GDP), whichever of the 3 is largest. A coarser
 *  classification than mainEconomyType below (3 buckets, not 6), but
 *  country-level with near-universal coverage, unlike OSM's patchy
 *  regional density - added 2026-09-24 as a genuinely reliable companion
 *  to mainEconomyType, not a replacement for it (see EconomyFields
 *  comment). Null only on a genuine per-country data gap. */
export type DominantGdpSector = "Agriculture" | "Industry" | "Services";

export interface EconomyFields {
  economicGrowth5yrGdpPct: number;
  averageSalaryGbp: number;
  unemploymentRatePct: number;
  /** The city's likely dominant local sector, from OSM POI/land-use
   *  density within range of its exact coordinates (see
   *  lib/data-sources/overpass.ts getEconomySectorCounts / pickMainEconomyType).
   *  Null when the city has no local OSM signal at all (reported honestly,
   *  not guessed) - the row for this is simply omitted rather than shown as
   *  "Not enough Data" (2026-09-24, on request: show it only when both this
   *  and dominantGdpSector below are genuinely solid, never a placeholder
   *  for either). */
  mainEconomyType: keyof EconomyTypeProfile | null;
  /** Country-level companion to mainEconomyType above - see
   *  DominantGdpSector's comment. Also omitted (not placeholder text) on a
   *  genuine data gap. */
  dominantGdpSector: DominantGdpSector | null;
  /** World Bank's Price Level Index (households' final consumption
   *  expenditure, PA.NUS.PRVT.PLI) — ~100 tracks roughly US price levels;
   *  well above 100 reads as expensive, well below as cheap. A genuine,
   *  free, globally-covered proxy for cost of living, not a placeholder. */
  costOfLivingIndex: number; // 0-100+ (rarely exceeds ~150 for the most expensive countries)
  purchasingPowerIndex: number; // 0-100
}

/** Political Stability and Rule of Law are World Bank Worldwide Governance
 *  Indicators (GOV_WGI_PV.SC / GOV_WGI_RL.SC), both already published on a
 *  0-100 "governance score" scale, free and keyless via the same World Bank
 *  API already used for Economy/Demographics. `safetyTrend` is derived from
 *  Political Stability's own multi-year trend (see
 *  lib/data-sources/worldbank.ts), not a separate placeholder.
 *  `homicideRatePer100k` (added 2026-09-23) is a hard crime statistic
 *  (UNODC, via the same World Bank API) complementing the two perception-
 *  based governance scores above. All 4 fields are inherently country-level
 *  — governance and crime reporting are national concepts, there's no
 *  meaningful city-level equivalent to source these from for free. */
export interface SafetyStabilityFields {
  politicalStabilityScore: number; // 0-100
  ruleOfLawScore: number; // 0-100
  safetyTrend: TrendDirection;
  homicideRatePer100k: number; // intentional homicides per 100k people
}

/** All 4 fields are Open-Meteo climate normals for this city's exact
 *  coordinates — genuinely live, not country-level averages. */
export interface ClimateFields {
  avgAnnualTemperatureC: number;
  avgAnnualRainfallMm: number;
  avgAnnualSunshineHrs: number;
  avgAnnualSnowfallCm: number;
}

export interface LiveabilityFields {
  restaurantsBarsDensityPer10k: number;
  /** 0-100, Overpass parks/gardens count within 5km of centre normalised
   *  against a reasonable-range ceiling - a density SCORE, not a literal
   *  percentage of the city's land area (renamed from
   *  greenSpacePctOfCityArea 2026-09-21: the old name and its UI display
   *  ("X% of city area") implied a real area computation this never did -
   *  computing genuine area coverage would need OSM polygon geometry, not
   *  just a point/way count, a bigger change than this rename). */
  greenSpaceScore: number;
  culturalVenuesDensityPer10k: number;
  familyKidsActivitiesDensityPer10k: number;
  healthcareQualityScore: number; // 0-100, WHO UHC Service Coverage Index
  // Presence flags (Overpass/OpenStreetMap-sourced, computed from this
  // city's exact coordinates - see lib/data-sources/overpass.ts).
  hasTrainStation: boolean;
  hasSubway: boolean;
  hasTramway: boolean;
  hasAirport: boolean;
}

/** The 4 SCORED sections. Demographics is deliberately not here — it's
 *  supplementary info on CityExploreData.demographics, not part of the
 *  Piltri Score. There's no Real Estate section — see the file header
 *  comment. Resources (see ResourceLinkCategory below) isn't here either,
 *  for the same reason Demographics isn't - a handful of curated external
 *  links has no sensible "good/bad" score. */
export type SectionKey = "economy" | "safetyStability" | "climate" | "liveability";

/** Resources — a small, hand-curated (not fetched/computed) set of
 *  external links per country: official immigration/visa portals,
 *  national property listing sites, healthcare registration, job boards.
 *  Added 2026-09-23, deliberately limited (product decision: a handful of
 *  genuinely useful links, not a directory) and country-level only (an
 *  immigration authority or national job board doesn't vary by city -
 *  same "shared across every city in that country" pattern as
 *  countryPopulation etc. in DemographicsFields). Curated via /admin,
 *  stored in its own `country_resource_links` Supabase table (see
 *  schema.sql) - deliberately NOT part of the cached CityExploreData
 *  blob, so adding/editing a link shows up immediately rather than
 *  waiting on that city's next city_scores refresh (up to
 *  CACHE_TTL_DAYS). Fetched by its own lightweight endpoint
 *  (GET /api/explore/resource-links?countryCode=..) instead. */
export type ResourceLinkCategory = "home" | "immigration" | "health" | "jobs";

export const RESOURCE_LINK_CATEGORIES: ResourceLinkCategory[] = ["home", "immigration", "health", "jobs"];

/** Display labels only — the underlying category keys (and the
 *  `country_resource_links.category` CHECK constraint in schema.sql) stay
 *  "home"/"immigration"/"health"/"jobs" regardless of copy changes here. */
export const RESOURCE_LINK_CATEGORY_LABELS: Record<ResourceLinkCategory, string> = {
  home: "Property",
  immigration: "Visa and Immigration",
  health: "Health System",
  jobs: "Jobs",
};

export interface ResourceLink {
  id: string;
  category: ResourceLinkCategory;
  title: string;
  url: string;
}

export type ResourceLinksByCategory = Record<ResourceLinkCategory, ResourceLink[]>;

export const SECTION_WEIGHTS: Record<SectionKey, number> = {
  safetyStability: 0.3,
  economy: 0.25,
  climate: 0.25,
  liveability: 0.2,
};

export const SECTION_LABELS: Record<SectionKey, string> = {
  safetyStability: "Safety & Stability",
  economy: "Economy",
  climate: "Climate",
  liveability: "Liveability",
};

export interface SectionScores {
  economy: number;
  safetyStability: number;
  climate: number;
  liveability: number;
}

export interface CityExploreData {
  cityId: string;
  cityName: string;
  region: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;

  /** Supplementary info, shown next to the city name — not scored. */
  demographics: DemographicsFields;
  economy: EconomyFields;
  safetyStability: SafetyStabilityFields;
  climate: ClimateFields;
  liveability: LiveabilityFields;

  sectionScores: SectionScores;
  piltriScore: number; // 0-100 weighted average
  lastUpdated: string; // ISO date
}

/** Point-to-point directions in Pin mode (see MapView's route effect and
 *  PinPanel's directions block) — driving is the primary/always-drawn
 *  route (car distance + time), walking is a duration-only lookup shown
 *  alongside it on request. There's deliberately no public-transport field:
 *  Mapbox's Directions API (the only routing source this app uses) has no
 *  transit profile on its free tier, so rather than fake a number, the UI
 *  discloses that honestly instead of pretending to have it. */
export interface TravelTimes {
  car: { minutes: number; km: number };
  /** Null when the walking lookup itself failed/found no route - shown
   *  honestly as "not available" rather than silently hidden. */
  walkingMinutes: number | null;
}

/** A single "nearest X" lookup in Pin mode — carries the matched place's
 *  name and coordinates alongside the travel time, not just a number, so
 *  the UI can show what was actually found and link out to directions.
 *  `minutes` is null when nothing was found within range at all;
 *  `name`/`lat`/`lng` are null whenever nothing was matched. */
export interface NearbyPlace {
  minutes: number | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
}

/** Pinned mode — point-specific fields. Deliberately trimmed to the 4
 *  things people actually asked to see for an arbitrary map point: distance
 *  to the sea, to a mountain, to an airport, and to a train station. The
 *  earlier 13-field version (schools, subway, high street, hospitals, etc.)
 *  fired ~13 parallel lookups per pin and was the single biggest reliability
 *  complaint (see KNOWN-ISSUES.md history) — this is simpler and faster,
 *  not just shorter. */
export interface PinnedLocationData {
  lat: number;
  lng: number;
  neighbourhoodName: string | null;
  nearestBeach: NearbyPlace;
  nearestMountain: NearbyPlace;
  nearestTrainStation: NearbyPlace;
  nearestAirport: NearbyPlace;
}

export interface CitySearchResult {
  cityId: string;
  cityName: string;
  region: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
}

/** Discover mode — candidate city, from the static shortlist (data/static/discover-cities.json). */
export interface DiscoverCity {
  cityId: string;
  cityName: string;
  region: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  population: number;
}

/** Discover mode filter criteria — minimum acceptable score (0-100) per
 *  section, plus optional custom weights overriding SECTION_WEIGHTS for
 *  the Piltri Score calculation. Omitted/undefined minimum = no floor for
 *  that section. Weights don't need to sum to 100 on the way in; the API
 *  normalises them. */
export interface DiscoverFilters {
  minScores: Partial<SectionScores>;
  weights?: Partial<SectionScores>;
}

/** One Discover mode result — a candidate city that met the filters, with
 *  its computed scores attached (same shape as the single-city results page
 *  uses, minus the full field breakdown — just enough for a result card). */
export interface DiscoverResult {
  cityId: string;
  cityName: string;
  region: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  sectionScores: SectionScores;
  piltriScore: number;
}

/* ------------------------------------------------------------------------
 * Advanced search (the "Advanced search" link on the results page, at
 * /explore/discover) — proposes every existing criterion in the app as a
 * filter: the 4 scored sections' individual fields, demographics, and the
 * "nearest X" distance fields Pin mode computes, run from each city's own
 * centre point rather than a manually dropped pin.
 *
 * Two scopes, confirmed with the user directly:
 *  - "city": results are individual cities from the shortlist.
 *  - "country": results are countries. There's no separate country-level
 *    data source — a country's numbers are a genuine roll-up of whichever
 *    of our shortlisted cities are in it (mean for numeric fields, OR for
 *    booleans/"is there one anywhere" distance criteria) rather than an
 *    authoritative national statistic. This is disclosed in the UI via
 *    citiesTracked on each CountryResult, not silently presented as if it
 *    were official country data.
 * ---------------------------------------------------------------------- */

export type AdvancedSearchScope = "city" | "country";

/** One active filter on one criterion (see lib/advancedSearch/criteria.ts
 *  for the full registry of what `key` can be). Only the field matching the
 *  criterion's kind is set — `min`/`max` for "range", `bool` for "boolean",
 *  `select` for "select" (e.g. safety trend). All optional so a
 *  "range" filter can constrain just a floor, just a ceiling, or both. */
export interface AdvancedSearchCriterionFilter {
  key: string;
  min?: number;
  max?: number;
  bool?: boolean;
  select?: string;
}

export interface AdvancedSearchRequest {
  scope: AdvancedSearchScope;
  filters: AdvancedSearchCriterionFilter[];
  weights?: Partial<SectionScores>;
}

/** The value a matched criterion actually resolved to for one result, kept
 *  alongside the result so the UI can show e.g. "Beach: 18 min" without the
 *  client re-deriving it. Only populated for criteria the user actually
 *  filtered on, not every criterion in the registry (keeps the payload
 *  small across up to 500 candidates). */
export type CriterionValue = number | boolean | string | null;

export interface AdvancedSearchCityResult {
  cityId: string;
  cityName: string;
  region: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  sectionScores: SectionScores;
  piltriScore: number;
  matchedValues: Record<string, CriterionValue>;
}

export interface AdvancedSearchCountryResult {
  country: string;
  countryCode: string;
  /** How many of our shortlisted cities in this country contributed to the
   *  roll-up below — shown in the UI so a 1-city "average" doesn't read as
   *  more authoritative than it is. */
  citiesTracked: number;
  /** Average lat/lng of this country's tracked cities — a rough "where its
   *  cities cluster" point, not an official country centroid (we don't have
   *  country boundary/centroid data). Used to place a single pin on the
   *  Advanced search results map. */
  lat: number;
  lng: number;
  sectionScores: SectionScores;
  piltriScore: number;
  matchedValues: Record<string, CriterionValue>;
  /** Every criterion in the registry (lib/advancedSearch/criteria.ts), not
   *  just the ones the search actually filtered on — powers the country
   *  overview page's full KPI breakdown. Only computed for the results
   *  actually returned (after sorting/capping to MAX_RESULTS), and reuses
   *  data already fetched during matching rather than issuing new live
   *  calls — so Nearby & distance criteria only appear here when the
   *  search itself already needed pin data (i.e. a Nearby filter was
   *  active); otherwise those specific fields are simply absent rather
   *  than triggering an extra live-per-city fetch just to fill in the
   *  overview page. */
  allValues: Record<string, CriterionValue>;
}

export interface AdvancedSearchResponse {
  scope: AdvancedSearchScope;
  totalCandidates: number;
  checked: number;
  failed: number;
  /** Candidates skipped because they aren't in the Supabase cache yet —
   *  Advanced search only ever reads cached data (never live-aggregates a
   *  candidate mid-search), so a city/country the scheduled warm job
   *  hasn't reached yet simply doesn't appear rather than making the
   *  search wait on live external APIs. See HANDOFF.md's performance
   *  notes for why. */
  notYetCached: number;
  matchCount: number;
  cityResults?: AdvancedSearchCityResult[];
  countryResults?: AdvancedSearchCountryResult[];
}
