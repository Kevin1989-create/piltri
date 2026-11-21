"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DATA_BASE, manifest } from "@/lib/dataset/files";
import type { DailyPick } from "@/lib/dataset/schema";
import { cityUrl } from "@/lib/urls";

/** "Today, let's try" (2026-11-21, owner: a daily thing, different cities
 *  every morning; only places with the most data, a photo, and a score of
 *  70 or more). The pool is the dataset's picks.json (pipeline/output.ts:
 *  cities of 100,000+, photo, among the tenth best covered, 70+ at the
 *  default settings, no suburbs); until a dataset has one, the same rule
 *  applied to the 2026-11-16 dataset (FALLBACK). Five a day from five
 *  countries, the next five at the visitor's midnight, in a fixed shuffle
 *  so everyone sees the same ones. */
const FALLBACK: DailyPick[] = [
  ["Klagenfurt am Wörthersee","klagenfurt-am-wörthersee-at","AT"], ["Linz","linz-at","AT"],
  ["Hobart","hobart-au","AU"], ["Mostar","mostar-ba","BA"], ["Chilliwack","chilliwack-ca","CA"],
  ["Kelowna","kelowna-ca","CA"], ["Abbotsford","abbotsford-ca","CA"], ["Kingston","kingston-ca","CA"],
  ["Guelph","guelph-ca","CA"], ["Brantford","brantford-ca","CA"], ["Winterthur","winterthur-ch","CH"],
  ["Pilsen","pilsen-cz","CZ"], ["Ostrava","ostrava-cz","CZ"], ["Freiburg","freiburg-de","DE"], ["Ulm","ulm-de","DE"],
  ["Potsdam","potsdam-de","DE"], ["Reutlingen","reutlingen-de","DE"], ["Tallinn","tallinn-ee","EE"],
  ["Barakaldo","barakaldo-es","ES"], ["Salamanca","salamanca-castille-and-león-es","ES"],
  ["Montpellier","montpellier-fr","FR"], ["Nice","nice-fr","FR"], ["Nîmes","nîmes-fr","FR"],
  ["Bordeaux","bordeaux-fr","FR"], ["Grenoble","grenoble-fr","FR"], ["Mulhouse","mulhouse-fr","FR"],
  ["Dundee","dundee-gb","GB"], ["Belfast","belfast-gb","GB"], ["Pátra","pátra-gr","GR"],
  ["Székesfehérvár","székesfehérvár-hu","HU"], ["Győr","győr-hu","HU"], ["Nyíregyháza","nyíregyháza-hu","HU"],
  ["Debrecen","debrecen-hu","HU"], ["Cork","cork-ie","IE"], ["Limerick","limerick-ie","IE"], ["Padua","padua-it","IT"],
  ["Tsu","tsu-jp","JP"], ["Yokkaichi","yokkaichi-jp","JP"], ["Suzuka","suzuka-jp","JP"], ["Ise","ise-jp","JP"],
  ["Gifu","gifu-jp","JP"], ["Ōgaki","ōgaki-jp","JP"], ["Kaunas","kaunas-lt","LT"], ["Podgorica","podgorica-me","ME"],
  ["Groningen","groningen-nl","NL"], ["Leeuwarden","leeuwarden-nl","NL"], ["Apeldoorn","apeldoorn-nl","NL"],
  ["Stavanger","stavanger-no","NO"], ["Trondheim","trondheim-no","NO"], ["Drammen","drammen-no","NO"],
  ["Kristiansand","kristiansand-no","NO"], ["Hamilton","hamilton-nz","NZ"], ["Tauranga","tauranga-nz","NZ"],
  ["Szczecin","szczecin-pl","PL"], ["Gdańsk","gdańsk-pl","PL"], ["Gdynia","gdynia-pl","PL"], ["Płock","płock-pl","PL"],
  ["Toruń","toruń-pl","PL"], ["Bydgoszcz","bydgoszcz-pl","PL"], ["Malmö","malmö-se","SE"],
  ["Helsingborg","helsingborg-se","SE"], ["Uppsala","uppsala-se","SE"], ["Västerås","västerås-se","SE"],
  ["Linköping","linköping-se","SE"], ["Örebro","örebro-se","SE"], ["Ljubljana","ljubljana-si","SI"],
  ["Bratislava","bratislava-sk","SK"], ["Tacoma","tacoma-us","US"], ["Knoxville","knoxville-us","US"],
  ["Kansas City","kansas-city-us","US"], ["Chattanooga","chattanooga-us","US"], ["Everett","everett-us","US"],
  ["Cincinnati","cincinnati-us","US"],
];
const PER_DAY = 5;

/** A fixed shuffle (mulberry32, constant seed): the same order for everyone. */
function shuffled<T>(items: T[]): T[] {
  let seed = 20261121;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Today's five: from the day's place in the shuffled pool, the next ones
 *  from countries not yet in the five. */
function todaysPicks(pool: DailyPick[], now: Date): DailyPick[] {
  if (!pool.length) return [];
  const order = shuffled(pool);
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
  const out: DailyPick[] = [];
  const countries = new Set<string>();
  for (let k = 0; k < order.length && out.length < PER_DAY; k++) {
    const pick = order[(day * PER_DAY + k) % order.length];
    if (countries.has(pick[2])) continue;
    countries.add(pick[2]);
    out.push(pick);
  }
  return out;
}

export function DailyPicks({ chipClassName, lastClassName }: { chipClassName: string; lastClassName?: string }) {
  // Picked in the browser, after the first paint: the page is built once on
  // the server, and the day is the visitor's.
  const [picks, setPicks] = useState<DailyPick[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const choose = (pool: DailyPick[]) => !cancelled && setPicks(todaysPicks(pool, new Date()));
    if (manifest.picks)
      fetch(`${DATA_BASE}/picks.json`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((pool: DailyPick[]) => choose(pool.length >= PER_DAY ? pool : FALLBACK))
        .catch(() => choose(FALLBACK));
    else choose(FALLBACK);
    return () => {
      cancelled = true;
    };
  }, []);
  const extra = (k: number) => (k === PER_DAY - 1 && lastClassName ? ` ${lastClassName}` : "");
  return (
    <>
      {picks
        ? picks.map(([name, id], k) => (
            <Link key={id} href={cityUrl(id)} className={chipClassName + extra(k)}>
              {name}
            </Link>
          ))
        : // Same size while the day's picks load, so nothing below moves.
          Array.from({ length: PER_DAY }, (_, k) => (
            <span key={k} aria-hidden className={`${chipClassName} invisible w-16${extra(k)}`}>
              &nbsp;
            </span>
          ))}
    </>
  );
}
