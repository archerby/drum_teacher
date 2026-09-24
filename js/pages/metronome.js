window.Pages = window.Pages || {};

Pages.metronome = (() => {
  const el = document.getElementById('page-metronome');
  const transport = new Transport();

  const SUBS = [
    { v: 1, name: 'Четверти', hint: '1 2 3 4' },
    { v: 2, name: 'Восьмые', hint: '1 и 2 и' },
    { v: 3, name: 'Триоли', hint: '1 ла ли' },
    { v: 4, name: 'Шестнадцатые', hint: '1 е и а' },
    { v: 5, name: 'Квинтоли', hint: '5 на долю' },
    { v: 6, name: 'Секстоли', hint: '6 на долю' },
  ];
  const SOUNDS = { beep: 'Бип', wood: 'Вуд-блок', bell: 'Колокол', voice: 'Мягкий' };

  const st = {
    bpm: Store.get('m.bpm', 80),
    beats: Store.get('m.beats', 4),
    sub: Store.get('m.sub', 1),
    sound: Store.get('m.sound', 'beep'),
    subVol: Store.get('m.subVol', 0.6),
    accents: null, // 2 — акцент, 1 — обычная, 0 — тишина
    // тренеры
    speed: false, speedStep: 5, speedEvery: 4, speedMax: 160,
    gap: false, gapPlay: 3, gapMute: 1,
    random: false, randomPct: 25,
    flash: false,
  };
  st.accents = Array.from({ length: st.beats }, (_, i) => (i === 0 ? 2 : 1));

  let bar = 0;
  let bpmCtl;

  el.innerHTML = `
    <div class="metro-layout">
      <section class="card metro-main">
        <div class="metro-display" id="m-display">
          <div class="metro-bpm"><b id="m-bpm-big">${st.bpm}</b><span>BPM</span></div>
          <div class="metro-tempo" id="m-tempo"></div>
          <div class="beat-dots" id="m-dots"></div>
          <div class="metro-status" id="m-status">Нажмите на кружок, чтобы сделать долю акцентной или беззвучной</div>
        </div>
        <div class="controls center">
          <button class="btn play big" id="m-play">▶ Старт</button>
          <button class="btn" id="m-tap" title="Постучите несколько раз в нужном темпе">👆 Тап-темп</button>
        </div>
        <div id="m-bpm" class="center-row"></div>
      </section>

      <section class="card metro-settings">
        <h2>Настройки</h2>
        <div class="field">
          <span>Долей в такте</span>
          <div class="stepper">
            <button class="btn small" data-beats="-1" aria-label="Меньше долей">−</button>
            <b id="m-beats">${st.beats}</b>
            <button class="btn small" data-beats="1" aria-label="Больше долей">+</button>
          </div>
        </div>
        <div class="field">
          <span>Дробление доли</span>
          <div class="seg wrap" id="m-subs">
            ${SUBS.map((s) => `<button data-sub="${s.v}" title="${s.hint}">${s.name}</button>`).join('')}
          </div>
        </div>
        <div class="field">
          <span>Звук</span>
          <select id="m-sound">${Object.entries(SOUNDS).map(([k, v]) => `<option value="${k}" ${k === st.sound ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div>
        <div class="field">
          <span>Громкость дробления</span>
          <input type="range" id="m-subvol" min="0" max="100" value="${Math.round(st.subVol * 100)}" aria-label="Громкость дробления">
        </div>
        <label class="toggle"><input type="checkbox" id="m-flash"> Мигать экраном на долю</label>

        <h2>Тренировка</h2>
        <div class="trainer-box">
          <label class="toggle"><input type="checkbox" id="m-speed"> <b>Ускорение</b></label>
          <div class="sub-opts">+<input type="number" id="m-sstep" min="1" max="20" value="${st.speedStep}" aria-label="Прибавка BPM"> BPM
            каждые <input type="number" id="m-severy" min="1" max="64" value="${st.speedEvery}" aria-label="Каждые N тактов"> такт.
            до <input type="number" id="m-smax" min="30" max="300" value="${st.speedMax}" aria-label="Максимальный темп"></div>
          <p class="muted small">Темп растёт сам — как «лестница» к нужной скорости.</p>
        </div>
        <div class="trainer-box">
          <label class="toggle"><input type="checkbox" id="m-gap"> <b>Пропуски</b></label>
          <div class="sub-opts">звук <input type="number" id="m-gplay" min="1" max="16" value="${st.gapPlay}" aria-label="Тактов со звуком"> такт.,
            тишина <input type="number" id="m-gmute" min="1" max="16" value="${st.gapMute}" aria-label="Тактов тишины"> такт.</div>
          <p class="muted small">Метроном замолкает, а вы продолжаете. Совпадёте, когда он вернётся?</p>
        </div>
        <div class="trainer-box">
          <label class="toggle"><input type="checkbox" id="m-random"> <b>Случайные пропуски</b></label>
          <div class="sub-opts">выпадает <input type="number" id="m-rpct" min="5" max="90" value="${st.randomPct}" aria-label="Процент пропусков">% долей</div>
        </div>
      </section>
    </div>`;

  const $ = (s) => el.querySelector(s);

  bpmCtl = UI.bpmControl({
    value: st.bpm, min: 20, max: 300,
    onChange: (v) => { st.bpm = v; transport.bpm = v; Store.set('m.bpm', v); updateBig(); },
  });
  $('#m-bpm').appendChild(bpmCtl.el);

  function updateBig() {
    $('#m-bpm-big').textContent = st.bpm;
    $('#m-tempo').textContent = UI.tempoName(st.bpm);
  }

  function renderDots() {
    $('#m-beats').textContent = st.beats;
    $('#m-dots').innerHTML = st.accents.map((a, i) => `
      <button class="beat-dot lvl${a}" data-beat="${i}" aria-label="Доля ${i + 1}: ${['тишина', 'обычная', 'акцент'][a]}">
        <span>${i + 1}</span>
        <i class="subs">${Array.from({ length: st.sub }, (_, k) => `<em data-sub-i="${k}"></em>`).join('')}</i>
      </button>`).join('');
    el.querySelectorAll('[data-sub]').forEach((b) => b.classList.toggle('sel', +b.dataset.sub === st.sub));
  }

  $('#m-dots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-beat]');
    if (!b) return;
    const i = +b.dataset.beat;
    st.accents[i] = (st.accents[i] + 2) % 3; // 1 → 0 → 2 → 1
    renderDots();
  });
  el.querySelectorAll('[data-beats]').forEach((b) => b.addEventListener('click', () => {
    const n = UI.clamp(st.beats + +b.dataset.beats, 1, 16);
    if (n === st.beats) return;
    st.accents = Array.from({ length: n }, (_, i) => (i < st.accents.length ? st.accents[i] : 1));
    st.beats = n;
    Store.set('m.beats', n);
    restartIfPlaying();
    renderDots();
  }));
  el.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => {
    st.sub = +b.dataset.sub;
    Store.set('m.sub', st.sub);
    restartIfPlaying();
    renderDots();
  }));
  $('#m-sound').addEventListener('change', (e) => { st.sound = e.target.value; Store.set('m.sound', st.sound); Sound.click(Sound.now() + 0.01, 2, st.sound); });
  $('#m-subvol').addEventListener('input', (e) => { st.subVol = +e.target.value / 100; Store.set('m.subVol', st.subVol); });
  $('#m-flash').addEventListener('change', (e) => { st.flash = e.target.checked; });

  const num = (id, key, lo, hi) => $(id).addEventListener('change', (e) => { st[key] = UI.clamp(+e.target.value || lo, lo, hi); e.target.value = st[key]; });
  $('#m-speed').addEventListener('change', (e) => {
    st.speed = e.target.checked;
    if (st.speed && st.speedMax <= st.bpm) { st.speedMax = Math.min(300, st.bpm + 40); $('#m-smax').value = st.speedMax; }
  });
  num('#m-sstep', 'speedStep', 1, 20);
  num('#m-severy', 'speedEvery', 1, 64);
  num('#m-smax', 'speedMax', 30, 300);
  $('#m-gap').addEventListener('change', (e) => { st.gap = e.target.checked; });
  num('#m-gplay', 'gapPlay', 1, 16);
  num('#m-gmute', 'gapMute', 1, 16);
  $('#m-random').addEventListener('change', (e) => { st.random = e.target.checked; });
  num('#m-rpct', 'randomPct', 5, 90);

  const tap = UI.tapTempo((v) => bpmCtl.set(v));
  $('#m-tap').addEventListener('click', tap);
  $('#m-play').addEventListener('click', toggle);

  // ───────── Звук ─────────
  let silentBar = false;

  function barIsSilent(b) {
    if (!st.gap) return false;
    const cyc = st.gapPlay + st.gapMute;
    return b % cyc >= st.gapPlay;
  }

  function play() {
    bar = 0;
    silentBar = false;
    transport.onStep = (step, time) => {
      const beat = Math.floor(step / st.sub);
      const sub = step % st.sub;
      if (step === 0) silentBar = barIsSilent(bar);
      if (silentBar) return;
      const lvl = st.accents[beat];
      if (!lvl) return;
      if (sub === 0) {
        if (st.random && beat !== 0 && Math.random() * 100 < st.randomPct) return;
        Sound.click(time, lvl === 2 ? 2 : 1, st.sound);
      } else if (st.subVol > 0) {
        Sound.click(time, 0.5, st.sound, st.subVol);
      }
    };
    transport.onLoop = () => {
      bar++;
      if (st.speed && bar % st.speedEvery === 0 && st.bpm < st.speedMax) {
        bpmCtl.set(Math.min(st.speedMax, st.bpm + st.speedStep));
      }
    };
    let lastDot = null;
    let drawBar = 0;
    transport.onDraw = (step) => {
      const beat = Math.floor(step / st.sub);
      const sub = step % st.sub;
      if (step === 0) drawBar++;
      const dots = $('#m-dots').children;
      if (lastDot) lastDot.classList.remove('now');
      el.querySelectorAll('.subs em.now').forEach((x) => x.classList.remove('now'));
      const dot = dots[beat];
      if (!dot) return;
      const em = dot.querySelectorAll('.subs em')[sub];
      if (em) em.classList.add('now');
      if (sub === 0) {
        dot.classList.add('now');
        lastDot = dot;
        const silent = barIsSilent(drawBar - 1);
        const status = silent ? '🤫 Тишина — держите темп сами!' : `Такт ${drawBar}`;
        $('#m-status').textContent = status;
        $('#m-display').classList.toggle('silent', silent);
        if (st.flash && !silent && st.accents[beat]) {
          const d = $('#m-display');
          d.classList.remove('flash');
          void d.offsetWidth;
          d.classList.add('flash');
        }
      }
    };
    transport.onStop = () => {
      el.querySelectorAll('.now').forEach((x) => x.classList.remove('now'));
      $('#m-display').classList.remove('silent');
      $('#m-status').textContent = 'Остановлено';
      $('#m-play').textContent = '▶ Старт';
      $('#m-play').classList.remove('on');
    };
    transport.start({ bpm: st.bpm, spb: st.sub, total: st.beats * st.sub });
    $('#m-play').textContent = '■ Стоп';
    $('#m-play').classList.add('on');
  }

  function restartIfPlaying() {
    if (transport.playing) { transport.stop(); play(); }
  }

  function toggle() { transport.playing ? transport.stop() : play(); }

  updateBig();
  renderDots();

  return {
    show() { updateBig(); },
    toggle,
    hide() { transport.stop(); },
  };
})();
