/** World regions for Leaderboards and search filters: each country code
 *  (GeoNames countryInfo) in one region. Continents as GeoNames has them,
 *  except the Middle East, its own region (with Turkey; Egypt stays in
 *  Africa), and the Americas, split into North America (US, Canada and
 *  their territories) and Latin America & the Caribbean.
 *  Antarctica counts with Oceania. Generated once from countryInfo.txt. */
export type RegionKey = "europe" | "northAmerica" | "latinAmerica" | "africa" | "middleEast" | "asia" | "oceania";

export const REGION_ORDER: RegionKey[] = ["europe", "northAmerica", "latinAmerica", "africa", "middleEast", "asia", "oceania"];

export const REGION_LABELS: Record<RegionKey, string> = {
  europe: "Europe",
  northAmerica: "North America",
  latinAmerica: "Latin America",
  africa: "Africa",
  middleEast: "Middle East",
  asia: "Asia",
  oceania: "Oceania",
};

// prettier-ignore
const REGION_OF: Record<string, RegionKey> = {AD:"europe",AE:"middleEast",AF:"asia",AG:"latinAmerica",AI:"latinAmerica",AL:"europe",AM:"asia",AN:"latinAmerica",AO:"africa",AQ:"oceania",AR:"latinAmerica",AS:"oceania",AT:"europe",AU:"oceania",AW:"latinAmerica",AX:"europe",AZ:"asia",BA:"europe",BB:"latinAmerica",BD:"asia",BE:"europe",BF:"africa",BG:"europe",BH:"middleEast",BI:"africa",BJ:"africa",BL:"latinAmerica",BM:"northAmerica",BN:"asia",BO:"latinAmerica",BQ:"latinAmerica",BR:"latinAmerica",BS:"latinAmerica",BT:"asia",BV:"oceania",BW:"africa",BY:"europe",BZ:"latinAmerica",CA:"northAmerica",CC:"asia",CD:"africa",CF:"africa",CG:"africa",CH:"europe",CI:"africa",CK:"oceania",CL:"latinAmerica",CM:"africa",CN:"asia",CO:"latinAmerica",CR:"latinAmerica",CS:"europe",CU:"latinAmerica",CV:"africa",CW:"latinAmerica",CX:"oceania",CY:"europe",CZ:"europe",DE:"europe",DJ:"africa",DK:"europe",DM:"latinAmerica",DO:"latinAmerica",DZ:"africa",EC:"latinAmerica",EE:"europe",EG:"africa",EH:"africa",ER:"africa",ES:"europe",ET:"africa",FI:"europe",FJ:"oceania",FK:"latinAmerica",FM:"oceania",FO:"europe",FR:"europe",GA:"africa",GB:"europe",GD:"latinAmerica",GE:"asia",GF:"latinAmerica",GG:"europe",GH:"africa",GI:"europe",GL:"northAmerica",GM:"africa",GN:"africa",GP:"latinAmerica",GQ:"africa",GR:"europe",GS:"oceania",GT:"latinAmerica",GU:"oceania",GW:"africa",GY:"latinAmerica",HK:"asia",HM:"oceania",HN:"latinAmerica",HR:"europe",HT:"latinAmerica",HU:"europe",ID:"asia",IE:"europe",IL:"middleEast",IM:"europe",IN:"asia",IO:"asia",IQ:"middleEast",IR:"middleEast",IS:"europe",IT:"europe",JE:"europe",JM:"latinAmerica",JO:"middleEast",JP:"asia",KE:"africa",KG:"asia",KH:"asia",KI:"oceania",KM:"africa",KN:"latinAmerica",KP:"asia",KR:"asia",KW:"middleEast",KY:"latinAmerica",KZ:"asia",LA:"asia",LB:"middleEast",LC:"latinAmerica",LI:"europe",LK:"asia",LR:"africa",LS:"africa",LT:"europe",LU:"europe",LV:"europe",LY:"africa",MA:"africa",MC:"europe",MD:"europe",ME:"europe",MF:"latinAmerica",MG:"africa",MH:"oceania",MK:"europe",ML:"africa",MM:"asia",MN:"asia",MO:"asia",MP:"oceania",MQ:"latinAmerica",MR:"africa",MS:"latinAmerica",MT:"europe",MU:"africa",MV:"asia",MW:"africa",MX:"latinAmerica",MY:"asia",MZ:"africa",NA:"africa",NC:"oceania",NE:"africa",NF:"oceania",NG:"africa",NI:"latinAmerica",NL:"europe",NO:"europe",NP:"asia",NR:"oceania",NU:"oceania",NZ:"oceania",OM:"middleEast",PA:"latinAmerica",PE:"latinAmerica",PF:"oceania",PG:"oceania",PH:"asia",PK:"asia",PL:"europe",PM:"northAmerica",PN:"oceania",PR:"latinAmerica",PS:"middleEast",PT:"europe",PW:"oceania",PY:"latinAmerica",QA:"middleEast",RE:"africa",RO:"europe",RS:"europe",RU:"europe",RW:"africa",SA:"middleEast",SB:"oceania",SC:"africa",SD:"africa",SE:"europe",SG:"asia",SH:"africa",SI:"europe",SJ:"europe",SK:"europe",SL:"africa",SM:"europe",SN:"africa",SO:"africa",SR:"latinAmerica",SS:"africa",ST:"africa",SV:"latinAmerica",SX:"latinAmerica",SY:"middleEast",SZ:"africa",TC:"latinAmerica",TD:"africa",TF:"oceania",TG:"africa",TH:"asia",TJ:"asia",TK:"oceania",TL:"oceania",TM:"asia",TN:"africa",TO:"oceania",TR:"middleEast",TT:"latinAmerica",TV:"oceania",TW:"asia",TZ:"africa",UA:"europe",UG:"africa",UM:"oceania",US:"northAmerica",UY:"latinAmerica",UZ:"asia",VA:"europe",VC:"latinAmerica",VE:"latinAmerica",VG:"latinAmerica",VI:"latinAmerica",VN:"asia",VU:"oceania",WF:"oceania",WS:"oceania",XK:"europe",YE:"middleEast",YT:"africa",ZA:"africa",ZM:"africa",ZW:"africa"};

export function regionOf(countryCode: string): RegionKey | null {
  return REGION_OF[countryCode.toUpperCase()] ?? null;
}
