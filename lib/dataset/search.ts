import type { CitySearchResult } from "@/lib/types";
import { getCountries } from "./cities";
import { loadFile, manifest, memo } from "./files";
import { cityIdFor, normaliseSearchText, searchKey, searchKey3, type SearchEntry } from "./schema";

/** Search-as-you-type over every shortlisted place, in the browser. The
 *  first keystroke reads the 300 largest places for that letter; from the
 *  second on, the index file for the query's longest word (every place is
 *  filed under each of its words, by their first two characters - or three,
 *  for the busiest, see SEARCH_SPLIT_AT), a few KB - after which each
 *  keystroke is instant. Largest places first. */

interface Indexed {
  entry: SearchEntry;
  name: string;
  words: string[];
}

const indexes = new Map<string, Promise<Indexed[]>>();
const existing = new Set(manifest.searchFiles);

/** Which index file answers a normalised query: its longest word's. */
function fileFor(query: string): string {
  if (query.length === 1) return query;
  const word = query.split(" ").reduce((a, b) => (b.length > a.length ? b : a), "");
  if (word.length < 2) return searchKey(query);
  const three = searchKey3(word);
  return word.length >= 3 && existing.has(three) ? three : searchKey(word);
}

function loadIndex(file: string): Promise<Indexed[]> {
  return memo(indexes, file, async () =>
    (existing.has(file) ? await loadFile<SearchEntry[]>(`search/${file}.json`) : []).map((entry) => {
      const name = normaliseSearchText(entry[0]);
      return { entry, name, words: name.split(" ") };
    })
  );
}

/** Starts loading the index file a query will need. */
export function prefetchSearch(query: string): void {
  const q = normaliseSearchText(query);
  if (q) loadIndex(fileFor(q)).catch(() => {});
}

const normalisedCountryNames = Object.entries(manifest.countryNames).map(([cc, name]) => ({ cc, name: normaliseSearchText(name) }));

function toResult([name, region, cc, lat, lng, customId]: SearchEntry): CitySearchResult {
  return { cityId: customId ?? cityIdFor(name, cc), cityName: name, region, country: manifest.countryNames[cc] ?? cc, countryCode: cc, lat, lng };
}

/** "lisbon", "lisbon, portugal", "new york, united" or a full country name
 *  ("france" puts its capital first). */
export async function searchCities(rawQuery: string, limit = 6): Promise<CitySearchResult[]> {
  const [cityPart, countryPart = ""] = rawQuery.split(",").map((s) => normaliseSearchText(s));
  if (!cityPart) return [];
  const all = await loadIndex(fileFor(cityPart));
  const countryCodes = countryPart ? new Set(normalisedCountryNames.filter((c) => c.name.startsWith(countryPart)).map((c) => c.cc)) : null;
  const countryOk = (e: SearchEntry) => !countryCodes || countryCodes.has(e[2]);

  const results: SearchEntry[] = [];
  const seen = new Set<string>();
  // By id: several towns can share a name in one country.
  const push = (e: SearchEntry) => {
    const id = e[5] ?? cityIdFor(e[0], e[2]);
    if (results.length < limit && !seen.has(id)) {
      seen.add(id);
      results.push(e);
    }
  };

  if (!countryPart) {
    const country = normalisedCountryNames.find((c) => c.name === cityPart);
    if (country) {
      const capital = (await getCountries())[country.cc]?.capital;
      if (capital) {
        const capitalIndex = await loadIndex(fileFor(normaliseSearchText(capital.name)));
        const hit = capitalIndex.find((c) => c.entry[2] === country.cc && c.entry[0] === capital.name);
        if (hit) push(hit.entry);
      }
    }
  }
  for (const c of all) if (results.length < limit && c.name === cityPart && countryOk(c.entry)) push(c.entry);
  for (const c of all) if (results.length < limit && c.name.startsWith(cityPart) && countryOk(c.entry)) push(c.entry);
  for (const c of all) if (results.length < limit && c.words.some((w) => w.startsWith(cityPart)) && countryOk(c.entry)) push(c.entry);
  return results.map(toResult);
}
