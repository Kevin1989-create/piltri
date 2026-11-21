"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cityIdFor } from "@/lib/dataset/schema";
import { cityUrl } from "@/lib/urls";

/** "Today, let's try" (2026-11-21, owner: "make it a daily thing with
 *  different cities every morning"): five places a day, the next five at
 *  local midnight, round a fixed list. Every one checked against the
 *  dataset's search index (2026-11-21) - plain ids, so the largest place of
 *  that name in its country. The list is shuffled once, with a fixed seed,
 *  so neighbouring days mix continents. */
const PLACES = [
  "Lisbon|PT", "Kyoto|JP", "Austin|US", "Annecy|FR", "Cape Town|ZA", "Porto|PT", "Valencia|ES", "Bologna|IT",
  "Ljubljana|SI", "Tallinn|EE", "Copenhagen|DK", "Bergen|NO", "Edinburgh|GB", "Galway|IE", "Utrecht|NL", "Salzburg|AT",
  "Luzern|CH", "Kraków|PL", "Budapest|HU", "Split|HR", "Valletta|MT", "Montréal|CA", "Vancouver|CA", "Québec|CA",
  "Portland|US", "Asheville|US", "Santa Fe|US", "Boulder|US", "Honolulu|US", "Mexico City|MX", "Medellín|CO", "Cusco|PE",
  "Valparaíso|CL", "Montevideo|UY", "Buenos Aires|AR", "Florianópolis|BR", "Marrakesh|MA", "Tbilisi|GE", "Istanbul|TR",
  "Dubai|AE", "Chiang Mai|TH", "Hoi An|VN", "George Town|MY", "Singapore|SG", "Seoul|KR", "Taipei|TW", "Fukuoka|JP",
  "Hobart|AU", "Melbourne|AU", "Wellington|NZ", "Queenstown|NZ", "Kigali|RW", "Windhoek|NA", "Reykjavík|IS", "Nice|FR",
  "Bordeaux|FR", "Lyon|FR", "Munich|DE", "Vienna|AT", "Prague|CZ", "Zürich|CH", "Oslo|NO", "Stockholm|SE", "Helsinki|FI",
  "Amsterdam|NL", "Barcelona|ES", "Naples|IT", "Florence|IT", "Athens|GR", "Dubrovnik|HR", "Sarajevo|BA",
  "Rio de Janeiro|BR", "Lima|PE", "Bogotá|CO", "Havana|CU", "San Diego|US", "Savannah|US", "Halifax|CA", "Nairobi|KE",
  "Zanzibar|TZ", "Accra|GH", "Dakar|SN", "Tunis|TN", "Muscat|OM", "Kathmandu|NP", "Colombo|LK", "Luang Prabang|LA",
  "Hanoi|VN", "Denpasar|ID", "Sapporo|JP", "Busan|KR", "Perth|AU", "Auckland|NZ",
];
const PER_DAY = 5;

/** A fixed shuffle (mulberry32, constant seed): the same order for everyone. */
const ORDER = (() => {
  let seed = 20261121;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...PLACES];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
})();

function todaysPicks(now: Date): { name: string; id: string }[] {
  // Days since the epoch in the visitor's own time zone: new picks at their midnight.
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
  return Array.from({ length: PER_DAY }, (_, k) => {
    const [name, cc] = ORDER[(day * PER_DAY + k) % ORDER.length].split("|");
    return { name, id: cityIdFor(name, cc) };
  });
}

export function DailyPicks({ chipClassName, lastClassName }: { chipClassName: string; lastClassName?: string }) {
  // Picked in the browser, after the first paint: the page is built once on
  // the server, and the day is the visitor's.
  const [picks, setPicks] = useState<{ name: string; id: string }[] | null>(null);
  useEffect(() => setPicks(todaysPicks(new Date())), []);
  return (
    <>
      {(picks ?? Array.from({ length: PER_DAY }, (_, k) => ({ name: "", id: `slot-${k}` }))).map(({ name, id }, k) =>
        picks ? (
          <Link key={id} href={cityUrl(id)} className={k === PER_DAY - 1 && lastClassName ? `${chipClassName} ${lastClassName}` : chipClassName}>
            {name}
          </Link>
        ) : (
          // Same size while the day's picks load, so nothing below moves.
          <span key={id} aria-hidden className={`${chipClassName} invisible w-16 ${k === PER_DAY - 1 && lastClassName ? lastClassName : ""}`}>
            &nbsp;
          </span>
        )
      )}
    </>
  );
}
