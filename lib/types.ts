/**
 * Piltri — Explore data model (LOCKED)
 * 5 scored sections + Demographics as supplementary info (not scored) + Overall
 * Source: piltri-project-brief.md, "Explore — Final data model" (amended:
 * Demographics moved out of the scored sections — a population/language
 * snapshot doesn't really have a "good/bad" score, so it's shown as
 * reference info next to the city name instead of a section card).
 */

export type EconomyTypeProfile = {
  technologyAndInnovation: number; // %
  tourismAndHospitality: number; // %
  financeAndServices: number; // %
  manufacturingAndIndustry: number; // %
  governmentAndPublicSector: number; // %
  naturalResourcesAndAgriculture: number; // %
};

export type CriminalityTrend = "Improving" | "Stable" | "Worsening";

/** Supplementary city info shown next to the name/region on the results
 *  page — not part of the scored sections (see SectionKey). No
 *  "officialLanguages" field — removed per product decision, since
 *  "most widely spoken language" already covers the useful case and a full
 *  official-languages list was more clutter than signal for most cities. */
export interface DemographicsFields {
  population: number;
  populationDensityPerKm2: number;
  populationTrend5yrPct: number;
  averageAge: number;
  mostWidelySpokenLanguage: string;
  englishProficiencyScore: number; // 0-100
  /** City land area (km²), from Wikidata (see
   *  lib/data-sources/wikidata.ts getCityPopulationAndArea). Null when no
   *  matching city entity/area statement was found - shown honestly as
   *  "not available" rather than estimated. `population` and
   *  `populationDensityPerKm2` are always displayed as city-level data
   *  (see CityHeader.tsx) - genuinely attempted per search via the same
   *  Wikidata lookup, falling back to the World Bank country figure only
   *  on a miss, per product decision. */
  areaKm2: number | null;
}

export interface EconomyFields {
  economicGrowth5yrGdpPct: number;
  averageSalaryGbp: number;
  unemploymentRatePct: number;
  economyTypeProfile: EconomyTypeProfile;
  /** The city's likely dominant local sector, from OSM POI/land-use
   *  density within range of its exact coordinates (see
   *  lib/data-sources/overpass.ts getEconomySectorCounts / pickMainEconomyType) -
   *  a genuinely city-level signal, unlike economyTypeProfile above which
   *  remains a flat country-level placeholder today. Null when the city
   *  has no local OSM signal at all (reported honestly, not guessed). */
  mainEconomyType: keyof EconomyTypeProfile | null;
  costOfLivingIndex: number; // 0-100
  purchasingPowerIndex: number; // 0-100
}

export interface RealEstateFields {
  pricePerM2BuyGbp: number;
  avgMonthlyRent1BedGbp: number;
  realEstateTrend3yrPct: number;
}

export interface SafetyStabilityFields {
  criminalityScore: number; // 0-100 (higher = safer, normalised at aggregation time)
  criminalityTrend: CriminalityTrend;
  geopoliticalTensionScore: number; // 0-100
}

export interface ClimateFields {
  avgAnnualTemperatureC: number;
  avgAnnualRainfallMm: number;
  avgAnnualSunshineHrs: number;
  avgAnnualSnowfallCm: number;
  naturalDisasterRiskScore: number; // 0-100
  seaLevelRiseExposure: number; // 0-100
  extremeWeatherRisk: number; // 0-100
  /** ND-GAIN Country Index (Notre Dame Global Adaptation Initiative) - a
   *  free, official, annually-updated 0-100 measure of a country's climate
   *  vulnerability and readiness to adapt. Additive alongside the 3 fields
   *  above (which remain manual placeholders today) rather than replacing
   *  them - see lib/data-sources/manual-sources.ts. */
  ndGainScore: number; // 0-100
}

