'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { calculateQuestionPoints, rankPlayers } = require('./scoring');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = process.env.GP_HOOT_DB_PATH
  ? path.resolve(process.env.GP_HOOT_DB_PATH)
  : path.join(ROOT, 'data', 'gp-hoot-db.json');
const UPLOAD_ROOT = process.env.GP_HOOT_UPLOAD_ROOT
  ? path.resolve(process.env.GP_HOOT_UPLOAD_ROOT)
  : path.join(ROOT, 'uploads');
const GP_HOOT_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'gp-hoot');
const SESSION_COOKIE = 'gp_hoot_session';
const SESSION_SECRET = process.env.GP_HOOT_SESSION_SECRET || 'gp-hoot-local-dev-secret';
const PORT = Number(process.env.PORT || 3000);
const RATE_LIMIT_DISABLED = process.env.GP_HOOT_DISABLE_RATE_LIMIT === '1';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(GP_HOOT_UPLOAD_DIR, { recursive: true });

const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function defaultDb() {
  return { version: 1, users: [], quizzes: [], rooms: [] };
}

function loadDb() {
  try {
    if (!fs.existsSync(DB_PATH)) return defaultDb();
    return { ...defaultDb(), ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  } catch (err) {
    console.warn('[GP-hoot] Failed to read data file. Starting with empty data.', err);
    return defaultDb();
  }
}

let db = loadDb();
const activeRooms = new Map();
const runtime = new Map();
const rateBuckets = new Map();

function persist() {
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2));
  fs.renameSync(tmpPath, DB_PATH);
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicUser(user) {
  return user ? { id: user.id, email: user.email, displayName: user.displayName } : null;
}

function parseCookies(header) {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx !== -1) acc[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
      return acc;
    }, {});
}

