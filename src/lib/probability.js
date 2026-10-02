export const LIKE_THRESHOLD = 4;
export const MINIMUM_EVIDENCE = 12;
export const RECOMMENDATION_LIMIT = 12;

export const formatPercentage = value => `${Math.round(value * 100)}%`;

/** Returns a two-sided 95% Wilson confidence interval for a proportion. */
export function wilsonInterval(successes, observations) {
  if (!observations) return [0, 1];

  const z = 1.96;
  const proportion = successes / observations;
  const zSquared = z ** 2;
  const denominator = 1 + zSquared / observations;
  const center = (proportion + zSquared / (2 * observations)) / denominator;
  const radius = (z * Math.sqrt(
    (proportion * (1 - proportion) + zSquared / (4 * observations)) / observations,
  )) / denominator;

  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

function collectEvidence(data, selections, excludedUserId = null) {
  const likedMovieIds = selections
    .filter(({ rating }) => rating >= LIKE_THRESHOLD)
    .map(({ id }) => id);
  const selectedMovieIds = new Set(selections.map(({ id }) => id));
  const evidence = new Map();

  for (const seedMovieId of likedMovieIds) {
    for (const seedRating of data.byMovie.get(seedMovieId) ?? []) {
      if (!seedRating.liked || seedRating.userId === excludedUserId) continue;

      // A user can contribute once per liked seed. That preserves the app's
      // deliberately simple pooled-conditional-probability interpretation.
      for (const candidateRating of data.users.get(seedRating.userId) ?? []) {
        if (selectedMovieIds.has(candidateRating.movieId)) continue;

        const current = evidence.get(candidateRating.movieId) ?? { successes: 0, observations: 0 };
        current.observations += 1;
        if (candidateRating.liked) current.successes += 1;
        evidence.set(candidateRating.movieId, current);
      }
    }
  }

  return evidence;
}

export function scoreMovies(data, selections, options = {}) {
  const { excludedUserId = null, candidateMovieIds = null } = options;
  const evidence = collectEvidence(data, selections, excludedUserId);
  const candidates = candidateMovieIds ?? evidence.keys();
  const scores = [];

  for (const movieId of candidates) {
    const count = evidence.get(movieId);
    const movie = data.movies.get(movieId);
    if (!movie || !count || count.observations < MINIMUM_EVIDENCE) continue;

    const probability = count.successes / count.observations;
    const [lowerBound, upperBound] = wilsonInterval(count.successes, count.observations);
    scores.push({
      ...movie,
      successes: count.successes,
      observations: count.observations,
      probability,
      lowerBound,
      upperBound,
    });
  }

  return scores;
}

export function getRecommendations(data, selections, options = {}) {
  const { limit = RECOMMENDATION_LIMIT, ...scoringOptions } = options;
  return scoreMovies(data, selections, scoringOptions)
    .sort((a, b) => b.probability - a.probability || b.observations - a.observations)
    .slice(0, limit);
}

export function evaluatePredictions(data) {
  const tests = [];
  const eligibleUsers = [...data.users.entries()]
    .filter(([, ratings]) => ratings.length >= 35)
    .slice(0, 45);

  for (const [userId, ratings] of eligibleUsers) {
    const orderedRatings = [...ratings].sort((a, b) => a.timestamp - b.timestamp);
    const heldOutRatings = orderedRatings.slice(-2);
    const observedSelections = orderedRatings
      .slice(0, -2)
      .filter(({ liked }) => liked)
      .slice(-8)
      .map(({ movieId, rating }) => ({ id: movieId, rating }));

    if (observedSelections.length < 2) continue;

    const predictions = scoreMovies(data, observedSelections, {
      excludedUserId: userId,
      candidateMovieIds: heldOutRatings.map(({ movieId }) => movieId),
    });
    const predictionsByMovie = new Map(predictions.map(prediction => [prediction.id, prediction]));

    for (const actual of heldOutRatings) {
      const prediction = predictionsByMovie.get(actual.movieId);
      if (prediction) tests.push({ probability: prediction.probability, actual: actual.liked });
    }
  }

  const accuracy = tests.length
    ? tests.filter(test => (test.probability >= 0.5) === test.actual).length / tests.length
    : 0;
  const brier = tests.length
    ? tests.reduce((total, test) => total + (test.probability - Number(test.actual)) ** 2, 0) / tests.length
    : 0;
  const bins = [[0, 0.4], [0.4, 0.55], [0.55, 0.7], [0.7, 1.01]].map(([start, end]) => {
    const values = tests.filter(test => test.probability >= start && test.probability < end);
    return {
      label: `${formatPercentage(start)}–${formatPercentage(Math.min(end, 1))}`,
      count: values.length,
      predicted: values.length ? values.reduce((sum, test) => sum + test.probability, 0) / values.length : 0,
      observed: values.length ? values.filter(test => test.actual).length / values.length : 0,
    };
  });

  return { tests, accuracy, brier, bins };
}
