'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK9c5wAAAABJRU5ErkJggg==';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(origin) {
  const deadline = Date.now() + 8000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/gp-hoot/me`);
      if (response.ok) return;
    } catch (err) {
      lastError = err;
    }
    await wait(100);
  }
  throw lastError || new Error('Server did not start.');
}

function ack(socket, event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function waitForState(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('room:state', onState);
      reject(new Error('Timed out waiting for room state.'));
    }, 8000);

    function onState(state) {
      if (!predicate || predicate(state)) {
        clearTimeout(timer);
        socket.off('room:state', onState);
        resolve(state);
      }
    }

    socket.on('room:state', onState);
  });
}

async function request(origin, pathName, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${origin}/api/gp-hoot${pathName}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return { data, response };
}

async function startTestServer(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-hoot-test-'));
  const port = 3900 + Math.floor(Math.random() * 1000);
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      GP_HOOT_DB_PATH: path.join(tmp, 'db.json'),
      GP_HOOT_UPLOAD_ROOT: path.join(tmp, 'uploads'),
      GP_HOOT_SESSION_SECRET: 'test-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  let serverOutput = '';
  child.stdout.on('data', (chunk) => { serverOutput += chunk; });
  child.stderr.on('data', (chunk) => { serverOutput += chunk; });

  await waitForServer(origin);
  return { origin, tmp, serverOutput: () => serverOutput };
}

async function signupHost(origin) {
  const email = `host-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const signup = await request(origin, '/auth/signup', {
    method: 'POST',
    body: { email, password: 'secret123', displayName: 'Host' },
  });
  const cookie = signup.response.headers.get('set-cookie').split(';')[0];
  assert.ok(cookie);
  return cookie;
}

async function createRoom(origin, cookie, questions, roomOptions = {}) {
  const quiz = await request(origin, '/quizzes', {
    cookie,
    method: 'POST',
    body: {
      title: 'Flow quiz',
      description: 'Socket flow test',
      questions,
    },
  });
  const room = await request(origin, `/quizzes/${quiz.data.quiz.id}/rooms`, {
    cookie,
    method: 'POST',
    body: roomOptions,
  });
  return room.data.room.code;
}

test('host and players can complete a GP-hoot room flow', async (t) => {
  const { origin, serverOutput } = await startTestServer(t);
  const cookie = await signupHost(origin);

  const upload = await request(origin, '/uploads', { cookie, method: 'POST', body: { imageData: TINY_PNG } });
  assert.match(upload.data.url, /^\/uploads\/gp-hoot\/.+\.png$/, serverOutput());

  const imageResponse = await fetch(`${origin}${upload.data.url}`);
  assert.equal(imageResponse.status, 200);
  assert.match(imageResponse.headers.get('content-type'), /^image\/png/);

  const qrResponse = await fetch(`${origin}/api/gp-hoot/qr?url=${encodeURIComponent(`${origin}/gp-hoot?room=123456`)}`);
  assert.equal(qrResponse.status, 200);
  assert.match(qrResponse.headers.get('content-type'), /^image\/svg\+xml/);

  const networkResponse = await fetch(`${origin}/api/gp-hoot/network`);
  assert.equal(networkResponse.status, 200);
  const network = await networkResponse.json();
  assert.equal(network.currentOrigin, origin);
  assert.equal(Array.isArray(network.lanOrigins), true);

  const code = await createRoom(origin, cookie, [
    {
      type: 'multiple_choice',
      text: 'Pick the correct answer',
      imageUrl: upload.data.url,
      options: ['Correct', 'Wrong', 'Also wrong'],
      correctIndex: 0,
      timeLimitSeconds: 20,
    },
  ]);

  const host = io(origin, {
    extraHeaders: { Cookie: cookie },
    transports: ['websocket'],
  });
  const p1 = io(origin, { transports: ['websocket'] });
  const p2 = io(origin, { transports: ['websocket'] });
  const p3 = io(origin, { transports: ['websocket'] });

  t.after(() => {
    host.close();
    p1.close();
    p2.close();
    p3.close();
  });

  await Promise.all([
    new Promise((resolve) => host.on('connect', resolve)),
    new Promise((resolve) => p1.on('connect', resolve)),
    new Promise((resolve) => p2.on('connect', resolve)),
    new Promise((resolve) => p3.on('connect', resolve)),
  ]);

  assert.equal((await ack(host, 'host:join', { code })).ok, true);
  assert.equal((await ack(p1, 'player:join', { code, nickname: 'Ada' })).ok, true);
  assert.equal((await ack(p2, 'player:join', { code, nickname: 'Ben' })).ok, true);
  assert.equal((await ack(p3, 'player:join', { code, nickname: 'Cleo' })).ok, true);

  const questionStatePromise = waitForState(host, (state) => state.room.phase === 'question');
  assert.equal((await ack(host, 'host:start')).ok, true);
  await questionStatePromise;

  assert.equal((await ack(p1, 'player:submit_answer', { optionIndex: 0 })).ok, true);
  assert.equal((await ack(p2, 'player:submit_answer', { optionIndex: 1 })).ok, true);
  assert.equal((await ack(p3, 'player:submit_answer', { optionIndex: 0 })).ok, true);

  const results = await waitForState(host, (state) => state.room.phase === 'results');
  assert.equal(results.results.distribution[0].count, 2);
  assert.equal(results.results.distribution[1].count, 1);
  assert.equal(results.leaderboard.at(-1).nickname, 'Ben');
  assert.equal(results.leaderboard.at(-1).score, 0);

  p1.close();
  const p1Return = io(origin, { transports: ['websocket'] });
  t.after(() => p1Return.close());
  await new Promise((resolve) => p1Return.on('connect', resolve));
  const reconnect = await ack(p1Return, 'player:join', { code, nickname: 'Ada' });
  assert.equal(reconnect.ok, true);
  assert.equal(reconnect.state.you.nickname, 'Ada');
  assert.ok(reconnect.state.you.score > 0);

  const finalStatePromise = waitForState(host, (state) => state.room.phase === 'final');
  assert.equal((await ack(host, 'host:next_question')).ok, true);
  const final = await finalStatePromise;
  assert.equal(final.room.status, 'ended');
  assert.equal(final.leaderboard.length, 3);
});

