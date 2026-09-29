import { cached, fetchJson } from "../util";

/**
 * Each country's official languages, from Unicode CLDR's territory data
 * (every language's legal status and share of speakers per country, the
 * reference behind language settings in phones and browsers - Unicode
 * License). Politically sensitive, so the rules are strict and simple:
 *
 *  - status "official" only - not "official_regional" (Catalan in Spain,
 *    Welsh in the UK) and not "de_facto_official" (Russian in Ukraine),
 *    except a de facto language spoken by a majority, or where a country
 *    has no official language at all (English in New Zealand, the US);
 *  - listed alphabetically - an order of importance would itself be a
 *    political statement;
 *  - where CLDR's model differs from a constitution, the constitution wins
 *    (OVERRIDES, each with its reason).
 */

const CLDR = "https://cdn.jsdelivr.net/npm";
const CLDR_VERSION = "47";

/** Country -> official languages as the country's own constitution or law
 *  names them, where CLDR differs (reviewed 2026-09-28). */
const OVERRIDES: Record<string, string[]> = {
  // Constitution s.6: all 11 are official nationally; CLDR files every one
  // but English as "official_regional".
  ZA: ["Afrikaans", "English", "Northern Sotho", "South Ndebele", "Southern Sotho", "Swati", "Tsonga", "Tswana", "Venda", "Xhosa", "Zulu"],
  // Constitution art. 13: Montenegrin (CLDR: Serbian).
  ME: ["Montenegrin"],
  // Constitution art. 55: English; Hausa, Igbo, Yoruba are national, not official.
  NG: ["English"],
  // Constitution arts. 3-4 (2016): Arabic and Tamazight; French isn't official.
  DZ: ["Arabic", "Tamazight"],
  // Constitution art. 4: Arabic and Kurdish (CLDR: Kurdish regional).
  IQ: ["Arabic", "Kurdish"],
  // Constitution art. 5 (2011): Arabic and Tamazight (CLDR: "Central Atlas Tamazight").
  MA: ["Arabic", "Tamazight"],
  // Constitution art. 16: Pashto and Dari (CLDR: "Persian").
  AF: ["Dari", "Pashto"],
  // Basic Law (2018) s.4: Hebrew is the state language; Arabic has a
  // "special status" (CLDR still lists it as official).
  IL: ["Hebrew"],
};

/** Dialects CLDR lists next to their standard language (Swiss German). */
const VARIETIES = new Set(["gsw"]);

type TerritoryInfo = Record<string, { languagePopulation?: Record<string, { _populationPercent: string; _officialStatus?: string }> }>;

/** Country code -> official languages (English names, alphabetical). */
export async function loadOfficialLanguages(): Promise<Record<string, string[]>> {
  return cached(`cldr-official-languages-v2-${CLDR_VERSION}`, async () => {
    const territories: TerritoryInfo = (await fetchJson(`${CLDR}/cldr-core@${CLDR_VERSION}/supplemental/territoryInfo.json`)).supplemental.territoryInfo;
    const names: Record<string, string> = (await fetchJson(`${CLDR}/cldr-localenames-full@${CLDR_VERSION}/main/en/languages.json`)).main.en
      .localeDisplayNames.languages;
    const out: Record<string, string[]> = {};
    for (const [cc, info] of Object.entries(territories)) {
      // "sr_Latn" and "sr_Cyrl" are one language.
      const langs = Object.entries(info.languagePopulation ?? {}).map(([code, v]) => ({
        code: code.split("_")[0],
        status: v._officialStatus,
        share: Number(v._populationPercent),
      }));
      const official = langs.filter((l) => l.status === "official");
      const deFacto = langs.filter(
        (l) => l.status === "de_facto_official" && !VARIETIES.has(l.code) && (official.length === 0 || l.share >= 50)
      );
      const list = [...new Set(OVERRIDES[cc] ?? [...official, ...deFacto].map((l) => names[l.code] ?? l.code))].sort((a, b) => a.localeCompare(b));
      if (list.length) out[cc] = list;
    }
    return out;
  });
}

export const LANGUAGES_SOURCE = `Unicode CLDR ${CLDR_VERSION} territory data (official status; Unicode License)`;