export interface LiveabilityFields {
  publicTransportScore: number; // 0-100
  restaurantsBarsDensityPer10k: number;
  greenSpacePctOfCityArea: number;
  culturalVenuesDensityPer10k: number;
  schoolQualityScore: number; // 0-100
  familyKidsActivitiesDensityPer10k: number;
  healthcareQualityScore: number; // 0-100
  // Presence flags (Overpass/OpenStreetMap-sourced, computed from this
  // city's exact coordinates - see lib/data-sources/overpass.ts).
  hasTrainStation: boolean;
  hasSubway: boolean;
  hasTramway: boolean;
  hasAirport: boolean;
  // Counts sourced from Wikidata (see lib/data-sources/wikidata.ts).
  // "Ranked universities nearby": count of institutions within range that
  // carry at least one of the 3 major global ranking IDs Wikidata tracks
  // as a dedicated external-ID property - QS World University ID (P5584),
  // Times Higher Education World University ID (P5586), or ARWU/Shanghai
  // Ranking university ID (P5242). Counts an institution once even if it
  // has more than one of the three.
  // "Notable restaurants nearby": count of restaurants within range that
  // either carry a Michelin Restaurants ID (P4160 - reflects Michelin
  // Guide inclusion generally, not confirmed star status specifically) or
  // have received an award that is part of The World's 50 Best
  // Restaurants (Q2918929). The 50-Best half of this query is genuinely
  // unverified - see the header comment in wikidata.ts.
  worldRankedUniversityCount: number;
  notableRestaurantCount: number;
}

/** The 5 SCORED sections. Demographics is deliberately not here — it's
 *  supplementary info on CityExploreData.demographics, not part of the
 *  Piltri Score. */
export type SectionKey = "economy" | "realEstate" | "safetyStability" | "climate" | "liveability";

export const SECTION_WEIGHTS: Record<SectionKey, number> = {
  safetyStability: 0.25,
  economy: 0.2,
  realEstate: 0.2,
  climate: 0.2,
  liveability: 0.15,
};

export const SECTION_LABELS: Record<SectionKey, string> = {
  safetyStability: "Safety & Stability",
  economy: "Economy",
  realEstate: "Real Estate",
  climate: "Climate",
  liveability: "Liveability",
};

export interface SectionScores {
  economy: number;
  realEstate: number;
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
  realEstate: RealEstateFields;
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
 *  `minutes` is null when nothing was found within range at all (or, for
 *  optional amenities like a subway station, when none exists nearby);
 *  `name`/`lat`/`lng` are null whenever nothing was matched. */
export interface NearbyPlace {
  minutes: number | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
}

/** Pinned mode — point-specific fields (checklist "Pinned mode — final
 *  field list"). Real estate was removed from here (see
 *  lib/aggregation/pin.ts history) - it was never genuinely point-specific
 *  (a shared placeholder regardless of where the pin sat), and real estate
 *  now lives at city level via Numbeo instead. */
export interface PinnedLocationData {
  lat: number;
  lng: number;
  neighbourhoodName: string | null;
  education: {
    nearestSchool: NearbyPlace;
    nearestNursery: NearbyPlace;
    nearestUniversity: NearbyPlace;
  };
  transport: {
    trainStation: NearbyPlace;
    subwayStation: NearbyPlace;
    /** Nearest tram stop (railway=tram_stop) - separate from subwayStation,
     *  which now covers underground + overground/light-rail metro systems. */
    tramway: NearbyPlace;
    highStreet: NearbyPlace;
    domesticAirport: NearbyPlace;
    internationalAirport: NearbyPlace;
  };
  natureAndHealth: {
    beach: NearbyPlace;
    park: NearbyPlace;
    hospital: NearbyPlace;
    elderlyCare: NearbyPlace;
  };
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
 * filter: the 5 scored sections' individual fields, demographics, and the
 * same "nearest X" distance fields Pin mode computes, run from each city's
 * own centre point rather than a manually dropped pin.
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
 *  `select` for "select" (e.g. criminality trend). All optional so a
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
   *  than triggering an extra ~13-call-per-city fetch just to fill in the
   *  overview page. */
  allValues: Record<string, CriterionValue>;
}

export interface AdvancedSearchResponse {
  scope: AdvancedSearchScope;
  totalCandidates: number;
  checked: number;
  failed: number;
  matchCount: number;
  cityResults?: AdvancedSearchCityResult[];
  countryResults?: AdvancedSearchCountryResult[];
}