function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function timingSafeStringEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifySession(token) {
  if (!token || !String(token).includes('.')) return null;
  const [payload, sig] = String(token).split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (!timingSafeStringEqual(sig, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return db.users.find((u) => u.id === parsed.userId) || null;
  } catch {
    return null;
  }
}

function userFromCookieHeader(header) {
  return verifySession(parseCookies(header)[SESSION_COOKIE]);
}

function setSessionCookie(res, userId) {
  const token = signSession(userId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 14,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return timingSafeStringEqual(actual, expected);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function text(value, max, fallback = '') {
  const trimmed = String(value || '').trim();
  return (trimmed || fallback).slice(0, max);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function validateImageUrl(value) {
  const imageUrl = String(value || '').trim();
  if (!imageUrl) return '';
  const isDataImage = /^data:image\/(png|jpe?g|webp);base64,/i.test(imageUrl);
  const isRemoteImage = /^https?:\/\/.+/i.test(imageUrl);
  const isLocalUpload = /^\/uploads\/gp-hoot\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp)$/i.test(imageUrl);
  if (!isDataImage && !isRemoteImage && !isLocalUpload) return '';
  return imageUrl.slice(0, 7_000_000);
}

function localUploadPathFromUrl(url) {
  const match = String(url || '').match(/^\/uploads\/gp-hoot\/([a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp))$/i);
  if (!match) return null;
  const filePath = path.join(GP_HOOT_UPLOAD_DIR, match[1]);
  return filePath.startsWith(GP_HOOT_UPLOAD_DIR) ? filePath : null;
}

function questionUploadUrls(questions) {
  return new Set((questions || [])
    .map((question) => question.imageUrl)
    .filter((url) => localUploadPathFromUrl(url)));
}

function localUploadStillReferenced(url, ignoredQuizIds = new Set()) {
  return db.quizzes.some((quiz) => {
    if (ignoredQuizIds.has(quiz.id)) return false;
    return [...questionUploadUrls(quiz.questions)].includes(url);
  }) || [...activeRooms.values()].some((room) => (
    [...questionUploadUrls(room.quizSnapshot.questions)].includes(url)
  ));
}

function cleanupUnreferencedUploads(urls, ignoredQuizIds = new Set()) {
  urls.forEach((url) => {
    const filePath = localUploadPathFromUrl(url);
    if (!filePath || localUploadStillReferenced(url, ignoredQuizIds)) return;
    fs.rm(filePath, { force: true }, () => {});
  });
}

function getRequestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function takeRateLimitToken(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

function rateLimit({ name, limit, windowMs, key }) {
  return (req, res, next) => {
    if (RATE_LIMIT_DISABLED) {
      next();
      return;
    }
    const rateKey = `${name}:${key ? key(req) : getRequestIp(req)}`;
    if (!takeRateLimitToken(rateKey, limit, windowMs)) {
      res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
      return;
    }
    next();
  };
}

function socketRateLimited(socket, name, limit, windowMs) {
  if (RATE_LIMIT_DISABLED) return false;
  const key = `${name}:${socket.handshake.address || 'unknown'}`;
  return !takeRateLimitToken(key, limit, windowMs);
}

function localNetworkUrls(port) {
  const urls = [];
  Object.values(os.networkInterfaces()).flat().forEach((iface) => {
    if (!iface || iface.internal || iface.family !== 'IPv4') return;
    urls.push(`http://${iface.address}:${port}`);
  });
  return [...new Set(urls)];
}

function imageMimeFromBuffer(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return '';
}

function decodeDataImage(imageData) {
  const match = String(imageData || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) throw new Error('Use a JPG, PNG, or WebP image.');
  const declaredMime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('Image must be 5MB or smaller.');
  const actualMime = imageMimeFromBuffer(buffer);
  if (actualMime !== declaredMime) throw new Error('Image file type does not match its contents.');
  return { buffer, mime: actualMime, ext: IMAGE_TYPES[actualMime] };
}

function normalizeQuestion(input, position) {
  const type = input?.type === 'true_false' ? 'true_false' : 'multiple_choice';
  const options = type === 'true_false'
    ? ['True', 'False']
    : (Array.isArray(input?.options) ? input.options : [])
      .map((option) => text(option, 90))
      .filter(Boolean)
      .slice(0, 4);

  if (options.length < 2) {
    throw new Error('Each question needs at least two answer options.');
  }

  const correctIndex = clampInt(input?.correctIndex, 0, options.length - 1, 0);

  return {
    id: input?.id || id('question'),
    position,
    type,
    text: text(input?.text, 280, `Question ${position + 1}`),
    imageUrl: validateImageUrl(input?.imageUrl),
    options,
    correctIndex,
    timeLimitSeconds: clampInt(input?.timeLimitSeconds, 5, 120, 20),
  };
}

function normalizeQuizPayload(body, existing) {
  const questions = Array.isArray(body?.questions)
    ? body.questions.map((q, index) => normalizeQuestion(q, index))
    : (existing?.questions || []);

  return {
    title: text(body?.title, 120, existing?.title || 'Untitled quiz'),
    description: text(body?.description, 500, existing?.description || ''),
    questions,
  };
}

function requireUser(req, res, next) {
  const user = userFromCookieHeader(req.headers.cookie);
  if (!user) {
    res.status(401).json({ error: 'Login required.' });
    return;
  }
  req.user = user;
  next();
}

function quizForUser(userId, quizId) {
  return db.quizzes.find((quiz) => quiz.id === quizId && quiz.ownerUserId === userId) || null;
}

function generateRoomCode() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    if (!activeRooms.has(code) && !db.rooms.some((room) => room.code === code && room.status !== 'ended')) return code;
  }
  throw new Error('Could not allocate a room code.');
}

function roomRuntime(room) {
  if (!runtime.has(room.id)) {
    runtime.set(room.id, {
      questionTimer: null,
      autoAdvanceTimer: null,
      stateEmitTimer: null,
      hostEndTimer: null,
      hostSockets: new Set(),
    });
  }
  return runtime.get(room.id);
}

function clearQuestionTimer(room) {
  const rt = roomRuntime(room);
  if (rt.questionTimer) clearTimeout(rt.questionTimer);
  rt.questionTimer = null;
}

function clearAutoAdvanceTimer(room) {
  const rt = roomRuntime(room);
  if (rt.autoAdvanceTimer) clearTimeout(rt.autoAdvanceTimer);
  rt.autoAdvanceTimer = null;
  room.nextAutoAdvanceAt = null;
}

function clearScheduledRoomStateEmit(room) {
  const rt = roomRuntime(room);
  if (rt.stateEmitTimer) clearTimeout(rt.stateEmitTimer);
  rt.stateEmitTimer = null;
}

function scheduleRoomStateEmit(room, delayMs = 75) {
  const rt = roomRuntime(room);
  if (rt.stateEmitTimer) return;
  rt.stateEmitTimer = setTimeout(() => {
    rt.stateEmitTimer = null;
    void emitRoomState(room);
  }, delayMs);
}

function scheduleQuestionClose(room, delayMs) {
  clearQuestionTimer(room);
  const rt = roomRuntime(room);
  rt.questionTimer = setTimeout(() => {
    closeQuestion(room, 'timer');
  }, Math.max(0, delayMs));
}

function advanceFromResults(room) {
  if (room.status === 'ended' || room.phase !== 'results') return;
  const nextIndex = room.currentQuestionIndex + 1;
  if (nextIndex >= room.quizSnapshot.questions.length) endGame(room, 'completed');
  else startQuestion(room, nextIndex);
}

function scheduleAutoAdvance(room) {
  clearAutoAdvanceTimer(room);
  if (!room.autoAdvanceResults || room.status === 'ended' || room.phase !== 'results') return;
  const rt = roomRuntime(room);
  room.nextAutoAdvanceAt = Date.now() + 5000;
  rt.autoAdvanceTimer = setTimeout(() => {
    advanceFromResults(room);
  }, 5000);
}

function saveRoom(room) {
  const saved = clone(room);
  const idx = db.rooms.findIndex((r) => r.id === saved.id);
  if (idx === -1) db.rooms.push(saved);
  else db.rooms[idx] = saved;
  persist();
}

function currentQuestion(room) {
  return room.quizSnapshot.questions[room.currentQuestionIndex] || null;
}

function currentAnswers(room) {
  const key = String(room.currentQuestionIndex);
  if (!room.answersByQuestion[key]) room.answersByQuestion[key] = {};
  return room.answersByQuestion[key];
}

function playablePlayers(room) {
  return room.players.filter((player) => !player.kicked);
}

function connectedPlayers(room) {
  return playablePlayers(room).filter((player) => player.connected);
}

function leaderboard(room) {
  return rankPlayers(playablePlayers(room));
}

function rankForPlayer(room, playerId) {
  return leaderboard(room).findIndex((player) => player.id === playerId) + 1;
}

function buildQuestionResults(room, reason) {
  const question = currentQuestion(room);
  const answers = currentAnswers(room);
  const distribution = question.options.map((option, index) => ({
    index,
    option,
    count: Object.values(answers).filter((answer) => answer.optionIndex === index).length,
  }));

  return {
    reason,
    questionIndex: room.currentQuestionIndex,
    correctIndex: question.correctIndex,
    answeredCount: Object.keys(answers).length,
    totalPlayers: playablePlayers(room).length,
    distribution,
    closedAt: nowIso(),
  };
}

function makeClientState(room, socketData = {}) {
  const question = currentQuestion(room);
  const answers = room.currentQuestionIndex >= 0 ? currentAnswers(room) : {};
  const isHost = socketData.role === 'host';
  const player = socketData.playerId ? room.players.find((p) => p.id === socketData.playerId) : null;
  const canRevealAnswer = isHost || room.phase === 'results' || room.phase === 'final';
  const answer = player ? answers[player.id] || null : null;

  return {
    serverNow: Date.now(),
    room: {
      code: room.code,
      status: room.status,
      phase: room.phase,
      currentQuestionIndex: room.currentQuestionIndex,
      totalQuestions: room.quizSnapshot.questions.length,
      deadlineAt: room.deadlineAt,
      remainingMs: room.remainingMs,
      paused: !!room.paused,
      pausedReason: room.pausedReason || '',
      autoAdvanceResults: !!room.autoAdvanceResults,
      nextAutoAdvanceAt: room.nextAutoAdvanceAt || null,
    },
    quiz: {
      title: room.quizSnapshot.title,
      description: room.quizSnapshot.description,
    },
    players: playablePlayers(room).map((p) => ({
      id: isHost ? p.id : undefined,
      nickname: p.nickname,
      score: p.score,
      connected: p.connected,
      locked: !!answers[p.id],
      totalResponseMs: isHost ? p.totalResponseMs : undefined,
    })),
    leaderboard: leaderboard(room).map((p, index) => ({
      rank: index + 1,
      nickname: p.nickname,
      score: p.score,
      connected: p.connected,
    })),
    question: question ? {
      text: question.text,
      imageUrl: question.imageUrl,
      options: question.options,
      timeLimitSeconds: question.timeLimitSeconds,
      correctIndex: canRevealAnswer ? question.correctIndex : undefined,
    } : null,
    results: room.phase === 'results' || room.phase === 'final' ? room.lastResults : null,
    you: player ? {
      id: player.id,
      nickname: player.nickname,
      score: player.score,
      connected: player.connected,
      locked: !!answer,
      answerIndex: answer ? answer.optionIndex : null,
      roundPoints: player.lastRoundPoints || 0,
      lastAnswerCorrect: player.lastAnswerCorrect,
      rank: rankForPlayer(room, player.id),
    } : null,
  };
}

async function emitRoomState(room) {
  const sockets = await io.in(room.code).fetchSockets();
  sockets.forEach((socket) => {
    socket.emit('room:state', makeClientState(room, socket.data));
  });
}

function startQuestion(room, index) {
  const question = room.quizSnapshot.questions[index];
  if (!question) {
    endGame(room, 'completed');
    return;
  }

  clearScheduledRoomStateEmit(room);
  room.status = 'active';
  room.phase = 'question';
  clearAutoAdvanceTimer(room);
  room.currentQuestionIndex = index;
  room.lastResults = null;
  room.paused = false;
  room.pausedReason = '';
  room.remainingMs = null;
  room.questionStartedAt = Date.now();
  room.deadlineAt = room.questionStartedAt + question.timeLimitSeconds * 1000;
  room.players.forEach((player) => {
    player.lastRoundPoints = 0;
    player.lastAnswerCorrect = null;
    player.lastAnswerIndex = null;
  });
  currentAnswers(room);
  scheduleQuestionClose(room, question.timeLimitSeconds * 1000);
  saveRoom(room);
  void emitRoomState(room);
}

function closeQuestion(room, reason) {
  if (room.status === 'ended' || room.phase !== 'question') return;
  clearQuestionTimer(room);
  clearScheduledRoomStateEmit(room);

  const answers = currentAnswers(room);
  playablePlayers(room).forEach((player) => {
    if (!answers[player.id]) {
      player.lastRoundPoints = 0;
      player.lastAnswerCorrect = false;
      player.lastAnswerIndex = null;
    }
  });

  room.phase = 'results';
  room.paused = false;
  room.pausedReason = '';
  room.deadlineAt = null;
  room.remainingMs = 0;
  room.lastResults = buildQuestionResults(room, reason);
  scheduleAutoAdvance(room);
  saveRoom(room);
  void emitRoomState(room);
}

function endGame(room, reason) {
  if (room.status === 'ended') return;
  clearQuestionTimer(room);
  clearAutoAdvanceTimer(room);
  clearScheduledRoomStateEmit(room);
  const rt = roomRuntime(room);
  if (rt.hostEndTimer) clearTimeout(rt.hostEndTimer);
  rt.hostEndTimer = null;
  room.status = 'ended';
  room.phase = 'final';
  room.endedAt = nowIso();
  room.endReason = reason;
  room.deadlineAt = null;
  room.remainingMs = 0;
  if (room.currentQuestionIndex >= 0 && !room.lastResults && currentQuestion(room)) {
    room.lastResults = buildQuestionResults(room, reason);
  }
  activeRooms.delete(room.code);
  saveRoom(room);
  void emitRoomState(room);
}

function pauseRoom(room, reason) {
  if (room.phase !== 'question' || room.paused) return;
  clearScheduledRoomStateEmit(room);
  room.remainingMs = Math.max(0, (room.deadlineAt || Date.now()) - Date.now());
  room.paused = true;
  room.pausedReason = reason;
  room.deadlineAt = null;
  clearQuestionTimer(room);
  saveRoom(room);
  void emitRoomState(room);
}

function resumeRoom(room) {
  if (room.phase !== 'question' || !room.paused) return;
  clearScheduledRoomStateEmit(room);
  room.paused = false;
  room.pausedReason = '';
  room.deadlineAt = Date.now() + Math.max(0, room.remainingMs || 0);
  scheduleQuestionClose(room, room.remainingMs || 0);
  room.remainingMs = null;
  saveRoom(room);
  void emitRoomState(room);
}

function maybeCloseWhenAllAnswered(room) {
  if (room.phase !== 'question') return;
  const players = connectedPlayers(room);
  if (players.length === 0) return;
  const answers = currentAnswers(room);
  if (players.every((player) => answers[player.id])) {
    closeQuestion(room, 'all_answered');
    return true;
  }
  return false;
}

function restoreActiveRooms() {
  db.rooms
    .filter((room) => room.status !== 'ended')
    .forEach((room) => {
      if (room.phase === 'question') {
        room.phase = 'results';
        room.paused = false;
        room.deadlineAt = null;
        room.remainingMs = 0;
        room.nextAutoAdvanceAt = null;
        room.lastResults = room.lastResults || buildQuestionResults(room, 'server_restored');
      }
      room.players.forEach((player) => {
        player.connected = false;
      });
      activeRooms.set(room.code, room);
    });
}

restoreActiveRooms();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

app.use(express.json({ limit: '8mb' }));
app.use('/assets', express.static(path.join(ROOT, 'assets')));
app.use('/games', express.static(path.join(ROOT, 'games')));
app.use('/uploads', express.static(UPLOAD_ROOT, {
  fallthrough: false,
  index: false,
  maxAge: '7d',
}));

app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/parent.html', (_req, res) => res.sendFile(path.join(ROOT, 'parent.html')));
app.get('/manifest.webmanifest', (_req, res) => res.sendFile(path.join(ROOT, 'manifest.webmanifest')));
app.get('/sw.js', (_req, res) => res.sendFile(path.join(ROOT, 'sw.js')));
app.get('/gp-hoot', (req, res) => {
  const host = String(req.headers.host || '').toLowerCase();
  if (host && !host.startsWith('gp-hoot.gplange.tech')) {
    const target = new URL('https://gp-hoot.gplange.tech/gp-hoot');
    const room = req.query?.room;
    if (room) target.searchParams.set('room', String(room));
    res.redirect(302, target.toString());
    return;
  }
  res.sendFile(path.join(ROOT, 'games', 'gp-hoot.html'));
});

app.get('/api/gp-hoot/me', (req, res) => {
  res.json({ user: publicUser(userFromCookieHeader(req.headers.cookie)) });
});

app.get('/api/gp-hoot/network', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  res.json({
    currentOrigin: `${protocol}://${host}`,
    lanOrigins: localNetworkUrls(PORT),
  });
});

const SHARED_STATE_PATH = path.join(ROOT, '.data', 'shared-state.json');

function defaultSharedStateRecord() {
  return { revision: 0, updatedAt: null, state: null };
}

function readSharedStateRecord() {
  try {
    if (!fs.existsSync(SHARED_STATE_PATH)) return defaultSharedStateRecord();
    return { ...defaultSharedStateRecord(), ...JSON.parse(fs.readFileSync(SHARED_STATE_PATH, 'utf8')) };
  } catch {
    return defaultSharedStateRecord();
  }
}

function writeSharedStateRecord(state, expectedRevision) {
  const current = readSharedStateRecord();
  const currentRevision = current?.revision || 0;
  if (current.state && expectedRevision && expectedRevision !== currentRevision) {
    return { ok: false, currentRevision, updatedAt: current.updatedAt || null };
  }
  const next = { revision: currentRevision + 1, updatedAt: nowIso(), state };
  fs.mkdirSync(path.dirname(SHARED_STATE_PATH), { recursive: true });
  fs.writeFileSync(SHARED_STATE_PATH, JSON.stringify(next, null, 2));
  return { ok: true, revision: next.revision, updatedAt: next.updatedAt };
}

app.get('/api/state', (_req, res) => {
  const record = readSharedStateRecord();
  res.json({ user: 'shared', state: record.state || null, revision: record.revision || 0, updatedAt: record.updatedAt || null });
});

app.post('/api/state', (req, res) => {
  if (!req.body || typeof req.body.state !== 'object') {
    res.status(400).json({ error: 'Expected { state }' });
    return;
  }
  const expectedRevision = Number(req.body.expectedRevision || 0);
  const result = writeSharedStateRecord(req.body.state, expectedRevision);
  if (!result.ok) {
    res.status(409).json({ error: 'revision_conflict', currentRevision: result.currentRevision, updatedAt: result.updatedAt });
    return;
  }
  res.json({ ok: true, user: 'shared', revision: result.revision, updatedAt: result.updatedAt });
});

app.post('/api/gp-hoot/auth/signup', rateLimit({
  name: 'signup',
  limit: 8,
  windowMs: 60_000,
  key: (req) => `${getRequestIp(req)}:${normalizeEmail(req.body.email)}`,
}), (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const displayName = text(req.body.displayName, 80, email.split('@')[0] || 'Host');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: 'Enter a valid email address.' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }
  if (db.users.some((user) => user.email === email)) {
    res.status(409).json({ error: 'That email is already registered.' });
    return;
  }

  const user = {
    id: id('user'),
    email,
    displayName,
    passwordHash: hashPassword(password),
    createdAt: nowIso(),
  };
  db.users.push(user);
  persist();
  setSessionCookie(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/gp-hoot/auth/login', rateLimit({
  name: 'login',
  limit: 12,
  windowMs: 60_000,
  key: (req) => `${getRequestIp(req)}:${normalizeEmail(req.body.email)}`,
}), (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = db.users.find((candidate) => candidate.email === email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.passwordHash)) {
    res.status(401).json({ error: 'Email or password is incorrect.' });
    return;
  }
  setSessionCookie(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/gp-hoot/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/gp-hoot/uploads', requireUser, rateLimit({
  name: 'upload',
  limit: 40,
  windowMs: 60 * 60_000,
  key: (req) => `${req.user.id}:${getRequestIp(req)}`,
}), (req, res) => {
  try {
    const image = decodeDataImage(req.body.imageData);
    const filename = `${req.user.id}-${crypto.randomUUID()}.${image.ext}`;
    const filePath = path.join(GP_HOOT_UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, image.buffer, { flag: 'wx' });
    res.status(201).json({
      url: `/uploads/gp-hoot/${filename}`,
      contentType: image.mime,
      bytes: image.buffer.length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/gp-hoot/quizzes', requireUser, (req, res) => {
  const quizzes = db.quizzes
    .filter((quiz) => quiz.ownerUserId === req.user.id)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      questionCount: quiz.questions.length,
      createdAt: quiz.createdAt,
      updatedAt: quiz.updatedAt,
    }));
  res.json({ quizzes });
});

