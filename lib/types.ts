/**
 * Piltri — Explore data model.
 *
 * 4 scored sections (Economy, Safety, Environment, Quality of Life - see
 * SECTION_LABELS; the SectionKey identifiers keep their original
 * economy/safetyStability/climate/liveability names) + Demographics as
 * supplementary, unscored info. There's no Real Estate section: no free,
 * reliable, global price source exists.
 *
 * Every value comes from the offline dataset (pipeline/, see its README
 * for sources). Country-level fields are identical for every city in a
 * country; city-level fields are computed from the city's own coordinates.
 * A field is null when its source has no value for that place - it's then
 * left out of the UI and the scores, never shown as a made-up default.
 */

/** Direction of a metric's recent trend (Safety's political stability). */
export type TrendDirection = "Improving" | "Stable" | "Worsening";

export interface DemographicsFields {
  /** World Bank SP.POP.TOTL. */
  countryPopulation: number | null;
  /** World Bank EN.POP.DNST. */
  countryPopulationDensityPerKm2: number | null;
  /** World Bank AG.LND.TOTL.K2. */
  countryLandAreaKm2: number | null;
  /** UN World Population Prospects 2024, median age. */
  countryAverageAge: number | null;
  /** World Bank SP.POP.TOTL, change over the last ~5 years. */
  countryPopulationTrend5yrPct: number | null;
  /** GeoNames countryInfo.txt, first listed language. */
  countryMostWidelySpokenLanguage: string | null;

  /** GeoNames population of the place itself (city proper, or a district
   *  of a larger city). */
  cityPopulation: number | null;
  /** People per km² within 5 km of the centre (GHS-POP 2025 1 km grid) -
   *  the same fixed area for every place, so directly comparable, unlike
   *  densities over arbitrary administrative boundaries. */
  cityDensityPerKm2: number | null;
  /** IANA time zone, e.g. "Europe/Lisbon" (GeoNames). */
  timezone: string | null;
}

export type GdpSector = "Agriculture" | "Industry" | "Services";

export interface GdpSectorShare {
  sector: GdpSector;
  sharePct: number; // 0-100, % of GDP
}

/** All country-level (World Bank unless noted). */
export interface EconomyFields {
  /** Real GDP change over ~5 years (constant 2015 US$). */
  economicGrowth5yrGdpPct: number;
  /** GNI per capita converted to GBP - an average-income proxy. */
  averageSalaryGbp: number;
  unemploymentRatePct: number;
  /** Agriculture/Industry/Services by share of GDP, largest first (0-3
   *  entries - only sectors World Bank has a value for). */
  gdpSectorRanking: GdpSectorShare[];
  /** Price level index (PA.NUS.PRVT.PLI) normalised to 0-100. */
  costOfLivingIndex: number;
  /** GDP per capita PPP normalised to 0-100. */
  purchasingPowerIndex: number;
  /** GDP, current US$. */
  gdpUsd: number | null;
  /** Rank by gdpUsd among ~214 economies (1 = largest). */
  gdpWorldRank: number | null;
  taxRevenuePctGdp: number | null;
  /** Local currency (GeoNames countryInfo.txt). */
  currency: { code: string; name: string } | null;
}

/** World Bank Worldwide Governance Indicators (0-100) and UNODC homicide
 *  rate - national by nature. */
export interface SafetyStabilityFields {
  politicalStabilityScore: number;
  ruleOfLawScore: number;
  safetyTrend: TrendDirection;
  homicideRatePer100k: number;
}

/** Climate normals are WorldClim 2.1 (1970-2000) at the city's coordinates;
 *  hazards and air quality are also per city. */
export interface ClimateFields {
  avgAnnualTemperatureC: number;
  avgAnnualRainfallMm: number;
  /** Estimated from solar radiation (FAO-56 Angström-Prescott). */
  avgAnnualSunshineHrs: number;
  /** Estimated from precipitation in below-freezing months. */
  avgAnnualSnowfallCm: number;
  /** Köppen-Geiger climate type, e.g. "Cfb" (temperate oceanic) - Beck et
   *  al. (2023) map, 1991-2020 - and its projection for 2071-2099 under a
   *  middle-of-the-road emissions scenario (SSP2-4.5). */
  koppenCode: string | null;
  koppenCode2085: string | null;
  avgAnnualHumidityPct: number;
  /** Average daily high of the warmest month / low of the coldest month. */
  hottestMonthHighC: number | null;
  coldestMonthLowC: number | null;
  /** Month-by-month normals (January first), for the climate chart. */
  monthly: { highC: number[]; lowC: number[]; rainMm: number[] } | null;
  elevationM: number | null;
  /** Annual mean PM2.5, µg/m³ (ACAG satellite-derived, 2024). */
  avgAnnualPm25: number | null;
  /** Average noon UV index across the year, including cloud (from NASA
   *  POWER's 2001-2020 all-sky UV climatology). */
  avgAnnualUvIndexMax: number | null;
  /** Magnitude-5+ earthquakes within 200 km since 1970 (USGS). */
  earthquakeCount50yr: number | null;
  distanceToVolcanoKm: number | null;
  /** Disclosed proxies from elevation + distance to the coastline, not
   *  inundation models: coastal flood = High (≤5 m, ≤2 km) / Moderate
   *  (≤15 m, ≤10 km); sea level rise = High (≤2 m, ≤10 km) / Moderate
   *  (≤10 m, ≤25 km), after IPCC AR6's ~1 m high-end 2100 projection. Null
   *  when an input is missing - never read as "safe". */
  coastalFloodExposure: "High" | "Moderate" | "Low" | null;
  seaLevelRiseExposure: "High" | "Moderate" | "Low" | null;
  /** ND-GAIN country index, 0-100 (country-level). */
  climateReadinessScore: number | null;
  /** Solstice day lengths - pure astronomy from latitude. */
  longestDayHours: number;
  shortestDayHours: number;
}

