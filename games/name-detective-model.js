(function (root) {
  'use strict';
  const practice = [
    { word: 'Mia', answer: 'proper', clue: 'Mia is one person’s name.', explanation: 'Mia names one particular person. It is a proper noun and starts with a capital M.' },
    { word: 'dog', answer: 'common', clue: 'Many animals can be a dog.', explanation: 'dog is a general name for an animal. It is a common noun, not one dog’s special name.' },
    { word: 'London', answer: 'proper', clue: 'London is one city’s name.', explanation: 'London names one particular city. It is a proper noun and starts with a capital L.' },
    { word: 'park', answer: 'common', clue: 'There are many parks.', explanation: 'park is a general name for a place. It is a common noun.' }
  ];
  const checks = [
    { word: 'Aisha', answer: 'proper', explanation: 'Aisha is one person’s name: a proper noun with a capital A.' },
    { word: 'shop', answer: 'common', explanation: 'shop is a general name for a place: a common noun.' },
    { word: 'tuesday', answer: 'Tuesday', type: 'capital', explanation: 'Tuesday is a particular day’s name. It is a proper noun, so it starts with a capital T.' }
  ];
  function createSession(mode) { return { mode, phase: 'demo', index: 0, records: [], hinted: false, assisted: mode === 'guided', locked: false }; }
  function begin(s) { if (s.phase === 'demo') s.phase = 'practice'; }
  function current(s) { return (s.phase === 'check' ? checks : practice)[s.index]; }
  function hint(s) { if (s.phase === 'practice' && !s.locked) s.hinted = true; }
  function assist(s) { if (!s.locked && ['practice','check'].includes(s.phase)) s.assisted = true; }
  function answer(s, choice) {
    if (!['practice','check'].includes(s.phase) || s.locked) return null;
    const q = current(s);
    const choices = q.type === 'capital' ? ['Tuesday','tuesday'] : ['common','proper'];
    if (!choices.includes(choice)) return null;
    const record = { phase: s.phase, word: q.word, choice, correct: choice === q.answer, hinted: s.hinted, assisted: s.assisted, skipped: false };
    s.records.push(record); s.locked = true; return record;
  }
  function skip(s) {
    if (!['practice','check'].includes(s.phase) || s.locked) return;
    s.records.push({ phase: s.phase, word: current(s).word, choice: null, correct: false, hinted: s.hinted, assisted: true, skipped: true }); s.locked = true;
  }
  function next(s) {
    if (!s.locked) return;
    s.index++; s.locked = false; s.hinted = false; s.assisted = s.mode === 'guided';
    if (s.phase === 'practice' && s.index === practice.length) { s.phase = 'check'; s.index = 0; }
    else if (s.phase === 'check' && s.index === checks.length) s.phase = 'summary';
  }
  function summary(s) {
    const p = s.records.filter(r => r.phase === 'practice');
    const c = s.records.filter(r => r.phase === 'check');
    const count = rows => ({ correct: rows.filter(r => r.correct).length, total: rows.length });
    return { practice: { first: count(p.filter(r => !r.hinted && !r.assisted)), hinted: count(p.filter(r => r.hinted && !r.assisted)), assisted: count(p.filter(r => r.assisted)) }, check: { independent: count(c.filter(r => !r.assisted)), assisted: c.filter(r => r.assisted).length, skipped: c.filter(r => r.skipped).length }, records: s.records.slice() };
  }
  const api = { practice, checks, createSession, begin, current, hint, assist, answer, skip, next, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NameDetective = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
