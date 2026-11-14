import { EMPTY_STATE, type FinderState } from "@/lib/advancedSearch/finder";
import type { RegionKey } from "@/lib/regions";

/**
 * "Find your Piltri" (2026-11-14, owner - BACKLOG 15 / P2): a few questions,
 * then the places that fit. Each answer is a change to an Advanced search
 * (FinderState), so the results are Advanced search's - "See all" opens it
 * with the answers filled in. An answer that would leave no place at all is
 * set aside (the page says so), never a dead end. Answers only narrow the
 * places down: the order is always the Piltri score shown beside them (a
 * first try re-sorted by safety, and #1 showed 72 above #2's 76).
 */

export interface QuizOption {
  key: string;
  label: string;
  hint?: string;
  /** What choosing it changes. */
  apply: (s: FinderState) => FinderState;
}

export interface QuizQuestion {
  key: string;
  title: string;
  /** Several answers can be picked (they add up: any of the regions, all
   *  of the places nearby...). */
  multi?: boolean;
  options: QuizOption[];
}

const add = <K extends "regions" | "sizes" | "climate" | "nearby" | "strong" | "languages">(field: K, value: FinderState[K][number]) => (s: FinderState): FinderState =>
  s[field].includes(value as never) ? s : { ...s, [field]: [...s[field], value] };
const both = (...fs: ((s: FinderState) => FinderState)[]) => (s: FinderState) => fs.reduce((acc, f) => f(acc), s);
const region = (key: RegionKey, label: string): QuizOption => ({ key, label, apply: add("regions", key) });

export const QUIZ: QuizQuestion[] = [
  {
    key: "purpose",
    title: "What are you looking for?",
    options: [
      { key: "newLife", label: "A new life", hint: "somewhere to move to", apply: (s) => s },
      { key: "family", label: "A home for my family", hint: "schools and nurseries in town", apply: both(add("nearby", "school"), add("nearby", "nursery")) },
      { key: "retire", label: "Somewhere to retire", hint: "a hospital in town", apply: add("nearby", "hospital") },
      { key: "remote", label: "A base for remote work", hint: "fast internet", apply: add("nearby", "fastInternet") },
      { key: "holidays", label: "Holidays", hint: "strong on nature and climate", apply: add("strong", "environment") },
    ],
  },
  {
    key: "where",
    title: "Where in the world?",
    multi: true,
    options: [
      region("europe", "Europe"),
      region("northAmerica", "North America"),
      region("latinAmerica", "Latin America"),
      region("asia", "Asia"),
      region("oceania", "Oceania"),
      region("middleEast", "Middle East"),
      region("africa", "Africa"),
    ],
  },
  {
    key: "weather",
    title: "What weather makes you happy?",
    options: [
      { key: "warm", label: "Warm all year", hint: "18°C+ on average", apply: add("climate", "warm") },
      { key: "spring", label: "Spring all year", hint: "never cold, never too hot", apply: add("climate", "eternalSpring") },
      { key: "mildWinters", label: "Mild winters", hint: "nights above 5°C", apply: add("climate", "mildWinters") },
      { key: "notHot", label: "Never too hot", hint: "summer days under 30°C", apply: add("climate", "mildSummers") },
    ],
  },
  {
    key: "sun",
    title: "How much sunshine?",
    options: [
      { key: "lots", label: "Lots, please", hint: "2,500+ hours a year", apply: add("climate", "sunny") },
      { key: "dry", label: "Lots, and little rain", hint: "sunny and dry", apply: both(add("climate", "sunny"), add("climate", "dry")) },
    ],
  },
  {
    key: "nearby",
    title: "What would you like close by?",
    multi: true,
    options: [
      { key: "beach", label: "A beach", apply: add("nearby", "beach") },
      { key: "lake", label: "A lake", apply: add("nearby", "lakeBeach") },
      { key: "mountains", label: "Mountains", apply: add("nearby", "mountains") },
      { key: "forest", label: "A forest", apply: add("nearby", "forest") },
      { key: "airport", label: "An international airport", apply: add("nearby", "intlAirport") },
      { key: "train", label: "A train station", apply: add("nearby", "train") },
    ],
  },
  {
    key: "size",
    title: "What size of place?",
    multi: true,
    options: [
      { key: "village", label: "A village", hint: "under 10,000", apply: add("sizes", "village") },
      { key: "town", label: "A town", hint: "10,000-50,000", apply: add("sizes", "town") },
      { key: "smallCity", label: "A small city", hint: "50,000-100,000", apply: add("sizes", "smallCity") },
      { key: "city", label: "A city", hint: "100,000-500,000", apply: add("sizes", "city") },
      { key: "big", label: "A big city", hint: "500,000+", apply: add("sizes", "big") },
    ],
  },
  {
    key: "matters",
    title: "What matters most to you?",
    options: [
      { key: "safety", label: "Feeling safe", apply: add("strong", "safety") },
      { key: "economy", label: "A strong economy", hint: "jobs, salaries", apply: add("strong", "economy") },
      { key: "environment", label: "Nature and clean air", apply: add("strong", "environment") },
      { key: "life", label: "Everyday life", hint: "health, transport, things to do", apply: add("strong", "life") },
      { key: "balance", label: "A bit of everything", apply: (s) => s },
    ],
  },
  {
    key: "language",
    title: "Which language would you like to get by in?",
    multi: true,
    options: ["English", "Spanish", "French", "Portuguese", "German", "Italian"].map((l) => ({ key: l, label: l, apply: add("languages", l) })),
  },
];

export const QUIZ_START: FinderState = EMPTY_STATE;
