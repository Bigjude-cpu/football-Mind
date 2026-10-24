#!/usr/bin/env node
/**
 * predict-cross.mjs
 *
 * Predict a match between two clubs from DIFFERENT leagues using the app's own
 * models. The Match Simulator cannot do this because it only loads one league
 * at a time, so this script combines the selected leagues into one training set.
 *
 * IMPORTANT: the models have no concept of league strength. Combining two
 * leagues assumes their teams are directly comparable, which is a simplification.
 *
 * Usage:
 *   node scripts/predict-cross.mjs --home Como --away "Man United" \
 *     --leagues I1,E0 --asof 2026-10-21
 *
 * Options:
 *   --home      Home team name (required)
 *   --away      Away team name (required)
 *   --leagues   Comma-separated league IDs (default: I1,E0)
 *   --since     First season start year to include (default: current - 1)
 *   --asof      Only use matches strictly before this YYYY-MM-DD date
 *   --models    Comma-separated model names (default: all models)
 *   --json      Print JSON instead of a text table
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { predictMatch, MODEL_NAMES } from "../src/models.js";
import { currentSeasonStart, toIsoDate } from "./leagueConfig.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const homeName = arg("home");
const awayName = arg("away");
if (!homeName || !awayName) {
  console.error("Usage: node scripts/predict-cross.mjs --home Como --away \"Man United\" --leagues I1,E0 --asof 2026-10-21");
  process.exit(1);
}

const leagueIds = arg("leagues", "I1,E0").split(",").map((s) => s.trim()).filter(Boolean);
const sinceYear = parseInt(arg("since", String(currentSeasonStart() - 1)), 10);
const asOf = arg("asof", null);
const modelNames = arg("models", MODEL_NAMES.join(",")).split(",").map((s) => s.trim());
const asJson = args.includes("--json");

// Loose aliases so friendly names work ("Calcio Como", "Manchester United").
const ALIASES = {
  "calcio como": "Como",
  como: "Como",
  "manchester united": "Man United",
  "man united": "Man United",
  "man utd": "Man United",
  "manchester city": "Man City",
  "man city": "Man City",
};
function canonical(name) {
  const key = String(name || "").trim().toLowerCase();
  return ALIASES[key] || name;
}
const homeTeam = canonical(homeName);
const awayTeam = canonical(awayName);

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

const historical = readJson("public/data/matches.json");
const live = readJson("public/data/live.json");

/** Collect finished matches from the selected leagues since `sinceYear`. */
function collectTraining() {
  const out = [];

  for (const leagueId of leagueIds) {
    const league = historical[leagueId];
    if (!league?.seasons) continue;
    for (const [seasonName, season] of Object.entries(league.seasons)) {
      const startYear = parseInt(seasonName.slice(0, 4), 10);
      if (!Number.isFinite(startYear) || startYear < sinceYear) continue;
      for (const m of season.matches || []) {
        out.push({ home: m.home, away: m.away, hg: Number(m.hg), ag: Number(m.ag), date: toIsoDate(m.date) });
      }
    }

    // Current-season snapshot (finished matches only).
    const liveLeague = live?.leagues?.[leagueId];
    const currentSeason = live?.season;
    if (liveLeague && currentSeason) {
      const startYear = parseInt(currentSeason.slice(0, 4), 10);
      if (startYear >= sinceYear) {
        for (const m of liveLeague.matches || []) {
          if (m.status !== "finished") continue;
          if (!Number.isFinite(Number(m.hg)) || !Number.isFinite(Number(m.ag))) continue;
          out.push({ home: m.home, away: m.away, hg: Number(m.hg), ag: Number(m.ag), date: toIsoDate(m.date) });
        }
      }
    }
  }

  const seen = new Set();
  return out
    .filter((m) => {
      if (!m.home || !m.away || !m.date) return false;
      if (!Number.isFinite(m.hg) || !Number.isFinite(m.ag)) return false;
      if (asOf && !(m.date < asOf)) return false;
      const key = `${m.date}|${m.home}|${m.away}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

const training = collectTraining();
const present = new Set(training.flatMap((m) => [m.home, m.away]));

if (!present.has(homeTeam) || !present.has(awayTeam)) {
  console.error(`Cannot predict: ${!present.has(homeTeam) ? homeTeam : awayTeam} has no finished matches in the selected leagues/seasons.`);
  console.error(`Leagues: ${leagueIds.join(", ")} · since ${sinceYear} · asOf ${asOf || "now"}`);
  process.exit(2);
}

const results = modelNames.map((name) => {
  const r = predictMatch(name, training, homeTeam, awayTeam);
  return r ? { model: name, ...r } : { model: name, error: "model returned no result" };
});

if (asJson) {
  console.log(JSON.stringify({ home: homeTeam, away: awayTeam, leagues: leagueIds, asOf, trainingMatches: training.length, results }, null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (x, n = 2) => (Number.isFinite(x) ? x.toFixed(n) : "—");

console.log("");
console.log(`⚽ Cross-league prediction: ${homeTeam} vs ${awayTeam}`);
console.log(`   Leagues combined: ${leagueIds.join(" + ")} · training matches: ${training.length}`);
console.log(`   Data cutoff: ${asOf || "latest available"} (matches strictly before this date)`);
console.log("");
console.log(`${pad("Model", 18)} ${pad("Home", 8)} ${pad("Draw", 8)} ${pad("Away", 8)} ${pad("xG home", 8)} ${pad("xG away", 8)} Most likely`);
console.log("-".repeat(84));
for (const r of results) {
  if (r.error) {
    console.log(`${pad(r.model, 18)} ${r.error}`);
    continue;
  }
  console.log(
    `${pad(r.model, 18)} ${pad((r.pHome * 100).toFixed(1) + "%", 8)} ${pad((r.pDraw * 100).toFixed(1) + "%", 8)} ${pad((r.pAway * 100).toFixed(1) + "%", 8)} ${pad(num(r.lambdaH), 8)} ${pad(num(r.lambdaA), 8)} ${r.mostLikely[0]}–${r.mostLikely[1]} (${(r.mostLikelyProb * 100).toFixed(1)}%)`
  );
}
// ── Ensemble across the requested models ────────────────────────────
const valid = results.filter((r) => !r.error);
if (valid.length > 1) {
  const n = valid.length;
  const avg = (key) => valid.reduce((s, r) => s + r[key], 0) / n;
  const mat = Array.from({ length: 9 }, () => Array(9).fill(0));
  for (const r of valid) r.matrix.forEach((row, i) => row.forEach((p, j) => { mat[i][j] += p / n; }));
  const flat = [];
  mat.forEach((row, i) => row.forEach((p, j) => flat.push({ i, j, p })));
  flat.sort((a, b) => b.p - a.p);

  console.log(`${pad("ENSEMBLE", 18)} ${pad((avg("pHome") * 100).toFixed(1) + "%", 8)} ${pad((avg("pDraw") * 100).toFixed(1) + "%", 8)} ${pad((avg("pAway") * 100).toFixed(1) + "%", 8)} ${pad(num(avg("lambdaH")), 8)} ${pad(num(avg("lambdaA")), 8)} ${flat[0].i}–${flat[0].j} (${(flat[0].p * 100).toFixed(1)}%)`);
  console.log("");
  console.log("Top exact scores (ensemble):");
  for (const s of flat.slice(0, 5)) console.log(`   ${homeTeam} ${s.i}–${s.j} ${awayTeam}   ${(s.p * 100).toFixed(1)}%`);
}

console.log("");
console.log("⚠️  The models do not adjust for league strength. Combining leagues assumes");
console.log("    their teams are comparable. Treat this as an experiment, not a forecast.");
console.log("    Not betting advice.");
console.log("");
