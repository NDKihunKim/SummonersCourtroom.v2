/**
 * Visitor-location → League shard heuristic.
 *
 * Strategy:
 *   1. Read the browser's IANA timezone (`Asia/Seoul`, `Europe/Berlin`, ...)
 *      via `Intl.DateTimeFormat`. This is free, synchronous, works offline,
 *      and is set by the OS — so it's the closest "where is this user
 *      physically" signal we can get without a geo-IP API call.
 *   2. Use `navigator.language` only as a tiebreaker for ambiguous zones
 *      (e.g. `Asia/Dubai` covers the whole Gulf — Arabic locale → ME).
 *   3. Fall back to `NA` when nothing matches (preserves the previous
 *      default behaviour so we never crash a user's first load).
 *
 * Kept as a separate module from `regions.ts` so the static shard data
 * stays small/tree-shakeable and so this heuristic can be unit-tested
 * with a fake timezone string.
 */

import { DEFAULT_SHARD, type Shard } from "./regions";

/**
 * Direct IANA timezone → Shard map. Covers the timezones that uniquely
 * identify a Riot server. Anything not in this map is handled by the
 * `byPrefix` rules below.
 */
const TZ_TO_SHARD: Record<string, Shard> = {
  // Asia
  "Asia/Seoul": "KR",
  "Asia/Pyongyang": "KR",
  "Asia/Tokyo": "JP",
  "Asia/Taipei": "TW",
  "Asia/Hong_Kong": "TW", // Riot routes HK to TW
  "Asia/Macau": "TW",
  "Asia/Bangkok": "TH",
  "Asia/Manila": "PH",
  "Asia/Ho_Chi_Minh": "VN",
  "Asia/Saigon": "VN",
  "Asia/Singapore": "SEA",
  "Asia/Kuala_Lumpur": "SEA",
  "Asia/Kuching": "SEA",
  "Asia/Jakarta": "SEA",
  "Asia/Pontianak": "SEA",
  "Asia/Makassar": "SEA",
  "Asia/Jayapura": "SEA",

  // Middle East
  "Asia/Dubai": "ME",
  "Asia/Riyadh": "ME",
  "Asia/Qatar": "ME",
  "Asia/Kuwait": "ME",
  "Asia/Bahrain": "ME",
  "Asia/Muscat": "ME",
  "Asia/Baghdad": "ME",
  "Asia/Tehran": "ME",
  "Asia/Jerusalem": "ME",
  "Asia/Amman": "ME",
  "Asia/Beirut": "ME",
  "Asia/Damascus": "ME",
  "Africa/Cairo": "ME",

  // Europe (West vs Nordic & East split)
  "Europe/London": "EUW",
  "Europe/Dublin": "EUW",
  "Europe/Lisbon": "EUW",
  "Europe/Madrid": "EUW",
  "Europe/Paris": "EUW",
  "Europe/Brussels": "EUW",
  "Europe/Amsterdam": "EUW",
  "Europe/Luxembourg": "EUW",
  "Europe/Berlin": "EUW",
  "Europe/Zurich": "EUW",
  "Europe/Vienna": "EUW",
  "Europe/Rome": "EUW",
  "Europe/Monaco": "EUW",
  "Europe/Andorra": "EUW",

  "Europe/Helsinki": "EUNE",
  "Europe/Stockholm": "EUNE",
  "Europe/Oslo": "EUNE",
  "Europe/Copenhagen": "EUNE",
  "Europe/Reykjavik": "EUNE",
  "Europe/Tallinn": "EUNE",
  "Europe/Riga": "EUNE",
  "Europe/Vilnius": "EUNE",
  "Europe/Warsaw": "EUNE",
  "Europe/Prague": "EUNE",
  "Europe/Bratislava": "EUNE",
  "Europe/Budapest": "EUNE",
  "Europe/Ljubljana": "EUNE",
  "Europe/Zagreb": "EUNE",
  "Europe/Sarajevo": "EUNE",
  "Europe/Belgrade": "EUNE",
  "Europe/Skopje": "EUNE",
  "Europe/Sofia": "EUNE",
  "Europe/Bucharest": "EUNE",
  "Europe/Athens": "EUNE",
  "Europe/Chisinau": "EUNE",
  "Europe/Kiev": "EUNE",
  "Europe/Kyiv": "EUNE",
  "Europe/Minsk": "EUNE",

  "Europe/Moscow": "RU",
  "Europe/Kaliningrad": "RU",
  "Europe/Samara": "RU",
  "Asia/Yekaterinburg": "RU",
  "Asia/Novosibirsk": "RU",
  "Asia/Krasnoyarsk": "RU",
  "Asia/Irkutsk": "RU",
  "Asia/Vladivostok": "RU",
  "Asia/Magadan": "RU",
  "Asia/Kamchatka": "RU",

  "Europe/Istanbul": "TR",

  // Oceania (OCE shard)
  "Australia/Sydney": "OCE",
  "Australia/Melbourne": "OCE",
  "Australia/Brisbane": "OCE",
  "Australia/Adelaide": "OCE",
  "Australia/Perth": "OCE",
  "Australia/Hobart": "OCE",
  "Australia/Darwin": "OCE",
  "Pacific/Auckland": "OCE",

  // Americas — Latin America split
  "America/Sao_Paulo": "BR",
  "America/Recife": "BR",
  "America/Fortaleza": "BR",
  "America/Bahia": "BR",
  "America/Manaus": "BR",
  "America/Belem": "BR",
  "America/Cuiaba": "BR",
  "America/Campo_Grande": "BR",

  "America/Mexico_City": "LAN",
  "America/Monterrey": "LAN",
  "America/Cancun": "LAN",
  "America/Tijuana": "LAN",
  "America/Bogota": "LAN",
  "America/Lima": "LAN",
  "America/Caracas": "LAN",
  "America/Guayaquil": "LAN",
  "America/Panama": "LAN",
  "America/Costa_Rica": "LAN",
  "America/Guatemala": "LAN",
  "America/El_Salvador": "LAN",
  "America/Tegucigalpa": "LAN",
  "America/Managua": "LAN",

  "America/Argentina/Buenos_Aires": "LAS",
  "America/Buenos_Aires": "LAS",
  "America/Santiago": "LAS",
  "America/Asuncion": "LAS",
  "America/Montevideo": "LAS",
  "America/La_Paz": "LAS",
};

