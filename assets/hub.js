/* ============================================================
 * GameHub – shared data layer and game registry
 * Stores profiles, settings, and progress in localStorage.
 * Exposes a global `Hub` object used by index, parent, and games.
 * ========================================================== */
(function () {
  'use strict';

  const STORAGE_KEY = 'gamehub.v1';
  const DEFAULT_PIN = '1234';

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
      ageGroups: ['early-elem'],
      path: 'games/mba-mastery-quiz.html',
      accent: '#6c5ce7',
    },
  ];

  const AGE_GROUPS = {
    toddler: { label: 'Toddler', min: 2, max: 4 },
    'early-elem': { label: 'Early Elementary', min: 5, max: 7 },
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
    } catch (e) {
      console.error('GameHub: failed to save storage.', e);
    }
  }

  let state = load();

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
    questions: [
      { id: 'U1-T5-Q001', unit: 'unit1', topic_id: 'U1-T5', topic_name: 'Leadership fundamentals', question_type: 'mcq', difficulty: 'easy', prompt: 'Which definition best matches leadership in Unit 1?', options: ['The ability to enforce compliance through punishment', 'The ability to influence people toward shared goals', 'The formal right to allocate budgets', 'The process of monitoring output only'], correct_answer: 'The ability to influence people toward shared goals', explanation: 'Unit 1 treats leadership as influence toward goals, not just authority or control.' },
      { id: 'U1-T5-Q002', unit: 'unit1', topic_id: 'U1-T5', topic_name: 'Leadership fundamentals', question_type: 'mcq', difficulty: 'easy', prompt: 'Which statement best captures the difference between leadership and management in Unit 1?', options: ['Leadership is only informal, while management is only formal', 'Management is mainly about influence, while leadership is mainly about budgeting', 'Management relies more on coordination and formal role, while leadership relies more on influence and commitment', 'There is no meaningful difference between the two'], correct_answer: 'Management relies more on coordination and formal role, while leadership relies more on influence and commitment', explanation: 'Unit 1 distinguishes management from leadership, while also showing they often overlap in practice.' },
      { id: 'U1-T6-Q004', unit: 'unit1', topic_id: 'U1-T6', topic_name: 'Leadership theories and effectiveness', question_type: 'mcq', difficulty: 'medium', prompt: 'Which description best fits transformational leadership?', options: ['Leadership based mainly on exchange, compliance, and routine monitoring', 'Leadership based mainly on vision, inspiration, development, and commitment beyond self-interest', 'Leadership based only on job descriptions and formal procedures', 'Leadership based mainly on fear of penalties'], correct_answer: 'Leadership based mainly on vision, inspiration, development, and commitment beyond self-interest', explanation: 'Transformational leadership emphasizes vision, higher commitment, and follower development.' },
      { id: 'U1-T6-Q005', unit: 'unit1', topic_id: 'U1-T6', topic_name: 'Leadership theories and effectiveness', question_type: 'mcq', difficulty: 'medium', prompt: 'Which feature is most characteristic of transactional leadership?', options: ['Shared meaning and inspiration beyond self-interest', 'Exchange relationships, compliance, and role-based expectations', 'Total rejection of formal authority', 'Leadership through ambiguity and spontaneity'], correct_answer: 'Exchange relationships, compliance, and role-based expectations', explanation: 'Transactional leadership is more strongly tied to exchange and formal performance expectations.' },
      { id: 'U2-T4-Q001', unit: 'unit2', topic_id: 'U2-T4', topic_name: '7-S and expanded 7-S alignment diagnostics', question_type: 'mcq', difficulty: 'easy', prompt: 'Which of the following is a hard element in the basic 7-S framework?', options: ['Shared values', 'Style', 'Structure', 'Staff'], correct_answer: 'Structure', explanation: 'The hard elements are strategy, structure, and systems.' },
      { id: 'U2-T4-Q004', unit: 'unit2', topic_id: 'U2-T4', topic_name: '7-S and expanded 7-S alignment diagnostics', question_type: 'mcq', difficulty: 'medium', prompt: 'What is the best distinction between superordinate goals and shared values in the expanded 7-S perspective?', options: ['Superordinate goals are enduring beliefs, while shared values are financial targets', 'Superordinate goals concern future aspiration, while shared values concern enduring beliefs and principles', 'They are exactly the same concept with different labels', 'Shared values are external, while superordinate goals are internal'], correct_answer: 'Superordinate goals concern future aspiration, while shared values concern enduring beliefs and principles', explanation: 'Unit 2 treats one as where the organization is trying to go and the other as what it stands for.' },
      { id: 'U2-T7-Q001', unit: 'unit2', topic_id: 'U2-T7', topic_name: 'Diversity and inclusion', question_type: 'mcq', difficulty: 'easy', prompt: 'What does diversity in organizations primarily refer to?', options: ['Making everyone think the same way', 'Differences among people in a workforce', 'Having no conflict at work', 'Reducing all jobs to one standard design'], correct_answer: 'Differences among people in a workforce', explanation: 'Diversity refers to differences among people, not automatic harmony or uniformity.' },
      { id: 'U2-T7-Q002', unit: 'unit2', topic_id: 'U2-T7', topic_name: 'Diversity and inclusion', question_type: 'mcq', difficulty: 'easy', prompt: 'Which statement best describes inclusion?', options: ['Having demographic variety only', 'Ensuring people feel valued, heard, and able to participate fully', 'Avoiding every disagreement in teams', 'Giving all employees identical backgrounds'], correct_answer: 'Ensuring people feel valued, heard, and able to participate fully', explanation: 'Inclusion concerns whether difference is respected and integrated into real participation.' },
      { id: 'U2-T7-Q006', unit: 'unit2', topic_id: 'U2-T7', topic_name: 'Diversity and inclusion', question_type: 'mcq', difficulty: 'medium', prompt: 'Which is the strongest Unit 2 claim about diversity in organizations?', options: ['Diversity automatically improves performance with no management effort', 'Diversity is always harmful to team cohesion', 'Diversity can create value, but outcomes depend on how it is managed and whether inclusion is present', 'Diversity matters only in global firms'], correct_answer: 'Diversity can create value, but outcomes depend on how it is managed and whether inclusion is present', explanation: 'Unit 2 treats diversity as potentially valuable but not self-executing.' },
      { id: 'U2-T9-Q001', unit: 'unit2', topic_id: 'U2-T9', topic_name: 'Stress, role pressure, and well-being', question_type: 'mcq', difficulty: 'easy', prompt: 'In Unit 2, stress is best understood as:', options: ['any form of hard work', 'a response to demands or pressures that can affect well-being and performance', 'a synonym for laziness', 'something caused only by personal weakness'], correct_answer: 'a response to demands or pressures that can affect well-being and performance', explanation: 'Unit 2 treats stress as a real organizational and human issue, not a character flaw.' },
      { id: 'U2-T9-Q002', unit: 'unit2', topic_id: 'U2-T9', topic_name: 'Stress, role pressure, and well-being', question_type: 'mcq', difficulty: 'easy', prompt: 'Which distinction is correct?', options: ['Stressors are outcomes, while strain is the demand causing them', 'Stressors are demands or pressures, while strain is the reaction or effect', 'Stressors and strain mean exactly the same thing', 'Strain only exists outside work'], correct_answer: 'Stressors are demands or pressures, while strain is the reaction or effect', explanation: 'This distinction matters because the source of pressure is not the same as the human response to it.' }
    ]
  };

  function getQuizState(profileId) {
    if (!profileId) return defaultQuizState();
    ensureProfileBuckets(profileId);
    return JSON.parse(JSON.stringify(state.quizState[profileId]));
  }

  function getTopicMastery(profileId, topicId) {
    ensureProfileBuckets(profileId);
    const qs = state.quizState[profileId];
    if (!qs.mastery[topicId]) {
      qs.mastery[topicId] = { mastery: 50, correct: 0, wrong: 0, seen: 0, lastSeen: null };
      save(state);
    }
    return JSON.parse(JSON.stringify(qs.mastery[topicId]));
  }

  function getQuizTopics(unit) {
    if (unit) return (QUIZ_BANK.units[unit]?.topics || []).slice();
    return Object.values(QUIZ_BANK.units).flatMap(u => u.topics);
  }

  function getQuizQuestions(filters) {
    let questions = QUIZ_BANK.questions.slice();
    if (filters?.unit) questions = questions.filter(q => q.unit === filters.unit);
    if (filters?.topic_id) questions = questions.filter(q => q.topic_id === filters.topic_id);
    return questions;
  }

  function chooseQuestions(profileId, opts) {
    const count = Math.max(1, Math.min(20, Number(opts?.count || 8)));
    const unit = opts?.unit || 'unit2';
    const topicId = opts?.topic_id || null;
    const mode = opts?.mode || 'daily';
    const pool = getQuizQuestions({ unit, topic_id: topicId });
    const shuffled = pool
      .map(q => ({ q, sort: Math.random() + questionPriority(profileId, q, mode) }))
      .sort((a, b) => b.sort - a.sort)
      .map(x => x.q);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  function questionPriority(profileId, question, mode) {
    const mastery = getTopicMastery(profileId, question.topic_id);
    const weaknessBoost = (100 - mastery.mastery) / 100;
    const base = mode === 'daily' ? 0.35 : 0.2;
    return base + weaknessBoost;
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
    const isCorrect = String(answer).trim() === String(question.correct_answer).trim();
    const mastery = state.quizState[profileId].mastery[question.topic_id] || { mastery: 50, correct: 0, wrong: 0, seen: 0, lastSeen: null };
    mastery.seen += 1;
    mastery.lastSeen = new Date().toISOString();
    if (isCorrect) {
      mastery.correct += 1;
      mastery.mastery = Math.min(100, mastery.mastery + (confidence === 'confident' ? 6 : 5));
    } else {
      mastery.wrong += 1;
      mastery.mastery = Math.max(0, mastery.mastery - (confidence === 'confident' ? 8 : 6));
    }
    state.quizState[profileId].mastery[question.topic_id] = mastery;
    session.answers.push({ questionId, answer, confidence: confidence || null, isCorrect, answeredAt: new Date().toISOString() });
    session.currentIndex += 1;
    if (session.currentIndex >= session.questionIds.length) {
      session.completed = true;
      updateQuizStreak(profileId);
      const correctCount = session.answers.filter(a => a.isCorrect).length;
      recordPlay('mba-mastery-quiz', Math.round((correctCount / Math.max(1, session.questionIds.length)) * 100), session.questionIds.length * 12);
    }
    state.quizState[profileId].attempts.push({ sessionId, questionId, topic_id: question.topic_id, isCorrect, confidence: confidence || null, answeredAt: new Date().toISOString() });
    save(state);
    return {
      question,
      isCorrect,
      explanation: question.explanation,
      correctAnswer: question.correct_answer,
      completed: session.completed,
      nextIndex: session.currentIndex,
      mastery: JSON.parse(JSON.stringify(mastery)),
    };
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
      const session = createQuizSession(profileId, { mode: 'daily', unit: unit || 'unit2', count: 6 });
      qs.daily[key] = { sessionId: session.id, createdAt: new Date().toISOString(), unit: unit || 'unit2' };
      save(state);
    }
    return JSON.parse(JSON.stringify(qs.daily[key]));
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
    createQuizSession, getQuizSession, getQuizQuestionById, answerQuizQuestion, getDailyQuiz,
    // pin
    getPin, setPin,
    // util
    speak,
    // raw state for the parent dashboard (read-only copy)
    debugState: () => JSON.parse(JSON.stringify(state)),
  };
})();
