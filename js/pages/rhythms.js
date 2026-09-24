window.Pages = window.Pages || {};

Pages.rhythms = (() => {
  const el = document.getElementById('page-rhythms');
  const transport = new Transport();
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let cur = null; // рабочая копия ритма
  let editing = false;
  let dirty = false;
  let tool = 'O';
  let ghost = false;
  let muted = new Set();
  let colCells = [];
  let lastCol = -1;
  let loops = 0;
  let bpmCtl = null;
  let listQuery = '';

  const opts = {
    countIn: Store.get('r.countIn', true),
    click: Store.get('r.click', false),
    speed: false,
    speedStep: 2,
    speedEvery: 4,
    speedMax: 160,
  };

  // ───────── Каркас ─────────
  el.innerHTML = `
    <div class="two-col rhythms">
      <aside class="card list-col rlist">
        <div class="rlist-top">
          <input type="search" id="r-search" placeholder="Поиск: мартильо, 6/8, клаве…" aria-label="Поиск ритма">
          <div class="rlist-btns">
            <button class="btn small" id="r-new">＋ Новый ритм</button>
            <button class="btn small" id="r-import">⇩ Импорт</button>
          </div>
        </div>
        <div class="rlist-items" id="r-items"></div>
      </aside>
      <div class="card player" id="r-player"></div>
    </div>`;

  const itemsEl = el.querySelector('#r-items');
  const playerEl = el.querySelector('#r-player');

  el.querySelector('#r-search').addEventListener('input', (e) => { listQuery = e.target.value.trim().toLowerCase(); renderList(); });
  el.querySelector('#r-new').addEventListener('click', newRhythm);
  el.querySelector('#r-import').addEventListener('click', importRhythm);

  // ───────── Список ─────────
  function renderList() {
    const all = [...RHYTHMS, ...Store.customs()];
    const match = (r) => !listQuery || `${r.name} ${r.sig} ${r.origin || ''} ${r.desc || ''}`.toLowerCase().includes(listQuery);
    itemsEl.innerHTML = RHYTHM_CATEGORIES.map((cat) => {
      const items = all.filter((r) => (r.cat || 'mine') === cat.id && match(r));
      if (!items.length) return '';
      return `<div class="rcat"><h3>${UI.esc(cat.name)}</h3>${items.map((r) => `
        <a class="ritem ${cur && cur.id === r.id ? 'active' : ''} ${Store.rhythmDone(r.id) ? 'done' : ''}" href="#/rhythms/${r.id}">
          <span class="rname">${Store.rhythmDone(r.id) ? '✓ ' : ''}${UI.esc(r.name)}</span>
          <span class="rmeta">${UI.esc(r.sig)} · ${'★'.repeat(r.level || 1)}</span>
        </a>`).join('')}</div>`;
    }).join('') || '<p class="muted">Ничего не найдено.</p>';
  }

  // ───────── Плеер ─────────
  function load(id) {
    if (dirty && cur && cur.id !== id && !confirm('Есть несохранённые изменения. Выйти без сохранения?')) {
      location.hash = '#/rhythms/' + cur.id;
      return;
    }
    const r = UI.findRhythm(id) || RHYTHMS.find((x) => x.id === 'martillo');
    transport.stop();
    cur = clone(r);
    cur.bars = cur.bars || 1;
    editing = false;
    dirty = false;
    muted = new Set();
    renderPlayer();
    renderList();
  }

  function newRhythm() {
    transport.stop();
    cur = {
      id: 'c_new', cat: 'mine', name: 'Мой ритм', sig: '4/4', beats: 4, spb: 2, bars: 1, bpm: 90, level: 1,
      origin: 'Мой ритм', desc: '', tips: [],
      tracks: [{ i: 'macho', p: '........' }, { i: 'hembra', p: '........' }],
      hands: '........',
    };
    editing = true;
    dirty = true;
    muted = new Set();
    renderPlayer();
    renderList();
    playerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function total() { return cur.beats * cur.spb * cur.bars; }

  function renderPlayer() {
    const r = cur;
    const isCustom = r.id.startsWith('c_');
    const done = Store.rhythmDone(r.id);
    const best = Store.rhythmBest(r.id);
    playerEl.innerHTML = `
      <div class="player-head">
        <h1>${UI.esc(r.name)}</h1>
        <div class="chips">
          <span class="chip">${UI.esc(r.sig)}</span>
          ${r.origin ? `<span class="chip">${UI.esc(r.origin)}</span>` : ''}
          <span class="chip">Сложность ${'★'.repeat(r.level || 1)}${'☆'.repeat(3 - Math.min(3, r.level || 1))}</span>
          ${best ? `<span class="chip ok">Рекорд: ${best} BPM</span>` : ''}
        </div>
      </div>
      <div class="r-stage">
        <div class="r-wheelbox">
          <canvas id="r-wheel" aria-label="Колесо ритма: партии по кольцам"></canvas>
          <div class="r-cycle" id="r-cycle"></div>
        </div>
        <div class="r-text">
          ${r.desc ? `<p class="desc">${UI.esc(r.desc)}</p>` : ''}
          ${r.tips && r.tips.length ? `<ul class="tips">${r.tips.map((t) => `<li>${UI.esc(t)}</li>`).join('')}</ul>` : ''}
          <p class="r-wheelhint">Колесо — это один цикл ритма. Каждая партия — своё кольцо (снаружи внутрь — как строки сетки), спицы — доли, стрелка показывает, где вы сейчас.</p>
        </div>
      </div>

      <div class="controls">
        <button class="btn play" id="r-play">▶ Играть</button>
        <span id="r-bpm"></span>
      </div>
      <div class="controls options">
        <label class="toggle"><input type="checkbox" id="r-countin" ${opts.countIn ? 'checked' : ''}> Отсчёт</label>
        <label class="toggle"><input type="checkbox" id="r-click" ${opts.click ? 'checked' : ''}> Щелчок</label>
        <label class="toggle"><input type="checkbox" id="r-speed" ${opts.speed ? 'checked' : ''}> Ускорение</label>
        <span class="speed-opts ${opts.speed ? '' : 'dim'}">
          +<input type="number" id="r-sstep" min="1" max="20" value="${opts.speedStep}" aria-label="Прибавка BPM">
          BPM каждые <input type="number" id="r-severy" min="1" max="32" value="${opts.speedEvery}" aria-label="Каждые N повторов"> повт.
          до <input type="number" id="r-smax" min="40" max="300" value="${opts.speedMax}" aria-label="Максимальный темп">
        </span>
        <button class="btn small" id="r-self" title="Заглушить партии бонго, чтобы играть их самому">🙌 Играю сам</button>
        <span class="countin" id="r-countin-badge" aria-live="polite"></span>
      </div>

      <div class="edit-panel" id="r-edit" ${editing ? '' : 'hidden'}></div>

      <div class="grid-wrap" id="r-gridwrap"><div class="rgrid" id="r-grid"></div></div>
      <div class="legend" id="r-legend"></div>

      <div class="actions">
        ${editing ? `
          <button class="btn primary" id="r-save">💾 Сохранить</button>
          <button class="btn" id="r-cancel">Отмена</button>
        ` : `
          <button class="btn ${done ? 'ok' : 'primary'}" id="r-done" ${r.id === 'c_new' ? 'disabled' : ''}>${done ? '✓ Освоено' : 'Отметить «Освоено»'}</button>
          <button class="btn" id="r-editbtn">✎ Редактировать</button>
        `}
        <span class="spacer"></span>
        <button class="btn small" id="r-export" title="Скопировать ритм как текст, чтобы поделиться">⇧ Экспорт</button>
        ${isCustom && r.id !== 'c_new' ? '<button class="btn small danger" id="r-delete">🗑 Удалить</button>' : ''}
      </div>`;

    bpmCtl = UI.bpmControl({
      value: r.bpm, min: 30, max: 300,
      onChange: (v) => { cur.bpm = v; transport.bpm = v; },
    });
    playerEl.querySelector('#r-bpm').appendChild(bpmCtl.el);

    const $ = (s) => playerEl.querySelector(s);
    $('#r-play').addEventListener('click', toggle);
    $('#r-countin').addEventListener('change', (e) => { opts.countIn = e.target.checked; Store.set('r.countIn', opts.countIn); });
    $('#r-click').addEventListener('change', (e) => { opts.click = e.target.checked; Store.set('r.click', opts.click); });
    $('#r-speed').addEventListener('change', (e) => {
      opts.speed = e.target.checked;
      $('.speed-opts').classList.toggle('dim', !opts.speed);
      if (opts.speed && opts.speedMax <= cur.bpm) { opts.speedMax = cur.bpm + 30; $('#r-smax').value = opts.speedMax; }
    });
    $('#r-sstep').addEventListener('change', (e) => { opts.speedStep = UI.clamp(+e.target.value || 2, 1, 20); });
    $('#r-severy').addEventListener('change', (e) => { opts.speedEvery = UI.clamp(+e.target.value || 4, 1, 32); });
    $('#r-smax').addEventListener('change', (e) => { opts.speedMax = UI.clamp(+e.target.value || 160, 40, 300); });
    $('#r-self').addEventListener('click', selfPlay);
    $('#r-export').addEventListener('click', exportRhythm);
    if ($('#r-delete')) $('#r-delete').addEventListener('click', deleteRhythm);
    if (editing) {
      $('#r-save').addEventListener('click', save);
      $('#r-cancel').addEventListener('click', cancelEdit);
      renderEditPanel();
    } else {
      $('#r-done').addEventListener('click', (e) => {
        const d = !Store.rhythmDone(cur.id);
        Store.setRhythm(cur.id, d, bpmCtl.value);
        e.currentTarget.textContent = d ? '✓ Освоено' : 'Отметить «Освоено»';
        e.currentTarget.className = 'btn ' + (d ? 'ok' : 'primary');
        if (d) UI.toast(`Освоено на ${bpmCtl.value} BPM!`);
      });
      $('#r-editbtn').addEventListener('click', () => { transport.stop(); editing = true; renderPlayer(); });
    }
    buildGrid();
  }

  // ───────── Сетка ─────────
  const gridEl = () => playerEl.querySelector('#r-grid');

  function buildGrid() {
    const r = cur;
    const perBar = r.beats * r.spb;
    const n = total();
    const starts = UI.groupStarts(r);
    // номер группы для чередования фона
    const groupIdx = [];
    let g = -1;
    for (let s = 0; s < perBar; s++) { if (starts.has(s)) g++; groupIdx.push(g); }

    const colCls = (s) => {
      const sb = s % perBar;
      let c = groupIdx[sb] % 2 ? ' alt' : '';
      if (starts.has(sb)) c += ' gs';
      if (sb === 0 && s > 0) c += ' bar';
      return c;
    };

    const grid = gridEl();
    grid.style.setProperty('--cols', n);
    grid.classList.toggle('editing', editing);
    let html = '<div class="gl gh">Счёт</div>';
    for (let s = 0; s < n; s++) {
      const lbl = UI.countLabel(s % perBar, r.spb);
      const strong = s % perBar === 0 || starts.has(s % perBar);
      html += `<div class="gc gh${colCls(s)}${strong ? ' strong' : ''}" data-s="${s}">${lbl}</div>`;
    }
    r.tracks.forEach((t, ti) => {
      const inst = INSTRUMENTS[t.i] || { name: t.i };
      html += `<div class="gl"><button class="mute ${muted.has(ti) ? 'on' : ''}" data-mute="${ti}" title="Заглушить / включить партию" aria-pressed="${muted.has(ti)}">M</button><span title="${UI.esc(inst.full || inst.name)}">${UI.esc(inst.name)}</span>${editing ? `<button class="del" data-del="${ti}" title="Удалить строку">✕</button>` : ''}</div>`;
      for (let s = 0; s < n; s++) {
        const info = UI.cellInfo(t.i, t.p[s]);
        html += `<div class="gc cell ${info.cls}${colCls(s)}${muted.has(ti) ? ' muted' : ''}" data-t="${ti}" data-s="${s}"${info.name ? ` title="${UI.esc(info.name)}"` : ''}>${info.label}</div>`;
      }
    });
    const hands = r.hands || '';
    if (hands.replace(/\./g, '') || editing) {
      html += '<div class="gl hands-l">Руки</div>';
      for (let s = 0; s < n; s++) {
        const h = hands[s] && hands[s] !== '.' ? hands[s] : '';
        html += `<div class="gc hand${colCls(s)} h-${h}" data-t="h" data-s="${s}"${h ? ` title="${HANDS[h]}"` : ''}>${h}</div>`;
      }
    }
    grid.innerHTML = html;
    colCells = Array.from({ length: n }, () => []);
    grid.querySelectorAll('.gc').forEach((c) => colCells[+c.dataset.s].push(c));
    lastCol = -1;
    renderLegend();
    if (!transport.playing) drawWheel(null);
  }

  // ───────── Колесо ─────────
  let wheelPos = null; // {step, time, dur}
  let countHub = null;

  function drawWheel(playPos) {
    const canvas = playerEl.querySelector('#r-wheel');
    if (!canvas) return;
    const perBar = cur.beats * cur.spb;
    const starts = new Set();
    const gs = UI.groupStarts(cur);
    for (let b = 0; b < cur.bars; b++) gs.forEach((x) => starts.add(b * perBar + x));
    let hub;
    if (countHub) hub = { big: countHub, small: 'отсчёт', color: '--accent' };
    else if (playPos !== null) {
      const stepNow = Math.floor(playPos) % total();
      hub = { big: [...gs].filter((x) => x <= stepNow % perBar).length, small: cur.bars > 1 ? `такт ${Math.floor(stepNow / perBar) + 1}` : 'доля' };
    } else hub = { big: cur.sig, small: 'размер' };
    Wheel.draw(canvas, {
      total: total(),
      starts,
      rings: cur.tracks.map((t, i) => ({ p: t.p, inst: t.i, muted: muted.has(i) })),
      playPos,
      hub,
      maxSize: 320,
    });
    const cyc = playerEl.querySelector('#r-cycle');
    if (cyc) {
      cyc.textContent = `цикл: ${total()} клеток · ${cur.beats * cur.bars} долей${cur.groups ? ' · ' + cur.groups.join('+') : ''}`;
    }
  }

  function renderLegend() {
    const used = new Set();
    let perc = false;
    cur.tracks.forEach((t) => {
      const kind = (INSTRUMENTS[t.i] || {}).kind;
      for (const ch of t.p) {
        if (ch === '.') continue;
        if (kind === 'drum') used.add(ch.toUpperCase()); else perc = true;
        if (kind === 'drum' && ch !== ch.toUpperCase()) used.add('ghost');
      }
    });
    const items = Object.keys(STROKES).filter((k) => used.has(k)).map((k) =>
      `<span class="lg"><span class="cell st-${k}">${STROKES[k].label}</span>${STROKES[k].name}</span>`);
    if (used.has('ghost')) items.push('<span class="lg"><span class="cell st-O ghost">О</span>бледная — тихо</span>');
    if (perc) items.push('<span class="lg"><span class="cell st-perc">●</span>удар</span>');
    if (cur.hands && cur.hands.replace(/\./g, '')) items.push('<span class="lg"><b>R</b> правая, <b>L</b> левая, <b>B</b> обе</span>');
    playerEl.querySelector('#r-legend').innerHTML = items.join('');
  }

  // клики по сетке
  playerEl.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mute]');
    if (m) {
      const ti = +m.dataset.mute;
      muted.has(ti) ? muted.delete(ti) : muted.add(ti);
      buildGrid();
      return;
    }
    const d = e.target.closest('[data-del]');
    if (d) {
      cur.tracks.splice(+d.dataset.del, 1);
      muted = new Set();
      dirty = true;
      buildGrid();
      return;
    }
    const c = e.target.closest('.gc[data-t]');
    if (!c) return;
    const s = +c.dataset.s;
    if (c.dataset.t === 'h') { if (editing) editHand(s); return; }
    const t = cur.tracks[+c.dataset.t];
    if (editing) editCell(t, s);
    else if (!transport.playing) Sound.play(t.i, t.p[s]);
  });

  const setChar = (str, i, ch) => str.slice(0, i) + ch + str.slice(i + 1);

  function editCell(t, s) {
    const kind = (INSTRUMENTS[t.i] || {}).kind;
    const old = t.p[s];
    let ch;
    if (kind === 'drum') {
      ch = tool === '.' ? '.' : ghost ? tool.toLowerCase() : tool;
      if (old === ch) ch = '.';
    } else {
      const cycle = kind === 'bell' ? '.LU' : '.xX';
      ch = cycle[(cycle.indexOf(old) + 1) % cycle.length] || '.';
    }
    t.p = setChar(t.p, s, ch);
    if (ch !== '.') Sound.play(t.i, ch);
    dirty = true;
    buildGrid();
  }

  function editHand(s) {
    const cycle = '.RLB';
    const hands = (cur.hands || '').padEnd(total(), '.');
    const next = cycle[(cycle.indexOf(hands[s]) + 1) % cycle.length];
    cur.hands = setChar(hands, s, next);
    dirty = true;
    buildGrid();
  }

  // ───────── Редактор ─────────
  function renderEditPanel() {
    const box = playerEl.querySelector('#r-edit');
    const r = cur;
    box.innerHTML = `
      <div class="edit-tools">
        <span class="muted">Инструмент:</span>
        ${Object.keys(STROKES).map((k) => `<button class="tool cell st-${k} ${tool === k ? 'sel' : ''}" data-tool="${k}" title="${STROKES[k].name}">${STROKES[k].label}</button>`).join('')}
        <button class="tool eraser ${tool === '.' ? 'sel' : ''}" data-tool="." title="Ластик">⌫</button>
        <label class="toggle"><input type="checkbox" id="e-ghost" ${ghost ? 'checked' : ''}> тихо</label>
      </div>
      <p class="muted small">Выберите удар и нажимайте на клетки бонго. Клетки клаве/колокола/шейкера/баса переключаются по кругу. В строке «Руки» — R → L → B → пусто.</p>
      <div class="edit-form">
        <label>Название <input type="text" id="e-name" value="${UI.esc(r.name)}"></label>
        <label>Размер (подпись) <input type="text" id="e-sig" value="${UI.esc(r.sig)}" size="5"></label>
        <label>Долей в такте <input type="number" id="e-beats" min="1" max="16" value="${r.beats}"></label>
        <label>Клеток на долю
          <select id="e-spb">${[1, 2, 3, 4, 6].map((v) => `<option value="${v}" ${v === r.spb ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </label>
        <label>Тактов <input type="number" id="e-bars" min="1" max="4" value="${r.bars}"></label>
        <label>Группы <input type="text" id="e-groups" placeholder="напр. 2+2+3" value="${r.groups ? r.groups.join('+') : ''}" size="8"></label>
        <label>Добавить строку
          <select id="e-add"><option value="">—</option>${Object.entries(INSTRUMENTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select>
        </label>
      </div>
      <label class="full">Описание / заметки <textarea id="e-desc" rows="2">${UI.esc(r.desc || '')}</textarea></label>`;

    box.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
      tool = b.dataset.tool;
      box.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('sel', x === b));
    }));
    box.querySelector('#e-ghost').addEventListener('change', (e) => { ghost = e.target.checked; });
    box.querySelector('#e-name').addEventListener('input', (e) => { cur.name = e.target.value; dirty = true; });
    box.querySelector('#e-sig').addEventListener('input', (e) => { cur.sig = e.target.value; dirty = true; });
    box.querySelector('#e-desc').addEventListener('input', (e) => { cur.desc = e.target.value; dirty = true; });
    const restructure = () => {
      const nb = UI.clamp(+box.querySelector('#e-beats').value || 4, 1, 16);
      const ns = +box.querySelector('#e-spb').value;
      const nbar = UI.clamp(+box.querySelector('#e-bars').value || 1, 1, 4);
      applyStructure(nb, ns, nbar);
      applyGroups(box.querySelector('#e-groups').value);
      buildGrid();
    };
    ['#e-beats', '#e-spb', '#e-bars'].forEach((s) => box.querySelector(s).addEventListener('change', restructure));
    box.querySelector('#e-groups').addEventListener('change', (e) => { applyGroups(e.target.value); buildGrid(); });
    box.querySelector('#e-add').addEventListener('change', (e) => {
      if (!e.target.value) return;
      cur.tracks.push({ i: e.target.value, p: '.'.repeat(total()) });
      e.target.value = '';
      dirty = true;
      buildGrid();
    });
  }

  // Перестроить сетку под новый размер, сохранив удары там, где возможно
  function applyStructure(beats, spb, bars) {
    const old = { beats: cur.beats, spb: cur.spb, bars: cur.bars };
    if (old.beats === beats && old.spb === spb && old.bars === bars) return;
    const oldPer = old.beats * old.spb;
    const newPer = beats * spb;
    const remap = (str) => {
      const out = Array(newPer * bars).fill('.');
      for (let nb = 0; nb < bars; nb++) {
        const src = nb % old.bars;
        for (let s = 0; s < oldPer; s++) {
          const ch = str[src * oldPer + s];
          if (!ch || ch === '.') continue;
          const pos = (s / old.spb) * spb;
          if (!Number.isInteger(pos) || pos >= newPer) continue;
          out[nb * newPer + pos] = ch;
        }
      }
      return out.join('');
    };
    cur.tracks.forEach((t) => { t.p = remap(t.p); });
    cur.hands = remap((cur.hands || '').padEnd(oldPer * old.bars, '.'));
    Object.assign(cur, { beats, spb, bars });
    if (!cur.sig || /^\d+\/\d+$/.test(cur.sig)) cur.sig = `${beats}/${spb === 3 || spb === 6 ? 8 : 4}`;
    dirty = true;
  }

  function applyGroups(text) {
    const parts = (text || '').split(/[+\s,]+/).map(Number).filter((x) => x > 0);
    const sum = parts.reduce((a, b) => a + b, 0);
    if (parts.length && sum === cur.beats * cur.spb) cur.groups = parts;
    else {
      if (parts.length) UI.toast(`Сумма групп должна быть ${cur.beats * cur.spb}`);
      delete cur.groups;
    }
    dirty = true;
  }

  function save() {
    if (!cur.tracks.length) { UI.toast('Добавьте хотя бы одну строку'); return; }
    const r = clone(cur);
    if (!r.id.startsWith('c_') || r.id === 'c_new') {
      const orig = RHYTHMS.find((x) => x.id === r.id);
      if (orig && r.name === orig.name) r.name += ' (моя версия)';
      r.id = 'c_' + Date.now().toString(36);
    }
    r.cat = 'mine';
    r.origin = r.origin || 'Мой ритм';
    if (r.hands && !r.hands.replace(/\./g, '')) delete r.hands;
    Store.saveCustom(r);
    dirty = false;
    editing = false;
    UI.toast('Сохранено в «Мои ритмы»');
    if (location.hash === '#/rhythms/' + r.id) load(r.id);
    else location.hash = '#/rhythms/' + r.id;
  }

  function cancelEdit() {
    dirty = false;
    if (cur.id === 'c_new') { load('martillo'); location.hash = '#/rhythms/martillo'; return; }
    load(cur.id);
  }

  function deleteRhythm() {
    if (!confirm(`Удалить «${cur.name}»?`)) return;
    Store.deleteCustom(cur.id);
    dirty = false;
    location.hash = '#/rhythms/martillo';
  }

  function exportRhythm() {
    const r = clone(cur);
    const text = JSON.stringify(r);
    const done = () => UI.toast('Ритм скопирован как текст — отправьте его другу');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => prompt('Скопируйте текст ритма:', text));
    else prompt('Скопируйте текст ритма:', text);
  }

  function importRhythm() {
    const text = prompt('Вставьте текст ритма (из «Экспорт»):');
    if (!text) return;
    try {
      const r = JSON.parse(text);
      const ok = r && r.name && r.beats > 0 && r.spb > 0 && Array.isArray(r.tracks) &&
        r.tracks.every((t) => INSTRUMENTS[t.i] && typeof t.p === 'string');
      if (!ok) throw new Error('bad');
      r.bars = r.bars || 1;
      const n = r.beats * r.spb * r.bars;
      r.tracks.forEach((t) => { t.p = t.p.replace(/[^OSMTPHosmtphxXLUlu.]/g, '.').padEnd(n, '.').slice(0, n); });
      if (r.hands) r.hands = String(r.hands).replace(/[^RLB.]/g, '.').padEnd(n, '.').slice(0, n);
      r.id = 'c_' + Date.now().toString(36);
      r.cat = 'mine';
      Store.saveCustom(r);
      location.hash = '#/rhythms/' + r.id;
      UI.toast('Ритм импортирован');
    } catch (e) {
      UI.toast('Не получилось прочитать ритм');
    }
  }

  function selfPlay() {
    const drumIdx = cur.tracks.map((t, i) => ((INSTRUMENTS[t.i] || {}).kind === 'drum' ? i : -1)).filter((i) => i >= 0);
    const allMuted = drumIdx.every((i) => muted.has(i));
    drumIdx.forEach((i) => (allMuted ? muted.delete(i) : muted.add(i)));
    // если ничего не звучит — включим щелчок, чтобы было под что играть
    if (!allMuted && cur.tracks.every((_, i) => muted.has(i)) && !opts.click) {
      opts.click = true;
      playerEl.querySelector('#r-click').checked = true;
    }
    buildGrid();
    UI.toast(allMuted ? 'Партии бонго снова звучат' : 'Партии бонго заглушены — играйте сами!');
  }

  // ───────── Воспроизведение ─────────
  function clickSteps() { return UI.groupStarts(cur); }

  function play() {
    const r = cur;
    const perBar = r.beats * r.spb;
    const clicks = clickSteps();
    const badge = playerEl.querySelector('#r-countin-badge');
    loops = 0;
    transport.onStep = (step, time) => {
      if (step < 0) {
        const s = step + perBar;
        if (clicks.has(s)) Sound.click(time, s === 0 ? 2 : 1, 'wood');
        return;
      }
      r.tracks.forEach((t, ti) => {
        if (muted.has(ti)) return;
        const ch = t.p[step];
        if (ch && ch !== '.') Sound.play(t.i, ch, time);
      });
      if (opts.click) {
        const s = step % perBar;
        if (clicks.has(s)) Sound.click(time, s === 0 ? 2 : 1, 'beep', 0.6);
      }
    };
    countHub = null;
    wheelPos = null;
    transport.onDraw = (step, time, dur) => {
      wheelPos = { step, time, dur };
      if (lastCol >= 0 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove('now'));
      if (step < 0) {
        const s = step + perBar;
        if (clicks.has(s)) {
          const n = [...clicks].sort((a, b) => a - b).indexOf(s) + 1;
          badge.textContent = `Отсчёт: ${n}`;
          countHub = n;
        }
        lastCol = -1;
        return;
      }
      countHub = null;
      badge.textContent = '';
      const col = colCells[step];
      if (!col) return;
      col.forEach((c) => c.classList.add('now'));
      lastCol = step;
      // прокрутка длинной сетки за курсором
      const wrap = playerEl.querySelector('#r-gridwrap');
      const cell = col[0];
      if (wrap && wrap.scrollWidth > wrap.clientWidth) {
        const x = cell.offsetLeft;
        if (x < wrap.scrollLeft + 90 || x > wrap.scrollLeft + wrap.clientWidth - 40) wrap.scrollLeft = x - 100;
      }
    };
    transport.onLoop = () => {
      loops++;
      if (opts.speed && loops % opts.speedEvery === 0 && bpmCtl.value < opts.speedMax) {
        bpmCtl.set(Math.min(opts.speedMax, bpmCtl.value + opts.speedStep));
      }
    };
    transport.onFrame = (now) => {
      let pos = null;
      if (wheelPos && wheelPos.step >= 0) pos = wheelPos.step + Math.min(1, (now - wheelPos.time) / wheelPos.dur);
      drawWheel(pos);
    };
    transport.onStop = () => {
      if (lastCol >= 0 && colCells[lastCol]) colCells[lastCol].forEach((c) => c.classList.remove('now'));
      lastCol = -1;
      badge.textContent = '';
      countHub = null;
      setPlayBtn(false);
      drawWheel(null);
    };
    transport.start({ bpm: bpmCtl.value, spb: r.spb, total: total(), countIn: opts.countIn ? perBar : 0 });
    setPlayBtn(true);
  }

  function setPlayBtn(on) {
    const b = playerEl.querySelector('#r-play');
    if (!b) return;
    b.textContent = on ? '■ Стоп' : '▶ Играть';
    b.classList.toggle('on', on);
  }

  function toggle() { transport.playing ? transport.stop() : play(); }

  Store.onChange(() => { if (el.classList.contains('active')) renderList(); });
  window.addEventListener('resize', () => {
    if (!el.classList.contains('active') || transport.playing) return;
    const c = playerEl.querySelector('#r-wheel');
    if (c) c.width = 0;
    drawWheel(null);
  });

  return {
    show(params) {
      const id = params[0] || (cur ? cur.id : 'martillo');
      if (!cur || cur.id !== id || !UI.findRhythm(id)) {
        if (id === 'c_new' && cur && cur.id === 'c_new') return;
        load(id);
        if (params[0] && window.innerWidth < 900) playerEl.scrollIntoView({ block: 'start' });
      } else {
        renderList();
      }
      if (!transport.playing) {
        const c = playerEl.querySelector('#r-wheel');
        if (c) c.width = 0;
        drawWheel(null);
      }
    },
    toggle,
    hide() { transport.stop(); },
  };
})();