app.post('/api/gp-hoot/quizzes', requireUser, (req, res) => {
  try {
    const normalized = normalizeQuizPayload(req.body, null);
    const quiz = {
      id: id('quiz'),
      ownerUserId: req.user.id,
      ...normalized,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    db.quizzes.push(quiz);
    persist();
    res.status(201).json({ quiz });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/gp-hoot/quizzes/:id', requireUser, (req, res) => {
  const quiz = quizForUser(req.user.id, req.params.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz not found.' });
    return;
  }
  res.json({ quiz });
});

app.put('/api/gp-hoot/quizzes/:id', requireUser, (req, res) => {
  const quiz = quizForUser(req.user.id, req.params.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz not found.' });
    return;
  }
  try {
    const previousUploads = questionUploadUrls(quiz.questions);
    Object.assign(quiz, normalizeQuizPayload(req.body, quiz), { updatedAt: nowIso() });
    const nextUploads = questionUploadUrls(quiz.questions);
    const removedUploads = [...previousUploads].filter((url) => !nextUploads.has(url));
    persist();
    cleanupUnreferencedUploads(removedUploads);
    res.json({ quiz });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/gp-hoot/quizzes/:id', requireUser, (req, res) => {
  const quiz = quizForUser(req.user.id, req.params.id);
  const before = db.quizzes.length;
  db.quizzes = db.quizzes.filter((quiz) => !(quiz.id === req.params.id && quiz.ownerUserId === req.user.id));
  if (db.quizzes.length === before) {
    res.status(404).json({ error: 'Quiz not found.' });
    return;
  }
  persist();
  cleanupUnreferencedUploads(questionUploadUrls(quiz.questions), new Set([quiz.id]));
  res.json({ ok: true });
});

app.post('/api/gp-hoot/quizzes/:id/duplicate', requireUser, (req, res) => {
  const quiz = quizForUser(req.user.id, req.params.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz not found.' });
    return;
  }
  const copy = {
    ...clone(quiz),
    id: id('quiz'),
    title: `${quiz.title} copy`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.quizzes.push(copy);
  persist();
  res.status(201).json({ quiz: copy });
});

app.post('/api/gp-hoot/quizzes/:id/rooms', requireUser, (req, res) => {
  const quiz = quizForUser(req.user.id, req.params.id);
  if (!quiz) {
    res.status(404).json({ error: 'Quiz not found.' });
    return;
  }
  if (!quiz.questions.length) {
    res.status(400).json({ error: 'Add at least one question before hosting.' });
    return;
  }

  const room = {
    id: id('room'),
    code: generateRoomCode(),
    quizId: quiz.id,
    hostUserId: req.user.id,
    status: 'lobby',
    phase: 'lobby',
    quizSnapshot: clone({ title: quiz.title, description: quiz.description, questions: quiz.questions }),
    currentQuestionIndex: -1,
    players: [],
    answersByQuestion: {},
    lastResults: null,
    autoAdvanceResults: !!req.body?.autoAdvanceResults,
    nextAutoAdvanceAt: null,
    questionStartedAt: null,
    deadlineAt: null,
    remainingMs: null,
    paused: false,
    pausedReason: '',
    createdAt: nowIso(),
    startedAt: null,
    endedAt: null,
    endReason: '',
  };

  db.rooms.push(clone(room));
  activeRooms.set(room.code, room);
  persist();
  res.status(201).json({ room: { code: room.code, id: room.id } });
});

app.get('/api/gp-hoot/qr', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\/.{1,500}$/i.test(url)) {
    res.status(400).type('text/plain').send('Invalid QR URL.');
    return;
  }
  try {
    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#16213e', light: '#ffffff' },
    });
    res.type('image/svg+xml').send(svg);
  } catch {
    res.status(500).type('text/plain').send('Could not generate QR code.');
  }
});

