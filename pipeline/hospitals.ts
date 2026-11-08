/**
 * Which of Overture's "hospitals" are hospitals (2026-11-08, owner: a town
 * hall and a psychologist's practice were listed as Lyon hospitals).
 * Overture's hospital category is broad - around Lyon half of it was
 * psychologists, laser and beauty clinics, property surveyors, ambulance
 * firms; in London and New York GP surgeries, doctors' practices and the
 * wards, entrances and departments of real hospitals, each listed apart.
 *
 * So a place counts only when its name says hospital - in the languages
 * of the places Piltri covers - or emergency department; a dental, animal
 * or eye-laser "hospital" doesn't, nor a ward or a hospital's office; and
 * of several within HOSPITAL_SAME_SITE_KM, one is kept (the shortest
 * name, usually the hospital itself rather than one of its departments).
 */

const HOSPITAL_WORDS = [
  // English, and words shared with other languages
  String.raw`\bhospitals?\b`,
  String.raw`hospitaal`, // Afrikaans, Flemish
  String.raw`\binfirmary\b`,
  String.raw`\bregional health cent(re|er)\b`, // Canada's small-town hospitals
  String.raw`\bmedical center\b`, // US / Philippines spelling: a hospital (a UK "medical centre" is a GP surgery)
  String.raw`\bemergency (department|room|hospital|centre|center)\b`,
  String.raw`\baccident (&|and) emergency\b`,
  String.raw`\ba ?& ?e\b`,
  // French, German, Dutch, Nordic
  String.raw`h[oô]pital`,
  String.raw`h[oô]tel[- ]dieu`,
  String.raw`hospitali[eè]r`,
  String.raw`\bchu\b`,
  String.raw`\bchr\b`,
  String.raw`\bclinique\b`, // a private hospital in France and Belgium (an English "clinic" isn't)
  String.raw`\bpolyclinique\b`,
  String.raw`\burgences\b`,
  // (After an accented letter \b doesn't hold - not a word character to
  // JavaScript - so these end on "no letter follows".)
  String.raw`\bmaternit[eé](?![a-z])`,
  String.raw`krankenhaus`,
  String.raw`klinikum`,
  String.raw`klinik\b`, // Klinik, Privatklinik, Kinderklinik, Augenklinik
  String.raw`\bcharit[eé](?![a-z])`,
  String.raw`\bspital\b`,
  String.raw`notaufnahme`,
  String.raw`ziekenhuis`,
  String.raw`sjukhus`,
  String.raw`sjukehus`, // Nynorsk
  String.raw`sykehus`,
  String.raw`sygehus`,
  String.raw`lasarett`,
  String.raw`akutmottagning|akutmodtagelse|skadestue|legevakt`,
  String.raw`sairaala`,
  String.raw`sj[uú]krah[uú]s`,
  // Abbreviations: hôpital général (francophone Africa, Mexico's HG),
  // centre hospitalier provincial (Morocco), Mali's district hospitals,
  // Mexico's zone and regional general hospitals.
  String.raw`\bhg\b|\bchp\b|\bcsref\b|\bhgz\b|\bhgr\b`,
  // Spanish, Portuguese, Italian, Romanian
  String.raw`\bhospitales\b`,
  String.raw`\bsanatorio\b`,
  String.raw`\burgencias\b`,
  String.raw`pronto[ -]socorro`,
  String.raw`pronto atendimento`,
  String.raw`\bupa\b`, // Brazil's 24-hour emergency units
  String.raw`santa casa`, // Brazil and Portugal's charitable hospitals
  String.raw`ospedal`,
  String.raw`policlinico`,
  String.raw`casa di cura`,
  String.raw`pronto soccorso`,
  String.raw`\bspitalul\b`,
  // Central and eastern Europe, Greece, Turkey
  String.raw`szpital`,
  String.raw`nemocnic`,
  String.raw`k[oó]rh[aá]z`,
  String.raw`bolnic`,
  String.raw`bolni[sš]nic`,
  String.raw`ligonin`, // Lithuanian
  String.raw`slimn[iī]c`, // Latvian
  String.raw`haigla`, // Estonian
  "больниц",
  "госпитал",
  "стационар",
  "црб", // центральная районная больница
  "цгб", // центральная городская больница
  "перинатальн",
  "лікарн",
  "црл", // центральна районна лікарня
  "шпитал",
  "болниц",
  "клиническ",
  "νοσοκομε",
  String.raw`hastane`,
  // Caucasus and Central Asia
  String.raw`x[əe]st[əe]xana`,
  String.raw`kasalxona|shifoxona`,
  "аурухана",
  "оорукана",
  "беморхона",
  "эмнэлэг",
  "საავადმყოფო",
  "հիվանդանոց",
  // Middle East, Asia, Africa
  "مستشفى",
  "مستشفي",
  "בית חולים",
  "بیمارستان",
  "ہسپتال",
  "अस्पताल",
  "चिकित्सालय",
  "रुग्णालय",
  "হাসপাতাল",
  "ਹਸਪਤਾਲ",
  "હોસ્પિટલ",
  "மருத்துவமனை",
  "ఆసుపత్రి",
  "ಆಸ್ಪತ್ರೆ",
  "ആശുപത്രി",
  "රෝහල",
  "医院", // a hospital in Chinese - a clinic in Japan (JAPAN_BOXES)
  "醫院",
  "卫生院", // China's township hospitals
  "衛生院",
  "病院",
  "병원",
  "โรงพยาบาล",
  "ဆေးရုံ",
  "មន្ទីរពេទ្យ",
  "ໂຮງໝໍ",
  "ሆስፒታል",
  String.raw`b[eệ]nh vi[eệ]n`,
  String.raw`rumah sakit`,
  String.raw`\brs(u|ud|ia)?\b`, // Indonesian abbreviations: RS, RSU, RSUD, RSIA
  String.raw`\bospital\b`, // Tagalog
  String.raw`hospitali\b`, // Swahili
];
const HOSPITAL_NAME = new RegExp(HOSPITAL_WORDS.join("|"), "i");
/** "ER", in capitals ("Elmhurst Hospital ER", "Lincoln Pediatric ER"). */
const ER = /\bER\b/;

