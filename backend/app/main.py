import math
import os
from contextlib import contextmanager

import psycopg
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from pydantic import BaseModel, Field

LIKE_THRESHOLD = 4.0
MINIMUM_EVIDENCE = 12
DEFAULT_LIMIT = 12


class Selection(BaseModel):
    movie_id: int = Field(gt=0)
    rating: float = Field(ge=0.5, le=5)


class RecommendationRequest(BaseModel):
    selections: list[Selection] = Field(min_length=1, max_length=8)
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=50)


def wilson_interval(successes: int, observations: int) -> tuple[float, float]:
    """Return a two-sided 95% Wilson confidence interval."""
    if observations == 0:
        return 0, 1

    z = 1.96
    proportion = successes / observations
    z_squared = z**2
    denominator = 1 + z_squared / observations
    center = (proportion + z_squared / (2 * observations)) / denominator
    radius = z * math.sqrt(
        (proportion * (1 - proportion) + z_squared / (4 * observations)) / observations
    ) / denominator
    return max(0, center - radius), min(1, center + radius)


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not configured.")
    return url


@contextmanager
def connection():
    with psycopg.connect(database_url(), row_factory=dict_row) as database:
        yield database


app = FastAPI(title="ProbWatch API", version="1.0.0")
origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health_check():
    with connection() as database, database.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) AS movie_count FROM movies")
        return {"status": "ok", "movies": cursor.fetchone()["movie_count"]}


@app.get("/movies")
def search_movies(q: str = Query(min_length=1, max_length=100), limit: int = Query(default=8, ge=1, le=25)):
    with connection() as database, database.cursor() as cursor:
        cursor.execute(
            """
            SELECT movie_id, title, genres
            FROM movies
            WHERE title ILIKE %(query)s
            ORDER BY title
            LIMIT %(limit)s
            """,
            {"query": f"%{q.strip()}%", "limit": limit},
        )
        return {"movies": cursor.fetchall()}


@app.post("/recommendations")
def recommendations(request: RecommendationRequest):
    liked_movie_ids = [item.movie_id for item in request.selections if item.rating >= LIKE_THRESHOLD]
    selected_movie_ids = [item.movie_id for item in request.selections]
    if not liked_movie_ids:
        raise HTTPException(status_code=422, detail="Select at least one movie rated 4 stars or higher.")

    # Each matching user contributes once per liked seed, exactly matching the
    # deliberately simple pooled conditional-probability model in the frontend.
    query = """
        SELECT
            m.movie_id,
            m.title,
            m.genres,
            COUNT(*) FILTER (WHERE candidate.rating >= %(threshold)s) AS successes,
            COUNT(*) AS observations
        FROM ratings AS seed
        JOIN ratings AS candidate ON candidate.user_id = seed.user_id
        JOIN movies AS m ON m.movie_id = candidate.movie_id
        WHERE seed.movie_id = ANY(%(liked_movie_ids)s)
          AND seed.rating >= %(threshold)s
          AND NOT candidate.movie_id = ANY(%(selected_movie_ids)s)
        GROUP BY m.movie_id, m.title, m.genres
        HAVING COUNT(*) >= %(minimum_evidence)s
        ORDER BY
            COUNT(*) FILTER (WHERE candidate.rating >= %(threshold)s)::float / COUNT(*) DESC,
            COUNT(*) DESC
        LIMIT %(limit)s
    """
    with connection() as database, database.cursor() as cursor:
        cursor.execute(
            query,
            {
                "liked_movie_ids": liked_movie_ids,
                "selected_movie_ids": selected_movie_ids,
                "threshold": LIKE_THRESHOLD,
                "minimum_evidence": MINIMUM_EVIDENCE,
                "limit": request.limit,
            },
        )
        rows = cursor.fetchall()

    results = []
    for row in rows:
        successes, observations = row["successes"], row["observations"]
        lower_bound, upper_bound = wilson_interval(successes, observations)
        results.append({
            "id": row["movie_id"],
            "title": row["title"],
            "genres": row["genres"].split("|"),
            "successes": successes,
            "observations": observations,
            "probability": successes / observations,
            "lowerBound": lower_bound,
            "upperBound": upper_bound,
        })
    return {"recommendations": results}
