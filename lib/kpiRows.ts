import { normalise } from "@/lib/aggregation/scoring";
import { formatCurrency, formatDistanceKm, formatTemperature, type UnitPreferences } from "@/lib/unitPreferences";
import { KOPPEN_LABELS } from "@/lib/data-sources/koppen";
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
  /** Optional smaller, secondary bit of text shown right after the main
   *  value - e.g. a "(73.1%)" share next to a sector name (see
   *  buildGdpSectorRows). Rendered visibly smaller than value itself,
   *  never coloured independently (inherits the row's own colorClass). */
  valueSuffix?: string;
}

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
  gdpGrowth: { min: -10, max: 40 }, // matches aggregate.ts's RANGES.gdpGrowth (cumulative ~6yr growth, not annual)
  // averageSalaryGbp is gniPerCapitaUsd * 0.79 (see aggregate.ts) - range
  // scaled by the same factor so this stays consistent with the raw-USD
  // range actually used for scoring, even though the displayed figure is
  // the converted GBP one.
  salaryGbp: { min: 1580, max: 71100 },
  unemployment: { min: 0, max: 25 },
  temperatureDistanceFrom20C: { min: 0, max: 20 },
  // Matches aggregate.ts's RANGES exactly - see that file's comment for the
  // live-data calibration behind these 3 (2026-09-21, after fixing the
  // per10k bug that was dividing by country population instead of city).
  restaurantsBarsPer10k: { min: 0, max: 30 },
  culturalVenuesPer10k: { min: 0, max: 3 },
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
  // WHO guideline: annual mean PM2.5 under 5 µg/m³ is "good". 80 as the
  // ceiling covers the world's most polluted major cities without
  // clamping every merely-average city to 0.
  pm25: { min: 5, max: 80 },
  // Disclosed subjective judgment calls (2026-09-24, on request - "it's
  // okay if we are subjective"), same "distance from an ideal centre"
  // shape as temperature/rainfall above. Humidity: ~50% is the commonly
  // cited human-comfort centre (drier or more humid both read as less
  // comfortable). UV: ~3 (moderate) as the centre balances "some sun
  // exposure" against sunburn/skin-cancer risk - reasonable people can
  // disagree with either centre, happy to flip on request.
  humidityDistanceFromIdeal: { min: 0, max: 50 }, // ideal centre: 50%
  uvIndexDistanceFromIdeal: { min: 0, max: 8 }, // ideal centre: 3
  // Real, verifiable USGS counts, not a modelled score - most places have
  // 0-5 M5+ quakes within 200km since 1970; genuinely active zones (Tokyo,
  // Jakarta) run into the hundreds. 100 as the ceiling separates those
  // extremes without clamping every moderate-risk city to 0.
  earthquakeCount50yr: { min: 0, max: 100 },
  // Farther from a volcano reads as safer, not closer - no "invert" flag
  // needed here (unlike earthquakeCount above), the raw distance itself
  // is already the "good" direction. 50km covers most cities' realistic
  // range; a handful within a few km of an active volcano are the extreme.
  distanceToVolcanoKm: { min: 0, max: 50 },
};

export const ECONOMY_TYPE_LABELS: Record<keyof EconomyTypeProfile, string> = {
  technologyAndInnovation: "Technology & Innovation",
  tourismAndHospitality: "Tourism & Hospitality",
  financeAndServices: "Finance & Services",
  manufacturingAndIndustry: "Manufacturing & Industry",
  governmentAndPublicSector: "Government & Public Sector",
  naturalResourcesAndAgriculture: "Natural Resources & Agriculture",
};

