'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateQuestionPoints, rankPlayers } = require('../server/scoring');

test('GP-hoot scoring awards base plus speed bonus', () => {
  assert.equal(calculateQuestionPoints({ correct: true, timeRemainingMs: 20000, timeLimitSeconds: 20 }), 2000);
  assert.equal(calculateQuestionPoints({ correct: true, timeRemainingMs: 10000, timeLimitSeconds: 20 }), 1500);
  assert.equal(calculateQuestionPoints({ correct: true, timeRemainingMs: 0, timeLimitSeconds: 20 }), 1000);
});

test('GP-hoot scoring rejects incorrect and clamps out-of-range remaining time', () => {
  assert.equal(calculateQuestionPoints({ correct: false, timeRemainingMs: 20000, timeLimitSeconds: 20 }), 0);
  assert.equal(calculateQuestionPoints({ correct: true, timeRemainingMs: 999999, timeLimitSeconds: 20 }), 2000);
  assert.equal(calculateQuestionPoints({ correct: true, timeRemainingMs: -100, timeLimitSeconds: 20 }), 1000);
});

test('leaderboard ties are broken by lower total response time', () => {
  const ranked = rankPlayers([
    { nickname: 'Mina', score: 2400, totalResponseMs: 6000 },
    { nickname: 'Kojo', score: 2400, totalResponseMs: 3500 },
    { nickname: 'Ama', score: 1200, totalResponseMs: 2500 },
  ]);

  assert.deepEqual(ranked.map((p) => p.nickname), ['Kojo', 'Mina', 'Ama']);
});