app.get('/api/gp-hoot/rooms/:code', (req, res) => {
  const room = activeRooms.get(String(req.params.code || '').padStart(6, '0'));
  if (!room) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }
  res.json({
    room: {
      code: room.code,
      status: room.status,
      phase: room.phase,
      title: room.quizSnapshot.title,
      playerCount: playablePlayers(room).length,
    },
  });
});

function ackOrError(socket, ack, result) {
  if (typeof ack === 'function') ack(result);
  if (!result.ok) socket.emit('room:error', result.error);
}

function hostRoom(socket) {
  const room = activeRooms.get(socket.data.roomCode);
  if (!room || socket.data.role !== 'host') return null;
  return room;
}

function playerRoom(socket) {
  const room = activeRooms.get(socket.data.roomCode);
  if (!room || socket.data.role !== 'player') return null;
  return room;
}

io.on('connection', (socket) => {
  socket.on('host:join', async (payload, ack) => {
    if (socketRateLimited(socket, 'host_join', 60, 60_000)) {
      ackOrError(socket, ack, { ok: false, error: 'Too many host join attempts. Try again shortly.' });
      return;
    }
    const user = userFromCookieHeader(socket.handshake.headers.cookie);
    const room = activeRooms.get(String(payload?.code || '').padStart(6, '0'));
    if (!user || !room || room.hostUserId !== user.id) {
      ackOrError(socket, ack, { ok: false, error: 'Host access denied for this room.' });
      return;
    }

    socket.data.role = 'host';
    socket.data.roomCode = room.code;
    socket.data.userId = user.id;
    socket.join(room.code);
    const rt = roomRuntime(room);
    rt.hostSockets.add(socket.id);
    if (rt.hostEndTimer) clearTimeout(rt.hostEndTimer);
    rt.hostEndTimer = null;
    ackOrError(socket, ack, { ok: true, state: makeClientState(room, socket.data) });
    await emitRoomState(room);
  });

  socket.on('player:join', async (payload, ack) => {
    if (socketRateLimited(socket, 'player_join', 30, 60_000)) {
      ackOrError(socket, ack, { ok: false, error: 'Too many join attempts. Try again shortly.' });
      return;
    }
    const room = activeRooms.get(String(payload?.code || '').padStart(6, '0'));
    const nickname = text(payload?.nickname, 20);
    if (!room || room.status === 'ended') {
      ackOrError(socket, ack, { ok: false, error: 'Room not found or already ended.' });
      return;
    }
    if (!/^[\w .'-]{3,20}$/.test(nickname)) {
      ackOrError(socket, ack, { ok: false, error: 'Nickname must be 3-20 characters.' });
      return;
    }
    if (playablePlayers(room).length >= 50 && !playablePlayers(room).some((p) => p.nickname.toLowerCase() === nickname.toLowerCase())) {
      ackOrError(socket, ack, { ok: false, error: 'This room is full.' });
      return;
    }

    let player = playablePlayers(room).find((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (player) {
      const canReconnect = !player.connected && player.leftAt && Date.now() - Date.parse(player.leftAt) <= 60_000;
      if (!canReconnect) {
        ackOrError(socket, ack, { ok: false, error: 'That nickname is already in use.' });
        return;
      }
      player.connected = true;
      player.leftAt = null;
    } else {
      player = {
        id: id('player'),
        nickname,
        score: 0,
        totalResponseMs: 0,
        joinedAt: nowIso(),
        leftAt: null,
        connected: true,
        kicked: false,
        lastRoundPoints: 0,
        lastAnswerCorrect: null,
        lastAnswerIndex: null,
      };
      room.players.push(player);
    }

    socket.data.role = 'player';
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    saveRoom(room);
    ackOrError(socket, ack, { ok: true, state: makeClientState(room, socket.data) });
    await emitRoomState(room);
  });

  socket.on('player:submit_answer', async (payload, ack) => {
    if (socketRateLimited(socket, 'answer', 120, 60_000)) {
      ackOrError(socket, ack, { ok: false, error: 'Too many answer attempts. Try again shortly.' });
      return;
    }
    const room = playerRoom(socket);
    const player = room?.players.find((p) => p.id === socket.data.playerId && !p.kicked);
    const question = room ? currentQuestion(room) : null;
    if (!room || !player || !question || room.phase !== 'question') {
      ackOrError(socket, ack, { ok: false, error: 'Question is not accepting answers.' });
      return;
    }
    if (room.paused) {
      ackOrError(socket, ack, { ok: false, error: 'The question is paused.' });
      return;
    }
    const answers = currentAnswers(room);
    if (answers[player.id]) {
      ackOrError(socket, ack, { ok: false, error: 'Answer already submitted.' });
      return;
    }
    const optionIndex = Number(payload?.optionIndex);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= question.options.length) {
      ackOrError(socket, ack, { ok: false, error: 'Invalid answer option.' });
      return;
    }

    const submittedAt = Date.now();
    const timeRemainingMs = Math.max(0, (room.deadlineAt || submittedAt) - submittedAt);
    if (timeRemainingMs <= 0) {
      ackOrError(socket, ack, { ok: false, error: 'Time is up.' });
      return;
    }

    const correct = optionIndex === question.correctIndex;
    const points = calculateQuestionPoints({ correct, timeRemainingMs, timeLimitSeconds: question.timeLimitSeconds });
    const responseMs = Math.max(0, submittedAt - room.questionStartedAt);
    answers[player.id] = { optionIndex, submittedAt, responseMs, points, correct };
    player.score += points;
    player.totalResponseMs += responseMs;
    player.lastRoundPoints = points;
    player.lastAnswerCorrect = correct;
    player.lastAnswerIndex = optionIndex;
    ackOrError(socket, ack, { ok: true, points });
    const closed = maybeCloseWhenAllAnswered(room);
    if (!closed) scheduleRoomStateEmit(room);
  });

  socket.on('host:start', async (_payload, ack) => {
    const room = hostRoom(socket);
    if (!room || room.phase !== 'lobby') {
      ackOrError(socket, ack, { ok: false, error: 'Game cannot be started from here.' });
      return;
    }
    room.startedAt = nowIso();
    ackOrError(socket, ack, { ok: true });
    startQuestion(room, 0);
  });

  socket.on('host:next_question', (_payload, ack) => {
    const room = hostRoom(socket);
    if (!room || (room.phase !== 'results' && room.phase !== 'final')) {
      ackOrError(socket, ack, { ok: false, error: 'No result screen to advance.' });
      return;
    }
    ackOrError(socket, ack, { ok: true });
    clearAutoAdvanceTimer(room);
    advanceFromResults(room);
  });

  socket.on('host:skip_question', (_payload, ack) => {
    const room = hostRoom(socket);
    if (!room || room.phase !== 'question') {
      ackOrError(socket, ack, { ok: false, error: 'No active question to skip.' });
      return;
    }
    ackOrError(socket, ack, { ok: true });
    closeQuestion(room, 'skipped');
  });

  socket.on('host:pause', (_payload, ack) => {
    const room = hostRoom(socket);
    if (!room || room.phase !== 'question' || room.paused) {
      ackOrError(socket, ack, { ok: false, error: 'Game cannot be paused now.' });
      return;
    }
    ackOrError(socket, ack, { ok: true });
    pauseRoom(room, 'host');
  });

  socket.on('host:resume', (_payload, ack) => {
    const room = hostRoom(socket);
    if (!room || room.phase !== 'question' || !room.paused) {
      ackOrError(socket, ack, { ok: false, error: 'Game is not paused.' });
      return;
    }
    ackOrError(socket, ack, { ok: true });
    resumeRoom(room);
  });

  socket.on('host:kick_player', async (payload, ack) => {
    const room = hostRoom(socket);
    const player = room?.players.find((p) => p.id === payload?.playerId && !p.kicked);
    if (!room || !player) {
      ackOrError(socket, ack, { ok: false, error: 'Player not found.' });
      return;
    }
    player.kicked = true;
    player.connected = false;
    player.leftAt = nowIso();
    const sockets = await io.in(room.code).fetchSockets();
    sockets.forEach((roomSocket) => {
      if (roomSocket.data.playerId === player.id) {
        roomSocket.emit('room:kicked');
        roomSocket.leave(room.code);
      }
    });
    saveRoom(room);
    maybeCloseWhenAllAnswered(room);
    ackOrError(socket, ack, { ok: true });
    await emitRoomState(room);
  });

  socket.on('host:end_game', (_payload, ack) => {
    const room = hostRoom(socket);
    if (!room) {
      ackOrError(socket, ack, { ok: false, error: 'Room not found.' });
      return;
    }
    ackOrError(socket, ack, { ok: true });
    endGame(room, 'host_ended');
  });

  socket.on('disconnect', async () => {
    const room = activeRooms.get(socket.data.roomCode);
    if (!room) return;

    if (socket.data.role === 'player') {
      const player = room.players.find((p) => p.id === socket.data.playerId);
      if (player && !player.kicked) {
        player.connected = false;
        player.leftAt = nowIso();
        saveRoom(room);
        maybeCloseWhenAllAnswered(room);
        await emitRoomState(room);
      }
      return;
    }

    if (socket.data.role === 'host') {
      const rt = roomRuntime(room);
      rt.hostSockets.delete(socket.id);
      if (rt.hostSockets.size === 0 && room.status === 'active') {
        pauseRoom(room, 'host_disconnected');
        rt.hostEndTimer = setTimeout(() => {
          endGame(room, 'host_timeout');
        }, 120_000);
      } else {
        await emitRoomState(room);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[GP-hoot] listening on http://localhost:${PORT}`);
});
