# ⚽ Poisson & Football

**Mathematical models for predicting football (soccer) match outcomes.**

A modern, bilingual (EN/ES) web application that implements five statistical models for football score prediction, all computed client-side in the browser. It ships with real historical results and an optional current-season fixtures/results snapshot.

![Models](https://img.shields.io/badge/models-5-22d3ee) ![Language](https://img.shields.io/badge/bilingual-EN%20%7C%20ES-a78bfa) ![Framework](https://img.shields.io/badge/React-18-61dafb) ![License](https://img.shields.io/badge/license-MIT-f472b6)

## Models

| Model | Year | Key Idea |
|-------|------|----------|
| **Maher** | 1982 | Independent Poisson — each team has attack/defense ratings |
| **Dixon-Coles** | 1997 | Corrects Maher's underestimation of low-scoring matches (0-0, 1-0, 0-1, 1-1) via parameter ρ |
| **Dixon-Coles TD** | 1997* | Adds exponential time decay so recent matches influence parameters more |
| **Bivariate Poisson** | 2003 | Karlis & Ntzoufras — models correlation between home/away goals via shared Poisson component λ₃ |
| **Negative Binomial** | — | Handles overdispersion (when goal variance exceeds the mean) with extra parameter r |

## Features

- **Match Simulator** — Pick any two teams, get win/draw/loss probabilities, expected goals, score probability heatmap, and simulate individual matches
- **Explain like I’m 5** — A short, plain-language guide inside the simulator that explains what the numbers mean
- **Livescores** — Auto-refreshing worldwide football scores every 60 seconds, with a filter for the app’s 10 leagues
- **Season Predictor** — Full predicted league table vs actual standings, side by side
- **Model Assumptions** — Home advantage analysis, Poisson goodness-of-fit histograms, dispersion checks
- **Model Reference** — Interactive cards with mathematical formulations for each model
- **Data & Tests** — Data freshness, per-league coverage, fixtures/recent results, and a chronological backtest panel
- **Bilingual** — Toggle between English and Spanish
- **10 Leagues** — Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga, Jupiler Pro League, Scottish Premiership, Süper Lig

## Deploy as an installable PWA on Netlify or Vercel

The app can be deployed to either host from this repository. Netlify and Vercel builds use the site root (`/`) so the PWA manifest and service worker work at the deployed domain. GitHub Pages keeps the `/poisson-football/` path.

### Netlify
1. Import this repository in Netlify. Build command: `npm run build`; publish directory: `dist` (also defined in `netlify.toml`).
2. In **Site configuration → Environment variables**, add `GEMINI_API_KEY` with your Google AI Studio API key. Optional: set `GEMINI_MODEL` (default `gemini-3.8-flash`; fallback attempts use `gemini-3.6-flash` and `gemini-3.5-flash-lite`).
3. Deploy. Netlify Functions are included under `netlify/functions`.

### Vercel
1. Import the repository in Vercel. The included `vercel.json` sets `npm run build` and output directory `dist`.
2. In **Settings → Environment Variables**, add `GEMINI_API_KEY`. Optional: add `GEMINI_MODEL` (default `gemini-3.8-flash`; fallback attempts use `gemini-3.6-flash` and `gemini-3.5-flash-lite`).
3. Redeploy after adding or changing variables. The Gemini endpoint is `api/gemini.js`.

### Gemini security and limits
- The API key stays on the hosting provider and is never bundled into the PWA or sent from the browser. Never add it to `VITE_*` variables or commit it to Git.
- The optional **Analyse with Gemini** button sends the selected teams, the existing Poisson probabilities, expected goals, and known fixture/data timestamps to a serverless endpoint. It requests Google Search grounding for recent context where supported. Search results can still be incomplete or out of date; check source links.
- The existing Poisson model remains the primary statistical calculation. Gemini is a second opinion, not a verified live scores feed and not a guarantee of accuracy.
- Google AI Studio availability, model access, quotas, and pricing vary by account and model. Check your current quota before using it heavily.

## Requirements

- **Node.js 18 or newer** (tested with Node 24.21.0)
- **npm** (comes with Node.js)
- No API keys, accounts, or paid services are required.

Check your versions:

```bash
node --version
npm --version
```

## Quick Start (Windows / macOS / Linux)

### 1. Install dependencies

```bash
cd poisson-football
npm install
```

### 2. Make sure the data files exist

The repository already contains:

- `public/data/matches.json` — real historical results
- `public/data/live.json` — current-season fixtures/results snapshot
- `public/data/validation.json` — backtest results shown in **Data & Tests**

If those files are present you can skip straight to step 3. To download/refresh the data yourself:

```bash
# Historical results (Football-Data.co.uk first, openfootball fallback)
npm run fetch-data

# Current season fixtures/results (FPL, OpenLigaDB, openfootball)
npm run fetch-live

# Both of the above
npm run refresh

# Everything, including team badges
npm run fetch-all
```

`fetch-data` never deletes the bundled dataset. It merges new downloads into `matches.json`, so a temporary network failure cannot wipe working data. `fetch-live` writes a complete snapshot each run.

### 3. Run the development server

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Open **http://127.0.0.1:5173/poisson-football/**

> The trailing `/poisson-football/` is required: `vite.config.js` sets that base path for GitHub Pages.

### 4. Build for production

```bash
npm run build
```

The built files go into `dist/` and can be deployed to GitHub Pages, Netlify, Vercel, etc. Keep the `/poisson-football/` base path unless you also change `base` in `vite.config.js`.

### 5. Install it as an app (PWA)

The project is now an installable **Progressive Web App**. It has a web manifest, app icons, and a service worker that caches the app shell and data for offline use.

Install on this PC (Chrome or Edge):

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/poisson-football/`, then click the **Install** icon in the address bar (or the browser menu → *Install Poisson & Football*).

Install on a phone:

- The app must be served over **HTTPS**. A plain LAN address such as `http://192.168.x.x` will not allow installation.
- Easiest option: push to `main` so the included GitHub Pages workflow deploys it, then open the Pages URL on the phone.
- Android Chrome: menu → **Add to Home screen** / **Install app**.
- iPhone Safari: Share button → **Add to Home Screen**.

Offline behaviour:

- The app shell, historical data, and KaTeX are cached, so predictions work offline.
- The **Livescores** tab still needs internet, because live scores are never cached.

The service worker is generated at build time. `npm run dev` does not register a service worker, so use `npm run build` + `npm run preview` when you want to test installation.

### Restarting after a reboot

```bash
cd "C:\Users\USER\Documents\Default Project\poisson-football"
npm run dev -- --host 127.0.0.1 --port 5173
```

Press `Ctrl+C` in the terminal to stop the server, then run the same command again. Dependencies do not need to be reinstalled unless `package.json` changed.

## Data Coverage

### Historical results

`matches.json` contains **44,888 real matches** across **10 leagues**, from **2012/2013 to 2025/2026**:

| League | ID | Historical coverage |
|---|---|---|
| England — Premier League | `E0` | 2012/13 → 2025/26, full |
| Spain — La Liga | `SP1` | 2012/13 → 2025/26, full |
| Germany — Bundesliga | `D1` | 2012/13 → 2025/26, full |
| Italy — Serie A | `I1` | 2012/13 → 2025/26, full |
| France — Ligue 1 | `F1` | 2012/13 → 2025/26, full |
| Netherlands — Eredivisie | `N1` | 2012/13 → 2025/26, full |
| Portugal — Primeira Liga | `P1` | 2012/13 → 2025/26, full |
| Belgium — Jupiler Pro League | `B1` | 2012/13 → 2025/26, 2024/25–2025/26 partial |
| Scotland — Premiership | `SC0` | 2012/13 → 2025/26, 2024/25–2025/26 partial |
| Turkey — Süper Lig | `T1` | 2012/13 → 2025/26, 2024/25–2025/26 partial |

The bundled data is a **snapshot**, not a live feed. The **Data & Tests** tab shows the file's source, last successful update time, and the date of the last match in the file.

### Current season (2026/2027)

`live.json` is generated by `npm run fetch-live`. At the time of writing (2026-10-21) it contains:

| League | Source | Fixtures | Finished | Live scores? |
|---|---|---|---|---|
| `E0` Premier League | Fantasy Premier League public API | 380 | 70 | ✅ scores (no goal times) |
| `SP1` La Liga | openfootball | 380 | 69 | ❌ fixtures/final results |
| `D1` Bundesliga | OpenLigaDB | 306 | 54 | ✅ scores + supplied goal events |
| `I1` Serie A | openfootball | 380 | 50 | ❌ fixtures/final results |
| `F1` Ligue 1 | openfootball | 306 | 45 | ❌ fixtures/final results |
| `N1` Eredivisie | openfootball | 306 | 63 | ❌ fixtures/final results |
| `P1` Primeira Liga | openfootball | 306 | 62 | ❌ fixtures/final results |
| `B1` Belgium | — | — | — | unavailable (no free 2026/27 file) |
| `SC0` Scotland | — | — | — | unavailable (no free 2026/27 file) |
| `T1` Turkey | — | — | — | unavailable (no free 2026/27 file) |

**Important live-data limitations**

- The browser does **not** call FPL or OpenLigaDB directly (those APIs do not send CORS headers). Data only changes when you run `npm run fetch-live`.
- `E0` updates are the closest to live: finished scores, in-progress scores when present, and kickoff times. Goal scorers/events are not provided by that endpoint.
- `D1` (OpenLigaDB) may include goal events, but refresh cadence is still manual.
- The openfootball leagues are **not live**. Their results can lag by days or weeks; on 2026-10-21 the latest result was 2026-09-20 (31 days old). The app labels these feeds as stale and tells you the lag in days.
- Belgium, Scotland, and Turkey have no current-season feed connected. Their historical data still works for predictions.

### Cup and international competitions are not included

The app stores the ten domestic leagues only. It does **not** store cup competitions such as the UEFA Champions League, Europa League, national cups, or friendlies.

That means:

- A match between clubs from two different leagues (for example a Serie A club versus a Premier League club in the Champions League) is **not** in the historical dataset.
- The Match Simulator only lists teams from the selected league and season, so such a cross-league fixture cannot be selected there.
- The **Livescores** tab can still show cup matches because its feed is competition-agnostic. They appear under **Other matches**, not under **Your leagues**.

### Livescores tab

The **Livescores** tab is separate from the prediction data. It calls the free TheSportsDB soccer livescore endpoint directly from the browser and refreshes every **60 seconds** while the tab is open.

- It shows live matches from around the world, with score, minute/status, league, and kick-off time.
- The **Only my 10 leagues** checkbox filters the feed to this app’s competitions.
- The free public test key can be rate-limited or temporarily unavailable. If the request fails, the app shows an error and does **not** invent scores.
- Livescore rows are not used to train or run the prediction models. Team names in this feed can differ from the historical data.
- Scores may be delayed, incomplete, or wrong. Always treat them as a convenience, not an official source.

## Data Sources and Terms

- **Football-Data.co.uk** — historical results and odds. Free for personal/research use; check the site's terms before redistributing. Used as the primary historical source; the bundled data is a snapshot because the site was unreachable from the build machine.
- **openfootball/football.json** — free, public-domain community data used as the historical fallback and for current-season fixtures in Spain, Italy, France, Netherlands, and Portugal.
- **Fantasy Premier League public API** — unofficial free endpoint used for Premier League current-season fixtures/scores. Respect its terms and avoid aggressive polling.
- **OpenLigaDB** — free community API used for Bundesliga current-season fixtures/scores/events.
- **TheSportsDB** — free public soccer livescore endpoint used by the **Livescores** tab. The app uses its public test key and polls at most once per minute. Check its terms before heavy or commercial use.

No paid API, API key, database, login, or subscription is required.

## Real Data Only (No Silent Synthetic Fallback)

The app no longer silently generates fake data. If `matches.json` is missing or empty, it shows an error screen with the commands needed to restore data.

For UI demos only, synthetic data can be explicitly enabled with:

```text
http://127.0.0.1:5173/poisson-football/?synthetic=1
```

When synthetic data is active, a red warning banner is displayed. Synthetic data is never presented as real.

## Validation and Backtesting

Run a chronological backtest:

```bash
npm run validate -- --leagues E0,SP1 --seasons 2024/2025,2025/2026
```

The backtest predicts each match using **only matches strictly before its date** (`asOf` filtering), so there is no future leakage. It reports log loss, Brier score, ranked probability score (RPS), and accuracy, and checks that:

- home/draw/away probabilities sum to 1
- the score-probability matrix sums to 1
- all probabilities are finite and non-negative

The same results are shown in the **Data & Tests** tab and stored in `public/data/validation.json`.

These metrics describe how the models scored on past data. They are **not** a claim of future accuracy, profitability, or betting edge.

## Project Structure

```
poisson-football/
├── public/
│   ├── data/
│   │   ├── matches.json      # Historical results (real data)
│   │   ├── live.json         # Current-season snapshot
│   │   ├── validation.json   # Backtest output
│   │   └── badges.json       # Team badge URLs
│   └── icons/                # PWA app icons (192, 512, maskable, Apple)
├── scripts/
│   ├── fetch-data.mjs        # Historical downloads + merge
│   ├── fetch-live.mjs        # Current-season snapshot
│   ├── validate.mjs          # Chronological backtest
│   ├── leagueConfig.mjs      # League IDs, seasons, date helpers
│   ├── teamNames.mjs         # Source-to-canonical team aliases
│   └── fetch-badges.mjs
├── src/
│   ├── App.jsx               # Main React component
│   ├── dataLoader.js         # Loading, live merge, data status
│   ├── livescores.js         # Browser livescore feed + team/league helpers
│   ├── i18n.js               # EN/ES translations
│   ├── main.jsx              # Entry point
│   └── models.js             # All 5 statistical models
├── index.html
├── package.json
└── vite.config.js
```

## Mathematical Background

All models assume that goals in a football match can be modeled as counts from a Poisson-family distribution. The core parameters estimated for each team are:

- **α (attack)** — how many goals a team scores relative to average
- **β (defense)** — how many goals a team concedes relative to average
- **γ (home advantage)** — the multiplicative boost for the home team

The expected goals for a match between home team *i* and away team *j* are:

```
λ_home = α_i × β_j × exp(γ)
λ_away = α_j × β_i
```

Parameters are estimated via iterative scaling (a simplified maximum likelihood approach).

## References

- Maher, M.J. (1982). *Modelling association football scores*. Statistica Neerlandica, 36(3), 109-118.
- Dixon, M.J. & Coles, S.G. (1997). *Modelling association football scores and inefficiencies in the football betting market*. Journal of the Royal Statistical Society: Series C, 46(2), 265-280.
- Karlis, D. & Ntzoufras, I. (2003). *Analysis of sports data by using bivariate Poisson models*. Journal of the Royal Statistical Society: Series D, 52(3), 381-393.

## License

MIT for the application code. Third-party data remains subject to its own terms (see **Data Sources and Terms**).

---

*Originally built as a thesis project at Facultad de Ciencias, UNAM — now modernized from R Shiny to React.*


### Gemini model fallback (updated)

The server-side Match AI Agent tries `GEMINI_MODEL` first (default `gemini-3.8-flash`), then `gemini-3.6-flash` and `gemini-3.5-flash-lite` as fallbacks. Availability can differ by Google account, project, region, and quota. The server logs attempted model IDs and errors; the public UI receives a user-friendly message rather than raw provider diagnostics. This feature cannot be confirmed against your Google project until a valid `GEMINI_API_KEY` is configured and a live request succeeds.
