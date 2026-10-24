const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function getModelCandidates(preferredModel) {
  const requested = String(preferredModel || DEFAULT_MODEL).trim();
  return [...new Set([requested, DEFAULT_MODEL, ...FALLBACK_MODELS].filter(Boolean))];
}

function isModelAvailabilityError(status, message = '') {
  const text = String(message).toLowerCase();
  return status === 404 ||
    ((status === 400 || status === 422) &&
      /(model|not found|not supported|unsupported|not available|does not exist)/i.test(text));
}

async function requestModel(modelId, apiKey, prompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
  let response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
      }),
    });
  } catch (error) {
    return { ok: false, model: modelId, status: 502, retryable: true, message: error?.message || 'Network error' };
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.error?.message || `HTTP ${response.status}`;
    const unavailable = isModelAvailabilityError(response.status, message);
    // Authentication/configuration errors cannot be fixed by trying another model.
    const retryable = unavailable || [429, 500, 502, 503, 504].includes(response.status);
    return { ok: false, model: modelId, status: response.status, retryable, message };
  }

  const candidate = result?.candidates?.[0];
  const analysis = (candidate?.content?.parts || [])
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .join('\n')
    .trim();

  if (!analysis) {
    return { ok: false, model: modelId, status: 502, retryable: true, message: 'The model returned an empty response.' };
  }

  const sources = (candidate?.groundingMetadata?.groundingChunks || [])
    .map((chunk) => chunk.web)
    .filter((web) => web?.uri)
    .map((web) => ({ title: String(web.title || web.uri).slice(0, 180), url: web.uri }))
    .filter((source, index, all) => all.findIndex((item) => item.url === source.url) === index)
    .slice(0, 8);

  return { ok: true, model: modelId, analysis, sources };
}

export async function handleGeminiRequest({
  method,
  body,
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL,
}) {
  if (method !== 'POST') return json(405, { error: 'Use POST for match analysis.' });
  if (!apiKey) {
    return json(503, {
      error: 'Match AI Agent is not configured yet. Add the server-side AI key in your hosting settings, then redeploy.',
      code: 'AI_NOT_CONFIGURED',
    });
  }

  const input = body && typeof body === 'object' ? body : {};
  const { league, season, homeTeam, awayTeam, modelName, probabilities, expectedGoals, mostLikelyScore, fixture, dataStatus } = input;

  if (![league, homeTeam, awayTeam].every((value) => typeof value === 'string' && value.trim()) ||
      homeTeam.trim().toLowerCase() === awayTeam.trim().toLowerCase()) {
    return json(400, { error: 'Choose a league and two different teams before requesting analysis.', code: 'INVALID_MATCH' });
  }

  const safePayload = {
    league: league.trim().slice(0, 100),
    season: String(season || '').slice(0, 30),
    homeTeam: homeTeam.trim().slice(0, 100),
    awayTeam: awayTeam.trim().slice(0, 100),
    modelName: String(modelName || 'Poisson').slice(0, 80),
    probabilities: probabilities && typeof probabilities === 'object' ? probabilities : null,
    expectedGoals: expectedGoals && typeof expectedGoals === 'object' ? expectedGoals : null,
    mostLikelyScore: String(mostLikelyScore || '').slice(0, 30),
    fixture: fixture && typeof fixture === 'object' ? fixture : null,
    dataStatus: dataStatus && typeof dataStatus === 'object' ? dataStatus : null,
  };

  const prompt = `You are MatchMind's cautious football statistics analyst. Analyse the selected match using the supplied statistical output. Never invent a fixture, score, injury, lineup, statistic, or source. If reliable recent information cannot be found, say so clearly. Separate verified facts from inference. Do not promise outcomes or encourage gambling. Treat the supplied model probabilities as the baseline; do not replace them with unsupported numbers. Explain the likely scoreline and why, how expected goals and supplied statistics affect the estimate, and why alternatives remain possible. If search grounding returns sources, cite them in the answer. Never claim a final score is certain. Use these headings: Prediction summary; Most likely score and why; Statistical evidence; Recent information checked; Key uncertainties. State clearly that this is an estimate, not certainty.

Match input JSON:
${JSON.stringify(safePayload)}`;

  const candidates = getModelCandidates(model);
  const attempted = [];
  let lastFailure = null;

  for (const modelId of candidates) {
    attempted.push(modelId);
    const result = await requestModel(modelId, apiKey, prompt);

    if (result.ok) {
      return json(200, {
        analysis: result.analysis,
        sources: result.sources,
        generatedAt: new Date().toISOString(),
        grounded: result.sources.length > 0,
        // Kept for diagnostics; the UI does not need to display provider branding.
        model: result.model,
        fallbackUsed: attempted.length > 1,
      });
    }

    lastFailure = result;
    console.error(`[MatchMind AI] Model attempt failed: ${modelId}; status=${result.status}; ${result.message}`);

    if (!result.retryable) {
      return json(result.status || 502, {
        error: result.status === 401 || result.status === 403
          ? 'The AI service rejected its credentials or access. Check the server-side API key and model access.'
          : 'Match AI Agent could not complete the analysis. Please try again later.',
        code: result.status === 401 || result.status === 403 ? 'AI_ACCESS_ERROR' : 'AI_REQUEST_FAILED',
      });
    }
  }

  const code = lastFailure?.status === 429 ? 'AI_RATE_LIMITED' : 'AI_MODELS_UNAVAILABLE';
  return json(lastFailure?.status === 429 ? 429 : 503, {
    error: lastFailure?.status === 429
      ? 'Match AI Agent has reached a usage limit. Please wait and try again.'
      : 'Match AI Agent could not find an available model. Check model access and deployment settings, then try again.',
    code,
    attemptedModels: attempted,
  });
}