test('removed local upload images are cleaned up when no quiz references them', async (t) => {
  const { origin, tmp } = await startTestServer(t);
  const cookie = await signupHost(origin);
  const upload = await request(origin, '/uploads', { cookie, method: 'POST', body: { imageData: TINY_PNG } });
  const filename = path.basename(upload.data.url);
  const filePath = path.join(tmp, 'uploads', 'gp-hoot', filename);
  assert.equal(fs.existsSync(filePath), true);

  const quiz = await request(origin, '/quizzes', {
    cookie,
    method: 'POST',
    body: {
      title: 'Cleanup quiz',
      description: '',
      questions: [
        {
          type: 'multiple_choice',
          text: 'Image will be removed',
          imageUrl: upload.data.url,
          options: ['A', 'B'],
          correctIndex: 0,
          timeLimitSeconds: 20,
        },
      ],
    },
  });

  await request(origin, `/quizzes/${quiz.data.quiz.id}`, {
    cookie,
    method: 'PUT',
    body: {
      title: 'Cleanup quiz',
      description: '',
      questions: [
        {
          type: 'multiple_choice',
          text: 'Image was removed',
          imageUrl: '',
          options: ['A', 'B'],
          correctIndex: 0,
          timeLimitSeconds: 20,
        },
      ],
    },
  });

  const deadline = Date.now() + 2000;
  while (fs.existsSync(filePath) && Date.now() < deadline) {
    await wait(50);
  }
  assert.equal(fs.existsSync(filePath), false);
});

