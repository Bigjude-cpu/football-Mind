/**
 * dataLoader.js
 *
 * Loads the historical match database from /data/matches.json and the
 * current-season snapshot from /data/live.json.
 *
 * IMPORTANT: there is no silent synthetic fallback. If real data cannot be
 * loaded the app shows an error telling you which command to run. Synthetic
 * demo data is only used when you explicitly open the app with ?synthetic=1.
 */

let _cache = null;
let _badgeCache = null;
let _liveCache = null;

export const LEAGUES = {
  E0:  { en: "England — Premier League",   es: "Inglaterra — Premier League" },
  SP1: { en: "Spain — La Liga",            es: "España — La Liga" },
  D1:  { en: "Germany — Bundesliga",       es: "Alemania — Bundesliga" },
  I1:  { en: "Italy — Serie A",            es: "Italia — Serie A" },
  F1:  { en: "France — Ligue 1",           es: "Francia — Ligue 1" },
  N1:  { en: "Netherlands — Eredivisie",   es: "Países Bajos — Eredivisie" },
  P1:  { en: "Portugal — Primeira Liga",   es: "Portugal — Primeira Liga" },
  B1:  { en: "Belgium — Jupiler Pro League",es: "Bélgica — Jupiler Pro League" },
  SC0: { en: "Scotland — Premiership",     es: "Escocia — Premiership" },
  T1:  { en: "Turkey — Süper Lig",         es: "Turquía — Süper Lig" },
};

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

function normaliseMatch(m) {
  return {
    ...m,
    date: toIsoDate(m.date),
    hg: Number(m.hg),
    ag: Number(m.ag),
  };
}

function matchKey(m) {
  return `${m.date || ""}|${m.home}|${m.away}`;
}

