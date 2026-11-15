import { EMPTY_STATE, type FinderState } from "@/lib/advancedSearch/finder";
import type { RegionKey } from "@/lib/regions";

/**
 * "Find your Piltri" (2026-11-14, owner: "make it more fun, crazy, with
 * funny examples about situations ... should change all the time, same for
 * the result, let's not make it serious ... no skipping ... one way of
 * answering"). Nine themes, three situations each; a game draws eight
 * themes, one situation each, in a shuffled order, answers shuffled too.
 * Every answer is one tap, and an Advanced search choice underneath
 * (FinderState) - so the places that come out really fit. Some answers
 * rule nothing out ("Surprise me!"). An answer that would leave no place
 * is set aside with a note, never a dead end.
 */

export interface QuizAnswer {
  key: string;
  emoji: string;
  label: string;
  apply: (s: FinderState) => FinderState;
  /** Words for the "you are..." title: an adjective, a noun. */
  adj?: string;
  noun?: string;
}

export type QuizTheme = "who" | "where" | "weather" | "sun" | "nature" | "crowd" | "matters" | "language" | "moves";

export interface QuizQuestion {
  key: string;
  theme: QuizTheme;
  title: string;
  answers: QuizAnswer[];
}

type Change = (s: FinderState) => FinderState;
const none: Change = (s) => s;
const add =
  <K extends "regions" | "sizes" | "climate" | "nearby" | "strong" | "languages">(field: K, ...values: FinderState[K][number][]): Change =>
  (s) => ({ ...s, [field]: [...new Set([...s[field], ...values])] });
const region = (key: RegionKey): Change => add("regions", key);

const a = (key: string, emoji: string, label: string, apply: Change, words: { adj?: string; noun?: string } = {}): QuizAnswer => ({ key, emoji, label, apply, ...words });

