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
 *
 * Since the worldwide audit of 2026-11-10 (owner: "apply the same rigorous
 * approach on all cities in the world"): names are matched without their
 * accents; OpenStreetMap's hospitals are added where Overture's listings
 * are thin (keepHospitals); listings placed far from the hospital they are
 * are left out (placedRightTest).
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
  // (A plain "Klinik" counts only where German is spoken - GERMAN_BOXES:
  // in Indonesia, Malaysia, Turkey and the Nordics it's a clinic.)
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
    // Its departments and services, and its schools (2026-11-08: "Service
    // Pneumo Hôpital", a nursing school "IFSI Hôpital..."; not
    // "universit" - a university hospital is one).
    String.raw`\bservices?\b|\bservi\b|\bschool\b|\bifsi\b|training|\bformation\b|aufenthalt`,
    // Day hospitals: day care, no beds.
    String.raw`day hospital|tagesklinik|h[oô]pital de jour`,
    // Rehabilitation and convalescence (2026-11-08, owner: Olivet's
    // "nearest hospital" was an SSR clinic, soins de suite et de
    // réadaptation).
    String.raw`\bssr\b|soins de suite|r[eé]adaptation|r[eé][ée]ducation|rehabilita|\brehab\b|reha-?klinik|kurklinik|convalescen`,
    // Practices named "clinique" (an osteopath's, a beauty clinic).
    String.raw`ost[eé]opath|chiropract|physioth|kin[eé]sith|podolog|psycholog|psychoth[eé]rap|orthophon|est?h[eé]ti|aesthetic|cosmetic|laser|massage|\bspa\b`,
    // The worldwide audit of 2026-11-10 (owner: "the same rigorous
    // approach on all cities in the world"). Names are matched without
    // their accents (plain()), so "Clinique Vétérinaire" and "Hospital
    // Veterinário" no longer slip past "veterinar".
    // Dental and animal hospitals in other languages and scripts.
    String.raw`dentaire|dentale|dentario|stomatolog|tandarts|tandlaeg|tandlak|\bgigi\b|nha khoa|口腔|牙科|齿科|齒科|歯科|치과|ทันต`,
    String.raw`veterin|dierenarts|dierenkliniek|\bhewan\b|haiwan|thu y\b|动物|動物|宠物|寵物|兽医|獸醫|동물|สัตว์|ветерин|ветклиник|بيطري|دامپزشک|\bpets\b`,
    // Beauty and cosmetic surgery (IVF centres: IVF_ONLY below).
    String.raw`beauty|plastic surg|美容|整形|医美|醫美|성형|피부과`,
    // Offices and booking desks named after a hospital: a Thai hospital's
    // "Dhaka Office", Italy's CUP (fundraising foundations: CHARITY below).
    String.raw`\boffice\b|\bcup\b|appointment|booking|human resource|medical camp`,
    // More of a hospital's parts: imaging, outpatient clinics, its
    // pharmacy, a hospice (not Lyon's "Hospices Civils", its university
    // hospitals, nor a French "Hôpital-Hospice", a small local hospital),
    // its eye or university clinic; a "Barrio Hospital" (a
    // neighbourhood); spa-cure and rehab clinics.
    String.raw`radiolog|imaging|\bx-?ray\b|\bmri\b|\birm\b|scanner|ambulator|apothek|\bpharmacie\b|\bfarmacia\b|parafarmacia|(?<!(hopital|hospital)[- ])\bhospice\b|(eye|university|dental|outpatient) clinic\b|\bbarrio\b|\bkur\b|klimakur|\breha\b`,
    // Suppliers, care homes, and places named by a hospital they're near.
    String.raw`equipment|supplies|supplier|einrichtungen|technolog|installation|pflegeheim|pflegezentrum|nursing home|care home|ehpad|maison de retraite|retirement`,
    String.raw`\bnear\b|\bopp(osite)?\.?\s|bus stop|\bstop\b|\barr[eê]t\b|\bparada\b|バス停|停留所|入口`,
    // A street named after a hospital, and what's on it ("Kiosque
    // Boulevard de l'Hôpital", "12 Hospital Road").
    String.raw`\b(kiosque|boulevard|bd|avenue|rue|place|calle|avenida|via|stra(ss|ß)e)\.?\s+(de\s+l['’]\s?|del\s+|de\s+|do\s+)?h[oô]s?pital|h[oô]s?pital\s+(road|street|lane|avenue)\b`,
  ].join("|"),
  "i"
);

