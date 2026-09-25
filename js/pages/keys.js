window.Pages = window.Pages || {};

/*
 * Клавишные (Akai MPK mini Play, 25 клавиш): уроки, мелодии, аккорды, свободная игра.
 * Ввод: MIDI (Web MIDI — Chrome/Edge), касания экранной клавиатуры, клавиатура компьютера.
 * Клавиши считаются относительно левой «до» инструмента: rel 0 = до¹ … 24 = до³.
 */
Pages.keys = (() => {
  const el = document.getElementById('page-keys');
  const transport = new Transport();
  const M = window.MALLET;
  const LO = M.BASE_MIDI; // до¹ в записи мелодий
  const SOUND_BASE = 60; // до¹ звучит как до первой октавы
  const LETTERS = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SUP = { 1: '¹', 2: '²', 3: '³' };
  const api = () => Pages.mallet.api;

  const st = {
    view: 'lessons',
    lesson: KEYS_LESSONS[0].id,
    mid: 'mary',
    prog: 'cfg',
    mode: Store.get('kb.mode', 'wait'),
    cmode: 'wait',
    base: Store.get('kb.base', 48), // MIDI-номер левой «до» на клавиатуре
    anyOct: Store.get('kb.anyOct', true),
    midiSound: Store.get('kb.midiSound', false),
    click: true,
    countIn: true,
    guide: true,
  };
  let melody = null;
  let chipEls = [];
  let waitIdx = 0;
  let waitErrors = 0;
  let targets = [];
  let score = { hit: 0, off: 0, wrong: 0, miss: 0 };
  let bpmCtl = null;
  let cBpmCtl = null;
  let listOpen = false;
  let calibrating = false;
  let chordIdx = 0;
  let chordArmed = true;
  const pressed = new Map(); // rel → источник
  let midi = { access: null, status: navigator.requestMIDIAccess ? 'off' : 'unsupported', names: [] };

  // ───────── Названия ─────────
  function name(rel) {
    const r = ((rel % 12) + 12) % 12;
    const l = LETTERS[r];
    return { text: `${M.RU[l[0]]}${l.length > 1 ? '♯' : ''}`, oct: Math.floor(rel / 12) + 1, cls: l.length > 1 ? 'nc-sharp' : `nc-${l[0]}`, black: l.length > 1 };
  }
  const noteName = (rel) => { const n = name(rel); return `${n.text}${SUP[n.oct] || ''}`; };
  const sameNote = (a, b) => (st.anyOct ? ((a - b) % 12 + 12) % 12 === 0 : a === b);
  const sound = (rel, t, dur = 0.8, vel = 0.9) => Sound.keys(SOUND_BASE + rel, t, dur, vel);

  // ───────── Каркас ─────────
  el.innerHTML = `
    <div class="ml kb">
      <header class="tr-head">
        <div>
          <div class="eyebrow">клавишные · 25 клавиш · Akai MPK mini Play</div>
          <h1 class="tr-title">Клавиши</h1>
        </div>
        <div class="seg inst-switch"><a href="#/mallet">Металлофон</a><a href="#/flute">Флейта</a><a class="sel" href="#/keys">Клавиши</a></div>
        <div class="seg" id="kb-views">
          <button data-view="lessons">Уроки</button>
          <button data-view="melody">Мелодии</button>
          <button data-view="chords">Аккорды</button>
          <button data-view="free">Свободно</button>
        </div>
      </header>

      <div class="card kb-midi">
        <button class="btn" id="kb-connect">🎹 Подключить MIDI</button>
        <span class="kb-status" id="kb-status">MIDI не подключено — можно играть на экранной клавиатуре</span>
        <button class="tbtn kb-midionly" id="kb-cal">Настроить октаву</button>
        <label class="toggle kb-midionly"><input type="checkbox" id="kb-anyoct" ${st.anyOct ? 'checked' : ''}> октава не важна</label>
        <label class="toggle kb-midionly"><input type="checkbox" id="kb-msound" ${st.midiSound ? 'checked' : ''}> звук приложения при игре с MIDI</label>
      </div>

      <section id="kb-lessons"></section>

      <section id="kb-melody" hidden>
        <div class="card ml-player">
          <div class="ml-top">
            <label class="ml-pick"><span class="eyebrow">мелодия</span><select id="kb-select"></select></label>
            <a class="tbtn" id="kb-edit" href="#/mallet">✎ В редакторе</a>
          </div>
          <p class="tr-note" id="kb-desc"></p>
          <div class="seg ml-modes" id="kb-modes" role="radiogroup" aria-label="Режим">
            <button data-mode="listen">👂 Слушать</button>
            <button data-mode="wait">⏸ Ждать меня</button>
            <button data-mode="along">🎯 В темпе</button>
          </div>
          <div class="controls dock" id="kb-dock">
            <button class="btn play" id="kb-play">▶ Играть</button>
            <span id="kb-bpm"></span>
          </div>
          <div class="controls options" id="kb-opts">
            <label class="toggle"><input type="checkbox" id="kb-click" checked> Щелчок</label>
            <label class="toggle"><input type="checkbox" id="kb-count" checked> Отсчёт</label>
            <label class="toggle" id="kb-guide-l"><input type="checkbox" id="kb-guide" checked> Подсказка звуком</label>
          </div>
          <div class="fl-manual" id="kb-manual" hidden><button class="btn primary" id="kb-ok">✓ Сыграл — дальше</button></div>
          <div class="ml-ribbon-wrap"><div class="ml-ribbon" id="kb-ribbon"></div></div>
          <div class="ml-stats" id="kb-stats" aria-live="polite"></div>
        </div>
      </section>

      <section id="kb-chords" hidden>
        <div class="card ml-player">
          <div class="ml-top">
            <label class="ml-pick"><span class="eyebrow">последовательность</span><select id="kb-prog">${PROGRESSIONS.map((p) => `<option value="${p.id}">${UI.esc(p.name)}</option>`).join('')}</select></label>
          </div>
          <div class="seg ml-modes" id="kb-cmodes">
            <button data-cmode="listen">👂 Слушать</button>
            <button data-cmode="wait">⏸ Ждать меня</button>
          </div>
          <div class="kb-chordrow" id="kb-chordrow"></div>
          <div class="kb-bigchord"><b id="kb-cname">—</b><span id="kb-cdesc"></span></div>
          <div class="controls dock" id="kb-cdock">
            <button class="btn play" id="kb-cplay">▶ Играть</button>
            <span id="kb-cbpm"></span>
          </div>
          <div class="ml-stats" id="kb-cstats"></div>
        </div>
      </section>

      <section id="kb-free" hidden>
        <div class="card">
          <div class="eyebrow">свободная игра</div>
          <div class="kb-bigchord"><b id="kb-held">—</b><span id="kb-helddesc">зажмите несколько клавиш — приложение назовёт аккорд</span></div>
          <p class="tr-note ml-keys">Клавиатура компьютера: нижняя октава <kbd>Z</kbd>…<kbd>M</kbd> (чёрные <kbd>S</kbd> <kbd>D</kbd> <kbd>G</kbd> <kbd>H</kbd> <kbd>J</kbd>), верхняя <kbd>Q</kbd>…<kbd>U</kbd> (чёрные <kbd>2</kbd> <kbd>3</kbd> <kbd>5</kbd> <kbd>6</kbd> <kbd>7</kbd>), верхнее «до» <kbd>I</kbd>.</p>
        </div>
      </section>

      <div class="card ml-inst-card kb-inst-card">
        <div class="kb-piano" id="kb-piano"></div>
      </div>
    </div>`;

  const $ = (s) => el.querySelector(s);

  bpmCtl = UI.bpmControl({ value: 80, min: 30, max: 200, onChange: (v) => { transport.bpm = v; } });
  $('#kb-bpm').appendChild(bpmCtl.el);
  cBpmCtl = UI.bpmControl({ value: 70, min: 30, max: 200, onChange: (v) => { transport.bpm = v; } });
  $('#kb-cbpm').appendChild(cBpmCtl.el);

  // ───────── Экранная клавиатура ─────────
  function renderPiano() {
    const whites = [];
    const blacks = [];
    for (let r = 0; r <= 24; r++) (name(r).black ? blacks : whites).push(r);
    const w = 100 / whites.length;
    let html = '<div class="kb-whites">';
    whites.forEach((r) => {
      const n = name(r);
      html += `<button class="kb-key white ${n.cls}" data-rel="${r}" aria-label="${noteName(r)}"><span>${n.text}${r % 12 === 0 ? `<sup>${n.oct}</sup>` : ''}</span></button>`;
    });
    html += '</div>';
    blacks.forEach((r) => {
      const left = whites.indexOf(r - 1);
      html += `<button class="kb-key black" data-rel="${r}" style="left:calc(${(left + 1) * w}% - ${w * 0.3}%);width:${w * 0.6}%" aria-label="${noteName(r)}"></button>`;
    });
    $('#kb-piano').innerHTML = html;
  }

  const keyEl = (rel) => $(`#kb-piano [data-rel="${rel}"]`);
  function setKeyClass(cls, rels) {
    el.querySelectorAll(`#kb-piano .${cls}`).forEach((k) => k.classList.remove(cls));
    (rels || []).forEach((r) => { const k = keyEl(r); if (k) k.classList.add(cls); });
  }
  function flashKey(rel, cls, ms = 300) {
    const k = keyEl(rel);
    if (!k) return;
    k.classList.add(cls);
    setTimeout(() => k.classList.remove(cls), ms);
  }

  // касания: у каждого пальца свой pointerId — можно зажимать аккорды
  const pointerKeys = new Map();
  $('#kb-piano').addEventListener('pointerdown', (e) => {
    const k = e.target.closest('[data-rel]');
    if (!k) return;
    e.preventDefault();
    const rel = +k.dataset.rel;
    pointerKeys.set(e.pointerId, rel);
    noteOn(rel, e, 'touch');
  });
  const release = (e) => {
    if (!pointerKeys.has(e.pointerId)) return;
    noteOff(pointerKeys.get(e.pointerId));
    pointerKeys.delete(e.pointerId);
  };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => $('#kb-piano').addEventListener(t, release));

  const KEYMAP = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24,
  };
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('active') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (!(e.code in KEYMAP)) return;
    e.preventDefault();
    noteOn(KEYMAP[e.code], e, 'kbd');
  });
  window.addEventListener('keyup', (e) => { if (e.code in KEYMAP) noteOff(KEYMAP[e.code]); });

  // ───────── MIDI ─────────
  async function midiConnect() {
    if (!navigator.requestMIDIAccess) {
      midi.status = 'unsupported';
      midiUi();
      return;
    }
    try {
      midi.access = await navigator.requestMIDIAccess();
      midi.access.onstatechange = bindInputs;
      bindInputs();
    } catch (e) {
      midi.status = 'denied';
      midiUi();
    }
  }

  function bindInputs() {
    const inputs = [...midi.access.inputs.values()];
    inputs.forEach((inp) => { inp.onmidimessage = onMidi; });
    midi.names = inputs.map((i) => i.name);
    midi.status = inputs.length ? 'on' : 'nodevice';
    midiUi();
  }

  function onMidi(e) {
    if (!el.classList.contains('active')) return;
    const [s, n, v] = e.data;
    const cmd = s & 0xf0;
    if (cmd === 0x90 && v > 0) {
      if (calibrating) {
        st.base = n - (n % 12);
        Store.set('kb.base', st.base);
        calibrating = false;
        UI.toast(`Готово: левая «до» — MIDI ${st.base}. ${n % 12 ? 'Вы нажали не «до», взял ближайшую «до» ниже.' : ''}`);
        midiUi();
        return;
      }
      noteOn(n - st.base, e, 'midi', v / 127);
    } else if (cmd === 0x80 || (cmd === 0x90 && v === 0)) {
      noteOff(n - st.base);
    }
  }

  function midiUi() {
    const s = $('#kb-status');
    const txt = {
      off: 'MIDI не подключено — можно играть на экранной клавиатуре',
      unsupported: 'Этот браузер не умеет MIDI (iPhone/Safari) — играйте на экранной клавиатуре или откройте приложение в Chrome/Edge.',
      denied: 'Доступ к MIDI не разрешён — разрешите его в настройках сайта.',
      nodevice: 'MIDI включено, но клавиатура не найдена — подключите MPK по USB.',
      on: `✓ Подключено: ${midi.names.join(', ')}`,
    }[midi.status];
    s.textContent = calibrating ? '… нажмите самую левую клавишу на MPK' : txt;
    s.classList.toggle('ok', midi.status === 'on');
    $('#kb-connect').hidden = midi.status === 'on' || midi.status === 'unsupported';
    el.querySelectorAll('.kb-midionly').forEach((x) => { x.hidden = midi.status !== 'on'; });
    $('#kb-manual').hidden = !(st.mode === 'wait' && midi.status !== 'on');
  }

  $('#kb-connect').addEventListener('click', midiConnect);
  $('#kb-cal').addEventListener('click', () => {
    if (midi.status !== 'on') { UI.toast('Сначала подключите MIDI'); return; }
    calibrating = true;
    midiUi();
  });
  $('#kb-anyoct').addEventListener('change', (e) => { st.anyOct = e.target.checked; Store.set('kb.anyOct', st.anyOct); });
  $('#kb-msound').addEventListener('change', (e) => { st.midiSound = e.target.checked; Store.set('kb.midiSound', st.midiSound); });

  // ───────── Нажатия ─────────
  function noteOn(rel, ev, src, vel = 0.9) {
    if (src !== 'midi' || st.midiSound) sound(rel, undefined, 0.9, Math.max(0.4, vel));
    pressed.set(rel, src);
    setKeyClass('down', [...pressed.keys()]);
    if (st.view === 'free') showHeld();
    else if (st.view === 'melody' && melody) {
      if (st.mode === 'wait') waitNote(rel);
      else if (st.mode === 'along' && transport.playing) alongNote(rel, Sound.eventTime(ev));
    } else if (st.view === 'chords') {
      chordArmed = true;
      checkChord();
    }
  }

  function noteOff(rel) {
    pressed.delete(rel);
    setKeyClass('down', [...pressed.keys()]);
    if (st.view === 'free') showHeld();
  }

  // ───────── Распознавание аккорда ─────────
  const SHAPES = [
    ['', [0, 4, 7], 'мажор'], ['m', [0, 3, 7], 'минор'], ['7', [0, 4, 7, 10], 'септаккорд'], ['maj7', [0, 4, 7, 11], 'большой мажорный септаккорд'],
    ['m7', [0, 3, 7, 10], 'минорный септаккорд'], ['dim', [0, 3, 6], 'уменьшённый'], ['aug', [0, 4, 8], 'увеличенный'],
    ['sus4', [0, 5, 7], 'с квартой'], ['sus2', [0, 2, 7], 'с секундой'], ['5', [0, 7], 'квинта (пауэр-аккорд)'],
  ];
  function chordName(rels) {
    const pcs = [...new Set(rels.map((r) => ((r % 12) + 12) % 12))];
    if (pcs.length < 2) return null;
    const bass = ((Math.min(...rels) % 12) + 12) % 12;
    for (const root of [bass, ...pcs.filter((p) => p !== bass)]) {
      const iv = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b);
      const shape = SHAPES.find(([, s]) => s.length === iv.length && s.every((x, i) => x === iv[i]));
      if (shape) {
        const sym = EN[root] + shape[0] + (root !== bass ? `/${EN[bass]}` : '');
        return { sym, desc: `${M.RU[LETTERS[root][0]]}${LETTERS[root].length > 1 ? '♯' : ''} ${shape[2]}${root !== bass ? `, в басу ${M.RU[LETTERS[bass][0]]}` : ''}` };
      }
    }
    return null;
  }

  function showHeld() {
    const rels = [...pressed.keys()];
    if (!rels.length) { $('#kb-held').textContent = '—'; $('#kb-helddesc').textContent = 'зажмите несколько клавиш — приложение назовёт аккорд'; return; }
    if (rels.length === 1) { $('#kb-held').textContent = noteName(rels[0]); $('#kb-helddesc').textContent = 'одна нота'; return; }
    const c = chordName(rels);
    $('#kb-held').textContent = c ? c.sym : rels.map(noteName).join(' + ');
    $('#kb-helddesc').textContent = c ? c.desc : 'такого аккорда не знаю — но звучит интересно';
  }

  // ───────── Мелодии ─────────
  function renderSelect() {
    const all = api().allMelodies();
    const cats = [...new Set(all.map((m) => m.cat))];
    $('#kb-select').innerHTML = cats.map((c) => `<optgroup label="${UI.esc(c)}">${all.filter((m) => m.cat === c).map((m) => `<option value="${m.id}" ${melody && m.id === melody.id ? 'selected' : ''}>${UI.esc(m.name)}</option>`).join('')}</optgroup>`).join('');
  }

  function loadMelody(id) {
    transport.stop();
    const src = api().findMelody(id) || api().findMelody('mary');
    st.mid = src.id;
    const p = api().parse(src.notes);
    melody = { ...src, events: p.events.map((e) => ({ ...e, rel: e.midi === null ? null : e.midi - LO })), total: p.total, pickup: src.pickup || 0 };
    bpmCtl.set(src.bpm || 80, false);
    $('#kb-edit').href = `#/mallet/melody/${src.id}`;
    renderSelect();
    renderMelody();
  }

  function renderMelody() {
    $('#kb-desc').textContent = melody.desc || 'Ваша мелодия.';
    el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('sel', b.dataset.mode === st.mode));
    $('#kb-guide-l').hidden = st.mode !== 'along';
    $('#kb-dock').hidden = st.mode === 'wait';
    $('#kb-opts').hidden = st.mode === 'wait';
    rootClass();
    $('#kb-ribbon').innerHTML = melody.events.map((e, i) => {
      const bar = e.bar ? '<i class="ml-barline" aria-hidden="true"></i>' : '';
      if (e.rel === null) return `${bar}<button class="ml-chip rest" data-i="${i}" style="--d:${e.dur}">𝄽</button>`;
      const n = name(e.rel);
      return `${bar}<button class="ml-chip ${n.cls}" data-i="${i}" style="--d:${e.dur}"><b>${n.text}<sup>${SUP[n.oct]}</sup></b></button>`;
    }).join('');
    chipEls = [...el.querySelectorAll('#kb-ribbon .ml-chip')];
    resetScore();
    midiUi();
    if (st.mode === 'wait') startWait();
    else setKeyClass('next', []);
  }

  const nextNoteIdx = (i) => { while (i < melody.events.length && melody.events[i].rel === null) i++; return i; };
  function markChip(i, cls, on = true) { if (chipEls[i]) chipEls[i].classList.toggle(cls, on); }
  function scrollToChip(i) {
    const c = chipEls[i];
    const wrap = el.querySelector('#kb-melody .ml-ribbon-wrap');
    if (!c || !wrap) return;
    const x = c.offsetLeft - wrap.offsetLeft;
    if (x < wrap.scrollLeft + 20 || x > wrap.scrollLeft + wrap.clientWidth - 80) wrap.scrollTo({ left: x - 40, behavior: 'smooth' });
  }

  $('#kb-ribbon').addEventListener('click', (e) => {
    const c = e.target.closest('.ml-chip');
    if (!c) return;
    const i = +c.dataset.i;
    const ev = melody.events[i];
    if (ev.rel === null) return;
    if (st.mode === 'wait') { waitIdx = i; showWaitTarget(); }
    if (!transport.playing) sound(ev.rel);
  });

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
    if (!ev) { setKeyClass('next', []); return; }
    markChip(waitIdx, 'cur');
    scrollToChip(waitIdx);
    setKeyClass('next', [ev.rel]);
    const played = melody.events.slice(0, waitIdx).filter((e) => e.rel !== null).length;
    const total = melody.events.filter((e) => e.rel !== null).length;
    $('#kb-stats').innerHTML = `<span>нота <b>${played + 1}</b> из ${total}</span><span>ошибок <b>${waitErrors}</b></span><span class="muted">нажмите подсвеченную клавишу — ${noteName(ev.rel)}</span>`;
  }

  function waitNote(rel) {
    const ev = melody.events[waitIdx];
    if (!ev) return;
    if (sameNote(rel, ev.rel)) advanceWait();
    else {
      waitErrors++;
      flashKey(rel, 'bad');
      markChip(waitIdx, 'bad');
      setTimeout(() => markChip(waitIdx, 'bad', false), 350);
      showWaitTarget();
    }
  }

  function advanceWait() {
    markChip(waitIdx, 'cur', false);
    markChip(waitIdx, 'ok');
    waitIdx = nextNoteIdx(waitIdx + 1);
    if (waitIdx >= melody.events.length) {
      setKeyClass('next', []);
      $('#kb-stats').innerHTML = `<span>🎉 <b>Сыграно!</b></span><span>ошибок <b>${waitErrors}</b></span><span class="muted">${waitErrors ? 'Ещё раз — и попробуйте без ошибок.' : 'Без ошибок! Попробуйте «В темпе».'}</span>`;
      setTimeout(() => { if (st.mode === 'wait' && waitIdx >= melody.events.length) startWait(); }, 2500);
      return;
    }
    showWaitTarget();
  }
  $('#kb-ok').addEventListener('click', () => { if (st.mode === 'wait' && melody) advanceWait(); });

  function resetScore() {
    score = { hit: 0, off: 0, wrong: 0, miss: 0 };
    targets = [];
    renderScore();
  }

  function renderScore() {
    if (st.mode === 'listen') {
      $('#kb-stats').innerHTML = '<span class="muted">Слушайте и смотрите: клавиши загораются вместе с нотами.</span>';
    } else if (st.mode === 'along') {
      const n = score.hit + score.off + score.wrong + score.miss;
      $('#kb-stats').innerHTML = `
        <span>точность <b>${n ? Math.round((score.hit / n) * 100) + '%' : '—'}</b></span>
        <span class="good">в точку <b>${score.hit}</b></span>
        <span class="warn">не в ритм <b>${score.off}</b></span>
        <span class="bad">не та нота <b>${score.wrong}</b></span>
        <span class="bad">пропуск <b>${score.miss}</b></span>`;
    }
  }

  function playMelody() {
    if (!melody.events.length) return;
    const beats = melody.beats || 4;
    const pickup = melody.pickup || 0;
    const totalBeats = pickup + Math.ceil(Math.max(0, melody.total - pickup) / beats) * beats;
    const byStep = new Map();
    melody.events.forEach((e, i) => byStep.set(Math.round(e.start * 4), i));
    const along = st.mode === 'along';
    const countSteps = st.countIn || along ? beats * 4 : 0;
    let litTimer = null;
    resetScore();
    transport.onStep = (step, time, dur) => {
      const onBeat = step % 4 === 0;
      if (step < 0) { if (onBeat) Sound.click(time, step === -countSteps ? 2 : 1, 'wood'); return; }
      if (st.click && onBeat) { const b = step / 4 - pickup; Sound.click(time, ((b % beats) + beats) % beats === 0 ? 2 : 1, 'wood', 0.45); }
      const i = byStep.get(step);
      if (i === undefined) return;
      const ev = melody.events[i];
      if (ev.rel === null) return;
      const sec = ev.dur * 4 * dur * 0.95;
      if (!along) sound(ev.rel, time, sec);
      else {
        if (st.guide) sound(ev.rel, time, sec, 0.35);
        targets.push({ time, i, rel: ev.rel, done: false });
      }
    };
    transport.onDraw = (step, time, dur) => {
      if (step < 0) { if (step % 4 === 0) $('#kb-stats').innerHTML = `<span>отсчёт <b>${(step + countSteps) / 4 + 1}</b></span>`; return; }
      if (step === 0) { chipEls.forEach((c) => c.classList.remove('cur', 'hit', 'off', 'wrong', 'miss')); renderScore(); }
      const i = byStep.get(step);
      if (i === undefined) return;
      chipEls.forEach((c) => c.classList.remove('cur'));
      markChip(i, 'cur');
      scrollToChip(i);
      const ev = melody.events[i];
      if (ev.rel !== null) {
        setKeyClass('lit', [ev.rel]);
        clearTimeout(litTimer);
        litTimer = setTimeout(() => setKeyClass('lit', []), Math.max(150, ev.dur * dur * 4 * 1000 * 0.85));
      }
      const nxt = melody.events[nextNoteIdx(i + 1)];
      setKeyClass('next', nxt ? [nxt.rel] : []);
    };
    transport.onLoop = null;
    transport.onFrame = (now) => {
      if (!along) return;
      const t = now - (Sound.ctx.outputLatency || 0);
      let changed = false;
      targets = targets.filter((g) => {
        if (g.done) return t - g.time < 2;
        if (t > g.time + 0.3) { score.miss++; markChip(g.i, 'miss'); changed = true; return false; }
        return true;
      });
      if (changed) renderScore();
    };
    transport.onStop = () => {
      $('#kb-play').textContent = '▶ Играть';
      $('#kb-play').classList.remove('on');
      setKeyClass('lit', []);
      setKeyClass('next', []);
      chipEls.forEach((c) => c.classList.remove('cur'));
      renderScore();
    };
    transport.start({ bpm: bpmCtl.value, spb: 4, total: Math.round(totalBeats * 4), countIn: countSteps });
    $('#kb-play').textContent = '■ Стоп';
    $('#kb-play').classList.add('on');
  }

  function alongNote(rel, t) {
    let best = null;
    targets.forEach((g) => {
      if (g.done || Math.abs(g.time - t) > 0.3) return;
      if (!best || (sameNote(g.rel, rel) && !sameNote(best.rel, rel)) || Math.abs(g.time - t) < Math.abs(best.time - t)) best = g;
    });
    if (!best) return;
    best.done = true;
    let res;
    if (!sameNote(best.rel, rel)) { res = 'wrong'; flashKey(rel, 'bad'); } else res = Math.abs(best.time - t) <= 0.09 ? 'hit' : 'off';
    score[res]++;
    markChip(best.i, res);
    renderScore();
  }

  $('#kb-play').addEventListener('click', () => toggle());
  $('#kb-desc').addEventListener('click', (e) => e.currentTarget.classList.toggle('open'));
  $('#kb-select').addEventListener('change', (e) => { history.replaceState(null, '', `#/keys/melody/${e.target.value}`); loadMelody(e.target.value); });
  $('#kb-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    transport.stop();
    st.mode = b.dataset.mode;
    Store.set('kb.mode', st.mode);
    renderMelody();
  });
  $('#kb-click').addEventListener('change', (e) => { st.click = e.target.checked; });
  $('#kb-count').addEventListener('change', (e) => { st.countIn = e.target.checked; });
  $('#kb-guide').addEventListener('change', (e) => { st.guide = e.target.checked; });

  // ───────── Аккорды ─────────
  const prog = () => PROGRESSIONS.find((p) => p.id === st.prog) || PROGRESSIONS[0];

  function renderChords() {
    const p = prog();
    $('#kb-prog').value = p.id;
    el.querySelectorAll('[data-cmode]').forEach((b) => b.classList.toggle('sel', b.dataset.cmode === st.cmode));
    $('#kb-cdock').hidden = st.cmode === 'wait';
    $('#kb-chordrow').innerHTML = p.chords.map((c, i) => `<button class="kb-chip" data-ci="${i}">${c}</button>`).join('');
    cBpmCtl.set(p.bpm, false);
    chordIdx = 0;
    showChord();
  }

  function showChord(lit) {
    const p = prog();
    const c = CHORDS[p.chords[chordIdx]];
    el.querySelectorAll('.kb-chip').forEach((b, i) => b.classList.toggle('cur', i === chordIdx));
    $('#kb-cname').textContent = p.chords[chordIdx];
    $('#kb-cdesc').textContent = `${c.name}: ${c.notes.map(noteName).join(' + ')}`;
    setKeyClass(lit ? 'lit' : 'next', c.notes);
    if (lit) setKeyClass('next', []);
    else setKeyClass('lit', []);
    if (st.cmode === 'wait') $('#kb-cstats').innerHTML = `<span>аккорд <b>${chordIdx + 1}</b> из ${p.chords.length}</span><span class="muted">зажмите все подсвеченные клавиши одновременно</span>`;
  }

  function checkChord() {
    if (st.cmode !== 'wait' || !chordArmed) return;
    const need = CHORDS[prog().chords[chordIdx]].notes;
    const held = [...pressed.keys()];
    const ok = need.every((n) => held.some((h) => sameNote(h, n)));
    if (!ok) return;
    chordArmed = false;
    const p = prog();
    el.querySelectorAll('.kb-chip')[chordIdx].classList.add('ok');
    chordIdx = (chordIdx + 1) % p.chords.length;
    if (chordIdx === 0) {
      UI.toast('🎉 Круг пройден! Ещё раз — или попробуйте «Слушать» и подыграть в темпе');
      el.querySelectorAll('.kb-chip').forEach((b) => b.classList.remove('ok'));
    }
    showChord();
  }

  function playChords() {
    const p = prog();
    const beats = p.beats;
    transport.onStep = (step, time, dur) => {
      if (step % 1 !== 0) return;
      if (st.click) Sound.click(time, step % beats === 0 ? 2 : 1, 'wood', 0.4);
      if (step % beats === 0) {
        const c = CHORDS[p.chords[step / beats]];
        c.notes.forEach((n) => sound(n, time, dur * beats * 0.95, 0.5));
      }
    };
    transport.onDraw = (step) => {
      if (step % beats !== 0) return;
      chordIdx = step / beats;
      showChord(true);
    };
    transport.onFrame = null;
    transport.onLoop = null;
    transport.onStop = () => {
      $('#kb-cplay').textContent = '▶ Играть';
      $('#kb-cplay').classList.remove('on');
      setKeyClass('lit', []);
      chordIdx = 0;
      showChord();
    };
    transport.start({ bpm: cBpmCtl.value, spb: 1, total: beats * p.chords.length, countIn: 0 });
    $('#kb-cplay').textContent = '■ Стоп';
    $('#kb-cplay').classList.add('on');
  }

  $('#kb-prog').addEventListener('change', (e) => { transport.stop(); st.prog = e.target.value; history.replaceState(null, '', `#/keys/chords/${st.prog}`); renderChords(); });
  $('#kb-cmodes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmode]');
    if (!b) return;
    transport.stop();
    st.cmode = b.dataset.cmode;
    renderChords();
  });
  $('#kb-cplay').addEventListener('click', () => toggle());
  $('#kb-chordrow').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ci]');
    if (!b || transport.playing) return;
    chordIdx = +b.dataset.ci;
    showChord();
    CHORDS[prog().chords[chordIdx]].notes.forEach((n) => sound(n, undefined, 1, 0.5));
  });

  // ───────── Уроки ─────────
  function renderLessons() {
    const idx = KEYS_LESSONS.findIndex((l) => l.id === st.lesson);
    const l = KEYS_LESSONS[idx];
    const done = Store.lessonDone('kb-' + l.id);
    const prev = KEYS_LESSONS[idx - 1];
    const next = KEYS_LESSONS[idx + 1];
    $('#kb-lessons').innerHTML = `
      <div class="two-col">
        <aside class="card list-col ${listOpen ? 'open' : ''}">
          <button class="lib-toggle" id="kb-ltoggle" aria-expanded="${listOpen}"><span>📖 Уроки клавишных <small>· ${KEYS_LESSONS.length}</small></span><b aria-hidden="true">▾</b></button>
          <h2 class="list-title">Уроки</h2>
          <ol class="lesson-list">
            ${KEYS_LESSONS.map((x, i) => `
              <li><a href="#/keys/lesson/${x.id}" class="${x.id === l.id ? 'active' : ''} ${Store.lessonDone('kb-' + x.id) ? 'done' : ''}">
                <span class="ln">${Store.lessonDone('kb-' + x.id) ? '✓' : i + 1}</span>
                <span><b>${UI.esc(x.title)}</b><small>${UI.esc(x.short)}</small></span>
              </a></li>`).join('')}
          </ol>
        </aside>
        <article class="card lesson">
          <div class="lesson-kicker">Клавиши · урок ${idx + 1} из ${KEYS_LESSONS.length}</div>
          <h1>${UI.esc(l.title)}</h1>
          <div class="lesson-body">${l.html}</div>
          <div class="lesson-foot">
            <button class="btn ${done ? '' : 'primary'}" id="kb-ldone">${done ? '✓ Урок пройден' : 'Отметить урок пройденным'}</button>
            <span class="spacer"></span>
            ${prev ? `<a class="btn" href="#/keys/lesson/${prev.id}">← ${UI.esc(prev.title)}</a>` : ''}
            ${next ? `<a class="btn" href="#/keys/lesson/${next.id}">${UI.esc(next.title)} →</a>` : ''}
          </div>
        </article>
      </div>`;
    $('#kb-ltoggle').addEventListener('click', () => { listOpen = !listOpen; renderLessons(); });
    $('#kb-ldone').addEventListener('click', () => {
      Store.setLesson('kb-' + l.id, !done);
      renderLessons();
      if (!done && next) UI.toast('Отлично! Дальше: ' + next.title);
    });
  }

  // ───────── Виды ─────────
  function rootClass() { el.querySelector('.kb').className = `ml kb view-${st.view} mode-${st.view === 'chords' ? st.cmode : st.mode}`; }

  function setView(v) {
    st.view = v;
    el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('sel', b.dataset.view === v));
    ['lessons', 'melody', 'chords', 'free'].forEach((x) => { $(`#kb-${x}`).hidden = x !== v; });
    transport.stop();
    setKeyClass('next', []);
    setKeyClass('lit', []);
    rootClass();
  }

  function toggle() {
    if (st.view === 'melody' && melody) {
      if (st.mode === 'wait') { startWait(); return; }
      transport.playing ? transport.stop() : playMelody();
    } else if (st.view === 'chords') {
      if (st.cmode === 'wait') { chordIdx = 0; renderChords(); return; }
      transport.playing ? transport.stop() : playChords();
    }
  }

  $('#kb-views').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    const v = b.dataset.view;
    location.hash = { lessons: `#/keys/lesson/${st.lesson}`, melody: `#/keys/melody/${st.mid}`, chords: `#/keys/chords/${st.prog}`, free: '#/keys/free' }[v];
  });

  renderPiano();

  return {
    show(params) {
      const [what, id] = params;
      if (what === 'melody') {
        setView('melody');
        if (!melody || melody.id !== id) loadMelody(id || st.mid);
        else { renderSelect(); renderMelody(); }
      } else if (what === 'chords') {
        if (id && PROGRESSIONS.some((p) => p.id === id)) st.prog = id;
        setView('chords');
        renderChords();
      } else if (what === 'free') {
        setView('free');
        showHeld();
      } else {
        if (what === 'lesson' && KEYS_LESSONS.some((l) => l.id === id)) st.lesson = id;
        listOpen = false;
        setView('lessons');
        renderLessons();
      }
      midiUi();
      window.scrollTo(0, 0);
    },
    toggle,
    hide() { transport.stop(); pressed.clear(); setKeyClass('down', []); },
  };
})();
