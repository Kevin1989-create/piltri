import { normalise } from "@/lib/aggregation/scoring";
import { formatCurrency, formatTemperature, type UnitPreferences } from "@/lib/unitPreferences";
import type { CityExploreData, EconomyTypeProfile, SectionKey, TrendDirection } from "@/lib/types";

/** How precisely a KPI's value is actually known, given its real current
 *  source — not aspirational, what's true today. "country" covers genuine
 *  country-level APIs (World Bank, WHO, REST Countries). "pinned" is for
 *  the handful of fields already computed from an exact coordinate
 *  (Open-Meteo climate, Overpass local amenity density and transport
 *  presence, Wikidata nearby-entity lookups) — genuinely finer than city,
 *  not coarser. Nothing currently qualifies as "city" — that tier is
 *  reserved for once a real per-city source (e.g. Numbeo for Real Estate)
 *  is wired in; until then no KPI should claim it. */
export type PrecisionTier = "country" | "city" | "pinned";

export interface KpiRow {
  label: string;
  value: string;
  precision: PrecisionTier;
  /** Tailwind text-color class (text-score-strong/moderate/weak), applied
   *  to the value only where a metric has a clear, non-subjective "better
   *  vs worse" direction (see tierColorClass/colorable helpers below).
   *  Left undefined for purely descriptive values (a language name, a
   *  category label) — forcing green/red onto something with no real
   *  good/bad direction would be misleading, not informative. */
  colorClass?: string;
  /** Optional hover definition shown on the label, for a metric whose name
   *  alone doesn't make clear what it measures. */
  hint?: string;
}

/** Short hover-label shown on the precision icon next to each stat (see
 *  components/explore/SectionDetail.tsx and app/explore/report/page.tsx) —
 *  kept here as the single shared copy so the two never say something
 *  different for the same tier. */
export const PRECISION_LABEL: Record<PrecisionTier, string> = {
  country: "Country Data",
  city: "City Data",
  pinned: "Pinned Data",
};

// Same 3-tier colour language used in CityHeader.tsx for demographics -
// duplicated here rather than imported since CityHeader's copy is a
// component-local concern; this one is the shared KPI-row version used by
// SectionDetail.tsx and the printable report page.
function tierColorClass(value0to100: number): string {
  if (value0to100 >= 67) return "text-score-strong";
  if (value0to100 >= 34) return "text-score-moderate";
  return "text-score-weak";
}

function yesNoColorClass(isYes: boolean): string {
  return isYes ? "text-score-strong" : "text-score-weak";
}

function trendColorClass(trend: TrendDirection): string {
  if (trend === "Improving") return "text-score-strong";
  if (trend === "Worsening") return "text-score-weak";
  return "text-score-moderate";
}

// Reference ranges used only for KPI-row colour coding - kept in sync by
// hand with the equivalent ranges in lib/aggregation/aggregate.ts (which
// feed the actual section scores). Where a field is already stored as a
// 0-100 "goodness" score elsewhere (e.g. purchasingPowerIndex,
// politicalStabilityScore), this file colours it directly instead of
// re-deriving a range for it.
const COLOR_RANGES = {
  gdpGrowth: { min: -5, max: 8 },
  // averageSalaryGbp is gniPerCapitaUsd * 0.79 (see aggregate.ts) - range
  // scaled by the same factor so this stays consistent with the raw-USD
  // range actually used for scoring, even though the displayed figure is
  // the converted GBP one.
  salaryGbp: { min: 1580, max: 71100 },
  unemployment: { min: 0, max: 25 },
  temperatureDistanceFrom20C: { min: 0, max: 20 },
  restaurantsBarsPer10k: { min: 0, max: 40 },
  greenSpacePct: { min: 0, max: 20 }, // see aggregate.ts - already divided down from a 0-100 normalise() call
  culturalVenuesPer10k: { min: 0, max: 10 },
  familyActivitiesPer10k: { min: 0, max: 15 },
  // Rainfall/sunshine/snowfall don't have an app-established scoring
  // direction the way risk/readiness metrics do, but colour is still
  // useful for comparing cities against each other - these 3 ranges are a
  // disclosed, reasonable-default judgment call, not an objective "correct"
  // answer: rainfall treats a temperate ~1000mm/yr as the sweet spot
  // (too dry or too wet both read as less favourable, same "distance from
  // an ideal" shape as temperature above); sunshine treats more hours as
  // better; snowfall treats less as better. Reasonable people can disagree
  // with any of these three - happy to flip a direction on request. These
  // 3 ranges match aggregate.ts's RANGES exactly, since (unlike the old
  // version of this file) rainfall/sunshine/snowfall now feed the actual
  // Climate score too, not just this display.
  rainfallDistanceFromIdeal: { min: 0, max: 1000 }, // ideal centre: 1000mm/yr
  sunshineHrs: { min: 1200, max: 3800 },
  snowfallCm: { min: 0, max: 300 },
  // Ranked universities/restaurants: no single "correct" ceiling exists,
  // but 5+ of either is already an exceptional, world-class-hub-tier count
  // (a handful of cities globally), so it anchors the top of the range.
  notableCount: { min: 0, max: 5 },
};