const GDP_SECTOR_RANK_LABELS = ["1st GDP sector", "2nd GDP sector", "3rd GDP sector"] as const;

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
      const rows: (KpiRow | null)[] = [
        // Genuinely computed from OSM POI/land-use density within range of
        // this city's exact coordinates (see lib/data-sources/overpass.ts
        // getEconomySectorCounts / pickMainEconomyType), not a placeholder.
        // Omitted entirely rather than shown as "Not enough Data" when it
        // doesn't resolve (2026-09-24, on request: show it only when it's
        // genuinely solid, same as the GDP sector ranking below - never a
        // placeholder for either). Folded into this same list rather than
        // its own labeled "Economy Type" sub-block (the extra heading for
        // a single row read as confusing); precision "pinned" still routes
        // it into the City group automatically via splitKpiRowsByTier.
        // Grey (text-ink-500, same as every row's own label text below it)
        // rather than black (2026-09-24, on request - black read as
        // identical to the "London"/"United Kingdom" group heading above
        // it) and rather than the usual red/green score spectrum, since
        // this is a plain descriptive label, not a good/bad value.
        e.mainEconomyType && {
          label: "Main economy type",
          value: ECONOMY_TYPE_LABELS[e.mainEconomyType],
          precision: "pinned",
          colorClass: "text-ink-500",
        },
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
          // toFixed(1) here (2026-09-24, on request - was showing raw,
          // un-rounded World Bank precision like "4.746%") - app-wide rule
          // going forward: no field shows more than 1 decimal place.
          label: "Unemployment rate",
          value: `${e.unemploymentRatePct.toFixed(1)}%`,
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
      return rows.filter((r): r is KpiRow => r != null);
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
        {
          label: "Homicide rate",
          // Falls back to 0 for rows cached before this field existed (the
          // 30-day Supabase cache serves those as-is until they naturally
          // re-aggregate) — same nullish-safe pattern as the rest of this
          // file's cached/optional fields.
          value: `${(s.homicideRatePer100k ?? 0).toFixed(1)} / 100k`,
          precision: "country",
          colorClass: tierColorClass(100 - Math.min(100, ((s.homicideRatePer100k ?? 0) / 30) * 100)), // lower = better
          hint: "Intentional homicides per 100,000 people — UNODC via World Bank",
        },
        { label: "Safety trend", value: s.safetyTrend, precision: "country", colorClass: trendColorClass(s.safetyTrend) },
      ];
    }
    case "climate": {
      const c = data.climate;
      const rows: (KpiRow | null)[] = [
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
        // Plain fact, grey (text-ink-500, same as every row's own label
        // text below it) rather than black (2026-09-24, on request - same
        // treatment already applied to Main economy type/GDP sector rows
        // in Economy: a climate type has no "good/bad" direction, so black
        // read as an implied judgement this row doesn't actually make).
        c.koppenCode
          ? {
              label: "Climate type",
              value: KOPPEN_LABELS[c.koppenCode] ?? c.koppenCode,
              precision: "pinned",
              colorClass: "text-ink-500",
              hint: `Köppen-Geiger classification: ${c.koppenCode} — computed from a 10-year Open-Meteo climate normal`,
            }
          : null,
        {
          // Coloured against a disclosed-subjective ideal centre (~50%,
          // 2026-09-24 on request - see COLOR_RANGES.humidityDistanceFromIdeal),
          // same "distance from an ideal" shape as temperature/rainfall.
          label: "Avg annual humidity",
          value: `${c.avgAnnualHumidityPct}%`,
          precision: "pinned",
          colorClass: tierColorClass(
            normalise(
              Math.abs(c.avgAnnualHumidityPct - 50),
              COLOR_RANGES.humidityDistanceFromIdeal.min,
              COLOR_RANGES.humidityDistanceFromIdeal.max,
              true
            )
          ),
        },
        c.elevationM != null
          ? {
              // Not coloured - "higher/lower elevation is better" has no
              // consensus direction, unlike humidity/UV where an ideal
              // centre is at least a defensible subjective call.
              label: "Elevation",
              value: `${c.elevationM.toLocaleString()} m`,
              precision: "pinned",
              colorClass: "text-ink-500",
            }
          : null,
        c.avgAnnualPm25 != null
          ? {
              label: "Air quality (PM2.5)",
              value: `${c.avgAnnualPm25} µg/m³`,
              precision: "pinned",
              // Lower is unambiguously healthier here (WHO guideline:
              // annual mean under 5 µg/m³) - a monotonic direction, not an
              // "ideal centre" the way humidity/UV get.
              colorClass: tierColorClass(normalise(c.avgAnnualPm25, COLOR_RANGES.pm25.min, COLOR_RANGES.pm25.max, true)),
              hint: "Annual mean PM2.5 (fine particulate matter) — WHO guideline: under 5 µg/m³",
            }
          : null,
        c.avgAnnualUvIndexMax != null
          ? {
              // Coloured against a disclosed-subjective ideal centre (~3,
              // "moderate" - 2026-09-24 on request), balancing some sun
              // exposure against sunburn/skin-cancer risk - see
              // COLOR_RANGES.uvIndexDistanceFromIdeal.
              label: "Avg UV index",
              value: `${c.avgAnnualUvIndexMax}`,
              precision: "pinned",
              colorClass: tierColorClass(
                normalise(
                  Math.abs(c.avgAnnualUvIndexMax - 3),
                  COLOR_RANGES.uvIndexDistanceFromIdeal.min,
                  COLOR_RANGES.uvIndexDistanceFromIdeal.max,
                  true
                )
              ),
              hint: "Average of each day's peak UV index over the trailing year",
            }
          : null,
        c.earthquakeCount50yr != null
          ? {
              label: "Seismic activity",
              value: `${c.earthquakeCount50yr} quakes (M5+)`,
              precision: "pinned",
              colorClass: tierColorClass(
                normalise(c.earthquakeCount50yr, COLOR_RANGES.earthquakeCount50yr.min, COLOR_RANGES.earthquakeCount50yr.max, true)
              ),
              hint: "USGS: magnitude-5+ earthquakes within 200km since 1970 — a real historical count, not a modelled risk score",
            }
          : null,
        c.distanceToVolcanoKm != null
          ? {
              label: "Distance to volcano",
              value: formatDistanceKm(c.distanceToVolcanoKm, prefs),
              precision: "pinned",
              colorClass: tierColorClass(
                normalise(c.distanceToVolcanoKm, COLOR_RANGES.distanceToVolcanoKm.min, COLOR_RANGES.distanceToVolcanoKm.max)
              ),
            }
          : null,
        c.coastalFloodExposure
          ? {
              label: "Coastal flood exposure",
              value: c.coastalFloodExposure,
              precision: "pinned",
              colorClass:
                c.coastalFloodExposure === "Low"
                  ? "text-score-strong"
                  : c.coastalFloodExposure === "Moderate"
                    ? "text-score-moderate"
                    : "text-score-weak",
              hint: "A simple proxy (elevation + coastline distance), not a real flood model — see the app's data notes",
            }
          : null,
        c.climateReadinessScore != null
          ? {
              label: "Climate change readiness",
              value: `${c.climateReadinessScore}`,
              precision: "country",
              colorClass: tierColorClass(c.climateReadinessScore),
              hint: "Notre Dame Global Adaptation Initiative (ND-GAIN) — country-level readiness + resilience, 0-100, higher is better",
            }
          : null,
      ];
      return rows.filter((r): r is KpiRow => r != null);
    }
    case "liveability": {
      const l = data.liveability;
      const rows: (KpiRow | null)[] = [
        {
          label: "Restaurants & bars density",
          value: `${l.restaurantsBarsDensityPer10k} / 10k`,
          precision: "pinned",
          colorClass: tierColorClass(
            normalise(l.restaurantsBarsDensityPer10k, COLOR_RANGES.restaurantsBarsPer10k.min, COLOR_RANGES.restaurantsBarsPer10k.max)
          ),
        },
        {
          label: "Green space score",
          value: `${l.greenSpaceScore}`,
          precision: "pinned",
          colorClass: tierColorClass(l.greenSpaceScore),
          hint: "Parks & gardens density within 5km of centre, normalised 0-100 - not a literal % of the city's land area",
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
        // "What's nearby" distances (2026-09-24, moved here from
        // Environment/Climate on request - proximity reads as a Quality
        // of Life question). Grey, not coloured - no consensus "closer is
        // better" direction for any of these (unlike restaurant/green-
        // space density above, which do have one). Omitted, not
        // placeholdered, when unresolved - see aggregate.ts's withTimeout
        // comment (beach/mountain/forest) and capitals.ts's own comment
        // (capital - only null for a handful of countries with no
        // GeoNames capital on file).
        l.distanceToBeachKm != null
          ? { label: "Distance to beach", value: formatDistanceKm(l.distanceToBeachKm, prefs), precision: "pinned", colorClass: "text-ink-500" }
          : null,
        l.distanceToMountainKm != null
          ? {
              label: "Distance to mountain",
              value: formatDistanceKm(l.distanceToMountainKm, prefs),
              precision: "pinned",
              colorClass: "text-ink-500",
            }
          : null,
        l.distanceToForestKm != null
          ? {
              label: "Distance to forest",
              value: formatDistanceKm(l.distanceToForestKm, prefs),
              precision: "pinned",
              colorClass: "text-ink-500",
            }
          : null,
        l.distanceToCapitalKm != null
          ? {
              label: "Distance to capital city",
              value: formatDistanceKm(l.distanceToCapitalKm, prefs),
              precision: "country",
              colorClass: "text-ink-500",
            }
          : null,
      ];
      return rows.filter((r): r is KpiRow => r != null);
    }
  }
}

