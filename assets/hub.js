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
    // pin
    getPin, setPin,
    // util
    speak,
    // raw state for the parent dashboard (read-only copy)
    debugState: () => JSON.parse(JSON.stringify(state)),
  };
})();
