import { NextRequest, NextResponse } from "next/server";
import { getDiscoverCities, getDiscoverCountries } from "@/lib/discoverCities";
import { citySlug, getCachedCityDataBatch, getOrAggregateCityData, getOrAggregatePinDataForCity } from "@/lib/aggregation/cache";
import { computePiltriScore, normaliseWeights } from "@/lib/aggregation/scoring";
import { CRITERIA, aggregateForCountry, getCriterion, kindForScope, matchesFilter } from "@/lib/advancedSearch/criteria";
import type {
  AdvancedSearchCityResult,
  AdvancedSearchCountryResult,
  AdvancedSearchRequest,
  AdvancedSearchResponse,
  CityExploreData,
  CitySearchResult,
  CriterionValue,
  PinnedLocationData,
} from "@/lib/types";

// How many candidates to score concurrently. Kept modest — each city
// aggregation makes several live external API calls (Overpass, World Bank,
// Open-Meteo, WHO, REST Countries, and now optionally Mapbox/Overpass again
// for the Nearby criteria's pin-at-centre lookup), and too much concurrency
// risks tripping the free-tier rate limits on those APIs.
const CONCURRENCY = 6;

const MAX_CITY_CANDIDATES = 10000; // headroom above the ~6,300-city shortlist (data/static/discover-cities.json)
const MAX_COUNTRY_CANDIDATES = 250; // shortlist covers ~171 countries
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

