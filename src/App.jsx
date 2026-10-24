import { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { loadMatchData, loadLiveData, mergeLiveResults, getLeagueLive, getDataStatus, getMatchesBefore, loadBadges, getBadgeUrl, getSeasons, getTeams, getMatches, getAvailableLeagues, LEAGUES } from "./dataLoader.js";
import { MODEL_NAMES, predictMatch, simulateLeague, computeTable, poissonPmf, rpois,
         findRealResult, poissonGoodnessOfFitTest, independenceTest, dispersionTest } from "./models.js";
import { fetchLivescores, isOurLeague, isLiveStatus, isFinishedStatus } from "./livescores.js";
import T from "./i18n.js";
import GeminiAnalysis from "./GeminiAnalysis.jsx";

// Upcoming fixtures: fetches scheduled events from TheSportsDB and never invents fixtures.
const FIXTURE_LEAGUES = [
  { id:"4328", name:"Premier League", code:"E0" },
  { id:"4335", name:"La Liga", code:"SP1" },
  { id:"4332", name:"Serie A", code:"I1" },
  { id:"4331", name:"Bundesliga", code:"D1" },
  { id:"4334", name:"Ligue 1", code:"F1" },
  { id:"4337", name:"Eredivisie", code:"N1" },
  { id:"4344", name:"Primeira Liga", code:"P1" },
  { id:"4480", name:"Champions League", code:"UCL" },
];
function UpcomingFixtures({ C, onPredict }) {
  const [leagueFilter,setLeagueFilter]=useState("all");
  const [days,setDays]=useState(7);
  const [events,setEvents]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [updated,setUpdated]=useState(null);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),18000);
    async function load(){
      setLoading(true);setError("");
      const chosen=leagueFilter==="all"?FIXTURE_LEAGUES:FIXTURE_LEAGUES.filter(l=>l.code===leagueFilter);
      const settled=await Promise.allSettled(chosen.map(async l=>{
        const r=await fetch(`https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${encodeURIComponent(l.id)}`,{signal:controller.signal,cache:"no-store",headers:{Accept:"application/json"}});
        if(!r.ok) throw new Error(`${l.name}: HTTP ${r.status}`);
        const j=await r.json();
        return (Array.isArray(j?.events)?j.events:[]).map(e=>({...e,_leagueName:l.name,_leagueCode:l.code}));
      }));
      if(cancelled)return;
      const failed=settled.filter(x=>x.status==="rejected");
      const all=settled.filter(x=>x.status==="fulfilled").flatMap(x=>x.value);
      const now=new Date(); const end=new Date(now.getTime()+days*86400000);
      const clean=all.map(e=>{
        const raw=e.strTimestamp||`${e.dateEvent||""}T${e.strTime||"12:00:00"}`;
        const date=new Date(raw);
        return {...e,_date:date,_validDate:Number.isFinite(date.getTime()),home:e.strHomeTeam||"",away:e.strAwayTeam||"",dateText:e.dateEvent||raw.slice(0,10),kickoff:raw,league:e._leagueName,leagueCode:e._leagueCode};
      }).filter(e=>e.home&&e.away&&e._validDate&&e._date>=now&&e._date<=end)
        .sort((a,b)=>a._date-b._date);
      setEvents(clean);setUpdated(new Date());
      if(!clean.length&&failed.length)setError("The fixture provider could not return data. Please retry later; no sample fixtures are shown.");
      else if(failed.length)setError(`Some leagues could not be loaded (${failed.length}). The displayed fixtures are from successful sources only.`);
      else if(!clean.length)setError("No upcoming fixtures were returned for this period. This does not mean the leagues have no scheduled matches.");
      setLoading(false);
    }
    load().catch(e=>{if(!cancelled){setError(e?.name==="AbortError"?"Fixture request timed out. Please retry.":(e?.message||"Fixture service unavailable."));setLoading(false);}}).finally(()=>clearTimeout(timer));
    return()=>{cancelled=true;controller.abort();clearTimeout(timer);};
  },[leagueFilter,days,refresh]);
  const groups=events.reduce((acc,e)=>{(acc[e.league]??=[]).push(e);return acc;},{});
  const btn={padding:"8px 12px",borderRadius:9,border:`1px solid ${C.border}`,background:C.cardAlt,color:C.text,fontSize:12,cursor:"pointer"};
  return <div style={{display:"flex",flexDirection:"column",gap:16}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <div><h2 style={{margin:0,fontSize:24,color:C.text}}>⚽ Upcoming Matches</h2><p style={{margin:"5px 0 0",fontSize:12,color:C.textDim}}>Real scheduled fixtures · Select a match to calculate a prediction from historical data.</p></div>
      <button onClick={()=>setRefresh(x=>x+1)} style={{...btn,borderColor:C.accent,color:C.accent}}>↻ Refresh fixtures</button>
    </div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
      <Sel label="Competition" value={leagueFilter} onChange={setLeagueFilter} options={[{value:"all",label:"All supported leagues"},...FIXTURE_LEAGUES.map(l=>({value:l.code,label:l.name}))]} style={{minWidth:220}} />
      <Sel label="Fixture window" value={String(days)} onChange={v=>setDays(Number(v))} options={[{value:"1",label:"Next 24 hours"},{value:"3",label:"Next 3 days"},{value:"7",label:"Next 7 days"}]} style={{minWidth:160}} />
    </div>
    <div style={{fontSize:11,color:C.textDim}}>Source: TheSportsDB public fixture endpoint · Last checked: {updated?updated.toLocaleString():"not yet checked"} · Fixture availability depends on provider coverage.</div>
    {error&&<div role="status" style={{padding:12,borderRadius:9,background:`${C.warning}12`,border:`1px solid ${C.warning}45`,color:C.warning,fontSize:12,lineHeight:1.5}}>{error}</div>}
    {loading&&<div style={{padding:18,background:C.card,border:`1px solid ${C.border}`,borderRadius:12,color:C.textDim}}>Loading real fixtures…</div>}
    {!loading&&!events.length&&<div style={{padding:22,background:C.card,border:`1px solid ${C.border}`,borderRadius:12,color:C.textDim}}>No verified fixtures to display right now. Try refreshing or choosing another competition/window.</div>}
    {Object.entries(groups).map(([name,rows])=><section key={name} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:13,overflow:"hidden"}}>
      <div style={{padding:"12px 16px",background:C.cardAlt,borderBottom:`1px solid ${C.border}`,fontWeight:700,color:C.text}}>{name}<span style={{float:"right",fontSize:11,color:C.textDim,fontWeight:500}}>{rows.length} fixtures</span></div>
      {rows.map((m,i)=><div key={m.idEvent||`${m.home}-${m.away}-${m.kickoff}`} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",borderBottom:i<rows.length-1?`1px solid ${C.border}`:"none",flexWrap:"wrap"}}>
        <div style={{minWidth:92,fontSize:11,color:C.textDim}}>{m._date.toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"})}<br/>{m._date.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</div>
        <div style={{flex:1,minWidth:170,display:"flex",alignItems:"center",gap:8,color:C.text,fontWeight:600,fontSize:13}}><span>{m.home}</span><span style={{color:C.textDim,fontSize:11}}>vs</span><span>{m.away}</span></div>
        <button onClick={()=>onPredict({home:m.home,away:m.away,date:m.dateText,kickoff:m.kickoff,league:m.league,leagueCode:m.leagueCode,status:"scheduled",source:"TheSportsDB",id:m.idEvent})} style={{padding:"9px 13px",border:0,borderRadius:8,background:`linear-gradient(135deg,${C.success},${C.accent})`,color:"#04110d",fontWeight:800,fontSize:12,cursor:"pointer"}}>Predict match →</button>
      </div>)}
    </section>)}
    <p style={{margin:0,fontSize:11,color:C.textDim,lineHeight:1.6}}>Predictions require matching team names and sufficient historical results in the selected league. If the fixture teams cannot be matched to the historical database, the app must report that limitation rather than invent statistics. Kickoff times are shown in your device's local timezone.</p>
  </div>;
}



// ═══ THEME ═════════════════════════════════════════════════════════
const themes = {
  dark: { bg:"#06120f",card:"#0b1b17",cardAlt:"#10251e",border:"#1b3a2e",accent:"#20e879",accentDim:"#0ea85b",accentBg:"#20e87912",home:"#20e879",draw:"#a78bfa",away:"#f472b6",text:"#e2e8f0",textDim:"#64748b",textMuted:"#475569",success:"#34d399",warning:"#fbbf24",danger:"#f87171",inputBg:"#111827",selectArrow:"%2364748b",tooltipBg:"#111827" },
  light: { bg:"#f6fbf8",card:"#ffffff",cardAlt:"#eef8f1",border:"#d6e9dc",accent:"#079447",accentDim:"#08783c",accentBg:"#07944712",home:"#079447",draw:"#7c3aed",away:"#db2777",text:"#1e293b",textDim:"#64748b",textMuted:"#94a3b8",success:"#059669",warning:"#d97706",danger:"#dc2626",inputBg:"#ffffff",selectArrow:"%2364748b",tooltipBg:"#ffffff" },
};
const ThemeCtx = createContext(themes.dark);
const useTheme = () => useContext(ThemeCtx);
const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query)?.matches);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
};
const useIsMobile = () => useMediaQuery("(max-width: 860px)");