const POOL: QuizQuestion[] = [
  // ---- Who's coming ----
  {
    key: "boxes",
    theme: "who",
    title: "Who's packing the moving boxes with you?",
    answers: [
      a("kids", "🧸", "Two kids, a hamster and a lot of noise", add("nearby", "school", "nursery"), { noun: "Family Captain" }),
      a("laptop", "💻", "Just me and my laptop", add("nearby", "fastInternet"), { noun: "Laptop Nomad" }),
      a("pension", "👵", "My partner and our well-earned pension", add("nearby", "hospital"), { noun: "Golden Explorer" }),
      a("free", "🎒", "Nobody. I'm a free spirit", none, { noun: "Free Spirit" }),
    ],
  },
  {
    key: "tuesday",
    theme: "who",
    title: "Your ideal Tuesday, 11am?",
    answers: [
      a("call", "☕", "A video call in pyjama bottoms", add("nearby", "fastInternet"), { noun: "Pyjama CEO" }),
      a("swing", "🛝", "Pushing a swing at the park", add("nearby", "school", "nursery"), { noun: "Playground Pro" }),
      a("lunch", "🧘", "A slow walk, then a very long lunch", add("nearby", "hospital"), { noun: "Slow Lifer" }),
      a("wild", "🎲", "Who knows? Adventure!", none, { noun: "Wildcard" }),
    ],
  },
  {
    key: "suitcase",
    theme: "who",
    title: "What's taking up most of your suitcase?",
    answers: [
      a("nappies", "🍼", "Nappies. So many nappies.", add("nearby", "school", "nursery"), { noun: "Super Parent" }),
      a("chargers", "🔌", "Three chargers and a backup router", add("nearby", "fastInternet"), { noun: "Wi-Fi Hunter" }),
      a("shoes", "👟", "Good walking shoes and a tidy pill box", add("nearby", "hospital"), { noun: "Wise Wanderer" }),
      a("swimsuit", "🩱", "A swimsuit and zero plans", none, { noun: "Holiday Maker" }),
    ],
  },
  // ---- Where in the world ----
  {
    key: "breakfast",
    theme: "where",
    title: "Pick your dream breakfast",
    answers: [
      a("croissant", "🥐", "A croissant and an espresso at the counter", region("europe"), { adj: "Café-Loving" }),
      a("pancakes", "🥞", "Pancakes drowning in maple syrup", region("northAmerica"), { adj: "Syrup-Soaked" }),
      a("mango", "🥭", "Fresh mango and warm arepas", region("latinAmerica"), { adj: "Tropical" }),
      a("noodles", "🍜", "Steaming noodles at a street stall", region("asia"), { adj: "Noodle-Slurping" }),
    ],
  },
  {
    key: "postcard",
    theme: "where",
    title: "Where does your next postcard come from?",
    answers: [
      a("cathedral", "🏛️", "A cobbled old town with a cathedral", region("europe"), { adj: "Old-Town" }),
      a("kangaroo", "🦘", "Somewhere with a kangaroo crossing sign", region("oceania"), { adj: "Down-Under" }),
      a("spices", "🐪", "A spice market at sunset", region("middleEast"), { adj: "Spice-Scented" }),
      a("savannah", "🦒", "A savannah with a giraffe photobombing", region("africa"), { adj: "Wild-Hearted" }),
    ],
  },
  {
    key: "soundtrack",
    theme: "where",
    title: "Which soundtrack plays when you arrive?",
    answers: [
      a("accordion", "🪗", "An accordion in a little square", region("europe"), { adj: "Romantic" }),
      a("samba", "🥁", "Drums from a samba school rehearsing", region("latinAmerica"), { adj: "Samba-Dancing" }),
      a("roadtrip", "🎸", "Country music on a long open road", region("northAmerica"), { adj: "Road-Tripping" }),
      a("surprise", "🌍", "Anything - surprise me!", none, { adj: "Globe-Trotting" }),
    ],
  },
  // ---- Weather ----
  {
    key: "february",
    theme: "weather",
    title: "It's February. Where are you?",
    answers: [
      a("terrace", "🩳", "On a terrace in shorts", add("climate", "warm"), { adj: "Sun-Kissed" }),
      a("flowers", "🌸", "In a light jacket, smelling the first flowers", add("climate", "mildWinters"), { adj: "Breezy" }),
      a("snowman", "⛄", "Building a snowman, cheeks bright red", none, { adj: "Frosty" }),
      a("magic22", "🌤️", "Wherever it's 22°C - my magic number", add("climate", "eternalSpring"), { adj: "Spring-Chasing" }),
    ],
  },
  {
    key: "summer",
    theme: "weather",
    title: "Your perfect summer afternoon?",
    answers: [
      a("sauna", "🔥", "35°C and an ice-cold drink - bring it on", add("climate", "warm"), { adj: "Heat-Seeking" }),
      a("breeze", "🍃", "24°C with a gentle breeze", add("climate", "mildSummers"), { adj: "Breezy" }),
      a("grey", "🌥️", "A cool grey day, honestly", add("climate", "mildSummers"), { adj: "Cool-Headed" }),
      a("shade", "🌳", "Don't care, I'll be in the shade", none, { adj: "Easy-Going" }),
    ],
  },
  {
    key: "coat",
    theme: "weather",
    title: "Your relationship with your winter coat?",
    answers: [
      a("whatcoat", "🧥", "What winter coat?", add("climate", "warm"), { adj: "Coat-Free" }),
      a("fewweeks", "🤝", "We see each other a few weeks a year", add("climate", "mildWinters"), { adj: "Mild-Mannered" }),
      a("favourite", "❤️", "It's my favourite outfit", none, { adj: "Cosy" }),
      a("balance", "⚖️", "Never too cold, never too hot, please", add("climate", "eternalSpring"), { adj: "Perfectly Balanced" }),
    ],
  },
  // ---- Sun and rain ----
  {
    key: "sunfriends",
    theme: "sun",
    title: "The sun and you are...",
    answers: [
      a("bff", "😎", "Best friends forever", add("climate", "sunny"), { adj: "Sun-Worshipping" }),
      a("umbrella", "☂️", "Friends - but I hate umbrellas", add("climate", "sunny", "dry"), { adj: "Umbrella-Free" }),
      a("rain", "🌧️", "Rain is my love language", none, { adj: "Rain-Loving" }),
      a("clouds", "🌫️", "Moody clouds look better in photos", none, { adj: "Moody" }),
    ],
  },
  {
    key: "lizard",
    theme: "sun",
    title: "Pick a lazy Sunday",
    answers: [
      a("lizard", "🦎", "Tanning like a lizard on a rock", add("climate", "sunny"), { adj: "Lizard-Like" }),
      a("hills", "🌵", "Hiking dry golden hills", add("climate", "dry"), { adj: "Dusty-Booted" }),
      a("window", "📚", "Reading by a rainy window", none, { adj: "Bookish" }),
      a("bed", "🛌", "Bed. All day. Weather irrelevant.", none, { adj: "Sleepy" }),
    ],
  },
  {
    key: "snow",
    theme: "sun",
    title: "Snow outside your window. Your reaction?",
    answers: [
      a("never", "🙅", "Absolutely not. Never again.", add("climate", "noSnow"), { adj: "Snow-Dodging" }),
      a("snowday", "😍", "Snow day = best day", none, { adj: "Snow-Loving" }),
      a("sunplease", "☀️", "Just give me sunshine", add("climate", "sunny"), { adj: "Sunny" }),
      a("photo", "📸", "Lovely - for one photo", add("climate", "noSnow"), { adj: "Picture-Perfect" }),
    ],
  },
  // ---- Nature ----
  {
    key: "saturday",
    theme: "nature",
    title: "Saturday, 9am. You're...",
    answers: [
      a("sea", "🏄", "Already in the sea", add("nearby", "beach"), { noun: "Beach Bum" }),
      a("mountain", "🥾", "Halfway up a mountain", add("nearby", "mountains"), { noun: "Mountain Goat" }),
      a("lake", "🛶", "Paddling on a quiet lake", add("nearby", "lakeBeach"), { noun: "Lake Dreamer" }),
      a("forest", "🌲", "In a forest, coffee in hand", add("nearby", "forest"), { noun: "Forest Whisperer" }),
    ],
  },
  {
    key: "view",
    theme: "nature",
    title: "Choose the view from your window",
    answers: [
      a("waves", "🌊", "Waves, waves, waves", add("nearby", "beach"), { noun: "Wave Watcher" }),
      a("peaks", "🏔️", "Snowy peaks", add("nearby", "mountains"), { noun: "Peak Bagger" }),
      a("trees", "🌳", "Trees as far as the eye can see", add("nearby", "forest"), { noun: "Tree Hugger" }),
      a("lights", "🏙️", "Rooftops and city lights", none, { noun: "City Owl" }),
    ],
  },
  {
    key: "picnic",
    theme: "nature",
    title: "Where's the perfect picnic?",
    answers: [
      a("sand", "🏝️", "On the sand, obviously", add("nearby", "beach"), { noun: "Sandcastle Architect" }),
      a("ducks", "🦆", "By a lake, sharing with the ducks", add("nearby", "lakeBeach"), { noun: "Duck Diplomat" }),
      a("summit", "⛰️", "On a summit - earned, not given", add("nearby", "mountains"), { noun: "Summit Snacker" }),
      a("balcony", "🍷", "On my balcony. Nature is overrated.", none, { noun: "Balcony Philosopher" }),
    ],
  },
  // ---- Crowds ----
  {
    key: "crowd",
    theme: "crowd",
    title: "What's a crowd, to you?",
    answers: [
      a("cows", "🐄", "More than three cows", add("sizes", "village"), { noun: "Village Sage" }),
      a("market", "🧺", "The Saturday market", add("sizes", "town"), { noun: "Market Regular" }),
      a("cinema", "🎬", "A full cinema on a Friday night", add("sizes", "smallCity", "city"), { noun: "Popcorn Critic" }),
      a("rush", "🚇", "Rush hour on the metro - I live for it", add("sizes", "big"), { noun: "Big-City Legend" }),
    ],
  },
  {
    key: "neighbours",
    theme: "crowd",
    title: "How many neighbours do you want?",
    answers: [
      a("rooster", "🐓", "A few. And a rooster.", add("sizes", "village"), { noun: "Rooster Whisperer" }),
      a("baker", "🥖", "Enough to know the baker by name", add("sizes", "town"), { noun: "Baker's Favourite" }),
      a("theatre", "🎭", "Enough for a theatre and a good burger", add("sizes", "smallCity", "city"), { noun: "Culture Vulture" }),
      a("millions", "🌆", "Millions, and a skyline", add("sizes", "big"), { noun: "Skyline Collector" }),
    ],
  },
  {
    key: "nightlife",
    theme: "crowd",
    title: "Pick your nightlife",
    answers: [
      a("owls", "🦉", "Owls and stars", add("sizes", "village"), { noun: "Stargazer" }),
      a("pub", "🍺", "One cosy pub everyone goes to", add("sizes", "town"), { noun: "Local Legend" }),
      a("jazz", "🎷", "A jazz bar and a couple of clubs", add("sizes", "smallCity", "city"), { noun: "Jazz Cat" }),
      a("sunrise", "🪩", "Open until sunrise. Every night.", add("sizes", "big"), { noun: "Night Owl" }),
    ],
  },
  // ---- What matters most ----
  {
    key: "headline",
    theme: "matters",
    title: "Which headline would make your day?",
    answers: [
      a("safest", "🛡️", "\"Safest town in the country - again\"", add("strong", "safety"), { adj: "Safe-and-Sound" }),
      a("jobs", "📈", "\"Local start-up hires 500 people\"", add("strong", "economy"), { adj: "Go-Getting" }),
      a("air", "🍃", "\"Cleanest air in years\"", add("strong", "environment"), { adj: "Fresh-Air" }),
      a("tram", "🚋", "\"New tram line and hospital open\"", add("strong", "life"), { adj: "Well-Connected" }),
    ],
  },
  {
    key: "superpower",
    theme: "matters",
    title: "Your superpower would be...",
    answers: [
      a("bike", "🔓", "Never having to lock my bike", add("strong", "safety"), { adj: "Carefree" }),
      a("salary", "💸", "A salary that goes a long way", add("strong", "economy"), { adj: "Money-Wise" }),
      a("lungs", "🌿", "Lungs full of fresh air", add("strong", "environment"), { adj: "Green" }),
      a("fifteen", "⏱️", "Everything within 15 minutes", add("strong", "life"), { adj: "Organised" }),
    ],
  },
  {
    key: "nocompromise",
    theme: "matters",
    title: "What will you never, ever compromise on?",
    answers: [
      a("2am", "🌙", "Feeling safe walking home at 2am", add("strong", "safety"), { adj: "Night-Walking" }),
      a("career", "💼", "My career", add("strong", "economy"), { adj: "Ambitious" }),
      a("nature", "🌳", "Nature and clean air", add("strong", "environment"), { adj: "Nature-Loving" }),
      a("everyday", "🏥", "Good doctors, good trains, good wi-fi", add("strong", "life"), { adj: "Practical" }),
    ],
  },
  // ---- Language ----
  {
    key: "languagegame",
    theme: "language",
    title: "How's your language game?",
    answers: [
      a("english", "🗣️", "English only, sorry", add("languages", "English"), { adj: "English-Speaking" }),
      a("spanish", "💃", "¡Hola! I can manage", add("languages", "Spanish"), { adj: "Olé" }),
      a("french", "🥖", "Je parle un peu français", add("languages", "French"), { adj: "Très Chic" }),
      a("hands", "🤌", "I'll talk with my hands", none, { adj: "Expressive" }),
    ],
  },
  {
    key: "bakery",
    theme: "language",
    title: "Which word do you want to hear at the bakery?",
    answers: [
      a("hello", "👋", "\"Hello!\"", add("languages", "English"), { adj: "Friendly" }),
      a("bonjour", "🥐", "\"Bonjour !\"", add("languages", "French"), { adj: "Croissant-Fuelled" }),
      a("ola", "🌞", "\"Olá!\"", add("languages", "Portuguese"), { adj: "Saudade-Filled" }),
      a("hallo", "🥨", "\"Hallo!\"", add("languages", "German"), { adj: "Pretzel-Powered" }),
    ],
  },
  {
    key: "movie",
    theme: "language",
    title: "Pick tonight's movie",
    answers: [
      a("blockbuster", "🍿", "A blockbuster, no subtitles", add("languages", "English"), { adj: "Blockbuster" }),
      a("telenovela", "💔", "A telenovela with maximum drama", add("languages", "Spanish"), { adj: "Dramatic" }),
      a("frenchfilm", "🚬", "A French film where nothing happens", add("languages", "French"), { adj: "Existential" }),
      a("pasta", "🍝", "An Italian classic, extra pasta", add("languages", "Italian"), { adj: "Pasta-Powered" }),
    ],
  },
  // ---- Getting around ----
  {
    key: "getaround",
    theme: "moves",
    title: "How do you get around?",
    answers: [
      a("trains", "🚆", "Trains. I love trains.", add("nearby", "train"), { noun: "Train Spotter" }),
      a("metro", "🚇", "Metro maps are my art", add("nearby", "metro"), { noun: "Metro Mole" }),
      a("plane", "✈️", "An airport within the hour, always", add("nearby", "intlAirport"), { noun: "Jet-Setter" }),
      a("legs", "🚲", "My bike and my legs", none, { noun: "Pedal Pusher" }),
    ],
  },
  {
    key: "escape",
    theme: "moves",
    title: "Friday, 6pm. Time to escape. How?",
    answers: [
      a("flight", "🛫", "Cheap flight to anywhere", add("nearby", "intlAirport"), { noun: "Weekend Escapist" }),
      a("train2", "🚄", "A train with a window seat", add("nearby", "train"), { noun: "Window-Seat Poet" }),
      a("ferry", "⛴️", "A ferry to an island", add("nearby", "port"), { noun: "Island Hopper" }),
      a("stay", "🛋️", "Escape? I'm staying right here.", none, { noun: "Homebody" }),
    ],
  },
  {
    key: "commute",
    theme: "moves",
    title: "Your dream commute?",
    answers: [
      a("tram", "🚋", "A rattling old tram", add("nearby", "tram"), { noun: "Tram Romantic" }),
      a("metro2", "🚇", "Seven stops on the metro", add("nearby", "metro"), { noun: "Underground Hero" }),
      a("trainbook", "📖", "A train ride and a good book", add("nearby", "train"), { noun: "Rail Reader" }),
      a("walk", "🚶", "A ten-minute walk", none, { noun: "Stroller" }),
    ],
  },
];

