/* ============================================================
 * GameHub – shared data layer and game registry
 * Stores profiles, settings, and progress in localStorage.
 * Exposes a global `Hub` object used by index, parent, and games.
 * ========================================================== */
(function () {
  'use strict';

  const STORAGE_KEY = 'gamehub.v1';
  const DEFAULT_PIN = '1234';
  const REMOTE_SYNC_META_KEY = 'gamehub.remoteSyncMeta';
  let syncTimer = null;
  let initPromise = null;
  let refreshTimer = null;
  const syncListeners = new Set();

  // ---------- Game Registry ----------
  // To add a new game, drop a new HTML file under /games/ and add an entry here.
  const GAMES = [
    // Toddler (ages 2-4)
    {
      id: 'color-match',
      title: 'Color Match',
      subject: 'Colors',
      icon: '🎨',
      tagline: 'Tap the matching color',
      ageGroups: ['toddler'],
      path: 'games/color-match.html',
      accent: '#ff7eb6',
    },
    {
      id: 'shape-sorter',
      title: 'Shape Sorter',
      subject: 'Shapes',
      icon: '🔷',
      tagline: 'Find the right shape',
      ageGroups: ['toddler'],
      path: 'games/shape-sorter.html',
      accent: '#7cd6ff',
    },
    {
      id: 'animal-friends',
      title: 'Animal Friends',
      subject: 'Language',
      icon: '🐾',
      tagline: 'Meet the animals',
      ageGroups: ['toddler'],
      path: 'games/animal-friends.html',
      accent: '#ffd166',
    },

    // Early Elementary (ages 5-7)
    {
      id: 'counting-adventure',
      title: 'Counting Adventure',
      subject: 'Math',
      icon: '🔢',
      tagline: 'Count and add',
      ageGroups: ['early-elem'],
      path: 'games/counting-adventure.html',
      accent: '#06d6a0',
    },
    {
      id: 'spelling-bee',
      title: 'Spelling Bee',
      subject: 'Language',
      icon: '🐝',
      tagline: 'Spell simple words',
      ageGroups: ['early-elem'],
      path: 'games/spelling-bee.html',
      accent: '#ffb703',
    },
    {
      id: 'letter-hunt',
      title: 'Letter Hunt',
      subject: 'Language',
      icon: '🔤',
      tagline: 'Find the first letter',
      ageGroups: ['early-elem'],
      path: 'games/letter-hunt.html',
      accent: '#ef476f',
    },
    {
      id: 'science-sorter',
      title: 'Science Sorter',
      subject: 'Science',
      icon: '🔬',
      tagline: 'Sort the animals',
      ageGroups: ['early-elem'],
      path: 'games/science-sorter.html',
      accent: '#118ab2',
    },
    {
      id: 'world-explorer',
      title: 'World Explorer',
      subject: 'Geography',
      icon: '🌍',
      tagline: 'Discover the world',
      ageGroups: ['early-elem'],
      path: 'games/world-explorer.html',
      accent: '#8338ec',
    },
    {
      id: 'space-adventure',
      title: 'Space Adventure',
      subject: 'Math',
      icon: '🚀',
      tagline: 'Blast through space with math',
      ageGroups: ['early-elem'],
      path: 'games/space-adventure.html',
      accent: '#00c9ff',
    },
    {
      id: 'gem-quest',
      title: 'Gem Quest',
      subject: 'Math + Reading',
      icon: '💎',
      tagline: 'Explore for the right answer',
      ageGroups: ['early-elem'],
      path: 'games/gem-quest.html',
      accent: '#0f766e',
    },
    {
      id: 'mba-mastery-quiz',
      title: 'MBA Mastery Quiz',
      subject: 'MBA Revision',
      icon: '🧠',
      tagline: 'Adaptive quiz practice by topic',
      ageGroups: ['adult'],
      path: 'games/mba-mastery-quiz.html',
      accent: '#6c5ce7',
    },
    {
      id: 'gp-hoot',
      title: 'GP-hoot',
      subject: 'Team Quiz',
      icon: 'GP',
      tagline: 'Host a live team quiz',
      ageGroups: ['adult'],
      path: 'https://gp-hoot.gplange.tech/gp-hoot',
      accent: '#16213e',
    },
  ];

  const AGE_GROUPS = {
    toddler: { label: 'Toddler', min: 2, max: 4 },
    'early-elem': { label: 'Early Elementary', min: 5, max: 7 },
    adult: { label: 'Adult', min: 18, max: 120 },
  };

  // ---------- Storage ----------
  function defaultState() {
    return {
      version: 1,
      parentPin: DEFAULT_PIN,
      profiles: [],
      activeProfileId: null,
      settings: {}, // settings[profileId][gameId] = { enabled: bool }
      progress: {}, // progress[profileId][gameId] = { plays, bestScore, totalSeconds, lastPlayed }
      gameConfig: {}, // gameConfig[profileId][gameId] = arbitrary per-game settings object
      quizState: {}, // quizState[profileId] = adaptive quiz state and history
      _sync: { revision: 0, updatedAt: null },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    } catch (e) {
      console.warn('GameHub: failed to read storage, using defaults.', e);
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      queueRemoteSync(state);
    } catch (e) {
      console.error('GameHub: failed to save storage.', e);
    }
  }

  function queueRemoteSync(snapshot) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncRemoteState(snapshot).catch((e) => console.warn('GameHub: remote sync failed', e));
    }, 400);
  }

  function getApiBase() {
    return window.GAMEHUB_API_BASE || '';
  }

  function getEndpointLabel() {
    return `${window.location.origin}${getApiBase() ? ` via ${getApiBase()}` : ''}`;
  }

  async function syncRemoteState(snapshot) {
    if (!window.fetch) return { ok: false, reason: 'no-fetch' };
    const expectedRevision = snapshot?._sync?.revision || 0;
    const res = await fetch(`${getApiBase()}/api/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: snapshot, expectedRevision }),
    });
    const ok = !!res.ok;
    if (ok) {
      const data = await res.json();
      snapshot._sync = { revision: data.revision || expectedRevision, updatedAt: data.updatedAt || new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      setRemoteSyncMeta({ lastPushAt: new Date().toISOString(), lastPushOk: true, lastConflict: null, revision: snapshot._sync.revision, updatedAt: snapshot._sync.updatedAt });
    } else if (res.status === 409) {
      const conflict = await res.json().catch(() => ({}));
      setRemoteSyncMeta({ lastPushAt: new Date().toISOString(), lastPushOk: false, lastConflict: true, conflictRevision: conflict.currentRevision || null, conflictUpdatedAt: conflict.updatedAt || null });
    } else {
      setRemoteSyncMeta({ lastPushAt: new Date().toISOString(), lastPushOk: false });
    }
    emitSyncStatus();
    return { ok };
  }

  async function loadRemoteState() {
    if (!window.fetch) return null;
    try {
      const res = await fetch(`${getApiBase()}/api/state`);
      if (!res.ok) {
        setRemoteSyncMeta({ lastPullAt: new Date().toISOString(), lastPullOk: false });
        emitSyncStatus();
        return null;
      }
      const data = await res.json();
      setRemoteSyncMeta({ lastPullAt: new Date().toISOString(), lastPullOk: true, revision: data.revision || 0, updatedAt: data.updatedAt || null, lastConflict: null });
      emitSyncStatus();
      if (data && data.state && typeof data.state === 'object') {
        data.state._sync = { revision: data.revision || 0, updatedAt: data.updatedAt || null };
        return data.state;
      }
      return null;
    } catch (e) {
      setRemoteSyncMeta({ lastPullAt: new Date().toISOString(), lastPullOk: false });
      emitSyncStatus();
      return null;
    }
  }

  function getRemoteSyncMeta() {
    try {
      const raw = localStorage.getItem(REMOTE_SYNC_META_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function setRemoteSyncMeta(patch) {
    try {
      const current = getRemoteSyncMeta();
      localStorage.setItem(REMOTE_SYNC_META_KEY, JSON.stringify(Object.assign({}, current, patch)));
    } catch (_) {}
  }

  function setRemoteUser() {
    initPromise = loadRemoteState().then((remote) => {
      if (remote && typeof remote === 'object') {
        state = Object.assign(defaultState(), remote);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        emitSyncStatus();
      }
      startBackgroundRefresh();
      return state;
    }).catch(() => state);
  }

  function emitSyncStatus() {
    const meta = getRemoteSyncMeta();
    syncListeners.forEach(fn => {
      try { fn(meta); } catch (_) {}
    });
  }

  function onSyncStatus(fn) {
    syncListeners.add(fn);
    return () => syncListeners.delete(fn);
  }

  function startBackgroundRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      const remote = await loadRemoteState();
      if (remote && typeof remote === 'object') {
        state = Object.assign(defaultState(), remote);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    }, 15000);
  }

  let state = load();
  initPromise = loadRemoteState().then((remote) => {
    if (remote && typeof remote === 'object') {
      state = Object.assign(defaultState(), remote);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    startBackgroundRefresh();
    return state;
  }).catch(() => state);

  // ---------- Helpers ----------
  function uid() {
    return 'p_' + Math.random().toString(36).slice(2, 9);
  }

  function ensureProfileBuckets(profileId) {
    if (!state.settings[profileId]) state.settings[profileId] = {};
    if (!state.progress[profileId]) state.progress[profileId] = {};
    if (!state.gameConfig) state.gameConfig = {};
    if (!state.gameConfig[profileId]) state.gameConfig[profileId] = {};
    if (!state.quizState) state.quizState = {};
    if (!state.quizState[profileId]) state.quizState[profileId] = defaultQuizState();
  }

  function defaultQuizState() {
    return {
      mastery: {},
      attempts: [],
      daily: {},
      sessions: {},
      streak: 0,
      lastQuizDate: null,
      modeStats: {},
    };
  }

  // ---------- Profile API ----------
  function getProfiles() {
    return state.profiles.slice();
  }

  function addProfile({ name, ageGroup, color }) {
    const profile = {
      id: uid(),
      name: String(name || 'Kid').slice(0, 24),
      ageGroup: AGE_GROUPS[ageGroup] ? ageGroup : 'early-elem',
      color: color || pickColor(),
      createdAt: new Date().toISOString(),
    };
    state.profiles.push(profile);
    ensureProfileBuckets(profile.id);
    // default: all age-appropriate games enabled
    GAMES.forEach((g) => {
      if (g.ageGroups.includes(profile.ageGroup)) {
        state.settings[profile.id][g.id] = { enabled: true };
      }
    });
    save(state);
    return profile;
  }

  function updateProfile(profileId, updates) {
    const p = state.profiles.find((x) => x.id === profileId);
    if (!p) return null;
    if (updates.name !== undefined) p.name = String(updates.name).slice(0, 24);
    if (updates.ageGroup && AGE_GROUPS[updates.ageGroup]) p.ageGroup = updates.ageGroup;
    if (updates.color) p.color = updates.color;
    save(state);
    return p;
  }

  function removeProfile(profileId) {
    state.profiles = state.profiles.filter((p) => p.id !== profileId);
    delete state.settings[profileId];
    delete state.progress[profileId];
    if (state.quizState) delete state.quizState[profileId];
    if (state.activeProfileId === profileId) state.activeProfileId = null;
    save(state);
  }

  function setActiveProfile(profileId) {
    state.activeProfileId = profileId;
    save(state);
  }

  function getActiveProfile() {
    if (!state.activeProfileId) return null;
    return state.profiles.find((p) => p.id === state.activeProfileId) || null;
  }

  function pickColor() {
    const palette = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', '#ff7eb6', '#fb8500'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  // ---------- Settings API ----------
  function isGameEnabled(profileId, gameId) {
    const game = GAMES.find((g) => g.id === gameId);
    const profile = state.profiles.find((p) => p.id === profileId);
    if (!game || !profile) return false;
    if (!game.ageGroups.includes(profile.ageGroup)) return false;
    ensureProfileBuckets(profileId);
    const s = state.settings[profileId][gameId];
    return s ? s.enabled !== false : true;
  }

  function setGameEnabled(profileId, gameId, enabled) {
    ensureProfileBuckets(profileId);
    state.settings[profileId][gameId] = { enabled: !!enabled };
    save(state);
  }

  // ---------- Per-game Config API ----------
  // Each game can store an arbitrary settings object per profile.
  // Returns null if nothing saved yet.
  function getGameConfig(profileId, gameId) {
    if (!profileId) return null;
    ensureProfileBuckets(profileId);
    const cfg = state.gameConfig[profileId][gameId];
    return cfg ? JSON.parse(JSON.stringify(cfg)) : null;
  }

  function setGameConfig(profileId, gameId, config) {
    if (!profileId) return;
    ensureProfileBuckets(profileId);
    state.gameConfig[profileId][gameId] = config && typeof config === 'object'
      ? JSON.parse(JSON.stringify(config))
      : {};
    save(state);
  }

  // ---------- Progress API ----------
  function getProgress(profileId, gameId) {
    ensureProfileBuckets(profileId);
    return state.progress[profileId][gameId] || { plays: 0, bestScore: 0, totalSeconds: 0, lastPlayed: null };
  }

  // ---------- Quiz Data ----------
  const QUIZ_BANK = {
    course: 'organizational-behaviour',
    units: {
      unit1: {
        title: 'Management and Organizational Behaviour, plus Leadership in a Dynamic Environment',
        topics: [
          { id: 'U1-T5', name: 'Leadership fundamentals', weight: 0.16 },
          { id: 'U1-T6', name: 'Leadership theories and effectiveness', weight: 0.18 }
        ]
      },
      unit2: {
        title: 'Structure, Strategy and Change',
        topics: [
          { id: 'U2-T4', name: '7-S and expanded 7-S alignment diagnostics', weight: 0.16 },
          { id: 'U2-T7', name: 'Diversity and inclusion', weight: 0.12 },
          { id: 'U2-T9', name: 'Stress, role pressure, and well-being', weight: 0.07 }
        ]
      }
    },
    questions: []
  };

  function hydrateQuizBank() {
    if (Array.isArray(window.MBA_QUIZ_BANK) && window.MBA_QUIZ_BANK.length) {
      QUIZ_BANK.questions = window.MBA_QUIZ_BANK.filter(q => q.status !== 'draft');
    }
  }

  hydrateQuizBank();

  function getQuizState(profileId) {
    if (!profileId) return defaultQuizState();
    ensureProfileBuckets(profileId);
    return JSON.parse(JSON.stringify(state.quizState[profileId]));
  }

  function getTopicMastery(profileId, topicId) {
    ensureProfileBuckets(profileId);
    const qs = state.quizState[profileId];
    if (!qs.mastery[topicId]) {
      qs.mastery[topicId] = { mastery: 50, confidence: 40, stability: 30, correct: 0, wrong: 0, seen: 0, lastSeen: null, weak: false, recent: [] };
      save(state);
    }
    return JSON.parse(JSON.stringify(qs.mastery[topicId]));
  }

  function getQuizTopics(unit) {
    if (unit) return (QUIZ_BANK.units[unit]?.topics || []).slice();
    return Object.values(QUIZ_BANK.units).flatMap(u => u.topics);
  }

  function getQuizQuestions(filters) {
    hydrateQuizBank();
    let questions = QUIZ_BANK.questions.slice();
    if (filters?.unit) questions = questions.filter(q => q.unit === filters.unit);
    if (filters?.topic_id) questions = questions.filter(q => q.topic_id === filters.topic_id);
    if (filters?.question_type) questions = questions.filter(q => q.question_type === filters.question_type);
    return questions;
  }

  function chooseQuestions(profileId, opts) {
    const count = Math.max(1, Math.min(20, Number(opts?.count || 8)));
    const unit = opts?.unit || 'unit2';
    const topicId = opts?.topic_id || null;
    const mode = opts?.mode || 'daily';
    const pool = getQuizQuestions({ unit, topic_id: topicId });
    const used = new Set();
    const ordered = pool
      .map(q => ({ q, sort: Math.random() * 0.35 + questionPriority(profileId, q, mode) }))
      .sort((a, b) => b.sort - a.sort)
      .map(x => x.q);

    const picks = [];
    for (const q of ordered) {
      if (picks.length >= count) break;
      const familyKey = `${q.topic_id}:${q.question_type}:${q.difficulty}`;
      if (mode !== 'topic' && used.has(familyKey) && q.question_type !== 'scenario') continue;
      picks.push(q);
      used.add(familyKey);
    }
    if (picks.length < count) {
      ordered.forEach(q => {
        if (picks.length >= count) return;
        if (!picks.find(x => x.id === q.id)) picks.push(q);
      });
    }
    return picks.slice(0, Math.min(count, ordered.length));
  }

  function questionPriority(profileId, question, mode) {
    const mastery = getTopicMastery(profileId, question.topic_id);
    const weaknessBoost = (100 - mastery.mastery) / 100;
    const stabilityBoost = (100 - (mastery.stability || 30)) / 200;
    const confidenceBoost = (100 - (mastery.confidence || 40)) / 200;
    const difficultyWeight = question.difficulty === 'hard' ? 0.08 : question.difficulty === 'medium' ? 0.04 : 0;
    const typeWeight = question.question_type === 'scenario' || question.question_type === 'short_answer' ? 0.08 : 0.02;
    const base = mode === 'daily' ? 0.35 : mode === 'weakness' ? 0.5 : 0.2;
    return base + weaknessBoost + stabilityBoost + confidenceBoost + difficultyWeight + typeWeight;
  }

  function createQuizSession(profileId, opts) {
    ensureProfileBuckets(profileId);
    const sessionId = 'quiz_' + Math.random().toString(36).slice(2, 10);
    const questions = chooseQuestions(profileId, opts);
    const session = {
      id: sessionId,
      mode: opts?.mode || 'manual',
      unit: opts?.unit || 'unit2',
      topic_id: opts?.topic_id || null,
      createdAt: new Date().toISOString(),
      currentIndex: 0,
      questionIds: questions.map(q => q.id),
      answers: [],
      completed: false,
    };
    state.quizState[profileId].sessions[sessionId] = session;
    save(state);
    return JSON.parse(JSON.stringify(session));
  }

  function getQuizSession(profileId, sessionId) {
    ensureProfileBuckets(profileId);
    const session = state.quizState[profileId].sessions[sessionId];
    return session ? JSON.parse(JSON.stringify(session)) : null;
  }

  function getQuizQuestionById(questionId) {
    return QUIZ_BANK.questions.find(q => q.id === questionId) || null;
  }

  function answerQuizQuestion(profileId, sessionId, answer, confidence) {
    ensureProfileBuckets(profileId);
    const session = state.quizState[profileId].sessions[sessionId];
    if (!session || session.completed) return null;
    const questionId = session.questionIds[session.currentIndex];
    const question = getQuizQuestionById(questionId);
    if (!question) return null;
    const grading = gradeQuizAnswer(question, answer);
    const isCorrect = grading.isCorrect;
    const mastery = state.quizState[profileId].mastery[question.topic_id] || { mastery: 50, confidence: 40, stability: 30, correct: 0, wrong: 0, seen: 0, lastSeen: null, weak: false, recent: [] };
    mastery.seen += 1;
    mastery.lastSeen = new Date().toISOString();
    mastery.recent = mastery.recent || [];
    mastery.recent.push(isCorrect ? 1 : 0);
    mastery.recent = mastery.recent.slice(-8);
    const conf = confidence || 'confident';

    if (isCorrect) {
      mastery.correct += 1;
      mastery.mastery = Math.min(100, mastery.mastery + (question.difficulty === 'hard' ? 7 : question.difficulty === 'medium' ? 5 : 4) + (conf === 'confident' ? 1 : 0));
      mastery.confidence = Math.min(100, (mastery.confidence || 40) + (conf === 'confident' ? 4 : conf === 'somewhat-sure' ? 2 : 1));
    } else {
      mastery.wrong += 1;
      mastery.mastery = Math.max(0, mastery.mastery - (question.difficulty === 'hard' ? 7 : question.difficulty === 'medium' ? 6 : 5) - (conf === 'confident' ? 2 : 0));
      mastery.confidence = Math.max(0, (mastery.confidence || 40) - (conf === 'confident' ? 5 : 2));
    }

    const variance = mastery.recent.filter(x => x === 1).length / Math.max(1, mastery.recent.length);
    mastery.stability = Math.max(0, Math.min(100, Math.round(variance * 100)));
    mastery.weak = mastery.mastery < 45 || mastery.confidence < 35;

    state.quizState[profileId].mastery[question.topic_id] = mastery;
    session.answers.push({ questionId, answer, confidence: conf, isCorrect, answeredAt: new Date().toISOString(), question_type: question.question_type, score: grading.score });
    session.currentIndex += 1;
    if (session.currentIndex >= session.questionIds.length) {
      session.completed = true;
      updateQuizStreak(profileId);
      const correctCount = session.answers.filter(a => a.isCorrect).length;
      recordPlay('mba-mastery-quiz', Math.round((correctCount / Math.max(1, session.questionIds.length)) * 100), session.questionIds.length * 12);
      const stats = state.quizState[profileId].modeStats || {};
      stats[session.mode] = stats[session.mode] || { plays: 0, avgScore: 0 };
      stats[session.mode].plays += 1;
      stats[session.mode].avgScore = Math.round((((stats[session.mode].avgScore || 0) * (stats[session.mode].plays - 1)) + Math.round((correctCount / Math.max(1, session.questionIds.length)) * 100)) / stats[session.mode].plays);
      state.quizState[profileId].modeStats = stats;
    }
    state.quizState[profileId].attempts.push({ sessionId, questionId, topic_id: question.topic_id, isCorrect, confidence: conf, question_type: question.question_type, answeredAt: new Date().toISOString(), score: grading.score });
    save(state);
    return {
      question,
      isCorrect,
      explanation: question.explanation,
      correctAnswer: question.correct_answer,
      completed: session.completed,
      nextIndex: session.currentIndex,
      mastery: JSON.parse(JSON.stringify(mastery)),
      grading,
    };
  }

  function gradeQuizAnswer(question, answer) {
    const rawAnswer = String(answer || '').trim();
    const normalizedAnswer = normalizeText(rawAnswer);
    const normalizedCorrect = normalizeText(question.correct_answer || '');

    if (!rawAnswer) return { isCorrect: false, score: 0, reason: 'empty' };

    if (question.question_type === 'mcq' || question.question_type === 'true_false') {
      const ok = normalizedAnswer === normalizedCorrect;
      return { isCorrect: ok, score: ok ? 1 : 0, reason: ok ? 'exact' : 'wrong-choice' };
    }

    if (normalizedAnswer === normalizedCorrect) {
      return { isCorrect: true, score: 1, reason: 'exact' };
    }

    const correctTokens = keywordTokens(question.correct_answer || '');
    const answerTokens = keywordTokens(rawAnswer);
    const overlap = tokenOverlap(answerTokens, correctTokens);
    const ratio = correctTokens.length ? overlap / correctTokens.length : 0;

    const ok = ratio >= 0.45 || normalizedCorrect.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedCorrect);
    return {
      isCorrect: ok,
      score: Math.round(ratio * 100) / 100,
      reason: ok ? 'keyword-match' : 'low-overlap',
    };
  }

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function keywordTokens(text) {
    const stop = new Set(['the','a','an','and','or','of','to','in','is','are','that','this','with','for','as','on','it','be','by','from','at','than','not','only']);
    return normalizeText(text).split(' ').filter(t => t && t.length > 2 && !stop.has(t));
  }

  function tokenOverlap(answerTokens, correctTokens) {
    const answerSet = new Set(answerTokens);
    let matched = 0;
    for (const token of correctTokens) {
      if (answerSet.has(token)) matched += 1;
    }
    return matched;
  }

  function updateQuizStreak(profileId) {
    const today = new Date().toISOString().slice(0, 10);
    const qs = state.quizState[profileId];
    if (qs.lastQuizDate === today) return;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    qs.streak = qs.lastQuizDate === yesterday ? (qs.streak || 0) + 1 : 1;
    qs.lastQuizDate = today;
  }

  function getDailyQuiz(profileId, unit) {
    ensureProfileBuckets(profileId);
    const day = new Date().toISOString().slice(0, 10);
    const key = `${day}:${unit || 'unit2'}`;
    const qs = state.quizState[profileId];
    if (!qs.daily[key]) {
      const session = createQuizSession(profileId, { mode: 'daily', unit: unit || 'unit2', count: 8 });
      qs.daily[key] = { sessionId: session.id, createdAt: new Date().toISOString(), unit: unit || 'unit2' };
      save(state);
    }
    return JSON.parse(JSON.stringify(qs.daily[key]));
  }

  function getWeakTopics(profileId, unit) {
    const topics = getQuizTopics(unit).map(t => ({ topic: t, mastery: getTopicMastery(profileId, t.id) }));
    return topics.filter(x => x.mastery.weak || x.mastery.mastery < 50).sort((a, b) => a.mastery.mastery - b.mastery.mastery);
  }

  function getQuizDashboard(profileId, unit) {
    ensureProfileBuckets(profileId);
    const topics = getQuizTopics(unit).map(t => ({ topic: t, mastery: getTopicMastery(profileId, t.id) }));
    const weak = topics.filter(x => x.mastery.weak || x.mastery.mastery < 50).sort((a, b) => a.mastery.mastery - b.mastery.mastery);
    const strong = topics.filter(x => x.mastery.mastery >= 70).sort((a, b) => b.mastery.mastery - a.mastery.mastery);
    const avg = topics.length ? Math.round(topics.reduce((sum, x) => sum + x.mastery.mastery, 0) / topics.length) : 0;
    const attempts = state.quizState[profileId].attempts || [];
    const recentAttempts = attempts.slice(-12);
    const recentAccuracy = recentAttempts.length ? Math.round((recentAttempts.filter(a => a.isCorrect).length / recentAttempts.length) * 100) : 0;
    const typeBreakdown = {};
    recentAttempts.forEach(a => {
      typeBreakdown[a.question_type] = typeBreakdown[a.question_type] || { total: 0, correct: 0 };
      typeBreakdown[a.question_type].total += 1;
      if (a.isCorrect) typeBreakdown[a.question_type].correct += 1;
    });
    return {
      averageMastery: avg,
      weakTopics: weak,
      strongTopics: strong,
      streak: state.quizState[profileId].streak || 0,
      modeStats: JSON.parse(JSON.stringify(state.quizState[profileId].modeStats || {})),
      recentAccuracy,
      recentAttempts: recentAttempts.length,
      typeBreakdown,
    };
  }

  function recordPlay(gameId, score, seconds) {
    const profileId = state.activeProfileId;
    if (!profileId) return;
    ensureProfileBuckets(profileId);
    const cur = state.progress[profileId][gameId] || { plays: 0, bestScore: 0, totalSeconds: 0, lastPlayed: null };
    cur.plays = (cur.plays || 0) + 1;
    cur.bestScore = Math.max(cur.bestScore || 0, Math.round(score));
    cur.totalSeconds = (cur.totalSeconds || 0) + Math.round(seconds || 0);
    cur.lastPlayed = new Date().toISOString();
    state.progress[profileId][gameId] = cur;
    save(state);
  }

  function resetProgress(profileId) {
    if (profileId) {
      state.progress[profileId] = {};
    } else {
      state.progress = {};
    }
    save(state);
  }

  // ---------- Session timing (used inside games) ----------
  let sessionStart = null;
  let sessionGameId = null;

  function startSession(gameId) {
    sessionGameId = gameId;
    sessionStart = Date.now();
  }

  function endSession(score) {
    if (!sessionGameId || sessionStart == null) return;
    const seconds = Math.round((Date.now() - sessionStart) / 1000);
    recordPlay(sessionGameId, score, seconds);
    sessionStart = null;
    sessionGameId = null;
  }

  // ---------- PIN ----------
  function getPin() { return state.parentPin || DEFAULT_PIN; }
  function setPin(p) {
    state.parentPin = String(p || '').slice(0, 8) || DEFAULT_PIN;
    save(state);
  }

  // ---------- Speech (used by games) ----------
  // Picks the best available voice — prefers premium neural/natural voices
  // (e.g. Samantha, Google UK English Female, Microsoft Aria, Siri) over
  // the default robotic eSpeak fallback.
  let _cachedVoice = null;
  let _voicesReady = false;

  // Ranked preference list (highest first). Match is case-insensitive substring.
  const VOICE_PREFERENCES = [
    // Premium / neural tiers
    'samantha',              // macOS / iOS — warm, natural female
    'ava',                   // macOS premium
    'allison',               // macOS premium
    'google uk english female',
    'google us english',
    'microsoft aria',        // Edge neural
    'microsoft jenny',       // Edge neural
    'microsoft guy',         // Edge neural
    'microsoft natasha',
    'natural',               // generic "Natural" label
    'neural',
    'enhanced',
    'premium',
    'siri',
    'karen',                 // macOS AU
    'moira',                 // macOS IE
    'tessa',                 // macOS ZA
    'daniel',                // macOS UK male
    // Language-only fallbacks
    'en-gb',
    'en-us',
  ];

  function pickBestVoice() {
    if (!window.speechSynthesis) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    // Only English voices
    const englishVoices = voices.filter(v => /^en(-|_|$)/i.test(v.lang));
    const pool = englishVoices.length ? englishVoices : voices;

    for (const pref of VOICE_PREFERENCES) {
      const match = pool.find(v =>
        v.name.toLowerCase().includes(pref) ||
        v.lang.toLowerCase().includes(pref)
      );
      if (match) return match;
    }
    // Last resort: first default, or first english
    return pool.find(v => v.default) || pool[0] || voices[0];
  }

  function refreshVoice() {
    _cachedVoice = pickBestVoice();
    _voicesReady = !!_cachedVoice;
  }

  if (window.speechSynthesis) {
    // Chrome loads voices asynchronously — listen for the event
    refreshVoice();
    if (typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', refreshVoice);
    } else {
      window.speechSynthesis.onvoiceschanged = refreshVoice;
    }
  }

  function speak(text, opts) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));

      if (!_voicesReady) refreshVoice();
      if (_cachedVoice) {
        u.voice = _cachedVoice;
        u.lang = _cachedVoice.lang;
      } else {
        u.lang = 'en-US';
      }

      // Slightly slower + natural pitch for kid-friendly clarity.
      // These values sound warm on premium voices and don't cartoonify them.
      u.rate   = (opts && opts.rate)   != null ? opts.rate   : 0.95;
      u.pitch  = (opts && opts.pitch)  != null ? opts.pitch  : 1.0;
      u.volume = (opts && opts.volume) != null ? opts.volume : 1.0;

      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  // ---------- Shared UI Utilities ----------
  window.$ = function(id) { return document.getElementById(id); };
  window.show = function(id) {
    document.querySelectorAll('main > section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(id);
    if (target) target.classList.remove('hidden');
  };
  window.toast = function(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1600);
  };
  window.escapeHtml = function(s) {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  };
  window.initials = function(name) {
    const parts = String(name || '').trim().split(/\s+/);
    const a = parts[0]?.[0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  };
  window.ageLabel = function(g) {
    return AGE_GROUPS[g] ? `${AGE_GROUPS[g].label} (${AGE_GROUPS[g].min}–${AGE_GROUPS[g].max})` : g;
  };

  // ---------- Public API ----------
  window.Hub = {
    GAMES,
    AGE_GROUPS,
    QUIZ_BANK,
    // profiles
    getProfiles, addProfile, updateProfile, removeProfile,
    setActiveProfile, getActiveProfile,
    // settings
    isGameEnabled, setGameEnabled,
    // per-game config
    getGameConfig, setGameConfig,
    // progress
    getProgress, recordPlay, resetProgress,
    // session
    startSession, endSession,
    // quiz
    getQuizState, getTopicMastery, getQuizTopics, getQuizQuestions,
    createQuizSession, getQuizSession, getQuizQuestionById, answerQuizQuestion, getDailyQuiz, getWeakTopics, getQuizDashboard,
    // pin
    getPin, setPin,
    // util
    speak,
    // remote sync
    setRemoteUser, loadRemoteState, syncRemoteState, getRemoteSyncMeta, onSyncStatus, getEndpointLabel,
    whenReady: () => initPromise || Promise.resolve(state),
    // raw state for the parent dashboard (read-only copy)
    debugState: () => JSON.parse(JSON.stringify(state)),
  };
})();
