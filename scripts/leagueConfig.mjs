/**
 * Shared league configuration for the data-fetch and live-fetch scripts.
 *
 * Historical results: football-data.co.uk (primary) with openfootball as a
 * free public-domain fallback.
 * Current fixtures/results:
 *   - Premier League: Fantasy Premier League public API (official, no key)
 *   - Bundesliga: OpenLigaDB (free open data, no key)
 *   - Other supported leagues: openfootball/football.json (fixtures + final
 *     scores, updated about once a day -- NOT live)
 *
 * No paid API keys are used.
 */

export const LEAGUES = {
  E0: {
    country: "England",
    league: "Premier League",
    openfootball: "en",
    fpl: true,
  },
  SP1: {
    country: "Spain",
    league: "La Liga",
    openfootball: "es",
  },
  D1: {
    country: "Germany",
    league: "Bundesliga",
    openfootball: "de",
    openligadb: "bl1",
  },
  I1: {
    country: "Italy",
    league: "Serie A",
    openfootball: "it",
  },
  F1: {
    country: "France",
    league: "Ligue 1",
    openfootball: "fr",
  },
  N1: {
    country: "Netherlands",
    league: "Eredivisie",
    openfootball: "nl",
  },
  P1: {
    country: "Portugal",
    league: "Primeira Liga",
    openfootball: "pt",
  },
  B1: {
    country: "Belgium",
    league: "Jupiler Pro League",
    openfootball: "be",
  },
  SC0: {
    country: "Scotland",
    league: "Premiership",
    openfootball: "sc",
  },
  T1: {
    country: "Turkey",
    league: "Süper Lig",
    openfootball: "tr",
  },
};

export const LEAGUE_IDS = Object.keys(LEAGUES);

/**
 * The season that is currently being played (European season starts in July).
 * In October 2026 this returns 2026, i.e. the 2026/2027 season.
 */
export function currentSeasonStart(now = new Date()) {
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

export function seasonName(startYear) {
  return `${startYear}/${startYear + 1}`;
}

/** football-data.co.uk season id, e.g. 2026 -> "2627". */
export function footballDataSeasonId(startYear) {
  return `${String(startYear).slice(2)}${String(startYear + 1).slice(2)}`;
}

/** openfootball season folder, e.g. 2026 -> "2026-27". */
export function openFootballSeasonId(startYear) {
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

export function buildSeasons(startYear, endYearExclusive) {
  const seasons = [];
  for (let y = startYear; y < endYearExclusive; y++) {
    seasons.push({
      startYear: y,
      name: seasonName(y),
      footballDataId: footballDataSeasonId(y),
      openFootballId: openFootballSeasonId(y),
    });
  }
  return seasons;
}

/** Normalise a date from dd/mm/yy, dd/mm/yyyy or ISO to YYYY-MM-DD. */
export function toIsoDate(value) {
  if (!value) return "";
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return "";
  const day = String(parseInt(m[1], 10)).padStart(2, "0");
  const month = String(parseInt(m[2], 10)).padStart(2, "0");
  let year = parseInt(m[3], 10);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  return `${year}-${month}-${day}`;
}

export function resultFromGoals(hg, ag) {
  return hg > ag ? "H" : hg < ag ? "A" : "D";
}
