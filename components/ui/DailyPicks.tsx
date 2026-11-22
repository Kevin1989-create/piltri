"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DATA_BASE, manifest } from "@/lib/dataset/files";
import type { DailyPick } from "@/lib/dataset/schema";
import { cityUrl } from "@/lib/urls";

/** "Today, let's try" - hidden gems (2026-11-22, owner: "cities 75 and +,
 *  which also are a bit special", with their proper borders on the map).
 *  The pool is the dataset's picks.json (pipeline/output.ts: towns of
 *  15,000-200,000 scoring 75+, with a photo, their own border, among the
 *  fifth best covered, not a capital, district or suburb); until a dataset
 *  has one, the same rule applied to the 2026-11-16 dataset (FALLBACK).
 *  Five a day from five countries, the next five at the visitor's
 *  midnight, in a fixed shuffle so everyone sees the same ones. */
const FALLBACK: DailyPick[] = [
  ["Klagenfurt am Wörthersee","klagenfurt-am-wörthersee-at","AT"], ["Wiener Neustadt","wiener-neustadt-at","AT"],
  ["Gympie","gympie-au","AU"], ["Grafton","grafton-au","AU"], ["Cairns","cairns-au","AU"],
  ["Mandurah","mandurah-au","AU"], ["Launceston","launceston-au","AU"], ["Taree","taree-au","AU"],
  ["Koksijde","koksijde-be","BE"], ["Brugge","brugge-be","BE"], ["Nanaimo","nanaimo-ca","CA"],
  ["Campbell River","campbell-river-ca","CA"], ["Niagara Falls","niagara-falls-ca","CA"],
  ["Squamish","squamish-ca","CA"], ["Courtenay","courtenay-ca","CA"], ["Sooke","sooke-ca","CA"],
  ["Nyon","nyon-ch","CH"], ["Winterthur","winterthur-ch","CH"], ["Chur","chur-ch","CH"],
  ["Montreux","montreux-ch","CH"], ["Lugano","lugano-ch","CH"], ["Luzern","luzern-ch","CH"],
  ["Paphos","paphos-cy","CY"], ["Kyrenia","kyrenia-cy","CY"], ["Mórfou","mórfou-cy","CY"], ["Tábor","tábor-cz","CZ"],
  ["Strakonice","strakonice-cz","CZ"], ["Jindřichův Hradec","jindřichův-hradec-cz","CZ"],
  ["Pilsen","pilsen-cz","CZ"], ["Benešov","benešov-cz","CZ"], ["Karlovy Vary","karlovy-vary-cz","CZ"],
  ["Füssen","füssen-de","DE"], ["Garmisch-Partenkirchen","garmisch-partenkirchen-de","DE"],
  ["Baden-Baden","baden-baden-de","DE"], ["Burghausen","burghausen-de","DE"],
  ["Neustadt in Holstein","neustadt-in-holstein-de","DE"], ["Cuxhaven","cuxhaven-de","DE"],
  ["Frederikshavn","frederikshavn-dk","DK"], ["Hjørring","hjørring-dk","DK"], ["Esbjerg","esbjerg-dk","DK"],
  ["Roskilde","roskilde-dk","DK"], ["Herning","herning-dk","DK"], ["Viborg","viborg-dk","DK"],
  ["Ayamonte","ayamonte-es","ES"], ["La Orotava","la-orotava-es","ES"], ["Arona","arona-es","ES"],
  ["Ferrol","ferrol-es","ES"], ["Vilagarcía de Arousa","vilagarcía-de-arousa-es","ES"],
  ["Figueres","figueres-es","ES"], ["Antibes","antibes-fr","FR"], ["La Teste-de-Buch","la-teste-de-buch-fr","FR"],
  ["Ajaccio","ajaccio-fr","FR"], ["Fréjus","fréjus-fr","FR"], ["Agde","agde-fr","FR"], ["Sète","sète-fr","FR"],
  ["Chester","chester-gb","GB"], ["Colwyn Bay","colwyn-bay-gb","GB"], ["Newquay","newquay-gb","GB"],
  ["Blackpool","blackpool-gb","GB"], ["Weston-super-Mare","weston-super-mare-gb","GB"],
  ["Bangor","bangor-wales-gb","GB"], ["Dubrovnik","dubrovnik-hr","HR"], ["Pula","pula-hr","HR"],
  ["Zadar","zadar-hr","HR"], ["Bjelovar","bjelovar-hr","HR"], ["Galway","galway-ie","IE"],
  ["Kilkenny","kilkenny-ie","IE"], ["Limerick","limerick-ie","IE"], ["Sligo","sligo-ie","IE"],
  ["Ennis","ennis-ie","IE"], ["Drogheda","drogheda-ie","IE"], ["Verbania","verbania-it","IT"],
  ["Albenga","albenga-it","IT"], ["Mantua","mantua-it","IT"], ["Alghero","alghero-it","IT"],
  ["Acqui Terme","acqui-terme-it","IT"], ["Ōarai","ōarai-jp","JP"], ["Fujikawaguchiko","fujikawaguchiko-jp","JP"],
  ["Noboribetsu","noboribetsu-jp","JP"], ["Kariya","kariya-hyōgo-jp","JP"], ["Marugame","marugame-jp","JP"],
  ["Ishinomaki","ishinomaki-jp","JP"], ["Yangp'yŏng","yangp'yŏng-kr","KR"],
  ["Esch-sur-Alzette","esch-sur-alzette-lu","LU"], ["Middelburg","middelburg-nl","NL"], ["Sneek","sneek-nl","NL"],
  ["Hilversum","hilversum-nl","NL"], ["Breda","breda-nl","NL"], ["Leiden","leiden-nl","NL"],
  ["Hoogezand","hoogezand-nl","NL"], ["Skien","skien-no","NO"], ["Stavanger","stavanger-no","NO"],
  ["Tønsberg","tønsberg-no","NO"], ["Sandefjord","sandefjord-no","NO"], ["Bodø","bodø-no","NO"],
  ["Ålesund","ålesund-no","NO"], ["Masterton","masterton-nz","NZ"], ["Napier","napier-nz","NZ"],
  ["Dunedin","dunedin-nz","NZ"], ["Nelson","nelson-nz","NZ"], ["Taupo","taupo-nz","NZ"],
  ["Rotorua","rotorua-nz","NZ"], ["Santarém","santarém-pt","PT"], ["Aveiro","aveiro-pt","PT"],
  ["Figueira da Foz","figueira-da-foz-pt","PT"], ["Coimbra","coimbra-pt","PT"], ["Guimarães","guimarães-pt","PT"],
  ["Lagos","lagos-pt","PT"], ["Lund","lund-se","SE"], ["Maribor","maribor-si","SI"], ["Celje","celje-si","SI"],
  ["Santa Cruz","santa-cruz-us","US"], ["Sevierville","sevierville-us","US"], ["Key West","key-west-us","US"],
  ["San Rafael","san-rafael-us","US"], ["Knoxville","knoxville-us","US"], ["Bellingham","bellingham-us","US"],
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
