window.Pages = window.Pages || {};

/*
 * Учебная флейта (блокфлейта сопрано): уроки, аппликатура, тюнер и мелодии.
 * Микрофон слушает настоящую флейту: «Ждать меня» ждёт верную ноту, «В темпе» оценивает каждую.
 * Мелодии общие с металлофоном (Pages.mallet.api).
 */
Pages.flute = (() => {
  const el = document.getElementById('page-flute');
  const transport = new Transport();
  const M = window.MALLET;
  const LO = M.BASE_MIDI; // до¹ = самая низкая нота блокфлейты сопрано (523 Гц)
  const HI = LO + 24;
  const LETTERS = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  const SUP = { 1: '¹', 2: '²', 3: '³' };
  const api = () => Pages.mallet.api;

  const st = {
    view: 'lessons',
    lesson: FLUTE_LESSONS[0].id,
    mid: 'hotcross',
    mode: Store.get('fl.mode', 'wait'),
    system: Store.get('fl.system', 'german'),
    click: true,
    countIn: true,
    guide: false,
    sharps: false,
  };
  let melody = null;
  let chipEls = [];
  let waitIdx = 0;
  let waitErrors = 0;
  let targets = [];
  let score = { hit: 0, off: 0, wrong: 0, miss: 0 };
  let bpmCtl = null;
  let listOpen = false;
  let lastShown = null;

  // ───────── Ноты и аппликатура ─────────
  const keyOf = (midi) => { const r = midi - LO; return `${LETTERS[r % 12]}${Math.floor(r / 12) + 1}`; };
  function label(midi) {
    const r = midi - LO;
    const letter = LETTERS[((r % 12) + 12) % 12];
    return {
      text: `${M.RU[letter[0]]}${letter.length > 1 ? '♯' : ''}`,
      oct: Math.floor(r / 12) + 1,
      cls: letter.length > 1 ? 'nc-sharp' : `nc-${letter[0]}`,
    };
  }

  function holeSvg(cx, cy, r, v) {
    if (v === '1') return `<circle cx="${cx}" cy="${cy}" r="${r}" class="fh-c"/>`;
    const open = `<circle cx="${cx}" cy="${cy}" r="${r}" class="fh-o"/>`;
    if (v === 'h') return `${open}<path d="M${cx} ${cy - r} A${r} ${r} 0 0 0 ${cx} ${cy + r} Z" class="fh-c"/>`;
    return open;
  }
  function doubleSvg(cx, cy, v) {
    return holeSvg(cx - 5.5, cy, 4.2, v === '0' ? '0' : '1') + holeSvg(cx + 5.5, cy, 4.2, v === '1' ? '1' : '0');
  }

  // Картинка аппликатуры: большой палец (сзади) слева, отверстия 1–7 сверху вниз
  function fingSvg(midi, cls = '') {
    const f = midi !== null && FINGERINGS[st.system][keyOf(midi)];
    if (!f) return `<div class="fing-none ${cls}">нет в диапазоне</div>`;
    const h = f.holes;
    const ys = [44, 68, 92, 124, 148, 176, 202];
    let holes = '';
    for (let i = 0; i < 7; i++) {
      holes += i < 5 ? holeSvg(36, ys[i], 7.5, h[i]) : doubleSvg(36, ys[i], h[i]);
    }
    return `
      <svg class="fing ${cls}" viewBox="0 0 60 236" role="img" aria-label="Аппликатура">
        <rect x="24" y="6" width="24" height="224" rx="12" class="fb"/>
        <path d="M24 18 h24" class="fl"/>
        ${holeSvg(9, 38, 6.5, f.thumb)}
        <text x="9" y="56" class="ft">зад</text>
        <path d="M22 108 h28" class="fl sep"/>
        ${holes}
        <text x="36" y="232" class="ft">правая</text>
        <text x="36" y="16" class="ft">левая</text>
      </svg>`;
  }

  // ───────── Каркас ─────────
  el.innerHTML = `
    <div class="ml fl">
      <header class="tr-head">
        <div>
          <div class="eyebrow">блокфлейта сопрано · строй «до»</div>
          <h1 class="tr-title">Флейта</h1>
        </div>
        <div class="seg inst-switch"><a href="#/mallet">Металлофон</a><a class="sel" href="#/flute">Флейта</a><a href="#/keys">Клавиши</a></div>
        <div class="seg" id="fl-views">
          <button data-view="lessons">Уроки</button>
          <button data-view="melody">Мелодии</button>
          <button data-view="chart">Аппликатура</button>
        </div>
      </header>

      <section id="fl-lessons"></section>

      <section id="fl-melody" hidden>
        <div class="card ml-player">
          <div class="ml-top">
            <label class="ml-pick"><span class="eyebrow">мелодия</span><select id="fl-select"></select></label>
            <a class="tbtn" id="fl-edit" href="#/mallet">✎ В редакторе</a>
          </div>
          <p class="tr-note" id="fl-desc"></p>
          <div class="seg ml-modes" id="fl-modes" role="radiogroup" aria-label="Режим">
            <button data-mode="listen">👂 Слушать</button>
            <button data-mode="wait">⏸ Ждать меня</button>
            <button data-mode="along">🎯 В темпе</button>
          </div>
          <div class="fl-mic">
            <button class="btn" id="fl-mic">🎤 Слушать флейту</button>
            <span class="fl-heard" id="fl-heard" aria-live="polite">микрофон выключен</span>
            <span class="fl-level"><i id="fl-level"></i></span>
          </div>
          <div class="fl-stage">
            <div class="fl-now">
              <div class="eyebrow" id="fl-now-l">играйте</div>
              <div class="fl-note" id="fl-now-n">—</div>
              <div id="fl-now-f"></div>
            </div>
            <div class="fl-next">
              <div class="eyebrow">дальше</div>
              <div class="fl-note small" id="fl-next-n">—</div>
              <div id="fl-next-f"></div>
            </div>
          </div>
          <div class="controls dock" id="fl-dock">
            <button class="btn play" id="fl-play">▶ Играть</button>
            <span id="fl-bpm"></span>
          </div>
          <div class="controls options" id="fl-opts">
            <label class="toggle"><input type="checkbox" id="fl-click" checked> Щелчок</label>
            <label class="toggle"><input type="checkbox" id="fl-count" checked> Отсчёт</label>
            <label class="toggle" id="fl-guide-l"><input type="checkbox" id="fl-guide"> Подсказка звуком</label>
          </div>
          <div class="fl-manual" id="fl-manual">
            <button class="btn" id="fl-hear">🔈 Как звучит</button>
            <button class="btn primary" id="fl-ok">✓ Сыграл — дальше</button>
          </div>
          <div class="ml-ribbon-wrap"><div class="ml-ribbon" id="fl-ribbon"></div></div>
          <div class="ml-stats" id="fl-stats" aria-live="polite"></div>
        </div>
      </section>

      <section id="fl-chart" hidden>
        <div class="card">
          <div class="ml-inst-head">
            <div class="seg" id="fl-system">
              <button data-system="german">Немецкая</button>
              <button data-system="baroque">Барочная</button>
            </div>
            <label class="toggle"><input type="checkbox" id="fl-sharps"> Показать диезы</label>
          </div>
          <p class="tr-note">Нажмите на ноту — услышите, как она звучит. Не знаете систему своей флейты? Смотрите первый урок.</p>
          <div class="fing-grid" id="fl-grid"></div>
        </div>
        <div class="card fl-tuner">
          <div class="eyebrow">тюнер</div>
          <div class="fl-tuner-row">
            <div>
              <div class="fl-note big" id="tn-note">—</div>
              <div class="tn-meter"><i class="tn-zero"></i><i class="tn-needle" id="tn-needle"></i></div>
              <div class="tn-labels"><span>ниже</span><span id="tn-cents">0</span><span>выше</span></div>
              <button class="btn" id="tn-mic">🎤 Включить микрофон</button>
              <p class="tr-note">Сыграйте ноту и держите её: стрелка в центре — нота чистая. Ниже — дуйте чуть быстрее, выше — мягче.</p>
            </div>
            <div id="tn-fing"></div>
          </div>
        </div>
      </section>
    </div>`;

  const $ = (s) => el.querySelector(s);

  bpmCtl = UI.bpmControl({ value: 80, min: 30, max: 200, onChange: (v) => { transport.bpm = v; } });
  $('#fl-bpm').appendChild(bpmCtl.el);

  // ───────── Микрофон ─────────
  async function micToggle() {
    if (Pitch.active) { Pitch.stop(); micUi(); return; }
    try {
      await Pitch.start(onPitch);
    } catch (e) {
      UI.toast('Нет доступа к микрофону — разрешите его в настройках браузера');
    }
    micUi();
  }

  function micUi() {
    const on = Pitch.active;
    $('#fl-mic').textContent = on ? '🎤 Микрофон включён' : '🎤 Слушать флейту';
    $('#fl-mic').classList.toggle('primary', on);
    $('#tn-mic').textContent = on ? '🎤 Выключить микрофон' : '🎤 Включить микрофон';
    if (!on) {
      $('#fl-heard').textContent = 'микрофон выключен';
      $('#fl-level').style.width = '0%';
    }
    $('#fl-manual').hidden = !(st.mode === 'wait' && !on);
  }

  $('#fl-mic').addEventListener('click', micToggle);
  $('#tn-mic').addEventListener('click', micToggle);

  function onPitch(fr) {
    const level = Math.min(100, Math.round(fr.rms * 900));
    if (st.view === 'melody') {
      $('#fl-level').style.width = `${level}%`;
      $('#fl-heard').innerHTML = fr.midi ? `слышу <b>${noteName(fr.midi)}</b>` : 'тишина';
    } else if (st.view === 'chart') {
      showTuner(fr);
    }
    if (fr.note !== null) onNote(fr.note, fr.noteTime);
  }

  function noteName(midi) {
    if (midi < LO - 12 || midi > HI + 12) return '?';
    const lb = label(midi);
    return `${lb.text}${SUP[lb.oct] || ''}`;
  }

  function onNote(midi, time) {
    if (st.view !== 'melody' || !melody) return;
    if (st.mode === 'wait') waitNote(midi);
    else if (st.mode === 'along' && transport.playing) alongNote(midi, time);
  }

  // ───────── Тюнер ─────────
  function showTuner(fr) {
    if (!fr.midi) return;
    $('#tn-note').textContent = noteName(fr.midi);
    const c = UI.clamp(fr.cents, -50, 50);
    $('#tn-needle').style.left = `${50 + c}%`;
    $('#tn-needle').classList.toggle('good', Math.abs(c) <= 10);
    $('#tn-cents').textContent = `${c > 0 ? '+' : ''}${c} ц`;
    if (fr.midi !== lastShown) {
      lastShown = fr.midi;
      $('#tn-fing').innerHTML = fr.midi >= LO && fr.midi <= HI ? fingSvg(fr.midi, 'mid') : '';
    }
  }

  // ───────── Таблица аппликатуры ─────────
  function renderChart() {
    el.querySelectorAll('[data-system]').forEach((b) => b.classList.toggle('sel', b.dataset.system === st.system));
    let html = '';
    for (let m = LO; m <= HI; m++) {
      const lb = label(m);
      if (lb.cls === 'nc-sharp' && !st.sharps) continue;
      html += `<button class="fing-card" data-midi="${m}"><b class="${lb.cls}">${lb.text}<sup>${SUP[lb.oct]}</sup></b>${fingSvg(m, 'mini')}</button>`;
    }
    $('#fl-grid').innerHTML = html;
  }

  $('#fl-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-midi]');
    if (b) Sound.flute(+b.dataset.midi, undefined, 0.8);
  });
  $('#fl-system').addEventListener('click', (e) => {
    const b = e.target.closest('[data-system]');
    if (!b) return;
    st.system = b.dataset.system;
    Store.set('fl.system', st.system);
    renderChart();
    lastShown = null;
    if (melody) showTargets();
  });
  $('#fl-sharps').addEventListener('change', (e) => { st.sharps = e.target.checked; renderChart(); });

  // ───────── Мелодии ─────────
  function renderSelect() {
    const all = api().allMelodies();
    const cats = [...new Set(all.map((m) => m.cat))];
    $('#fl-select').innerHTML = cats.map((c) => `<optgroup label="${UI.esc(c)}">${all.filter((m) => m.cat === c).map((m) => `<option value="${m.id}" ${melody && m.id === melody.id ? 'selected' : ''}>${UI.esc(m.name)}</option>`).join('')}</optgroup>`).join('');
  }

  function loadMelody(id) {
    transport.stop();
    const src = api().findMelody(id) || api().findMelody('hotcross');
    st.mid = src.id;
    const p = api().parse(src.notes);
    melody = { ...src, events: p.events, total: p.total, pickup: src.pickup || 0 };
    bpmCtl.set(src.bpm || 80, false);
    transport.bpm = bpmCtl.value;
    $('#fl-edit').href = `#/mallet/melody/${src.id}`;
    renderSelect();
    renderMelody();
  }

  function renderMelody() {
    $('#fl-desc').textContent = melody.desc || 'Ваша мелодия.';
    el.querySelectorAll('[data-mode]').forEach((b) => {
      b.classList.toggle('sel', b.dataset.mode === st.mode);
      b.setAttribute('aria-checked', b.dataset.mode === st.mode);
    });
    $('#fl-guide-l').hidden = st.mode !== 'along';
    $('#fl-dock').hidden = st.mode === 'wait';
    $('#fl-opts').hidden = st.mode === 'wait';
    el.querySelector('.fl').className = `ml fl view-${st.view} mode-${st.mode}`;
    renderRibbon();
    resetScore();
    micUi();
    if (st.mode === 'wait') startWait();
    else showNotes(null, firstNote());
  }

  function renderRibbon() {
    $('#fl-ribbon').innerHTML = melody.events.map((e, i) => {
      const bar = e.bar ? '<i class="ml-barline" aria-hidden="true"></i>' : '';
      if (e.midi === null) return `${bar}<button class="ml-chip rest" data-i="${i}" style="--d:${e.dur}">𝄽</button>`;
      const lb = label(e.midi);
      return `${bar}<button class="ml-chip ${lb.cls}" data-i="${i}" style="--d:${e.dur}"><b>${lb.text}<sup>${SUP[lb.oct]}</sup></b></button>`;
    }).join('');
    chipEls = [...el.querySelectorAll('#fl-ribbon .ml-chip')];
  }

  const nextNoteIdx = (i) => { while (i < melody.events.length && melody.events[i].midi === null) i++; return i; };
  const firstNote = () => { const e = melody.events[nextNoteIdx(0)]; return e ? e.midi : null; };

  function showNotes(now, next) {
    $('#fl-now-n').innerHTML = now === null || now === undefined ? '—' : noteName(now);
    $('#fl-now-f').innerHTML = now === null || now === undefined ? '' : fingSvg(now, 'big');
    $('#fl-now-l').textContent = st.mode === 'wait' ? 'сыграйте' : 'сейчас';
    $('#fl-next-n').innerHTML = next === null || next === undefined ? '—' : noteName(next);
    $('#fl-next-f').innerHTML = next === null || next === undefined ? '' : fingSvg(next, 'small');
  }

  function showTargets() {
    if (st.mode === 'wait') showWaitTarget();
    else showNotes(null, firstNote());
  }

  function markChip(i, cls, on = true) { if (chipEls[i]) chipEls[i].classList.toggle(cls, on); }
  function scrollToChip(i) {
    const c = chipEls[i];
    const wrap = el.querySelector('#fl-melody .ml-ribbon-wrap');
    if (!c || !wrap) return;
    const x = c.offsetLeft - wrap.offsetLeft;
    if (x < wrap.scrollLeft + 20 || x > wrap.scrollLeft + wrap.clientWidth - 80) wrap.scrollTo({ left: x - 40, behavior: 'smooth' });
  }

  $('#fl-ribbon').addEventListener('click', (e) => {
    const c = e.target.closest('.ml-chip');
    if (!c) return;
    const i = +c.dataset.i;
    const ev = melody.events[i];
    if (st.mode === 'wait' && ev.midi !== null) { waitIdx = i; showWaitTarget(); }
    if (ev.midi !== null && !transport.playing) Sound.flute(ev.midi, undefined, 0.6);
  });

  // «Ждать меня»
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
    if (!ev) { showNotes(null, null); return; }
    markChip(waitIdx, 'cur');
    scrollToChip(waitIdx);
    const nxt = melody.events[nextNoteIdx(waitIdx + 1)];
    showNotes(ev.midi, nxt ? nxt.midi : null);
    const played = melody.events.slice(0, waitIdx).filter((e) => e.midi !== null).length;
    const total = melody.events.filter((e) => e.midi !== null).length;
    $('#fl-stats').innerHTML = `<span>нота <b>${played + 1}</b> из ${total}</span><span>ошибок <b>${waitErrors}</b></span>` +
      (Pitch.active ? '<span class="muted">сыграйте ноту на флейте — приложение услышит</span>' : '<span class="muted">включите микрофон или нажимайте «Сыграл»</span>');
  }

  function waitNote(midi) {
    const ev = melody.events[waitIdx];
    if (!ev) return;
    if (midi === ev.midi) advanceWait();
    else if (Math.abs(midi - ev.midi) <= 14) {
      waitErrors++;
      markChip(waitIdx, 'bad');
      setTimeout(() => markChip(waitIdx, 'bad', false), 350);
      $('#fl-heard').innerHTML = `слышу <b>${noteName(midi)}</b> — нужна <b>${noteName(ev.midi)}</b>${midi === ev.midi + 12 ? ' (октавой выше — дуйте мягче)' : midi === ev.midi - 12 ? ' (октавой ниже)' : ''}`;
      showWaitTarget();
    }
  }

  function advanceWait() {
    markChip(waitIdx, 'cur', false);
    markChip(waitIdx, 'ok');
    waitIdx = nextNoteIdx(waitIdx + 1);
    if (waitIdx >= melody.events.length) {
      showNotes(null, null);
      $('#fl-stats').innerHTML = `<span>🎉 <b>Сыграно!</b></span><span>ошибок <b>${waitErrors}</b></span><span class="muted">${waitErrors ? 'Ещё раз — и попробуйте без ошибок.' : 'Без ошибок! Попробуйте «В темпе».'}</span>`;
      setTimeout(() => { if (st.mode === 'wait' && waitIdx >= melody.events.length) startWait(); }, 2500);
      return;
    }
    showWaitTarget();
  }

  $('#fl-ok').addEventListener('click', () => { if (st.mode === 'wait') advanceWait(); });
  $('#fl-hear').addEventListener('click', () => {
    const ev = melody && melody.events[waitIdx];
    if (ev && ev.midi !== null) Sound.flute(ev.midi, undefined, 0.8);
  });
  $('#fl-now-f').addEventListener('click', () => {
    const ev = st.mode === 'wait' && melody && melody.events[waitIdx];
    if (ev && ev.midi !== null) Sound.flute(ev.midi, undefined, 0.8);
  });

  // «Слушать» и «В темпе»
  function resetScore() {
    score = { hit: 0, off: 0, wrong: 0, miss: 0 };
    targets = [];
    renderScore();
  }

  function renderScore() {
    if (st.mode === 'listen') {
      $('#fl-stats').innerHTML = '<span class="muted">Слушайте мелодию и смотрите на аппликатуру — можно беззвучно «играть пальцами» вместе с приложением.</span>';
    } else if (st.mode === 'along') {
      const n = score.hit + score.off + score.wrong + score.miss;
      $('#fl-stats').innerHTML = (Pitch.active ? '' : '<span class="bad">включите микрофон, чтобы приложение оценивало ноты</span>') + `
        <span>точность <b>${n ? Math.round((score.hit / n) * 100) + '%' : '—'}</b></span>
        <span class="good">в точку <b>${score.hit}</b></span>
        <span class="warn">не в ритм <b>${score.off}</b></span>
        <span class="bad">не та нота <b>${score.wrong}</b></span>
        <span class="bad">пропуск <b>${score.miss}</b></span>`;
    }
  }

  function play() {
    if (!melody.events.length) return;
    const beats = melody.beats || 4;
    const pickup = melody.pickup || 0;
    const totalBeats = pickup + Math.ceil(Math.max(0, melody.total - pickup) / beats) * beats;
    const steps = Math.round(totalBeats * 4);
    const byStep = new Map();
    melody.events.forEach((e, i) => byStep.set(Math.round(e.start * 4), i));
    const along = st.mode === 'along';
    const countSteps = st.countIn || along ? beats * 4 : 0;
    resetScore();

    transport.onStep = (step, time, dur) => {
      const onBeat = step % 4 === 0;
      if (step < 0) {
        if (onBeat) Sound.click(time, step === -countSteps ? 2 : 1, 'wood');
        return;
      }
      if (st.click && onBeat) {
        const b = step / 4 - pickup;
        Sound.click(time, ((b % beats) + beats) % beats === 0 ? 2 : 1, 'wood', 0.45);
      }
      const i = byStep.get(step);
      if (i === undefined) return;
      const ev = melody.events[i];
      if (ev.midi === null) return;
      const sec = ev.dur * 4 * dur * 0.92;
      if (!along) Sound.flute(ev.midi, time, sec, 0.9);
      else {
        if (st.guide) Sound.flute(ev.midi, time, sec, 0.35);
        if (Pitch.active) targets.push({ time, i, midi: ev.midi, done: false });
      }
    };
    transport.onDraw = (step) => {
      if (step < 0) {
        if (step % 4 === 0) $('#fl-stats').innerHTML = `<span>отсчёт <b>${(step + countSteps) / 4 + 1}</b></span>`;
        return;
      }
      if (step === 0) { chipEls.forEach((c) => c.classList.remove('cur', 'hit', 'off', 'wrong', 'miss')); renderScore(); }
      const i = byStep.get(step);
      if (i === undefined) return;
      chipEls.forEach((c) => c.classList.remove('cur'));
      markChip(i, 'cur');
      scrollToChip(i);
      const nxt = melody.events[nextNoteIdx(i + 1)];
      showNotes(melody.events[i].midi, nxt ? nxt.midi : null);
    };
    transport.onLoop = null;
    transport.onFrame = (now) => {
      if (!along) return;
      let changed = false;
      targets = targets.filter((g) => {
        if (g.done) return now - g.time < 2;
        if (now > g.time + 0.45) { score.miss++; markChip(g.i, 'miss'); changed = true; return false; }
        return true;
      });
      if (changed) renderScore();
    };
    transport.onStop = () => {
      $('#fl-play').textContent = '▶ Играть';
      $('#fl-play').classList.remove('on');
      chipEls.forEach((c) => c.classList.remove('cur'));
      showNotes(null, firstNote());
      renderScore();
    };
    transport.start({ bpm: bpmCtl.value, spb: 4, total: steps, countIn: countSteps });
    $('#fl-play').textContent = '■ Стоп';
    $('#fl-play').classList.add('on');
  }

  function alongNote(midi, t) {
    let best = null;
    targets.forEach((g) => {
      if (g.done || Math.abs(g.time - t) > 0.35) return;
      if (!best || (g.midi === midi && best.midi !== midi) || Math.abs(g.time - t) < Math.abs(best.time - t)) best = g;
    });
    if (!best) return;
    best.done = true;
    t -= Sound.ctx.outputLatency || 0; // вы играете под щелчок, который слышите с задержкой
    const res = best.midi !== midi ? 'wrong' : Math.abs(best.time - t) <= 0.15 ? 'hit' : 'off';
    score[res]++;
    markChip(best.i, res);
    renderScore();
  }

  function toggle() {
    if (st.view !== 'melody' || !melody) return;
    if (st.mode === 'wait') { startWait(); return; }
    transport.playing ? transport.stop() : play();
  }

  $('#fl-play').addEventListener('click', toggle);
  $('#fl-desc').addEventListener('click', (e) => e.currentTarget.classList.toggle('open'));
  $('#fl-select').addEventListener('change', (e) => { history.replaceState(null, '', `#/flute/melody/${e.target.value}`); loadMelody(e.target.value); });
  $('#fl-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    transport.stop();
    st.mode = b.dataset.mode;
    Store.set('fl.mode', st.mode);
    renderMelody();
  });
  $('#fl-click').addEventListener('change', (e) => { st.click = e.target.checked; });
  $('#fl-count').addEventListener('change', (e) => { st.countIn = e.target.checked; });
  $('#fl-guide').addEventListener('change', (e) => { st.guide = e.target.checked; });

  // ───────── Уроки ─────────
  function renderLessons() {
    const idx = FLUTE_LESSONS.findIndex((l) => l.id === st.lesson);
    const l = FLUTE_LESSONS[idx];
    const done = Store.lessonDone('fl-' + l.id);
    const prev = FLUTE_LESSONS[idx - 1];
    const next = FLUTE_LESSONS[idx + 1];
    $('#fl-lessons').innerHTML = `
      <div class="two-col">
        <aside class="card list-col ${listOpen ? 'open' : ''}">
          <button class="lib-toggle" id="fl-ltoggle" aria-expanded="${listOpen}"><span>📖 Уроки флейты <small>· ${FLUTE_LESSONS.length}</small></span><b aria-hidden="true">▾</b></button>
          <h2 class="list-title">Уроки</h2>
          <ol class="lesson-list">
            ${FLUTE_LESSONS.map((x, i) => `
              <li><a href="#/flute/lesson/${x.id}" class="${x.id === l.id ? 'active' : ''} ${Store.lessonDone('fl-' + x.id) ? 'done' : ''}">
                <span class="ln">${Store.lessonDone('fl-' + x.id) ? '✓' : i + 1}</span>
                <span><b>${UI.esc(x.title)}</b><small>${UI.esc(x.short)}</small></span>
              </a></li>`).join('')}
          </ol>
        </aside>
        <article class="card lesson">
          <div class="lesson-kicker">Флейта · урок ${idx + 1} из ${FLUTE_LESSONS.length}</div>
          <h1>${UI.esc(l.title)}</h1>
          <div class="lesson-body">${l.html}</div>
          <div class="lesson-foot">
            <button class="btn ${done ? '' : 'primary'}" id="fl-ldone">${done ? '✓ Урок пройден' : 'Отметить урок пройденным'}</button>
            <span class="spacer"></span>
            ${prev ? `<a class="btn" href="#/flute/lesson/${prev.id}">← ${UI.esc(prev.title)}</a>` : ''}
            ${next ? `<a class="btn" href="#/flute/lesson/${next.id}">${UI.esc(next.title)} →</a>` : ''}
          </div>
        </article>
      </div>`;
    $('#fl-ltoggle').addEventListener('click', () => { listOpen = !listOpen; renderLessons(); });
    $('#fl-ldone').addEventListener('click', () => {
      Store.setLesson('fl-' + l.id, !done);
      renderLessons();
      if (!done && next) UI.toast('Отлично! Дальше: ' + next.title);
    });
  }

  // ───────── Виды ─────────
  function setView(v) {
    st.view = v;
    el.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('sel', b.dataset.view === v));
    $('#fl-lessons').hidden = v !== 'lessons';
    $('#fl-melody').hidden = v !== 'melody';
    $('#fl-chart').hidden = v !== 'chart';
    el.querySelector('.fl').className = `ml fl view-${v} mode-${st.mode}`;
    if (v !== 'melody') transport.stop();
  }

  $('#fl-views').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    const v = b.dataset.view;
    location.hash = v === 'lessons' ? `#/flute/lesson/${st.lesson}` : v === 'melody' ? `#/flute/melody/${st.mid}` : '#/flute/chart';
  });

  return {
    show(params) {
      const [what, id] = params;
      if (what === 'melody') {
        setView('melody');
        if (!melody || melody.id !== id) loadMelody(id || st.mid);
        else renderSelect();
      } else if (what === 'chart') {
        setView('chart');
        renderChart();
        lastShown = null;
      } else {
        if (what === 'lesson' && FLUTE_LESSONS.some((l) => l.id === id)) st.lesson = id;
        listOpen = false;
        setView('lessons');
        renderLessons();
      }
      micUi();
      window.scrollTo(0, 0);
    },
    toggle,
    hide() { transport.stop(); Pitch.stop(); micUi(); },
  };
})();