export const HOSPITAL_SAME_SITE_KM = 0.3;

/** Germany, Austria and Switzerland (with a little of their neighbours),
 *  where a "Klinik" is a hospital - elsewhere (Indonesia, Malaysia,
 *  Turkey, the Nordics) it's a clinic (2026-11-10 audit: "Klinik Shine
 *  Beauty Care Surabaya"). */
const GERMAN_BOXES: [number, number, number, number][] = [
  [5.8, 47.2, 15.1, 54.95],
  [9.5, 46.35, 17.2, 49.05],
  [5.9, 45.8, 10.5, 47.85],
];
const inGermanArea = (lng: number, lat: number) => GERMAN_BOXES.some(([x0, y0, x1, y1]) => lng >= x0 && lng <= x1 && lat >= y0 && lat <= y1);
const KLINIK = /klinik\b/i;
/** Named "Klinik ..." outside those countries: a clinic, even one inside a
 *  hospital or called a medical centre ("Klinik Laktasi RSIA KMC", "Klinik
 *  Arda Medical Center" - 31 were left in Indonesia on 2026-11-11). */
const KLINIK_FIRST = /^\s*(poli)?klinik\b/i;

/** The name without accents ("Vétérinaire" -> "Veterinaire", "Bệnh viện"
 *  -> "Benh vien"); other scripts are left as they are (recomposed after
 *  the Latin marks go, so Korean, Japanese and the rest read as before). */
export function plain(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
}

const namedAsHospital = (name: string, p: string) => HOSPITAL_NAME.test(name) || HOSPITAL_NAME.test(p) || ER.test(name);

/** An IVF or fertility centre - unless the name says it's a hospital that
 *  also does IVF ("Kilkari Hospital and IVF Centre", "MAA Women's Hospital
 *  and IVF Center"). */
const IVF = /\bivf\b|fertility/i;
const ALSO_A_HOSPITAL = /hospitals?\s*(&|and)\s|multi ?speciality|multispecialty|\bgeneral\b/i;
/** A hospital's fundraising charity ("St. Michael's Hospital Foundation",
 *  "Jersey City Medical Center Foundation") - in North America only: in
 *  the Philippines "... Hospital Foundation Inc." is the hospital. */
const CHARITY = /(hospital|medical cent(er|re)|health(care)?) foundation$/i;
const inNorthAmerica = (lng: number, lat: number) => lng >= -170 && lng <= -50 && lat >= 14 && lat <= 75;

export function isHospitalName(name: string | null | undefined, lng?: number, lat?: number): boolean {
  if (!name) return false;
  const p = plain(name);
  if (NOT_A_HOSPITAL.test(p)) return false;
  if (IVF.test(p) && !ALSO_A_HOSPITAL.test(p)) return false;
  const located = lng != null && lat != null;
  if (located && inNorthAmerica(lng, lat) && CHARITY.test(p.trim())) return false;
  if (located && KLINIK_FIRST.test(p) && !inGermanArea(lng, lat)) return false;
  if (located && inJapan(lng, lat)) return /病院/.test(name) || (!/医院/.test(name) && namedAsHospital(name, p));
  return namedAsHospital(name, p) || (KLINIK.test(p) && (!located || inGermanArea(lng, lat)));
}

/** An OpenStreetMap hospital (amenity=hospital, via Overture's land use):
 *  the map's mappers already said it's a hospital, so its name needn't -
 *  "Charité", "人民医院" and "Pitié-Salpêtrière" alike - but it must have
 *  one, and not be a dental, animal or rehab "hospital" or a department -
 *  nor a health post, polyclinic or GP practice tagged as a hospital
 *  (HEALTH_CENTRE: "Poste de santé", "Поликлиника", "Hosana Health
 *  Center"; a "Klinik" outside the German-speaking countries - 52 were
 *  left in Indonesia after the 2026-11-11 refresh), unless its name also
 *  says hospital. */
