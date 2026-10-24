#!/usr/bin/env node
/**
 * validate.mjs
 *
 * Chronological backtest + prediction sanity checks.
 *
 * For every target match the model is trained only on matches that happened
 * strictly before it. No future information is used. Results are written to
 * public/data/validation.json and printed to the console.
 *
 * Usage:
 *   node scripts/validate.mjs
 *   node scripts/validate.mjs --leagues E0,SP1 --seasons 2023/2024,2024/2025,2025/2026
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MODEL_NAMES, predictMatch } from "../src/models.js";
import { toIsoDate } from "./leagueConfig.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_PATH = path.join(ROOT, "public", "data", "matches.json");
const LIVE_PATH = path.join(ROOT, "public", "data", "live.json");
const OUTPUT_PATH = path.join(ROOT, "public", "data", "validation.json");

const args = process.argv.slice(2);
let leagueIds = ["E0", "SP1"];
let seasonFilter = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--leagues" && args[i + 1]) leagueIds = args[++i].split(",").map((s) => s.trim());
  if (args[i] === "--seasons" && args[i + 1]) seasonFilter = args[++i].split(",").map((s) => s.trim());
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
let live = null;
try { live = JSON.parse(fs.readFileSync(LIVE_PATH, "utf8")); } catch { /* optional */ }

function outcome(hg, ag) {
  return hg > ag ? 0 : hg === ag ? 1 : 2;
}

function metricsFor(rows) {
  const n = rows.length || 1;
  return {
    matches: rows.length,
    logLoss: rows.reduce((s, r) => s + r.logLoss, 0) / n,
    brier: rows.reduce((s, r) => s + r.brier, 0) / n,
    rps: rows.reduce((s, r) => s + r.rps, 0) / n,
    accuracy: rows.filter((r) => r.correct).length / n,
    avgProbabilitySumError: rows.reduce((s, r) => s + Math.abs(r.probSum - 1), 0) / n,
  };
}

function scorePrediction(pred, hg, ag) {
  const p = [pred.pHome, pred.pDraw, pred.pAway];
  const y = outcome(hg, ag);
  const yv = [0, 0, 0];
  yv[y] = 1;

  const logLoss = -Math.log(Math.max(p[y], 1e-15));
  const brier = p.reduce((s, pi, i) => s + (pi - yv[i]) ** 2, 0);
  const cp1 = p[0];
  const cp2 = p[0] + p[1];
  const cy1 = yv[0];
  const cy2 = yv[0] + yv[1];
  const rps = ((cp1 - cy1) ** 2 + (cp2 - cy2) ** 2) / 2;
  const best = p.indexOf(Math.max(...p));

  return {
    logLoss,
    brier,
    rps,
    correct: best === y,
    probSum: p.reduce((s, x) => s + x, 0),
  };
}

function checkPrediction(pred) {
  const issues = [];
  if (!pred) return ["model returned null (a team may be missing from the training data)"];
  const probs = [pred.pHome, pred.pDraw, pred.pAway];
  if (probs.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) issues.push("outcome probability outside [0,1]");
  const sum = probs.reduce((s, p) => s + p, 0);
  if (Math.abs(sum - 1) > 1e-6) issues.push(`outcome probabilities sum to ${sum.toFixed(6)}`);
  if (!Number.isFinite(pred.lambdaH) || pred.lambdaH <= 0) issues.push("invalid home expected goals");
  if (!Number.isFinite(pred.lambdaA) || pred.lambdaA <= 0) issues.push("invalid away expected goals");
  if (!Array.isArray(pred.matrix) || pred.matrix.length !== 9) {
    issues.push("score matrix is not 9x9");
  } else {
    const flat = pred.matrix.flat();
    if (flat.some((p) => !Number.isFinite(p) || p < 0)) issues.push("negative/NaN score probability");
    const matrixSum = flat.reduce((s, p) => s + p, 0);
    if (Math.abs(matrixSum - 1) > 1e-6) issues.push(`score matrix sums to ${matrixSum.toFixed(6)}`);
  }
  if (!Number.isFinite(pred.mostLikelyProb) || pred.mostLikelyProb < 0 || pred.mostLikelyProb > 1) {
    issues.push("invalid most-likely score probability");
  }
  return issues;
}

