# ProbWatch

ProbWatch is a transparent movie recommender built to demonstrate empirical probability, conditional probability, sampling uncertainty, and prediction evaluation. It deliberately does **not** use embeddings, neural networks, collaborative-filtering packages, or opaque models.

## Run

```bash
npm install
npm run dev
```

For a production check: `npm run build` then `npm run preview`.

## Data

The app includes the [MovieLens 1M](https://grouplens.org/datasets/movielens/1m/) dataset from GroupLens: 1,000,209 ratings from 6,040 users for 3,883 movies, released in 2003. It is a stable public benchmark. See the included `public/data` files and the dataset `README` for the original terms. GroupLens asks users not to state or imply endorsement and requires acknowledgement when reporting results based on the data. This educational demo uses the data locally in the browser; it does not send ratings anywhere.

`public/data/enriched-movies.json` is a compact, generated subset of the hosted [MovieLens 32M enriched movies dataset](https://huggingface.co/datasets/krishnakamath/movielens-32m-movies-enriched). It matches 3,850 current MovieLens 1M movie IDs and supplies display-only genres, plot summaries, directors, and cast. Rating evidence and all probability calculations still use MovieLens 1M only.

## Model

The user supplies ratings. A rating ≥4 is treated as a “like.” For candidate movie `M` and one liked seed movie `S`:

```
P(like M | liked S) = count(users who liked S and liked M)
                      / count(users who liked S and rated M)
```

For multiple liked seed films, ProbWatch pools the numerator and denominator across seeds. This is an easy-to-audit evidence aggregation rule, not an independence assumption or a causal model. Candidate movies require at least 12 comparable ratings. The displayed 95% range is a Wilson confidence interval for the pooled proportion.

Uncertainty falls roughly as `1 / sqrt(n)`, so more comparable ratings make the interval narrower. This is visualized in the learning section.

## Evaluation

“Reality check” takes deterministic eligible MovieLens users, uses their earlier liked ratings as observations, hides each user’s two latest ratings, and predicts those ratings. The test user is excluded from all evidence counts, avoiding direct target leakage. It reports the number of held-out predictions, threshold accuracy (prediction ≥50% vs. actual like/not-like), Brier score, and probability-band calibration-style comparisons.

## Limitations

MovieLens 1M is old and not representative of everyone today. Historical ratings have selection bias and correlated users; seed evidence can overlap; rating ≥4 is a coarse definition of enjoyment. Results describe association in this dataset, not a causal or personalised guarantee.

## Architecture

The UI lives in `src/main.jsx`. It includes a guided quick-start, genre/release-decade filtering, evidence-strength labels, and the explanation view. The deterministic data parser is in `src/lib/dataset.js`; the probability engine, Wilson interval, and hold-out evaluator are in `src/lib/probability.js`. `public/data/ratings.dat` and `public/data/movies.dat` are the original MovieLens 1M data files copied from the official release. No server, accounts, tracking, or model API is involved.

Run `npm test` to execute the probability-engine unit tests, and `npm run build` to verify the production bundle.

## 32M backend (Render)

The GitHub Pages frontend currently uses the local 1M dataset. The `backend/` service is the production path for MovieLens 32M: FastAPI receives movie-search and recommendation requests, while PostgreSQL stores and indexes the dataset. The recommendation SQL implements the same pooled empirical conditional probability used by the frontend; no opaque model is added.

1. Push this repository to GitHub and create a new Render Blueprint from `render.yaml`.
2. Choose a PostgreSQL plan with enough disk for 32M ratings and its two indexes (at least 10 GB is a practical starting point).
3. In the Render web service Shell, run `python scripts/import_movielens_32m.py`. It downloads the official 32M archive and imports the `movies.csv` and `ratings.csv` data into PostgreSQL.
4. Verify `https://YOUR-RENDER-SERVICE.onrender.com/health`, then set `VITE_API_BASE_URL` to that URL when switching the frontend from its local dataset to the API.

The API provides `GET /movies?q=...`, `POST /recommendations`, and `GET /health`. Keep the API URL in an environment setting, never hard-code credentials or `DATABASE_URL` in frontend code.
