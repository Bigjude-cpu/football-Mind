import { useState } from 'react';

export default function GeminiAnalysis({ C, league, season, homeTeam, awayTeam, modelName, matchResult, fixture, dataStatus }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function analyse() {
    setLoading(true); setError(''); setResult(null);
    const payload = {
      league, season, homeTeam, awayTeam, modelName,
      probabilities: matchResult ? {
        homeWin: Number((matchResult.pHome * 100).toFixed(2)),
        draw: Number((matchResult.pDraw * 100).toFixed(2)),
        awayWin: Number((matchResult.pAway * 100).toFixed(2)),
      } : null,
      expectedGoals: matchResult ? { home: Number(matchResult.lambdaH.toFixed(3)), away: Number(matchResult.lambdaA.toFixed(3)) } : null,
      mostLikelyScore: matchResult?.mostLikely ? `${matchResult.mostLikely[0]}-${matchResult.mostLikely[1]}` : null,
      fixture: fixture ? { date: fixture.date || fixture.kickoff || null, status: fixture.status || null, source: fixture.source || null, homeScore: fixture.hg ?? null, awayScore: fixture.ag ?? null } : null,
      dataStatus: dataStatus ? { currentSeason: dataStatus.currentSeason || null, lastUpdate: dataStatus.liveGeneratedAt || dataStatus.historicalFetchedAt || null, sources: dataStatus.historicalSources || [] } : null,
    };
    const isNetlify = window.location.hostname.endsWith('netlify.app') || window.location.hostname.includes('netlify');
    const endpoints = isNetlify ? ['/.netlify/functions/gemini', '/api/gemini'] : ['/api/gemini', '/.netlify/functions/gemini'];
    let lastError = 'Match AI Agent analysis failed.';
    try {
      for (const endpoint of endpoints) {
        let response;
        try {
          response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        } catch { continue; }
        const data = await response.json().catch(() => ({}));
        if (response.ok) { setResult(data); return; }
        lastError = data.error || `Request failed (${response.status}).`;
        if (response.status !== 404 && response.status !== 405) break;
      }
      setError(lastError);
    } catch (e) {
      setError(e?.message || 'Could not contact the analysis service.');
    } finally { setLoading(false); }
  }

  const buttonStyle = { padding: '11px 16px', border: `1px solid ${C.accent}55`, borderRadius: 9, color: '#fff', background: `linear-gradient(135deg,${C.accentDim},${C.accent})`, fontSize: 13, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 };
  return <section style={{ padding: 18, background: C.card, border: `1px solid ${C.accent}40`, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 22 }}>⚽</div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <h3 style={{ margin: 0, color: C.text, fontSize: 15 }}>Match AI Agent Analysis <span style={{ color: C.accent, fontSize: 10 }}>OPTIONAL SECOND OPINION</span></h3>
        <p style={{ margin: '4px 0 0', color: C.textDim, fontSize: 12, lineHeight: 1.5 }}>Uses your model probabilities and may search for recent context. It does not replace the Poisson calculation.</p>
      </div>
      <button type="button" onClick={analyse} disabled={loading} style={buttonStyle}>{loading ? 'Analysing…' : 'Analyse with Match AI Agent'}</button>
    </div>
    <p style={{ margin: 0, color: C.textDim, fontSize: 11 }}>The analysis service must be configured securely in your hosting settings. Never paste your API key into this page.</p>
    {error && <div role="alert" style={{ padding: 12, borderRadius: 8, background: `${C.danger}12`, border: `1px solid ${C.danger}50`, color: C.text, fontSize: 12, lineHeight: 1.6 }}><strong style={{ color: C.danger }}>Analysis unavailable:</strong> {error}<div style={{ marginTop: 5, color: C.textDim }}>Check the server-side AI configuration in your hosting dashboard and redeploy.</div></div>}
    {result && <div style={{ padding: 14, background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9 }}>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: C.text, fontSize: 13, lineHeight: 1.7 }}>{result.analysis}</div>
      {result.sources?.length > 0 && <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${C.border}` }}><div style={{ color: C.textDim, fontSize: 11, marginBottom: 7 }}>Web sources returned by web research</div><ul style={{ paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>{result.sources.map((s, i) => <li key={`${s.url}-${i}`}><a href={s.url} target="_blank" rel="noreferrer" style={{ color: C.accent, fontSize: 12, overflowWrap: 'anywhere' }}>{s.title}</a></li>)}</ul></div>}
      <div style={{ marginTop: 10, color: C.textDim, fontSize: 10 }}>Generated {result.generatedAt ? new Date(result.generatedAt).toLocaleString() : 'just now'} · {result.grounded ? 'Search sources were returned' : 'No web sources were returned; analysis may rely only on supplied data'} · Estimates are uncertain.</div>
    </div>}
  </section>;
}
