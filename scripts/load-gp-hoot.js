#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { io } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    rooms: 1,
    players: 50,
    questions: 1,
    jitterMs: 250,
    connectBatch: 100,
    latencyBudgetMs: 300,
    strict: false,
    keepServer: false,
    port: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split('=');
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const value = inlineValue ?? argv[i + 1];
    if (inlineValue == null && value && !String(value).startsWith('--')) i += 1;

    if (key === 'strict' || key === 'keepServer') {
      args[key] = inlineValue == null ? true : value !== 'false';
    } else if (Object.hasOwn(args, key)) {
      args[key] = Number(value);
    }
  }

  return args;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function waitForServer(origin) {
  const deadline = Date.now() + 10_000;
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

async function request(origin, pathName, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${origin}/api/gp-hoot${pathName}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status} for ${pathName}`);
  return { data, response };
}

function ack(socket, event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function socketConnect(origin, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = io(origin, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 10_000,
      ...options,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Socket connect timeout.'));
    }, 10_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

function waitForState(socket, predicate, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('room:state', onState);
      reject(new Error('Timed out waiting for room state.'));
    }, timeoutMs);

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

async function mapBatched(items, batchSize, mapper) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    results.push(...await Promise.all(batch.map(mapper)));
  }
  return results;
}

function createQuestion(index) {
  return {
    type: 'multiple_choice',
    text: `Load question ${index + 1}`,
    imageUrl: '',
    options: ['Correct', 'Wrong A', 'Wrong B', 'Wrong C'],
    correctIndex: 0,
    timeLimitSeconds: 20,
  };
}

async function setupServer(args) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-hoot-load-'));
  const port = args.port || (4400 + Math.floor(Math.random() * 1000));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      GP_HOOT_DB_PATH: path.join(tmp, 'db.json'),
      GP_HOOT_UPLOAD_ROOT: path.join(tmp, 'uploads'),
      GP_HOOT_SESSION_SECRET: 'load-test-secret',
      GP_HOOT_DISABLE_RATE_LIMIT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  await waitForServer(origin);
  return { origin, child, tmp, output: () => output };
}

async function signupHost(origin) {
  const email = `load-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const signup = await request(origin, '/auth/signup', {
    method: 'POST',
    body: { email, password: 'secret123', displayName: 'Load Host' },
  });
  return signup.response.headers.get('set-cookie').split(';')[0];
}

async function createQuizAndRooms(origin, cookie, args) {
  const quiz = await request(origin, '/quizzes', {
    cookie,
    method: 'POST',
    body: {
      title: `Load quiz ${Date.now()}`,
      description: `${args.rooms} rooms x ${args.players} players`,
      questions: Array.from({ length: args.questions }, (_, index) => createQuestion(index)),
    },
  });

  return Promise.all(Array.from({ length: args.rooms }, async (_, roomIndex) => {
    const room = await request(origin, `/quizzes/${quiz.data.quiz.id}/rooms`, {
      cookie,
      method: 'POST',
      body: { autoAdvanceResults: false },
    });
    return { index: roomIndex, code: room.data.room.code, host: null, players: [] };
  }));
}

async function connectRoom(origin, cookie, room, playersPerRoom, connectBatch) {
  room.host = await socketConnect(origin, { extraHeaders: { Cookie: cookie } });
  const hostJoin = await ack(room.host, 'host:join', { code: room.code });
  if (!hostJoin?.ok) throw new Error(`Host join failed for room ${room.code}: ${hostJoin?.error}`);

  const playerIndexes = Array.from({ length: playersPerRoom }, (_, index) => index);
  room.players = await mapBatched(playerIndexes, connectBatch, async (playerIndex) => {
    const socket = await socketConnect(origin);
    const nickname = `R${String(room.index + 1).padStart(2, '0')}P${String(playerIndex + 1).padStart(3, '0')}`;
    const join = await ack(socket, 'player:join', { code: room.code, nickname });
    if (!join?.ok) {
      socket.close();
      throw new Error(`Player join failed for ${nickname}: ${join?.error}`);
    }
    return { index: playerIndex, socket, nickname };
  });

  return room;
}

