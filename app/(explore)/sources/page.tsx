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

/** A short sample of each kind of outline the city map draws, in its
 *  colours: an official boundary (solid), a built-up area (dashed), the
 *  5 km circle. */
function OutlineSample({ kind }: { kind: "border" | "builtUp" | "circle" }) {
  return (
    <svg viewBox="0 0 40 24" className="w-10 h-6 flex-shrink-0 mt-0.5" aria-hidden>
      {kind === "circle" ? (
        <circle cx="20" cy="12" r="9.5" fill="#E3B27A" fillOpacity="0.22" stroke="#96600F" strokeWidth="2" />
      ) : (
        <path
          d="M4 15 C 8 5, 15 4, 20 7 S 32 3, 36 10 S 30 21, 20 19 S 6 21, 4 15 Z"
          fill="#E3B27A"
          fillOpacity="0.22"
          stroke="#96600F"
          strokeWidth="2"
          strokeDasharray={kind === "builtUp" ? "4 3" : undefined}
        />
      )}
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
                  <span className="font-medium text-ink-900">Local means within 5 km.</span> Restaurants, parks, density,
                  schools and the other local figures cover 5 km around the town centre.
                </li>
              </ul>
            </Section>

            {/* The map's outlines aren't all borders (2026-10-01, on request:
             *  "make sure there isn't any confusion"); the map's note on a
             *  built-up area links here. */}
            <Section id="map-outlines" title="Outlines on the map">
              <ul className="divide-y divide-surface-border text-sm text-ink-700 leading-relaxed">
                <li className="flex gap-3 px-5 py-3">
                  <OutlineSample kind="border" />
                  <p>
                    <span className="font-medium text-ink-900">Solid line: the official boundary.</span> The town&apos;s
                    administrative boundary, from OpenStreetMap via Overture Maps.
                  </p>
                </li>
                <li className="flex gap-3 px-5 py-3">
                  <OutlineSample kind="builtUp" />
                  <p>
                    <span className="font-medium text-ink-900">Dashed line: the built-up area (approximate).</span> Where the
                    open map data has no boundary for the town itself - common in India, China, Vietnam, Pakistan and South
                    Africa, where only much larger districts are mapped - the outline shows where the town is actually built up:
                    the continuous area around its centre with at least about 300 people per km² (up to 1,500 in dense
                    cities), from a population grid of about 1 km squares. An estimate, not a legal border, accurate to about a
                    kilometre.
                  </p>
                </li>
                <li className="flex gap-3 px-5 py-3">
                  <OutlineSample kind="circle" />
                  <p>
                    <span className="font-medium text-ink-900">Circle: 5 km around the centre.</span> For very sparse places,
                    where neither is available.
                  </p>
                </li>
              </ul>
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
              in St. Louis. Population: European Commission, Joint Research Centre, GHSL.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
