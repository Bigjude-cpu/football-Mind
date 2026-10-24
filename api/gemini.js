import { handleGeminiRequest } from '../lib/gemini.mjs';

export default async function handler(req, res) {
  try {
    const method = req.method || 'GET';
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const result = await handleGeminiRequest({ method, body });
    res.status(result.statusCode);
    for (const [key, value] of Object.entries(result.headers || {})) res.setHeader(key, value);
    res.send(result.body);
  } catch (error) {
    console.error('Gemini analysis failed:', error);
    if (!res.headersSent) res.status(500);
    res.json?.({ error: 'The match analysis service failed unexpectedly. Please try again.' }) ?? res.end(JSON.stringify({ error: 'The match analysis service failed unexpectedly. Please try again.' }));
  }
}
