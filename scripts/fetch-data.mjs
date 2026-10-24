#!/usr/bin/env node
/**
 * fetch-data.mjs
 *
 * Downloads historical match results and saves public/data/matches.json.
 *
 * Primary source:  https://www.football-data.co.uk (free, no key)
 * Fallback source: https://github.com/openfootball/football.json (free, public
 *                  domain) used when football-data.co.uk is unreachable or a
 *                  season is missing.
 *
 * Existing data is never deleted. New download results are merged into the
 * bundled dataset, so a network failure cannot wipe the working data.
 *
 * Usage:
 *   node scripts/fetch-data.mjs
 *   node scripts/fetch-data.mjs --start 2025 --end 2026
 *   node scripts/fetch-data.mjs --leagues E0,SP1
 *   node scripts/fetch-data.mjs --no-football-data   # openfootball only
 *
 * Seasons are European seasons. --end is exclusive, so
 * `--start 2025 --end 2026` downloads 2025/2026 only.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Papa from "papaparse";
import {
  LEAGUES,
  buildSeasons,
  currentSeasonStart,
  resultFromGoals,
  toIsoDate,
} from "./leagueConfig.mjs";
import { resolveTeam } from "./teamNames.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "public", "data");
const MATCHES_PATH = path.join(OUTPUT_DIR, "matches.json");
const NOW = new Date().toISOString();

// ── CLI ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let selectedLeagues = Object.keys(LEAGUES);
let startYear = 2012;
let endYear = currentSeasonStart(); // exclusive: 2026 means up to 2025/26
let useFootballData = true;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--leagues" && args[i + 1]) {
    selectedLeagues = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
  } else if (args[i] === "--start" && args[i + 1]) {
    startYear = parseInt(args[++i], 10);
  } else if (args[i] === "--end" && args[i + 1]) {
    endYear = parseInt(args[++i], 10);
  } else if (args[i] === "--no-football-data") {
    useFootballData = false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────
function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(MATCHES_PATH, "utf8"));
  } catch {
    return null;
  }
}

function matchKey(m) {
  return `${m.date || ""}|${m.home}|${m.away}`;
}

function sortMatches(a, b) {
  return (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99") ||
    (a.time || "").localeCompare(b.time || "") ||
    a.home.localeCompare(b.home);
}

function normaliseMatch(m) {
  return {
    ...m,
    date: toIsoDate(m.date),
    hg: Number(m.hg),
    ag: Number(m.ag),
    result: m.result || resultFromGoals(Number(m.hg), Number(m.ag)),
  };
}

function mergeMatches(existing = [], incoming = []) {
  const map = new Map();
  for (const raw of existing) {
    const m = normaliseMatch(raw);
    if (!m.home || !m.away || !Number.isFinite(m.hg) || !Number.isFinite(m.ag)) continue;
    map.set(matchKey(m), m);
  }
  for (const raw of incoming) {
    const m = normaliseMatch(raw);
    if (!m.home || !m.away || !Number.isFinite(m.hg) || !Number.isFinite(m.ag)) continue;
    map.set(matchKey(m), m);
  }
  return [...map.values()].sort(sortMatches);
}

async function fetchText(url, timeoutMs = 10000) {
  const res = await fetch(url, {
    headers: { "User-Agent": "poisson-football/2.0 (local research project)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// ── football-data.co.uk ────────────────────────────────────────────
let footballDataReachable = useFootballData;
let footballDataWarningShown = false;

function parseFootballDataCsv(csv) {
  const parsed = Papa.parse(csv.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const matches = [];
  for (const row of parsed.data) {
    const home = row.HomeTeam || row.HT || "";
    const away = row.AwayTeam || row.AT || "";
    const hg = parseInt(row.FTHG ?? row.HG ?? "", 10);
    const ag = parseInt(row.FTAG ?? row.AG ?? "", 10);
    if (!home || !away || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;

    matches.push({
      home,
      away,
      hg,
      ag,
      result: row.FTR || resultFromGoals(hg, ag),
      date: toIsoDate(row.Date),
      time: (row.Time || "").trim(),
    });
  }
  return matches;
}

async function fetchFootballData(leagueId, season) {
  if (!footballDataReachable) return null;
  const url = `https://www.football-data.co.uk/mmz4281/${season.footballDataId}/${leagueId}.csv`;
  try {
    const csv = await fetchText(url, 8000);
    const matches = parseFootballDataCsv(csv);
    if (!matches.length) throw new Error("CSV contained no completed matches");
    return { matches, url, source: "football-data.co.uk" };
  } catch (err) {
    const message = String(err?.message || err);
    // A timeout / DNS / connection failure means the site is unreachable.
    // Stop hammering it for every league and season; keep going with the
    // openfootball fallback.
    if (/timeout|fetch failed|connect|ENOTFOUND|EAI_AGAIN|ECONN|UND_ERR/i.test(message)) {
      footballDataReachable = false;
      if (!footballDataWarningShown) {
        footballDataWarningShown = true;
        console.warn(`\n⚠️  football-data.co.uk is unreachable from this network (${message}).`);
        console.warn("    Continuing with the free openfootball fallback and the bundled data.\n");
      }
    } else {
      console.warn(`      football-data.co.uk: ${message}`);
    }
    return null;
  }
}

// ── openfootball fallback ──────────────────────────────────────────
async function fetchOpenFootball(leagueId, season) {
  const code = LEAGUES[leagueId]?.openfootball;
  if (!code) return null;
  const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${season.openFootballId}/${code}.1.json`;
  try {
    const text = await fetchText(url, 15000);
    const json = JSON.parse(text);
    const matches = [];
    for (const m of json.matches || []) {
      let ft = m.score;
      if (ft && !Array.isArray(ft)) ft = ft.ft;
      if (!Array.isArray(ft) || ft.length < 2) continue;
      const hg = Number(ft[0]);
      const ag = Number(ft[1]);
      if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
      const home = resolveTeam(leagueId, m.team1);
      const away = resolveTeam(leagueId, m.team2);
      if (!home.matched) console.warn(`      unknown team (${leagueId}): ${m.team1}`);
      if (!away.matched) console.warn(`      unknown team (${leagueId}): ${m.team2}`);
      matches.push({
        home: home.name,
        away: away.name,
        hg,
        ag,
        result: resultFromGoals(hg, ag),
        date: toIsoDate(m.date),
        time: m.time || "",
        round: m.round || "",
      });
    }
    if (!matches.length) return null;
    return { matches, url, source: "openfootball/football.json" };
  } catch (err) {
    return null;
  }
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log("🏟️  Poisson & Football — Historical Data Fetcher");
  console.log(`   Leagues: ${selectedLeagues.join(", ")}`);
  console.log(`   Seasons: ${startYear}/${startYear + 1} → ${endYear - 1}/${endYear}`);
  console.log(`   Primary: ${useFootballData ? "football-data.co.uk" : "disabled"} | Fallback: openfootball`);
  console.log("");

  const existing = readExisting();
  const allData = existing || {};
  const seasons = buildSeasons(startYear, endYear);
  let totalAdded = 0;
  const report = { generatedAt: NOW, seasons: {}, failures: [] };

  for (const leagueId of selectedLeagues) {
    const info = LEAGUES[leagueId];
    if (!info) {
      console.warn(`⚠️  Unknown league: ${leagueId}`);
      continue;
    }

    if (!allData[leagueId] || typeof allData[leagueId] !== "object") {
      allData[leagueId] = { country: info.country, league: info.league, seasons: {} };
    }
    const leagueData = allData[leagueId];
    leagueData.country = info.country;
    leagueData.league = info.league;
    leagueData.seasons = leagueData.seasons || {};
    leagueData.sources = new Set(leagueData.sources || []);
    leagueData.fetchedAt = NOW;

    for (const season of seasons) {
      const existingSeason = leagueData.seasons[season.name] || { year: season.startYear + 1, matches: [] };
      const existingCount = existingSeason.matches?.length || 0;

      process.stdout.write(`   📥 ${info.country} ${season.name}... `);
      let downloaded = await fetchFootballData(leagueId, season);
      if (!downloaded) downloaded = await fetchOpenFootball(leagueId, season);

      if (downloaded && downloaded.matches.length) {
        const merged = mergeMatches(existingSeason.matches, downloaded.matches);
        const added = Math.max(0, merged.length - existingCount);
        totalAdded += added;
        leagueData.seasons[season.name] = {
          year: season.startYear + 1,
          matches: merged,
          source: downloaded.source,
          sourceUrl: downloaded.url,
          downloadedAt: NOW,
          sources: [...new Set([...(existingSeason.sources || []), downloaded.source])],
        };
        leagueData.sources.add(downloaded.source);
        console.log(`✅ ${downloaded.matches.length} downloaded, ${merged.length} total (${added} new) [${downloaded.source}]`);
        report.seasons[`${leagueId}/${season.name}`] = {
          league: info.league,
          season: season.name,
          source: downloaded.source,
          downloaded: downloaded.matches.length,
          total: merged.length,
          added,
        };
      } else if (existingCount > 0) {
        // Keep the bundled data. Normalise dates/sort in place.
        leagueData.seasons[season.name] = {
          ...existingSeason,
          matches: mergeMatches(existingSeason.matches, []),
          source: existingSeason.source || "bundled snapshot",
          sources: existingSeason.sources || [existingSeason.source || "bundled snapshot"],
        };
        for (const s of leagueData.seasons[season.name].sources) leagueData.sources.add(s);
        console.log(`⚠️  download unavailable — kept ${existingCount} bundled matches`);
        report.failures.push({ league: leagueId, season: season.name, kept: existingCount });
      } else {
        console.log("⚠️  no data available");
        report.failures.push({ league: leagueId, season: season.name, kept: 0 });
      }

      await new Promise((r) => setTimeout(r, 150));
    }

    leagueData.sources = [...leagueData.sources];
    // Sort seasons oldest → newest.
    const ordered = {};
    for (const key of Object.keys(leagueData.seasons).sort()) ordered[key] = leagueData.seasons[key];
    leagueData.seasons = ordered;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(MATCHES_PATH, JSON.stringify(allData));

  let totalMatches = 0;
  let totalLeagueSeasons = 0;
  for (const league of Object.values(allData)) {
    if (!league?.seasons) continue;
    for (const season of Object.values(league.seasons)) {
      totalMatches += season.matches?.length || 0;
      totalLeagueSeasons++;
    }
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "data-report.json"),
    JSON.stringify({ ...report, totalMatches, totalLeagueSeasons, footballDataReachable }, null, 2)
  );

  console.log("");
  console.log(`✅ Done! ${totalMatches.toLocaleString()} matches across ${totalLeagueSeasons} league-seasons`);
  console.log(`   ${totalAdded.toLocaleString()} new matches added this run`);
  console.log(`   → ${MATCHES_PATH}`);
  if (!footballDataReachable) {
    console.log("");
    console.log("ℹ️  football-data.co.uk could not be reached; openfootball/public-domain data and the");
    console.log("   existing bundled dataset were used instead. Re-run later to try football-data again.");
  }
  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
