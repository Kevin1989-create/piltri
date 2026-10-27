import type { ReactNode } from "react";
import { BackLink } from "@/components/ui/BackLink";
import { NavBar } from "@/components/ui/NavBar";
import { manifest } from "@/lib/dataset/files";

export const metadata = { title: "Data & Sources — Piltri" };

/** The dataset's sources (manifest.sources), by topic, with the name each
 *  is shown under. A source the list doesn't know yet goes under "Other". */
const GROUPS: { title: string; sources: Record<string, string> }[] = [
  {
    title: "People & places",
    sources: {
      shortlist: "Places",
      density: "Population density",
      country: "Country statistics",
      languages: "Official languages",
    },
  },
  {
    // Local versions of country figures (2026-10-24, phase 1).
    title: "Local figures",
    sources: {
      regionGdp: "Regional GDP per head",
      populationGrowth: "Population growth",
      age: "Average age",
      conflict: "Armed conflict nearby",
      hospitals: "Nearest hospital",
    },
  },
  {
    title: "Climate & environment",
    sources: {
      climate: "Climate",
      climateType: "Climate type",
      uv: "UV index",
      airQuality: "Air pollution",
      earthquakes: "Earthquakes",
      elevation: "Elevation",
      coast: "Coast & beaches",
      mountains: "Mountains",
    },
  },
  {
    title: "Amenities & connectivity",
    sources: {
      places: "Amenities & transport",
      airports: "Airports",
      internet: "Internet speed",
    },
  },
  {
    title: "Maps",
    sources: {
      outlines: "Town boundaries",
      builtUp: "Built-up areas",
    },
  },
];

/** A sample of the city map's outline, in its colours - every outline is
 *  drawn this way, whatever it comes from. */
function OutlineSample() {
  return (
    <svg viewBox="0 0 40 24" className="w-10 h-6 flex-shrink-0 mt-0.5" aria-hidden>
      <rect width="40" height="24" rx="4" fill="#EDE7DC" />
      <path d="M4 15 C 8 5, 15 4, 20 7 S 32 3, 36 10 S 30 21, 20 19 S 6 21, 4 15 Z" fill="#FBF3E8" stroke="#FFFFFF" strokeWidth="4" strokeLinejoin="round" />
      <path d="M4 15 C 8 5, 15 4, 20 7 S 32 3, 36 10 S 30 21, 20 19 S 6 21, 4 15 Z" fill="none" stroke="#96600F" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** One block of the page: a small heading, then a bordered card - the same
 *  look as the Settings pages. */
function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-500 mb-2">{title}</h2>
      <div className="rounded-card border border-surface-border bg-surface">{children}</div>
    </section>
  );
}

/** A source: what it's for on the left, where it comes from on the right
 *  (stacked on phones). */
function SourceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-5 py-3 grid sm:grid-cols-[170px_1fr] gap-x-4 gap-y-0.5">
      <dt className="text-sm font-medium text-ink-900">{label}</dt>
      <dd className="text-sm text-ink-700 leading-relaxed">{children}</dd>
    </div>
  );
}

/** Every source behind the numbers, with its licence - the attribution most
 *  of these licences (CC BY, ODbL) require, in one public place. Built from
 *  the dataset's own manifest, so it always matches the data being served.
 *  Laid out as the Settings pages are (2026-10-01, on request: "cleaner and
 *  clearer"): key facts, how the data is used, the map outlines, then the
 *  sources by topic and the credits. */
