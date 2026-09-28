import { AMENITY_RATIOS, driveMinutes, formatDriveTime, RANGES, residentsWithin5km } from "@/lib/dataset/assemble";
import { legendOf, TIER_CLASS, tierOf, type LegendLine, type NumericScale, type Tier } from "@/lib/colorScales";
import { formatCurrency, formatDistanceKm, formatTemperature, type UnitPreferences } from "@/lib/unitPreferences";
import { KOPPEN_LABELS } from "@/lib/data-sources/koppen";
import { SECTION_LABELS, type CityExploreData, type SectionKey } from "@/lib/types";

/** Which tier a value describes: "country" (national statistics) or
 *  "pinned" (computed from this city's own coordinates). "city" is kept for
 *  a future per-city statistic from a city-level source. */
export type PrecisionTier = "country" | "city" | "pinned";

/** What the info popover explains about a row. `legend` is null for plain
 *  descriptive facts (shown in grey, no better or worse). */
export interface KpiInfo {
  definition: string;
  source: string;
  legend: LegendLine[] | null;
}

export interface KpiRow {
  label: string;
  value: string;
  precision: PrecisionTier;
  /** Green / amber / red for metrics with a better and worse direction;
   *  grey (text-ink-500) for descriptive facts. */
  colorClass?: string;
  /** Smaller secondary text after the value, e.g. "(73.1%)". */
  valueSuffix?: string;
  /** The source has no figure for this place: shown as "No data". */
  noData?: boolean;
  info: KpiInfo;
}

type Described = { definition: string; source: string };

const NEUTRAL = "text-ink-500";

/** A coloured row: the scale decides both the colour and the colour guide. */
function scored(
  label: string,
  raw: number,
  value: string,
  precision: PrecisionTier,
  scale: NumericScale,
  fmt: (n: number) => string,
  about: Described,
  valueSuffix?: string
): KpiRow {
  return { label, value, precision, valueSuffix, colorClass: TIER_CLASS[tierOf(scale, raw)], info: { ...about, legend: legendOf(scale, fmt) } };
}

/** A coloured row whose colours are categories (Yes/No, Low/High...). */
function categorical(label: string, value: string, precision: PrecisionTier, tier: Tier, legend: LegendLine[], about: Described): KpiRow {
  return { label, value, precision, colorClass: TIER_CLASS[tier], info: { ...about, legend } };
}

/** A grey, descriptive row. */
function neutral(label: string, value: string, precision: PrecisionTier, about: Described, valueSuffix?: string): KpiRow {
  return { label, value, precision, valueSuffix, colorClass: NEUTRAL, info: { ...about, legend: null } };
}

/** A figure the source has no value for here - "No data" in grey (and
 *  left out of the section score), never a stand-in number. */
function missing(label: string, precision: PrecisionTier, about: Described): KpiRow {
  return { label, value: "No data", precision, colorClass: NEUTRAL, noData: true, info: { ...about, legend: null } };
}

/** scored(), or a "No data" row when `raw` is missing. */
function scoredOrMissing(
  label: string,
  raw: number | null,
  value: (n: number) => string,
  precision: PrecisionTier,
  scale: NumericScale,
  fmt: (n: number) => string,
  about: Described,
  valueSuffix?: string
): KpiRow {
  return raw == null ? missing(label, precision, about) : scored(label, raw, value(raw), precision, scale, fmt, about, valueSuffix);
}

// ---- Formatting helpers -----------------------------------------------------

const num = (n: number, digits = 0) => (Math.round(n * 10 ** digits) / 10 ** digits).toLocaleString(undefined, { maximumFractionDigits: digits });
const withUnit = (unit: string, digits = 0) => (n: number) => `${num(n, digits)}${unit}`;
const signedPct = (n: number) => `${n > 0 ? "+" : ""}${num(n, 1)}%`;
/** "2.1 million" / "6,800" - a population estimate, not a census count. */
const roughPeople = (n: number) => (n >= 1e6 ? `${num(n / 1e6, 1)} million` : num(Math.round(n / 100) * 100));

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
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

// ---- Colour scales -------------------------------------------------------------
// Where a field feeds a section score, its scale matches lib/dataset/assemble.ts's
// RANGES - except PM2.5 and the homicide rate, coloured by fixed bands that
// match how they're usually judged. The others are disclosed judgement calls
// for comparing places (a comfortable ~20 °C year, ~50% humidity, UV ~3...).