// ═══ KATEX COMPONENT ═══════════════════════════════════════════════
const Katex = ({ math, display = false }) => {
  const ref = useRef(null);
  const C = useTheme();
  useEffect(() => {
    if (!ref.current) return;
    if (!window.katex) {
      ref.current.textContent = math;
      return;
    }
    try {
      window.katex.render(math, ref.current, { displayMode: display, throwOnError: false, output: "html" });
    } catch (e) { ref.current.textContent = math; }
  }, [math, display]);
  return <span ref={ref} style={{ color: C.text }} />;
};

// ═══ BADGE ═════════════════════════════════════════════════════════
const BADGE_COLORS=["#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#06b6d4","#3b82f6","#6366f1","#8b5cf6","#a855f7","#ec4899","#f43f5e","#0ea5e9","#10b981","#84cc16","#d946ef"];
function hashStr(s){let h=0;for(let i=0;i<s.length;i++)h=((h<<5)-h+s.charCodeAt(i))|0;return Math.abs(h);}
function getTeamInitials(name){const sp={"Man City":"MC","Man United":"MU","Sheffield United":"SHU","Nott'm Forest":"NF","West Ham":"WHU","Crystal Palace":"CRY","Aston Villa":"AVL","Real Madrid":"RMA","Atlético Madrid":"ATM","Bayern Munich":"BAY","AC Milan":"ACM","RB Leipzig":"RBL","Ein Frankfurt":"SGE","M'gladbach":"BMG","FC Köln":"KOE"};if(sp[name])return sp[name];const w=name.replace(/[^a-zA-ZÀ-ÿ\s]/g,"").split(/\s+/);return w.length===1?w[0].substring(0,3).toUpperCase():w.map(x=>x[0]).join("").substring(0,3).toUpperCase();}

const Badge = ({ team, size = 28, badges = {} }) => {
  const C = useTheme();
  const url = getBadgeUrl(badges, team);
  const color = BADGE_COLORS[hashStr(team) % BADGE_COLORS.length];
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [url]);
  if (url && !err) return <img src={url+"/tiny"} alt={team} onError={()=>setErr(true)} style={{width:size,height:size,objectFit:"contain",flexShrink:0}} />;
  return <div style={{width:size,height:size,borderRadius:size/2,background:`${color}20`,border:`2px solid ${color}60`,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:size*0.32,fontWeight:700,color,flexShrink:0,fontFamily:"'JetBrains Mono',monospace"}}>{getTeamInitials(team)}</div>;
};

