import { NextRequest, NextResponse } from "next/server";
import { computePiltriScore, normaliseWeights } from "@/lib/aggregation/scoring";
import { CRITERIA, aggregateForCountry, getCriterion, kindForScope, matchesFilter } from "@/lib/advancedSearch/criteria";
import { getAllAssembledCities, type AssembledCity } from "@/lib/dataset/load";
import type {
  AdvancedSearchCityResult,
  AdvancedSearchCountryResult,
  AdvancedSearchRequest,
  AdvancedSearchResponse,
  CriterionValue,
} from "@/lib/types";

export const maxDuration = 30;

const MAX_RESULTS = 50;

interface ResolvedFilter {
  filter: AdvancedSearchRequest["filters"][number];
  def: NonNullable<ReturnType<typeof getCriterion>>;
}

function resolveFilters(filters: AdvancedSearchRequest["filters"]): ResolvedFilter[] {
  const resolved: ResolvedFilter[] = [];
  for (const filter of filters ?? []) {
    const def = getCriterion(filter.key);
    if (def) resolved.push({ filter, def });
  }
  return resolved;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
}

/**
 * POST /api/explore/discover
 * body: AdvancedSearchRequest - { scope: "city" | "country", filters, weights? }
 *
 * Filters the full precomputed dataset (every shortlisted city, all fields -
 * see lib/dataset/) in memory. No live API calls and no "not cached yet"
 * gaps: every city is always searchable. Nearby filters read each city's
 * stored distances instead of a per-city pin lookup.
 */
export async function POST(req: NextRequest) {
  let body: AdvancedSearchRequest;
  try {
    body = (await req.json()) as AdvancedSearchRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (body.scope !== "city" && body.scope !== "country") {
    return NextResponse.json({ error: "scope must be 'city' or 'country'" }, { status: 400 });
  }

  const weights = normaliseWeights(body.weights);
  const resolvedFilters = resolveFilters(body.filters ?? []);
  const cities = await getAllAssembledCities();

  if (body.scope === "city") {
    const results: AdvancedSearchCityResult[] = [];
    for (const city of cities) {
      const matchedValues: Record<string, CriterionValue> = {};
      let ok = true;
      for (const { filter, def } of resolvedFilters) {
        const value = def.getCityValue(city.data, city.nearby);
        matchedValues[def.key] = value;
        if (!matchesFilter(value, filter, kindForScope(def, "city"))) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      results.push({
        cityId: city.record.id,
        cityName: city.record.name,
        region: city.record.region,
        country: city.data.country,
        countryCode: city.countryCode,
        lat: city.record.lat,
        lng: city.record.lng,
        sectionScores: city.data.sectionScores,
        piltriScore: computePiltriScore(city.data.sectionScores, weights),
        matchedValues,
      });
    }
    results.sort((a, b) => b.piltriScore - a.piltriScore);
    const response: AdvancedSearchResponse = {
      scope: "city",
      totalCandidates: cities.length,
      checked: cities.length,
      failed: 0,
      notYetCached: 0,
      matchCount: results.length,
      cityResults: results.slice(0, MAX_RESULTS),
    };
    return NextResponse.json(response);
  }

  // ---- Country scope: roll every city's values up per country -------------
  const byCountry = new Map<string, AssembledCity[]>();
  for (const city of cities) {
    if (!byCountry.has(city.countryCode)) byCountry.set(city.countryCode, []);
    byCountry.get(city.countryCode)!.push(city);
  }

  const results: AdvancedSearchCountryResult[] = [];
  for (const [countryCode, group] of byCountry) {
    const matchedValues: Record<string, CriterionValue> = {};
    let ok = true;
    for (const { filter, def } of resolvedFilters) {
      const countryKind = kindForScope(def, "country");
      const rolledUp = aggregateForCountry(
        group.map((c) => def.getCityValue(c.data, c.nearby)),
        def.kind,
        countryKind
      );
      matchedValues[def.key] = rolledUp;
      if (!matchesFilter(rolledUp, filter, countryKind)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const sectionScores = {
      economy: mean(group.map((c) => c.data.sectionScores.economy)),
      safetyStability: mean(group.map((c) => c.data.sectionScores.safetyStability)),
      climate: mean(group.map((c) => c.data.sectionScores.climate)),
      liveability: mean(group.map((c) => c.data.sectionScores.liveability)),
    };
    results.push({
      country: group[0].data.country,
      countryCode,
      citiesTracked: group.length,
      lat: mean(group.map((c) => c.record.lat)),
      lng: mean(group.map((c) => c.record.lng)),
      sectionScores,
      piltriScore: computePiltriScore(sectionScores, weights),
      matchedValues,
      allValues: {},
    });
  }
  results.sort((a, b) => b.piltriScore - a.piltriScore);
  const finalResults = results.slice(0, MAX_RESULTS);
  for (const result of finalResults) {
    const group = byCountry.get(result.countryCode) ?? [];
    for (const def of CRITERIA) {
      result.allValues[def.key] = aggregateForCountry(
        group.map((c) => def.getCityValue(c.data, c.nearby)),
        def.kind,
        kindForScope(def, "country")
      );
    }
  }
  const response: AdvancedSearchResponse = {
    scope: "country",
    totalCandidates: byCountry.size,
    checked: byCountry.size,
    failed: 0,
    notYetCached: 0,
    matchCount: results.length,
    countryResults: finalResults,
  };
  return NextResponse.json(response);
}
