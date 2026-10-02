import assert from 'node:assert/strict';
import test from 'node:test';
import { getRecommendations, LIKE_THRESHOLD, wilsonInterval } from '../src/lib/probability.js';

test('Wilson interval contains the observed proportion', () => {
  const [lower, upper] = wilsonInterval(70, 100);
  assert.ok(lower < 0.7);
  assert.ok(upper > 0.7);
  assert.ok(upper - lower < 0.2);
});

test('recommendations pool conditional evidence and exclude selected movies', () => {
  const movies = new Map([[1, { id: 1, title: 'Seed' }], [2, { id: 2, title: 'Candidate' }]]);
  const users = new Map();
  const byMovie = new Map([[1, []]]);

  for (let userId = 1; userId <= 12; userId += 1) {
    const seed = { userId, movieId: 1, rating: 5, liked: true };
    const candidate = { userId, movieId: 2, rating: 5, liked: true };
    users.set(userId, [seed, candidate]);
    byMovie.get(1).push(seed);
  }

  const recommendations = getRecommendations({ movies, users, byMovie }, [{ id: 1, rating: LIKE_THRESHOLD }]);
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].id, 2);
  assert.equal(recommendations[0].probability, 1);
  assert.equal(recommendations[0].observations, 12);
});
