window.Pages = window.Pages || {};

Pages.poly = (() => {
  const el = document.getElementById('page-poly');
  const transport = new Transport();

  const VOICES = {
    'hembra:O': 'Эмбра — открытый',
    'macho:O': 'Мачо — открытый',
    'macho:S': 'Мачо — шлепок',
    'clave:X': 'Клаве',
    'bell:L': 'Колокол',
    'shaker:X': 'Шейкер',
    'bass:X': 'Бас',
  };
  const PRESETS = ['3:2', '4:3', '5:2', '5:3', '5:4', '7:4', '2:3', '3:4', '6:4', '9:8'];
  const MNEMONIC = {
    '3:2': '«nice CUP of TEA» / «ОБЕ · П Л П ·»',
    '2:3': '«nice CUP of TEA» — те же удары, руки поменялись',
    '4:3': '«PASS the GOL-den BUT-ter»',
    '3:4': '«PASS the GOL-den BUT-ter» — руки поменялись',
  };

  const st = {
    a: 3, b: 2, bpm: 60, mode: 'rhythm',
    va: Store.get('p.va', 'hembra:O'),
    vb: Store.get('p.vb', 'macho:S'),
    muteA: false, muteB: false, cycle: false,
  };
  let pos = { step: 0, time: 0, dur: 1 };
  const flashA = {};
  const flashB = {};
  let colCells = [];
  let lastCol = -1;
  let bpmCtl;

  el.innerHTML = `
    <div class="poly-layout">
      <section class="card poly-main">
        <h1>Полиритмы и полиметры</h1>
        <div class="presets" id="p-presets"></div>
        <div class="poly-controls">
          <div class="ab">
            <label class="voice-a">A <select id="p-a" aria-label="Число ударов голоса A">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option>${n}</option>`).join('')}</select></label>
            <span class="vs">против</span>
            <label class="voice-b">B <select id="p-b" aria-label="Число ударов голоса B">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option>${n}</option>`).join('')}</select></label>
          </div>
          <div class="seg" role="radiogroup" aria-label="Режим">
            <button data-mode="rhythm" role="radio">Полиритм</button>
            <button data-mode="meter" role="radio">Полиметр</button>
          </div>
        </div>
        <div class="controls">
          <button class="btn play" id="p-play">▶ Играть</button>
          <span id="p-bpm"></span>
        </div>
        <canvas id="p-canvas" aria-label="Круговая схема полиритма"></canvas>
        <div class="grid-wrap"><div class="rgrid" id="p-grid"></div></div>
      </section>
      <aside class="card poly-side">
        <h2 id="p-title"></h2>
        <div id="p-explain" class="explain"></div>
        <h3>Звуки</h3>
        <div class="voice-row voice-a">
          <label>Голос A <select id="p-va">${Object.entries(VOICES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="toggle"><input type="checkbox" id="p-ma"> заглушить</label>
        </div>
        <div class="voice-row voice-b">
          <label>Голос B <select id="p-vb">${Object.entries(VOICES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="toggle"><input type="checkbox" id="p-mb"> заглушить</label>
        </div>
        <label class="toggle"><input type="checkbox" id="p-cycle"> Бас на начало цикла</label>
        <p class="muted small">Совет: заглушите один голос и играйте его сами. Потом — оба голоса двумя руками: A правой по эмбре, B левой по мачо.</p>
        <button class="btn" id="p-done"></button>
      </aside>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const canvas = $('#p-canvas');

  bpmCtl = UI.bpmControl({
    value: st.bpm, min: 20, max: 240, label: 'Темп B',
    onChange: (v) => { st.bpm = v; transport.bpm = v; },
  });
  $('#p-bpm').appendChild(bpmCtl.el);

  $('#p-presets').innerHTML = PRESETS.map((p) => `<button class="chip-btn" data-preset="${p}">${p}</button>`).join('');
  $('#p-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const [a, bb] = b.dataset.preset.split(':').map(Number);
    setAB(a, bb);
  });
  $('#p-a').addEventListener('change', (e) => setAB(+e.target.value, st.b));
  $('#p-b').addEventListener('change', (e) => setAB(st.a, +e.target.value));
  el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.mode; changed(); }));
  $('#p-va').value = st.va;
  $('#p-vb').value = st.vb;
  $('#p-va').addEventListener('change', (e) => { st.va = e.target.value; Store.set('p.va', st.va); buildGrid(); });
  $('#p-vb').addEventListener('change', (e) => { st.vb = e.target.value; Store.set('p.vb', st.vb); buildGrid(); });
  $('#p-ma').addEventListener('change', (e) => { st.muteA = e.target.checked; });
  $('#p-mb').addEventListener('change', (e) => { st.muteB = e.target.checked; });
  $('#p-cycle').addEventListener('change', (e) => { st.cycle = e.target.checked; });
  $('#p-play').addEventListener('click', toggle);
  $('#p-done').addEventListener('click', () => {
    const k = key();
    Store.setPoly(k, !Store.polyDone(k));
    renderDone();
    if (Store.polyDone(k)) UI.toast(`${k} освоен!`);
  });

  function key() { return `${st.a}:${st.b}${st.mode === 'meter' ? '/meter' : ''}`; }

  function setAB(a, b) {
    st.a = UI.clamp(a, 1, 9);
    st.b = UI.clamp(b, 1, 9);
    changed();
  }

  function changed() {
    const wasPlaying = transport.playing;
    transport.stop();
    history.replaceState(null, '', `#/poly/${key()}`);
    render();
    if (wasPlaying) play();
  }

  // ───────── Расчёты ─────────
  function L() { return UI.lcm(st.a, st.b); }
  function hitA(step) { return st.mode === 'meter' ? true : step % (L() / st.a) === 0; }
  function hitB(step) { return st.mode === 'meter' ? true : step % (L() / st.b) === 0; }
  function accA(step) { return st.mode === 'meter' ? step % st.a === 0 : true; }
  function accB(step) { return st.mode === 'meter' ? step % st.b === 0 : true; }

  function voiceChar(v, accent) {
    const [inst, ch] = v.split(':');
    if (accent) return [inst, ch];
    const kind = INSTRUMENTS[inst].kind;
    return [inst, kind === 'drum' || kind === 'bell' ? ch.toLowerCase() : 'x'];
  }

  // ───────── Отрисовка ─────────
  function render() {
    $('#p-a').value = st.a;
    $('#p-b').value = st.b;
    el.querySelectorAll('[data-mode]').forEach((b) => {
      b.classList.toggle('sel', b.dataset.mode === st.mode);
      b.setAttribute('aria-checked', b.dataset.mode === st.mode);
    });
    el.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('sel', b.dataset.preset === `${st.a}:${st.b}`));
    bpmCtl.el.querySelector('.bpm-label').textContent = st.mode === 'meter' ? 'Темп шага' : 'Темп B';
    renderExplain();
    renderDone();
    buildGrid();
    pos = { step: 0, time: 0, dur: 1 };
    drawCanvas(0, true);
  }

  function renderDone() {
    const d = Store.polyDone(key());
    const b = $('#p-done');
    b.textContent = d ? `✓ ${key()} освоен` : `Отметить ${key()} освоенным`;
    b.className = 'btn ' + (d ? 'ok' : 'primary');
  }

  function renderExplain() {
    const { a, b } = st;
    const n = L();
    const title = st.mode === 'meter' ? `Полиметр ${a} на ${b}` : `Полиритм ${a}:${b}`;
    $('#p-title').textContent = title;
    let html;
    if (st.mode === 'rhythm') {
      const listA = [];
      const listB = [];
      const res = [];
      for (let s = 0; s < n; s++) {
        const ha = hitA(s);
        const hb = hitB(s);
        if (ha) listA.push(s + 1);
        if (hb) listB.push(s + 1);
        res.push(ha && hb ? 'ОБЕ' : ha ? 'П' : hb ? 'Л' : '·');
      }
      html = `
        <p>За один цикл голос <b class="ca">A</b> делает <b>${a}</b> ровных ударов, а голос <b class="cb">B</b> за то же время — <b>${b}</b>.</p>
        ${a === b ? '<p>Числа равны — это не полиритм, а унисон. Выберите разные числа.</p>' : ''}
        ${UI.gcd(a, b) > 1 && a !== b ? `<p class="muted">У чисел ${a} и ${b} есть общий делитель ${UI.gcd(a, b)}, поэтому это ${a / UI.gcd(a, b)}:${b / UI.gcd(a, b)}, повторённый ${UI.gcd(a, b)} раза.</p>` : ''}
        <p><b>Как считать:</b> общий счёт до <b>${n}</b>.<br>
        <b class="ca">A</b> (правая) — на ${listA.join(', ')}.<br>
        <b class="cb">B</b> (левая) — на ${listB.join(', ')}.</p>
        ${n <= 24 ? `<p><b>Результирующий ритм</b> (выучите как одну фразу):</p><p class="resultant">${res.join(' ')}</p>` : ''}
        ${MNEMONIC[`${a}:${b}`] ? `<p class="muted">Подсказка: ${MNEMONIC[`${a}:${b}`]}</p>` : ''}
        <p class="muted small">Темп задаёт голос B: при ${st.bpm} BPM один цикл длится ${(b * 60 / st.bpm).toFixed(1)} с.</p>`;
    } else {
      html = `
        <p>Шаги у обоих голосов <b>одинаковой длины</b>. Голос <b class="ca">A</b> повторяет цикл из <b>${a}</b> шагов, голос <b class="cb">B</b> — из <b>${b}</b>. Громкий удар — начало цикла.</p>
        <p>Акценты разъезжаются и снова совпадают через <b>${n}</b> шагов: за это время A пройдёт ${n / a} цикл(ов), а B — ${n / b}.</p>
        <p class="muted">Так строятся «сдвигающиеся» фразы в афро-кубинской музыке, джазе и прогрессивном роке: фраза из ${a} на фоне счёта на ${b}.</p>`;
    }
    $('#p-explain').innerHTML = html;
  }

  function buildGrid() {
    const n = L();
    const grid = $('#p-grid');
    grid.style.setProperty('--cols', n);
    const [ia, ca] = voiceChar(st.va, true);
    const [ib, cb] = voiceChar(st.vb, true);
    const beatEvery = st.mode === 'meter' ? 1 : n / st.b;
    const gs = (s) => (s % beatEvery === 0 ? ' gs' : '') + (Math.floor(s / beatEvery) % 2 ? ' alt' : '');
    let html = '<div class="gl gh">Счёт</div>';
    for (let s = 0; s < n; s++) html += `<div class="gc gh${gs(s)}" data-s="${s}">${s + 1}</div>`;
    const row = (label, cls, inst, ch, hit, acc) => {
      let h = `<div class="gl ${cls}"><span>${label}</span></div>`;
      for (let s = 0; s < n; s++) {
        if (!hit(s)) { h += `<div class="gc cell${gs(s)}" data-s="${s}"></div>`; continue; }
        const info = UI.cellInfo(inst, acc(s) ? ch : voiceChar(inst + ':' + ch, false)[1]);
        h += `<div class="gc cell ${info.cls}${gs(s)}" data-s="${s}">${info.label}</div>`;
      }
      return h;
    };
    html += row(`A · ${st.a}`, 'voice-a', ia, ca, hitA, accA);
    html += row(`B · ${st.b}`, 'voice-b', ib, cb, hitB, accB);
    grid.innerHTML = html;
    colCells = Array.from({ length: n }, () => []);
    grid.querySelectorAll('.gc').forEach((c) => colCells[+c.dataset.s].push(c));
    lastCol = -1;
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function drawCanvas(now, resize) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const meter = st.mode === 'meter';
    const h = meter ? Math.min(w * 0.55, 300) : Math.min(w, 340);
    if (resize || canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = h + 'px';
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const colA = cssVar('--voice-a') || '#f59e0b';
    const colB = cssVar('--voice-b') || '#22d3ee';
    const faint = cssVar('--line') || '#444';
    const text = cssVar('--text') || '#eee';

    const n = L();
    const frac = pos.dur ? UI.clamp((now - pos.time) / pos.dur, 0, 1) : 0;
    const stepPos = transport.playing ? pos.step + frac : 0;

    const ring = (cx, cy, r, count, color, flashes, phase, drawHand) => {
      g.strokeStyle = faint;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      // многоугольник
      if (count > 1) {
        g.strokeStyle = color;
        g.globalAlpha = 0.35;
        g.beginPath();
        for (let i = 0; i <= count; i++) {
          const ang = -Math.PI / 2 + (i / count) * Math.PI * 2;
          const x = cx + Math.cos(ang) * r;
          const y = cy + Math.sin(ang) * r;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
        g.globalAlpha = 1;
      }
      for (let i = 0; i < count; i++) {
        const ang = -Math.PI / 2 + (i / count) * Math.PI * 2;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        const f = flashes[i] ? Math.max(0, 1 - (now - flashes[i]) / 0.3) : 0;
        const rad = (i === 0 ? 11 : 8) + f * 7;
        if (f > 0) {
          g.fillStyle = color;
          g.globalAlpha = 0.25 * f;
          g.beginPath();
          g.arc(x, y, rad + 8, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 1;
        }
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
      }
      if (drawHand) {
        const ang = -Math.PI / 2 + phase * Math.PI * 2;
        g.strokeStyle = text;
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(ang) * (r + 14), cy + Math.sin(ang) * (r + 14));
        g.stroke();
        g.fillStyle = text;
        g.beginPath();
        g.arc(cx, cy, 4, 0, Math.PI * 2);
        g.fill();
      }
    };

    g.font = '600 14px system-ui, sans-serif';
    g.textAlign = 'center';
    if (!meter) {
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) / 2 - 26;
      const phase = stepPos / n;
      ring(cx, cy, R, st.a, colA, flashA, phase, false);
      ring(cx, cy, R * 0.6, st.b, colB, flashB, phase, true);
      g.fillStyle = colA;
      g.fillText(`A: ${st.a}`, 34, 22);
      g.fillStyle = colB;
      g.fillText(`B: ${st.b}`, w - 34, 22);
    } else {
      const R = Math.min(w / 4, h / 2) - 26;
      const cyy = h / 2 + 8;
      ring(w * 0.27, cyy, R, st.a, colA, flashA, (stepPos % st.a) / st.a, true);
      ring(w * 0.73, cyy, R, st.b, colB, flashB, (stepPos % st.b) / st.b, true);
      g.fillStyle = colA;
      g.fillText(`A: цикл ${st.a}`, w * 0.27, 18);
      g.fillStyle = colB;
      g.fillText(`B: цикл ${st.b}`, w * 0.73, 18);
    }
  }

  // ───────── Воспроизведение ─────────
  function play() {
    const n = L();
    transport.onStep = (step, time) => {
      if (st.cycle && step === 0) Sound.play('bass', 'X', time);
      if (hitA(step) && !st.muteA) {
        const [i, c] = voiceChar(st.va, accA(step));
        Sound.play(i, c, time);
      }
      if (hitB(step) && !st.muteB) {
        const [i, c] = voiceChar(st.vb, accB(step));
        Sound.play(i, c, time);
      }
    };
    transport.onDraw = (step, time, dur) => {
      pos = { step, time, dur };
      if (hitA(step)) flashA[st.mode === 'meter' ? step % st.a : step / (n / st.a)] = time;
      if (hitB(step)) flashB[st.mode === 'meter' ? step % st.b : step / (n / st.b)] = time;
      if (lastCol >= 0 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove('now'));
      if (colCells[step]) colCells[step].forEach((c) => c.classList.add('now'));
      lastCol = step;
    };
    transport.onFrame = (now) => drawCanvas(now);
    transport.onStop = () => {
      if (lastCol >= 0 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove('now'));
      lastCol = -1;
      $('#p-play').textContent = '▶ Играть';
      $('#p-play').classList.remove('on');
      pos = { step: 0, time: 0, dur: 1 };
      drawCanvas(0);
    };
    const spb = st.mode === 'meter' ? 1 : n / st.b;
    transport.start({ bpm: st.bpm, spb, total: n });
    $('#p-play').textContent = '■ Стоп';
    $('#p-play').classList.add('on');
  }

  function toggle() { transport.playing ? transport.stop() : play(); }

  window.addEventListener('resize', () => { if (el.classList.contains('active')) drawCanvas(0, true); });

  return {
    show(params) {
      if (params[0] && /^\d:\d$/.test(params[0])) {
        const [a, b] = params[0].split(':').map(Number);
        st.a = UI.clamp(a, 1, 9);
        st.b = UI.clamp(b, 1, 9);
        st.mode = params[1] === 'meter' ? 'meter' : 'rhythm';
      }
      render();
    },
    toggle,
    hide() { transport.stop(); },
  };
})();
