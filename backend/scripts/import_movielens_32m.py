"""Import the official MovieLens 32M CSV files into PostgreSQL.

Run from backend/ after setting DATABASE_URL. The importer can download the
official archive itself, or use a previously downloaded --archive path.
"""
import argparse
import csv
import io
import os
import tempfile
import urllib.request
import zipfile

import psycopg

DATASET_URL = "https://files.grouplens.org/datasets/movielens/ml-32m.zip"


def open_archive(path: str | None) -> zipfile.ZipFile:
    if path:
        return zipfile.ZipFile(path)

    temporary_file = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    temporary_file.close()
    print("Downloading the official MovieLens 32M archive…")
    urllib.request.urlretrieve(DATASET_URL, temporary_file.name)
    return zipfile.ZipFile(temporary_file.name)


def rows(archive: zipfile.ZipFile, filename: str):
    member = next(name for name in archive.namelist() if name.endswith(f"/{filename}"))
    with archive.open(member) as binary_file:
        yield from csv.reader(io.TextIOWrapper(binary_file, encoding="utf-8", newline=""))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", help="Optional local ml-32m.zip archive")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("Set DATABASE_URL before importing data.")

    archive = open_archive(args.archive)
    with psycopg.connect(database_url) as database, database.cursor() as cursor:
        cursor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        cursor.execute("DROP TABLE IF EXISTS ratings")
        cursor.execute("DROP TABLE IF EXISTS movies")
        cursor.execute("CREATE TABLE movies (movie_id BIGINT PRIMARY KEY, title TEXT NOT NULL, genres TEXT NOT NULL)")
        cursor.execute("CREATE TABLE ratings (user_id BIGINT NOT NULL, movie_id BIGINT NOT NULL, rating REAL NOT NULL, timestamp BIGINT NOT NULL)")

        movie_rows = rows(archive, "movies.csv")
        next(movie_rows)  # Header
        with cursor.copy("COPY movies (movie_id, title, genres) FROM STDIN") as copy:
            for movie_id, title, genres in movie_rows:
                copy.write_row((movie_id, title, genres))

        rating_rows = rows(archive, "ratings.csv")
        next(rating_rows)  # Header
        with cursor.copy("COPY ratings (user_id, movie_id, rating, timestamp) FROM STDIN") as copy:
            for row in rating_rows:
                copy.write_row(row)

        print("Creating indexes (this can take several minutes)…")
        cursor.execute("CREATE INDEX ratings_seed_idx ON ratings (movie_id, user_id) INCLUDE (rating)")
        cursor.execute("CREATE INDEX ratings_candidate_idx ON ratings (user_id, movie_id) INCLUDE (rating)")
        cursor.execute("CREATE INDEX movies_title_idx ON movies USING GIN (title gin_trgm_ops)")
        database.commit()

    print("MovieLens 32M import complete.")


if __name__ == "__main__":
    main()
