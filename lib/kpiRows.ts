import { normalise } from "@/lib/aggregation/scoring";
import { COUNT_CAPS, countScore, RANGES } from "@/lib/dataset/assemble";
import { formatCurrency, formatDistanceKm, formatTemperature, type UnitPreferences } from "@/lib/unitPreferences";
import { KOPPEN_LABELS } from "@/lib/data-sources/koppen";
import type { CityExploreData, SectionKey, TrendDirection } from "@/lib/types";

/** Which tier a value describes: "country" (national statistics) or
 *  "pinned" (computed from this city's own coordinates). "city" is kept for
 *  a future per-city statistic from a city-level source. */
export type PrecisionTier = "country" | "city" | "pinned";

export interface KpiRow {
  label: string;
  value: string;
  precision: PrecisionTier;
  /** text-score-strong/moderate/weak where a metric has a clear better/worse
   *  direction; grey (text-ink-500) for plain descriptive facts. */
  colorClass?: string;
  /** Hover definition for the label. */
  hint?: string;
  /** Smaller secondary text after the value, e.g. "(73.1%)". */
  valueSuffix?: string;
}

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

const exposureColorClass = (level: "High" | "Moderate" | "Low") =>
  level === "Low" ? "text-score-strong" : level === "Moderate" ? "text-score-moderate" : "text-score-weak";

/** Colour-only reference ranges. Where a field feeds a section score, the
 *  range matches lib/dataset/assemble.ts's RANGES; the rest are disclosed
 *  judgement calls for comparing cities (e.g. ~50% humidity and UV ~3 as
 *  comfortable centres, a 20 °C summer high as ideal). */
const COLOR_RANGES = {
  // averageSalaryGbp is GNI per capita x 0.79 - the scoring range, converted.
  salaryGbp: { min: 1580, max: 71100 },
  humidityDistanceFromIdeal: { min: 0, max: 50 }, // ideal ~50%
  uvIndexDistanceFromIdeal: { min: 0, max: 8 }, // ideal ~3
  summerHighDistanceFromIdeal: { min: 0, max: 15 }, // ideal ~25 °C
  winterLowDistanceFromIdeal: { min: 0, max: 20 }, // ideal ~8 °C
  earthquakeCount50yr: { min: 0, max: 100 },
  distanceToVolcanoKm: { min: 0, max: 50 },
  gdpUsdLog10: { min: 9, max: 13.5 }, // $1bn to ~$30tn, log scale
  gdpWorldRank: { min: 1, max: 214 },
  lifeExpectancyYears: { min: 50, max: 85 },
  internetUsersPct: { min: 0, max: 100 },
  broadbandMbps: { min: 10, max: 300 },
  mobileMbps: { min: 5, max: 150 },
};

const GDP_SECTOR_RANK_LABELS = ["1st GDP sector", "2nd GDP sector", "3rd GDP sector"] as const;

