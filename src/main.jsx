import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { parseMovieLens } from './lib/dataset';
import { evaluatePredictions, formatPercentage, getRecommendations, LIKE_THRESHOLD, wilsonInterval } from './lib/probability';

const MAX_SELECTIONS = 8;
const STARTER_MOVIE_IDS = [1, 50, 260, 318, 527, 593, 858, 1196];

function getYear(title) { return Number(title.match(/\((\d{4})\)$/)?.[1]) || null; }
function evidenceStrength(observations) {
  if (observations >= 150) return { label: 'Strong evidence', tone: 'strong' };
  if (observations >= 50) return { label: 'Moderate evidence', tone: 'moderate' };
  return { label: 'Early evidence', tone: 'early' };
}
function enrichMovie(movie, metadata) {
  const extra = metadata[String(movie.id)];
  return extra ? { ...movie, genres: extra.genres.length ? extra.genres : movie.genres, plotSummary: extra.plotSummary, director: extra.director, stars: extra.stars } : movie;
}

function RecommendationCard({ movie, onOpen }) {
  const strength = evidenceStrength(movie.observations);
  return <article className="rec card">
    <div className="rec-top"><span className={`badge ${strength.tone}`}>{strength.label}</span><button onClick={() => onOpen(movie)}>Why this? →</button></div>
    <p className="genres">{movie.genres?.slice(0, 3).join(' · ') || 'Movie'}</p>
    <h3>{movie.title}</h3>
    {movie.director && <p className="credits">Directed by {movie.director}</p>}
    <p className="prob">{formatPercentage(movie.probability)} <small>estimated chance</small></p>
    <div className="range" aria-label={`95% range from ${formatPercentage(movie.lowerBound)} to ${formatPercentage(movie.upperBound)}`}><span style={{ left: `${movie.lowerBound * 100}%`, width: `${(movie.upperBound - movie.lowerBound) * 100}%` }} /><i style={{ left: `${movie.probability * 100}%` }} /></div>
    <p className="interval">95% range: {formatPercentage(movie.lowerBound)}–{formatPercentage(movie.upperBound)}</p>
    <p className="muted">{movie.successes} likes in {movie.observations} comparable ratings</p>
  </article>;
}

function EvidenceModal({ movie, onClose }) {
  if (!movie) return null;
  const strength = evidenceStrength(movie.observations);
  return <div className="modal-back" onClick={onClose}><aside className="modal card" onClick={event => event.stopPropagation()}>
    <button className="close" onClick={onClose} aria-label="Close explanation">×</button>
    <p className="eyebrow">WHY THIS MOVIE</p><h2>{movie.title}</h2><p className="genres">{movie.genres?.join(' · ')}</p>
    {(movie.director || movie.stars?.length) && <p className="credits">{movie.director && <>Directed by {movie.director}</>}{movie.director && movie.stars?.length ? ' · ' : ''}{movie.stars?.length ? `Starring ${movie.stars.join(', ')}` : ''}</p>}
    {movie.plotSummary && <p className="plot">{movie.plotSummary}</p>}
    <p className="bigformula">P(like this movie | liked your selected films)</p>
    <div className="equation"><b>{movie.successes}</b><span>people liked it</span><b>÷</b><b>{movie.observations}</b><span>comparable ratings</span><b>=</b><strong>{formatPercentage(movie.probability)}</strong></div>
    <div className="notice"><b>{strength.label}.</b> The 95% range is {formatPercentage(movie.lowerBound)}–{formatPercentage(movie.upperBound)}. We pool ratings from people who liked one or more of your 4★–5★ selections. Wider ranges mean less certainty.</div>
  </aside></div>;
}

function LoadingScreen({ error }) {
  return <main className="loading-screen">
    <div className="loading-card">
      <div className="loading-brand"><span className="orb">P</span><span>ProbWatch</span></div>
      {error ? <>
        <p className="eyebrow">A SMALL DETOUR</p>
        <h1>We couldn’t reach the movie evidence.</h1>
        <p className="loading-copy">The local dataset did not load. Refresh the page to try again.</p>
        <button className="primary" onClick={() => window.location.reload()}>Try again</button>
      </> : <>
        <p className="eyebrow">PREPARING YOUR EVIDENCE DESK</p>
        <h1>Loading the stories<br /><em>behind the numbers.</em></h1>
        <p className="loading-copy">We’re indexing one million real movie ratings and enriching the catalog with directors, cast, and plot details.</p>
        <div className="loading-progress" aria-label="Loading MovieLens data"><span /></div>
        <div className="loading-steps"><span>Ratings</span><span>Movie details</span><span>Probability engine</span></div>
        <p className="loading-note">No account. No tracking. Just transparent evidence.</p>
      </>}
    </div>
    <div className="loading-orbit orbit-one" /><div className="loading-orbit orbit-two" />
  </main>;
}

