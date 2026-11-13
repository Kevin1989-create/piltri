import { RESOURCE_LINK_CATEGORIES, type ResourceLinkCategory } from "@/lib/types";

/** What a curated resource link may hold - shared by the admin routes
 *  (one link, and many at once). */
export function isValidCategory(value: unknown): value is ResourceLinkCategory {
  return typeof value === "string" && (RESOURCE_LINK_CATEGORIES as string[]).includes(value);
}

export function isValidUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