const shuffle = <T,>(xs: T[], rand: () => number): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** A new game: eight of the nine themes - always where, weather, nature and
 *  crowds - one situation each, shuffled, answers shuffled. */
export function drawQuiz(rand: () => number = Math.random): QuizQuestion[] {
  const themes = [...new Set(POOL.map((q) => q.theme))];
  const core: QuizTheme[] = ["where", "weather", "nature", "crowd"];
  const others = shuffle(themes.filter((t) => !core.includes(t)), rand).slice(0, 4);
  return shuffle([...core, ...others], rand).map((theme) => {
    const options = POOL.filter((q) => q.theme === theme);
    const q = options[Math.floor(rand() * options.length)];
    return { ...q, answers: shuffle(q.answers, rand) };
  });
}

export const QUIZ_START: FinderState = EMPTY_STATE;
export const QUIZ_LENGTH = 8;

const pick = <T,>(xs: T[], rand: () => number) => xs[Math.floor(rand() * xs.length)];

/** "You're the Sun-Kissed Beach Bum" - from the answers' words. */
export function personaTitle(chosen: QuizAnswer[], rand: () => number = Math.random): string {
  const adjs = chosen.map((c) => c.adj).filter(Boolean) as string[];
  const nouns = chosen.map((c) => c.noun).filter(Boolean) as string[];
  const adj = adjs.length ? pick(adjs, rand) : pick(["Curious", "Daring", "Dreamy"], rand);
  const noun = nouns.length ? pick(nouns, rand) : pick(["Explorer", "Wanderer", "Adventurer"], rand);
  return `the ${adj} ${noun}`;
}

export const RESULT_INTROS = [
  "The universe - and 147,000 places - has spoken.",
  "We asked the places. They said yes.",
  "Drumroll, please...",
  "Pack light. These were made for you.",
  "Your future postman doesn't know it yet.",
  "Plot twist: you've already found it.",
];

export const PLACE_LINES = [
  "Your new favourite café is around the corner.",
  "The locals don't know you're coming yet.",
  "Suspiciously perfect.",
  "Your mum would approve.",
  "10/10, would move again.",
  "The sunsets alone are worth it.",
  "Already picturing your doormat here.",
  "This one winked at you.",
  "A strong contender. A very strong one.",
  "Your plants will love it.",
];

export const SET_ASIDE_NOTES = [
  "That combination doesn't exist on Earth - we'll pretend you didn't say it.",
  "Not even we could find that one. Answer set aside, the rest kept.",
  "Too picky, even for us. We kept everything else.",
];

export const pickOne = pick;
