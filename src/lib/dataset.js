/** Parse the official MovieLens 1M files into read-optimised indexes. */
export function parseMovieLens(ratingsText, moviesText, likeThreshold) {
  const movies = new Map();
  const users = new Map();
  const byMovie = new Map();

  for (const line of moviesText.trim().split('\n')) {
    const [id, title, genreText] = line.split('::');
    movies.set(Number(id), {
      id: Number(id),
      title,
      genres: genreText.split('|'),
    });
  }

  for (const line of ratingsText.trim().split('\n')) {
    const [userId, movieId, rating, timestamp] = line.split('::').map(Number);
    const entry = { userId, movieId, rating, timestamp, liked: rating >= likeThreshold };

    if (!users.has(userId)) users.set(userId, []);
    if (!byMovie.has(movieId)) byMovie.set(movieId, []);
    users.get(userId).push(entry);
    byMovie.get(movieId).push(entry);
  }

  return { movies, users, byMovie };
}