async function runQuestion(room, questionIndex, args, metrics) {
  const questionSeen = waitForState(room.host, (state) => (
    state.room.phase === 'question' && state.room.currentQuestionIndex === questionIndex
  ));
  const start = await ack(room.host, questionIndex === 0 ? 'host:start' : 'host:next_question');
  if (!start?.ok) throw new Error(`Could not start question ${questionIndex + 1} in room ${room.code}: ${start?.error}`);
  await questionSeen;

  const resultSeen = waitForState(room.host, (state) => (
    state.room.phase === 'results' && state.room.currentQuestionIndex === questionIndex
  ), 30_000);
  const roundStart = performance.now();

  await Promise.all(room.players.map(async (player) => {
    if (args.jitterMs > 0) await wait(Math.floor(Math.random() * args.jitterMs));
    const sentAt = performance.now();
    const answer = await ack(player.socket, 'player:submit_answer', { optionIndex: 0 });
    const latency = performance.now() - sentAt;
    metrics.answerLatencies.push(latency);
    if (!answer?.ok) metrics.answerErrors.push(answer?.error || 'unknown answer error');
  }));

  await resultSeen;
  metrics.roundDurations.push(performance.now() - roundStart);
}

function closeRooms(rooms) {
  rooms.forEach((room) => {
    if (room.host) room.host.close();
    room.players.forEach((player) => player.socket.close());
  });
}

async function readServerRssMb(pid) {
  try {
    const { execFile } = require('node:child_process');
    const output = await new Promise((resolve, reject) => {
      execFile('ps', ['-o', 'rss=', '-p', String(pid)], (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    return Math.round((Number(output) || 0) / 1024);
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const totalPlayers = args.rooms * args.players;
  const metrics = {
    answerLatencies: [],
    answerErrors: [],
    roundDurations: [],
  };
  const startedAt = performance.now();
  let server = null;
  let rooms = [];

  console.log(`[load] starting isolated server for ${args.rooms} room(s), ${args.players} player(s)/room, ${args.questions} question(s)`);

  try {
    server = await setupServer(args);
    const cookie = await signupHost(server.origin);
    rooms = await createQuizAndRooms(server.origin, cookie, args);

    const connectStarted = performance.now();
    await mapBatched(rooms, 1, (room) => connectRoom(server.origin, cookie, room, args.players, args.connectBatch));
    const connectMs = performance.now() - connectStarted;
    console.log(`[load] connected ${rooms.length} host socket(s) and ${totalPlayers} player socket(s) in ${Math.round(connectMs)}ms`);

    for (let questionIndex = 0; questionIndex < args.questions; questionIndex += 1) {
      await Promise.all(rooms.map((room) => runQuestion(room, questionIndex, args, metrics)));
      console.log(`[load] completed question ${questionIndex + 1}/${args.questions}`);
    }

    const rssMb = await readServerRssMb(server.child.pid);
    const summary = {
      rooms: args.rooms,
      playersPerRoom: args.players,
      totalPlayers,
      questions: args.questions,
      answerCount: metrics.answerLatencies.length,
      answerErrors: metrics.answerErrors.length,
      connectMs: Math.round(connectMs),
      totalMs: Math.round(performance.now() - startedAt),
      answerLatencyMs: {
        min: Math.round(Math.min(...metrics.answerLatencies)),
        avg: Math.round(average(metrics.answerLatencies)),
        p50: Math.round(percentile(metrics.answerLatencies, 50)),
        p95: Math.round(percentile(metrics.answerLatencies, 95)),
        p99: Math.round(percentile(metrics.answerLatencies, 99)),
        max: Math.round(Math.max(...metrics.answerLatencies)),
        budget: args.latencyBudgetMs,
        withinBudget: percentile(metrics.answerLatencies, 95) <= args.latencyBudgetMs,
      },
      roundDurationMs: {
        avg: Math.round(average(metrics.roundDurations)),
        max: Math.round(Math.max(...metrics.roundDurations)),
      },
      serverRssMb: rssMb,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (metrics.answerErrors.length) {
      console.error(`[load] answer errors: ${metrics.answerErrors.slice(0, 10).join('; ')}`);
      process.exitCode = 1;
    } else if (args.strict && !summary.answerLatencyMs.withinBudget) {
      console.error(`[load] p95 ${summary.answerLatencyMs.p95}ms exceeded ${args.latencyBudgetMs}ms budget`);
      process.exitCode = 1;
    }
  } finally {
    closeRooms(rooms);
    if (server && !args.keepServer) {
      server.child.kill('SIGTERM');
      fs.rmSync(server.tmp, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