/**
 * POST /api/explore/discover
 * body: AdvancedSearchRequest — { scope: "city" | "country", filters: AdvancedSearchCriterionFilter[], weights? }
 *
 * Evaluates every requested filter against the full criteria registry (see
 * lib/advancedSearch/criteria.ts) for each candidate — real, live-aggregated
 * data, same pipeline as the single-city results page, not mocked. The
 * "Nearby & distance" criteria additionally need each candidate's centre-
 * point Pin-mode data (getOrAggregatePinDataForCity) — that lookup is only
 * made when at least one Nearby filter is actually active, so a search that
 * doesn't touch Beach/Subway/etc. stays exactly as fast as the old
 * min-score-only Discover search did.
 *
 * Country scope reuses the identical per-city aggregation, then rolls each
 * requested criterion up across that country's tracked cities (mean for
 * numeric fields, OR for booleans/"found one anywhere" — see
 * aggregateForCountry) rather than hitting a separate country-level data
 * source that doesn't exist.
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
  const needsPinData = resolvedFilters.some((f) => f.def.needsPinData);

  async function scoreCity(
    city: CitySearchResult,
    cachedData?: CityExploreData
  ): Promise<{ data: CityExploreData; pin: PinnedLocationData | null } | null> {
    try {
      // cachedData, when present, comes from the batch Supabase read done
      // up front (see getCachedCityDataBatch) - skips this city's own
      // upsert+select round trip entirely, which is what makes a "warm"
      // search (every candidate already cached) fast rather than merely
      // "not doing live external API calls but still slow on DB latency".
      const data = cachedData ?? (await getOrAggregateCityData(city));
      const pin = needsPinData ? await getOrAggregatePinDataForCity(city).catch(() => null) : null;
      return { data, pin };
    } catch (err) {
      console.error(`Advanced search: failed to score ${city.cityName}:`, err);
      return null;
    }
  }

  if (body.scope === "city") {
    const candidates = getDiscoverCities().slice(0, MAX_CITY_CANDIDATES);
    const cachedBatch = await getCachedCityDataBatch(candidates);
    const results: AdvancedSearchCityResult[] = [];
    let checked = 0;
    let failed = 0;

    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (candidate) => {
          const city: CitySearchResult = {
            cityId: candidate.cityId,
            cityName: candidate.cityName,
            region: candidate.region,
            country: candidate.country,
            countryCode: candidate.countryCode,
            lat: candidate.lat,
            lng: candidate.lng,
          };
          const scored = await scoreCity(city, cachedBatch.get(citySlug(city)));
          return { candidate, scored };
        })
      );

      for (const { candidate, scored } of batchResults) {
        checked++;
        if (!scored) {
          failed++;
          continue;
        }
        const { data, pin } = scored;

        const matchedValues: Record<string, CriterionValue> = {};
        let meetsAll = true;
        for (const { filter, def } of resolvedFilters) {
          const value = def.getCityValue(data, pin);
          const kind = kindForScope(def, "city");
          matchedValues[def.key] = value;
          if (!matchesFilter(value, filter, kind)) {
            meetsAll = false;
            break;
          }
        }
        if (!meetsAll) continue;

        results.push({
          cityId: candidate.cityId,
          cityName: candidate.cityName,
          region: candidate.region,
          country: candidate.country,
          countryCode: candidate.countryCode,
          lat: candidate.lat,
          lng: candidate.lng,
          sectionScores: data.sectionScores,
          piltriScore: computePiltriScore(data.sectionScores, weights),
          matchedValues,
        });
      }
    }

    results.sort((a, b) => b.piltriScore - a.piltriScore);

    const response: AdvancedSearchResponse = {
      scope: "city",
      totalCandidates: candidates.length,
      checked,
      failed,
      matchCount: results.length,
      cityResults: results.slice(0, MAX_RESULTS),
    };
    return NextResponse.json(response);
  }

  // ---- Country scope ------------------------------------------------------
  const countries = getDiscoverCountries().slice(0, MAX_COUNTRY_CANDIDATES);
  // Same shortlist of ~500 cities underlies every country here (see
  // discoverCities.ts) - one flat batch-cache read across all of them up
  // front, same as city scope, rather than per-country.
  const cachedBatch = await getCachedCityDataBatch(countries.flatMap((c) => c.cities));
  const results: AdvancedSearchCountryResult[] = [];
  // Retained alongside `results` (keyed by countryCode) purely so the
  // post-sort enrichment pass below can compute the full-KPI breakdown for
  // just the top MAX_RESULTS countries without re-fetching anything -
  // computing it for every matched country (which, on a loose/no filter,
  // can be all ~190 of them) would waste work on results that never get
  // returned anyway.
  const validByCountryCode = new Map<string, { data: CityExploreData; pin: PinnedLocationData | null }[]>();
  let checked = 0;
  let failed = 0;

  for (let i = 0; i < countries.length; i += CONCURRENCY) {
    const batch = countries.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (country) => {
        const scoredCities = await Promise.all(
          country.cities.map(async (candidate) => {
            const city: CitySearchResult = {
              cityId: candidate.cityId,
              cityName: candidate.cityName,
              region: candidate.region,
              country: candidate.country,
              countryCode: candidate.countryCode,
              lat: candidate.lat,
              lng: candidate.lng,
            };
            return scoreCity(city, cachedBatch.get(citySlug(city)));
          })
        );
        const valid = scoredCities.filter((s): s is { data: CityExploreData; pin: PinnedLocationData | null } => s != null);
        return { country, valid };
      })
    );

    for (const { country, valid } of batchResults) {
      checked++;
      if (valid.length === 0) {
        failed++;
        continue;
      }

      const meanSectionScores = {
        economy: mean(valid.map((v) => v.data.sectionScores.economy)),
        safetyStability: mean(valid.map((v) => v.data.sectionScores.safetyStability)),
        climate: mean(valid.map((v) => v.data.sectionScores.climate)),
        liveability: mean(valid.map((v) => v.data.sectionScores.liveability)),
      };

      const matchedValues: Record<string, CriterionValue> = {};
      let meetsAll = true;
      for (const { filter, def } of resolvedFilters) {
        const cityValues = valid.map((v) => def.getCityValue(v.data, v.pin));
        const countryKind = kindForScope(def, "country");
        const rolledUp = aggregateForCountry(cityValues, def.kind, countryKind);
        matchedValues[def.key] = rolledUp;
        if (!matchesFilter(rolledUp, filter, countryKind)) {
          meetsAll = false;
          break;
        }
      }
      if (!meetsAll) continue;

      validByCountryCode.set(country.countryCode, valid);
      results.push({
        country: country.country,
        countryCode: country.countryCode,
        citiesTracked: valid.length,
        lat: mean(valid.map((v) => v.data.lat)),
        lng: mean(valid.map((v) => v.data.lng)),
        sectionScores: meanSectionScores,
        piltriScore: computePiltriScore(meanSectionScores, weights),
        matchedValues,
        allValues: {}, // filled in below, only for the results actually returned
      });
    }
  }

  results.sort((a, b) => b.piltriScore - a.piltriScore);
  const finalResults = results.slice(0, MAX_RESULTS);

  // Full-KPI enrichment - every criterion in the registry, not just the
  // ones filtered on, but only for the countries actually being returned,
  // and only using data already fetched above (no new live calls; Nearby
  // criteria only come out populated here if the search itself already
  // needed pin data - see the AdvancedSearchCountryResult.allValues doc
  // comment in lib/types.ts for the full reasoning).
  for (const result of finalResults) {
    const valid = validByCountryCode.get(result.countryCode);
    if (!valid) continue;
    for (const def of CRITERIA) {
      // Skip Nearby criteria entirely (rather than aggregating a run of
      // nulls into a false-looking "No") when this search never actually
      // fetched pin data - aggregateForCountry's boolean OR would read an
      // all-null input as "not found anywhere", which is a different claim
      // than "never checked".
      if (def.needsPinData && !needsPinData) continue;
      const countryKind = kindForScope(def, "country");
      const cityValues = valid.map((v) => def.getCityValue(v.data, v.pin));
      result.allValues[def.key] = aggregateForCountry(cityValues, def.kind, countryKind);
    }
  }

  const response: AdvancedSearchResponse = {
    scope: "country",
    totalCandidates: countries.length,
    checked,
    failed,
    matchCount: results.length,
    countryResults: finalResults,
  };
  return NextResponse.json(response);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
}
