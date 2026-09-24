window.Pages = window.Pages || {};

Pages.trainer = (() => {
  const el = document.getElementById('page-trainer');
  const transport = new Transport();

  const st = {
    bpm: Store.get('t.bpm', 80),
    sub: 1,
    click: true,
    win: 30, // «попадание», мс
    offset: Store.get('t.offset', 0), // калибровка задержки, мс
    stroke: 'O',
  };
  let expected = [];
  let taps = [];
  let calibrating = false;
  let calTaps = [];
  let bpmCtl;

  el.innerHTML = `
    <div class="trainer-layout">
      <section class="card">
        <h1>Тренажёр точности</h1>
        <p class="muted">Метроном щёлкает — вы стучите по экранным барабанам (или клавишам <kbd>F</kbd>/<kbd>J</kbd>). Приложение измеряет, насколько рано или поздно вы попадаете, в миллисекундах.</p>
        <div class="controls">
          <button class="btn play" id="t-play">▶ Старт</button>
          <span id="t-bpm"></span>
        </div>
        <div class="controls options">
          <label>Цель:
            <select id="t-sub">
              <option value="1">четверти</option>
              <option value="2">восьмые</option>
              <option value="3">триоли</option>
              <option value="4">шестнадцатые</option>
            </select>
          </label>
          <label>Точность:
            <select id="t-win">
              <option value="15">строго ±15 мс</option>
              <option value="30" selected>нормально ±30 мс</option>
              <option value="50">мягко ±50 мс</option>
            </select>
          </label>
          <label class="toggle"><input type="checkbox" id="t-click" checked> Щелчок</label>
        </div>

        <div class="stats">
          <div class="stat big"><span id="t-last">—</span><small id="t-last-lbl">последний удар</small></div>
          <div class="stat"><span id="t-hit">—</span><small>в пределах окна</small></div>
          <div class="stat"><span id="t-mean">—</span><small>среднее смещение</small></div>
          <div class="stat"><span id="t-sd">—</span><small>разброс (σ)</small></div>
          <div class="stat"><span id="t-n">0</span><small>ударов</small></div>
        </div>
        <canvas id="t-canvas" aria-label="График точности ударов"></canvas>
        <p class="muted small" id="t-advice">Выше линии — поздно, ниже — рано. Зелёная полоса — окно попадания.</p>
        <div class="controls">
          <button class="btn small" id="t-reset">Сбросить статистику</button>
          <button class="btn small" id="t-cal">🎚 Калибровка задержки</button>
          <span class="muted small">Поправка: <b id="t-offset">${st.offset}</b> мс</span>
        </div>
      </section>

      <section class="card pads-card">
        <div class="seg wrap" id="t-strokes">
          ${['O', 'S', 'M', 'T'].map((k) => `<button data-stroke="${k}" class="${k === st.stroke ? 'sel' : ''}">${STROKES[k].label} · ${STROKES[k].name}</button>`).join('')}
        </div>
        <div class="pads">
          <button class="pad pad-macho" data-drum="macho"><b>Мачо</b><small>клавиша J · K — шлепок</small></button>
          <button class="pad pad-hembra" data-drum="hembra"><b>Эмбра</b><small>клавиша F · D — шлепок</small></button>
        </div>
        <p class="muted small center">Экранные барабаны работают и без метронома — просто поиграйте. На телефоне стучите пальцами по кругам.</p>
      </section>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const canvas = $('#t-canvas');

  bpmCtl = UI.bpmControl({
    value: st.bpm, min: 30, max: 240,
    onChange: (v) => { st.bpm = v; transport.bpm = v; Store.set('t.bpm', v); },
  });
  $('#t-bpm').appendChild(bpmCtl.el);

  $('#t-sub').addEventListener('change', (e) => { st.sub = +e.target.value; if (transport.playing) { transport.stop(); start(); } });
  $('#t-win').addEventListener('change', (e) => { st.win = +e.target.value; updateStats(); });
  $('#t-click').addEventListener('change', (e) => { st.click = e.target.checked; });
  $('#t-play').addEventListener('click', toggle);
  $('#t-reset').addEventListener('click', () => { taps = []; updateStats(); });
  $('#t-cal').addEventListener('click', () => {
    calibrating = true;
    calTaps = [];
    if (!transport.playing) start();
    UI.toast('Калибровка: стучите ровно со щелчком 12 раз');
    $('#t-advice').textContent = 'Калибровка: стучите точно вместе со щелчком (12 ударов)…';
  });
  $('#t-strokes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stroke]');
    if (!b) return;
    st.stroke = b.dataset.stroke;
    el.querySelectorAll('[data-stroke]').forEach((x) => x.classList.toggle('sel', x === b));
  });

  el.querySelectorAll('.pad').forEach((p) => {
    p.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hit(p.dataset.drum, st.stroke, e);
    });
  });

  const KEYS = { KeyJ: ['macho', null], KeyF: ['hembra', null], KeyK: ['macho', 'S'], KeyD: ['hembra', 'S'] };
  window.addEventListener('keydown', (e) => {
    if (!el.classList.contains('active') || e.repeat) return;
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const k = KEYS[e.code];
    if (!k) return;
    e.preventDefault();
    hit(k[0], k[1] || st.stroke, e);
  });

  function hit(drum, stroke, ev) {
    Sound.play(drum, stroke);
    const pad = el.querySelector(`.pad-${drum}`);
    pad.classList.remove('hit');
    void pad.offsetWidth;
    pad.classList.add('hit');
    if (!transport.playing || !expected.length) return;
    const t = Sound.eventTime(ev) - st.offset / 1000;
    let best = null;
    for (const e of expected) if (best === null || Math.abs(e - t) < Math.abs(best - t)) best = e;
    const half = (60 / st.bpm / st.sub) / 2;
    const dev = (t - best) * 1000;
    if (Math.abs(dev) > half * 1000) return;
    if (calibrating) {
      calTaps.push(dev);
      if (calTaps.length >= 12) finishCalibration();
      else $('#t-advice').textContent = `Калибровка: ${calTaps.length}/12…`;
      return;
    }
    taps.push(dev);
    if (taps.length > 200) taps.shift();
    showLast(dev);
    updateStats();
  }

  function finishCalibration() {
    calibrating = false;
    const sorted = [...calTaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    st.offset = Math.round(st.offset + median);
    Store.set('t.offset', st.offset);
    $('#t-offset').textContent = st.offset;
    $('#t-advice').textContent = 'Выше линии — поздно, ниже — рано. Зелёная полоса — окно попадания.';
    UI.toast(`Готово! Поправка задержки: ${st.offset} мс`);
  }

  function showLast(dev) {
    const d = Math.round(dev);
    const ok = Math.abs(dev) <= st.win;
    const last = $('#t-last');
    last.textContent = `${d > 0 ? '+' : ''}${d} мс`;
    last.className = ok ? 'good' : 'bad';
    $('#t-last-lbl').textContent = ok ? 'в точку!' : d > 0 ? 'поздно' : 'рано';
  }

  function updateStats() {
    const recent = taps.slice(-50);
    $('#t-n').textContent = taps.length;
    if (!recent.length) {
      ['#t-hit', '#t-mean', '#t-sd'].forEach((s) => { $(s).textContent = '—'; });
      $('#t-last').textContent = '—';
      $('#t-last').className = '';
      drawChart();
      return;
    }
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const sd = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length);
    const hit = recent.filter((d) => Math.abs(d) <= st.win).length / recent.length;
    $('#t-hit').textContent = `${Math.round(hit * 100)}%`;
    $('#t-mean').textContent = `${mean > 0 ? '+' : ''}${Math.round(mean)} мс`;
    $('#t-sd').textContent = `${Math.round(sd)} мс`;
    if (recent.length >= 8 && !calibrating) {
      let advice;
      if (Math.abs(mean) > st.win) advice = mean > 0 ? 'Вы стабильно опаздываете — «тяните» удар раньше, слушайте щелчок заранее. Или сделайте калибровку.' : 'Вы стабильно спешите — расслабьтесь и «дождитесь» щелчка.';
      else if (sd > st.win) advice = 'В среднем точно, но большой разброс. Сбавьте темп и считайте вслух.';
      else advice = hit > 0.9 ? 'Отлично! Прибавьте 5 BPM или выключите щелчок на время.' : 'Хорошо! Продолжайте, стабильность растёт.';
      $('#t-advice').textContent = advice;
    }
    drawChart();
  }

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300;
    const h = 170;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const range = Math.min(150, (60 / st.bpm / st.sub) * 500);
    const y = (ms) => h / 2 - (UI.clamp(ms, -range, range) / range) * (h / 2 - 10);
    g.fillStyle = cssVar('--good-bg') || 'rgba(34,197,94,.15)';
    g.fillRect(0, y(st.win), w, y(-st.win) - y(st.win));
    g.strokeStyle = cssVar('--line') || '#555';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    g.fillStyle = cssVar('--muted') || '#999';
    g.font = '11px system-ui, sans-serif';
    g.fillText(`поздно +${Math.round(range)} мс`, 6, 12);
    g.fillText(`рано −${Math.round(range)} мс`, 6, h - 4);
    const pts = taps.slice(-60);
    const good = cssVar('--good') || '#22c55e';
    const bad = cssVar('--bad') || '#f59e0b';
    pts.forEach((d, i) => {
      const x = w - 12 - (pts.length - 1 - i) * ((w - 24) / 59);
      g.fillStyle = Math.abs(d) <= st.win ? good : bad;
      g.beginPath();
      g.arc(x, y(d), i === pts.length - 1 ? 6 : 4, 0, Math.PI * 2);
      g.fill();
    });
  }

  function start() {
    expected = [];
    const countIn = 4 * st.sub;
    transport.onStep = (step, time) => {
      const beatStep = ((step % st.sub) + st.sub) % st.sub === 0;
      if (step < 0) {
        if (beatStep) Sound.click(time, step === -countIn ? 2 : 1, 'wood');
        return;
      }
      expected.push(time);
      if (expected.length > 32) expected.shift();
      if (st.click) {
        if (beatStep) Sound.click(time, step === 0 ? 2 : 1, 'beep', 0.8);
        else Sound.click(time, 0.5, 'beep', 0.5);
      }
    };
    transport.onDraw = (step) => {
      if (step < 0 && (step + countIn) % st.sub === 0) $('#t-last-lbl').textContent = `приготовьтесь: ${(step + countIn) / st.sub + 1}`;
      if (step === 0 && !taps.length) $('#t-last-lbl').textContent = 'играйте!';
    };
    transport.onStop = () => {
      $('#t-play').textContent = '▶ Старт';
      $('#t-play').classList.remove('on');
      calibrating = false;
    };
    transport.start({ bpm: st.bpm, spb: st.sub, total: 4 * st.sub, countIn });
    $('#t-play').textContent = '■ Стоп';
    $('#t-play').classList.add('on');
  }

  function toggle() { transport.playing ? transport.stop() : start(); }

  window.addEventListener('resize', () => { if (el.classList.contains('active')) drawChart(); });

  return {
    show() { drawChart(); },
    toggle,
    hide() { transport.stop(); },
  };
})();