/**
 * Pure mapping function — safe to unit-test without a browser.
 *
 * @param tz   IANA timezone string (e.g. "Asia/Seoul"). Pass undefined when
 *             the runtime can't resolve one — we'll return null.
 * @param lang BCP-47 locale (e.g. "ko-KR"). Used only to disambiguate
 *             zones that span multiple Riot shards.
 */
export function detectShardFromTimezone(
  tz: string | undefined,
  lang: string | undefined,
): Shard | null {
  if (!tz) return null;

  // 1. Direct hit on the explicit table — handles ~all common cases.
  const direct = TZ_TO_SHARD[tz];
  if (direct) return direct;

  // 2. Locale-assisted disambiguation. Some users sit on a generic continental
  //    timezone (e.g. "Asia/Shanghai") that doesn't map to a Riot shard —
  //    fall back to language hints before giving up.
  const langLower = (lang ?? "").toLowerCase();
  if (tz.startsWith("Asia/")) {
    if (langLower.startsWith("ko")) return "KR";
    if (langLower.startsWith("ja")) return "JP";
    if (langLower.startsWith("zh-tw") || langLower === "zh-hant") return "TW";
    if (langLower.startsWith("th")) return "TH";
    if (langLower.startsWith("vi")) return "VN";
    if (langLower.startsWith("ar") || langLower.startsWith("fa") || langLower.startsWith("he")) {
      return "ME";
    }
    if (langLower.startsWith("id") || langLower.startsWith("ms")) return "SEA";
  }
  if (tz.startsWith("Europe/")) {
    // Anything Europe/* not in the explicit table — assume EUW which is the
    // dominant shard, unless the locale is clearly Eastern.
    if (
      langLower.startsWith("ru") ||
      langLower.startsWith("uk") ||
      langLower.startsWith("be")
    ) {
      return "RU";
    }
    if (langLower.startsWith("tr")) return "TR";
    return "EUW";
  }
  if (tz.startsWith("America/")) {
    // Spanish/Portuguese in the Americas → Latin shards as a heuristic.
    if (langLower.startsWith("pt")) return "BR";
    if (langLower.startsWith("es")) return "LAN";
    // Everything else (US, Canada, etc.) → NA.
    return "NA";
  }
  if (tz.startsWith("Australia/") || tz.startsWith("Pacific/")) {
    return "OCE";
  }
  if (tz.startsWith("Africa/")) {
    // Most of Africa isn't an official Riot shard — North Africa often
    // plays on EUW, the Middle East server covers the rest of the region.
    if (
      langLower.startsWith("ar") ||
      tz === "Africa/Cairo" ||
      tz === "Africa/Tunis" ||
      tz === "Africa/Algiers"
    ) {
      return "ME";
    }
    return "EUW";
  }
  return null;
}

/**
 * Browser-side detection wrapper. Always returns a Shard — never throws —
 * so callers can use it as a drop-in replacement for `DEFAULT_SHARD`.
 */
export function detectShard(): Shard {
  // Hard guard for SSR / non-browser environments.
  if (typeof window === "undefined") return DEFAULT_SHARD;
  try {
    // `Intl` is on every modern browser — try/catch covers locked-down
    // sandboxes that throw on `resolvedOptions()` (rare, but seen).
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const lang = typeof navigator !== "undefined" ? navigator.language : undefined;
    return detectShardFromTimezone(tz, lang) ?? DEFAULT_SHARD;
  } catch {
    return DEFAULT_SHARD;
  }
}