const SCALES = {
  gdp: { kind: "log", minLog: 9, maxLog: 13.5 }, // $1bn to ~$30tn
  gdpRank: { kind: "rank", of: 214 },
  gdpGrowth: { kind: "higher", ...RANGES.gdpGrowth },
  // averageSalaryGbp is GNI per capita x 0.79 - the scoring range, converted.
  salaryGbp: { kind: "higher", min: 1580, max: 71100 },
  unemployment: { kind: "lower", ...RANGES.unemployment },
  // Under 2 per 100k is Western Europe / East Asia; above 10 is among the
  // world's most violent (the global average is ~6).
  homicide: { kind: "bands", goodMax: 2, moderateMax: 10 },
  temperature: { kind: "ideal", ideal: 20, range: RANGES.temperatureDistanceFrom20C.max },
  summerHigh: { kind: "ideal", ideal: 25, range: 15 },
  winterLow: { kind: "ideal", ideal: 8, range: 20 },
  rainfall: { kind: "ideal", ideal: 1000, range: RANGES.rainfallDistanceFromIdeal.max, floor: 0 },
  sunshine: { kind: "higher", ...RANGES.sunshineHrs },
  snowfall: { kind: "lower", ...RANGES.snowfallCm },
  humidity: { kind: "ideal", ideal: 50, range: 50, floor: 0 },
  // After the WHO's interim targets: 10 (target 4) and 25 (target 2) µg/m³.
  pm25: { kind: "bands", goodMax: 10, moderateMax: 25 },
  uv: { kind: "ideal", ideal: 3, range: 8, floor: 0 },
  // Half of all places have had 2 or fewer; above 30 is about the most
  // active fifth (Tokyo 841, Santiago 563, Athens 106, Los Angeles 80;
  // San Francisco's 27 is amber).
  earthquakes: { kind: "bands", goodMax: 5, moderateMax: 30, integer: true },
  volcanoKm: { kind: "higher", min: 0, max: 50 },
  lifeExpectancy: { kind: "higher", min: 50, max: 85 },
  internetUsers: { kind: "higher", min: 0, max: 100 },
  broadband: { kind: "higher", min: 10, max: 300 },
  mobile: { kind: "higher", min: 5, max: 150 },
  pisa: { kind: "higher", ...RANGES.pisaScore },
  score: { kind: "score" },
} satisfies Record<string, NumericScale>;

/** Beyond this straight-line distance a drive-time estimate isn't shown
 *  (~6 hours; often across water, or better flown). */
const MAX_DRIVE_KM = 500;

const WB = (code: string) => `World Bank, World Development Indicators (${code}), latest year available`;
const WGI = "World Bank, Worldwide Governance Indicators";
const WORLDCLIM = "WorldClim 2.1 climate normals, 1970-2000 averages";
const OVERTURE = "Overture Maps places (OpenStreetMap and other open sources)";

/** Each section's KPI list - shared by the results page's detail panel,
 *  the Compare page and the printable report, so they never drift apart. */
