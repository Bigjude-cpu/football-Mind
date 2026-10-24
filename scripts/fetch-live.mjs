#!/usr/bin/env node
/**
 * fetch-live.mjs
 *
 * Downloads current-season fixtures, results and (where the free source
 * supports it) in-play scores. Writes public/data/live.json.
 *
 * Free sources used (no API keys, no paid tier):
 *   E0  Premier League  -> Fantasy Premier League public API
 *   D1  Bundesliga      -> OpenLigaDB open data API
 *   SP1 I1 F1 N1 P1     -> openfootball/football.json (fixtures + final scores,
 *                          updated about once a day -- NOT live)
 *   B1 SC0 T1           -> openfootball if a current file exists; otherwise
 *                          reported as unavailable
 *
 * This script does not scrape restricted sites and does not invent results.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  LEAGUES,
  currentSeasonStart,
  openFootballSeasonId,
  seasonName,
  resultFromGoals,
} from "./leagueConfig.mjs";
import { resolveTeam } from "./teamNames.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "public", "data");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "live.json");

const NOW = new Date();
const NOW_ISO = NOW.toISOString();
const seasonStart = currentSeasonStart(NOW);
const season = seasonName(seasonStart);
const openFootballSeason = openFootballSeasonId(seasonStart);
const today = NOW_ISO.slice(0, 10);

const SOURCES = {
  fpl: {
    id: "fpl",
    name: "Fantasy Premier League public API",
    url: "https://fantasy.premierleague.com/api/fixtures/",
    leagues: ["E0"],
    provides: ["fixtures", "results", "in-play scores"],
    live: true,
    notes: "Free, no key. Match scores update during play; goal times are not exposed by this endpoint.",
  },
  openligadb: {
    id: "openligadb",
    name: "OpenLigaDB",
    url: "https://api.openligadb.de/",
    leagues: ["D1"],
    provides: ["fixtures", "results", "in-play scores", "goal events"],
    live: true,
    notes: "Free open data, no key. Bundesliga only. Updates during matches.",
  },
  openfootball: {
    id: "openfootball",
    name: "openfootball/football.json",
    url: "https://github.com/openfootball/football.json",
    leagues: ["SP1", "I1", "F1", "N1", "P1", "B1", "SC0", "T1"],
    provides: ["fixtures", "final results"],
    live: false,
    notes: "Free public-domain data. Updated about once a day; not a live feed.",
  },
};

async function fetchJson(url, timeoutMs = 20000) {
  const res = await fetch(url, {
    headers: { "User-Agent": "poisson-football/2.0 (local research project)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function isoOrDate(date, time) {
  if (!date) return "";
  if (time && /^\d{1,2}:\d{2}/.test(time)) {
    return `${date}T${time.slice(0, 5)}:00`;
  }
  return `${date}T00:00:00`;
}

function counts(matches) {
  return {
    total: matches.length,
    finished: matches.filter((m) => m.status === "finished").length,
    live: matches.filter((m) => m.status === "live").length,
    scheduled: matches.filter((m) => m.status === "scheduled" || m.status === "delayed").length,
    awaitingResult: matches.filter((m) => m.status === "awaiting-result").length,
  };
}

function sortMatches(a, b) {
  return (a.kickoff || a.date || "").localeCompare(b.kickoff || b.date || "");
}

// ── Premier League via Fantasy Premier League API ──────────────────
async function fetchFpl() {
  const [bootstrap, fixtures] = await Promise.all([
    fetchJson("https://fantasy.premierleague.com/api/bootstrap-static/"),
    fetchJson("https://fantasy.premierleague.com/api/fixtures/"),
  ]);

  const teams = new Map(bootstrap.teams.map((t) => [t.id, t.name]));
  const matches = [];

  for (const f of fixtures) {
    const homeSource = teams.get(f.team_h);
    const awaySource = teams.get(f.team_a);
    if (!homeSource || !awaySource) continue;

    const home = resolveTeam("E0", homeSource);
    const away = resolveTeam("E0", awaySource);
    if (!home.matched) console.warn(`   unknown FPL team: ${homeSource}`);
    if (!away.matched) console.warn(`   unknown FPL team: ${awaySource}`);

    const kickoff = f.kickoff_time || "";
    let status;
    if (f.finished || f.finished_provisional) status = "finished";
    else if (f.started) status = "live";
    else if (kickoff && new Date(kickoff).getTime() < NOW.getTime() - 3 * 60 * 60 * 1000) status = "delayed";
    else status = "scheduled";

    const hasScore = status === "finished" || status === "live";
    let goalHome = 0;
    let goalAway = 0;
    for (const stat of f.stats || []) {
      if (stat.identifier !== "goals_scored") continue;
      goalHome = (stat.h || []).reduce((sum, g) => sum + (g.value || 0), 0);
      goalAway = (stat.a || []).reduce((sum, g) => sum + (g.value || 0), 0);
    }

    matches.push({
      home: home.name,
      away: away.name,
      date: kickoff ? kickoff.slice(0, 10) : "",
      kickoff,
      hg: hasScore ? f.team_h_score : null,
      ag: hasScore ? f.team_a_score : null,
      status,
      minute: f.finished ? 90 : f.started ? f.minutes : null,
      round: f.event ? `Gameweek ${f.event}` : "",
      goalCountHome: hasScore ? goalHome : null,
      goalCountAway: hasScore ? goalAway : null,
      events: [],
      source: SOURCES.fpl.name,
      sourceUrl: SOURCES.fpl.url,
    });
  }

  matches.sort(sortMatches);
  return {
    league: LEAGUES.E0.league,
    country: LEAGUES.E0.country,
    season,
    source: SOURCES.fpl.name,
    sourceUrl: SOURCES.fpl.url,
    fetchedAt: NOW_ISO,
    liveSupported: true,
    eventsSupported: false,
    updateFrequency: "Scores update during matches; fixtures/status refresh when this script is run.",
    matches,
    warnings: ["Live scores only. Goal times/events are not provided by this endpoint."],
  };
}

// ── Bundesliga via OpenLigaDB ──────────────────────────────────────
async function fetchOpenLigaDb() {
  const url = `https://api.openligadb.de/getmatchdata/bl1/${seasonStart}`;
  const rows = await fetchJson(url);
  const matches = [];

  for (const row of rows) {
    const home = resolveTeam("D1", row.team1?.teamName || row.team1?.shortName);
    const away = resolveTeam("D1", row.team2?.teamName || row.team2?.shortName);
    if (!home.matched) console.warn(`   unknown OpenLigaDB team: ${row.team1?.teamName}`);
    if (!away.matched) console.warn(`   unknown OpenLigaDB team: ${row.team2?.teamName}`);

    const kickoff = row.matchDateTimeUTC || row.matchDateTime || "";
    const start = kickoff ? new Date(kickoff).getTime() : 0;
    let status;
    if (row.matchIsFinished) status = "finished";
    else if (start && NOW.getTime() >= start && NOW.getTime() <= start + 150 * 60 * 1000) status = "live";
    else if (start && NOW.getTime() < start) status = "scheduled";
    else if (start) status = "awaiting-result";
    else status = "scheduled";

    const final = (row.matchResults || []).find((r) => r.resultTypeID === 2 || r.resultName === "Endergebnis");
    let hg = final?.pointsTeam1 ?? null;
    let ag = final?.pointsTeam2 ?? null;

    const events = (row.goals || []).map((g) => ({
      minute: g.matchMinute,
      side: g.scoreTeam1 !== g.scoreTeam2
        ? (g.scoreTeam1 > g.scoreTeam2 ? "home" : "away")
        : null,
      scorer: g.goalGetterName,
      scoreHome: g.scoreTeam1,
      scoreAway: g.scoreTeam2,
      penalty: !!g.isPenalty,
      ownGoal: !!g.isOwnGoal,
    }));

    // During play OpenLigaDB often exposes the running score through goals.
    if (status === "live" && (hg === null || ag === null) && events.length) {
      hg = events[events.length - 1].scoreHome;
      ag = events[events.length - 1].scoreAway;
    }

    matches.push({
      home: home.name,
      away: away.name,
      date: kickoff ? kickoff.slice(0, 10) : "",
      kickoff,
      hg,
      ag,
      status,
      minute: status === "live" && start ? Math.min(90, Math.max(0, Math.floor((NOW.getTime() - start) / 60000))) : status === "finished" ? 90 : null,
      round: row.group?.groupName || "",
      events,
      source: SOURCES.openligadb.name,
      sourceUrl: url,
    });
  }

  matches.sort(sortMatches);
  return {
    league: LEAGUES.D1.league,
    country: LEAGUES.D1.country,
    season,
    source: SOURCES.openligadb.name,
    sourceUrl: url,
    fetchedAt: NOW_ISO,
    liveSupported: true,
    eventsSupported: true,
    updateFrequency: "Updates during matches; refresh this script to pull the latest snapshot.",
    matches,
    warnings: [],
  };
}

// ── Other leagues via openfootball ─────────────────────────────────
function extractScore(score) {
  if (!score) return null;
  const ft = Array.isArray(score) ? score : score.ft;
  if (!Array.isArray(ft) || ft.length < 2) return null;
  const hg = Number(ft[0]);
  const ag = Number(ft[1]);
  return Number.isFinite(hg) && Number.isFinite(ag) ? [hg, ag] : null;
}

async function fetchOpenFootballLeague(leagueId) {
  const info = LEAGUES[leagueId];
  const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${openFootballSeason}/${info.openfootball}.1.json`;

  let json;
  try {
    json = await fetchJson(url);
  } catch (err) {
    return {
      league: info.league,
      country: info.country,
      season,
      source: SOURCES.openfootball.name,
      sourceUrl: url,
      fetchedAt: NOW_ISO,
      liveSupported: false,
      eventsSupported: false,
      updateFrequency: "No current-season file available.",
      matches: [],
      warnings: [`No free current-season file found for ${season} (${String(err.message || err)}).`],
      unavailable: true,
    };
  }

  const matches = [];
  for (const m of json.matches || []) {
    const score = extractScore(m.score);
    const home = resolveTeam(leagueId, m.team1);
    const away = resolveTeam(leagueId, m.team2);
    if (!home.matched) console.warn(`   unknown openfootball team (${leagueId}): ${m.team1}`);
    if (!away.matched) console.warn(`   unknown openfootball team (${leagueId}): ${m.team2}`);

    const date = m.date || "";
    const kickoff = isoOrDate(date, m.time);
    let status;
    if (score) status = "finished";
    else if (date > today) status = "scheduled";
    else if (date === today) status = "scheduled";
    else status = "awaiting-result";

    matches.push({
      home: home.name,
      away: away.name,
      date,
      kickoff,
      hg: score ? score[0] : null,
      ag: score ? score[1] : null,
      status,
      minute: status === "finished" ? 90 : null,
      round: m.round || "",
      events: [],
      source: SOURCES.openfootball.name,
      sourceUrl: url,
    });
  }

  matches.sort(sortMatches);
  const warnings = ["Fixtures and final scores only; this source is updated about once a day and is not live."];
  if (matches.some((m) => m.status === "awaiting-result")) {
    warnings.push("Some matches have no result yet even though their date has passed. They may be rescheduled, postponed, or not yet entered upstream.");
  }

  const finished = matches.filter((m) => m.status === "finished" && m.date);
  const lastResultDate = finished.length ? finished[finished.length - 1].date : null;
  const lagDays = lastResultDate
    ? Math.max(0, Math.floor((NOW.getTime() - new Date(`${lastResultDate}T12:00:00Z`).getTime()) / 86400000))
    : null;
  const stale = lagDays !== null && lagDays > 3;
  if (stale) {
    warnings.push(`Latest result in this feed is ${lagDays} days old. Treat the table/results below as stale; this is not live data.`);
  }

  return {
    league: info.league,
    country: info.country,
    season,
    source: SOURCES.openfootball.name,
    sourceUrl: url,
    fetchedAt: NOW_ISO,
    liveSupported: false,
    eventsSupported: false,
    updateFrequency: "About once a day (upstream football.txt). Not live.",
    matches,
    warnings,
    stale,
    lagDays,
    lastResultDate,
    unavailable: matches.length === 0,
  };
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log("📡 Poisson & Football — Free Fixtures / Results Fetcher");
  console.log(`   Season: ${season}`);
  console.log(`   Sources: FPL (E0), OpenLigaDB (D1), openfootball (others)`);
  console.log("");

  const result = {
    generatedAt: NOW_ISO,
    season,
    seasonStart,
    sources: Object.values(SOURCES),
    leagues: {},
    unavailable: {},
  };

  const tasks = [];
  for (const leagueId of Object.keys(LEAGUES)) {
    if (leagueId === "E0") tasks.push(["E0", fetchFpl(), "openfootball"]);
    else if (leagueId === "D1") tasks.push(["D1", fetchOpenLigaDb(), "openfootball"]);
    else tasks.push([leagueId, null, "openfootball"]);
  }

  for (const [leagueId, primaryPromise] of tasks) {
    let data = null;
    let provider = "";
    if (primaryPromise) {
      try {
        data = await primaryPromise;
        provider = data.source;
      } catch (err) {
        console.warn(`   ⚠️  ${leagueId} primary feed failed (${err.message}); trying openfootball`);
      }
    }

    if (!data) {
      data = await fetchOpenFootballLeague(leagueId);
      provider = data.source;
    }

    if (!data.matches.length || data.unavailable) {
      result.unavailable[leagueId] = {
        league: LEAGUES[leagueId].league,
        country: LEAGUES[leagueId].country,
        reason: data.warnings?.[0] || "No free current-season fixture data found.",
        source: data.source,
      };
      console.log(`   ⚠️  ${LEAGUES[leagueId].country} ${LEAGUES[leagueId].league}: unavailable — ${data.warnings?.[0] || "no data"}`);
    } else {
      const c = counts(data.matches);
      const last = [...data.matches].reverse().find((m) => m.status === "finished");
      data.counts = c;
      data.lastResult = last ? { date: last.date, home: last.home, away: last.away, hg: last.hg, ag: last.ag } : null;
      data.lastResultDate = last?.date || null;
      data.lagDays = last?.date
        ? Math.max(0, Math.floor((NOW.getTime() - new Date(`${last.date}T12:00:00Z`).getTime()) / 86400000))
        : null;
      data.stale = data.lagDays !== null && data.lagDays > 3;
      if (data.stale && !data.warnings.some((w) => w.includes("days old"))) {
        data.warnings.push(`Latest result is ${data.lagDays} days old; verify freshness before relying on it.`);
      }
      data.nextFixture = data.matches.find((m) => m.status === "scheduled" || m.status === "delayed") || null;
      result.leagues[leagueId] = data;
      console.log(`   ✅ ${LEAGUES[leagueId].country} ${LEAGUES[leagueId].league}: ${c.total} matches (${c.finished} finished, ${c.live} live, ${c.scheduled} upcoming) — ${provider}`);
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log("");
  console.log(`✅ Saved ${Object.keys(result.leagues).length} league snapshots → ${OUTPUT_PATH}`);
  console.log(`   Last successful update: ${NOW_ISO}`);
  if (Object.keys(result.unavailable).length) {
    console.log(`   Unavailable current-season leagues: ${Object.keys(result.unavailable).join(", ")}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
