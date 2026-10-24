/**
 * Free livescore feed (TheSportsDB public test API).
 *
 * The browser calls this endpoint directly because it sends CORS headers.
 * The public test key is rate-limited; the UI polls at most once per minute.
 * Always keep the snapshot-based Data & Tests view as the trustworthy fallback:
 * this feed is a convenience, not an official or guaranteed live service.
 */

export const LIVESCORE_URL =
  "https://www.thesportsdb.com/api/v1/json/123/livescore.php?s=Soccer";

/** League names used by TheSportsDB for the app's 10 supported competitions. */
export const OUR_LEAGUE_NAMES = [
  "English Premier League",
  "Spanish La Liga",
  "German Bundesliga",
  "Italian Serie A",
  "French Ligue 1",
  "Dutch Eredivisie",
  "Portuguese Primeira Liga",
  "Belgian Pro League",
  "Scottish Premiership",
  "Turkish Super Lig",
  "Turkish Süper Lig",
];

const OUR_LEAGUES = new Set(OUR_LEAGUE_NAMES.map((name) => name.toLowerCase()));

export function isOurLeague(name) {
  return OUR_LEAGUES.has(String(name || "").trim().toLowerCase());
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normaliseLiveEvent(event) {
  if (!event) return null;
  const home = event.strHomeTeam || "";
  const away = event.strAwayTeam || "";
  if (!home || !away) return null;

  return {
    id: String(event.idEvent || event.idLiveScore || `${home}-${away}`),
    league: event.strLeague || "",
    leagueId: String(event.idLeague || ""),
    home,
    away,
    hg: numberOrNull(event.intHomeScore),
    ag: numberOrNull(event.intAwayScore),
    status: String(event.strStatus || "").toUpperCase(),
    progress: String(event.strProgress || ""),
    kickoff: event.strTimestamp || "",
    homeBadge: event.strHomeTeamBadge || "",
    awayBadge: event.strAwayTeamBadge || "",
    updated: event.updated || "",
  };
}

export function isLiveStatus(status) {
  return ["1H", "2H", "HT", "ET", "BT", "P", "PEN", "LIVE"].includes(
    String(status || "").toUpperCase()
  );
}

export function isFinishedStatus(status) {
  return ["FT", "AET", "PEN", "MATCH FINISHED"].includes(
    String(status || "").toUpperCase()
  );
}

/**
 * Fetch the current worldwide soccer livescore feed.
 * Throws on network errors, HTTP errors, or malformed payloads so the UI can
 * show an honest error instead of pretending the data is live.
 */
export async function fetchLivescores(signal) {
  const response = await fetch(LIVESCORE_URL, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Livescore service returned HTTP ${response.status}`);
  }

  const json = await response.json();
  const rows = json?.livescore || json?.events || [];
  if (!Array.isArray(rows)) {
    throw new Error("Livescore service returned an unexpected response.");
  }

  return rows.map(normaliseLiveEvent).filter(Boolean);
}
