import { BackLink } from "@/components/ui/BackLink";
import { NavBar } from "@/components/ui/NavBar";
import { manifest } from "@/lib/dataset/files";

export const metadata = { title: "Data & Sources — Piltri" };

const LABELS: Record<string, string> = {
  shortlist: "Places",
  country: "Country statistics",
  climate: "Climate",
  climateType: "Climate type",
  uv: "UV index",
  airQuality: "Air pollution",
  density: "Population density",
  internet: "Internet speed",
  elevation: "Elevation",
  places: "Amenities & transport",
  mountains: "Mountains",
  coast: "Coast & beaches",
  earthquakes: "Earthquakes",
  outlines: "City outlines on the map",
  builtUp: "Built-up areas on the map (towns with no outline)",
  languages: "Official languages",
};

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

/** Every source behind the numbers, with its licence - the attribution most
 *  of these licences (CC BY, ODbL) require, in one public place. Built from
 *  the dataset's own manifest, so it always matches the data being served. */
export default function SourcesPage() {
  const built = new Date(manifest.generatedAt).toLocaleDateString("en-GB", { dateStyle: "long" });
  return (
    <main className="min-h-dvh flex flex-col">
      <NavBar logoSide="left" border={false} />
      <div className="px-6 pt-8 pb-16">
        <div className="max-w-2xl mx-auto">
          <BackLink />
          <h1 className="font-serif text-2xl text-ink-900 mt-1">Data &amp; Sources</h1>
          <p className="text-sm text-ink-700 mt-3 leading-relaxed">
            Every figure on Piltri is computed from free, openly licensed datasets - nothing is estimated by hand or bought.
            The data was last rebuilt on {built} for {manifest.cityCount.toLocaleString()} places in {manifest.countryCount}{" "}
            countries, and is refreshed monthly. Some values are disclosed estimates (sunshine, snowfall, UV index, flood
            exposure, travel times) - their hover notes say so.
          </p>

          {/* The map's outlines aren't all borders (2026-10-01, on request:
           *  "make sure there isn't any confusion"); the map's note on a
           *  built-up area links here. */}
          <section id="map-outlines" className="mt-8 scroll-mt-6">
            <h2 className="text-sm font-medium text-ink-900">Outlines on the map</h2>
            <ul className="mt-3 space-y-3 text-sm text-ink-700 leading-relaxed">
              <li className="flex gap-3">
                <OutlineSample kind="border" />
                <p>
                  <span className="font-medium text-ink-900">Solid line: the official boundary.</span> The town&apos;s
                  administrative boundary, from OpenStreetMap via Overture Maps.
                </p>
              </li>
              <li className="flex gap-3">
                <OutlineSample kind="builtUp" />
                <p>
                  <span className="font-medium text-ink-900">Dashed line: the built-up area (approximate).</span> Where the open
                  map data has no boundary for the town itself - common in India, China, Vietnam, Pakistan and South Africa,
                  where only much larger districts are mapped - the outline shows where the town is actually built up
                  instead: the continuous area around its centre with at least about 300 people per km² (up to 1,500 in dense
                  cities), from the GHS-POP population grid of about 1 km squares. It is an estimate, not a legal border, and
                  its edges are accurate to about a kilometre.
                </p>
              </li>
              <li className="flex gap-3">
                <OutlineSample kind="circle" />
                <p>
                  <span className="font-medium text-ink-900">Circle: 5 km around the centre.</span> For very sparse places,
                  where neither is available.
                </p>
              </li>
            </ul>
            <p className="mt-3 text-xs text-ink-500 leading-relaxed">
              Whatever the outline, local figures (restaurants, parks, density, schools...) are measured within 5 km of the
              town centre.
            </p>
          </section>

          <dl className="mt-8 divide-y divide-surface-border border-y border-surface-border">
            {Object.entries(manifest.sources).map(([key, text]) => (
              <div key={key} className="py-3 grid sm:grid-cols-[180px_1fr] gap-x-4 gap-y-0.5">
                <dt className="text-sm font-medium text-ink-900">{LABELS[key] ?? key}</dt>
                <dd className="text-sm text-ink-700 leading-relaxed">{text}</dd>
              </div>
            ))}
            <div className="py-3 grid sm:grid-cols-[180px_1fr] gap-x-4 gap-y-0.5">
              <dt className="text-sm font-medium text-ink-900">Maps</dt>
              <dd className="text-sm text-ink-700 leading-relaxed">
                © OpenStreetMap contributors (ODbL), OpenMapTiles, served by OpenFreeMap. Rendered with MapLibre GL.
              </dd>
            </div>
            <div className="py-3 grid sm:grid-cols-[180px_1fr] gap-x-4 gap-y-0.5">
              <dt className="text-sm font-medium text-ink-900">Photos</dt>
              <dd className="text-sm text-ink-700 leading-relaxed">Wikipedia / Wikimedia Commons lead images, under their own licences.</dd>
            </div>
          </dl>

          {manifest.sources.internet && (
            <p className="mt-6 text-xs text-ink-500 leading-relaxed">
              Speedtest® by Ookla® Global Fixed and Mobile Network Performance Maps. Based on analysis by Ookla of Speedtest
              Intelligence® data. Provided by Ookla. Ookla trademarks used under license and reprinted with permission.
            </p>
          )}
          <p className="mt-3 text-xs text-ink-500 leading-relaxed">
            Health data: World Health Organization, data.who.int, UHC service coverage index. Köppen-Geiger maps: Beck, H. E.
            et al., Scientific Data 10, 724 (2023). Air quality: Atmospheric Composition Analysis Group, Washington University
            in St. Louis. Population: European Commission, Joint Research Centre, GHSL.
          </p>
        </div>
      </div>
    </main>
  );
}