export function buildKpiRows(section: SectionKey, data: CityExploreData, prefs: UnitPreferences): KpiRow[] {
  const temp = (c: number) => formatTemperature(c, prefs);
  const distance = (km: number) => formatDistanceKm(km, prefs);
  switch (section) {
    case "economy": {
      const e = data.economy;
      const costOfLivingAbout = {
        definition:
          "How expensive everyday goods and services are, rescaled 0-100 (higher is more expensive). Shown in grey because cheaper isn't simply better: low prices usually come with low incomes - purchasing power shows what money actually buys.",
        source: WB("PA.NUS.PRVT.PLI, price level index"),
      };
      // Two per line on the results page: GDP | rank, growth | tax, salary |
      // unemployment, cost of living | purchasing power, the three GDP
      // sectors, currency.
      const rows: (KpiRow | null)[] = [
        e.gdpUsd != null
          ? scored("GDP", e.gdpUsd, formatGdpUsd(e.gdpUsd), "country", SCALES.gdp, formatGdpUsd, {
              definition: "The total value of everything the country produces in a year, in US dollars. Larger economies tend to offer more jobs and services.",
              source: WB("NY.GDP.MKTP.CD"),
            })
          : null,
        e.gdpWorldRank != null
          ? scored("GDP world rank", e.gdpWorldRank, ordinal(e.gdpWorldRank), "country", SCALES.gdpRank, (n) => ordinal(Math.round(n)), {
              definition: "The country's position by GDP among 214 economies (1st is the largest).",
              source: WB("NY.GDP.MKTP.CD"),
            })
          : null,
        scoredOrMissing("Economic growth (5yr GDP)", e.economicGrowth5yrGdpPct, signedPct, "country", SCALES.gdpGrowth, signedPct, {
          definition: "How much the economy has grown over roughly the last five years, after inflation.",
          source: WB("NY.GDP.MKTP.KD, constant 2015 US$"),
        }),
        e.taxRevenuePctGdp != null
          ? neutral("Tax revenue", `${e.taxRevenuePctGdp.toFixed(1)}% of GDP`, "country", {
              definition: "Taxes collected by central government as a share of GDP. A policy choice rather than good or bad.",
              source: WB("GC.TAX.TOTL.GD.ZS"),
            })
          : null,
        scoredOrMissing("Average salary", e.averageSalaryGbp, (n) => formatCurrency(n, prefs), "country", SCALES.salaryGbp, (n) => formatCurrency(n, prefs), {
          definition: "Gross national income per person per year, in your currency - a guide to average income rather than a measured wage.",
          source: WB("NY.GNP.PCAP.CD"),
        }, "/ year"),
        scoredOrMissing("Unemployment rate", e.unemploymentRatePct, (n) => `${n.toFixed(1)}%`, "country", SCALES.unemployment, withUnit("%", 1), {
          definition: "Share of people who want to work but have no job (International Labour Organization estimate).",
          source: WB("SL.UEM.TOTL.ZS"),
        }),
        e.costOfLivingIndex != null
          ? neutral("Cost of living index", `${e.costOfLivingIndex}`, "country", costOfLivingAbout)
          : missing("Cost of living index", "country", costOfLivingAbout),
        scoredOrMissing("Purchasing power index", e.purchasingPowerIndex, String, "country", SCALES.score, String, {
          definition: "What an average income buys locally - income per person adjusted for local prices, rescaled 0-100.",
          source: WB("NY.GDP.PCAP.PP.CD"),
        }),
        ...gdpSectorRows(data),
        e.currency
          ? neutral("Currency", `${e.currency.name} (${e.currency.code})`, "country", {
              definition: "The country's official currency.",
              source: "GeoNames country information",
            })
          : null,
      ];
      return rows.filter((r): r is KpiRow => r != null);
    }
    case "safetyStability": {
      const s = data.safetyStability;
      const trendAbout = { definition: "The direction of the political stability score over roughly the last five years.", source: WGI };
      return [
        scoredOrMissing("Political stability score", s.politicalStabilityScore, String, "country", SCALES.score, String, {
          definition: "How unlikely political instability or politically motivated violence is, as a 0-100 rank among countries (higher is more stable).",
          source: WGI,
        }),
        scoredOrMissing("Rule of law score", s.ruleOfLawScore, String, "country", SCALES.score, String, {
          definition: "Confidence in the rules of society - contracts, property rights, police and courts - as a 0-100 rank among countries.",
          source: WGI,
        }),
        scoredOrMissing("Homicide rate", s.homicideRatePer100k, (n) => `${n.toFixed(1)} / 100k`, "country", SCALES.homicide, withUnit(" per 100k", 1), {
          definition: "Intentional homicides per 100,000 people per year - the most comparable crime statistic between countries.",
          source: "UNODC, via " + WB("VC.IHR.PSRC.P5"),
        }),
        s.safetyTrend
          ? categorical(
              "Safety trend",
              s.safetyTrend,
              "country",
              s.safetyTrend === "Improving" ? "good" : s.safetyTrend === "Worsening" ? "poor" : "moderate",
              [
                { tier: "good", text: "Improving - political stability up 5% or more" },
                { tier: "moderate", text: "Stable - within 5% either way" },
                { tier: "poor", text: "Worsening - down 5% or more" },
              ],
              trendAbout
            )
          : missing("Safety trend", "country", trendAbout),
      ];
    }
    case "climate": {
      const c = data.climate;
      const rows: (KpiRow | null)[] = [
        scoredOrMissing("Avg annual temperature", c.avgAnnualTemperatureC, temp, "pinned", SCALES.temperature, temp, {
          definition: "The average of day and night temperatures across the whole year.",
          source: WORLDCLIM,
        }),
        c.hottestMonthHighC != null
          ? scored("Summer high", c.hottestMonthHighC, temp(c.hottestMonthHighC), "pinned", SCALES.summerHigh, temp, {
              definition: "The average daytime high in the hottest month.",
              source: WORLDCLIM,
            })
          : null,
        c.coldestMonthLowC != null
          ? scored("Winter low", c.coldestMonthLowC, temp(c.coldestMonthLowC), "pinned", SCALES.winterLow, temp, {
              definition: "The average night-time low in the coldest month.",
              source: WORLDCLIM,
            })
          : null,
        scoredOrMissing("Avg annual rainfall", c.avgAnnualRainfallMm, (n) => `${n} mm`, "pinned", SCALES.rainfall, withUnit(" mm"), {
          definition: "Total rain and snow (measured as water) in an average year.",
          source: WORLDCLIM,
        }),
        scoredOrMissing("Avg annual sunshine", c.avgAnnualSunshineHrs, (n) => `${n} hrs`, "pinned", SCALES.sunshine, withUnit(" hrs"), {
          definition: "Hours of direct sunshine in a year - an estimate derived from solar radiation, not a measured count.",
          source: `${WORLDCLIM}; FAO-56 sunshine estimate`,
        }),
        scoredOrMissing("Avg annual snowfall", c.avgAnnualSnowfallCm, (n) => `${n} cm`, "pinned", SCALES.snowfall, withUnit(" cm"), {
          definition: "Snow in a year - an estimate from the precipitation falling in months cold enough for snow.",
          source: WORLDCLIM,
        }),
        scoredOrMissing("Avg annual humidity", c.avgAnnualHumidityPct, (n) => `${n}%`, "pinned", SCALES.humidity, withUnit("%"), {
          definition: "Average relative humidity across the year. Around 50% is usually the most comfortable.",
          source: WORLDCLIM,
        }),
        c.avgAnnualPm25 != null
          ? scored("Air pollution (PM2.5)", c.avgAnnualPm25, `${c.avgAnnualPm25} µg/m³`, "pinned", SCALES.pm25, withUnit(" µg/m³"), {
              definition:
                "Average yearly level of fine particles in the air, the pollutant most linked to health effects. The WHO guideline is 5 µg/m³." +
                (c.avgAnnualPm25IsNational ? ` This place is outside the satellite map, so this is ${data.country}'s national estimate.` : ""),
              source: c.avgAnnualPm25IsNational
                ? "World Health Organization, data.who.int (national estimate, 2023)"
                : "Satellite-derived estimates, Atmospheric Composition Analysis Group, Washington University (2024)",
            })
          : null,
        c.avgAnnualUvIndexMax != null
          ? scored("Avg UV index", c.avgAnnualUvIndexMax, `${c.avgAnnualUvIndexMax}`, "pinned", SCALES.uv, (n) => num(n, 1), {
              definition: "The average midday UV index across the year, including cloud. Higher means more sunburn risk; very low means little sun.",
              source: "NASA POWER, 2001-2020 averages, converted to the midday value",
            })
          : null,
        c.earthquakeCount50yr != null
          ? scored("Seismic activity", c.earthquakeCount50yr, `${c.earthquakeCount50yr} quakes`, "pinned", SCALES.earthquakes, withUnit(" quakes"), {
              definition: "The number of magnitude 5+ earthquakes within 200 km since 1970 - a real count, not a risk model.",
              source: "US Geological Survey earthquake catalogue",
            })
          : null,
        c.distanceToVolcanoKm != null
          ? scored("Distance to volcano", c.distanceToVolcanoKm, distance(c.distanceToVolcanoKm), "pinned", SCALES.volcanoKm, distance, {
              definition: "Straight-line distance to the nearest volcano. Further is safer.",
              source: "GeoNames",
            })
          : null,
        c.coastalFloodExposure
          ? categorical(
              "Coastal flood exposure",
              c.coastalFloodExposure,
              "pinned",
              c.coastalFloodExposure === "Low" ? "good" : c.coastalFloodExposure === "Moderate" ? "moderate" : "poor",
              [
                { tier: "good", text: "Low - higher ground or further inland" },
                { tier: "moderate", text: "Moderate - 15 m or lower, within 10 km of the coast" },
                { tier: "poor", text: "High - 5 m or lower, within 2 km of the coast" },
              ],
              { definition: "A simple proxy from elevation and distance to the sea - not a flood model.", source: "Natural Earth coastline, GeoNames elevation" }
            )
          : null,
        c.seaLevelRiseExposure
          ? categorical(
              "Sea level rise exposure",
              c.seaLevelRiseExposure,
              "pinned",
              c.seaLevelRiseExposure === "Low" ? "good" : c.seaLevelRiseExposure === "Moderate" ? "moderate" : "poor",
              [
                { tier: "good", text: "Low - higher ground or further inland" },
                { tier: "moderate", text: "Moderate - 10 m or lower, within 25 km of the coast" },
                { tier: "poor", text: "High - 2 m or lower, within 10 km of the coast" },
              ],
              {
                definition: "A long-term proxy from elevation and distance to the sea, set against the IPCC's high-end projection of about 1 m by 2100 - not an inundation model.",
                source: "Natural Earth coastline, GeoNames elevation",
              }
            )
          : null,
        neutral("Longest day", `${c.longestDayHours} hrs`, "pinned", {
          definition: "Hours from sunrise to sunset on the longest day of the year.",
          source: "Calculated from latitude",
        }),
        neutral("Shortest day", `${c.shortestDayHours} hrs`, "pinned", {
          definition: "Hours from sunrise to sunset on the shortest day of the year.",
          source: "Calculated from latitude",
        }),
        c.koppenCode
          ? neutral("Climate type", KOPPEN_LABELS[c.koppenCode] ?? c.koppenCode, "pinned", {
              definition: `The Köppen-Geiger climate classification for 1991-2020 (${c.koppenCode}).`,
              source: "Beck et al. (2023), 1 km Köppen-Geiger maps",
            })
          : null,
        c.koppenCode2085
          ? neutral("Climate by 2085", c.koppenCode2085 === c.koppenCode ? "Unchanged" : KOPPEN_LABELS[c.koppenCode2085] ?? c.koppenCode2085, "pinned", {
              definition: `The projected climate type for 2071-2099 (${c.koppenCode2085}) under a middle-of-the-road emissions scenario (SSP2-4.5).`,
              source: "Beck et al. (2023), 1 km Köppen-Geiger maps",
            })
          : null,
        c.elevationM != null
          ? neutral("Elevation", `${c.elevationM.toLocaleString()} m`, "pinned", {
              definition: "Height above sea level at the city centre.",
              source: "GeoNames (SRTM elevation)",
            })
          : null,
        c.climateReadinessScore != null
          ? scored("Climate change readiness", c.climateReadinessScore, `${c.climateReadinessScore}`, "country", SCALES.score, String, {
              definition: "How well the country could cope with and adapt to climate change, 0-100 (higher is better prepared).",
              source: "Notre Dame Global Adaptation Initiative (ND-GAIN)",
            })
          : null,
      ];
      return rows.filter((r): r is KpiRow => r != null);
    }
    case "liveability": {
      const l = data.liveability;
      // Places within 5 km of the centre per resident of those 5 km -
      // coloured on the score's log scale; the raw count is in the popover.
      const residents = residentsWithin5km(data.demographics.cityDensityPerKm2);
      const ratioRow = (label: string, ratio: number | null, count: number | null, ratioOf: keyof typeof AMENITY_RATIOS, what: string): KpiRow | null => {
        if (count == null) return null;
        const { per, cap } = AMENITY_RATIOS[ratioOf];
        const perText = `per ${per.toLocaleString()} residents`;
        const about = {
          definition:
            `${what} within 5 km of the centre, ${perText} of those 5 km` +
            (residents != null ? ` - ${count.toLocaleString()} places for about ${roughPeople(residents)} people.` : "."),
          source: `${OVERTURE}; residents from GHS-POP 2025 (EC JRC)`,
        };
        return ratio == null
          ? missing(label, "pinned", about)
          : scored(label, ratio, num(ratio, 1), "pinned", { kind: "ratio", cap }, (n) => `${num(n, 1)} ${perText}`, about, perText);
      };
      const speedRow = (label: string, mbps: number | null, radiusKm: number | null, scale: NumericScale, kind: string): KpiRow | null => {
        if (mbps == null) return null;
        const radius = radiusKm ?? 5;
        return scored(
          label,
          mbps,
          `${mbps.toLocaleString()} Mbps`,
          "pinned",
          scale,
          withUnit(" Mbps"),
          {
            definition:
              `Average ${kind} download speed from Speedtest results within ${radius} km of the centre.` +
              (radius > 5 ? " Widened from 5 km because few tests were taken closer in." : ""),
            source: "Speedtest by Ookla, Global Fixed and Mobile Network Performance Maps (latest quarter)",
          },
          radius > 5 ? `(${radius} km)` : undefined
        );
      };
      const pisaRow = (label: string, score: number | null, subject: string): KpiRow | null =>
        score == null
          ? null
          : scored(label, score, `${Math.round(score)}`, "country", SCALES.pisa, (n) => num(n), {
              definition: `The average ${subject} score of 15-year-olds in the OECD's PISA test. Only countries that take part have a score.`,
              source: "OECD PISA, via " + WB(`LO.PISA.${subject === "mathematics" ? "MAT" : subject === "reading" ? "REA" : "SCI"}`),
            });
      // Distances, with an estimated drive time up to MAX_DRIVE_KM.
      const driveNote =
        " The drive time is an estimate from the straight-line distance, not a route: roads about 30% longer, ~30 km/h in town rising to ~100 km/h on longer trips.";
      const byCar = (km: number) => {
        const minutes = km >= 1 && km <= MAX_DRIVE_KM ? driveMinutes(km) : null;
        return minutes != null ? `· ~${formatDriveTime(minutes)} by car` : undefined;
      };
      const distanceRow = (label: string, km: number | null, definition: string, source: string): KpiRow | null =>
        km == null
          ? null
          : neutral(
              label,
              distance(km),
              "pinned",
              { definition: `${definition}${byCar(km) ? driveNote : ""} Whether closer is better depends on you, so it's shown in grey.`, source },
              byCar(km)
            );
      const rows: (KpiRow | null)[] = [
        ratioRow("Restaurants, bars & cafés", l.restaurantsBarsPer1k, l.restaurantsBarsWithin5km, "restaurantsBars", "Places to eat and drink"),
        ratioRow("Parks", l.parksPer10k, l.parksWithin5km, "parks", "Parks and public gardens"),
        ratioRow("Cultural venues", l.culturalVenuesPer10k, l.culturalVenuesWithin5km, "cultural", "Museums, galleries, theatres and cinemas"),
        ratioRow("Family activities", l.familyActivitiesPer10k, l.familyActivitiesWithin5km, "family", "Playgrounds, zoos, aquariums and amusement or water parks"),
        speedRow("Broadband speed", l.broadbandDownloadMbps, l.broadbandRadiusKm, SCALES.broadband, "home broadband"),
        speedRow("Mobile speed", l.mobileDownloadMbps, l.mobileRadiusKm, SCALES.mobile, "mobile"),
        ...presenceRows(data),
        scoredOrMissing("Healthcare quality score", l.healthcareQualityScore, String, "country", SCALES.score, String, {
          definition: "How well essential health services reach the population - mother and child care, infectious and chronic diseases, access - on a 0-100 index.",
          source: "World Health Organization, data.who.int (UHC service coverage index)",
        }),
        l.lifeExpectancyYears != null
          ? scored("Life expectancy", l.lifeExpectancyYears, `${l.lifeExpectancyYears.toFixed(1)} yrs`, "country", SCALES.lifeExpectancy, withUnit(" yrs", 1), {
              definition: "How many years a newborn can expect to live, on average.",
              source: WB("SP.DYN.LE00.IN"),
            })
          : null,
        l.internetUsersPct != null
          ? scored("Internet access", l.internetUsersPct, `${l.internetUsersPct.toFixed(1)}%`, "country", SCALES.internetUsers, withUnit("%"), {
              definition: "Share of the population using the internet.",
              source: WB("IT.NET.USER.ZS"),
            })
          : null,
        pisaRow("PISA maths score", l.pisaMathScore, "mathematics"),
        pisaRow("PISA reading score", l.pisaReadingScore, "reading"),
        pisaRow("PISA science score", l.pisaScienceScore, "science"),
        distanceRow("Distance to beach", l.distanceToBeachKm, "Straight-line distance to the nearest sea coast, or a beach on the sea or a large lake.", "Natural Earth coastline and lakes, GeoNames beaches"),
        distanceRow("Distance to mountain", l.distanceToMountainKm, "Straight-line distance to the nearest peak of 1,000 m or more that rises at least 500 m above the city.", "GeoNames"),
        distanceRow("Distance to forest", l.distanceToForestKm, "Straight-line distance to the nearest mapped forest or woodland.", "GeoNames"),
        distanceRow("Nearest airport", l.distanceToAirportKm, "Straight-line distance to the nearest airport.", "GeoNames"),
        distanceRow("Nearest train station", l.distanceToTrainStationKm, "Straight-line distance to the nearest railway station.", "GeoNames and Overture Maps"),
        l.nearestLargeCity
          ? neutral(
              "Nearest large city",
              `${l.nearestLargeCity.name}, ${distance(l.nearestLargeCity.km)}`,
              "pinned",
              {
                definition: `The nearest other city of 500,000+ people, straight-line.${byCar(l.nearestLargeCity.km) ? driveNote : ""}`,
                source: "GeoNames",
              },
              byCar(l.nearestLargeCity.km)
            )
          : null,
        distanceRow("Distance to capital city", l.distanceToCapitalKm, "Straight-line distance to the national capital.", "GeoNames"),
      ];
      return rows.filter((r): r is KpiRow => r != null);
    }
  }
}