// ═══ SMALL COMPONENTS ══════════════════════════════════════════════
const TabBtn=({active,onClick,children})=>{const C=useTheme();return<button onClick={onClick} style={{padding:"10px 20px",border:"none",background:"transparent",borderBottom:active?`2px solid ${C.accent}`:"2px solid transparent",color:active?C.accent:C.textDim,fontSize:14,fontWeight:active?600:400,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",letterSpacing:".02em",transition:"all .2s",whiteSpace:"nowrap"}}>{children}</button>;};

const Sel=({value,onChange,options,label,style={}})=>{const C=useTheme();return<div style={{display:"flex",flexDirection:"column",gap:6,...style}}>{label&&<label style={{fontSize:11,color:C.textDim,textTransform:"uppercase",letterSpacing:".1em",fontWeight:600}}>{label}</label>}<select value={value} onChange={e=>onChange(e.target.value)} style={{padding:"10px 36px 10px 14px",background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:14,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",outline:"none",appearance:"none",backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='${C.selectArrow}' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat",backgroundPosition:"right 12px center"}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;};

const Sli=({value,onChange,min,max,step,label,display})=>{const C=useTheme();return<div style={{display:"flex",flexDirection:"column",gap:6}}><div style={{display:"flex",justifyContent:"space-between"}}><label style={{fontSize:11,color:C.textDim,textTransform:"uppercase",letterSpacing:".1em",fontWeight:600}}>{label}</label><span style={{fontSize:13,color:C.accent,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>{display}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)} style={{width:"100%",accentColor:C.accent}} /></div>;};

const PBadge=({p,t})=>{const C=useTheme();const r=p<0.05;const co=r?C.danger:C.success;return<span style={{padding:"3px 10px",borderRadius:12,fontSize:11,fontWeight:600,background:`${co}18`,color:co,border:`1px solid ${co}40`}}>{r?t.test_result_reject:t.test_result_fail}</span>;};

// ═══ SCORE MATRIX ══════════════════════════════════════════════════
const ScoreMatrix=({matrix,homeTeam,awayTeam})=>{const C=useTheme();if(!matrix)return null;const flat=matrix.flat();const mx=Math.max(...flat);const MG=8;return<div style={{overflowX:"auto"}}><div style={{display:"inline-grid",gridTemplateColumns:`56px repeat(${MG+1},48px)`,gap:2,fontSize:11}}><div style={{padding:4,color:C.textDim,textAlign:"center",fontSize:9}}>{homeTeam?.slice(0,5)}↓\{awayTeam?.slice(0,5)}→</div>{Array.from({length:MG+1},(_,j)=><div key={j} style={{padding:4,color:C.accent,textAlign:"center",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{j}</div>)}{matrix.slice(0,MG+1).map((row,i)=>[<div key={`r${i}`} style={{padding:4,color:C.accent,textAlign:"center",fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{i}</div>,...row.slice(0,MG+1).map((p,j)=>{const t=mx>0?p/mx:0;const bg=i>j?`rgba(34,211,238,${t*.7})`:i<j?`rgba(244,114,182,${t*.7})`:`rgba(167,139,250,${t*.7})`;return<div key={`${i}-${j}`} style={{padding:4,textAlign:"center",background:bg,borderRadius:4,color:t>.3?"#fff":C.textDim,fontFamily:"'JetBrains Mono',monospace",fontSize:10,fontWeight:t>.5?700:400}}>{(p*100).toFixed(1)}</div>;})])}</div></div>;};

// ═══ LEAGUE TABLE ══════════════════════════════════════════════════
const LTable=({table,t,badges})=>{const C=useTheme();const th={padding:"10px 6px",textAlign:"center",color:C.textDim,fontWeight:600,fontSize:11};const td={padding:"7px 6px",textAlign:"center",color:C.textDim,fontSize:13};return<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'DM Sans',sans-serif"}}><thead><tr style={{borderBottom:`1px solid ${C.border}`}}><th style={th}>#</th><th style={{...th,textAlign:"left"}}>{t.team}</th>{[t.played,t.won,t.drawn,t.lost,t.gf,t.ga,t.gd,t.pts].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{table.map((r,i)=><tr key={r.team} style={{borderBottom:`1px solid ${C.border}22`,background:i<4?C.accentBg:"transparent"}}><td style={{...td,color:i<4?C.accent:C.textDim,fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{i+1}</td><td style={{...td,textAlign:"left",color:C.text,fontWeight:500}}><div style={{display:"flex",alignItems:"center",gap:8}}><Badge team={r.team} size={22} badges={badges} />{r.team}</div></td><td style={td}>{r.p}</td><td style={{...td,color:C.success}}>{r.w}</td><td style={td}>{r.d}</td><td style={{...td,color:C.away}}>{r.l}</td><td style={td}>{r.gf}</td><td style={td}>{r.ga}</td><td style={{...td,color:r.gf-r.ga>=0?C.success:C.away,fontFamily:"'JetBrains Mono',monospace"}}>{r.gf-r.ga>0?"+":""}{r.gf-r.ga}</td><td style={{...td,color:C.accent,fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{r.pts}</td></tr>)}</tbody></table></div>;};

// ═══ TEST CARD ═════════════════════════════════════════════════════
const TestCard=({title,h0,result,t})=>{const C=useTheme();if(!result)return null;return<div style={{padding:16,background:C.card,borderRadius:10,border:`1px solid ${C.border}`}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><h4 style={{margin:0,fontSize:13,color:C.text,fontWeight:600}}>{title}</h4><PBadge p={result.pValue} t={t} /></div><p style={{margin:"0 0 10px",fontSize:11,color:C.textDim,fontStyle:"italic"}}>{h0}</p><div style={{display:"flex",gap:16,fontSize:12,flexWrap:"wrap"}}><div><span style={{color:C.textDim}}>{t.test_statistic}: </span><span style={{color:C.text,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>{result.statistic.toFixed(2)}</span></div><div><span style={{color:C.textDim}}>{t.test_df}: </span><span style={{color:C.text,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>{result.df}</span></div><div><span style={{color:C.textDim}}>{t.test_pvalue}: </span><span style={{color:result.pValue<0.05?C.danger:C.success,fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{result.pValue<0.001?"< 0.001":result.pValue.toFixed(4)}</span></div></div>{result.ratio!==undefined&&<div style={{marginTop:6,fontSize:12}}><span style={{color:C.textDim}}>{t.variance_mean_ratio}: </span><span style={{color:C.text,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>{result.ratio.toFixed(3)}</span></div>}</div>;};

// ═══ DATA / VALIDATION COMPONENTS ══════════════════════════════════
const fmtDateTime=(iso)=>{if(!iso)return "—";const d=new Date(iso);if(isNaN(d.getTime()))return iso;return d.toLocaleString();};
const fmtPct=(p)=>`${(p*100).toFixed(1)}%`;
const DataCard=({title,children,accent})=>{const C=useTheme();return<div style={{padding:16,background:C.card,borderRadius:12,border:`1px solid ${accent||C.border}`}}><div style={{fontSize:11,color:C.textDim,textTransform:"uppercase",letterSpacing:".08em",fontWeight:600,marginBottom:10}}>{title}</div>{children}</div>;};
const StatusBadge=({status,t})=>{const C=useTheme();const map={scheduled:{label:t.status_scheduled,color:C.textDim},live:{label:t.status_live,color:C.danger},finished:{label:t.status_finished,color:C.success},delayed:{label:t.status_delayed,color:C.warning},"awaiting-result":{label:t.status_awaiting,color:C.warning}};const x=map[status]||{label:status,color:C.textDim};return<span style={{padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700,letterSpacing:".04em",color:x.color,background:`${x.color}18`,border:`1px solid ${x.color}40`,whiteSpace:"nowrap"}}>{x.label}</span>;};
const FixtureTable=({rows,t,onUse,empty})=>{const C=useTheme();if(!rows.length)return<div style={{padding:14,color:C.textDim,fontSize:13}}>{empty||"—"}</div>;return<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr style={{borderBottom:`1px solid ${C.border}`}}><th style={{padding:"7px 6px",textAlign:"left",color:C.textDim}}>Date</th><th style={{padding:"7px 6px",textAlign:"left",color:C.textDim}}>Match</th><th style={{padding:"7px 6px",textAlign:"center",color:C.textDim}}>Score</th><th style={{padding:"7px 6px",textAlign:"center",color:C.textDim}}>Status</th><th style={{padding:"7px 6px",textAlign:"left",color:C.textDim}}>Source</th><th style={{padding:"7px 6px"}} /></tr></thead><tbody>{rows.map((m,idx)=><tr key={`${m.date}-${m.home}-${m.away}-${idx}`} style={{borderBottom:`1px solid ${C.border}55`}}><td style={{padding:"7px 6px",color:C.textDim,whiteSpace:"nowrap"}}>{m.date}{m.kickoff&&!m.kickoff.endsWith("T00:00:00")?` · ${m.kickoff.slice(11,16)}`:""}</td><td style={{padding:"7px 6px",color:C.text}}><strong>{m.home}</strong> <span style={{color:C.textDim}}>vs</span> <strong>{m.away}</strong>{m.events?.length?<div style={{fontSize:10,color:C.textDim,marginTop:2}}>{t.goals_events}: {m.events.map(g=>`${g.minute}' ${g.scorer}`).join(" · ")}</div>:null}</td><td style={{padding:"7px 6px",textAlign:"center",fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:C.text,whiteSpace:"nowrap"}}>{m.hg!=null&&m.ag!=null?`${m.hg}–${m.ag}`:"—"}</td><td style={{padding:"7px 6px",textAlign:"center"}}><StatusBadge status={m.status} t={t} /></td><td style={{padding:"7px 6px",color:C.textDim,fontSize:10,maxWidth:150}}>{m.source}</td><td style={{padding:"7px 6px",textAlign:"right"}}><button onClick={()=>onUse(m)} style={{padding:"5px 9px",border:`1px solid ${C.accent}40`,background:C.accentBg,color:C.accent,borderRadius:6,fontSize:10,cursor:"pointer",whiteSpace:"nowrap"}}>{t.use_fixture}</button></td></tr>)}</tbody></table></div>;};
const ValidationPanel=({validation,t})=>{const C=useTheme();if(!validation)return<div style={{padding:14,color:C.textDim,fontSize:13}}>{t.validation_missing}</div>;return<div style={{display:"flex",flexDirection:"column",gap:16}}><p style={{margin:0,fontSize:13,color:C.textDim,lineHeight:1.6}}>{t.validation_note}</p>{validation.leagues?.map(lg=><DataCard key={lg.leagueId} title={`${lg.league} · ${lg.seasons.join(", ")} · ${lg.targets} targets`}><div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr style={{borderBottom:`1px solid ${C.border}`}}><th style={{padding:"6px",textAlign:"left",color:C.textDim}}>{t.validation_model}</th><th style={{padding:"6px",textAlign:"right",color:C.textDim}}>{t.validation_logloss}</th><th style={{padding:"6px",textAlign:"right",color:C.textDim}}>{t.validation_brier}</th><th style={{padding:"6px",textAlign:"right",color:C.textDim}}>{t.validation_rps}</th><th style={{padding:"6px",textAlign:"right",color:C.textDim}}>{t.validation_accuracy}</th></tr></thead><tbody>{Object.entries(lg.models).map(([name,m])=><tr key={name} style={{borderBottom:`1px solid ${C.border}44`}}><td style={{padding:"6px",color:C.text}}>{name}</td><td style={{padding:"6px",textAlign:"right",fontFamily:"'JetBrains Mono',monospace",color:C.text}}>{m.logLoss.toFixed(4)}</td><td style={{padding:"6px",textAlign:"right",fontFamily:"'JetBrains Mono',monospace",color:C.text}}>{m.brier.toFixed(4)}</td><td style={{padding:"6px",textAlign:"right",fontFamily:"'JetBrains Mono',monospace",color:C.text}}>{m.rps.toFixed(4)}</td><td style={{padding:"6px",textAlign:"right",fontFamily:"'JetBrains Mono',monospace",color:C.accent}}>{fmtPct(m.accuracy)}</td></tr>)}</tbody></table></div>{lg.issues?.length?<div style={{marginTop:8,fontSize:11,color:C.warning}}>{lg.issues.slice(0,3).join(" · ")}</div>:null}</DataCard>)}{validation.examples?.length?<DataCard title={t.validation_examples}><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:12}}>{validation.examples.map((e,idx)=>{const m=e.models?.["Maher"];return<div key={idx} style={{padding:12,background:C.cardAlt,borderRadius:8,border:`1px solid ${C.border}`}}><div style={{fontSize:11,color:C.textDim,marginBottom:4}}>{e.leagueId} · {e.season} · {e.date}{e.currentSeason?" · current":""}</div><div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:6}}>{e.home} vs {e.away}</div><div style={{fontSize:12,color:C.textDim,marginBottom:6}}>{t.validation_actual}: <strong style={{color:C.text}}>{e.actual.hg}–{e.actual.ag}</strong> · {e.trainingMatches} training matches</div>{m?<div style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:C.text}}>H {fmtPct(m.pHome)} · D {fmtPct(m.pDraw)} · A {fmtPct(m.pAway)}<div style={{fontSize:10,color:C.textDim,marginTop:4}}>{t.validation_prob_sum}: {m.probabilitySum.toFixed(6)} · Matrix: {m.matrixSum.toFixed(6)} · {m.checks?.length?m.checks.join(", "):"✓"}</div></div>:null}</div>;})}</div></DataCard>:null}</div>;};

// ═══ SIMPLE EXPLANATION ════════════════════════════════════════════
const SimpleGuide=({t,C})=>(
  <details open style={{padding:"14px 18px",background:C.accentBg,border:`1px solid ${C.accent}35`,borderRadius:12}}>
    <summary style={{cursor:"pointer",fontSize:14,fontWeight:700,color:C.accent}}>🧸 {t.simple_title}</summary>
    <p style={{margin:"10px 0",fontSize:13,color:C.text,fontWeight:600}}>{t.simple_intro}</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
      {[t.simple_step1,t.simple_step2,t.simple_step3].map((step,i)=><div key={i} style={{padding:"10px 12px",background:C.card,borderRadius:8,border:`1px solid ${C.border}`,fontSize:12,color:C.textDim,lineHeight:1.55}}>{step}</div>)}
    </div>
    <p style={{margin:"10px 0 0",fontSize:12,color:C.textDim,lineHeight:1.55}}>💡 {t.simple_note}</p>
  </details>
);

// ═══ LIVESCORES ════════════════════════════════════════════════════
const MiniBadge=({src,name,size=18})=>{const C=useTheme();const [err,setErr]=useState(false);if(src&&!err)return<img src={src} alt="" onError={()=>setErr(true)} style={{width:size,height:size,objectFit:"contain",flexShrink:0}}/>;return<span style={{width:size,height:size,borderRadius:"50%",background:C.cardAlt,border:`1px solid ${C.border}`,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:C.textDim,flexShrink:0}}>{(name||"?").slice(0,2).toUpperCase()}</span>;};

const LiveStatus=({event,t})=>{const C=useTheme();const live=isLiveStatus(event.status);const finished=isFinishedStatus(event.status);let label=event.status||"—";if(event.status==="HT")label=t.livescore_halftime;else if(event.status==="FT"||event.status==="AET")label=t.livescore_finished;else if(event.status==="NS")label=t.livescore_not_started;else if(live)label=t.livescore_live;const color=live?C.danger:finished?C.success:C.textDim;return<div style={{display:"flex",alignItems:"center",gap:5,justifyContent:"center"}}><span style={{padding:"2px 7px",borderRadius:9,fontSize:9,fontWeight:700,letterSpacing:".04em",color,background:`${color}18`,border:`1px solid ${color}40`,whiteSpace:"nowrap"}}>{label}</span>{live&&event.progress?<span style={{fontSize:10,color:C.textDim,fontFamily:"'JetBrains Mono',monospace"}}>{event.progress}'</span>:null}</div>;};

const LiveTable=({rows,t})=>{const C=useTheme();if(!rows.length)return null;return<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}><thead><tr style={{borderBottom:`1px solid ${C.border}`}}><th style={{padding:"7px 6px",textAlign:"left",color:C.textDim}}>{t.livescore_league}</th><th style={{padding:"7px 6px",textAlign:"left",color:C.textDim}}>{t.livescore_match}</th><th style={{padding:"7px 6px",textAlign:"center",color:C.textDim}}>{t.livescore_score}</th><th style={{padding:"7px 6px",textAlign:"center",color:C.textDim}}>{t.livescore_status}</th><th style={{padding:"7px 6px",textAlign:"left",color:C.textDim}}>{t.livescore_kickoff}</th></tr></thead><tbody>{rows.map((m,idx)=><tr key={`${m.id}-${idx}`} style={{borderBottom:`1px solid ${C.border}55`}}><td style={{padding:"7px 6px",color:C.textDim,fontSize:11,maxWidth:190}}>{isOurLeague(m.league)?"⭐ ":""}{m.league}</td><td style={{padding:"7px 6px",color:C.text}}><div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}><MiniBadge src={m.homeBadge} name={m.home}/><strong>{m.home}</strong><span style={{color:C.textDim}}>vs</span><strong>{m.away}</strong><MiniBadge src={m.awayBadge} name={m.away}/></div></td><td style={{padding:"7px 6px",textAlign:"center",fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:isLiveStatus(m.status)?C.danger:C.text,whiteSpace:"nowrap"}}>{m.hg!=null&&m.ag!=null?`${m.hg}–${m.ag}`:"—"}</td><td style={{padding:"7px 6px",textAlign:"center"}}><LiveStatus event={m} t={t}/></td><td style={{padding:"7px 6px",color:C.textDim,whiteSpace:"nowrap",fontSize:11}}>{m.kickoff?m.kickoff.slice(0,16).replace("T"," "):"—"}</td></tr>)}</tbody></table></div>;};

const LivescorePanel=({t})=>{const C=useTheme();const [events,setEvents]=useState([]);const [loading,setLoading]=useState(true);const [error,setError]=useState(null);const [checkedAt,setCheckedAt]=useState(null);const [onlyOurs,setOnlyOurs]=useState(false);const [refreshTick,setRefreshTick]=useState(0);const hasLoaded=useRef(false);
  useEffect(()=>{let cancelled=false;let controller=null;let interval=null;const load=async()=>{controller?.abort();controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);if(!hasLoaded.current)setLoading(true);try{const list=await fetchLivescores(controller.signal);if(cancelled)return;setEvents(list);setCheckedAt(new Date());setError(null);hasLoaded.current=true;}catch(e){if(cancelled)return;setError(e?.name==="AbortError"?"timeout":(e?.message||"network"));}finally{clearTimeout(timeout);if(!cancelled)setLoading(false);}};load();interval=setInterval(load,60000);return()=>{cancelled=true;clearInterval(interval);controller?.abort();};},[refreshTick]);
  const ours=events.filter(e=>isOurLeague(e.league));const others=events.filter(e=>!isOurLeague(e.league));const order=(a,b)=>{const liveDiff=(isLiveStatus(b.status)?1:0)-(isLiveStatus(a.status)?1:0);return liveDiff||(a.kickoff||"").localeCompare(b.kickoff||"");};const sortedOurs=[...ours].sort(order);const sortedOthers=[...others].sort(order);const liveCount=events.filter(e=>isLiveStatus(e.status)).length;
  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",gap:12}}>
      <div><h2 style={{margin:0,fontSize:22,fontWeight:700,color:C.text}}>⚽ {t.livescore_title} <span style={{fontSize:11,fontWeight:700,color:C.danger,background:`${C.danger}18`,border:`1px solid ${C.danger}40`,borderRadius:10,padding:"2px 8px",verticalAlign:"middle"}}>● {liveCount} {t.livescore_live}</span></h2><p style={{margin:"6px 0 0",fontSize:12,color:C.textDim,lineHeight:1.5}}>{t.livescore_subtitle}</p></div>
      <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:12}}>
        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.textDim,cursor:"pointer"}}><input type="checkbox" checked={onlyOurs} onChange={e=>setOnlyOurs(e.target.checked)} style={{accentColor:C.accent}}/>{t.livescore_only_ours}</label>
        <button onClick={()=>setRefreshTick(x=>x+1)} style={{padding:"7px 12px",border:`1px solid ${C.accent}40`,background:C.accentBg,color:C.accent,borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer"}}>↻ {t.livescore_refresh}</button>
      </div>
    </div>
    <div style={{display:"flex",flexWrap:"wrap",gap:"8px 18px",fontSize:11,color:C.textDim}}><span>🕒 {t.livescore_last_checked}: {checkedAt?fmtDateTime(checkedAt.toISOString()):"—"}</span><span>⏱️ {t.livescore_auto}</span><span>📡 {t.livescore_source}</span><span style={{color:C.accent}}>{t.livescore_count.replace("{n}",events.length)}</span></div>
    {error&&<div style={{padding:"12px 16px",background:`${C.warning}12`,border:`1px solid ${C.warning}45`,borderRadius:10,fontSize:12,color:C.warning,lineHeight:1.5}}>⚠️ {t.livescore_error}<div style={{fontSize:10,color:C.textMuted,marginTop:4}}>{error}</div></div>}
    {loading&&!events.length&&<div style={{padding:20,background:C.card,border:`1px solid ${C.border}`,borderRadius:12,color:C.textDim,fontSize:13}}>⏳ {t.livescore_loading}</div>}
    {!loading&&!error&&!events.length&&<div style={{padding:20,background:C.card,border:`1px solid ${C.border}`,borderRadius:12,color:C.textDim,fontSize:13}}>{t.livescore_none}</div>}
    {onlyOurs&&!loading&&!error&&!sortedOurs.length&&<div style={{padding:20,background:C.card,border:`1px solid ${C.border}`,borderRadius:12,color:C.textDim,fontSize:13}}>{t.livescore_no_ours}</div>}
    {sortedOurs.length>0&&<DataCard title={t.livescore_your_leagues} accent={`${C.accent}45`}><LiveTable rows={sortedOurs} t={t}/></DataCard>}
    {!onlyOurs&&sortedOthers.length>0&&<DataCard title={t.livescore_other}><LiveTable rows={sortedOthers} t={t}/></DataCard>}
    <div style={{padding:"12px 16px",background:C.cardAlt,borderRadius:8,fontSize:11,color:C.textDim,lineHeight:1.6}}>ℹ️ {t.livescore_disclaimer}<br/>{t.livescore_note}<br/>📋 {t.livescore_not_modelled}</div>
  </div>;};

// ═══ MODEL FORMULAS (LaTeX) ════════════════════════════════════════
const MODEL_LATEX = {
  "Maher": [
    "\\lambda_{\\text{home}} = \\alpha_i \\cdot \\beta_j \\cdot e^{\\gamma}",
    "\\lambda_{\\text{away}} = \\alpha_j \\cdot \\beta_i",
    "X \\sim \\text{Poisson}(\\lambda_{\\text{home}}), \\quad Y \\sim \\text{Poisson}(\\lambda_{\\text{away}})",
    "P(X=x, Y=y) = \\frac{e^{-\\lambda_h}\\lambda_h^x}{x!} \\cdot \\frac{e^{-\\lambda_a}\\lambda_a^y}{y!}",
  ],
  "Dixon-Coles": [
    "P(X=x, Y=y) = \\tau(x,y,\\lambda_h,\\lambda_a,\\rho) \\cdot \\text{Pois}(x;\\lambda_h) \\cdot \\text{Pois}(y;\\lambda_a)",
    "\\tau(0,0) = 1 - \\lambda_h \\lambda_a \\rho",
    "\\tau(1,0) = 1 + \\lambda_a \\rho, \\quad \\tau(0,1) = 1 + \\lambda_h \\rho",
    "\\tau(1,1) = 1 - \\rho, \\quad \\tau(x,y) = 1 \\text{ otherwise}",
  ],
  "Dixon-Coles TD": [
    "w_i = e^{-\\xi(t_{\\text{now}} - t_i)}, \\quad \\xi > 0",
    "\\mathcal{L}(\\theta) = \\sum_{i=1}^{n} w_i \\cdot \\log P(x_i, y_i \\mid \\theta)",
    "\\text{Higher } \\xi \\Rightarrow \\text{ more weight on recent matches}",
  ],
  "Bivariate Poisson": [
    "X = X^* + Z, \\quad Y = Y^* + Z",
    "X^* \\sim \\text{Pois}(\\lambda_1), \\quad Y^* \\sim \\text{Pois}(\\lambda_2), \\quad Z \\sim \\text{Pois}(\\lambda_3)",
    "P(X=x,Y=y) = \\sum_{k=0}^{\\min(x,y)} \\frac{e^{-\\lambda_1}\\lambda_1^{x-k}}{(x-k)!} \\cdot \\frac{e^{-\\lambda_2}\\lambda_2^{y-k}}{(y-k)!} \\cdot \\frac{e^{-\\lambda_3}\\lambda_3^k}{k!}",
    "\\text{Cov}(X,Y) = \\lambda_3 \\geq 0",
  ],
  "Negative Binomial": [
    "X \\sim \\text{NegBin}(r, p), \\quad E[X] = \\frac{r(1-p)}{p}",
    "\\text{Var}(X) = \\frac{r(1-p)}{p^2} > E[X]",
    "P(X=k) = \\binom{k+r-1}{k} p^r (1-p)^k",
    "\\text{As } r \\to \\infty: \\text{NegBin} \\to \\text{Poisson}",
  ],
};

// ═══ MAIN APP ══════════════════════════════════════════════════════
export default function App() {
  const isMobile = useIsMobile();
  const [lang,setLang]=useState("en");
  const [theme,setTheme]=useState("dark");
  const [data,setData]=useState(null);
  const [badges,setBadges]=useState({});
  const [tab,setTab]=useState("upcoming");
  const [league,setLeague]=useState("E0");
  const [season,setSeason]=useState("");
  const [model,setModel]=useState("Maher");
  const [homeTeam,setHomeTeam]=useState("");
  const [awayTeam,setAwayTeam]=useState("");
  const [trainPct,setTrainPct]=useState(0.7);
  const [xi,setXi]=useState(0.005);
  const [matchResult,setMatchResult]=useState(null);
  const [simResult,setSimResult]=useState(null);
  const [katexLoaded,setKatexLoaded]=useState(false);
  const [live,setLive]=useState(null);
  const [liveError,setLiveError]=useState(null);
  const [dataError,setDataError]=useState(null);
  const [synthetic,setSynthetic]=useState(false);
  const [validation,setValidation]=useState(null);
  const [asOf,setAsOf]=useState(null);
  const [fixtureNotice,setFixtureNotice]=useState(null);
  const [predictInfo,setPredictInfo]=useState(null);

  const t=T[lang]; const C=themes[theme];

  // Load KaTeX CSS+JS
  useEffect(()=>{
    if(document.getElementById("katex-css"))return;
    const link=document.createElement("link");link.id="katex-css";link.rel="stylesheet";link.href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";document.head.appendChild(link);
    const script=document.createElement("script");script.src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";script.onload=()=>setKatexLoaded(true);document.head.appendChild(script);
  },[]);

  useEffect(()=>{
    let cancelled=false;
    loadBadges().then(b=>{if(!cancelled)setBadges(b);});
    (async()=>{
      try{
        const allowSynthetic=new URLSearchParams(window.location.search).get("synthetic")==="1";
        const base=await loadMatchData({allowSynthetic});
        let snap=null;
        try{snap=await loadLiveData();}catch(e){if(!cancelled)setLiveError(e.message);}
        const merged=mergeLiveResults(base,snap);
        if(!cancelled){setData(merged.data);setLive(snap);setSynthetic(!!base._synthetic);}
      }catch(e){
        if(!cancelled)setDataError(e.message);
      }
    })();
    fetch("./data/validation.json").then(r=>r.ok?r.json():null).then(v=>{if(!cancelled)setValidation(v);}).catch(()=>{});
    return()=>{cancelled=true;};
  },[]);

  const leagueIds=useMemo(()=>data?getAvailableLeagues(data):[],[data]);
  const seasons=useMemo(()=>data?getSeasons(data,league):[],[data,league]);
  const matches=useMemo(()=>data?getMatches(data,league,season):[],[data,league,season]);
  const leagueLive=useMemo(()=>getLeagueLive(live,league),[live,league]);
  const teams=useMemo(()=>{
    const set=new Set(data?getTeams(data,league,season):[]);
    (leagueLive?.matches||[]).forEach(m=>{set.add(m.home);set.add(m.away);});
    return [...set].sort();
  },[data,league,season,leagueLive]);
  const status=useMemo(()=>data?getDataStatus(data,live,league):null,[data,live,league]);

  useEffect(()=>{if(seasons.length>0&&!seasons.includes(season))setSeason(seasons[0]);},[seasons]);
  useEffect(()=>{if(fixtureNotice)return;if(teams.length>=2){setHomeTeam(teams[0]);setAwayTeam(teams[1]);}setMatchResult(null);setSimResult(null);setAsOf(null);setPredictInfo(null);},[teams,fixtureNotice]);

  const realResult=useMemo(()=>(!homeTeam||!awayTeam||!matches.length)?null:findRealResult(matches,homeTeam,awayTeam),[matches,homeTeam,awayTeam]);
  const liveFixture=useMemo(()=>{
    if(!homeTeam||!awayTeam||!leagueLive?.matches)return null;
    return [...leagueLive.matches].reverse().find(m=>m.home===homeTeam&&m.away===awayTeam)||null;
  },[leagueLive,homeTeam,awayTeam]);
  const targetDate=asOf||realResult?.date||liveFixture?.date||null;

  const handlePredict=useCallback(()=>{
    if(!homeTeam||!awayTeam||homeTeam===awayTeam||!matches.length)return;
    let train;
    if(targetDate){
      // Strictly earlier matches only: no future leakage for this fixture.
      train=getMatchesBefore(matches,targetDate);
    }else{
      const tN=Math.floor(matches.length*trainPct);
      train=matches.slice(0,tN);
    }
    const result=predictMatch(model,train,homeTeam,awayTeam,{xi,asOf:targetDate||undefined,excludeMatch:targetDate?undefined:{home:homeTeam,away:awayTeam}});
    setMatchResult(result);
    setSimResult(null);
    setPredictInfo({n:train.length,total:matches.length,targetDate,pct:Math.round(trainPct*100)});
  },[homeTeam,awayTeam,model,matches,trainPct,xi,targetDate]);
  const handleSimulate=useCallback(()=>{if(!matchResult)return;setSimResult({hg:rpois(matchResult.lambdaH),ag:rpois(matchResult.lambdaA)});},[matchResult]);
  const useFixture=useCallback((m)=>{
    const leagueMap={E0:"E0",SP1:"SP1",I1:"I1",D1:"D1",F1:"F1",N1:"N1",P1:"P1"};
    const nextLeague=leagueMap[m.leagueCode];
    if(nextLeague)setLeague(nextLeague);
    setHomeTeam(m.home);setAwayTeam(m.away);setAsOf(m.date||null);
    setFixtureNotice(m);setTab("simulate");setMatchResult(null);setSimResult(null);setPredictInfo(null);
  },[]);

  const actualTable=useMemo(()=>matches.length?computeTable(matches):[],[matches]);
  const predictedTable=useMemo(()=>{try{return matches.length&&teams.length?simulateLeague(matches,teams,model,trainPct,{xi}):[];}catch(e){console.error("simulateLeague error:",e);return[];}},[matches,teams,model,trainPct,xi]);

  const trainInfo=useMemo(()=>{const total=matches.length,n=Math.floor(total*trainPct);return{total,n,rest:total-n,pct:Math.round(trainPct*100)};},[matches,trainPct]);

  const assumption=useMemo(()=>{
    if(!matches.length)return null;
    const hW=matches.filter(m=>m.result==="H").length,dW=matches.filter(m=>m.result==="D").length,aW=matches.filter(m=>m.result==="A").length;
    const hg=matches.map(m=>m.hg),ag=matches.map(m=>m.ag);
    const mH=hg.reduce((a,b)=>a+b,0)/hg.length,mA=ag.reduce((a,b)=>a+b,0)/ag.length;
    const MG=6;const histH=Array(MG+1).fill(0),histA=Array(MG+1).fill(0);
    hg.forEach(g=>histH[Math.min(g,MG)]++);ag.forEach(g=>histA[Math.min(g,MG)]++);
    const pExpH=Array.from({length:MG+1},(_,k)=>k<MG?poissonPmf(k,mH)*hg.length:(1-Array.from({length:MG},(_,j)=>poissonPmf(j,mH)).reduce((a,b)=>a+b,0))*hg.length);
    const pExpA=Array.from({length:MG+1},(_,k)=>k<MG?poissonPmf(k,mA)*ag.length:(1-Array.from({length:MG},(_,j)=>poissonPmf(j,mA)).reduce((a,b)=>a+b,0))*ag.length);
    return{results:[{name:t.local,value:hW,color:C.home},{name:t.draw,value:dW,color:C.draw},{name:t.visitor,value:aW,color:C.away}],
      homeGoalDist:Array.from({length:MG+1},(_,i)=>({goals:i===MG?`${MG}+`:`${i}`,observed:histH[i],poisson:Math.round(pExpH[i]*10)/10})),
      awayGoalDist:Array.from({length:MG+1},(_,i)=>({goals:i===MG?`${MG}+`:`${i}`,observed:histA[i],poisson:Math.round(pExpA[i]*10)/10})),
      meanH:mH.toFixed(2),meanA:mA.toFixed(2),total:matches.length,
      gofHome:poissonGoodnessOfFitTest(hg),gofAway:poissonGoodnessOfFitTest(ag),indep:independenceTest(matches),dispHome:dispersionTest(hg),dispAway:dispersionTest(ag)};
  },[matches,t,C]);

  const probBars=matchResult?[{name:t.result_home,value:+(matchResult.pHome*100).toFixed(1),color:C.home},{name:t.result_draw,value:+(matchResult.pDraw*100).toFixed(1),color:C.draw},{name:t.result_away,value:+(matchResult.pAway*100).toFixed(1),color:C.away}]:[];
  const fixturesUpcoming=useMemo(()=>leagueLive?.available?(leagueLive.matches||[]).filter(m=>m.status==="scheduled"||m.status==="delayed").slice(0,12):[],[leagueLive]);
  const fixturesRecent=useMemo(()=>leagueLive?.available?(leagueLive.matches||[]).filter(m=>m.status==="finished").slice(-12).reverse():[],[leagueLive]);
  const fixturesLive=useMemo(()=>leagueLive?.available?(leagueLive.matches||[]).filter(m=>m.status==="live"):[],[leagueLive]);
  const fixturesAwaiting=useMemo(()=>leagueLive?.available?(leagueLive.matches||[]).filter(m=>m.status==="awaiting-result").slice(0,8):[],[leagueLive]);

  if(dataError)return<div style={{minHeight:"100vh",background:C.bg,color:C.text,display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'DM Sans',sans-serif"}}><div style={{maxWidth:680,padding:24,background:C.card,border:`1px solid ${C.danger}50`,borderRadius:12}}><h1 style={{margin:"0 0 10px",fontSize:22,color:C.danger}}>⚽ {t.data_error_title}</h1><p style={{fontSize:14,color:C.textDim,lineHeight:1.6}}>{dataError}</p><p style={{fontSize:13,color:C.textDim}}>{t.data_error_body}</p><pre style={{padding:14,background:C.cardAlt,borderRadius:8,fontSize:12,overflowX:"auto",color:C.accent}}>cd "C:\Users\USER\Documents\Default Project\poisson-football"{`\n`}npm run fetch-data{`\n`}npm run fetch-live{`\n`}npm run dev</pre><p style={{fontSize:12,color:C.warning}}>{t.data_error_note}</p></div></div>;
  if(!data)return<div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Instrument+Serif&display=swap" rel="stylesheet" /><div style={{color:C.accent,fontSize:18,fontFamily:"'DM Sans',sans-serif"}}>⚽ {t.loading}</div></div>;

  return(
  <ThemeCtx.Provider value={C}>
  <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'DM Sans',sans-serif",transition:"background .3s,color .3s"}}>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Instrument+Serif&display=swap" rel="stylesheet" />

    {/* HEADER */}
    <header style={{padding:"18px clamp(14px,3vw,32px)",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div>
        <h1 style={{margin:0,fontSize:26,fontFamily:"'Instrument Serif',serif",fontWeight:400,color:C.accent}}>
          <span style={{marginRight:8}}>⚽</span>{t.title}
        </h1>
        <p style={{margin:"2px 0 0",fontSize:12,color:C.textDim}}>{t.subtitle}</p>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>setTheme(th=>th==="dark"?"light":"dark")} style={{padding:"8px 14px",background:C.accentBg,border:`1px solid ${C.accent}30`,borderRadius:20,color:C.accent,fontSize:14,cursor:"pointer",lineHeight:1}}>{theme==="dark"?"☀️":"🌙"}</button>
        <button onClick={()=>setLang(l=>l==="en"?"es":"en")} style={{padding:"8px 14px",background:C.accentBg,border:`1px solid ${C.accent}30`,borderRadius:20,color:C.accent,fontSize:12,fontWeight:700,cursor:"pointer",letterSpacing:".1em"}}>{t.lang_toggle}</button>
      </div>
    </header>

    {/* NAV */}
    <nav style={{display:"flex",gap:4,padding:"0 clamp(10px,3vw,32px)",borderBottom:`1px solid ${C.border}`,background:C.card,overflowX:"auto"}}>
      {Object.entries(t.tabs).map(([k,v])=><TabBtn key={k} active={tab===k} onClick={()=>setTab(k)}>{v}</TabBtn>)}
    </nav>

    {/* CONTROLS */}
    <div style={{display:"flex",flexWrap:"wrap",gap:16,padding:"14px clamp(12px,3vw,32px)",borderBottom:`1px solid ${C.border}`,alignItems:"flex-end"}}>
      <Sel label={t.league_label} value={league} onChange={(v)=>{setLeague(v);setAsOf(null);setFixtureNotice(null);setPredictInfo(null);}} options={leagueIds.map(id=>({value:id,label:LEAGUES[id]?.[lang]||id}))} style={{minWidth:220}} />
      <Sel label={t.season_label} value={season} onChange={(v)=>{setSeason(v);setAsOf(null);setFixtureNotice(null);setPredictInfo(null);}} options={seasons.map(s=>({value:s,label:s}))} style={{minWidth:130}} />
      <Sel label={t.model_label} value={model} onChange={setModel} options={MODEL_NAMES.map(m=>({value:m,label:m}))} style={{minWidth:180}} />
      <div style={{minWidth:160}}><Sli label={t.train_size} value={trainPct} onChange={setTrainPct} min={0.3} max={1} step={0.1} display={`${Math.round(trainPct*100)}%`} /></div>
      {model==="Dixon-Coles TD"&&<div style={{minWidth:160}}><Sli label={t.decay_param} value={xi} onChange={setXi} min={0.001} max={0.02} step={0.001} display={xi.toFixed(3)} /></div>}
    </div>
    <div style={{padding:"8px clamp(12px,3vw,32px)",fontSize:11,color:C.textDim,background:C.cardAlt,borderBottom:`1px solid ${C.border}`}}>📊 {asOf?t.prediction_asof.replace("{n}",getMatchesBefore(matches,asOf).length).replace("{date}",asOf):t.train_explain.replace("{pct}",trainInfo.pct).replace("{n}",trainInfo.n).replace("{total}",trainInfo.total).replace("{rest}",trainInfo.rest)}</div>
    {synthetic&&<div style={{padding:"10px 32px",fontSize:12,color:"#fff",background:C.danger,fontWeight:600}}>⚠️ {t.data_synthetic_warning}</div>}
    <div style={{display:"flex",flexWrap:"wrap",gap:"8px 22px",padding:"9px clamp(12px,3vw,32px)",fontSize:11,color:C.textDim,background:C.card,borderBottom:`1px solid ${C.border}`,alignItems:"center"}}>
      <span>📚 <strong style={{color:C.text}}>{t.data_historical}:</strong> {status?`${status.historicalMatches.toLocaleString()} ${t.data_matches} · ${status.earliest}–${status.latest} · ${status.historicalSources.join(" + ")||"—"}`:"—"}</span>
      <span>📡 <strong style={{color:C.text}}>{t.data_current}:</strong> {status?.currentSeason||"—"} · {leagueLive?.available?((leagueLive.sources?.length?leagueLive.sources:[leagueLive.source]).join(" + ")):t.data_missing}</span>
      <span>🕒 <strong style={{color:C.text}}>{t.data_last_update}:</strong> {fmtDateTime(status?.liveGeneratedAt||status?.historicalFetchedAt)}</span>
      <span style={{color:leagueLive?.available?(leagueLive.liveSupported?C.success:C.warning):C.danger,fontWeight:600}}>{leagueLive?.available?(leagueLive.liveSupported?`🟢 ${t.data_live_supported}`:`🟠 ${t.data_not_live}`):`🔴 ${t.data_missing}`}</span>
      {leagueLive?.stale&&<span style={{color:C.warning,fontWeight:700}}>⚠️ {t.data_stale}{leagueLive.lagDays!=null?` (${leagueLive.lagDays}d)`:""}</span>}
      {liveError&&<span style={{color:C.warning}}>⚠️ {liveError}</span>}
    </div>

    {/* CONTENT */}
    <main style={{padding:isMobile?"16px 14px":"24px 32px",maxWidth:isMobile?"100%":1400,width:"100%",margin:"0 auto"}}>

      {/* ─── MATCH SIMULATOR ─── */}
      {tab==="upcoming"&&<UpcomingFixtures C={C} onPredict={useFixture}/>}
      {tab==="simulate"&&<div style={{display:"flex",flexDirection:"column",gap:20}}>
        <SimpleGuide t={t} C={C} />
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr auto 1fr",gap:isMobile?12:16,alignItems:isMobile?"stretch":"end",padding:20,background:C.card,borderRadius:12,border:`1px solid ${C.border}`}}>
          <div><Sel label={t.home_team} value={homeTeam} onChange={(v)=>{setHomeTeam(v);setAsOf(null);setFixtureNotice(null);setPredictInfo(null);}} options={teams.map(t=>({value:t,label:t}))} /><div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}><Badge team={homeTeam||"?"} size={32} badges={badges} /><span style={{fontSize:15,fontWeight:600,color:C.text}}>{homeTeam}</span></div></div>
          <span style={{fontSize:22,color:C.textDim,fontWeight:300,paddingBottom:28}}>vs</span>
          <div><Sel label={t.away_team} value={awayTeam} onChange={(v)=>{setAwayTeam(v);setAsOf(null);setFixtureNotice(null);setPredictInfo(null);}} options={teams.filter(x=>x!==homeTeam).map(t=>({value:t,label:t}))} /><div style={{marginTop:8,display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end"}}><span style={{fontSize:15,fontWeight:600,color:C.text}}>{awayTeam}</span><Badge team={awayTeam||"?"} size={32} badges={badges} /></div></div>
        </div>

        {fixtureNotice&&<div style={{padding:"12px 18px",background:C.accentBg,borderRadius:10,border:`1px solid ${C.accent}35`,display:"flex",flexWrap:"wrap",gap:10,alignItems:"center",fontSize:12,color:C.textDim}}>
          <strong style={{color:C.accent}}>{t.fixtures_title}:</strong>
          <span>{fixtureNotice.date} · {fixtureNotice.home} vs {fixtureNotice.away}</span>
          <StatusBadge status={fixtureNotice.status} t={t} />
          {fixtureNotice.hg!=null&&<span style={{fontFamily:"'JetBrains Mono',monospace",color:C.text,fontWeight:700}}>{fixtureNotice.hg}–{fixtureNotice.ag}</span>}
          <span>{t.source_label}: {fixtureNotice.source}</span>
        </div>}
        {realResult&&(!liveFixture||liveFixture.status==="finished"||liveFixture.date===realResult.date)&&<div style={{padding:"14px 20px",background:`${C.success}10`,borderRadius:10,border:`1px solid ${C.success}30`,display:"flex",alignItems:"center",justifyContent:"center",gap:16,flexWrap:"wrap"}}>
          <span style={{fontSize:12,color:C.success,textTransform:"uppercase",fontWeight:600,letterSpacing:".08em"}}>{t.real_result}:</span>
          <div style={{display:"flex",alignItems:"center",gap:12}}><Badge team={homeTeam} size={24} badges={badges} /><span style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:C.text}}>{realResult.hg} — {realResult.ag}</span><Badge team={awayTeam} size={24} badges={badges} /></div>
          <span style={{fontSize:11,color:C.textDim}}>{realResult.date||""} · {data?.[league]?.seasons?.[season]?.source||""}</span>
        </div>}
        {!realResult&&liveFixture&&<div style={{padding:"12px 20px",background:`${liveFixture.status==="live"?C.danger:C.accent}10`,borderRadius:10,border:`1px solid ${liveFixture.status==="live"?C.danger:C.accent}35`,display:"flex",alignItems:"center",justifyContent:"center",gap:14,flexWrap:"wrap"}}>
          <StatusBadge status={liveFixture.status} t={t} />
          <span style={{fontSize:12,color:C.textDim}}>{liveFixture.date}{liveFixture.kickoff&&!liveFixture.kickoff.endsWith("T00:00:00")?` · ${liveFixture.kickoff.slice(11,16)}`:""}</span>
          {liveFixture.hg!=null?<span style={{fontSize:22,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:C.text}}>{liveFixture.hg} — {liveFixture.ag}</span>:<span style={{fontSize:13,color:C.warning}}>{t.not_played}</span>}
          <span style={{fontSize:11,color:C.textDim}}>{t.source_label}: {liveFixture.source}</span>
        </div>}

        <div style={{display:"flex",gap:12}}>
          <button onClick={handlePredict} style={{padding:"12px 28px",background:`linear-gradient(135deg,${C.accent},${C.accentDim})`,border:"none",borderRadius:8,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{t.simulate_btn}</button>
          {matchResult&&<button onClick={handleSimulate} style={{padding:"12px 28px",background:`${C.away}18`,border:`1px solid ${C.away}40`,borderRadius:8,color:C.away,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>{t.simulate_match_btn}</button>}
        </div>

        {predictInfo&&<div style={{padding:"9px 14px",background:C.cardAlt,borderRadius:8,fontSize:11,color:C.textDim}}>{predictInfo.targetDate?t.prediction_asof.replace("{n}",predictInfo.n).replace("{date}",predictInfo.targetDate):t.prediction_no_asof.replace("{pct}",predictInfo.pct).replace("{n}",predictInfo.n).replace("{total}",predictInfo.total)}{!matchResult&&<span style={{color:C.warning}}> · No probability could be calculated (not enough prior matches for these teams).</span>}</div>}

        {simResult&&matchResult&&<div style={{padding:20,background:`linear-gradient(135deg,${C.accent}08,${C.away}08)`,borderRadius:12,border:`1px solid ${C.accent}25`,textAlign:"center"}}>
          <div style={{fontSize:11,color:C.textDim,marginBottom:6,textTransform:"uppercase",letterSpacing:".1em"}}>{t.sim_result}</div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16}}><Badge team={homeTeam} size={36} badges={badges} /><span style={{fontSize:34,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:C.text}}>{simResult.hg} — {simResult.ag}</span><Badge team={awayTeam} size={36} badges={badges} /></div>
        </div>}

        {matchResult&&<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:isMobile?16:20}}>
          <div style={{padding:20,background:C.card,borderRadius:12,border:`1px solid ${C.border}`}}>
            <h3 style={{margin:"0 0 4px",fontSize:13,color:C.textDim,textTransform:"uppercase",letterSpacing:".08em"}}>{t.probability} • {model}</h3>
            <div style={{fontSize:10,color:C.textMuted}}>{t.validation_prob_sum}: {((matchResult.pHome+matchResult.pDraw+matchResult.pAway)*100).toFixed(2)}% · Matrix: {(matchResult.matrix.flat().reduce((s,p)=>s+p,0)*100).toFixed(2)}% · 0–{8} goals</div>
            <div style={{display:"flex",gap:12,margin:"16px 0"}}>{probBars.map(d=><div key={d.name} style={{flex:1,textAlign:"center"}}><div style={{height:80,display:"flex",alignItems:"flex-end",justifyContent:"center"}}><div style={{width:"100%",height:`${Math.max(d.value,2)}%`,background:d.color,borderRadius:"6px 6px 0 0",transition:"height .5s"}} /></div><div style={{fontSize:22,fontWeight:700,color:d.color,fontFamily:"'JetBrains Mono',monospace",marginTop:8}}>{d.value}%</div><div style={{fontSize:11,color:C.textDim,marginTop:2}}>{d.name}</div></div>)}</div>
            <div style={{display:"flex",justifyContent:"space-around",padding:"12px 0",borderTop:`1px solid ${C.border}`,marginTop:12}}>
              <div style={{textAlign:"center"}}><div style={{fontSize:11,color:C.textDim}}>{t.expected_goals}</div><div style={{fontSize:18,fontWeight:700,color:C.home,fontFamily:"'JetBrains Mono',monospace"}}>{matchResult.lambdaH.toFixed(2)}</div><div style={{fontSize:11,color:C.textDim}}>{homeTeam}</div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:11,color:C.textDim}}>{t.most_likely}</div><div style={{fontSize:18,fontWeight:700,color:C.draw,fontFamily:"'JetBrains Mono',monospace"}}>{matchResult.mostLikely[0]} — {matchResult.mostLikely[1]}</div><div style={{fontSize:11,color:C.textDim}}>({(matchResult.mostLikelyProb*100).toFixed(1)}%)</div></div>
              <div style={{textAlign:"center"}}><div style={{fontSize:11,color:C.textDim}}>{t.expected_goals}</div><div style={{fontSize:18,fontWeight:700,color:C.away,fontFamily:"'JetBrains Mono',monospace"}}>{matchResult.lambdaA.toFixed(2)}</div><div style={{fontSize:11,color:C.textDim}}>{awayTeam}</div></div>
            </div>
          </div>
          <div style={{padding:20,background:C.card,borderRadius:12,border:`1px solid ${C.border}`}}>
            <h3 style={{margin:"0 0 16px",fontSize:13,color:C.textDim,textTransform:"uppercase",letterSpacing:".08em"}}>{t.score_matrix}</h3>
            <ScoreMatrix matrix={matchResult.matrix} homeTeam={homeTeam} awayTeam={awayTeam} />
          </div>
        </div>}

        {matchResult&&<GeminiAnalysis C={C} league={LEAGUES[league]?.[lang]||league} season={season} homeTeam={homeTeam} awayTeam={awayTeam} modelName={model} matchResult={matchResult} fixture={liveFixture||fixtureNotice} dataStatus={status} />}

        <div style={{padding:"14px 18px",background:C.accentBg,borderRadius:8,borderLeft:`3px solid ${C.accent}40`,fontSize:13,color:C.textDim,lineHeight:1.6}}><strong style={{color:C.accent}}>{model}:</strong> {t.model_descriptions[model]}</div>
      </div>}

      {/* ─── LIVESCORES ─── */}
      {tab==="livescore"&&<LivescorePanel t={t} />}

      {/* ─── LEAGUE PREDICTOR ─── */}
      {tab==="league"&&<div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:isMobile?16:24}}>
        <div style={{padding:20,background:C.card,borderRadius:12,border:`1px solid ${C.border}`}}><h3 style={{margin:"0 0 16px",fontSize:14,color:C.accent,fontWeight:600}}>{t.predicted_table} — {model}</h3><LTable table={predictedTable} t={t} badges={badges} /></div>
        <div style={{padding:20,background:C.card,borderRadius:12,border:`1px solid ${C.border}`}}><h3 style={{margin:"0 0 16px",fontSize:14,color:C.textDim,fontWeight:600}}>{t.actual_table}</h3><LTable table={actualTable} t={t} badges={badges} /></div>
      </div>}

      {/* ─── ASSUMPTIONS ─── */}
      {tab==="assumptions"&&assumption&&<div style={{display:"flex",flexDirection:"column",gap:20}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,220px),1fr))",gap:16}}>{assumption.results.map(r=><div key={r.name} style={{padding:20,background:C.card,borderRadius:12,border:`1px solid ${C.border}`,textAlign:"center"}}><div style={{fontSize:32,fontWeight:700,color:r.color,fontFamily:"'JetBrains Mono',monospace"}}>{r.value}</div><div style={{fontSize:12,color:C.textDim,marginTop:2}}>{r.name}</div><div style={{fontSize:18,fontWeight:600,color:r.color,marginTop:6,fontFamily:"'JetBrains Mono',monospace"}}>{(r.value/assumption.total*100).toFixed(1)}%</div></div>)}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:16}}>
          {[{title:t.home_goals,dist:assumption.homeGoalDist,mean:assumption.meanH,color:C.home,colorDim:`${C.home}60`},{title:t.away_goals,dist:assumption.awayGoalDist,mean:assumption.meanA,color:C.away,colorDim:`${C.away}60`}].map((g,idx)=><div key={idx} style={{padding:16,background:C.card,borderRadius:12,border:`1px solid ${C.border}`}}>
            <h3 style={{margin:"0 0 2px",fontSize:13,color:g.color}}>{g.title}</h3><p style={{margin:"0 0 10px",fontSize:11,color:C.textDim}}>λ̂ = {g.mean}</p>
            <ResponsiveContainer width="100%" height={200}><BarChart data={g.dist} barGap={2}><XAxis dataKey="goals" tick={{fill:C.textDim,fontSize:12}} axisLine={{stroke:C.border}} tickLine={false} /><YAxis tick={{fill:C.textDim,fontSize:11}} axisLine={false} tickLine={false} /><Tooltip contentStyle={{background:C.tooltipBg,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12}} /><Bar dataKey="observed" fill={g.colorDim} radius={[4,4,0,0]} name={t.observed} /><Bar dataKey="poisson" fill={g.color} radius={[4,4,0,0]} name={t.poisson_expected} /><Legend wrapperStyle={{fontSize:11,color:C.textDim}} /></BarChart></ResponsiveContainer>
          </div>)}
        </div>
        <h3 style={{margin:"8px 0 0",fontSize:16,fontWeight:600,color:C.text}}>{t.hypothesis_tests} <span style={{fontSize:12,color:C.textDim,fontWeight:400}}>({t.alpha_level})</span></h3>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,300px),1fr))",gap:16}}>
          <TestCard title={`${t.gof_test} (${t.home_label})`} h0={t.gof_h0} result={assumption.gofHome} t={t} />
          <TestCard title={`${t.gof_test} (${t.away_label})`} h0={t.gof_h0} result={assumption.gofAway} t={t} />
          <TestCard title={`${t.disp_test} (${t.home_label})`} h0={t.disp_h0} result={assumption.dispHome} t={t} />
          <TestCard title={`${t.disp_test} (${t.away_label})`} h0={t.disp_h0} result={assumption.dispAway} t={t} />
        </div>
        <TestCard title={t.indep_test} h0={t.indep_h0} result={assumption.indep} t={t} />
      </div>}

      {/* ─── MODELS (with KaTeX) ─── */}
      {tab==="models"&&<div style={{display:"flex",flexDirection:"column",gap:16}}>
        {MODEL_NAMES.map(m=><div key={m} onClick={()=>setModel(m)} style={{padding:24,background:C.card,borderRadius:12,cursor:"pointer",transition:"all .2s",border:`1px solid ${model===m?C.accent+"60":C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <h3 style={{margin:0,fontSize:18,fontFamily:"'Instrument Serif',serif",color:model===m?C.accent:C.text}}>{m}</h3>
            {model===m&&<span style={{padding:"4px 12px",background:C.accentBg,borderRadius:12,fontSize:11,color:C.accent,fontWeight:600}}>{t.selected}</span>}
          </div>
          <p style={{margin:"8px 0 0",fontSize:14,color:C.textDim,lineHeight:1.6}}>{t.model_descriptions[m]}</p>
          <div style={{marginTop:14,padding:16,background:C.cardAlt,borderRadius:8,display:"flex",flexDirection:"column",gap:10}}>
            {katexLoaded && MODEL_LATEX[m]?.map((eq,i)=><div key={i} style={{overflowX:"auto"}}><Katex math={eq} display={true} /></div>)}
            {!katexLoaded && <div style={{fontSize:12,color:C.textMuted,fontFamily:"'JetBrains Mono',monospace"}}>Loading math...</div>}
          </div>
        </div>)}
      </div>}

      {/* ─── DATA & TESTS ─── */}
      {tab==="data"&&<div style={{display:"flex",flexDirection:"column",gap:18}}>
        <h2 style={{margin:0,fontSize:20,fontWeight:600,color:C.text}}>{t.data_title}</h2>
        {synthetic&&<div style={{padding:12,background:`${C.danger}15`,border:`1px solid ${C.danger}50`,borderRadius:8,fontSize:12,color:C.danger}}>⚠️ {t.data_synthetic_warning}</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,260px),1fr))",gap:16}}>
          <DataCard title={t.data_historical} accent={C.accent+"35"}>
            <div style={{fontSize:24,fontWeight:700,color:C.accent,fontFamily:"'JetBrains Mono',monospace"}}>{status?.historicalMatches?.toLocaleString()||"—"}</div>
            <div style={{fontSize:12,color:C.textDim,marginTop:6}}>{t.data_matches} · {status?.historicalSeasons||0} {t.data_seasons}</div>
            <div style={{fontSize:12,color:C.textDim,marginTop:4}}>{t.data_range}: {status?.earliest||"—"} → {status?.latest||"—"}</div>
            <div style={{fontSize:11,color:C.textDim,marginTop:4}}>{t.source_label}: {status?.historicalSources?.join(" + ")||"—"}</div>
            <div style={{fontSize:11,color:C.textDim,marginTop:4}}>{t.data_last_update}: {fmtDateTime(status?.historicalFetchedAt)}</div>
            {status?.lastMatchDate&&<div style={{fontSize:11,color:C.textDim,marginTop:4}}>Last match in file: {status.lastMatchDate}</div>}
          </DataCard>
          <DataCard title={t.data_current} accent={leagueLive?.available?C.success+"35":C.warning+"35"}>
            <div style={{fontSize:20,fontWeight:700,color:C.text,fontFamily:"'JetBrains Mono',monospace"}}>{status?.currentSeason||"—"}</div>
            <div style={{fontSize:12,color:C.textDim,marginTop:6}}>{t.source_label}: {leagueLive?.available?leagueLive.source:t.data_missing}</div>
            <div style={{fontSize:11,color:C.textDim,marginTop:4}}>{t.data_last_update}: {fmtDateTime(status?.liveGeneratedAt)}</div>
            <div style={{fontSize:11,color:leagueLive?.available?(leagueLive.liveSupported?C.success:C.warning):C.danger,marginTop:4,fontWeight:600}}>{leagueLive?.available?(leagueLive.liveSupported?`🟢 ${t.data_live_supported}`:`🟠 ${t.data_not_live}`):`🔴 ${t.data_missing}`}</div>
            {leagueLive?.stale&&<div style={{fontSize:11,color:C.warning,fontWeight:700,marginTop:4}}>⚠️ {t.data_stale} · {leagueLive.lagDays} days</div>}
            {leagueLive?.lastResultDate&&<div style={{fontSize:11,color:C.textDim,marginTop:4}}>Last result: {leagueLive.lastResultDate}</div>}
            {leagueLive?.updateFrequency&&<div style={{fontSize:10,color:C.textMuted,marginTop:4}}>{leagueLive.updateFrequency}</div>}
          </DataCard>
          <DataCard title="Current-season coverage">
            {Object.keys(LEAGUES).map(id=>{const l=live?.leagues?.[id];const u=live?.unavailable?.[id];return<div key={id} style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:11,padding:"3px 0",borderBottom:`1px solid ${C.border}33`}}><span style={{color:C.text}}>{id} · {LEAGUES[id]?.[lang]||id}</span><span style={{color:l?(l.liveSupported?C.success:C.warning):C.danger,fontWeight:600,textAlign:"right"}}>{l?(l.liveSupported?"live":"fixtures/results"):(u?"unavailable":"—")}</span></div>;})}
          </DataCard>
        </div>

        <DataCard title={`${t.fixtures_title} · ${LEAGUES[league]?.[lang]||league}`}>
          {leagueLive?.available?<div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{fontSize:11,color:C.textDim}}>{t.source_label}: {leagueLive.source} · {t.data_last_update}: {fmtDateTime(leagueLive.fetchedAt)} · {leagueLive.liveSupported?`🟢 ${t.data_live_supported}`:`🟠 ${t.data_not_live}`}</div>
            {leagueLive.warnings?.map((w,i)=><div key={i} style={{padding:"8px 10px",background:`${C.warning}12`,border:`1px solid ${C.warning}35`,borderRadius:6,fontSize:11,color:C.warning}}>⚠️ {w}</div>)}
            {fixturesLive.length>0&&<div><h4 style={{margin:"0 0 6px",fontSize:12,color:C.danger}}>● {t.live_now}</h4><FixtureTable rows={fixturesLive} t={t} onUse={useFixture} /></div>}
            <div><h4 style={{margin:"0 0 6px",fontSize:12,color:C.accent}}>{t.upcoming_fixtures}</h4><FixtureTable rows={fixturesUpcoming} t={t} onUse={useFixture} empty={t.no_data} /></div>
            <div><h4 style={{margin:"0 0 6px",fontSize:12,color:C.success}}>{t.recent_results}</h4><FixtureTable rows={fixturesRecent} t={t} onUse={useFixture} empty={t.no_data} /></div>
            {fixturesAwaiting.length>0&&<div><h4 style={{margin:"0 0 6px",fontSize:12,color:C.warning}}>{t.status_awaiting}</h4><FixtureTable rows={fixturesAwaiting} t={t} onUse={useFixture} /></div>}
          </div>:<div style={{padding:14,background:`${C.warning}10`,border:`1px solid ${C.warning}35`,borderRadius:8,fontSize:12,color:C.warning}}>⚠️ {t.no_current_data}{leagueLive?.reason?` (${leagueLive.reason})`:""}</div>}
        </DataCard>

        <DataCard title={t.validation_title}><ValidationPanel validation={validation} t={t} /></DataCard>
        <div style={{padding:"12px 16px",background:C.cardAlt,borderRadius:8,fontSize:11,color:C.textDim,lineHeight:1.6}}>ℹ️ {t.data_limitations}</div>
      </div>}

    </main>
    <footer style={{padding:"14px 32px",borderTop:`1px solid ${C.border}`,textAlign:"center",fontSize:11,color:C.textMuted}}>{t.data_source} • {t.built_with} React + Recharts + KaTeX • {t.models_credit}</footer>
  </div>
  </ThemeCtx.Provider>);
}