export const ECONOMY_TYPE_LABELS: Record<keyof EconomyTypeProfile, string> = {
  technologyAndInnovation: "Technology & Innovation",
  tourismAndHospitality: "Tourism & Hospitality",
  financeAndServices: "Finance & Services",
  manufacturingAndIndustry: "Manufacturing & Industry",
  governmentAndPublicSector: "Government & Public Sector",
  naturalResourcesAndAgriculture: "Natural Resources & Agriculture",
};

/** The city's likely dominant local sector — genuinely computed from OSM
 *  POI/land-use density within range of its exact coordinates (see
 *  lib/data-sources/overpass.ts getEconomySectorCounts / pickMainEconomyType),
 *  not a placeholder. Left uncoloured - a category label, not a good/bad
 *  value. */
export function buildCityEconomyTypeRows(data: CityExploreData): KpiRow[] {
  const e = data.economy;
  return [
    {
      label: "Main economy type",
      value: e.mainEconomyType ? ECONOMY_TYPE_LABELS[e.mainEconomyType] : "Not enough local data",
      precision: "pinned",
    },
  ];
}

/** Shared source of truth for each section's KPI list — used by the results
 *  page's SectionDetail panel and by the printable report page, so the two
 *  never drift out of sync with each other. Precision tags reflect the
 *  actual data source wired in today (see lib/aggregation/aggregate.ts) —
 *  update the relevant row here the day a field's real source changes,
 *  e.g. when Numbeo brings Real Estate back into the scored model. */
export function buildKpiRows(section: SectionKey, data: CityExploreData, prefs: UnitPreferences): KpiRow[] {
  switch (section) {
    case "economy": {
      const e = data.economy;
      return [
        {
          label: "Economic growth (5yr GDP)",
          value: `${e.economicGrowth5yrGdpPct > 0 ? "+" : ""}${e.economicGrowth5yrGdpPct}%`,
          precision: "country",
          colorClass: tierColorClass(normalise(e.economicGrowth5yrGdpPct, COLOR_RANGES.gdpGrowth.min, COLOR_RANGES.gdpGrowth.max)),
        },
        {
          label: "Average salary",
          value: formatCurrency(e.averageSalaryGbp, prefs),
          precision: "country",
          colorClass: tierColorClass(normalise(e.averageSalaryGbp, COLOR_RANGES.salaryGbp.min, COLOR_RANGES.salaryGbp.max)),
        },
        {
          label: "Unemployment rate",
          value: `${e.unemploymentRatePct}%`,
          precision: "country",
          colorClass: tierColorClass(normalise(e.unemploymentRatePct, COLOR_RANGES.unemployment.min, COLOR_RANGES.unemployment.max, true)),
        },
        {
          label: "Cost of living index",
          value: `${e.costOfLivingIndex}`,
          precision: "country",
          colorClass: tierColorClass(100 - e.costOfLivingIndex), // lower cost = better
          hint: "World Bank price level index — how expensive this country is relative to a global baseline",
        },
        {
          label: "Purchasing power index",
          value: `${e.purchasingPowerIndex}`,
          precision: "country",
          colorClass: tierColorClass(e.purchasingPowerIndex), // already a 0-100 goodness score
        },
      ];
    }
    case "safetyStability": {
      const s = data.safetyStability;
      return [
        {
          label: "Political stability score",
          value: `${s.politicalStabilityScore}`,
          precision: "country",
          colorClass: tierColorClass(s.politicalStabilityScore),
          hint: "World Bank Worldwide Governance Indicators",
        },
        {
          label: "Rule of law score",
          value: `${s.ruleOfLawScore}`,
          precision: "country",
          colorClass: tierColorClass(s.ruleOfLawScore),
          hint: "World Bank Worldwide Governance Indicators",
        },
        { label: "Safety trend", value: s.safetyTrend, precision: "country", colorClass: trendColorClass(s.safetyTrend) },
      ];
    }
    case "climate": {
      const c = data.climate;
      return [
        {
          label: "Avg annual temperature",
          value: formatTemperature(c.avgAnnualTemperatureC, prefs),
          precision: "pinned",
          colorClass: tierColorClass(
            normalise(
              Math.abs(c.avgAnnualTemperatureC - 20),
              COLOR_RANGES.temperatureDistanceFrom20C.min,
              COLOR_RANGES.temperatureDistanceFrom20C.max,
              true
            )
          ),
        },
        {
          label: "Avg annual rainfall",
          value: `${c.avgAnnualRainfallMm} mm`,
          precision: "pinned",
          colorClass: tierColorClass(
            normalise(
              Math.abs(c.avgAnnualRainfallMm - 1000),
              COLOR_RANGES.rainfallDistanceFromIdeal.min,
              COLOR_RANGES.rainfallDistanceFromIdeal.max,
              true
            )
          ),
        },
        {
          label: "Avg annual sunshine",
          value: `${c.avgAnnualSunshineHrs} hrs`,
          precision: "pinned",
          colorClass: tierColorClass(normalise(c.avgAnnualSunshineHrs, COLOR_RANGES.sunshineHrs.min, COLOR_RANGES.sunshineHrs.max)),
        },
        {
          label: "Avg annual snowfall",
          value: `${c.avgAnnualSnowfallCm} cm`,
          precision: "pinned",
          colorClass: tierColorClass(normalise(c.avgAnnualSnowfallCm, COLOR_RANGES.snowfallCm.min, COLOR_RANGES.snowfallCm.max, true)),
        },
      ];
    }
    case "liveability": {
      const l = data.liveability;
      return [
        {
          label: "Restaurants & bars density",
          value: `${l.restaurantsBarsDensityPer10k} / 10k`,
          precision: "pinned",
          colorClass: tierColorClass(
            normalise(l.restaurantsBarsDensityPer10k, COLOR_RANGES.restaurantsBarsPer10k.min, COLOR_RANGES.restaurantsBarsPer10k.max)
          ),
        },
        {
          label: "Green space",
          value: `${l.greenSpacePctOfCityArea}% of city area`,
          precision: "pinned",
          colorClass: tierColorClass(normalise(l.greenSpacePctOfCityArea, COLOR_RANGES.greenSpacePct.min, COLOR_RANGES.greenSpacePct.max)),
        },
        {
          label: "Cultural venues density",
          value: `${l.culturalVenuesDensityPer10k} / 10k`,
          precision: "pinned",
          colorClass: tierColorClass(
            normalise(l.culturalVenuesDensityPer10k, COLOR_RANGES.culturalVenuesPer10k.min, COLOR_RANGES.culturalVenuesPer10k.max)
          ),
        },
        {
          label: "Family & kids activities density",
          value: `${l.familyKidsActivitiesDensityPer10k} / 10k`,
          precision: "pinned",
          colorClass: tierColorClass(
            normalise(l.familyKidsActivitiesDensityPer10k, COLOR_RANGES.familyActivitiesPer10k.min, COLOR_RANGES.familyActivitiesPer10k.max)
          ),
        },
        {
          label: "Healthcare quality score",
          value: `${l.healthcareQualityScore}`,
          precision: "country",
          colorClass: tierColorClass(l.healthcareQualityScore),
        },
      ];
    }
  }
}