/** Splits a section's KPI rows into Country vs City groups, using each
 *  row's precision tier as the source of truth - "country" rows go to
 *  Country, "pinned"/"city" rows (both genuinely tied to this city rather
 *  than its country - see PrecisionTier above) go to City. Mirrors
 *  CityHeader's Demographics split: a section with data at only one tier
 *  produces an empty array for the other, so callers render only the
 *  subsection that actually has content rather than a padded-out empty one. */
export function splitKpiRowsByTier(rows: KpiRow[]): { countryRows: KpiRow[]; cityRows: KpiRow[] } {
  return {
    countryRows: rows.filter((r) => r.precision === "country"),
    cityRows: rows.filter((r) => r.precision !== "country"),
  };
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

/** Economy's country-level GDP-sector ranking (Agriculture/Industry/
 *  Services, see lib/data-sources/worldbank.ts rankGdpSectors), split out
 *  of the main Economy row list into its own fixed-3-column block
 *  (2026-09-24, on request - so "1st/2nd/3rd GDP sector" always render on
 *  one row together left to right, regardless of how many other Economy
 *  rows come before them and what column count the main grid happens to
 *  use). One row per sector that actually resolved for this country (0-3
 *  rows - World Bank coverage is ~94-96%, not universal), never padded to
 *  3 with a placeholder. The % share renders via valueSuffix, visibly
 *  smaller than the sector name (2026-09-24, on request). */
export function buildGdpSectorRows(data: CityExploreData): KpiRow[] {
  return data.economy.gdpSectorRanking.slice(0, 3).map((entry, i) => ({
    label: GDP_SECTOR_RANK_LABELS[i],
    value: entry.sector,
    valueSuffix: `(${entry.sharePct.toFixed(1)}%)`,
    precision: "country",
    colorClass: "text-ink-500",
    hint: "World Bank national accounts — share of GDP by sector",
  }));
}

