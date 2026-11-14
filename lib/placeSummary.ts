import { driveMinutes, formatDriveTime } from "@/lib/dataset/assemble";
import { formatDistanceKm, formatTemperature, type UnitPreferences } from "@/lib/unitPreferences";
import type { CityExploreData } from "@/lib/types";

/**
 * A place in a few plain words, before any figure (2026-11-14, owner: the
 * site should answer at a glance - BACKLOG P1): up to three strengths, up to
 * two things to watch, and who it suits best. Every chip comes from a figure
 * the page shows (its `why` says which, on hover) - a missing figure never
 * makes one, so nothing here is an estimate.
 */

export interface SummaryChip {
  text: string;
  /** The figure behind it, in a sentence. */
  why: string;
}

export interface PlaceSummary {
  strengths: SummaryChip[];
  watchOuts: SummaryChip[];
  bestFor: SummaryChip[];
}

const MAX_STRENGTHS = 3;
const MAX_WATCH_OUTS = 2;
const MAX_BEST_FOR = 3;

/** One rule: a chip, or null when it doesn't apply (or a figure is missing). */
type Rule = (d: CityExploreData, u: Units) => SummaryChip | null;

interface Units {
  temp: (c: number) => string;
  km: (km: number) => string;
  drive: (km: number) => string;
}

const n = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const scored = (d: CityExploreData, key: keyof CityExploreData["sectionScores"]) =>
  d.sectionsWithoutData.includes(key) ? null : d.sectionScores[key];
const inTown = (d: CityExploreData, kind: "train" | "metro" | "school" | "nursery" | "university" | "hospital") => {
  const count = d.liveability.inside?.[kind]?.count;
  return n(count) ? count > 0 : null;
};

// Strengths, most telling first: the first three that apply are shown.
const STRENGTHS: Rule[] = [
  (d, u) => {
    const lo = d.climate.coldestMonthLowC;
    const hi = d.climate.hottestMonthHighC;
    return n(lo) && n(hi) && lo >= 12 && hi <= 27
      ? { text: "Spring all year", why: `Winter nights ${u.temp(lo)}, summer days ${u.temp(hi)} on average` }
      : null;
  },
  (d) => {
    const s = scored(d, "safetyStability");
    return n(s) && s >= 80 ? { text: "Very safe", why: `Safety scores ${Math.round(s)} out of 100` } : null;
  },
  (d, u) => {
    const km = d.liveability.distanceToBeachKm;
    return n(km) && km <= 10 ? { text: `Beach ${u.drive(km)}`, why: `The nearest beach is ${u.km(km)} away` } : null;
  },
  (d, u) => {
    const lo = d.climate.coldestMonthLowC;
    if (!n(lo) || lo < 5) return null;
    return { text: lo >= 10 ? "Warm winters" : "Mild winters", why: `Winter nights average ${u.temp(lo)} in the coldest month` };
  },
  (d) => {
    const h = d.climate.avgAnnualSunshineHrs;
    if (!n(h) || h < 2500) return null;
    return { text: h >= 2900 ? "Very sunny" : "Sunny", why: `About ${Math.round(h).toLocaleString("en-GB")} hours of sun a year` };
  },
  (d, u) => {
    const km = d.liveability.distanceToLakeBeachKm;
    return n(km) && km <= 10 ? { text: `Lake beach ${u.drive(km)}`, why: `The nearest lake beach is ${u.km(km)} away` } : null;
  },
  (d, u) => {
    const km = d.liveability.distanceToMountainKm;
    return n(km) && km <= 30 ? { text: `Mountains ${u.drive(km)}`, why: `The nearest 1,000 m+ peak is ${u.km(km)} away` } : null;
  },
  (d) => {
    const pm = d.climate.avgAnnualPm25;
    return n(pm) && pm <= 8 && !d.climate.avgAnnualPm25IsNational
      ? { text: "Clean air", why: `Fine particles (PM2.5) average ${pm} µg/m³ - the WHO guideline is 5` }
      : null;
  },
  (d) => (inTown(d, "metro") ? { text: "Metro", why: "Metro stations in the town" } : null),
  (d) => (inTown(d, "train") ? { text: "Train station", why: "A train station in the town" } : null),
  (d, u) => {
    const km = d.liveability.distanceToIntlAirportKm;
    return n(km) && km <= 40 ? { text: `Airport ${u.drive(km)}`, why: `The nearest international airport is ${u.km(km)} away` } : null;
  },
  (d) => {
    const mbps = d.liveability.broadbandDownloadMbps;
    return n(mbps) && mbps >= 150 ? { text: "Fast internet", why: `Home broadband averages ${Math.round(mbps)} Mbps` } : null;
  },
  // No "Growing" / "Shrinking": the town's growth figure is GHS-POP's 2025
  // projection, not a count (owner, 2026-11-14) - see the momentum test.
];