/** The 4 Overpass-sourced transport presence flags, split out of the main
 *  Liveability row list into their own "Transport Access" sub-block -
 *  keeping the main grid tighter than one flat wall of rows. Coloured
 *  Yes=green/No=red as a simple presence-is-positive read. */
export function buildLiveabilityTransportRows(data: CityExploreData): KpiRow[] {
  const l = data.liveability;
  return [
    { label: "Train station", value: l.hasTrainStation ? "Yes" : "No", precision: "pinned", colorClass: yesNoColorClass(l.hasTrainStation) },
    { label: "Subway", value: l.hasSubway ? "Yes" : "No", precision: "pinned", colorClass: yesNoColorClass(l.hasSubway) },
    { label: "Tramway", value: l.hasTramway ? "Yes" : "No", precision: "pinned", colorClass: yesNoColorClass(l.hasTramway) },
    { label: "Airport", value: l.hasAirport ? "Yes" : "No", precision: "pinned", colorClass: yesNoColorClass(l.hasAirport) },
  ];
}

/** The 2 Wikidata-sourced notable-institution counts, in their own
 *  "Notable Institutions" sub-block alongside Transport Access above.
 *  Coloured against a 0-5 range so it reads as high/low vs. other cities -
 *  see COLOR_RANGES.notableCount for the reasoning (0 isn't a "failing",
 *  just the bottom of a wide, mostly-empty range most cities sit in). */
export function buildLiveabilityNotableRows(data: CityExploreData): KpiRow[] {
  const l = data.liveability;
  return [
    {
      label: "Ranked universities",
      value: String(l.worldRankedUniversityCount),
      precision: "pinned",
      colorClass: tierColorClass(normalise(l.worldRankedUniversityCount, COLOR_RANGES.notableCount.min, COLOR_RANGES.notableCount.max)),
    },
    {
      label: "Ranked restaurants",
      value: String(l.notableRestaurantCount),
      precision: "pinned",
      colorClass: tierColorClass(normalise(l.notableRestaurantCount, COLOR_RANGES.notableCount.min, COLOR_RANGES.notableCount.max)),
    },
  ];
}