/** The explanation shown in a section with no figures at all for this
 *  place (null when it has data) - shared by the results page and report. */
export function noSectionDataNote(section: SectionKey, data: CityExploreData): string | null {
  if (!data.sectionsWithoutData.includes(section)) return null;
  const where = section === "economy" || section === "safetyStability" ? data.country : data.cityName;
  return `No ${SECTION_LABELS[section].toLowerCase()} figures are available for ${where}. A neutral 50 is used in the overall Piltri score, so this section neither helps nor hurts it.`;
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
function presenceRows(data: CityExploreData): KpiRow[] {
  const l = data.liveability;
  const flag = (label: string, value: boolean | null, what: string, km: number, source: string): KpiRow | null =>
    value == null
      ? null
      : categorical(
          label,
          value ? "Yes" : "No",
          "pinned",
          value ? "good" : "poor",
          [
            { tier: "good", text: `Yes - within ${km} km of the centre` },
            { tier: "poor", text: `No - none within ${km} km` },
          ],
          { definition: `Whether there is ${what} within ${km} km of the city centre.`, source }
        );
  const rows: (KpiRow | null)[] = [
    flag("Train station", l.hasTrainStation, "a railway station", 5, "GeoNames and Overture Maps"),
    flag("Metro", l.hasSubway, "a metro or subway line or station", 5, "Overture Maps (OpenStreetMap rail lines) and GeoNames"),
    flag("Tram / light rail", l.hasTramway, "tram or light rail track", 5, "Overture Maps (OpenStreetMap rail lines)"),
    flag("Airport", l.hasAirport, "an airport", 40, "GeoNames"),
    flag("Bus station", l.hasBusStation, "a bus station", 5, "GeoNames and Overture Maps"),
    flag("Nursery / day care", l.hasNursery, "a nursery, day care or preschool", 5, OVERTURE),
    flag("School", l.hasSchool, "a school", 5, "GeoNames and Overture Maps"),
    flag("University", l.hasUniversity, "a university", 5, "GeoNames and Overture Maps"),
  ];
  return rows.filter((r): r is KpiRow => r != null);
}

const GDP_SECTOR_RANK_LABELS = ["1st GDP sector", "2nd GDP sector", "3rd GDP sector"] as const;

/** Agriculture/Industry/Services ranked by share of GDP - only sectors
 *  World Bank has a value for. */
function gdpSectorRows(data: CityExploreData): KpiRow[] {
  return data.economy.gdpSectorRanking.slice(0, 3).map((entry, i) =>
    neutral(
      GDP_SECTOR_RANK_LABELS[i],
      entry.sector,
      "country",
      {
        definition: "The largest parts of the economy by share of GDP: services, industry (including construction and energy) and agriculture.",
        source: WB("NV.SRV / NV.IND / NV.AGR.TOTL.ZS"),
      },
      `(${entry.sharePct.toFixed(1)}%)`
    )
  );
}
