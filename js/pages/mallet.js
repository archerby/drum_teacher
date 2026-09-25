window.Pages = window.Pages || {};

/*
 * Металлофон: уроки, мелодии с подсветкой пластин и свободная игра.
 * Режимы мелодии: «Слушать», «Ждать меня» (идём дальше только после верной пластины),
 * «В темпе» (играете под метроном, каждая нота оценивается).
 */
Pages.mallet = (() => {
  const el = document.getElementById('page-mallet');
  const transport = new Transport();
  const M = window.MALLET;
  const LO = M.BASE_MIDI; // до¹
  const HI = LO + 24; // до³
  const LETTERS = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

  const st = {
    view: 'lessons',
    lesson: MALLET_LESSONS[0].id,
    mid: 'koster',
    mode: Store.get('ml.mode', 'listen'),
    click: true,
    guide: true,
    countIn: true,
    layout: Store.get('ml.layout', 'diatonic'),
    names: Store.get('ml.names', 'ru'),
  };
  let melody = null; // {id, name, beats, bpm, pickup, notes, events, custom}
  let bpmCtl = null;
  let editing = false;
  let recording = false;
  let recDur = 1;
  let waitIdx = 0;
  let waitErrors = 0;
  let targets = [];
  let score = { hit: 0, off: 0, wrong: 0, miss: 0 };
  let chipEls = [];
  let listOpen = false;

  // ───────── Ноты ─────────
  function parse(text) {
    const events = [];
    const errors = [];
    let beat = 0;
    let barNext = false;
    String(text || '').replace(/\|/g, ' | ').split(/\s+/).filter(Boolean).forEach((tok) => {
      if (tok === '|') { barNext = true; return; }
      const m = tok.match(/^([a-g])(#?)([1-3])(?::([\d.]+)(?:\/([\d.]+))?)?$/i) || tok.match(/^(-)()()(?::([\d.]+)(?:\/([\d.]+))?)?$/);
      if (!m) { errors.push(tok); return; }
      let dur = m[4] ? parseFloat(m[4]) : 1;
      if (m[5]) dur /= parseFloat(m[5]);
      if (!(dur > 0) || dur > 16) { errors.push(tok); return; }
      dur = Math.round(dur * 4) / 4 || 0.25;
      let midi = null;
      if (m[1] !== '-') {
        midi = LO + (+m[3] - 1) * 12 + M.SEMI[m[1].toLowerCase()] + (m[2] ? 1 : 0);
        if (midi < LO || midi > HI) { errors.push(tok); return; }
      }
      events.push({ midi, dur, start: beat, bar: barNext });
      barNext = false;
      beat += dur;
    });
    return { events, errors, total: beat };
  }

  function tokenOf(midi, dur) {
    const d = dur === 1 ? '' : `:${+dur.toFixed(2)}`;
    if (midi === null) return `-${d}`;
    const rel = midi - LO;
    return `${LETTERS[rel % 12]}${Math.floor(rel / 12) + 1}${d}`;
  }

  function label(midi) {
    const rel = midi - LO;
    const letter = LETTERS[rel % 12];
    const base = letter[0];
    const sharp = letter.length > 1;
    const oct = Math.floor(rel / 12) + 1;
    const name = st.names === 'ru' ? M.RU[base] : base.toUpperCase();
    return { base, sharp, oct, text: `${name}${sharp ? '♯' : ''}`, cls: sharp ? 'nc-sharp' : `nc-${base}` };
  }

  const SUP = { 1: '¹', 2: '²', 3: '³' };

  // ───────── Каркас ─────────
  el.innerHTML = `
    <div class="ml">
      <header class="tr-head">
        <div>
          <div class="eyebrow">металлофон · две октавы</div>
          <h1 class="tr-title">Металлофон</h1>
        </div>
        <div class="seg" id="ml-views">
          <button data-view="lessons">Уроки</button>
          <button data-view="melody">Мелодии</button>
          <button data-view="free">Свободно</button>
        </div>
      </header>

      <section id="ml-lessons"></section>

      <section id="ml-melody" hidden>
        <div class="card ml-player">
          <div class="ml-top">
            <label class="ml-pick"><span class="eyebrow">мелодия</span><select id="ml-select"></select></label>
            <div class="tr-tgroup">
              <button class="tbtn" id="ml-new">＋ Новая</button>
              <button class="tbtn" id="ml-edit">✎ Изменить</button>
            </div>
          </div>
          <p class="tr-note" id="ml-desc"></p>
          <p class="ml-warn" id="ml-warn" hidden></p>
          <div class="seg ml-modes" id="ml-modes" role="radiogroup" aria-label="Режим">
            <button data-mode="listen">👂 Слушать</button>
            <button data-mode="wait">⏸ Ждать меня</button>
            <button data-mode="along">🎯 В темпе</button>
          </div>
          <div class="controls dock" id="ml-dock">
            <button class="btn play" id="ml-play">▶ Играть</button>
            <span id="ml-bpm"></span>
          </div>
          <div class="controls options" id="ml-opts">
            <label class="toggle"><input type="checkbox" id="ml-click" checked> Щелчок</label>
            <label class="toggle"><input type="checkbox" id="ml-count" checked> Отсчёт</label>
            <label class="toggle" id="ml-guide-l"><input type="checkbox" id="ml-guide" checked> Подсказка звуком</label>
          </div>
          <div class="ml-ribbon-wrap"><div class="ml-ribbon" id="ml-ribbon"></div></div>
          <div class="ml-stats" id="ml-stats" aria-live="polite"></div>
          <div class="edit-panel" id="ml-editor" hidden></div>
        </div>
      </section>

      <section id="ml-free" hidden>
        <div class="card">
          <div class="eyebrow">свободная игра</div>
          <p class="tr-note">Стучите по пластинам — пальцем или клавишами. Подбирайте мелодии по слуху: услышали — нашли пластину — запомнили.</p>
          <p class="tr-note ml-keys">Клавиатура: нижняя октава <kbd>Z</kbd><kbd>X</kbd><kbd>C</kbd><kbd>V</kbd><kbd>B</kbd><kbd>N</kbd><kbd>M</kbd>, верхняя <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><kbd>G</kbd><kbd>H</kbd><kbd>J</kbd>, верхнее «до» <kbd>K</kbd>. С <kbd>Shift</kbd> — диез.</p>
        </div>
      </section>

      <div class="card ml-inst-card">
        <div class="ml-inst-head">
          <div class="seg" id="ml-layout">
            <button data-layout="diatonic">Один ряд</button>
            <button data-layout="chromatic">С диезами</button>
          </div>
          <div class="seg" id="ml-names">
            <button data-names="ru">до ре ми</button>
            <button data-names="en">C D E</button>
          </div>
        </div>
        <div class="ml-inst" id="ml-inst"></div>
        <p class="eyebrow center ml-rotate">на телефоне удобнее горизонтально</p>
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);

  bpmCtl = UI.bpmControl({
    value: 72, min: 30, max: 200,
    onChange: (v) => { transport.bpm = v; if (melody) melody.bpmNow = v; },
  });
  $('#ml-bpm').appendChild(bpmCtl.el);

  // ───────── Инструмент ─────────
  function renderInstrument() {
    const box = $('#ml-inst');
    const naturals = [];
    const sharps = [];
    for (let m = LO; m <= HI; m++) (LETTERS[(m - LO) % 12].length > 1 ? sharps : naturals).push(m);
    const n = naturals.length;
    const w = 100 / n;
    let html = '<div class="ml-naturals">';
    naturals.forEach((m, i) => {
      const lb = label(m);
      const h = 100 - (i / (n - 1)) * 38; // длинные — низкие
      html += `<button class="ml-bar ${lb.cls}" data-midi="${m}" style="height:${h}%" aria-label="${lb.text} ${lb.oct} октавы"><span>${lb.text}</span><small>${lb.oct}</small></button>`;
    });
    html += '</div>';
    if (st.layout === 'chromatic') {
      html += '<div class="ml-sharps">';
      sharps.forEach((m) => {
        const lower = naturals.indexOf(m - 1);
        const lb = label(m);
        const h = 100 - (lower / (n - 1)) * 38;
        html += `<button class="ml-bar nc-sharp" data-midi="${m}" style="left:calc(${(lower + 1) * w}% - ${w * 0.36}%);width:${w * 0.72}%;height:${h}%" aria-label="${lb.text} ${lb.oct} октавы"><span>${lb.text}</span></button>`;
      });
      html += '</div>';
    }
    box.className = `ml-inst ${st.layout}`;
    box.innerHTML = html;
    el.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('sel', b.dataset.layout === st.layout));
    el.querySelectorAll('[data-names]').forEach((b) => b.classList.toggle('sel', b.dataset.names === st.names));
  }

  function barEl(midi) { return $(`#ml-inst [data-midi="${midi}"]`); }

  function flashBar(midi, cls, ms = 220) {
    const b = barEl(midi);
    if (!b) return;
    b.classList.remove(cls);
    void b.offsetWidth;
    b.classList.add(cls);
    clearTimeout(b['_t' + cls]);
    b['_t' + cls] = setTimeout(() => b.classList.remove(cls), ms);
  }

  function setNext(midi) {
    el.querySelectorAll('#ml-inst .next').forEach((b) => b.classList.remove('next'));
    if (midi !== null && midi !== undefined) { const b = barEl(midi); if (b) b.classList.add('next'); }
  }

  $('#ml-inst').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-midi]');
    if (!b) return;
    e.preventDefault();
    tap(+b.dataset.midi, e);
  });

  const KEYMAP = { KeyZ: 0, KeyX: 2, KeyC: 4, KeyV: 5, KeyB: 7, KeyN: 9, KeyM: 11, KeyA: 12, KeyS: 14, KeyD: 16, KeyF: 17, KeyG: 19, KeyH: 21, KeyJ: 23, KeyK: 24 };
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('active') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (!(e.code in KEYMAP)) return;
    let midi = LO + KEYMAP[e.code] + (e.shiftKey ? 1 : 0);
    if (midi > HI) midi = HI;
    e.preventDefault();
    tap(midi, e);
  });

  el.querySelector('#ml-layout').addEventListener('click', (e) => {
    const b = e.target.closest('[data-layout]');
    if (!b) return;
    st.layout = b.dataset.layout;
    Store.set('ml.layout', st.layout);
    renderInstrument();
    if (melody) renderWarn();
    if (st.view === 'melody' && st.mode === 'wait') showWaitTarget();
  });
  el.querySelector('#ml-names').addEventListener('click', (e) => {
    const b = e.target.closest('[data-names]');
    if (!b) return;
    st.names = b.dataset.names;
    Store.set('ml.names', st.names);
    renderInstrument();
    if (melody) renderRibbon();
  });

  // ───────── Удар по пластине ─────────
  function tap(midi, ev) {
    Sound.bar(midi);
    flashBar(midi, 'hit');
    if (st.view !== 'melody' || !melody) return;
    if (editing && recording) { recordNote(midi); return; }
    if (st.mode === 'wait') waitTap(midi);
    else if (st.mode === 'along' && transport.playing) alongTap(midi, Sound.eventTime(ev));
  }

  // ───────── Мелодии ─────────
  function customs() { return Store.get('ml.custom', []); }
  function allMelodies() { return [...MELODIES, ...customs().map((c) => ({ ...c, cat: 'Мои мелодии', custom: true }))]; }
  function findMelody(id) { return allMelodies().find((m) => m.id === id); }

  function renderSelect() {
    const all = allMelodies();
    const cats = [...new Set(all.map((m) => m.cat))];
    $('#ml-select').innerHTML = cats.map((c) => `<optgroup label="${UI.esc(c)}">${all.filter((m) => m.cat === c).map((m) => `<option value="${m.id}" ${melody && m.id === melody.id ? 'selected' : ''}>${UI.esc(m.name)}</option>`).join('')}</optgroup>`).join('');
  }

  function loadMelody(id) {
    transport.stop();
    const src = findMelody(id) || MELODIES[0];
    st.mid = src.id;
    melody = { ...src };
    const p = parse(melody.notes);
    melody.events = p.events;
    melody.total = p.total;
    melody.pickup = melody.pickup || 0;
    bpmCtl.set(melody.bpm || 80, false);
    transport.bpm = bpmCtl.value;
    editing = false;
    recording = false;
    renderSelect();
    renderMelody();
  }

  function hasSharps() {
    return melody && melody.events.some((e) => e.midi !== null && LETTERS[(e.midi - LO) % 12].length > 1);
  }

  function renderWarn() {
    const w = $('#ml-warn');
    const need = st.layout === 'diatonic' && hasSharps();
    w.hidden = !need;
    if (need) w.innerHTML = 'В мелодии есть диезы — «чёрные» пластины верхнего ряда. <button class="tbtn" id="ml-warn-on">Включить диезы</button> или транспонируйте мелодию в редакторе.';
  }

  $('#ml-warn').addEventListener('click', (e) => {
    if (!e.target.closest('#ml-warn-on')) return;
    st.layout = 'chromatic';
    Store.set('ml.layout', st.layout);
    renderInstrument();
    renderWarn();
    if (st.mode === 'wait') showWaitTarget();
  });

  function renderMelody() {
    $('#ml-desc').textContent = melody.desc || (melody.custom ? 'Ваша мелодия. Хранится только на этом устройстве.' : '');
    renderWarn();
    $('#ml-edit').textContent = melody.custom ? '✎ Изменить' : '✎ Копия для правки';
    el.querySelectorAll('[data-mode]').forEach((b) => {
      b.classList.toggle('sel', b.dataset.mode === st.mode);
      b.setAttribute('aria-checked', b.dataset.mode === st.mode);
    });
    $('#ml-guide-l').hidden = st.mode !== 'along';
    $('#ml-dock').hidden = st.mode === 'wait';
    $('#ml-opts').hidden = st.mode === 'wait';
    $('#ml-editor').hidden = !editing;
    if (editing) renderEditor();
    renderRibbon();
    resetScore();
    if (st.mode === 'wait') startWait();
    else setNext(null);
  }

  function renderRibbon() {
    const ev = melody.events;
    let hand = 0;
    $('#ml-ribbon').innerHTML = ev.length ? ev.map((e, i) => {
      const w = `style="--d:${e.dur}"`;
      const bar = e.bar ? '<i class="ml-barline" aria-hidden="true"></i>' : '';
      if (e.midi === null) return `${bar}<button class="ml-chip rest" data-i="${i}" ${w} title="пауза">𝄽</button>`;
      const lb = label(e.midi);
      const h = hand++ % 2 ? 'L' : 'R';
      return `${bar}<button class="ml-chip ${lb.cls}" data-i="${i}" ${w}><b>${lb.text}<sup>${SUP[lb.oct]}</sup></b><small>${h}</small></button>`;
    }).join('') : '<p class="muted">Пока пусто — включите «Запись» и стучите по пластинам.</p>';
    chipEls = [...el.querySelectorAll('#ml-ribbon .ml-chip')];
  }

  function markChip(i, cls, on = true) {
    const c = chipEls[i];
    if (c) c.classList.toggle(cls, on);
  }

  function scrollToChip(i) {
    const c = chipEls[i];
    const wrap = $('.ml-ribbon-wrap');
    if (!c || !wrap) return;
    const x = c.offsetLeft - wrap.offsetLeft;
    if (x < wrap.scrollLeft + 20 || x > wrap.scrollLeft + wrap.clientWidth - 80) wrap.scrollTo({ left: x - 40, behavior: 'smooth' });
  }

  $('#ml-ribbon').addEventListener('click', (e) => {
    const c = e.target.closest('.ml-chip');
    if (!c) return;
    const i = +c.dataset.i;
    const ev = melody.events[i];
    if (st.mode === 'wait') { waitIdx = i; showWaitTarget(); return; }
    if (ev.midi !== null && !transport.playing) { Sound.bar(ev.midi); flashBar(ev.midi, 'lit', 400); }
  });

  // ───────── Режим «Ждать меня» ─────────
  function nextNoteIdx(i) {
    while (i < melody.events.length && melody.events[i].midi === null) i++;
    return i;
  }

  function startWait() {
    transport.stop();
    waitIdx = nextNoteIdx(0);
    waitErrors = 0;
    chipEls.forEach((c) => c.classList.remove('ok', 'cur', 'bad', 'hit', 'off', 'miss', 'wrong'));
    showWaitTarget();
  }

  function showWaitTarget() {
    chipEls.forEach((c) => c.classList.remove('cur'));
    const ev = melody.events[waitIdx];
    if (!ev) { setNext(null); return; }
    markChip(waitIdx, 'cur');
    scrollToChip(waitIdx);
    setNext(ev.midi);
    const played = melody.events.slice(0, waitIdx).filter((e) => e.midi !== null).length;
    const totalNotes = melody.events.filter((e) => e.midi !== null).length;
    $('#ml-stats').innerHTML = `<span>нота <b>${played + 1}</b> из ${totalNotes}</span><span>ошибок <b>${waitErrors}</b></span><span class="muted">подсвечена нужная пластина — ударьте по ней</span>`;
  }

  function waitTap(midi) {
    const ev = melody.events[waitIdx];
    if (!ev) return;
    if (midi === ev.midi) {
      markChip(waitIdx, 'cur', false);
      markChip(waitIdx, 'ok');
      waitIdx = nextNoteIdx(waitIdx + 1);
      if (waitIdx >= melody.events.length) {
        setNext(null);
        $('#ml-stats').innerHTML = `<span>🎉 <b>Сыграно!</b></span><span>ошибок <b>${waitErrors}</b></span><span class="muted">${waitErrors ? 'Ещё раз — и попробуйте без ошибок.' : 'Без ошибок! Попробуйте режим «В темпе».'}</span>`;
        setTimeout(() => { if (st.mode === 'wait' && waitIdx >= melody.events.length) startWait(); }, 2500);
        return;
      }
      showWaitTarget();
    } else {
      waitErrors++;
      flashBar(midi, 'bad', 350);
      markChip(waitIdx, 'bad');
      setTimeout(() => markChip(waitIdx, 'bad', false), 350);
      showWaitTarget();
    }
  }

  // ───────── Режимы «Слушать» и «В темпе» ─────────
  function resetScore() {
    score = { hit: 0, off: 0, wrong: 0, miss: 0 };
    targets = [];
    renderScore();
  }

  function renderScore() {
    if (st.mode === 'listen') {
      $('#ml-stats').innerHTML = '<span class="muted">Слушайте и смотрите: пластина загорается, когда звучит её нота. Потом включите «Ждать меня».</span>';
    } else if (st.mode === 'along') {
      const n = score.hit + score.off + score.wrong + score.miss;
      $('#ml-stats').innerHTML = `
        <span>точность <b>${n ? Math.round((score.hit / n) * 100) + '%' : '—'}</b></span>
        <span class="good">в точку <b>${score.hit}</b></span>
        <span class="warn">не в ритм <b>${score.off}</b></span>
        <span class="bad">не та нота <b>${score.wrong}</b></span>
        <span class="bad">пропуск <b>${score.miss}</b></span>`;
    }
  }

  function play() {
    if (!melody.events.length) { UI.toast('В мелодии пока нет нот'); return; }
    const beats = melody.beats || 4;
    const pickup = melody.pickup || 0;
    const totalBeats = pickup + Math.ceil(Math.max(0, melody.total - pickup) / beats) * beats;
    const steps = Math.round(totalBeats * 4);
    const byStep = new Map();
    melody.events.forEach((e, i) => byStep.set(Math.round(e.start * 4), i));
    const along = st.mode === 'along';
    const countSteps = st.countIn || along ? beats * 4 : 0;
    resetScore();
    let litTimer = null;

    transport.onStep = (step, time) => {
      const onBeat = step % 4 === 0;
      if (step < 0) {
        if (onBeat) Sound.click(time, step === -countSteps ? 2 : 1, 'wood');
        return;
      }
      if (st.click && onBeat) {
        const b = step / 4 - pickup;
        const accent = ((b % beats) + beats) % beats === 0;
        Sound.click(time, accent ? 2 : 1, 'wood', 0.5);
      }
      const i = byStep.get(step);
      if (i === undefined) return;
      const ev = melody.events[i];
      if (ev.midi === null) return;
      if (!along || st.guide) Sound.bar(ev.midi, time, along ? 0.35 : 0.9);
      if (along) targets.push({ time, i, midi: ev.midi, done: false });
    };
    transport.onDraw = (step, time, dur) => {
      if (step < 0) {
        if (step % 4 === 0) $('#ml-stats').innerHTML = `<span>отсчёт <b>${(step + countSteps) / 4 + 1}</b></span>`;
        return;
      }
      if (step === 0) {
        chipEls.forEach((c) => c.classList.remove('cur', 'hit', 'off', 'wrong', 'miss', 'ok'));
        renderScore();
      }
      const i = byStep.get(step);
      if (i === undefined) return;
      chipEls.forEach((c) => c.classList.remove('cur'));
      markChip(i, 'cur');
      scrollToChip(i);
      const ev = melody.events[i];
      if (ev.midi !== null) {
        const b = barEl(ev.midi);
        if (b) {
          el.querySelectorAll('#ml-inst .lit').forEach((x) => x.classList.remove('lit'));
          b.classList.add('lit');
          clearTimeout(litTimer);
          litTimer = setTimeout(() => b.classList.remove('lit'), Math.max(150, ev.dur * dur * 4 * 1000 * 0.8));
        }
      }
      // подсказка: следующая нота
      const nxt = melody.events[nextNoteIdx(i + 1)];
      setNext(nxt ? nxt.midi : null);
    };
    transport.onLoop = null;
    transport.onFrame = (now) => {
      if (!along) return;
      const t = now - (Sound.ctx.outputLatency || 0);
      let changed = false;
      targets = targets.filter((g) => {
        if (g.done) return t - g.time < 2;
        if (t > g.time + 0.3) {
          score.miss++;
          markChip(g.i, 'miss');
          changed = true;
          return false;
        }
        return true;
      });
      if (changed) renderScore();
    };
    transport.onStop = () => {
      $('#ml-play').textContent = '▶ Играть';
      $('#ml-play').classList.remove('on');
      el.querySelectorAll('#ml-inst .lit').forEach((x) => x.classList.remove('lit'));
      setNext(null);
      chipEls.forEach((c) => c.classList.remove('cur'));
      renderScore();
    };
    transport.start({ bpm: bpmCtl.value, spb: 4, total: steps, countIn: countSteps });
    $('#ml-play').textContent = '■ Стоп';
    $('#ml-play').classList.add('on');
  }

  function alongTap(midi, t) {
    let best = null;
    targets.forEach((g) => {
      if (g.done || Math.abs(g.time - t) > 0.3) return;
      const better = !best || (g.midi === midi && best.midi !== midi) || (g.midi === best.midi && Math.abs(g.time - t) < Math.abs(best.time - t)) || (g.midi !== midi && best.midi !== midi && Math.abs(g.time - t) < Math.abs(best.time - t));
      if (better) best = g;
    });
    if (!best) return;
    best.done = true;
    let res;
    if (best.midi !== midi) { res = 'wrong'; flashBar(midi, 'bad', 350); }
    else res = Math.abs(best.time - t) <= 0.09 ? 'hit' : 'off';
    score[res]++;
    markChip(best.i, res);
    renderScore();
  }

  function toggle() {
    if (st.view !== 'melody' || !melody) return;
    if (st.mode === 'wait') { startWait(); return; }
    transport.playing ? transport.stop() : play();
  }

  $('#ml-play').addEventListener('click', toggle);
  $('#ml-desc').addEventListener('click', (e) => e.currentTarget.classList.toggle('open'));
  $('#ml-select').addEventListener('change', (e) => { history.replaceState(null, '', `#/mallet/melody/${e.target.value}`); loadMelody(e.target.value); });
  $('#ml-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    transport.stop();
    st.mode = b.dataset.mode;
    Store.set('ml.mode', st.mode);
    setRootClass();
    renderMelody();
  });
  $('#ml-click').addEventListener('change', (e) => { st.click = e.target.checked; });
  $('#ml-count').addEventListener('change', (e) => { st.countIn = e.target.checked; });
  $('#ml-guide').addEventListener('change', (e) => { st.guide = e.target.checked; });
  $('#ml-new').addEventListener('click', () => {
    if (location.hash === '#/mallet/new') newMelody();
    else location.hash = '#/mallet/new';
  });
  $('#ml-edit').addEventListener('click', () => {
    transport.stop();
    if (!melody.custom) {
      melody = { ...melody, id: 'm_' + Date.now().toString(36), name: melody.name + ' (моя версия)', custom: true, desc: '' };
    }
    editing = true;
    renderMelody();
  });

  // ───────── Редактор ─────────
  function newMelody() {
    transport.stop();
    melody = { id: 'm_' + Date.now().toString(36), name: 'Моя мелодия', beats: 4, bpm: 72, pickup: 0, notes: '', events: [], total: 0, custom: true, isNew: true };
    editing = true;
    recording = true;
    renderSelect();
    renderMelody();
  }

  function renderEditor() {
    const box = $('#ml-editor');
    const p = parse(melody.notes);
    box.innerHTML = `
      <div class="eyebrow">редактор мелодии</div>
      <div class="edit-form">
        <label>Название <input type="text" id="me-name" value="${UI.esc(melody.name)}"></label>
        <label>Долей в такте <select id="me-beats">${[2, 3, 4, 6].map((b) => `<option ${b === (melody.beats || 4) ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
        <label>Затакт, долей <input type="number" id="me-pickup" min="0" max="5" step="0.5" value="${melody.pickup || 0}"></label>
      </div>
      <div class="ml-rec">
        <button class="btn ${recording ? 'danger on-rec' : ''}" id="me-rec">${recording ? '● Идёт запись — стучите по пластинам' : '● Запись'}</button>
        <span class="eyebrow">длительность</span>
        <div class="seg" id="me-dur">
          ${[[0.5, '♪ ½'], [1, '♩ 1'], [1.5, '♩. 1½'], [2, '𝅗𝅥 2'], [4, '𝅝 4']].map(([d, t]) => `<button data-dur="${d}" class="${d === recDur ? 'sel' : ''}">${t}</button>`).join('')}
        </div>
        <button class="tbtn" id="me-rest">пауза</button>
        <button class="tbtn" id="me-undo">⌫ последнюю</button>
      </div>
      <label class="full">Ноты (можно править текстом: e1 g1:2 c2:0.5, пауза «-», такт «|»)
        <textarea id="me-notes" rows="4" spellcheck="false">${UI.esc(melody.notes)}</textarea>
      </label>
      <p class="ml-err" id="me-err">${p.errors.length ? 'Не понял: ' + p.errors.map(UI.esc).join(', ') : ''}</p>
      <div class="ml-rec">
        <span class="eyebrow">транспонировать</span>
        <button class="tbtn" data-tr="-12">−октава</button>
        <button class="tbtn" data-tr="-1">−½ тона</button>
        <button class="tbtn" data-tr="1">+½ тона</button>
        <button class="tbtn" data-tr="12">+октава</button>
      </div>
      <div class="actions">
        <button class="btn primary" id="me-save">💾 Сохранить</button>
        <button class="btn" id="me-cancel">Отмена</button>
        <span class="spacer"></span>
        ${!melody.isNew && customs().some((c) => c.id === melody.id) ? '<button class="btn small danger" id="me-del">🗑 Удалить</button>' : ''}
      </div>`;

    const q = (s) => box.querySelector(s);
    q('#me-name').addEventListener('input', (e) => { melody.name = e.target.value; });
    q('#me-beats').addEventListener('change', (e) => { melody.beats = +e.target.value; setNotes(melody.notes); });
    q('#me-pickup').addEventListener('change', (e) => { melody.pickup = UI.clamp(+e.target.value || 0, 0, 5); });
    q('#me-notes').addEventListener('input', (e) => setNotes(e.target.value, false));
    q('#me-rec').addEventListener('click', () => { recording = !recording; renderEditor(); });
    q('#me-dur').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dur]');
      if (!b) return;
      recDur = +b.dataset.dur;
      q('#me-dur').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
    });
    q('#me-rest').addEventListener('click', () => appendToken(tokenOf(null, recDur)));
    q('#me-undo').addEventListener('click', () => {
      const toks = melody.notes.trim().split(/\s+/).filter(Boolean);
      while (toks.length && toks[toks.length - 1] === '|') toks.pop();
      toks.pop();
      while (toks.length && toks[toks.length - 1] === '|') toks.pop();
      setNotes(toks.join(' '));
    });
    box.querySelectorAll('[data-tr]').forEach((b) => b.addEventListener('click', () => transpose(+b.dataset.tr)));
    q('#me-save').addEventListener('click', saveMelody);
    q('#me-cancel').addEventListener('click', () => {
      editing = false;
      recording = false;
      loadMelody(customs().some((c) => c.id === melody.id) ? melody.id : st.mid);
    });
    if (q('#me-del')) q('#me-del').addEventListener('click', () => {
      if (!confirm(`Удалить «${melody.name}»?`)) return;
      Store.set('ml.custom', customs().filter((c) => c.id !== melody.id));
      location.hash = '#/mallet/melody/koster';
    });
  }

  // Переписать ноты, заново расставив тактовые черты
  function withBars(events) {
    const beats = melody.beats || 4;
    const pickup = melody.pickup || 0;
    const out = [];
    events.forEach((e) => {
      const b = e.start - pickup;
      if (e.start > 0 && b >= 0 && Math.abs(b / beats - Math.round(b / beats)) < 1e-6) out.push('|');
      out.push(tokenOf(e.midi, e.dur));
    });
    return out.join(' ');
  }

  function setNotes(text, rewriteBox = true) {
    melody.notes = text;
    const p = parse(text);
    melody.events = p.events;
    melody.total = p.total;
    if (rewriteBox) {
      const ta = $('#me-notes');
      if (ta) ta.value = text;
    }
    const err = $('#me-err');
    if (err) err.textContent = p.errors.length ? 'Не понял: ' + p.errors.join(', ') : '';
    renderRibbon();
    renderWarn();
    if (chipEls.length) scrollToChip(chipEls.length - 1);
  }

  function appendToken(tok) {
    const p = parse(melody.notes);
    const events = [...p.events, ...parse(tok).events.map((e) => ({ ...e, start: p.total }))];
    setNotes(withBars(events));
  }

  function recordNote(midi) { appendToken(tokenOf(midi, recDur)); }

  function transpose(semi) {
    const p = parse(melody.notes);
    if (!p.events.length) return;
    const moved = p.events.map((e) => ({ ...e, midi: e.midi === null ? null : e.midi + semi }));
    if (moved.some((e) => e.midi !== null && (e.midi < LO || e.midi > HI))) { UI.toast('Не помещается в две октавы'); return; }
    if (st.layout === 'diatonic' && moved.some((e) => e.midi !== null && LETTERS[(e.midi - LO) % 12].length > 1)) {
      UI.toast('Появились диезы — на однорядном металлофоне их нет. Попробуйте другой сдвиг.');
    }
    setNotes(withBars(moved));
  }

  function saveMelody() {
    const p = parse(melody.notes);
    if (p.errors.length) { UI.toast('Исправьте непонятные ноты'); return; }
    if (!p.events.length) { UI.toast('В мелодии пока нет нот'); return; }
    const rec = { id: melody.id, name: melody.name.trim() || 'Моя мелодия', beats: melody.beats || 4, pickup: melody.pickup || 0, bpm: bpmCtl.value, notes: melody.notes.trim() };
    const list = customs().filter((c) => c.id !== rec.id);
    list.push(rec);
    Store.set('ml.custom', list);
    editing = false;
    recording = false;
    UI.toast('Мелодия сохранена на этом устройстве');
    history.replaceState(null, '', `#/mallet/melody/${rec.id}`);
    loadMelody(rec.id);
  }

  // ───────── Уроки ─────────
  function renderLessons() {
    const idx = MALLET_LESSONS.findIndex((l) => l.id === st.lesson);
    const l = MALLET_LESSONS[idx];
    const done = Store.lessonDone('ml-' + l.id);
    const prev = MALLET_LESSONS[idx - 1];
    const next = MALLET_LESSONS[idx + 1];
    $('#ml-lessons').innerHTML = `
      <div class="two-col">
        <aside class="card list-col ${listOpen ? 'open' : ''}">
          <button class="lib-toggle" id="ml-ltoggle" aria-expanded="${listOpen}"><span>📖 Уроки металлофона <small>· ${MALLET_LESSONS.length}</small></span><b aria-hidden="true">▾</b></button>
          <h2 class="list-title">Уроки</h2>
          <ol class="lesson-list">
            ${MALLET_LESSONS.map((x, i) => `
              <li><a href="#/mallet/lesson/${x.id}" class="${x.id === l.id ? 'active' : ''} ${Store.lessonDone('ml-' + x.id) ? 'done' : ''}">
                <span class="ln">${Store.lessonDone('ml-' + x.id) ? '✓' : i + 1}</span>
                <span><b>${UI.esc(x.title.replace(/^Урок \d+\. /, ''))}</b><small>${UI.esc(x.short)}</small></span>
              </a></li>`).join('')}
          </ol>
        </aside>
        <article class="card lesson">
          <div class="lesson-kicker">Металлофон · урок ${idx + 1} из ${MALLET_LESSONS.length}</div>
          <h1>${UI.esc(l.title.replace(/^Урок \d+\. /, ''))}</h1>
          <div class="lesson-body">${l.html}</div>
          <div class="lesson-foot">
            <button class="btn ${done ? '' : 'primary'}" id="ml-ldone">${done ? '✓ Урок пройден' : 'Отметить урок пройденным'}</button>
            <span class="spacer"></span>
            ${prev ? `<a class="btn" href="#/mallet/lesson/${prev.id}">← ${UI.esc(prev.title.replace(/^Урок \d+\. /, ''))}</a>` : ''}
            ${next ? `<a class="btn" href="#/mallet/lesson/${next.id}">${UI.esc(next.title.replace(/^Урок \d+\. /, ''))} →</a>` : ''}
          </div>
        </article>
      </div>`;
    $('#ml-ltoggle').addEventListener('click', () => { listOpen = !listOpen; renderLessons(); });
    $('#ml-ldone').addEventListener('click', () => {
      Store.setLesson('ml-' + l.id, !done);
      renderLessons();
      if (!done && next) UI.toast('Отлично! Дальше: ' + next.title.replace(/^Урок \d+\. /, ''));
    });
  }

  // ───────── Виды ─────────
  function setRootClass() {
    el.querySelector('.ml').className = `ml view-${st.view} mode-${st.mode}`;
  }

  function setView(v) {
    st.view = v;
    setRootClass();
    el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('sel', b.dataset.view === v));
    $('#ml-lessons').hidden = v !== 'lessons';
    $('#ml-melody').hidden = v !== 'melody';
    $('#ml-free').hidden = v !== 'free';
    if (v !== 'melody') { transport.stop(); setNext(null); }
  }

  el.querySelector('#ml-views').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    const v = b.dataset.view;
    location.hash = v === 'lessons' ? `#/mallet/lesson/${st.lesson}` : v === 'melody' ? `#/mallet/melody/${st.mid}` : '#/mallet/free';
  });

  window.addEventListener('resize', () => { if (el.classList.contains('active') && melody && chipEls.length) scrollToChip(0); });

  renderInstrument();

  return {
    show(params) {
      const [what, id] = params;
      if (what === 'melody') {
        setView('melody');
        if (!melody || melody.id !== id || editing) {
          if (!(editing && melody && melody.id === id)) loadMelody(id || st.mid);
        }
      } else if (what === 'new') {
        setView('melody');
        newMelody();
      } else if (what === 'free') {
        setView('free');
      } else {
        if (what === 'lesson' && MALLET_LESSONS.some((l) => l.id === id)) st.lesson = id;
        listOpen = false;
        setView('lessons');
        renderLessons();
      }
      window.scrollTo(0, 0);
    },
    toggle,
    hide() { transport.stop(); },
  };
})();