function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [selections, setSelections] = useState([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(null);
  const [tab, setTab] = useState('recommend');
  const [evalResult, setEvalResult] = useState(null);
  const [genreFilter, setGenreFilter] = useState('All genres');
  const [decadeFilter, setDecadeFilter] = useState('All years');

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    Promise.all([
      fetch(`${base}data/ratings.dat`).then(response => response.ok ? response.text() : Promise.reject(new Error('Unable to load ratings.'))),
      fetch(`${base}data/movies.dat`).then(response => response.ok ? response.text() : Promise.reject(new Error('Unable to load movies.'))),
      fetch(`${base}data/enriched-movies.json`).then(response => response.ok ? response.json() : {}),
    ]).then(([ratings, movies, metadata]) => {
      const parsed = parseMovieLens(ratings, movies, LIKE_THRESHOLD);
      parsed.movies = new Map([...parsed.movies].map(([id, movie]) => [id, enrichMovie(movie, metadata)]));
      setData(parsed);
    }).catch(error => setLoadError(error.message));
  }, []);

  const suggestions = useMemo(() => {
    if (!data) return [];
    const selected = new Set(selections.map(selection => selection.id));
    const normalisedQuery = query.trim().toLowerCase();
    return [...data.movies.values()].filter(movie => !selected.has(movie.id) && movie.title.toLowerCase().includes(normalisedQuery)).slice(0, normalisedQuery ? 8 : 12);
  }, [data, query, selections]);
  const recommendationPool = useMemo(() => data ? getRecommendations(data, selections, { limit: 60 }) : [], [data, selections]);
  const genres = useMemo(() => ['All genres', ...new Set(recommendationPool.flatMap(movie => movie.genres || []))].sort(), [recommendationPool]);
  const filteredRecommendations = useMemo(() => recommendationPool.filter(movie => {
    const year = getYear(movie.title);
    return (genreFilter === 'All genres' || movie.genres?.includes(genreFilter)) && (decadeFilter === 'All years' || (year && Math.floor(year / 10) * 10 === Number(decadeFilter)));
  }).slice(0, 12), [recommendationPool, genreFilter, decadeFilter]);
  const addMovie = movie => { if (selections.length < MAX_SELECTIONS && !selections.some(selection => selection.id === movie.id)) setSelections(current => [...current, { id: movie.id, rating: 5 }]); setQuery(''); };
  const updateRating = (id, rating) => setSelections(current => current.map(item => item.id === id ? { ...item, rating } : item));
  const removeMovie = id => setSelections(current => current.filter(item => item.id !== id));

  if (loadError) return <LoadingScreen error />;
  if (!data) return <LoadingScreen />;
  const starterMovies = STARTER_MOVIE_IDS.map(id => data.movies.get(id)).filter(Boolean);
  const likedCount = selections.filter(selection => selection.rating >= LIKE_THRESHOLD).length;

  return <main>
    <header><div className="brand"><span className="orb">P</span><span>ProbWatch</span><small>evidence, not magic</small></div><nav><button className={tab === 'recommend' ? 'on' : ''} onClick={() => setTab('recommend')}>Discover</button><button className={tab === 'evaluate' ? 'on' : ''} onClick={() => setTab('evaluate')}>Reality check</button><button className={tab === 'learn' ? 'on' : ''} onClick={() => setTab('learn')}>How it works</button></nav></header>
    {tab === 'recommend' && <><section className="hero"><p className="eyebrow">CONDITIONAL PROBABILITY, MADE WATCHABLE</p><h1>Find a movie with <em>evidence</em> behind it.</h1><p>Start with films you know. We show historical evidence, uncertainty, and richer movie details behind every recommendation.</p></section>
      <section className="picker card"><div className="picker-heading"><div><h2>Your watched films</h2><p className="muted">Choose 2–8. Ratings of 4★ or 5★ become your “liked” evidence.</p></div><span className="selection-count">{selections.length}/{MAX_SELECTIONS} selected</span></div>
        {!selections.length && <div className="quick-start"><span>Quick start</span>{starterMovies.map(movie => <button key={movie.id} onClick={() => addMovie(movie)}>+ {movie.title}</button>)}</div>}
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search a movie you have watched…" aria-label="Search movies" /><div className="chips">{suggestions.map(movie => <button key={movie.id} onClick={() => addMovie(movie)} className="movie-chip">+ {movie.title}</button>)}</div>
        <div className="selected">{selections.map(selection => { const movie = data.movies.get(selection.id); return <div className="selected-movie" key={selection.id}><span>{movie.title}</span><span className="stars">{[1, 2, 3, 4, 5].map(rating => <button key={rating} onClick={() => updateRating(selection.id, rating)} className={rating <= selection.rating ? 'lit' : ''} aria-label={`Rate ${movie.title} ${rating} stars`}>★</button>)}</span><button className="remove" onClick={() => removeMovie(selection.id)} aria-label={`Remove ${movie.title}`}>×</button></div>; })}</div>
      </section>
      {!selections.length ? <section className="empty card"><h2>Two familiar films is enough to begin</h2><p>Use Quick start or search for films you’ve already seen. You can refine the ratings afterwards.</p></section> : !likedCount ? <section className="empty card"><h2>Add at least one film you liked</h2><p>Move a rating to 4★ or 5★ to create the evidence group.</p></section> : <section className="results"><div className="result-title"><div><p className="eyebrow">YOUR EVIDENCE-BASED SHORTLIST</p><h2>Recommendations, with uncertainty included</h2></div><span>{likedCount} liked films observed</span></div><p className="sort-note">Sorted by evidence strength: more comparable ratings appear first.</p><div className="filters"><label>Genre<select value={genreFilter} onChange={event => setGenreFilter(event.target.value)}>{genres.map(genre => <option key={genre}>{genre}</option>)}</select></label><label>Release decade<select value={decadeFilter} onChange={event => setDecadeFilter(event.target.value)}><option>All years</option>{[1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000].map(decade => <option key={decade} value={decade}>{decade}s</option>)}</select></label></div><div className="grid">{filteredRecommendations.map(movie => <RecommendationCard key={movie.id} movie={movie} onOpen={setActive} />)}</div>{!filteredRecommendations.length && <section className="empty card"><h2>No matches for those filters</h2><p>Try another genre or release decade.</p></section>}</section>}
      <EvidenceModal movie={active} onClose={() => setActive(null)} /></>}
    {tab === 'evaluate' && <section className="page"><p className="eyebrow">PREDICTIONS SHOULD FACE REALITY</p><h1>Hold-out evaluation</h1><p className="lede">We hide each test user’s two latest ratings, estimate them from earlier liked films, then compare the prediction with the actual rating. The test user is excluded from evidence counts.</p><button className="primary" onClick={() => setEvalResult(evaluatePredictions(data))}>Run deterministic evaluation</button>{evalResult && <><div className="metrics"><div className="card"><b>{evalResult.tests.length}</b><span>held-out predictions</span></div><div className="card"><b>{formatPercentage(evalResult.accuracy)}</b><span>like / not-like accuracy</span></div><div className="card"><b>{evalResult.brier.toFixed(3)}</b><span>Brier score (lower is better)</span></div></div><div className="card calibration"><h2>Calibration-style check</h2><p className="muted">Within each probability band, did the observed like rate resemble what we predicted?</p>{evalResult.bins.map(bin => <div className="bin" key={bin.label}><span>{bin.label}</span><div><i style={{ width: `${bin.predicted * 100}%` }} /><em style={{ width: `${bin.observed * 100}%` }} /></div><small>predicted {formatPercentage(bin.predicted)} · actual {formatPercentage(bin.observed)} · n={bin.count}</small></div>)}<p className="legend"><i /> predicted probability <em /> actual like rate</p></div></>}</section>}
    {tab === 'learn' && <section className="page learn"><p className="eyebrow">NO BLACK BOX</p><h1>The maths in ProbWatch</h1><div className="card"><h2>1. Empirical conditional probability</h2><p>For a candidate movie M and a liked seed S: <code>P(like M | liked S) = count(liked S and liked M) / count(liked S and rated M)</code>. We pool these counts across your liked seeds to give recommendations more evidence.</p><h2>2. Uncertainty, not false precision</h2><p>Each card uses a 95% Wilson interval for a proportion. Its width shrinks roughly with <code>1 / √n</code>: quadrupling comparable ratings approximately halves sampling uncertainty.</p><div className="sample-demo">{[12, 48, 192].map(n => { const [lower, upper] = wilsonInterval(Math.round(.7 * n), n); return <div key={n}><b>n = {n}</b><span className="range"><i style={{ left: `${lower * 100}%`, width: `${(upper - lower) * 100}%` }} /></span><small>{formatPercentage(lower)}–{formatPercentage(upper)}</small></div>; })}</div><h2>3. Important limits</h2><p>These ratings are historical opinions from MovieLens 1M (2003), not a representative sample of everyone today. Ratings are not independent, pooled seeds can overlap, and “like” means 4★ or 5★. This is a learning-focused association model, not a claim that one movie causes enjoyment of another.</p></div></section>}
    <footer>MovieLens 1M rating evidence · enriched catalog details · deterministic calculations</footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
