"use client";

import { useEffect } from "react";

export const SITE_URL = "https://www.piltri.me";

/** A page's title, description and canonical address, for pages whose
 *  subject comes from the address (/city?id=lyon-fr, /country?code=FR):
 *  one static page serves every place, so without this all 146,800 share
 *  the site's title and Google sees copies of one page (2026-10-28). Google
 *  reads them once the page has rendered. The previous values come back
 *  when the page closes. Nothing happens while `meta` is null (loading). */
export function usePageMeta(meta: { title: string; description: string; path: string } | null): void {
  const title = meta?.title;
  const description = meta?.description;
  const path = meta?.path;
  useEffect(() => {
    if (!title || !description || !path) return;
    const previousTitle = document.title;
    document.title = title;

    let descriptionTag = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = descriptionTag?.content ?? null;
    if (!descriptionTag) {
      descriptionTag = document.createElement("meta");
      descriptionTag.name = "description";
      document.head.appendChild(descriptionTag);
    }
    descriptionTag.content = description;

    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = SITE_URL + path;
    document.head.appendChild(canonical);

    return () => {
      document.title = previousTitle;
      if (previousDescription != null) descriptionTag!.content = previousDescription;
      else descriptionTag!.remove();
      canonical.remove();
    };
  }, [title, description, path]);
}