export function isOsmHospitalName(name: string | null | undefined, lng?: number, lat?: number): boolean {
  if (!name) return false;
  const p = plain(name);
  if (NOT_A_HOSPITAL.test(p)) return false;
  const elsewhere = lng != null && lat != null && !inGermanArea(lng, lat);
  if (elsewhere && KLINIK_FIRST.test(p)) return false;
  const clinic = HEALTH_CENTRE.test(p) || (KLINIK.test(p) && elsewhere);
  return !clinic || namedAsHospital(name, p);
}

/** Health centres, posts, dispensaries, polyclinics and doctors' offices -
 *  in OpenStreetMap sometimes tagged as hospitals (the 2026-11-10 audit:
 *  Africa's "centres de santé", Central Asia's polyclinics). A Malian
 *  "centre de santé de référence" is a district hospital (HOSPITAL_WORDS
 *  has csref), and counts. */
const HEALTH_CENTRE = new RegExp(
  [
    String.raw`cent(re|ro|er) de sant[eé]|centro de salud|centro de saude|health (centre|center|post|unit|clinic|station)|poste de sant[eé]|post de sant[eé]`,
    String.raw`\bcds\b|\bcs\b|\bcsps\b|\bcsi\b|\bcms\b|\bcsb\b|\bcsc\b|\bphc\b|\bpuskesmas\b|\bcesfam\b|\bubs\b|\bfap\b`,
    // Family-planning clinics (Burundi's ABUBEF, Togo's ATBEF...).
    String.raw`abubef|atbef|a t b e f|acabef|bien[- ]etre familial|planning familial|family planning`,
    String.raw`dispensa|polyclini|policlini|poliklini|cabinet m[eé]dical|family (medicine|health|doctor)|mjekesise familjare|primary health|maternity home`,
    "поликлини|амбулатор|фельдшер|фап|физиотерап|клиника|медпункт|здравпункт|диспансер",
  ].join("|"),
  "i"
);

/** OpenStreetMap's hospital grounds (Overture land use, medical /
 *  hospital): the centre of each one's box, and the box. */
export interface OsmHospitalAreas {
  lng: ArrayLike<number>;
  lat: ArrayLike<number>;
  names: ArrayLike<string | null>;
  xmin: ArrayLike<number>;
  ymin: ArrayLike<number>;
  xmax: ArrayLike<number>;
  ymax: ArrayLike<number>;
  /** OpenStreetMap's emergency=* ("yes", "no"...), healthcare:speciality=*
   *  and, in France, type:FR:FINESS=* (the official category) - null where
   *  not tagged. */
  emergency?: ArrayLike<string | null>;
  speciality?: ArrayLike<string | null>;
  finess?: ArrayLike<string | null>;
}

/** France's official categories (FINESS) that aren't acute-care hospitals:
 *  109 rehabilitation (soins de suite et de réadaptation - Olivet's
 *  Clinique de l'Archette), 292 and 161 psychiatric, 362 long-stay care,
 *  141 and 146 dialysis, 127 hospital-at-home, 156, 366, 412, 415, 425,
 *  430 and 444 psychiatric day care and aftercare. (101 regional and
 *  university hospitals, 355 hospitals, 365 multi-discipline private
 *  clinics and the rest stay.) */
const FINESS_NOT_ACUTE = new Set(["109", "292", "161", "362", "141", "146", "127", "156", "366", "412", "415", "425", "430", "444"]);
/** Specialities that, alone, make a place not the hospital you'd go to. */
const SPECIALITY_NOT_ACUTE = /^(psychiatry|rehabilitation|physiatry|geriatrics|palliative|palliative_medicine|dialysis|addiction_medicine|child_psychiatry|psychotherapist|dermatology|plastic_surgery|ophthalmology|dentistry|fertility|vaccination)$/;

/** An OpenStreetMap "hospital" that isn't an acute-care one, by its tags
 *  (2026-11-11, owner's Olivet again: the rehab clinic he had flagged came
 *  back through OpenStreetMap, where its tags say what it is): no
 *  emergency department (emergency=no), a French category that isn't
 *  acute care, or only non-acute specialities with no emergency
 *  department. Untagged ones stay - most of the world's. */
