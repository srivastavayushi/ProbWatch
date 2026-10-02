const GENRES = [
  'Unknown', 'Action', 'Adventure', 'Animation', 'Children', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Fantasy', 'Film-Noir', 'Horror', 'Musical', 'Mystery',
  'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western',
];

/** Parse the two original MovieLens 100K files into read-optimised indexes. */
export function parseMovieLens(ratingsText, moviesText, likeThreshold) {
  const movies = new Map();
  const users = new Map();
  const byMovie = new Map();

  for (const line of moviesText.trim().split('\n')) {
    const [id, title, , , , ...genreFlags] = line.split('|');
    movies.set(Number(id), {
      id: Number(id),
      title,
      genres: genreFlags.flatMap((flag, index) => (flag === '1' ? [GENRES[index]] : [])),
    });
  }

  for (const line of ratingsText.trim().split('\n')) {
    const [userId, movieId, rating, timestamp] = line.split('\t').map(Number);
    const entry = { userId, movieId, rating, timestamp, liked: rating >= likeThreshold };

    if (!users.has(userId)) users.set(userId, []);
    if (!byMovie.has(movieId)) byMovie.set(movieId, []);
    users.get(userId).push(entry);
    byMovie.get(movieId).push(entry);
  }

  return { movies, users, byMovie };
}