test('host controls and answer rejection paths work', async (t) => {
  const { origin } = await startTestServer(t);
  const cookie = await signupHost(origin);
  const code = await createRoom(origin, cookie, [
    {
      type: 'multiple_choice',
      text: 'First control question',
      imageUrl: '',
      options: ['Correct', 'Wrong'],
      correctIndex: 0,
      timeLimitSeconds: 20,
    },
    {
      type: 'true_false',
      text: 'Second question can be skipped.',
      imageUrl: '',
      options: ['True', 'False'],
      correctIndex: 0,
      timeLimitSeconds: 20,
    },
  ]);

  const host = io(origin, {
    extraHeaders: { Cookie: cookie },
    transports: ['websocket'],
  });
  const p1 = io(origin, { transports: ['websocket'] });
  const p2 = io(origin, { transports: ['websocket'] });

  t.after(() => {
    host.close();
    p1.close();
    p2.close();
  });

  await Promise.all([
    new Promise((resolve) => host.on('connect', resolve)),
    new Promise((resolve) => p1.on('connect', resolve)),
    new Promise((resolve) => p2.on('connect', resolve)),
  ]);

  assert.equal((await ack(host, 'host:join', { code })).ok, true);
  assert.equal((await ack(p1, 'player:join', { code, nickname: 'Ada' })).ok, true);
  assert.equal((await ack(p2, 'player:join', { code, nickname: 'Ben' })).ok, true);
  const joined = await waitForState(host, (state) => state.players.length === 2);
  const benId = joined.players.find((player) => player.nickname === 'Ben').id;

  const questionStatePromise = waitForState(host, (state) => state.room.phase === 'question');
  assert.equal((await ack(host, 'host:start')).ok, true);
  await questionStatePromise;

  const pausedStatePromise = waitForState(host, (state) => state.room.paused);
  assert.equal((await ack(host, 'host:pause')).ok, true);
  await pausedStatePromise;
  assert.equal((await ack(p1, 'player:submit_answer', { optionIndex: 0 })).ok, false);

  const resumedStatePromise = waitForState(host, (state) => state.room.phase === 'question' && !state.room.paused);
  assert.equal((await ack(host, 'host:resume')).ok, true);
  await resumedStatePromise;

  assert.equal((await ack(p1, 'player:submit_answer', { optionIndex: 0 })).ok, true);
  assert.equal((await ack(p1, 'player:submit_answer', { optionIndex: 0 })).ok, false);
  assert.equal((await ack(p2, 'player:submit_answer', { optionIndex: 99 })).ok, false);

  assert.equal((await ack(host, 'host:kick_player', { playerId: benId })).ok, true);
  const kickedResults = await waitForState(host, (state) => state.room.phase === 'results');
  assert.equal(kickedResults.players.length, 1);
  assert.equal(kickedResults.results.reason, 'all_answered');

  const nextQuestionPromise = waitForState(host, (state) => state.room.phase === 'question' && state.room.currentQuestionIndex === 1);
  assert.equal((await ack(host, 'host:next_question')).ok, true);
  await nextQuestionPromise;

  const skippedPromise = waitForState(host, (state) => state.room.phase === 'results' && state.results.reason === 'skipped');
  assert.equal((await ack(host, 'host:skip_question')).ok, true);
  await skippedPromise;

  const finalStatePromise = waitForState(host, (state) => state.room.phase === 'final');
  assert.equal((await ack(host, 'host:next_question')).ok, true);
  const final = await finalStatePromise;
  assert.equal(final.leaderboard.length, 1);
  assert.equal(final.leaderboard[0].nickname, 'Ada');
});

test('auto-advance moves through results without host next clicks', async (t) => {
  const { origin } = await startTestServer(t);
  const cookie = await signupHost(origin);
  const code = await createRoom(origin, cookie, [
    {
      type: 'multiple_choice',
      text: 'First auto question',
      imageUrl: '',
      options: ['Correct', 'Wrong'],
      correctIndex: 0,
      timeLimitSeconds: 20,
    },
    {
      type: 'multiple_choice',
      text: 'Second auto question',
      imageUrl: '',
      options: ['Correct', 'Wrong'],
      correctIndex: 0,
      timeLimitSeconds: 20,
    },
  ], { autoAdvanceResults: true });

  const host = io(origin, {
    extraHeaders: { Cookie: cookie },
    transports: ['websocket'],
  });
  const player = io(origin, { transports: ['websocket'] });

  t.after(() => {
    host.close();
    player.close();
  });

  await Promise.all([
    new Promise((resolve) => host.on('connect', resolve)),
    new Promise((resolve) => player.on('connect', resolve)),
  ]);

  assert.equal((await ack(host, 'host:join', { code })).ok, true);
  assert.equal((await ack(player, 'player:join', { code, nickname: 'Auto' })).ok, true);

  const firstQuestion = waitForState(host, (state) => state.room.phase === 'question' && state.room.currentQuestionIndex === 0);
  assert.equal((await ack(host, 'host:start')).ok, true);
  await firstQuestion;
  assert.equal((await ack(player, 'player:submit_answer', { optionIndex: 0 })).ok, true);

  const firstResults = await waitForState(host, (state) => state.room.phase === 'results' && state.room.currentQuestionIndex === 0);
  assert.equal(firstResults.room.autoAdvanceResults, true);
  assert.ok(firstResults.room.nextAutoAdvanceAt);

  const secondQuestion = await waitForState(host, (state) => state.room.phase === 'question' && state.room.currentQuestionIndex === 1);
  assert.equal(secondQuestion.room.nextAutoAdvanceAt, null);
  assert.equal((await ack(player, 'player:submit_answer', { optionIndex: 0 })).ok, true);

  await waitForState(host, (state) => state.room.phase === 'results' && state.room.currentQuestionIndex === 1);
  const final = await waitForState(host, (state) => state.room.phase === 'final');
  assert.equal(final.room.status, 'ended');
  assert.equal(final.leaderboard[0].nickname, 'Auto');
});
