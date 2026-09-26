/** A time zone's current offset, e.g. "UTC+1" for Europe/Lisbon in summer -
 *  computed by the browser, so daylight saving is always current. */
export function formatUtcOffset(timeZone: string, date = new Date()): string | null {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!name) return null;
    const offset = name.replace("GMT", "");
    return `UTC${offset || "+0"}`;
  } catch {
    return null;
  }
}
