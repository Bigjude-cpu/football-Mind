import { handleGeminiRequest } from '../../lib/gemini.mjs';

export default async (request) => {
  try {
    let body = {};
    try { body = await request.json(); } catch { /* invalid or empty JSON handled by validation */ }
    const result = await handleGeminiRequest({ method: request.method, body });
    return new Response(result.body, { status: result.statusCode, headers: result.headers });
  } catch (error) {
    console.error('Gemini analysis failed:', error);
    return new Response(JSON.stringify({ error: 'The match analysis service failed unexpectedly. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
};
