import { manifest } from "@/lib/dataset/files";

/** Every Explore page reads countries.json (city pages assemble from it; the
 *  search bar uses it for capitals) - preloading it lets it download
 *  alongside the page's JavaScript instead of after it. Immutable-cached, so
 *  it costs nothing on repeat visits. */
export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preload" href={`/data/${manifest.version}/countries.json`} as="fetch" crossOrigin="anonymous" />
      {children}
    </>
  );
}