export function osmNotAcute(osm: OsmHospitalAreas, i: number): boolean {
  const emergency = osm.emergency?.[i] ?? null;
  if (emergency === "no") return true;
  const finess = osm.finess?.[i] ?? null;
  if (finess && FINESS_NOT_ACUTE.has(finess.trim())) return true;
  const speciality = osm.speciality?.[i] ?? null;
  if (speciality && emergency !== "yes") {
    const parts = speciality.split(/[;,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length && parts.every((s) => SPECIALITY_NOT_ACUTE.test(s))) return true;
  }
  return false;
}

/** A hospital's grounds count as its site up to this size (half the box's
 *  diagonal); a bigger box is a whole medical district, with several
 *  hospitals in it, and falls back to HOSPITAL_SAME_SITE_KM. */
const OSM_SITE_MAX_KM = 1;
/** A listing this close outside the grounds' box is still that hospital
 *  (its entrance, its car park across the road). */
const OSM_SITE_MARGIN_DEG = 0.1 / 111.32;

/** The hospitals: Overture's places named as one, and (2026-11-10, the
 *  worldwide audit - Overture's places are thin in China, Iran, Central
 *  Asia and much of Africa) OpenStreetMap's hospital grounds; one per
 *  site. A place `placedRight` rejects - its address in another country,
 *  or another town far away - is left out. */
export function keepHospitals<T extends { lng: ArrayLike<number>; lat: ArrayLike<number>; names?: ArrayLike<string | null> | null }>(
  points: T,
  osm?: OsmHospitalAreas | null,
  placedRight?: (i: number) => boolean
): { lng: number[]; lat: number[]; names: string[]; fromOsm: number; misplaced: number; notAcute: number } {
  const out = { lng: [] as number[], lat: [] as number[], names: [] as string[], fromOsm: 0, misplaced: 0, notAcute: 0 };
  // OpenStreetMap's first, the biggest grounds first (a campus before the
  // buildings mapped inside it); a smaller one inside a kept box is the
  // same hospital.
  const sites: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const siteGrid = new Map<string, number[]>();
  const GRID = 0.05; // degrees, ~5 km: every box under OSM_SITE_MAX_KM fits in its cell and the next
  const siteAt = (lng: number, lat: number) => {
    const cx = Math.floor(lng / GRID);
    const cy = Math.floor(lat / GRID);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const k of siteGrid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const s = sites[k];
          if (lng >= s.x0 - OSM_SITE_MARGIN_DEG && lng <= s.x1 + OSM_SITE_MARGIN_DEG && lat >= s.y0 - OSM_SITE_MARGIN_DEG && lat <= s.y1 + OSM_SITE_MARGIN_DEG) return true;
        }
    return false;
  };
  if (osm) {
    const order: number[] = [];
    const notAcute: number[] = [];
    for (let i = 0; i < osm.lng.length; i++) {
      if (osmNotAcute(osm, i)) notAcute.push(i);
      else if (isOsmHospitalName(osm.names[i], osm.lng[i], osm.lat[i])) order.push(i);
    }
    const halfKm = (i: number) => {
      const kx = Math.cos((osm.lat[i] * Math.PI) / 180);
      return (Math.hypot((osm.xmax[i] - osm.xmin[i]) * kx, osm.ymax[i] - osm.ymin[i]) * 111.32) / 2;
    };
    const addSite = (i: number) => {
      const small = halfKm(i) <= OSM_SITE_MAX_KM;
      const r = (HOSPITAL_SAME_SITE_KM / 2) / 111.32;
      sites.push(
        small
          ? { x0: osm.xmin[i], y0: osm.ymin[i], x1: osm.xmax[i], y1: osm.ymax[i] }
          : { x0: osm.lng[i] - r, y0: osm.lat[i] - r, x1: osm.lng[i] + r, y1: osm.lat[i] + r }
      );
      const key = `${Math.floor(osm.lng[i] / GRID)},${Math.floor(osm.lat[i] / GRID)}`;
      if (!siteGrid.has(key)) siteGrid.set(key, []);
      siteGrid.get(key)!.push(sites.length - 1);
    };
    order.sort((a, b) => halfKm(b) - halfKm(a));
    for (const i of order) {
      if (siteAt(osm.lng[i], osm.lat[i])) continue;
      addSite(i);
      out.lng.push(osm.lng[i]);
      out.lat.push(osm.lat[i]);
      out.names.push(osm.names[i]!);
      out.fromOsm++;
    }
    // Grounds OpenStreetMap says aren't acute care: not listed, and an
    // Overture listing inside them isn't either (the same clinic under its
    // business name). Inside a kept hospital's grounds they change nothing.
    for (const i of notAcute) {
      if (siteAt(osm.lng[i], osm.lat[i])) continue;
      addSite(i);
      out.notAcute++;
    }
  }
  const named: { lng: number; lat: number; name: string }[] = [];
  for (let i = 0; i < points.lng.length; i++) {
    const name = points.names?.[i] ?? null;
    if (!isHospitalName(name, points.lng[i], points.lat[i])) continue;
    if (placedRight && !placedRight(i)) {
      out.misplaced++;
      continue;
    }
    if (siteAt(points.lng[i], points.lat[i])) continue; // OpenStreetMap has it
    named.push({ lng: points.lng[i], lat: points.lat[i], name: name! });
  }
  // Shortest names first: "The Mount Sinai Hospital" before "Pulmonology
  // Services at Mount Sinai Hospital"; then one per site, on a grid of
  // cells about HOSPITAL_SAME_SITE_KM wide.
  named.sort((a, b) => a.name.length - b.name.length);
  const cellDeg = HOSPITAL_SAME_SITE_KM / 111.32;
  const taken = new Map<string, { lng: number; lat: number }[]>();
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

/* ------------------------------------------------------------------ */
/* Listings placed far from their hospital                              */
/* ------------------------------------------------------------------ */

/** "Hospital Geral de Benguela" -> "hospital geral de benguela". */
export const nameKey = (name: string) => plain(name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const kmBetween = (lng1: number, lat1: number, lng2: number, lat2: number) => {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
};

/** Words of a hospital's name that are also towns somewhere ("Central",
 *  "Hospital" in Ireland and Chile, "Victoria") - never taken as the town
 *  it names. */
const NOT_A_TOWN = /^(hospital|hospitals|general|central|regional|district|provincial|municipal|national|university|universitario|universitaire|medical|center|centre|santa|santo|san|saint|st|mercy|victoria|union|memorial|clinic|clinica|new|north|south|east|west|city|county|mission|christian|baptist|royal|hope|grace|good|liberty|independence|progreso|esperanza|libertad|paz|la|el|de|del|do|da|des|du|the|and|of|in)$/;

/** Where a name says, in so many words, which town the hospital is in:
 *  "... in Hyderabad", "Renmin Hospital of Wuhan University", a town alone
 *  before or after a comma ("Patna, Kurji Hospital", "Lucena Doctor's
 *  Hospital, Lucena City"). The words must be the town's whole name -
 *  "Hospital de São José", "Hospital Provincial de Gaza" (Mozambique's) and
 *  "St George's Hospital" name a saint, a province, a person. */
const IN_TOWN = /\bin ((?:[a-z]+ ?){1,3})$/;
const OF_TOWN_UNIVERSITY = /\bof ((?:[a-z]+ ?){1,2}) university\b/;
const LEADING_TOWN = /^([^,]{3,30}),/;
const TRAILING_TOWN = /,\s*([^,]{3,30})$/;

/** The town named is in another country, this far away at least, with no
 *  town of that name in the listing's own country... */
const TOWN_FAR_KM = 500;
/** ...and one of that name is big enough to be the one meant... */
const TOWN_FAR_MIN_POPULATION = 50_000;
/** ...and no town within this of the listing has a name the words start
 *  (a branch: "Peking University Shenzhen Hospital" in Shenzhen). */
const TOWN_NEAR_KM = 50;

/** Overture listings placed in another country than the hospital they are
 *  (2026-11-10, the worldwide audit: "Patna, Kurji Hospital" and
 *  "Multispeciality Hospitals In Hyderabad" in London, Wuhan's "Renmin
 *  Hospital of Wuhan University" in Tokyo). Their address doesn't help:
 *  it's geocoded from the same wrong point (Saskatoon's "Royal University
 *  Hospital", listed in Ottawa, has an Ottawa address). Their name does,
 *  when it says which town the hospital is in (IN_TOWN, OF_TOWN_UNIVERSITY,
 *  a town alone by a comma) and that town is abroad - TOWN_FAR_KM+ away, none of that name
 *  at home. A hospital merely named after a faraway city ("Berlin
 *  Hospital" in Dubai, "King's College Hospital London" there too) says
 *  nothing of where it is, and stays. Misplaced within a country ("Hospital
 *  Geral de Benguela" in Luanda) is left as it is: "Hospital de X" names
 *  saints, provinces and counties as often as towns ("Hospital de
 *  Caridade São José", "Norfolk General Hospital") - tried and dropped the
 *  same day.
 *  Returns a test per listing: true when it's where it should be. */
export function placedRightTest(
  hosp: { lng: ArrayLike<number>; lat: ArrayLike<number>; names?: ArrayLike<string | null> | null },
  places: { lng: number; lat: number; cityName: string; population: number; countryCode: string }[]
): (i: number) => boolean {
  type Town = { lng: number; lat: number; population: number; countryCode: string; key: string };
  const townsByName = new Map<string, Town[]>();
  const grid = new Map<string, Town[]>();
  const cell = (lng: number, lat: number) => `${Math.floor(lng * 2)},${Math.floor(lat * 2)}`;
  for (const p of places) {
    const key = nameKey(p.cityName);
    const t: Town = { lng: p.lng, lat: p.lat, population: p.population, countryCode: p.countryCode, key };
    const c = cell(p.lng, p.lat);
    if (!grid.has(c)) grid.set(c, []);
    grid.get(c)!.push(t);
    if (key.length < 4 || NOT_A_TOWN.test(key)) continue;
    if (!townsByName.has(key)) townsByName.set(key, []);
    townsByName.get(key)!.push(t);
  }
  /** Towns within ~50-100 km, nearest first. */
  const around = (lng: number, lat: number) => {
    const out: (Town & { km: number })[] = [];
    const cx = Math.floor(lng * 2);
    const cy = Math.floor(lat * 2);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const t of grid.get(`${cx + dx},${cy + dy}`) ?? []) out.push({ ...t, km: kmBetween(lng, lat, t.lng, t.lat) });
    return out.sort((a, b) => a.km - b.km);
  };
  return (i: number) => {
    const name = hosp.names?.[i];
    if (!name) return true;
    const lng = hosp.lng[i];
    const lat = hosp.lat[i];
    const near = around(lng, lat);
    const home = near[0]?.countryCode;
    if (!home) return true;
    const k = nameKey(name);
    const lower = plain(name).toLowerCase().trim();
    const said = [IN_TOWN.exec(k)?.[1], OF_TOWN_UNIVERSITY.exec(k)?.[1], LEADING_TOWN.exec(lower)?.[1], TRAILING_TOWN.exec(lower)?.[1]]
      .map((w) => (w ? nameKey(w).replace(/ city$/, "") : ""))
      .filter((w) => w.length >= 4 && !NOT_A_TOWN.test(w) && townsByName.has(w));
    const abroad = said.filter((t) => {
      const towns = townsByName.get(t)!;
      // A namesake at home counts unless it's a village far away next to
      // the city abroad (2026-11-11: "Patna, Kurji Hospital" stayed in
      // London because Scotland has a Patna of 2,000 people, 500 km off -
      // India's has 1.7 million).
      const biggestAbroad = Math.max(0, ...towns.filter((x) => x.countryCode !== home).map((x) => x.population));
      const atHome = towns.some(
        (x) => x.countryCode === home && (x.population * 20 >= biggestAbroad || kmBetween(lng, lat, x.lng, x.lat) <= 100)
      );
      return (
        !atHome &&
        towns.some((x) => x.countryCode !== home && x.population >= TOWN_FAR_MIN_POPULATION) &&
        Math.min(...towns.filter((x) => x.countryCode !== home).map((x) => kmBetween(lng, lat, x.lng, x.lat))) >= TOWN_FAR_KM
      );
    });
    if (!abroad.length) return true;
    // A town nearby in the name - its own, or one starting with its words
    // ("Norfolk" for Norfolk County): a branch.
    const close = near.filter((t) => t.km <= TOWN_NEAR_KM);
    const words = k.split(" ");
    for (let a = 0; a < words.length; a++)
      for (let b = a + 1; b <= Math.min(words.length, a + 3); b++) {
        const run = words.slice(a, b).join(" ");
        if (run.length < 4 || NOT_A_TOWN.test(run)) continue;
        if (close.some((t) => t.key === run || t.key.startsWith(run + " "))) return true;
      }
    return false;
  };
}