/** "$4.0 trillion" / "$312.5 billion" - GDP is always quoted in US dollars. */
function formatGdpUsd(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)} trillion`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)} billion`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)} million`;
  return `$${value.toFixed(0)}`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const distanceRow = (label: string, km: number | null, prefs: UnitPreferences, hint: string): KpiRow | null =>
  km == null ? null : { label, value: formatDistanceKm(km, prefs), precision: "pinned", colorClass: "text-ink-500", hint };

/** Each section's KPI list - shared by the results page's detail panel and
 *  the printable report, so the two never drift apart. */
export function buildKpiRows(section: SectionKey, data: CityExploreData, prefs: UnitPreferences): KpiRow[] {
  switch (section) {
    case "economy": {
      const e = data.economy;
      // GDP, GDP world rank and growth lead (SectionDetail/report splice the
      // GDP sectors in after these three).
      const rows: (KpiRow | null)[] = [
        e.gdpUsd != null
          ? {
              label: "GDP",
              value: formatGdpUsd(e.gdpUsd),
              precision: "country",
              colorClass: tierColorClass(normalise(Math.log10(e.gdpUsd), COLOR_RANGES.gdpUsdLog10.min, COLOR_RANGES.gdpUsdLog10.max)),
              hint: "Gross domestic product, current US dollars (World Bank)",
            }
          : null,
        e.gdpWorldRank != null
          ? {
              label: "GDP world rank",
              value: ordinal(e.gdpWorldRank),
              precision: "country",
              colorClass: tierColorClass(normalise(e.gdpWorldRank, COLOR_RANGES.gdpWorldRank.min, COLOR_RANGES.gdpWorldRank.max, true)),
              hint: "Rank among 214 countries by GDP, current US dollars (World Bank)",
            }
          : null,
        {
          label: "Economic growth (5yr GDP)",
          value: `${e.economicGrowth5yrGdpPct > 0 ? "+" : ""}${e.economicGrowth5yrGdpPct}%`,
          precision: "country",
          colorClass: tierColorClass(normalise(e.economicGrowth5yrGdpPct, RANGES.gdpGrowth.min, RANGES.gdpGrowth.max)),
        },
        // A country's tax take is a policy choice, not good or bad - grey.
        e.taxRevenuePctGdp != null
          ? {
              label: "Tax revenue",
              value: `${e.taxRevenuePctGdp.toFixed(1)}% of GDP`,
              precision: "country",
              colorClass: "text-ink-500",
              hint: "Total tax revenue collected by government, as a share of GDP (World Bank)",
            }
          : null,
        {
          label: "Average salary",
          value: formatCurrency(e.averageSalaryGbp, prefs),
          precision: "country",
          colorClass: tierColorClass(normalise(e.averageSalaryGbp, COLOR_RANGES.salaryGbp.min, COLOR_RANGES.salaryGbp.max)),
          valueSuffix: "/ year",
          hint: "Gross national income per person (World Bank) - an average-income proxy",
        },
        {
          label: "Unemployment rate",
          value: `${e.unemploymentRatePct.toFixed(1)}%`,
          precision: "country",
          colorClass: tierColorClass(normalise(e.unemploymentRatePct, RANGES.unemployment.min, RANGES.unemployment.max, true)),
        },
        {
          label: "Cost of living index",
          value: `${e.costOfLivingIndex}`,
          precision: "country",
          colorClass: tierColorClass(100 - e.costOfLivingIndex),
          hint: "World Bank price level index — how expensive this country is relative to a global baseline",
        },
        {
          label: "Purchasing power index",
          value: `${e.purchasingPowerIndex}`,
          precision: "country",
          colorClass: tierColorClass(e.purchasingPowerIndex),
        },
        e.currency
          ? { label: "Currency", value: `${e.currency.name} (${e.currency.code})`, precision: "country", colorClass: "text-ink-500" }
          : null,
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
          value: `${s.homicideRatePer100k.toFixed(1)} / 100k`,
          precision: "country",
          colorClass: tierColorClass(normalise(s.homicideRatePer100k, RANGES.homicideRate.min, RANGES.homicideRate.max, true)),
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
            normalise(Math.abs(c.avgAnnualTemperatureC - 20), RANGES.temperatureDistanceFrom20C.min, RANGES.temperatureDistanceFrom20C.max, true)
          ),
        },
        c.hottestMonthHighC != null
          ? {
              label: "Summer high",
              value: formatTemperature(c.hottestMonthHighC, prefs),
              precision: "pinned",
              colorClass: tierColorClass(
                normalise(Math.abs(c.hottestMonthHighC - 25), COLOR_RANGES.summerHighDistanceFromIdeal.min, COLOR_RANGES.summerHighDistanceFromIdeal.max, true)
              ),
              hint: "Average daily high in the hottest month (WorldClim 1970-2000 normals)",
            }
          : null,
        c.coldestMonthLowC != null
          ? {
              label: "Winter low",
              value: formatTemperature(c.coldestMonthLowC, prefs),
              precision: "pinned",
              colorClass: tierColorClass(
                normalise(Math.abs(c.coldestMonthLowC - 8), COLOR_RANGES.winterLowDistanceFromIdeal.min, COLOR_RANGES.winterLowDistanceFromIdeal.max, true)
              ),
              hint: "Average daily low in the coldest month (WorldClim 1970-2000 normals)",
            }
          : null,
        {
          label: "Avg annual rainfall",
          value: `${c.avgAnnualRainfallMm} mm`,
          precision: "pinned",
          colorClass: tierColorClass(
            normalise(Math.abs(c.avgAnnualRainfallMm - 1000), RANGES.rainfallDistanceFromIdeal.min, RANGES.rainfallDistanceFromIdeal.max, true)
          ),
        },
        {
          label: "Avg annual sunshine",
          value: `${c.avgAnnualSunshineHrs} hrs`,
          precision: "pinned",
          colorClass: tierColorClass(normalise(c.avgAnnualSunshineHrs, RANGES.sunshineHrs.min, RANGES.sunshineHrs.max)),
          hint: "Estimated from WorldClim solar radiation (1970-2000 normals), not a measured count",
        },
        {
          label: "Avg annual snowfall",
          value: `${c.avgAnnualSnowfallCm} cm`,
          precision: "pinned",
          colorClass: tierColorClass(normalise(c.avgAnnualSnowfallCm, RANGES.snowfallCm.min, RANGES.snowfallCm.max, true)),
          hint: "Estimated from precipitation in below-freezing months (WorldClim 1970-2000 normals)",
        },
        {
          label: "Avg annual humidity",
          value: `${c.avgAnnualHumidityPct}%`,
          precision: "pinned",
          colorClass: tierColorClass(
            normalise(Math.abs(c.avgAnnualHumidityPct - 50), COLOR_RANGES.humidityDistanceFromIdeal.min, COLOR_RANGES.humidityDistanceFromIdeal.max, true)
          ),
        },
        c.avgAnnualPm25 != null
          ? {
              label: "Air pollution (PM2.5)",
              value: `${c.avgAnnualPm25} µg/m³`,
              precision: "pinned",
              colorClass: tierColorClass(normalise(c.avgAnnualPm25, RANGES.pm25.min, RANGES.pm25.max, true)),
              hint: c.avgAnnualPm25IsNational
                ? `National estimate for ${data.country} (WHO, 2023) - this place is outside the satellite map. WHO guideline: under 5 µg/m³`
                : "Annual mean fine particulate matter, 2024 (satellite-derived, ACAG) — WHO guideline: under 5 µg/m³",
            }
          : null,
        c.avgAnnualUvIndexMax != null
          ? {
              label: "Avg UV index",
              value: `${c.avgAnnualUvIndexMax}`,
              precision: "pinned",
              colorClass: tierColorClass(
                normalise(Math.abs(c.avgAnnualUvIndexMax - 3), COLOR_RANGES.uvIndexDistanceFromIdeal.min, COLOR_RANGES.uvIndexDistanceFromIdeal.max, true)
              ),
              hint: "Average midday UV index across the year, including cloud cover (NASA POWER 2001-2020)",
            }
          : null,
        c.earthquakeCount50yr != null
          ? {
              label: "Seismic activity",
              value: `${c.earthquakeCount50yr} quakes`,
              precision: "pinned",
              colorClass: tierColorClass(normalise(c.earthquakeCount50yr, COLOR_RANGES.earthquakeCount50yr.min, COLOR_RANGES.earthquakeCount50yr.max, true)),
              hint: "USGS: magnitude-5+ earthquakes within 200km since 1970 — a real historical count, not a modelled risk score",
            }
          : null,
        c.distanceToVolcanoKm != null
          ? {
              label: "Distance to volcano",
              value: formatDistanceKm(c.distanceToVolcanoKm, prefs),
              precision: "pinned",
              colorClass: tierColorClass(normalise(c.distanceToVolcanoKm, COLOR_RANGES.distanceToVolcanoKm.min, COLOR_RANGES.distanceToVolcanoKm.max)),
            }
          : null,
        c.coastalFloodExposure
          ? {
              label: "Coastal flood exposure",
              value: c.coastalFloodExposure,
              precision: "pinned",
              colorClass: exposureColorClass(c.coastalFloodExposure),
              hint: "A simple proxy (elevation + coastline distance), not a flood model",
            }
          : null,
        c.seaLevelRiseExposure
          ? {
              label: "Sea level rise exposure",
              value: c.seaLevelRiseExposure,
              precision: "pinned",
              colorClass: exposureColorClass(c.seaLevelRiseExposure),
              hint: "A simple proxy (elevation + coastline distance against IPCC's ~1m high-end 2100 projection), not an inundation model",
            }
          : null,
        {
          label: "Longest day",
          value: `${c.longestDayHours} hrs`,
          precision: "pinned",
          colorClass: "text-ink-500",
          hint: "Sunrise-to-sunset hours on the summer solstice",
        },
        {
          label: "Shortest day",
          value: `${c.shortestDayHours} hrs`,
          precision: "pinned",
          colorClass: "text-ink-500",
          hint: "Sunrise-to-sunset hours on the winter solstice",
        },
        c.koppenCode
          ? {
              label: "Climate type",
              value: KOPPEN_LABELS[c.koppenCode] ?? c.koppenCode,
              precision: "pinned",
              colorClass: "text-ink-500",
              hint: `Köppen-Geiger classification: ${c.koppenCode}, 1991-2020 (Beck et al. 2023)`,
            }
          : null,
        c.koppenCode2085
          ? {
              label: "Climate by 2085",
              value: c.koppenCode2085 === c.koppenCode ? "Unchanged" : KOPPEN_LABELS[c.koppenCode2085] ?? c.koppenCode2085,
              precision: "pinned",
              colorClass: "text-ink-500",
              hint: `Projected Köppen-Geiger type for 2071-2099 (${c.koppenCode2085}) under a middle-of-the-road emissions scenario, SSP2-4.5 (Beck et al. 2023)`,
            }
          : null,
        c.elevationM != null
          ? { label: "Elevation", value: `${c.elevationM.toLocaleString()} m`, precision: "pinned", colorClass: "text-ink-500" }
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
      // Places within 5 km of the centre (Overture Maps) - a fixed area, so
      // comparable between cities of any size; coloured on the score's log scale.
      const countRow = (label: string, count: number | null, cap: number, hint: string): KpiRow | null =>
        count == null ? null : { label, value: count.toLocaleString(), precision: "pinned", colorClass: tierColorClass(countScore(count, cap)), hint };
      const speedRow = (label: string, mbps: number | null, radiusKm: number | null, range: { min: number; max: number }, kind: string): KpiRow | null =>
        mbps == null
          ? null
          : {
              label,
              value: `${mbps.toLocaleString()} Mbps`,
              precision: "pinned",
              colorClass: tierColorClass(normalise(mbps, range.min, range.max)),
              hint:
                `Average ${kind} download speed of Speedtest results within ${radiusKm ?? 5} km of the centre (Ookla open data)` +
                ((radiusKm ?? 5) > 5 ? " - widened because few tests were taken closer in" : ""),
              valueSuffix: (radiusKm ?? 5) > 5 ? `(${radiusKm} km)` : undefined,
            };
      const pisaRow = (label: string, score: number | null, subject: string): KpiRow | null =>
        score == null
          ? null
          : {
              label,
              value: `${Math.round(score)}`,
              precision: "country",
              colorClass: tierColorClass(normalise(score, RANGES.pisaScore.min, RANGES.pisaScore.max)),
              hint: `OECD PISA mean ${subject} score for 15-year-olds — only countries that sit the test have a value`,
            };
      const rows: (KpiRow | null)[] = [
        countRow("Restaurants, bars & cafés", l.restaurantsBarsWithin5km, COUNT_CAPS.restaurantsBars, "Places to eat and drink within 5 km of the centre"),
        countRow("Parks", l.parksWithin5km, COUNT_CAPS.parks, "Parks within 5 km of the centre"),
        countRow("Cultural venues", l.culturalVenuesWithin5km, COUNT_CAPS.cultural, "Museums, galleries, theatres and cinemas within 5 km of the centre"),
        countRow("Family activities", l.familyActivitiesWithin5km, COUNT_CAPS.family, "Playgrounds, zoos, aquariums and amusement/water parks within 5 km of the centre"),
        speedRow("Broadband speed", l.broadbandDownloadMbps, l.broadbandRadiusKm, COLOR_RANGES.broadbandMbps, "fixed-broadband"),
        speedRow("Mobile speed", l.mobileDownloadMbps, l.mobileRadiusKm, COLOR_RANGES.mobileMbps, "mobile"),
        {
          label: "Healthcare quality score",
          value: `${l.healthcareQualityScore}`,
          precision: "country",
          colorClass: tierColorClass(l.healthcareQualityScore),
          hint: "WHO universal health coverage service index, 0-100",
        },
        l.lifeExpectancyYears != null
          ? {
              label: "Life expectancy",
              value: `${l.lifeExpectancyYears.toFixed(1)} yrs`,
              precision: "country",
              colorClass: tierColorClass(normalise(l.lifeExpectancyYears, COLOR_RANGES.lifeExpectancyYears.min, COLOR_RANGES.lifeExpectancyYears.max)),
            }
          : null,
        l.internetUsersPct != null
          ? {
              label: "Internet access",
              value: `${l.internetUsersPct.toFixed(1)}%`,
              precision: "country",
              colorClass: tierColorClass(normalise(l.internetUsersPct, COLOR_RANGES.internetUsersPct.min, COLOR_RANGES.internetUsersPct.max)),
              hint: "Share of the population using the Internet (World Bank)",
            }
          : null,
        pisaRow("PISA maths score", l.pisaMathScore, "mathematics"),
        pisaRow("PISA reading score", l.pisaReadingScore, "reading"),
        pisaRow("PISA science score", l.pisaScienceScore, "science"),
        // Distances - grey: closer isn't universally better.
        distanceRow("Distance to beach", l.distanceToBeachKm, prefs, "Straight-line distance to the nearest sea coast, or mapped beach on the sea or a large lake"),
        distanceRow("Distance to mountain", l.distanceToMountainKm, prefs, "Straight-line distance to the nearest peak of 1,000 m+ that rises 500 m+ above the city"),
        distanceRow("Distance to forest", l.distanceToForestKm, prefs, "Straight-line distance to the nearest mapped forest or woodland"),
        distanceRow("Nearest airport", l.distanceToAirportKm, prefs, "Straight-line distance to the nearest airport"),
        distanceRow("Nearest train station", l.distanceToTrainStationKm, prefs, "Straight-line distance to the nearest railway station"),
        l.nearestLargeCity
          ? {
              label: "Nearest large city",
              value: `${l.nearestLargeCity.name}, ${formatDistanceKm(l.nearestLargeCity.km, prefs)}`,
              precision: "pinned",
              colorClass: "text-ink-500",
              hint: "Nearest city of 500,000+ people, straight-line",
            }
          : null,
        distanceRow("Distance to capital city", l.distanceToCapitalKm, prefs, "Straight-line distance to the national capital"),
      ];
      return rows.filter((r): r is KpiRow => r != null);
    }
  }
}

/** Splits rows into the city's own values and its country's. */
export function splitKpiRowsByTier(rows: KpiRow[]): { countryRows: KpiRow[]; cityRows: KpiRow[] } {
  return {
    countryRows: rows.filter((r) => r.precision === "country"),
    cityRows: rows.filter((r) => r.precision !== "country"),
  };
}

/** Transport and education presence within 5 km of the centre (40 km for
 *  airports), from Overture Maps / OpenStreetMap and GeoNames. */
export function buildLiveabilityTransportRows(data: CityExploreData): KpiRow[] {
  const l = data.liveability;
  const flag = (label: string, value: boolean | null, hint: string): KpiRow | null =>
    value == null ? null : { label, value: value ? "Yes" : "No", precision: "pinned", colorClass: yesNoColorClass(value), hint };
  const rows: (KpiRow | null)[] = [
    flag("Train station", l.hasTrainStation, "A railway station within 5 km of the centre"),
    flag("Metro", l.hasSubway, "A metro/subway line or station within 5 km of the centre"),
    flag("Tram / light rail", l.hasTramway, "Tram or light rail track within 5 km of the centre"),
    flag("Airport", l.hasAirport, "An airport within 40 km of the centre"),
    flag("Bus station", l.hasBusStation, "A bus station within 5 km of the centre"),
    flag("School", l.hasSchool, "A school within 5 km of the centre"),
    flag("University", l.hasUniversity, "A university within 5 km of the centre"),
  ];
  return rows.filter((r): r is KpiRow => r != null);
}

/** Agriculture/Industry/Services ranked by share of GDP, rendered as one
 *  fixed row of 3 - only sectors World Bank has a value for. */
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