/** Amenity counts, transport, internet and distances are per city;
 *  healthcare, life expectancy, internet access and PISA are national. */
export interface LiveabilityFields {
  /** Overture Maps places within 5 km of the centre. */
  restaurantsBarsWithin5km: number | null;
  parksWithin5km: number | null;
  culturalVenuesWithin5km: number | null;
  familyActivitiesWithin5km: number | null;
  /** WHO UHC service coverage index (0-100). */
  healthcareQualityScore: number;
  /** Within 5 km of the centre (40 km for airports). Metro = subway or
   *  monorail line or station; tram = tram or light rail track (Overture
   *  Maps / OpenStreetMap). */
  hasTrainStation: boolean | null;
  hasSubway: boolean | null;
  hasTramway: boolean | null;
  hasAirport: boolean | null;
  hasBusStation: boolean | null;
  hasSchool: boolean | null;
  hasUniversity: boolean | null;
  /** Average download speed of Speedtest results within 5 km (Ookla open
   *  data, latest quarter), in Mbps. */
  broadbandDownloadMbps: number | null;
  mobileDownloadMbps: number | null;
  /** Straight-line distances. */
  distanceToBeachKm: number | null;
  distanceToMountainKm: number | null;
  distanceToForestKm: number | null;
  distanceToCapitalKm: number | null;
  distanceToAirportKm: number | null;
  distanceToTrainStationKm: number | null;
  /** Nearest other city of 500,000+ people (null for those cities). */
  nearestLargeCity: { name: string; km: number } | null;
  lifeExpectancyYears: number | null;
  internetUsersPct: number | null;
  /** OECD PISA mean scores via World Bank - participating countries only. */
  pisaMathScore: number | null;
  pisaReadingScore: number | null;
  pisaScienceScore: number | null;
}

/** The 4 scored sections. */
export type SectionKey = "economy" | "safetyStability" | "climate" | "liveability";

/** Resources - a small, hand-curated set of external links per country
 *  (curated in /admin, stored in Supabase's country_resource_links table,
 *  fetched separately from the dataset so edits show up immediately). */
export type ResourceLinkCategory = "home" | "immigration" | "health" | "jobs";

export const RESOURCE_LINK_CATEGORIES: ResourceLinkCategory[] = ["home", "immigration", "health", "jobs"];

/** Shown to end users; "health" is kept in the DB and /admin but hidden. */
export const DISPLAYED_RESOURCE_LINK_CATEGORIES: ResourceLinkCategory[] = ["immigration", "home", "jobs"];

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
  safetyStability: "Safety",
  economy: "Economy",
  climate: "Environment",
  liveability: "Quality of Life",
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

  demographics: DemographicsFields;
  economy: EconomyFields;
  safetyStability: SafetyStabilityFields;
  climate: ClimateFields;
  liveability: LiveabilityFields;

  sectionScores: SectionScores;
  piltriScore: number; // 0-100 weighted average
  lastUpdated: string; // ISO date the dataset was built
  /** World rank among every city in the dataset (1 = best), overall at the
   *  default weighting and per section. */
  ranks?: CityRanks;
}

export interface CityRanks {
  piltri: number;
  economy: number;
  safetyStability: number;
  climate: number;
  liveability: number;
  outOf: number;
}

/** Pin mode directions - straight-line estimates (there's no routing
 *  engine, by design). */
export interface TravelTimes {
  car: { minutes: number; km: number };
  walkingMinutes: number | null;
}

/** A pin mode "nearest X": the matched place and a travel-time estimate.
 *  All null when nothing was found in range. */
export interface NearbyPlace {
  minutes: number | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
}

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

/* ------------------------------------------------------------------------
 * Advanced search (/explore/discover). Two scopes:
 *  - "city": individual cities.
 *  - "country": countries, each a roll-up of its tracked cities (mean for
 *    numbers, "any" for Yes/No) - disclosed via citiesTracked, not
 *    presented as an official national statistic.
 * ---------------------------------------------------------------------- */

export type AdvancedSearchScope = "city" | "country";

/** One active filter (see lib/advancedSearch/criteria.ts for the keys).
 *  Only the field matching the criterion's kind is set. */
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
  /** Values of the criteria the search filtered on. */
  matchedValues: Record<string, CriterionValue>;
}

export interface AdvancedSearchCountryResult {
  country: string;
  countryCode: string;
  /** How many shortlisted cities the roll-up is based on. */
  citiesTracked: number;
  /** Mean position of the tracked cities (a map pin, not a centroid). */
  lat: number;
  lng: number;
  sectionScores: SectionScores;
  piltriScore: number;
  matchedValues: Record<string, CriterionValue>;
  /** Every criterion's rolled-up value, for the country report page. */
  allValues: Record<string, CriterionValue>;
}

export interface AdvancedSearchResponse {
  scope: AdvancedSearchScope;
  /** Cities or countries checked (all of them - nothing is skipped). */
  checked: number;
  matchCount: number;
  cityResults?: AdvancedSearchCityResult[];
  countryResults?: AdvancedSearchCountryResult[];
}