// Things to watch, most serious first: the first two that apply are shown.
const WATCH_OUTS: Rule[] = [
  (d) => {
    const events = d.safetyStability.conflictEvents5yr;
    return n(events) && events >= 5 ? { text: "Armed conflict nearby", why: `${events} deadly events within 50 km in 5 years` } : null;
  },
  (d) => {
    const s = scored(d, "safetyStability");
    return n(s) && s < 45 ? { text: "Safety concerns", why: `Safety scores ${Math.round(s)} out of 100` } : null;
  },
  (d, u) => {
    const hi = d.climate.hottestMonthHighC;
    if (!n(hi) || hi < 32) return null;
    return { text: hi >= 36 ? "Very hot summers" : "Hot summers", why: `Summer days average ${u.temp(hi)} in the hottest month` };
  },
  (d, u) => {
    const lo = d.climate.coldestMonthLowC;
    if (!n(lo) || lo > -5) return null;
    return { text: lo <= -15 ? "Very cold winters" : "Cold winters", why: `Winter nights average ${u.temp(lo)} in the coldest month` };
  },
  (d) => {
    const pm = d.climate.avgAnnualPm25;
    return n(pm) && pm >= 25 ? { text: "Polluted air", why: `Fine particles (PM2.5) average ${pm} µg/m³ - the WHO guideline is 5` } : null;
  },
  (d) => {
    const q = d.climate.earthquakeCount50yr;
    // More than one a year: 23 (Innsbruck - mostly northern Italy's) read
    // as "earthquake zone" too strongly.
    return n(q) && q >= 60 ? { text: "Earthquake zone", why: `${q} magnitude 5+ earthquakes within 200 km since 1970` } : null;
  },
  (d) => {
    const w = d.climate.waterStressPct;
    return n(w) && w >= 80 ? { text: "Water scarce", why: `${Math.round(w)}% of the river basin's renewed water is used` } : null;
  },
  (d) => {
    const h = d.climate.avgAnnualSunshineHrs;
    return n(h) && h < 1500 ? { text: "Little sun", why: `About ${Math.round(h).toLocaleString("en-GB")} hours of sun a year` } : null;
  },
  (d) => {
    const mm = d.climate.avgAnnualRainfallMm;
    return n(mm) && mm >= 1500 ? { text: "Very rainy", why: `About ${Math.round(mm).toLocaleString("en-GB")} mm of rain a year` } : null;
  },
  (d) => {
    const cm = d.climate.avgAnnualSnowfallCm;
    return n(cm) && cm >= 100 ? { text: "Snowy winters", why: `About ${Math.round(cm)} cm of snow a year` } : null;
  },
  (d, u) => {
    const km = d.liveability.distanceToHospitalKm;
    return n(km) && km > 30 ? { text: "Hospital far", why: `The nearest hospital is ${u.km(km)} away` } : null;
  },
  (d, u) => {
    const km = d.liveability.distanceToTrainStationKm;
    return n(km) && km > 25 ? { text: "No train nearby", why: `The nearest train station is ${u.km(km)} away` } : null;
  },
  (d) => {
    const mbps = d.liveability.broadbandDownloadMbps;
    return n(mbps) && mbps < 20 ? { text: "Slow internet", why: `Home broadband averages ${Math.round(mbps)} Mbps` } : null;
  },
];

