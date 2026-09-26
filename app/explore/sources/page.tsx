import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { manifest } from "@/lib/dataset/files";

export const metadata = { title: "Data & sources — Piltri" };

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
};

/** Every source behind the numbers, with its licence - the attribution most
 *  of these licences (CC BY, ODbL) require, in one public place. Built from
 *  the dataset's own manifest, so it always matches the data being served. */
export default function SourcesPage() {
  const built = new Date(manifest.generatedAt).toLocaleDateString("en-GB", { dateStyle: "long" });
  return (
    <main className="min-h-screen flex flex-col">
      <NavBar logoSide="left" border={false} />
      <div className="px-6 pt-8 pb-16">
        <div className="max-w-2xl mx-auto">
          <Link href="/explore" className="text-xs text-ink-500 hover:text-ink-900">
            ← Back to Explore
          </Link>
          <h1 className="font-serif text-2xl text-ink-900 mt-1">Data &amp; sources</h1>
          <p className="text-sm text-ink-700 mt-3 leading-relaxed">
            Every figure on Piltri is computed from free, openly licensed datasets - nothing is estimated by hand or bought.
            The data was last rebuilt on {built} for {manifest.cityCount.toLocaleString()} places in {manifest.countryCount}{" "}
            countries, and is refreshed monthly. Some values are disclosed estimates (sunshine, snowfall, UV index, flood
            exposure, travel times) - their hover notes say so.
          </p>

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