function sortMatches(a, b) {
  return (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99") ||
    (a.time || "").localeCompare(b.time || "") ||
    a.home.localeCompare(b.home);
}

function normaliseDatabase(data) {
  if (!data || typeof data !== "object") return data;
  for (const league of Object.values(data)) {
    if (!league?.seasons) continue;
    for (const season of Object.values(league.seasons)) {
      if (!Array.isArray(season.matches)) continue;
      season.matches = season.matches.map(normaliseMatch).sort(sortMatches);
    }
  }
  return data;
}

/**
 * Load the historical match database. Throws when real data is unavailable.
 * Set { allowSynthetic: true } only for an explicitly-labelled demo.
 */
export async function loadMatchData(options = {}) {
  if (_cache && !options.force) return _cache;

  try {
    const res = await fetch("./data/matches.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _cache = normaliseDatabase(await res.json());
    console.log("✅ Loaded real historical match data from matches.json");
    return _cache;
  } catch (err) {
    if (!options.allowSynthetic) {
      throw new Error(
        `Could not load ./data/matches.json (${err.message}). ` +
        `Run "npm run fetch-data" in the project folder, then reload. ` +
        `Synthetic data is disabled so real predictions are never mixed with generated matches.`
      );
    }
    console.warn("⚠️ Using explicitly-requested synthetic demo data.", err.message);
    _cache = generateFallbackData();
    _cache._synthetic = true;
    return _cache;
  }
}

/** Load the current-season fixtures/results snapshot. Returns null if absent. */
export async function loadLiveData() {
  if (_liveCache) return _liveCache;
  try {
    const res = await fetch("./data/live.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _liveCache = await res.json();
    console.log("✅ Loaded current-season fixtures/results snapshot");
    return _liveCache;
  } catch (err) {
    console.warn("⚠️ Could not load live.json:", err.message);
    return null;
  }
}

/**
 * Merge finished current-season matches into the historical database so they
 * can be used for predictions. Only matches with a real final score are added.
 */
export function mergeLiveResults(data, live) {
  const result = { data, added: 0, perLeague: {} };
  if (!data || !live?.leagues) return result;

  // Clone only the touched path so React can detect state updates.
  const nextData = { ...data };

  for (const [leagueId, liveLeague] of Object.entries(live.leagues)) {
    const finished = (liveLeague.matches || []).filter(
      (m) => m.status === "finished" && Number.isFinite(Number(m.hg)) && Number.isFinite(Number(m.ag))
    );
    if (!finished.length) continue;

    const baseLeague = nextData[leagueId] || {
      country: liveLeague.country || leagueId,
      league: liveLeague.league || leagueId,
      seasons: {},
    };
    const league = { ...baseLeague, seasons: { ...(baseLeague.seasons || {}) } };
    nextData[leagueId] = league;

    const seasonKey = liveLeague.season;
    const baseSeason = league.seasons[seasonKey] || {
      year: parseInt(String(seasonKey).slice(0, 4), 10) + 1,
      matches: [],
      source: liveLeague.source,
      sources: [liveLeague.source],
    };
    const season = { ...baseSeason, matches: [...(baseSeason.matches || [])] };
    league.seasons[seasonKey] = season;

    const existing = new Map(season.matches.map((m) => [matchKey(m), normaliseMatch(m)]));
    const before = existing.size;

    for (const m of finished) {
      const normalised = normaliseMatch({
        ...m,
        result: m.hg > m.ag ? "H" : m.hg < m.ag ? "A" : "D",
      });
      existing.set(matchKey(normalised), normalised);
    }

    season.matches = [...existing.values()].sort(sortMatches);
    season.liveUpdatedAt = live.generatedAt;
    season.sources = [...new Set([...(season.sources || []), liveLeague.source])];
    const added = season.matches.length - before;
    result.added += added;
    result.perLeague[leagueId] = { season: seasonKey, added, matches: finished.length };
  }

  if (result.added > 0) {
    console.log(`✅ Merged ${result.added} finished current-season matches from free live sources`);
  }
  result.data = nextData;
  return result;
}

/** Convenience accessor used by the UI. */
export function getLeagueLive(live, leagueId) {
  if (!live?.leagues?.[leagueId]) {
    return {
      available: false,
      reason: live?.unavailable?.[leagueId]?.reason || "No current-season snapshot loaded.",
    };
  }
  return { available: true, ...live.leagues[leagueId] };
}

/** Human-readable status for the data banner and the Data tab. */
export function getDataStatus(data, live, leagueId) {
  const currentSeason = live?.season || null;
  let totalMatches = 0;
  let seasons = 0;
  let historicalMatches = 0;
  let historicalSeasons = 0;
  let currentMatches = 0;
  let earliest = "";
  let latest = "";
  let lastMatchDate = "";
  const sources = new Set();
  const historicalSources = new Set();
  const currentSources = new Set();

  for (const league of Object.values(data || {})) {
    if (!league?.seasons) continue;
    for (const [seasonName, season] of Object.entries(league.seasons)) {
      if (!Array.isArray(season.matches)) continue;
      totalMatches += season.matches.length;
      seasons++;
      const isCurrent = currentSeason && seasonName === currentSeason;
      if (isCurrent) {
        currentMatches += season.matches.length;
        if (season.source) currentSources.add(season.source);
        for (const s of season.sources || []) currentSources.add(s);
      } else {
        historicalMatches += season.matches.length;
        historicalSeasons++;
        if (!earliest || seasonName < earliest) earliest = seasonName;
        if (!latest || seasonName > latest) latest = seasonName;
        if (season.source) historicalSources.add(season.source);
        for (const s of season.sources || []) historicalSources.add(s);
        const last = [...season.matches].reverse().find((m) => m.date);
        if (last?.date && last.date > lastMatchDate) lastMatchDate = last.date;
      }
      if (season.source) sources.add(season.source);
      for (const s of season.sources || []) sources.add(s);
    }
  }

  const leagueData = data?.[leagueId];
  const leagueSeasons = leagueData?.seasons ? Object.keys(leagueData.seasons).sort() : [];
  const leagueLive = getLeagueLive(live, leagueId);
  const lastLiveDate = leagueLive.available
    ? [...(leagueLive.matches || [])].reverse().find((m) => m.status === "finished")?.date || null
    : null;

  return {
    totalMatches,
    seasons,
    historicalMatches,
    historicalSeasons,
    currentMatches,
    earliest,
    latest,
    lastMatchDate,
    sources: [...sources],
    historicalSources: [...historicalSources],
    currentSources: [...currentSources],
    historicalFetchedAt: leagueData?.fetchedAt || null,
    currentSeason,
    leagueSeasons,
    leagueLive,
    liveGeneratedAt: live?.generatedAt || null,
    lastLiveDate,
    synthetic: !!data?._synthetic,
    liveAgeHours: live?.generatedAt
      ? Math.max(0, (Date.now() - new Date(live.generatedAt).getTime()) / 3600000)
      : null,
  };
}

/**
 * Matches strictly before a date (YYYY-MM-DD). Used to guarantee that a
 * prediction only sees information available before kick-off.
 */
export function getMatchesBefore(matches, beforeDate) {
  if (!beforeDate) return matches;
  return matches.filter((m) => m.date && m.date < beforeDate);
}

/**
 * Load team badge URLs from badges.json. Missing badges are not an error;
 * the UI falls back to coloured monograms.
 */
export async function loadBadges() {
  if (_badgeCache) return _badgeCache;
  try {
    const res = await fetch("./data/badges.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _badgeCache = await res.json();
    console.log("✅ Loaded team badges");
    return _badgeCache;
  } catch (err) {
    console.warn("⚠️ Could not load badges.json, using monograms.", err.message);
    _badgeCache = {};
    return _badgeCache;
  }
}

export function getBadgeUrl(badges, teamName) {
  if (!badges || !teamName) return null;
  if (badges[teamName]) return badges[teamName];
  const lower = teamName.toLowerCase();
  for (const [key, url] of Object.entries(badges)) {
    if (key.toLowerCase() === lower) return url;
  }
  for (const [key, url] of Object.entries(badges)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) return url;
  }
  return null;
}

export function getSeasons(data, leagueId) {
  if (!data || !data[leagueId]) return [];
  return Object.keys(data[leagueId].seasons).sort().reverse();
}

export function getTeams(data, leagueId, season) {
  const matches = getMatches(data, leagueId, season);
  const set = new Set();
  matches.forEach((m) => { set.add(m.home); set.add(m.away); });
  return [...set].sort();
}

export function getMatches(data, leagueId, season) {
  if (!data?.[leagueId]?.seasons?.[season]) return [];
  return data[leagueId].seasons[season].matches;
}

export function getAvailableLeagues(data) {
  if (!data) return [];
  return Object.keys(data).filter((id) => {
    const seasons = data[id]?.seasons;
    return seasons && Object.keys(seasons).length > 0;
  });
}

// ── Explicit synthetic demo generator ──────────────────────────────
// Only reachable with ?synthetic=1. It is never used silently.

const TEAM_POOLS = {
  E0: ["Arsenal","Aston Villa","Bournemouth","Brentford","Brighton","Burnley","Chelsea","Crystal Palace","Everton","Fulham","Liverpool","Luton","Man City","Man United","Newcastle","Nott'm Forest","Sheffield United","Tottenham","West Ham","Wolves"],
  SP1: ["Almería","Athletic Bilbao","Atlético Madrid","Barcelona","Betis","Cádiz","Celta Vigo","Getafe","Girona","Granada","Las Palmas","Mallorca","Osasuna","Rayo Vallecano","Real Madrid","Real Sociedad","Sevilla","Valencia","Villarreal","Alavés"],
  D1: ["Augsburg","Bayern Munich","Bochum","Dortmund","Ein Frankfurt","FC Köln","Freiburg","Heidenheim","Hoffenheim","Leverkusen","Mainz","M'gladbach","RB Leipzig","Stuttgart","Union Berlin","Werder Bremen","Wolfsburg","Darmstadt"],
  I1: ["AC Milan","Atalanta","Bologna","Cagliari","Empoli","Fiorentina","Frosinone","Genoa","Hellas Verona","Inter","Juventus","Lazio","Lecce","Monza","Napoli","Roma","Salernitana","Sassuolo","Torino","Udinese"],
  F1: ["Brest","Clermont","Le Havre","Lens","Lille","Lorient","Lyon","Marseille","Metz","Monaco","Montpellier","Nantes","Nice","PSG","Reims","Rennes","Strasbourg","Toulouse"],
};

function generateFallbackData() {
  const data = {};
  const seasons = [];
  for (let y = 2012; y <= 2024; y++) {
    seasons.push({ name: `${y}/${y + 1}`, year: y + 1 });
  }

  for (const [leagueId, teams] of Object.entries(TEAM_POOLS)) {
    const info = LEAGUES[leagueId];
    data[leagueId] = {
      country: info?.en?.split(" — ")[0] || leagueId,
      league: info?.en?.split(" — ")[1] || "League",
      synthetic: true,
      seasons: {},
    };

    for (const season of seasons) {
      const seed = hashCode(leagueId + season.name);
      const rng = seedRng(seed);
      const n = teams.length;
      const strengths = teams.map(() => 0.5 + rng() * 1.5);
      const defenses = teams.map(() => 0.5 + rng() * 1.0);
      const matches = [];

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const lambdaH = Math.max(0.3, strengths[i] * defenses[j] * 1.25 * (0.8 + rng() * 0.4));
          const lambdaA = Math.max(0.2, strengths[j] * defenses[i] * (0.8 + rng() * 0.4));
          const hg = poissonRng(lambdaH, rng);
          const ag = poissonRng(lambdaA, rng);
          matches.push({
            home: teams[i],
            away: teams[j],
            hg, ag,
            result: hg > ag ? "H" : hg < ag ? "A" : "D",
            date: "",
          });
        }
      }

      data[leagueId].seasons[season.name] = { year: season.year, matches, synthetic: true };
    }
  }

  return data;
}

function poissonRng(lambda, rng) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function seedRng(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}
