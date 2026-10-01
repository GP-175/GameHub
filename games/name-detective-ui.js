(() => {
  'use strict';
  const m = window.NameDetective;
  const app = document.getElementById('app');
  let session = null;
  let narration = '';
  let audioFailed = false;
  function button(id, text, secondary = false) { return `<button id="${id}" class="${secondary ? 'secondary' : ''}">${text}</button>`; }
  function voice() { return `<div class="row">${button('read', '🔊 Read aloud / replay', true)}</div><p id="voice-status" role="status" class="note">${audioFailed || !window.speechSynthesis || !window.SpeechSynthesisUtterance ? 'Read aloud is unavailable. Please ask an adult to read the words.' : 'Tap Read aloud to listen. If you cannot hear it, ask an adult to read.'}</p>`; }
  function read() {
    const status = document.getElementById('voice-status');
    const fallback = () => { audioFailed = true; status.textContent = 'Read aloud is unavailable. Please ask an adult to read the words.'; };
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { fallback(); return; }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(narration); utterance.lang = 'en-GB'; utterance.rate = .85;
      utterance.onerror = event => { if (!['canceled','interrupted'].includes(event.error)) fallback(); };
      window.speechSynthesis.speak(utterance);
    } catch { fallback(); }
  }
  function stopReading() { try { window.speechSynthesis?.cancel(); } catch { /* Visible adult fallback remains available. */ } }
  function renderSummary() {
    stopReading();
    const report = m.summary(session);
    const ratio = bucket => `${bucket.correct} / ${bucket.total}`;
    narration = 'Detective work complete! Show your adult the results. A proper noun names one particular person, place, animal or thing and starts with a capital. Tell your adult a new example and why it needs a capital.';
    const rows = report.records.map(r => {
      const q = [...m.practice, ...m.checks].find(item => item.word === r.word);
      return `<li><strong>${r.word}</strong> — ${r.skipped ? 'skipped' : `${r.choice}, ${r.correct ? 'correct' : 'not yet correct'}`} (${r.assisted ? 'assisted' : r.hinted ? 'hinted' : 'first attempt'}${r.hinted && r.assisted ? ', hint used' : ''}). ${q.explanation}</li>`;
    }).join('');
    app.innerHTML = `<h2 tabindex="-1">Detective work complete!</h2><p>You practised thinking about names. Take a rest or show your adult.</p>${voice()}<section id="report" aria-label="Parent summary"><h3>Parent summary</h3><p>Mode: ${session.mode === 'guided' ? 'guided — adult assistance selected' : 'independent — help marked explicitly'}</p><ul><li>Practice, first attempt without hints/help: <strong>${ratio(report.practice.first)}</strong> correct</li><li>Practice, hinted without adult help: <strong>${ratio(report.practice.hinted)}</strong> correct</li><li>Practice, assisted (including skips): <strong>${ratio(report.practice.assisted)}</strong> correct</li><li>Fresh check, independent: <strong>${ratio(report.check.independent)}</strong> correct</li><li>Fresh check, assisted: <strong>${report.check.assisted}</strong>; skipped: <strong>${report.check.skipped}</strong> (included in assisted)</li></ul><p>These are this session’s responses, not a mastery claim. Replay uses the same examples and is not a fresh assessment.</p><h3>Answer review</h3><ol>${rows}</ol><h3>Next step with an adult</h3><p>Ask for a new common noun and a new proper noun: “Why does that name need a capital?” Ask again on another day. Review names versus general words if there were errors, hints or help. No explanation or later recall has been assessed here.</p></section><div class="row">${button('restart','Play again',true)}</div>`;
    document.getElementById('read').onclick = read;
    document.getElementById('restart').onclick = () => { session = null; renderDemo(); };
    app.querySelector('h2').focus();
  }
  function renderRound() {
    stopReading();
    if (session.phase === 'summary') { renderSummary(); return; }
    const checking = session.phase === 'check';
    const q = m.current(session);
    const capital = q.type === 'capital';
    const title = checking ? `Fresh check ${session.index + 1} of 3` : `Practice ${session.index + 1} of 4`;
    narration = `${title}. ${checking ? 'No hints this time. You can ask for help or skip.' : ''} ${capital ? 'Which spelling starts with the capital letter needed for the day Tuesday?' : `${q.word}. Is it a common noun, a general name, or a proper noun, a particular name?`}`;
    app.innerHTML = `<h2 tabindex="-1">${title}</h2><p>${session.mode === 'guided' ? 'Guided with an adult' : 'Trying on my own'}</p><p>${checking ? 'No hints this time. We will look at answers after all three checks.' : 'Is this a general name or a particular name?'}</p>${capital ? '<p>Choose the spelling for the day’s name.</p>' : `<span class="word">${q.word}</span>`}<div class="choices">${capital ? button('choice-lower','tuesday') + button('choice-capital','Tuesday') : button('choice-common','Common noun<small>General name</small>') + button('choice-proper','Proper noun<small>Particular name</small>')}</div><div id="feedback" role="status" aria-live="polite"></div>${voice()}<div class="row">${checking ? '' : button('hint','Give me a hint',true)}${button('assist','Adult helped',true)}${button('skip','Skip / take a break',true)}</div>`;
    app.querySelector('h2').focus();
    document.getElementById('read').onclick = read;
    function finish(record) {
      if (!record) return;
      stopReading();
      app.querySelectorAll('button:not(#read)').forEach(b => { b.disabled = true; });
      const text = checking ? (record.skipped ? 'Skipped safely. This is marked assisted, not independent.' : 'Answer saved for this check. Thank you for trying.') : `${record.skipped ? 'We can leave this one.' : record.correct ? 'You found it!' : 'Let’s learn this one.'} ${q.explanation}`;
      const feedback = document.getElementById('feedback'); feedback.className = 'feedback'; feedback.textContent = text;
      narration = text;
      feedback.insertAdjacentHTML('afterend', `<div class="row">${button('next', 'Next clue →')}</div>`);
      document.getElementById('next').onclick = () => { m.next(session); renderRound(); };
    }
    const options = capital ? [['lower','tuesday'],['capital','Tuesday']] : [['common','common'],['proper','proper']];
    for (const [id, choice] of options) document.getElementById(`choice-${id}`).onclick = () => finish(m.answer(session, choice));
    if (!checking) document.getElementById('hint').onclick = () => { m.hint(session); document.getElementById('feedback').textContent = q.clue; narration += ` Hint: ${q.clue}`; };
    document.getElementById('assist').onclick = () => { m.assist(session); document.getElementById('assist').textContent = 'Adult help marked'; document.getElementById('assist').disabled = true; };
    document.getElementById('skip').onclick = () => { m.skip(session); finish(session.records.at(-1)); };
  }
  function renderDemo() {
    stopReading();
    narration = 'A noun names a person, place, animal or thing. A common noun is a general name, like cat. A proper noun is a particular name, like Luna, one cat’s name. Proper nouns start with capital letters. Common nouns can also start with a capital at the beginning of a sentence. Choose try on my own, or with an adult.';
    app.innerHTML = `<h2 tabindex="-1">Your detective lesson</h2><p>A <strong>noun</strong> names a person, place, animal or thing.</p><div class="choices"><div><span class="word">cat</span><strong>Common noun</strong><p>A general name. Many animals are cats.</p></div><div><span class="word">Luna</span><strong>Proper noun</strong><p>One cat’s particular name. It starts with capital <strong>L</strong>.</p></div></div><p>Proper nouns start with capitals. A common noun can also have a capital at the start of a sentence — think about its meaning!</p><p>Watch: “Luna” → <strong>Proper noun</strong>. It names one particular cat.</p><p>Four practice clues, then three fresh checks. No timer. Take a break whenever you like.</p>${voice()}<div class="row">${button('independent','Try on my own')}${button('guided','With an adult',true)}</div><p class="note">With an adult means guided/assisted answers, not independent evidence. An adult may read the exact words without giving an answer; use “Adult helped” if they give clues.</p>`;
    document.getElementById('read').onclick = read;
    for (const mode of ['independent','guided']) document.getElementById(mode).onclick = () => { session = m.createSession(mode); m.begin(session); renderRound(); };
  }
  renderDemo();
})();
