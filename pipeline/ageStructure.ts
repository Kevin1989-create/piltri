import path from "path";
import { sumWithinRadius } from "./population";
import { cached, downloadOnce, log, pointsKey } from "./util";

/**
 * Median age of the people living within 5 km of each city centre
 * (2026-10-24, phase 1 of local data), from WorldPop's age structures
 * (University of Southampton, R2025A, 2025, 1 km, constrained to built
 * settlements, CC BY 4.0): census age counts spread over the population
 * grid. The same 5 km circle as the density figure; the median falls in
 * one 5-year age group and is placed within it in proportion.
 */
const YEAR = 2025;
const RADIUS_KM = 5;
/** Below this many people within 5 km, an age profile is mostly noise. */
const MIN_PEOPLE = 1000;
/** WorldPop's age groups: [first age, years covered] - under 1, 1-4, then
 *  5-year groups to 85-89 and 90+ (taken as 10 years). */
const GROUPS: [number, number][] = [
  [0, 1],
  [1, 4],
  ...Array.from({ length: 17 }, (_, k): [number, number] => [5 * (k + 1), 5]),
  [90, 10],
];

export const AGE_SOURCE = `WorldPop age and sex structures R2025A, ${YEAR}, 1 km, constrained (University of Southampton, CC BY 4.0) - median age within ${RADIUS_KM} km of the centre`;

const DOWNLOADS_AT_ONCE = 5;

const fileName = (age: number) => `global_t_${String(age).padStart(2, "0")}_${YEAR}_CN_1km_R2025A_v1.tif`;

/** Total population per age group, both sexes: ~270 MB each, 20 groups,
 *  DOWNLOADS_AT_ONCE at a time (the server is slow per connection). The
 *  build starts this first, so it overlaps the long outline step. */
export async function downloadAgeGroups(): Promise<string[]> {
  const files: string[] = new Array(GROUPS.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: DOWNLOADS_AT_ONCE }, async () => {
      while (next < GROUPS.length) {
        const g = next++;
        const name = fileName(GROUPS[g][0]);
        files[g] = await downloadOnce(
          `https://data.worldpop.org/GIS/AgeSex_structures/Global_2015_2030/R2025A/${YEAR}/0_Mosaicked/v1/1km/constrained/${name}`,
          path.join(`worldpop-${YEAR}`, name)
        );
      }
    })
  );
  return files;
}

export async function sampleMedianAge(points: { lat: number; lng: number }[], files: string[]): Promise<(number | null)[]> {
  return cached(`median-age-${YEAR}-${pointsKey(points)}`, async () => {
    const byGroup: (number | null)[][] = [];
    for (const file of files) byGroup.push(await sumWithinRadius(file, points, RADIUS_KM, "age"));
    const out = points.map((_, i) => {
      const counts = byGroup.map((g) => g[i] ?? 0);
      const total = counts.reduce((a, b) => a + b, 0);
      if (total < MIN_PEOPLE) return null;
      let below = 0;
      for (let g = 0; g < GROUPS.length; g++) {
        if (below + counts[g] >= total / 2) {
          const [first, years] = GROUPS[g];
          return Math.round((first + ((total / 2 - below) / counts[g]) * years) * 10) / 10;
        }
        below += counts[g];
      }
      return null;
    });
    log("age", `median age for ${out.filter((v) => v != null).length} of ${points.length} places`);
    return out;
  });
}