/** Nothing is "best for" anyone with armed conflict nearby or polluted air
 *  (first tries said New Delhi and Dubai were best for families, Kyiv for
 *  remote workers). A missing figure doesn't rule a place out. */
const liveable = (d: CityExploreData) => {
  const events = d.safetyStability.conflictEvents5yr;
  const pm = d.climate.avgAnnualPm25;
  return !(n(events) && events >= 5) && !(n(pm) && pm >= 25);
};

// Who it suits: every rule needs all its figures.
const BEST_FOR_RULES: Rule[] = [
  (d) => {
    const s = scored(d, "safetyStability");
    return inTown(d, "school") && inTown(d, "nursery") && n(s) && s >= 65
      ? { text: "Families", why: "Schools and nurseries in the town, and a safety score of 65+" }
      : null;
  },
  (d, u) => {
    const km = d.liveability.distanceToHospitalKm;
    const lo = d.climate.coldestMonthLowC;
    const hi = d.climate.hottestMonthHighC;
    const s = scored(d, "safetyStability");
    return n(km) && km <= 15 && n(lo) && lo >= 0 && n(hi) && hi < 35 && n(s) && s >= 65
      ? { text: "Retirees", why: `A hospital ${u.km(km)} away, winter nights above freezing, summers under ${u.temp(35)}, a safety score of 65+` }
      : null;
  },
  (d, u) => {
    const mbps = d.liveability.broadbandDownloadMbps;
    const km = d.liveability.distanceToIntlAirportKm;
    return n(mbps) && mbps >= 100 && n(km) && km <= 60
      ? { text: "Remote workers", why: `Broadband around ${Math.round(mbps)} Mbps and an international airport ${u.km(km)} away` }
      : null;
  },
  (d) => (inTown(d, "university") ? { text: "Students", why: "A university in the town" } : null),
  (d) => {
    const h = d.climate.avgAnnualSunshineHrs;
    const beach = d.liveability.distanceToBeachKm;
    return n(h) && h >= 2500 && n(beach) && beach <= 20
      ? { text: "Sun and sea", why: `${Math.round(h).toLocaleString("en-GB")} hours of sun a year and a beach within 20 km` }
      : null;
  },
  (d) => {
    const mountain = d.liveability.distanceToMountainKm;
    const forest = d.liveability.distanceToForestKm;
    return n(mountain) && mountain <= 30 && n(forest) && forest <= 5
      ? { text: "The outdoors", why: "Mountains within 30 km and a forest within 5 km" }
      : null;
  },
];
const BEST_FOR: Rule[] = BEST_FOR_RULES.map((rule) => (d, u) => (liveable(d) ? rule(d, u) : null));

function firstMatches(rules: Rule[], d: CityExploreData, u: Units, max: number): SummaryChip[] {
  const out: SummaryChip[] = [];
  for (const rule of rules) {
    if (out.length >= max) break;
    const chip = rule(d, u);
    if (chip) out.push(chip);
  }
  return out;
}

export function placeSummary(d: CityExploreData, prefs: UnitPreferences): PlaceSummary {
  const u: Units = {
    temp: (c) => formatTemperature(c, prefs),
    km: (km) => formatDistanceKm(km, prefs),
    drive: (km) => formatDriveTime(driveMinutes(km) ?? 1),
  };
  return {
    strengths: firstMatches(STRENGTHS, d, u, MAX_STRENGTHS),
    watchOuts: firstMatches(WATCH_OUTS, d, u, MAX_WATCH_OUTS),
    bestFor: firstMatches(BEST_FOR, d, u, MAX_BEST_FOR),
  };
}