/** Japan, where 医院 is a doctor's clinic and only 病院 a hospital (in
 *  Chinese 医院 is a hospital): Honshu, Shikoku and Kyushu; Hokkaido;
 *  Okinawa - boxes clear of China, Korea and Russia. */
const JAPAN_BOXES: [number, number, number, number][] = [
  [129.5, 30, 142.5, 41.6],
  [139.3, 41.3, 146, 45.6],
  [122.9, 24, 131.4, 28.5],
];
const inJapan = (lng: number, lat: number) => JAPAN_BOXES.some(([x0, y0, x1, y1]) => lng >= x0 && lng <= x1 && lat >= y0 && lat <= y1);

/** Named like a hospital but not one: a dental, animal or doll "hospital",
 *  a hotel's "hospitality", a hospital's ward, entrance, building, office,
 *  shop or car park. */
const NOT_A_HOSPITAL = new RegExp(
  [
    // Not people's hospitals.
    String.raw`dental|dentist|\bteeth\b|odonto|zahn`,
    String.raw`animal|veterinar|\bvet\b|\bpet\b|tierklinik|tierarzt|\bdoll|teddy|\bauto\b|\bbike\b|\bphone\b|\bshoe\b`,
    String.raw`hospitality|\bhotel\b(?![- ]dieu)|guest ?house|hostel`,
    // A hospital's parts, listed apart from it.
    String.raw`\bward\b|\bunit\b|\bwing\b|\bentr[ée]e\b|\bentrance\b|\bbuilding\b|\bblock\b|\bparking\b|car park|\bgate\b`,
    String.raw`outpatient|out-patient|department of|dept\.?\s|\bpharmacy\b|laborator|\blab\b|blood bank|mortuary|morgue|canteen|cafeteria|\bshop\b|\bstore\b`,
    String.raw`head ?office|headquarters|\bsi[eè]ge\b|administra|employee|staff|recruit|education|academy`,
    // Suppliers, care homes, and places named by a hospital they're near.
    String.raw`equipment|supplies|supplier|einrichtungen|pflegeheim|pflegezentrum|nursing home|care home|ehpad|maison de retraite|retirement`,
    String.raw`\bnear\b|\bopp(osite)?\.?\s|bus stop|\bstop\b|\barr[eê]t\b|\bparada\b|バス停|停留所|入口`,
  ].join("|"),
  "i"
);

export const HOSPITAL_SAME_SITE_KM = 0.3;

export function isHospitalName(name: string | null | undefined, lng?: number, lat?: number): boolean {
  if (!name || NOT_A_HOSPITAL.test(name)) return false;
  if (lng != null && lat != null && inJapan(lng, lat)) return /病院/.test(name) || (!/医院/.test(name) && (HOSPITAL_NAME.test(name) || ER.test(name)));
  return HOSPITAL_NAME.test(name) || ER.test(name);
}

/** The hospitals among Overture's: named as one, one per site. */
export function keepHospitals<T extends { lng: ArrayLike<number>; lat: ArrayLike<number>; names?: ArrayLike<string | null> | null }>(
  points: T
): { lng: number[]; lat: number[]; names: string[] } {
  const named: { lng: number; lat: number; name: string }[] = [];
  for (let i = 0; i < points.lng.length; i++) {
    const name = points.names?.[i] ?? null;
    if (isHospitalName(name, points.lng[i], points.lat[i])) named.push({ lng: points.lng[i], lat: points.lat[i], name: name! });
  }
  // Shortest names first: "The Mount Sinai Hospital" before "Pulmonology
  // Services at Mount Sinai Hospital"; then one per site, on a grid of
  // cells about HOSPITAL_SAME_SITE_KM wide.
  named.sort((a, b) => a.name.length - b.name.length);
  const cellDeg = HOSPITAL_SAME_SITE_KM / 111.32;
  const taken = new Map<string, { lng: number; lat: number }[]>();
  const out = { lng: [] as number[], lat: [] as number[], names: [] as string[] };
  for (const p of named) {
    const cx = Math.floor(p.lng / cellDeg);
    const cy = Math.floor(p.lat / cellDeg);
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++)
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (const q of taken.get(`${cx + dx},${cy + dy}`) ?? []) {
          const kx = Math.cos((p.lat * Math.PI) / 180);
          if (Math.hypot((p.lng - q.lng) * kx, p.lat - q.lat) * 111.32 < HOSPITAL_SAME_SITE_KM) {
            near = true;
            break;
          }
        }
    if (near) continue;
    const key = `${cx},${cy}`;
    if (!taken.has(key)) taken.set(key, []);
    taken.get(key)!.push(p);
    out.lng.push(p.lng);
    out.lat.push(p.lat);
    out.names.push(p.name);
  }
  return out;
}