export default function SourcesPage() {
  const built = new Date(manifest.generatedAt).toLocaleDateString("en-GB", { dateStyle: "medium" });
  const sources = manifest.sources;
  const known = new Set(GROUPS.flatMap((g) => Object.keys(g.sources)));
  const other = Object.keys(sources).filter((key) => !known.has(key));

  return (
    <main className="min-h-dvh flex flex-col">
      <NavBar logoSide="left" border={false} />
      <div className="px-4 sm:px-6 pt-6 sm:pt-10 pb-16">
        <div className="max-w-2xl mx-auto">
          <BackLink />
          <h1 className="font-serif text-3xl text-ink-900 mt-2">Data &amp; Sources</h1>

          {/* Key facts. */}
          <div className="mt-6 grid grid-cols-3 rounded-card border border-surface-border divide-x divide-surface-border text-center">
            {[
              [manifest.cityCount.toLocaleString("en-GB"), "places"],
              [String(manifest.countryCount), "countries"],
              [built, "updated monthly"],
            ].map(([value, label]) => (
              <div key={label} className="px-2 py-3">
                <p className="font-serif text-base sm:text-xl text-ink-900 leading-tight">{value}</p>
                <p className="text-[11px] text-ink-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 space-y-8">
            <Section title="How we use data">
              <ul className="py-4 pr-5 pl-9 space-y-2.5 text-sm text-ink-700 leading-relaxed list-disc marker:text-piltri-amber">
                <li>
                  <span className="font-medium text-ink-900">Free, open data only.</span> Every figure is computed from
                  openly licensed datasets - nothing is bought or estimated by hand.
                </li>
                <li>
                  <span className="font-medium text-ink-900">Estimates are labelled.</span> Sunshine, snowfall, UV index, flood
                  exposure and drive times are calculated estimates; each figure&apos;s &quot;i&quot; says how it&apos;s made and
                  where it comes from.
                </li>
                <li>
                  <span className="font-medium text-ink-900">Local figures, or none.</span> Where a place has its own
                  figure - its region&apos;s GDP, its average age, armed conflict nearby - it&apos;s shown under the place&apos;s
                  name. Where it hasn&apos;t, it says &quot;No data&quot; and the country&apos;s figure is shown below it: a
                  country figure is never passed off as a local one, and missing figures aren&apos;t estimated.
                </li>
                <li>
                  <span className="font-medium text-ink-900">Local means within 5 km.</span> Restaurants, parks, density,
                  schools and the other local figures cover 5 km around the town centre.
                </li>
              </ul>
            </Section>

            {/* Where the map's outline comes from. Every outline looks the same on
             *  the map (2026-10-14, on request); this says what each one is. */}
            <Section id="map-outlines" title="Outlines on the map">
              <div className="flex gap-3 px-5 py-4 text-sm text-ink-700 leading-relaxed">
                <OutlineSample />
                <div className="space-y-2">
                  <p>Every place gets one outline, drawn the same way. It comes from, in order:</p>
                  <ol className="list-decimal pl-4 space-y-1.5">
                    <li>
                      <span className="font-medium text-ink-900">The official boundary</span> - the town&apos;s
                      administrative boundary, from OpenStreetMap via Overture Maps.
                    </li>
                    <li>
                      <span className="font-medium text-ink-900">The built-up area</span>, where the open map data has no
                      boundary for the town itself - common in India, China, Vietnam, Pakistan and South Africa, where only
                      much larger districts are mapped, and in a few big cities such as London: the continuous area around its
                      centre with at least about 300 people per km² (up to 1,500 in dense cities), from a population grid of
                      about 1 km squares, with the parks, lakes and open land it surrounds counted in. An estimate, accurate
                      to about a kilometre.
                    </li>
                    <li>
                      <span className="font-medium text-ink-900">5 km around the centre</span>, for very sparse places where
                      neither is available.
                    </li>
                  </ol>
                </div>
              </div>
            </Section>

            {/* The one live service: road journeys (2026-10-16, on request). */}
            <Section title="Journeys on the map">
              <p className="px-5 py-4 text-sm text-ink-700 leading-relaxed">
                Tap a distance - to the beach, the airport, a station - and the map draws the journey along the roads, from
                the{" "}
                <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-piltri-amber-dark">
                  OpenStreetMap community&apos;s routing server
                </a>{" "}
                (OSRM, run by FOSSGIS), walking for up to 2 km and driving beyond. If it can&apos;t answer, a straight line is
                drawn instead. The distances in the sections themselves are straight-line, with estimated travel times.
              </p>
            </Section>

            {GROUPS.map((group) => {
              const rows = Object.entries(group.sources).filter(([key]) => sources[key]);
              const isMaps = group.title === "Maps";
              if (!rows.length && !isMaps) return null;
              return (
                <Section key={group.title} title={group.title}>
                  <dl className="divide-y divide-surface-border">
                    {rows.map(([key, label]) => (
                      <SourceRow key={key} label={label}>
                        {sources[key]}
                      </SourceRow>
                    ))}
                    {isMaps && (
                      <SourceRow label="Map tiles">
                        © OpenStreetMap contributors (ODbL), OpenMapTiles, served by OpenFreeMap; rendered with MapLibre GL.
                      </SourceRow>
                    )}
                  </dl>
                </Section>
              );
            })}

            <Section title="Other">
              <dl className="divide-y divide-surface-border">
                {other.map((key) => (
                  <SourceRow key={key} label={key}>
                    {sources[key]}
                  </SourceRow>
                ))}
                <SourceRow label="Photos">Wikipedia / Wikimedia Commons lead images, under their own licences.</SourceRow>
              </dl>
            </Section>
          </div>

          <div className="mt-8 space-y-2 text-xs text-ink-500 leading-relaxed">
            {sources.internet && (
              <p>
                Speedtest® by Ookla® Global Fixed and Mobile Network Performance Maps. Based on analysis by Ookla of Speedtest
                Intelligence® data. Provided by Ookla. Ookla trademarks used under license and reprinted with permission.
              </p>
            )}
            <p>
              Health data: World Health Organization, data.who.int, UHC service coverage index. Köppen-Geiger maps: Beck, H. E.
              et al., Scientific Data 10, 724 (2023). Air quality: Atmospheric Composition Analysis Group, Washington University
              in St. Louis. Population: European Commission, Joint Research Centre, GHSL. Age structures: WorldPop
              (www.worldpop.org), University of Southampton. Regional GDP: Kummu, M. et al., Scientific Data (2025). Armed
              conflict: Uppsala Conflict Data Program, Georeferenced Event Dataset (Sundberg &amp; Melander, Journal of Peace
              Research, 2013).
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
