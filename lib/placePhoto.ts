/**
 * A place's photo (2026-11-14, owner): Wikidata's image of it on Wikimedia
 * Commons, collected by scripts/build-place-photos.mjs. Shown in the map's
 * bottom-left corner, straight from Wikimedia's servers, with its author
 * and licence (every Commons file is under a free licence that asks for
 * them).
 */

/** As stored per place: the file's folder on upload.wikimedia.org ("4/4b"),
 *  its name (underscores), width, height, author, licence. */
export type PhotoTuple = [string, string, number, number, string, string];

export interface PlacePhoto {
  /** About `width` px wide - Wikimedia's standard thumbnail widths. */
  src: (width: 330 | 500 | 960 | 1280 | 1920) => string;
  /** The sharp sizes, for the browser to pick by screen - 960, 1280 and
   *  1920 px wide, as far as the file goes (2026-11-21, owner: better quality
   *  where we can). */
  srcSet: string;
  width: number;
  height: number;
  author: string;
  licence: string;
  /** The file's page on Commons - its full credit and licence. */
  page: string;
}

const UPLOAD = "https://upload.wikimedia.org/wikipedia/commons";

export function placePhoto(t: PhotoTuple | null | undefined): PlacePhoto | null {
  if (!t) return null;
  const [folder, name, width, height, author, licence] = t;
  const file = encodeURIComponent(name);
  // A file narrower than the size asked for is used as it is.
  const thumb = (w: number) => (width > w ? `${UPLOAD}/thumb/${folder}/${file}/${w}px-${file}` : `${UPLOAD}/${folder}/${file}`);
  return {
    src: thumb,
    // Wikimedia's standard widths only (others are slow or refused).
    srcSet: [960, 1280, 1920]
      .filter((w, k) => k === 0 || width > w)
      .map((w) => `${thumb(w)} ${Math.min(w, width)}w`)
      .join(", "),
    width,
    height,
    author,
    licence,
    page: `https://commons.wikimedia.org/wiki/File:${file}`,
  };
}