function getSeasonMatches(leagueId, season) {
  const matches = data?.[leagueId]?.seasons?.[season]?.matches || [];
  return matches
    .map((m) => ({ ...m, date: toIsoDate(m.date) }))
    .filter((m) => m.date && Number.isFinite(Number(m.hg)) && Number.isFinite(Number(m.ag)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.home.localeCompare(b.home));
}

function backtestLeague(leagueId, seasons) {
  const perModel = Object.fromEntries(MODEL_NAMES.map((m) => [m, []]));
  const issues = [];
  let targets = 0;
  let skipped = 0;

  for (const season of seasons) {
    const matches = getSeasonMatches(leagueId, season);
    if (matches.length < 80) {
      issues.push(`${season}: only ${matches.length} matches, skipped`);
      continue;
    }
    const start = Math.min(60, Math.floor(matches.length * 0.3));
    process.stdout.write(`   ${leagueId} ${season}: ${matches.length} matches, ${matches.length - start} test targets... `);

    for (let i = start; i < matches.length; i++) {
      const target = matches[i];
      const prior = matches.slice(0, i); // strictly earlier matches only
      if (!prior.some((m) => m.home === target.home || m.away === target.home)) { skipped++; continue; }
      if (!prior.some((m) => m.home === target.away || m.away === target.away)) { skipped++; continue; }

      targets++;
      for (const model of MODEL_NAMES) {
        const pred = predictMatch(model, prior, target.home, target.away);
        const problems = checkPrediction(pred);
        if (problems.length) {
          if (issues.length < 20) issues.push(`${model} ${target.date} ${target.home}-${target.away}: ${problems.join("; ")}`);
          continue;
        }
        perModel[model].push(scorePrediction(pred, target.hg, target.ag));
      }
    }
    console.log("done");
  }

  return {
    leagueId,
    league: data?.[leagueId]?.league || leagueId,
    seasons,
    targets,
    skipped,
    models: Object.fromEntries(MODEL_NAMES.map((m) => [m, metricsFor(perModel[m])])),
    issues,
  };
}

function examplePredictions(leagueId, season) {
  const matches = getSeasonMatches(leagueId, season);
  const targets = matches.slice(-2);
  return targets.map((target) => {
    const prior = matches.filter((m) => m.date < target.date);
    const models = {};
    for (const model of MODEL_NAMES) {
      const pred = predictMatch(model, prior, target.home, target.away);
      models[model] = pred
        ? {
            pHome: pred.pHome,
            pDraw: pred.pDraw,
            pAway: pred.pAway,
            lambdaH: pred.lambdaH,
            lambdaA: pred.lambdaA,
            mostLikely: pred.mostLikely,
            mostLikelyProb: pred.mostLikelyProb,
            probabilitySum: pred.pHome + pred.pDraw + pred.pAway,
            matrixSum: pred.matrix.flat().reduce((s, p) => s + p, 0),
            checks: checkPrediction(pred),
          }
        : null;
    }
    return {
      leagueId,
      season,
      date: target.date,
      home: target.home,
      away: target.away,
      actual: { hg: target.hg, ag: target.ag, result: target.result },
      trainingMatches: prior.length,
      models,
    };
  });
}

function currentSeasonExamples(leagueId) {
  if (!live?.leagues?.[leagueId]) return [];
  const finished = live.leagues[leagueId].matches.filter((m) => m.status === "finished" && m.date);
  const targets = finished.slice(-1);
  return targets.map((target) => {
    const prior = finished.filter((m) => m.date < target.date).map((m) => ({
      home: m.home, away: m.away, hg: m.hg, ag: m.ag, date: m.date,
      result: m.hg > m.ag ? "H" : m.hg < m.ag ? "A" : "D",
    }));
    const models = {};
    for (const model of MODEL_NAMES) {
      const pred = prior.length ? predictMatch(model, prior, target.home, target.away) : null;
      models[model] = pred ? {
        pHome: pred.pHome, pDraw: pred.pDraw, pAway: pred.pAway,
        lambdaH: pred.lambdaH, lambdaA: pred.lambdaA,
        mostLikely: pred.mostLikely, mostLikelyProb: pred.mostLikelyProb,
        probabilitySum: pred.pHome + pred.pDraw + pred.pAway,
        matrixSum: pred.matrix.flat().reduce((s, p) => s + p, 0),
        checks: checkPrediction(pred),
      } : null;
    }
    return {
      leagueId, season: live.season, date: target.date, home: target.home, away: target.away,
      actual: { hg: target.hg, ag: target.ag, result: target.hg > target.ag ? "H" : target.hg < target.ag ? "A" : "D" },
      trainingMatches: prior.length, models, currentSeason: true,
    };
  });
}

function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error("matches.json not found. Run npm run fetch-data first.");
    process.exit(1);
  }

  console.log("🧪 Chronological model validation");
  console.log("   Each prediction uses only matches strictly before its kick-off date.");
  console.log("");

  const allSeasons = [...new Set(
    Object.keys(data?.E0?.seasons || {})
  )].sort();
  const seasons = seasonFilter || allSeasons.slice(-2);

  const results = [];
  for (const leagueId of leagueIds) {
    if (!data?.[leagueId]?.seasons) {
      console.warn(`⚠️  No historical data for ${leagueId}, skipping`);
      continue;
    }
    console.log(`\n📊 ${data[leagueId].league || leagueId}`);
    results.push(backtestLeague(leagueId, seasons));
  }

  const examples = [];
  for (const leagueId of leagueIds) {
    const lastSeason = [...Object.keys(data?.[leagueId]?.seasons || {})].sort().pop();
    if (lastSeason) examples.push(...examplePredictions(leagueId, lastSeason));
    examples.push(...currentSeasonExamples(leagueId));
  }

  const output = {
    generatedAt: new Date().toISOString(),
    method: "Expanding-window chronological backtest. For each target match, parameters are estimated only from earlier matches in the same league/season.",
    seasons,
    leagues: results,
    examples,
    warnings: [
      "Backtest accuracy is not a guarantee of future performance or profit.",
      "The 0..8 goal grid is truncated and then renormalised; extremely high-scoring tails are omitted.",
      "Current-season examples use only the small number of matches played so far and are less stable.",
    ],
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log("\n" + "─".repeat(86));
  console.log("Model performance (lower log loss / Brier / RPS is better)");
  for (const league of results) {
    console.log(`\n${league.league} — ${league.seasons.join(", ")} (${league.targets} targets)`);
    console.log("Model".padEnd(20), "LogLoss".padStart(9), "Brier".padStart(8), "RPS".padStart(8), "Accuracy".padStart(9));
    for (const model of MODEL_NAMES) {
      const m = league.models[model];
      console.log(
        model.padEnd(20),
        m.logLoss.toFixed(4).padStart(9),
        m.brier.toFixed(4).padStart(8),
        m.rps.toFixed(4).padStart(8),
        `${(m.accuracy * 100).toFixed(1)}%`.padStart(9)
      );
    }
  }
  console.log("\n" + "─".repeat(86));
  console.log(`✅ Wrote ${OUTPUT_PATH}`);
  const totalIssues = results.reduce((s, r) => s + r.issues.length, 0);
  if (totalIssues) console.log(`⚠️  ${totalIssues} validation issue(s) recorded in validation.json`);
  else console.log("✅ All checked probability sums and score matrices were valid.");
}

main();
