const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../games/name-detective-model.js');
function model() { assert.ok(fs.existsSync(file), 'Name Detective model exists'); return require(file); }

test('Game Hub registry exposes Name Detective for early elementary', () => {
  const vm = require('node:vm');
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/hub.js'), 'utf8'), context);
  const game = context.window.Hub.GAMES.find(g => g.id === 'name-detective');
  assert.ok(game, 'Name Detective appears in registry');
  assert.equal(game.path, 'games/name-detective.html');
  assert.ok(game.ageGroups.includes('early-elem'));
});

test('tablet shell provides anonymous demo, explicit modes, replay and accessible controls', () => {
  const htmlPath = path.join(__dirname, '../games/name-detective.html');
  assert.ok(fs.existsSync(htmlPath), 'tablet game page exists');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /id="app"/);
  assert.match(html, /name-detective-ui.js/);
  assert.match(html, /name-detective-model.js/);
  assert.doesNotMatch(html, /hub.js|fetch\(|localStorage|googleapis|user-scalable=no/);
});

test('demonstration precedes four bounded practice rounds with balanced noun examples', () => {
  const m = model();
  const s = m.createSession('independent');
  assert.equal(s.phase, 'demo');
  assert.equal(s.mode, 'independent');
  assert.equal(m.practice.length, 4);
  assert.deepEqual(m.practice.map(q => q.answer).sort(), ['common', 'common', 'proper', 'proper']);
  m.begin(s);
  assert.equal(s.phase, 'practice');
  assert.equal(m.current(s).word, 'Mia');
  assert.match(m.practice[0].explanation, /capital/);
});

test('practice records first response, hint and explicit assistance without retry inflation', () => {
  const m = model(); const s = m.createSession('independent'); m.begin(s);
  assert.equal(m.answer(s, 'common').correct, false);
  assert.equal(m.answer(s, 'proper'), null, 'answered round is locked');
  m.next(s); m.hint(s);
  assert.equal(m.answer(s, 'common').correct, true);
  m.next(s); m.assist(s); m.answer(s, 'proper');
  m.next(s); m.answer(s, 'common'); m.next(s);
  assert.equal(s.phase, 'check');
  assert.deepEqual(s.records.map(r => [r.correct, r.hinted, r.assisted]), [[false,false,false],[true,true,false],[true,false,true],[true,false,false]]);
  const guided = m.createSession('guided'); m.begin(guided); m.answer(guided, 'proper');
  assert.equal(guided.records[0].assisted, true);
});

test('fresh exit check has no hints, delayed feedback, safe help/skip and honest summary', () => {
  const m = model(); const s = m.createSession('independent'); m.begin(s);
  for (const choice of ['proper','common','proper','common']) { m.answer(s, choice); m.next(s); }
  assert.equal(m.checks.length, 3);
  assert.ok(m.checks.every(q => !m.practice.some(p => p.word === q.word)));
  assert.equal(m.current(s).word, 'Aisha');
  m.hint(s); assert.equal(s.hinted, false);
  m.answer(s, 'proper'); m.next(s);
  m.assist(s); m.answer(s, 'common'); m.next(s);
  m.skip(s); m.next(s);
  assert.equal(s.phase, 'summary');
  const report = m.summary(s);
  assert.deepEqual(report.practice.first, { correct: 4, total: 4 });
  assert.deepEqual(report.check.independent, { correct: 1, total: 1 });
  assert.equal(report.check.assisted, 2);
  assert.equal(report.check.skipped, 1);
  assert.equal(report.records.length, 7);
  assert.equal(m.answer(s, 'proper'), null);
});

test('hinted and assisted practice buckets stay separate and unfinished rounds cannot advance', () => {
  const m = model(); const s = m.createSession('independent'); m.begin(s); m.next(s);
  assert.equal(s.index, 0); assert.equal(m.answer(s, 'invalid'), null);
  m.hint(s); m.assist(s); m.answer(s, 'proper'); m.next(s);
  m.hint(s); m.answer(s, 'common'); m.next(s);
  m.answer(s, 'common'); m.next(s); m.answer(s, 'common'); m.next(s);
  assert.deepEqual(m.summary(s).practice, { first: {correct:1,total:2}, hinted:{correct:1,total:1}, assisted:{correct:1,total:1} });
});
