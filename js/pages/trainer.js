window.Pages = window.Pages || {};

/*
 * Тренажёр: три режима.
 *   «Точность»      — стучите по долям, удары ложатся на колесо, считаем отклонение в мс.
 *   «Играй партию»  — выбранная партия ритма заглушена, вы играете её сами, каждый удар оценивается.
 *   «Слух»          — угадать ритм, направление клаве или деление доли.
 */
Pages.trainer = (() => {
  const el = document.getElementById('page-trainer');
  const transport = new Transport();
  const earTransport = new Transport();

  const MODES = { pulse: 'Точность', part: 'Играй партию', ear: 'Слух' };
  const SUBS = { 1: 'четверти', 2: 'восьмые', 3: 'триоли', 4: 'шестнадцатые' };
  const INST_COLOR = {
    macho: '--voice-b', hembra: '--voice-a', clave: '--st-perc', bell: '--st-bell', shaker: '--muted', bass: '--st-H',
  };

  const st = {
    mode: Store.get('t.mode', 'pulse'),
    bpm: Store.get('t.bpm', 80),
    sub: 1,
    win: 30, // окно «в точку», мс
    click: true,
    countIn: true,
    offset: Store.get('t.offset', 0), // поправка задержки, мс
    stroke: 'O',
    rid: Store.get('t.rid', 'martillo'),
    part: Store.get('t.part', 'bongo'), // индекс партии или 'bongo'
  };
  if (!MODES[st.mode]) st.mode = 'pulse';

  // ───────── Состояние сессии ─────────
  let timeline = []; // запланированные шаги {step, time, dur}
  let expected = []; // «Точность»: времена целевых клеток
  let devs = []; // «Точность»: отклонения, мс
  let targets = []; // «Играй партию»: {time, step, done}
  let stepRes = {}; // «Играй партию»: последний результат по клетке
  let score = { hit: 0, off: 0, miss: 0, extra: 0, offSum: 0 };
  let marks = []; // следы ударов на колесе {pos, ring, res, t}
  let lastDev = null;
  let calibrating = false;
  let calTaps = [];

  // ───────── Каркас ─────────
  el.innerHTML = `
    <div class="tr">
      <header class="tr-head">
        <div>
          <div class="eyebrow">тренажёр</div>
          <h1 class="tr-title">Играйте — приложение слушает</h1>
        </div>
        <div class="seg" id="tr-modes" role="tablist" aria-label="Режим">
          ${Object.entries(MODES).map(([k, v]) => `<button data-mode="${k}" role="tab">${v}</button>`).join('')}
        </div>
      </header>

      <div class="tr-transport" id="tr-transport">
        <button class="tr-play" id="tr-play" aria-label="Старт"><svg width="17" height="19" viewBox="0 0 17 19" aria-hidden="true"><path d="M1 1.5 16 9.5 1 17.5Z" fill="currentColor"/></svg></button>
        <div class="tr-tempo">
          <div class="tr-bpm"><b id="tr-bpmv">${st.bpm}</b><span>bpm</span></div>
          <input type="range" id="tr-bpm" min="30" max="240" value="${st.bpm}" aria-label="Темп">
        </div>
        <div class="tr-tgroup">
          <button class="tbtn" id="tr-minus" aria-label="Медленнее на 5">−5</button>
          <button class="tbtn" id="tr-plus" aria-label="Быстрее на 5">+5</button>
          <button class="tbtn" id="tr-tap">tap</button>
          <button class="tbtn" id="tr-click" aria-pressed="${st.click}">клик</button>
          <button class="tbtn" id="tr-count" aria-pressed="${st.countIn}">отсчёт</button>
        </div>
        <div class="tr-dots" id="tr-dots" aria-hidden="true"></div>
      </div>

      <section id="tr-play-sec">
        <div class="tr-stage card">
          <div class="tr-wheelbox">
            <canvas id="tr-wheel" aria-label="Колесо ритма: цели и ваши удары"></canvas>
            <div class="tr-cycle" id="tr-cycle"></div>
          </div>
          <div class="tr-side">
            <div id="tr-setup"></div>
            <div class="tr-stats" id="tr-stats"></div>
            <p class="tr-advice" id="tr-advice"></p>
            <div class="tr-calib">
              <button class="tbtn" id="tr-reset">сбросить</button>
              <button class="tbtn" id="tr-cal">калибровка задержки</button>
              <span class="eyebrow">поправка <b id="tr-offset">${st.offset}</b> мс</span>
            </div>
          </div>
        </div>

        <div class="card tr-pads">
          <div class="tr-strokes" id="tr-strokes">
            ${['O', 'S', 'M', 'T'].map((k) => `<button class="tbtn" data-stroke="${k}" aria-pressed="${k === st.stroke}"><i class="sw st-${k}"></i>${STROKES[k].name}</button>`).join('')}
          </div>
          <div class="pads">
            <button class="pad pad-macho" data-drum="macho"><b>Мачо</b><small><kbd>J</kbd> · шлепок <kbd>K</kbd></small></button>
            <button class="pad pad-hembra" data-drum="hembra"><b>Эмбра</b><small><kbd>F</kbd> · шлепок <kbd>D</kbd></small></button>
          </div>
          <p class="eyebrow center">стучите по кругам или клавишам · пробел — старт/стоп</p>
        </div>
      </section>

      <section id="tr-ear-sec" hidden>
        <div class="card tr-ear">
          <div class="eyebrow">тренажёр слуха</div>
          <div class="tr-tgroup" id="ear-modes">
            <button class="tbtn" data-ear="name">что за ритм</button>
            <button class="tbtn" data-ear="clave">3-2 или 2-3</button>
            <button class="tbtn" data-ear="meter">на два или на три</button>
          </div>
          <p class="tr-note" id="ear-hint"></p>
          <div class="tr-tgroup">
            <button class="btn primary" id="ear-play">▶ Слушать</button>
            <button class="btn" id="ear-next">Следующий</button>
          </div>
          <div class="ear-opts" id="ear-opts"></div>
          <p class="tr-note" id="ear-reveal"></p>
          <div class="ear-score">
            <span>верно <b id="ear-right">0</b></span>
            <span>всего <b id="ear-total">0</b></span>
            <span>подряд <b id="ear-streak">0</b></span>
            <span>рекорд <b id="ear-best">0</b></span>
          </div>
        </div>
      </section>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const wheel = $('#tr-wheel');

  // ───────── Общие элементы управления ─────────
  function setBpm(v) {
    st.bpm = UI.clamp(Math.round(v), 30, 240);
    $('#tr-bpm').value = st.bpm;
    $('#tr-bpmv').textContent = st.bpm;
    transport.bpm = st.bpm;
    Store.set('t.bpm', st.bpm);
  }
  $('#tr-bpm').addEventListener('input', (e) => setBpm(+e.target.value));
  $('#tr-minus').addEventListener('click', () => setBpm(st.bpm - 5));
  $('#tr-plus').addEventListener('click', () => setBpm(st.bpm + 5));
  $('#tr-tap').addEventListener('click', UI.tapTempo(setBpm));
  $('#tr-click').addEventListener('click', (e) => { st.click = !st.click; e.currentTarget.setAttribute('aria-pressed', st.click); });
  $('#tr-count').addEventListener('click', (e) => { st.countIn = !st.countIn; e.currentTarget.setAttribute('aria-pressed', st.countIn); });
  $('#tr-play').addEventListener('click', toggle);
  $('#tr-reset').addEventListener('click', () => { resetSession(); draw(); });
  $('#tr-cal').addEventListener('click', startCalibration);

  $('#tr-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === st.mode) return;
    stopAll();
    st.mode = b.dataset.mode;
    Store.set('t.mode', st.mode);
    render();
  });

  $('#tr-strokes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stroke]');
    if (!b) return;
    st.stroke = b.dataset.stroke;
    el.querySelectorAll('[data-stroke]').forEach((x) => x.setAttribute('aria-pressed', x === b));
  });

  el.querySelectorAll('.pad').forEach((p) => p.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hit(p.dataset.drum, st.stroke, e);
  }));

  const KEYS = { KeyJ: ['macho', null], KeyF: ['hembra', null], KeyK: ['macho', 'S'], KeyD: ['hembra', 'S'] };
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('active') || e.repeat || st.mode === 'ear') return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const k = KEYS[e.code];
    if (!k) return;
    e.preventDefault();
    hit(k[0], k[1] || st.stroke, e);
  });

  // ───────── Текущий «ритм» для колеса ─────────
  function rhythm() {
    return UI.findRhythm(st.rid) || UI.findRhythm('martillo');
  }

  function partOptions(r) {
    const opts = r.tracks.map((t, i) => ({ key: String(i), label: (INSTRUMENTS[t.i] || {}).full || t.i, idx: [i] }));
    const drums = r.tracks.map((t, i) => ((INSTRUMENTS[t.i] || {}).kind === 'drum' ? i : -1)).filter((i) => i >= 0);
    if (drums.length > 1) opts.unshift({ key: 'bongo', label: 'Все партии бонго', idx: drums });
    return opts;
  }

  function yourTracks(r) {
    const opts = partOptions(r);
    const o = opts.find((x) => x.key === String(st.part)) || opts[0];
    st.part = o.key;
    return o.idx;
  }

  // Модель колеса для текущего режима
  function model() {
    if (st.mode === 'pulse' || calibrating) {
      const sub = calibrating ? 1 : st.sub;
      const total = 4 * sub;
      const p = Array.from({ length: total }, (_, s) => (s % sub === 0 ? 'X' : 'x')).join('');
      return {
        total, spb: sub, beats: 4, bars: 1, starts: new Set([0, 1, 2, 3].map((b) => b * sub)),
        rings: [{ label: 'доли', color: '--accent', p, you: true }],
      };
    }
    const r = rhythm();
    const mine = yourTracks(r);
    const perBar = r.beats * r.spb;
    const starts = new Set();
    const gs = UI.groupStarts(r);
    for (let b = 0; b < r.bars; b++) gs.forEach((s) => starts.add(b * perBar + s));
    // ваши партии — снаружи
    const order = [...mine, ...r.tracks.map((_, i) => i).filter((i) => !mine.includes(i))];
    const rings = order.map((i) => {
      const t = r.tracks[i];
      return { label: INSTRUMENTS[t.i] ? INSTRUMENTS[t.i].name : t.i, color: INST_COLOR[t.i] || '--muted', p: t.p, you: mine.includes(i), idx: i };
    });
    if (mine.length > 1) {
      // одно общее кольцо «вы» вместо нескольких
      const p = Array.from({ length: perBar * r.bars }, (_, s) => (mine.some((i) => r.tracks[i].p[s] !== '.') ? 'X' : '.')).join('');
      rings.splice(0, mine.length, { label: 'вы', color: '--accent', p, you: true });
    }
    return { total: perBar * r.bars, spb: r.spb, beats: r.beats, bars: r.bars, starts, rings, mine };
  }

  // ───────── Отрисовка колеса ─────────
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function posAt(t) {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const e = timeline[i];
      if (e.time <= t) return e.step < 0 ? null : e.step + Math.min(1, (t - e.time) / e.dur);
    }
    return null;
  }

  function draw() {
    const m = model();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = wheel.parentElement;
    const cs = getComputedStyle(box);
    const inner = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const size = Math.max(200, Math.min(inner || 340, 380));
    if (wheel.width !== Math.round(size * dpr)) {
      wheel.width = Math.round(size * dpr);
      wheel.height = Math.round(size * dpr);
      wheel.style.width = size + 'px';
    }
    const g = wheel.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);

    const c = size / 2;
    const Rout = size * 0.4;
    const n = m.rings.length;
    const gap = Math.min(size * 0.085, (Rout - size * 0.14) / Math.max(n, 1));
    const cLine = cssVar('--line');
    const cMuted = cssVar('--muted');
    const cText = cssVar('--text');
    const cAcc = cssVar('--accent');
    const cGood = cssVar('--good');
    const cBad = cssVar('--bad');
    const cMiss = cssVar('--danger');
    const ang = (pos) => (pos / m.total) * Math.PI * 2 - Math.PI / 2;
    // не создаём AudioContext раньше первого касания
    const live = transport.playing || marks.length;
    const now = live ? Sound.ctx.currentTime : 0;
    const audible = live ? now - (Sound.ctx.outputLatency || 0) : 0;
    const playPos = transport.playing ? posAt(audible) : null;
    const nowStep = playPos === null ? -1 : Math.floor(playPos) % m.total;

    // спицы на долях
    const rIn = Rout - gap * (n - 0.6);
    g.lineWidth = 1;
    g.strokeStyle = cLine;
    m.starts.forEach((s) => {
      const a = ang(s);
      g.globalAlpha = s === 0 ? 0.9 : 0.45;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * rIn * 0.55, c + Math.sin(a) * rIn * 0.55);
      g.lineTo(c + Math.cos(a) * (Rout + gap * 0.45), c + Math.sin(a) * (Rout + gap * 0.45));
      g.stroke();
    });
    g.globalAlpha = 1;

    const resColor = { hit: cGood, off: cBad, miss: cMiss, extra: cMiss };

    m.rings.forEach((ring, ri) => {
      const rad = Rout - gap * ri;
      const col = cssVar(ring.color) || cAcc;
      g.beginPath();
      g.arc(c, c, rad, 0, Math.PI * 2);
      g.strokeStyle = ring.you ? cAcc : cLine;
      g.lineWidth = ring.you ? 1.5 : 1;
      g.globalAlpha = ring.you ? 0.35 : 0.5;
      g.stroke();
      g.globalAlpha = 1;

      for (let s = 0; s < m.total; s++) {
        const a = ang(s);
        const x = c + Math.cos(a) * rad;
        const y = c + Math.sin(a) * rad;
        const ch = ring.p[s];
        if (!ch || ch === '.') {
          g.beginPath();
          g.arc(x, y, 1.6, 0, Math.PI * 2);
          g.fillStyle = cMuted;
          g.globalAlpha = 0.4;
          g.fill();
          g.globalAlpha = 1;
          continue;
        }
        const accent = ch === ch.toUpperCase();
        const active = s === nowStep;
        let rr = (accent ? gap * 0.3 : gap * 0.21) * (active ? 1.35 : 1);
        rr = Math.max(rr, 3);
        if (ring.you) {
          // цель: полый кружок; после попытки — заливка цветом результата
          const res = st.mode === 'part' ? stepRes[s] : null;
          g.beginPath();
          g.arc(x, y, rr, 0, Math.PI * 2);
          if (res) {
            g.fillStyle = resColor[res];
            g.fill();
          } else {
            g.fillStyle = cssVar('--card');
            g.fill();
            g.strokeStyle = cAcc;
            g.lineWidth = 2;
            g.stroke();
          }
        } else {
          g.beginPath();
          g.arc(x, y, rr, 0, Math.PI * 2);
          g.fillStyle = col;
          g.globalAlpha = transport.playing ? 1 : 0.85;
          g.fill();
          g.globalAlpha = 1;
        }
        if (active) {
          g.beginPath();
          g.arc(x, y, rr * 1.9, 0, Math.PI * 2);
          g.strokeStyle = ring.you ? cAcc : col;
          g.lineWidth = 1.5;
          g.globalAlpha = 0.5;
          g.stroke();
          g.globalAlpha = 1;
        }
      }
    });

    // следы ваших ударов — черточки поперёк внешнего кольца
    const cycleDur = (60 / st.bpm) * (m.total / m.spb);
    const life = Math.max(2.5, cycleDur * 2);
    marks = marks.filter((k) => now - k.t < life);
    marks.forEach((k) => {
      const a = ang(k.pos);
      const age = (now - k.t) / life;
      const r1 = Rout - gap * 0.42;
      const r2 = Rout + gap * 0.42;
      g.strokeStyle = resColor[k.res] || cGood;
      g.globalAlpha = Math.max(0, 1 - age);
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      g.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
      g.stroke();
    });
    g.globalAlpha = 1;
    g.lineCap = 'butt';

    // стрелка
    if (playPos !== null) {
      const a = ang(playPos % m.total);
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + Math.cos(a) * (Rout + gap * 0.5), c + Math.sin(a) * (Rout + gap * 0.5));
      g.strokeStyle = cAcc;
      g.lineWidth = 2;
      g.globalAlpha = 0.8;
      g.stroke();
      g.globalAlpha = 1;
    }

    // ступица
    const hubR = size * 0.12;
    g.beginPath();
    g.arc(c, c, hubR, 0, Math.PI * 2);
    g.fillStyle = cssVar('--bg2');
    g.fill();
    g.strokeStyle = cLine;
    g.lineWidth = 1;
    g.stroke();
    let big = '·';
    let small = '';
    let bigCol = cText;
    if (st.mode === 'pulse' && lastDev !== null) {
      big = `${lastDev > 0 ? '+' : ''}${Math.round(lastDev)}`;
      small = 'мс';
      bigCol = Math.abs(lastDev) <= st.win ? cGood : cBad;
    } else if (st.mode === 'part' && score.hit + score.off + score.miss > 0) {
      big = `${accuracy()}%`;
      small = 'точность';
    } else if (nowStep >= 0) {
      big = String([...m.starts].filter((s) => s <= nowStep).length);
      small = 'доля';
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = bigCol;
    g.font = `700 ${Math.round(size * (big.length > 3 ? 0.058 : 0.07))}px ui-monospace, "SF Mono", Menlo, monospace`;
    g.fillText(big, c, small ? c - size * 0.018 : c + 1);
    if (small) {
      g.fillStyle = cMuted;
      g.font = `600 ${Math.round(size * 0.03)}px system-ui, sans-serif`;
      g.fillText(small, c, c + size * 0.045);
    }

    // точки долей в панели
    const dots = $('#tr-dots').children;
    const beatIdx = nowStep >= 0 ? [...m.starts].filter((s) => s <= nowStep % (m.total / m.bars)).length - 1 : -1;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === beatIdx);
  }

  // ───────── Удары ─────────
  function hit(drum, stroke, ev) {
    Sound.play(drum, stroke);
    const pad = el.querySelector(`.pad-${drum}`);
    pad.classList.remove('hit');
    void pad.offsetWidth;
    pad.classList.add('hit');
    if (!transport.playing) return;
    const t = Sound.eventTime(ev) - st.offset / 1000;
    if (st.mode === 'pulse' || calibrating) pulseTap(t);
    else partTap(t);
  }

  function pulseTap(t) {
    if (!expected.length) return;
    let best = null;
    for (const e of expected) if (best === null || Math.abs(e - t) < Math.abs(best - t)) best = e;
    const half = 60 / st.bpm / (calibrating ? 1 : st.sub) / 2;
    const dev = (t - best) * 1000;
    if (Math.abs(dev) > half * 1000) return;
    if (calibrating) {
      calTaps.push(dev);
      if (calTaps.length >= 12) finishCalibration();
      else $('#tr-advice').textContent = `Калибровка: ${calTaps.length} из 12…`;
      return;
    }
    devs.push(dev);
    if (devs.length > 200) devs.shift();
    lastDev = dev;
    const pos = posAt(t);
    if (pos !== null) marks.push({ pos, res: Math.abs(dev) <= st.win ? 'hit' : 'off', t: Sound.ctx.currentTime });
    renderStats();
  }

  function partTap(t) {
    const pos = posAt(t);
    const stepDur = 60 / st.bpm / rhythm().spb;
    let best = null;
    for (const tg of targets) if (!best || Math.abs(tg.time - t) < Math.abs(best.time - t)) best = tg;
    let res = 'extra';
    if (best && !best.done && Math.abs(best.time - t) <= stepDur * 0.5) {
      const dev = (t - best.time) * 1000;
      res = Math.abs(dev) <= st.win ? 'hit' : 'off';
      best.done = true;
      stepRes[best.step] = res;
      score[res]++;
      score.offSum += dev;
      lastDev = dev;
    } else {
      score.extra++;
    }
    if (pos !== null) marks.push({ pos, res, t: Sound.ctx.currentTime });
    renderStats();
  }

  // пропущенные цели
  function checkMisses(now) {
    if (st.mode !== 'part') return;
    const stepDur = 60 / st.bpm / rhythm().spb;
    let changed = false;
    targets = targets.filter((tg) => {
      if (tg.done) return now - tg.time < 2;
      if (now > tg.time + stepDur * 0.5 + 0.08) {
        stepRes[tg.step] = 'miss';
        score.miss++;
        changed = true;
        return false;
      }
      return true;
    });
    if (changed) renderStats();
  }

  function accuracy() {
    const n = score.hit + score.off + score.miss;
    return n ? Math.round((score.hit / n) * 100) : 0;
  }

  // ───────── Статистика ─────────
  function stat(value, label, cls = '') {
    return `<div class="tr-stat ${cls}"><b>${value}</b><span>${label}</span></div>`;
  }

  function renderStats() {
    const box = $('#tr-stats');
    const adv = $('#tr-advice');
    if (calibrating) return;
    if (st.mode === 'pulse') {
      const recent = devs.slice(-50);
      if (!recent.length) {
        box.innerHTML = stat('—', 'в окне') + stat('—', 'среднее') + stat('—', 'разброс σ') + stat('0', 'ударов');
        adv.textContent = 'Нажмите старт и стучите вместе со щелчком. Черточки на круге — ваши удары: зелёные в точку, жёлтые мимо окна.';
        return;
      }
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const sd = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length);
      const inWin = recent.filter((d) => Math.abs(d) <= st.win).length / recent.length;
      box.innerHTML =
        stat(`${Math.round(inWin * 100)}%`, 'в окне', inWin > 0.8 ? 'good' : '') +
        stat(`${mean > 0 ? '+' : ''}${Math.round(mean)}`, mean > 0 ? 'мс, поздно' : 'мс, рано') +
        stat(`${Math.round(sd)}`, 'мс, разброс σ') +
        stat(devs.length, 'ударов');
      if (recent.length >= 8) {
        if (Math.abs(mean) > st.win) adv.textContent = mean > 0 ? 'Вы стабильно опаздываете: слушайте щелчок заранее или сделайте калибровку задержки.' : 'Вы спешите: расслабьтесь и «дождитесь» щелчка.';
        else if (sd > st.win) adv.textContent = 'В среднем точно, но большой разброс. Сбавьте темп и считайте вслух.';
        else adv.textContent = inWin > 0.9 ? 'Отлично! Прибавьте 5 bpm или выключите клик и проверьте себя.' : 'Хорошо, стабильность растёт.';
      }
      return;
    }
    const n = score.hit + score.off + score.miss;
    box.innerHTML =
      stat(n ? `${accuracy()}%` : '—', 'точность', accuracy() > 80 ? 'good' : '') +
      stat(score.hit, 'в точку', 'good') +
      stat(score.off, 'неточно', 'warn') +
      stat(score.miss, 'пропущено', 'bad') +
      stat(score.extra, 'лишних', 'bad');
    if (!n) {
      adv.textContent = 'Ваша партия заглушена — сыграйте её сами. Полые кружки на внешнем кольце — куда бить; после удара кружок окрасится.';
    } else if (n >= 8) {
      const bias = score.hit + score.off ? score.offSum / (score.hit + score.off) : 0;
      if (score.miss > n * 0.25) adv.textContent = 'Много пропусков — сбавьте темп на 10 bpm, пусть руки успевают.';
      else if (score.extra > n * 0.25) adv.textContent = 'Много лишних ударов: играйте только там, где кружки на внешнем кольце.';
      else if (score.off > score.hit) adv.textContent = bias > 0 ? 'Попадаете, но чуть поздно — слушайте другие партии и «ведите» их.' : 'Попадаете, но спешите — дайте ритму «дышать».';
      else adv.textContent = accuracy() > 90 ? 'Отлично! Поднимите темп или выключите клик.' : 'Хорошо! Жёлтые кружки — места, которые стоит повторить отдельно.';
    }
  }

  function resetSession() {
    devs = [];
    expected = [];
    targets = [];
    stepRes = {};
    score = { hit: 0, off: 0, miss: 0, extra: 0, offSum: 0 };
    marks = [];
    lastDev = null;
    renderStats();
  }

  // ───────── Калибровка ─────────
  function startCalibration() {
    stopAll();
    if (st.mode === 'ear') return;
    calibrating = true;
    calTaps = [];
    $('#tr-advice').textContent = 'Калибровка: стучите ровно вместе со щелчком 12 раз…';
    start();
  }

  function finishCalibration() {
    calibrating = false;
    const sorted = [...calTaps].sort((a, b) => a - b);
    st.offset = Math.round(st.offset + sorted[Math.floor(sorted.length / 2)]);
    Store.set('t.offset', st.offset);
    $('#tr-offset').textContent = st.offset;
    transport.stop();
    UI.toast(`Готово! Поправка задержки: ${st.offset} мс`);
    renderStats();
  }

  // ───────── Воспроизведение ─────────
  function start() {
    resetSession();
    timeline = [];
    const pulseLike = st.mode === 'pulse' || calibrating;
    const r = rhythm();
    const m = model();
    const spb = pulseLike ? (calibrating ? 1 : st.sub) : r.spb;
    const total = pulseLike ? 4 * spb : m.total;
    const perBar = pulseLike ? total : r.beats * r.spb;
    const barStarts = pulseLike ? new Set([0, 1, 2, 3].map((b) => b * spb)) : UI.groupStarts(r);
    const countIn = st.countIn || calibrating ? perBar : 0;

    transport.onStep = (step, time, dur) => {
      timeline.push({ step, time, dur });
      if (timeline.length > 256) timeline.splice(0, 128);
      const sb = ((step % perBar) + perBar) % perBar;
      if (step < 0) {
        if (barStarts.has(sb)) Sound.click(time, sb === 0 ? 2 : 1, 'wood');
        return;
      }
      if (pulseLike) {
        expected.push(time);
        if (expected.length > 32) expected.shift();
        if (st.click || calibrating) {
          if (sb % spb === 0) Sound.click(time, sb === 0 ? 2 : 1, 'beep', 0.8);
          else Sound.click(time, 0.5, 'beep', 0.5);
        }
        return;
      }
      r.tracks.forEach((t, i) => {
        if (m.mine.includes(i)) return;
        const ch = t.p[step];
        if (ch && ch !== '.') Sound.play(t.i, ch, time);
      });
      if (m.mine.some((i) => r.tracks[i].p[step] !== '.')) targets.push({ time, step, done: false });
      if (st.click && barStarts.has(sb)) Sound.click(time, sb === 0 ? 2 : 1, 'beep', 0.55);
    };
    transport.onDraw = null;
    transport.onLoop = null;
    transport.onFrame = (now) => {
      checkMisses(now - (Sound.ctx.outputLatency || 0));
      draw();
    };
    transport.onStop = () => {
      setPlayIcon(false);
      calibrating = false;
      draw();
    };
    transport.start({ bpm: st.bpm, spb, total, countIn });
    setPlayIcon(true);
  }

  function setPlayIcon(on) {
    $('#tr-play').setAttribute('aria-label', on ? 'Стоп' : 'Старт');
    $('#tr-play svg').innerHTML = on
      ? '<rect x="2" y="2" width="5" height="15" fill="currentColor"/><rect x="10" y="2" width="5" height="15" fill="currentColor"/>'
      : '<path d="M1 1.5 16 9.5 1 17.5Z" fill="currentColor"/>';
  }

  function stopAll() {
    transport.stop();
    earTransport.stop();
    calibrating = false;
  }

  function toggle() {
    if (st.mode === 'ear') { earPlay(); return; }
    transport.playing ? transport.stop() : start();
  }

  // ───────── Настройки режима ─────────
  function renderSetup() {
    const box = $('#tr-setup');
    if (st.mode === 'pulse') {
      box.innerHTML = `
        <div class="eyebrow">режим · точность</div>
        <h2 class="tr-h2">Стучите вместе со щелчком</h2>
        <p class="tr-note">Каждый удар ложится черточкой на круг — видно, спешите вы или опаздываете, и насколько ровно.</p>
        <div class="tr-fields">
          <label><span class="eyebrow">цель</span><select id="tr-sub">${Object.entries(SUBS).map(([k, v]) => `<option value="${k}" ${+k === st.sub ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          ${winField()}
        </div>`;
      box.querySelector('#tr-sub').addEventListener('change', (e) => { st.sub = +e.target.value; restart(); });
    } else {
      const r = rhythm();
      const all = [...RHYTHMS, ...Store.customs()];
      const groups = RHYTHM_CATEGORIES.map((c) => {
        const items = all.filter((x) => (x.cat || 'mine') === c.id);
        return items.length ? `<optgroup label="${UI.esc(c.name)}">${items.map((x) => `<option value="${x.id}" ${x.id === r.id ? 'selected' : ''}>${UI.esc(x.name)}</option>`).join('')}</optgroup>` : '';
      }).join('');
      const parts = partOptions(r);
      yourTracks(r);
      box.innerHTML = `
        <div class="eyebrow">режим · играй партию · ${UI.esc(r.sig)}</div>
        <h2 class="tr-h2">${UI.esc(r.name)}</h2>
        <p class="tr-note">Выбранная партия молчит — её играете вы. Остальные звучат. Внешнее кольцо — ваши цели.</p>
        <div class="tr-fields">
          <label class="wide"><span class="eyebrow">ритм</span><select id="tr-rid">${groups}</select></label>
          <label class="wide"><span class="eyebrow">ваша партия</span><select id="tr-part">${parts.map((p) => `<option value="${p.key}" ${p.key === String(st.part) ? 'selected' : ''}>${UI.esc(p.label)}</option>`).join('')}</select></label>
          ${winField()}
        </div>
        <div class="tr-legend">
          <span class="eyebrow">кольца снаружи внутрь:</span>
          ${model().rings.map((g) => `<span><i class="dot" style="background:var(${g.you ? '--accent' : g.color})"></i>${g.you ? 'вы' : UI.esc(g.label)}</span>`).join('')}
        </div>
        <div class="tr-legend">
          <span><i class="dot hollow"></i>цель</span><span><i class="dot good"></i>в точку</span><span><i class="dot warn"></i>неточно</span><span><i class="dot bad"></i>пропуск / лишний</span>
        </div>`;
      box.querySelector('#tr-rid').addEventListener('change', (e) => {
        st.rid = e.target.value;
        Store.set('t.rid', st.rid);
        const nr = rhythm();
        setBpm(nr.bpm);
        st.part = partOptions(nr)[0].key;
        Store.set('t.part', st.part);
        restart();
      });
      box.querySelector('#tr-part').addEventListener('change', (e) => { st.part = e.target.value; Store.set('t.part', st.part); restart(); });
    }
    box.querySelector('#tr-win').addEventListener('change', (e) => { st.win = +e.target.value; renderStats(); });
  }

  function winField() {
    return `<label><span class="eyebrow">окно попадания</span><select id="tr-win">
      ${[[15, 'строго ±15 мс'], [30, 'обычно ±30 мс'], [50, 'мягко ±50 мс']].map(([v, t]) => `<option value="${v}" ${v === st.win ? 'selected' : ''}>${t}</option>`).join('')}
    </select></label>`;
  }

  function restart() {
    const was = transport.playing;
    transport.stop();
    resetSession();
    render();
    if (was) start();
  }

  function render() {
    el.querySelectorAll('[data-mode]').forEach((b) => {
      const on = b.dataset.mode === st.mode;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-selected', on);
    });
    const ear = st.mode === 'ear';
    $('#tr-play-sec').hidden = ear;
    $('#tr-ear-sec').hidden = !ear;
    $('#tr-transport').hidden = ear;
    if (ear) { renderEar(); return; }
    renderSetup();
    renderStats();
    const m = model();
    const groupsPerBar = [...m.starts].filter((s) => s < m.total / m.bars).length;
    $('#tr-dots').innerHTML = Array.from({ length: Math.min(groupsPerBar, 12) }, (_, i) => `<i class="${i === 0 ? 'one' : ''}"></i>`).join('');
    $('#tr-cycle').textContent = st.mode === 'pulse'
      ? `цикл: 4 доли · ${SUBS[st.sub]}`
      : `цикл: ${m.total} клеток · ${m.bars > 1 ? m.bars + ' такта · ' : ''}${rhythm().sig}`;
    draw();
  }

  // ───────── Слух ─────────
  const EAR = { mode: 'name', target: null, opts: [], answered: false, right: 0, total: 0, streak: 0, best: Store.get('t.earBest', 0), key: null };
  const EAR_HINTS = {
    name: 'Звучит ритм из библиотеки. Какой? Слушайте сначала низкий голос — он размечает фразу. Щелчки отсчёта показывают, где «раз».',
    clave: 'Играет клаве. С какой стороны она начата: три удара в первом такте или два? Сторона «три» начинается прямо с «раз».',
    meter: 'Как делится доля: на два (ровный «шаг») или на три («качание»)?',
  };

  function earPick() {
    earTransport.stop();
    EAR.answered = false;
    $('#ear-reveal').innerHTML = '';
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    if (EAR.mode === 'clave') {
      EAR.target = pick(['son32', 'son23', 'rumba32', 'rumba23']);
      EAR.key = EAR.target.endsWith('32') ? '3-2' : '2-3';
      EAR.opts = [{ k: '3-2', t: '3-2' }, { k: '2-3', t: '2-3' }];
    } else if (EAR.mode === 'meter') {
      const tern = RHYTHMS.filter((r) => r.spb === 3);
      const bin = RHYTHMS.filter((r) => (r.spb === 2 || r.spb === 4) && (r.beats === 2 || r.beats === 4) && r.cat !== 'basics');
      const isT = Math.random() < 0.5;
      EAR.target = pick(isT ? tern : bin).id;
      EAR.key = isT ? 'T' : 'B';
      EAR.opts = [{ k: 'B', t: 'на два — «шаг»' }, { k: 'T', t: 'на три — «качание»' }];
    } else {
      const pool = RHYTHMS.filter((r) => r.cat !== 'basics');
      const tgt = pick(pool);
      EAR.target = tgt.id;
      EAR.key = tgt.id;
      const wrong = pool.filter((r) => r.id !== tgt.id).sort(() => Math.random() - 0.5).slice(0, 3);
      EAR.opts = [tgt, ...wrong].sort(() => Math.random() - 0.5).map((r) => ({ k: r.id, t: r.name }));
    }
    renderEar();
  }

  function renderEar() {
    if (!EAR.target) { earPick(); return; }
    el.querySelectorAll('[data-ear]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.ear === EAR.mode));
    $('#ear-hint').textContent = EAR_HINTS[EAR.mode];
    $('#ear-opts').innerHTML = EAR.opts.map((o) => `<button class="ear-opt" data-ans="${o.k}">${UI.esc(o.t)}</button>`).join('');
    renderEarScore();
  }

  function renderEarScore() {
    $('#ear-right').textContent = EAR.right;
    $('#ear-total').textContent = EAR.total;
    $('#ear-streak').textContent = EAR.streak;
    $('#ear-best').textContent = EAR.best;
  }

  function earPlay() {
    if (earTransport.playing) { earTransport.stop(); return; }
    const r = UI.findRhythm(EAR.target);
    const perBar = r.beats * r.spb;
    const total = perBar * r.bars;
    const starts = UI.groupStarts(r);
    const cycleSec = (60 / r.bpm) * (total / r.spb);
    const cycles = Math.max(2, Math.ceil(7 / cycleSec));
    let loops = 0;
    earTransport.onStep = (step, time) => {
      if (step < 0) {
        const sb = step + perBar;
        if (starts.has(sb)) Sound.click(time, sb === 0 ? 2 : 1, 'wood');
        return;
      }
      r.tracks.forEach((t) => { const ch = t.p[step]; if (ch && ch !== '.') Sound.play(t.i, ch, time); });
    };
    earTransport.onLoop = () => { if (++loops >= cycles) earTransport.stop(); };
    earTransport.onDraw = null;
    earTransport.onFrame = null;
    earTransport.onStop = () => { $('#ear-play').textContent = '▶ Слушать'; };
    earTransport.start({ bpm: r.bpm, spb: r.spb, total, countIn: perBar });
    $('#ear-play').textContent = '■ Стоп';
  }

  el.querySelector('#ear-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ear]');
    if (!b) return;
    EAR.mode = b.dataset.ear;
    earPick();
  });
  $('#ear-play').addEventListener('click', earPlay);
  $('#ear-next').addEventListener('click', () => { earPick(); earPlay(); });
  $('#ear-opts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ans]');
    if (!b || EAR.answered) return;
    EAR.answered = true;
    const ok = b.dataset.ans === EAR.key;
    EAR.total++;
    if (ok) {
      EAR.right++;
      EAR.streak++;
      if (EAR.streak > EAR.best) { EAR.best = EAR.streak; Store.set('t.earBest', EAR.best); }
    } else {
      EAR.streak = 0;
    }
    el.querySelectorAll('.ear-opt').forEach((o) => {
      o.disabled = true;
      if (o.dataset.ans === EAR.key) o.classList.add('right');
      else if (o === b) o.classList.add('wrong');
    });
    const r = UI.findRhythm(EAR.target);
    $('#ear-reveal').innerHTML = `${ok ? '✓ Верно!' : '✗ Не угадали.'} Это был ритм «${UI.esc(r.name)}» (${UI.esc(r.sig)}). <a href="#/rhythms/${r.id}">Открыть в плеере →</a>`;
    renderEarScore();
  });

  window.addEventListener('resize', () => { if (el.classList.contains('active') && st.mode !== 'ear') { wheel.width = 0; draw(); } });

  return {
    show() { render(); },
    toggle,
    hide() { stopAll(); },
  };
})();
