'use strict';

const BASE_POINTS = 1000;

function calculateQuestionPoints({ correct, timeRemainingMs, timeLimitSeconds }) {
  if (!correct) return 0;
  const limitMs = Math.max(1, Number(timeLimitSeconds || 0) * 1000);
  const remaining = Math.min(Math.max(0, Number(timeRemainingMs || 0)), limitMs);
  return BASE_POINTS + Math.round(BASE_POINTS * (remaining / limitMs));
}

function rankPlayers(players) {
  return [...players].sort((a, b) => {
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    if ((a.totalResponseMs || 0) !== (b.totalResponseMs || 0)) return (a.totalResponseMs || 0) - (b.totalResponseMs || 0);
    return String(a.nickname || '').localeCompare(String(b.nickname || ''));
  });
}

module.exports = {
  BASE_POINTS,
  calculateQuestionPoints,
  rankPlayers,
};
