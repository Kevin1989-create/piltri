import { readFileSync } from "fs";
import path from "path";
import { cached, downloadOnce, log } from "./util";

/**
 * Country tax rates (2026-11-21, owner): the combined statutory corporate
 * income tax rate (central plus sub-central government; OECD Corporate Tax
 * Statistics, ~160 jurisdictions) and the top statutory personal income
 * tax rate (OECD Taxing Wages, OECD members only). OECD data: commercial
 * use allowed with attribution. Each country's latest year.
 */

const CIT = "https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_CIT@DF_CIT,/all?startPeriod=2020&format=csv";
const PIT = "https://sdmx.oecd.org/public/rest/data/OECD.CTP.TPS,DSD_TAX_PIT@DF_PIT_TOP_EARN_THRESH,/all?startPeriod=2020&format=csv";

export const CORPORATE_TAX_SOURCE = "OECD Corporate Tax Statistics - combined statutory corporate income tax rate (central and sub-central government)";
export const PERSONAL_TAX_SOURCE = "OECD Taxing Wages - top statutory personal income tax rate (central and sub-central government), OECD members";

export interface TaxRate { pct: number; year: number }

/** iso3 -> latest value of the rows passing `keep`. */
async function latestBy(url: string, file: string, keep: (row: Record<string, string>) => boolean): Promise<Record<string, TaxRate>> {
  const lines = readFileSync(await downloadOnce(url, file), "utf8").split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(",");
  const out: Record<string, TaxRate> = {};
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const row = Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
    if (!keep(row)) continue;
    const pct = Number(row.OBS_VALUE);
    const year = Number(row.TIME_PERIOD);
    if (row.OBS_VALUE === "" || !Number.isFinite(pct) || !year) continue;
    if (!out[row.REF_AREA] || out[row.REF_AREA].year < year) out[row.REF_AREA] = { pct: Math.round(pct * 10) / 10, year };
  }
  return out;
}

export async function loadTaxRates(): Promise<{ corporate: Record<string, TaxRate>; personal: Record<string, TaxRate> }> {
  return cached("tax-rates-v1", async () => {
    try {
      const corporate = await latestBy(CIT, "oecd-corporate-tax.csv", (r) => r.MEASURE === "CIT_C" && r.TARGETING === "ST");
      const personal = await latestBy(PIT, "oecd-top-personal-tax.csv", (r) => r.MEASURE === "TS_PIT");
      log("tax", `corporate tax rate for ${Object.keys(corporate).length} countries, top personal rate for ${Object.keys(personal).length}`);
      return { corporate, personal };
    } catch (err) {
      // The OECD's API can refuse a cloud runner (2026-11-21: the refresh
      // stopped here). The rates change once a year: the last ones fetched
      // (pipeline/static/oecd-tax-rates.json, 2026-11-21) rather than no
      // dataset at all.
      const message = `OECD tax rates unavailable (${String(err).slice(0, 200)}) - using the saved 2026-11-21 copy`;
      log("tax", `WARNING: ${message}`);
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Tax rates::${message.replace(/\s+/g, " ")}`);
      return JSON.parse(readFileSync(path.join(__dirname, "static", "oecd-tax-rates.json"), "utf8")) as { corporate: Record<string, TaxRate>; personal: Record<string, TaxRate> };
    }
  });
}
