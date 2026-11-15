// Each country's largest religious group (owner, 2026-11-14: "in
// demographic country, can we add a field for main religion"), from the
// CIA World Factbook - public domain - via its JSON mirror
// (github.com/factbook/factbook.json), into pipeline/static/main-religion.json
// ({ "FR": { "name": "Roman Catholic", "pct": 47, "year": "2021" } }).
// "none" counts as a group ("No religion" - the largest in Czechia, for
// one); "unspecified" and "other" don't. Run by hand now and then: the
// estimates change slowly.
//
// Usage: node scripts/build-main-religion.mjs

import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = "https://raw.githubusercontent.com/factbook/factbook.json/master";
const OUT = path.join(root, "pipeline", "static", "main-religion.json");
/** Our countries (ISO2 -> name), from the dataset manifest. */
const ours = JSON.parse(readFileSync(path.join(root, "lib", "dataset", "meta.generated.json"), "utf8")).countryNames;

const plain = (s) =>
  s
    .replace(/&([a-z])(acute|grave|circ|uml|tilde|cedil|ring);/gi, "$1")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^the /, "")
    .replace(/[^a-z]+/g, " ")
    .trim();

/** Factbook names that differ from ours (Factbook short form -> ISO2). */
const NAME_FIX = {
  "burma": "MM",
  "cabo verde": "CV",
  "congo democratic republic of the": "CD",
  "congo republic of the": "CG",
  "cote d ivoire": "CI",
  "czechia": "CZ",
  "eswatini": "SZ",
  "gambia": "GM",
  "holy see": "VA",
  "korea north": "KP",
  "korea south": "KR",
  "micronesia federated states of": "FM",
  "north macedonia": "MK",
  "russia": "RU",
  "turkey": "TR",
  "turkiye": "TR",
  "timor leste": "TL",
  "bahamas": "BS",
  "west bank": "PS",
  "gaza strip": "PS",
  "saint martin": "MF",
  "sint maarten": "SX",
  "curacao": "CW",
  "virgin islands": "VI",
  "british virgin islands": "VG",
  "laos": "LA",
  "syria": "SY",
  "iran": "IR",
  "vietnam": "VN",
  "brunei": "BN",
  "moldova": "MD",
  "tanzania": "TZ",
  "bolivia": "BO",
  "venezuela": "VE",
  "congo brazzaville": "CG",
  "drc": "CD",
  "saint helena ascension and tristan da cunha": "SH",
  "cocos keeling islands": "CC",
  "federated states of micronesia": "FM",
  "pitcairn islands": "PN",
  "dominican": "DO",
  "macau": "MO",
  "holy see vatican city": "VA",
  "gaza": "PS",
  "falkland islands islas malvinas": "FK",
};
const byName = new Map(Object.entries(ours).map(([cc, name]) => [plain(name), cc]));
/** Groups the Factbook lists by their churches' names. */
const NAME_OVERRIDE = {
  // "Church of Jesus Christ in Madagascar/Malagasy Lutheran Church/Anglican Church 34%"
  MG: "Protestant",
};
/** Long names, shortened to fit half a line on the place page (2026-11-15). */
const SHORT_NAME = {
  "Eastern Orthodox Christian": "Eastern Orthodox",
  "Evangelical Lutheran Church of Iceland": "Lutheran",
  "Evangelical Lutheran": "Lutheran",
  "Congregational Christian Church": "Congregational",
  "Traditionally Buddhist and Confucian": "Buddhist/Confucian",
};

/** Top-level "Name 12.3%" items of a Factbook religions line. */
function topLevel(text) {
  const items = [];
  let depth = 0;
  let cur = "";
  // "&nbsp;", and DR Congo's "Christian 93/1%" (93.1%).
  const clean = text.replace(/&nbsp;/g, " ").replace(/(\d)\/(\d)\s*%/g, "$1.$2%");
  for (const ch of clean.replace(/\(\d{4}[^)]*\)\s*$/, "")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items.map((item) => {
    // Brackets (nested ones too - Ukraine's) are detail, not the group.
    let outer = item;
    while (/\([^()]*\)/.test(outer)) outer = outer.replace(/\([^()]*\)/g, "");
    outer = outer.replace(/[()]/g, "").trim();
    // "Muslim 80-85%" (the middle), "more than 70%", "about 5%" - or a
    // share whose % sign the Factbook forgot (Andorra's "Christian 89.5").
    const m =
      outer.match(/^(.*?)\s+(?:about|approximately|nearly|almost|over|more than|less than|<|>)?\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*%/i) ??
      outer.match(/^(.*?)\s+(\d+(?:\.\d+)?)()$/);
    const name = (m ? m[1] : outer).replace(/\s+(about|approximately|nearly|almost|over|more than|less than)$/i, "").replace(/\s+/g, " ").trim();
    const pct = m ? (m[3] ? (Number(m[2]) + Number(m[3])) / 2 : Number(m[2])) : null;
    return { name, pct };
  });
}

function mainReligion(text) {
  const items = topLevel(text).filter((i) => i.name && !/^(unspecified|other|unknown|no answer|not stated)/i.test(i.name));
  const withPct = items.filter((i) => i.pct != null);
  const best = withPct.length ? withPct.reduce((a, b) => (b.pct > a.pct ? b : a)) : items[0];
  if (!best) return null;
  let name = best.name.replace(/^(none|no religion|non-?religious|unaffiliated|atheist|agnostic)\b.*/i, "No religion");
  name = name.charAt(0).toUpperCase() + name.slice(1);
  name = SHORT_NAME[name] ?? name;
  const year = (text.match(/\((\d{4})(?:[^)]*)est\.?\)/) ?? text.match(/\b(19|20)\d{2}\b/))?.[0]?.match(/\d{4}/)?.[0] ?? null;
  return { name, pct: best.pct != null ? Math.round(best.pct) : null, year };
}

const tree = await (await fetch("https://api.github.com/repos/factbook/factbook.json/git/trees/master?recursive=1")).json();
const files = tree.tree.map((t) => t.path).filter((p) => /^[a-z-]+\/[a-z]{2}\.json$/.test(p) && !/^(oceans|world|antarctica)\//.test(p));
const out = {};
const unmatched = [];
for (const file of files) {
  const j = await (await fetch(`${RAW}/${file}`)).json();
  const short = j.Government?.["Country name"]?.["conventional short form"]?.text;
  const long = j.Government?.["Country name"]?.["conventional long form"]?.text;
  const name = short && short !== "none" ? short : long;
  const text = j["People and Society"]?.Religions?.text;
  if (!name || !text) continue;
  const key = plain(name);
  const cc = NAME_FIX[key] ?? byName.get(key);
  if (!cc) {
    unmatched.push(name);
    continue;
  }
  const main = mainReligion(text);
  if (main && NAME_OVERRIDE[cc]) main.name = NAME_OVERRIDE[cc];
  if (main && !out[cc]) out[cc] = main;
}
writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 1) + "\n");
const missing = Object.keys(ours).filter((cc) => !out[cc]);
console.log(`${Object.keys(out).length} countries -> ${path.relative(root, OUT)}`);
console.log(`Factbook entries not matched (${unmatched.length}): ${unmatched.join(", ")}`);
console.log(`Our countries without one (${missing.length}): ${missing.map((cc) => `${cc} ${ours[cc]}`).join(", ")}`);
for (const cc of ["FR", "CZ", "US", "IN", "JP", "SA", "BR", "CN", "NL", "GB", "IL", "TH", "NG", "DE"]) console.log(`  ${cc}: ${JSON.stringify(out[cc])}`);
