import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const LIKE = 4;
const movieSeeds = [50, 100, 127, 174, 181, 286, 56, 98, 172, 79, 1, 7];
const pct = n => `${Math.round(n * 100)}%`;
const ratingText = n => '★'.repeat(n) + '☆'.repeat(5 - n);

function wilson(success, total) {
  if (!total) return [0, 1];
  const z = 1.96, p = success / total, z2 = z * z;
  const center = (p + z2 / (2 * total)) / (1 + z2 / total);
  const radius = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / (1 + z2 / total);
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

function parseData(ratingsText, moviesText) {
  const movies = new Map();
  moviesText.trim().split('\n').forEach(line => { const [id, title, ...rest] = line.split('|'); movies.set(+id, { id:+id, title, genres: rest.slice(2, -1).map((x, i) => x === '1' ? ['Unknown','Action','Adventure','Animation','Children','Comedy','Crime','Documentary','Drama','Fantasy','Film-Noir','Horror','Musical','Mystery','Romance','Sci-Fi','Thriller','War','Western'][i] : null).filter(Boolean) }); });
  const users = new Map(), byMovie = new Map(), ratingMap = new Map();
  ratingsText.trim().split('\n').forEach(line => { const [u,m,r,t] = line.split('\t').map(Number); const entry={u,m,r,t,like:r>=LIKE}; if(!users.has(u)) { users.set(u,[]); ratingMap.set(u,new Map()); } if(!byMovie.has(m)) byMovie.set(m,[]); users.get(u).push(entry); ratingMap.get(u).set(m,entry); byMovie.get(m).push(entry); });
  return { movies, users, byMovie, ratingMap };
}

function recommend(data, selections, excludeUser = null) {
  const liked = selections.filter(x => x.rating >= LIKE).map(x => x.id);
  if (!liked.length) return [];
  const selected = new Set(selections.map(x => x.id));
  const results=[];
  for (const [id, movie] of data.movies) {
    if (selected.has(id)) continue;
    let success=0, trials=0;
    for (const seed of liked) {
      const people = data.byMovie.get(seed) || [];
      for (const entry of people) {
        if (!entry.like || entry.u === excludeUser) continue;
        const target = data.ratingMap.get(entry.u)?.get(id);
        if (target) { trials++; if (target.like) success++; }
      }
    }
    if (trials >= 12) { const [lo,hi]=wilson(success,trials); results.push({id, ...movie, success,trials,p:success/trials,lo,hi}); }
  }
  return results.sort((a,b) => b.p-a.p || b.trials-a.trials).slice(0,12);
}

function evaluate(data) {
  const tests=[];
  [...data.users.entries()].filter(([,rs]) => rs.length >= 35).slice(0,45).forEach(([user, ratings]) => {
    const ordered=[...ratings].sort((a,b)=>a.t-b.t); const hold=ordered.slice(-2);
    const observed=ordered.slice(0,-2).filter(x=>x.like).slice(-8).map(x=>({id:x.m,rating:x.r}));
    if (observed.length < 2) return;
    const preds=recommend(data, observed, user);
    hold.forEach(actual => { const pred=preds.find(x=>x.id===actual.m); if(pred) tests.push({p:pred.p, actual:actual.like, title:data.movies.get(actual.m)?.title||'Movie'}); });
  });
  const accuracy=tests.length ? tests.filter(x => (x.p>=.5)===x.actual).length/tests.length : 0;
  const brier=tests.length ? tests.reduce((s,x)=>s+(x.p-(x.actual?1:0))**2,0)/tests.length : 0;
  const bins=[[0,.4],[.4,.55],[.55,.7],[.7,1.01]].map(([a,b])=>{const q=tests.filter(x=>x.p>=a&&x.p<b);return {label:`${pct(a)}–${pct(Math.min(b,1))}`, n:q.length, predicted:q.length?q.reduce((s,x)=>s+x.p,0)/q.length:0, observed:q.length?q.filter(x=>x.actual).length/q.length:0};});
  return {tests,accuracy,brier,bins};
}

function App() {
  const [data,setData]=useState(null), [selections,setSelections]=useState([]), [query,setQuery]=useState(''), [active,setActive]=useState(null), [tab,setTab]=useState('recommend'), [evalResult,setEvalResult]=useState(null);
  useEffect(()=>{Promise.all([fetch(`${import.meta.env.BASE_URL}data/ratings.tsv`).then(r=>r.text()),fetch(`${import.meta.env.BASE_URL}data/movies.pipe`).then(r=>r.text())]).then(([r,m])=>setData(parseData(r,m)));},[]);
  const suggestions=useMemo(()=> data ? [...data.movies.values()].filter(m=>m.title.toLowerCase().includes(query.toLowerCase())).slice(0, query?8:12) : [],[data,query]);
  const recs=useMemo(()=>data?recommend(data,selections):[],[data,selections]);
  const addMovie=m=>{if(!selections.some(x=>x.id===m.id)) setSelections(s=>[...s,{id:m.id,rating:5}]); setQuery('');};
  if(!data) return <main className="loading"><div className="orb">P</div><h1>ProbWatch</h1><p>Loading 100,000 ratings and building transparent evidence…</p></main>;
  return <main>
    <header><div className="brand"><span className="orb">P</span><span>ProbWatch</span><small>evidence, not magic</small></div><nav><button className={tab==='recommend'?'on':''} onClick={()=>setTab('recommend')}>Discover</button><button className={tab==='evaluate'?'on':''} onClick={()=>setTab('evaluate')}>Reality check</button><button className={tab==='learn'?'on':''} onClick={()=>setTab('learn')}>How it works</button></nav></header>
    {tab==='recommend' && <>
      <section className="hero"><p className="eyebrow">CONDITIONAL PROBABILITY, MADE WATCHABLE</p><h1>Find a movie with <em>evidence</em> behind it.</h1><p>Rate a few films you know. We estimate how often people who liked those same films also liked each recommendation.</p></section>
      <section className="picker card"><div><h2>Your watched films</h2><p className="muted">Choose 2–8. A rating of 4 or 5 counts as “liked.”</p></div><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search a movie…" aria-label="Search movies"/><div className="chips">{suggestions.map(m=><button key={m.id} onClick={()=>addMovie(m)} className="movie-chip">+ {m.title}</button>)}</div><div className="selected">{selections.map(s=>{const m=data.movies.get(s.id);return <div className="selected-movie" key={s.id}><span>{m.title}</span><span className="stars">{[1,2,3,4,5].map(n=><button key={n} onClick={()=>setSelections(xs=>xs.map(x=>x.id===s.id?{...x,rating:n}:x))} className={n<=s.rating?'lit':''}>★</button>)}</span><button className="remove" onClick={()=>setSelections(xs=>xs.filter(x=>x.id!==s.id))}>×</button></div>})}</div>
      </section>
      {!selections.length ? <section className="empty card"><h2>Start with a few familiar movies</h2><p>Your selections form the condition in each probability estimate.</p></section> : !selections.some(x=>x.rating>=LIKE) ? <section className="empty card"><h2>Add at least one film you liked</h2><p>Move a rating to 4★ or 5★ to create your evidence group.</p></section> : <section className="results"><div className="result-title"><div><p className="eyebrow">YOUR EVIDENCE-BASED SHORTLIST</p><h2>Recommendations, with the uncertainty included</h2></div><span>{selections.filter(x=>x.rating>=LIKE).length} liked films observed</span></div><div className="grid">{recs.map(r=><article className="rec card" key={r.id}><div className="rec-top"><span className="badge">LIKELY TO LIKE</span><button onClick={()=>setActive(r)}>See evidence →</button></div><h3>{r.title}</h3><p className="prob">{pct(r.p)} <small>estimated chance</small></p><div className="range"><span style={{left:`${r.lo*100}%`,width:`${(r.hi-r.lo)*100}%`}}></span><i style={{left:`${r.p*100}%`}}></i></div><p className="interval">95% range: {pct(r.lo)}–{pct(r.hi)}</p><p className="muted">{r.success} likes in {r.trials} comparable ratings</p></article>)}</div></section>}
      {active&&<div className="modal-back" onClick={()=>setActive(null)}><aside className="modal card" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setActive(null)}>×</button><p className="eyebrow">THE EVIDENCE FOR</p><h2>{active.title}</h2><p className="bigformula">P(like {active.title} | liked your selected films)</p><div className="equation"><b>{active.success}</b><span>people liked it</span><b>÷</b><b>{active.trials}</b><span>comparable ratings</span><b>=</b><strong>{pct(active.p)}</strong></div><p>For every film you rated 4★ or 5★, we find MovieLens users who also liked it. Each time one of those users rated this film, it becomes one observation. The estimate pools those observations.</p><div className="notice">The 95% range ({pct(active.lo)}–{pct(active.hi)}) is a Wilson confidence interval: a wider range means less evidence. People can appear in more than one condition, so this is a transparent heuristic—not a causal claim.</div></aside></div>}
    </>}
    {tab==='evaluate' && <section className="page"><p className="eyebrow">PREDICTIONS SHOULD FACE REALITY</p><h1>Hold-out evaluation</h1><p className="lede">We hide each test user’s two latest ratings, estimate them from earlier liked films, then compare the prediction with the actual rating. The test user is excluded from evidence counts.</p><button className="primary" onClick={()=>setEvalResult(evaluate(data))}>Run deterministic evaluation</button>{evalResult&&<><div className="metrics"><div className="card"><b>{evalResult.tests.length}</b><span>held-out predictions</span></div><div className="card"><b>{pct(evalResult.accuracy)}</b><span>like / not-like accuracy</span></div><div className="card"><b>{evalResult.brier.toFixed(3)}</b><span>Brier score (lower is better)</span></div></div><div className="card calibration"><h2>Calibration-style check</h2><p className="muted">Within each probability band, did the observed like rate resemble what we predicted?</p>{evalResult.bins.map(b=><div className="bin" key={b.label}><span>{b.label}</span><div><i style={{width:`${b.predicted*100}%`}}></i><em style={{width:`${b.observed*100}%`}}></em></div><small>predicted {pct(b.predicted)} · actual {pct(b.observed)} · n={b.n}</small></div>)}<p className="legend"><i></i> predicted probability <em></em> actual like rate</p></div></>}</section>}
    {tab==='learn' && <section className="page learn"><p className="eyebrow">NO BLACK BOX</p><h1>The maths in ProbWatch</h1><div className="card"><h2>1. Empirical conditional probability</h2><p>For a candidate movie M and a liked seed S: <code>P(like M | liked S) = count(liked S and liked M) / count(liked S and rated M)</code>. We pool these counts across your liked seeds to give recommendations more evidence.</p><h2>2. Uncertainty, not false precision</h2><p>Each card uses a 95% Wilson interval for a proportion. Its width shrinks roughly with <code>1 / √n</code>: quadrupling comparable ratings approximately halves sampling uncertainty.</p><div className="sample-demo">{[12,48,192].map(n=>{const [a,b]=wilson(Math.round(.7*n),n);return <div key={n}><b>n = {n}</b><span className="range"><i style={{left:`${a*100}%`,width:`${(b-a)*100}%`}}></i></span><small>{pct(a)}–{pct(b)}</small></div>})}</div><h2>3. Important limits</h2><p>These ratings are historical opinions from MovieLens 100K (1998), not a representative sample of everyone today. Ratings are not independent, pooled seeds can overlap, and “like” means 4★ or 5★. This is a learning-focused association model, not a claim that one movie causes enjoyment of another.</p></div></section>}
    <footer>Built from MovieLens 100K · deterministic calculations · no embeddings or opaque ML</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
