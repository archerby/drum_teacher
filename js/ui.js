/* Общие помощники интерфейса. */
window.UI = (() => {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const lcm = (a, b) => (a * b) / gcd(a, b);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Слоги счёта внутри доли
  const SYLL = { 2: ['и'], 3: ['ла', 'ли'], 4: ['е', 'и', 'а'] };
  function countLabel(stepInBar, spb, groups) {
    if (spb === 1) return String(stepInBar + 1);
    const sub = stepInBar % spb;
    if (sub === 0) return String(stepInBar / spb + 1);
    return (SYLL[spb] && SYLL[spb][sub - 1]) || '·';
  }

  // Индексы клеток такта, с которых начинаются группы (для визуального деления)
  function groupStarts(r) {
    const perBar = r.beats * r.spb;
    const starts = new Set();
    if (r.groups) {
      let acc = 0;
      r.groups.forEach((g) => { starts.add(acc); acc += g; });
    } else {
      for (let s = 0; s < perBar; s += r.spb) starts.add(s);
    }
    return starts;
  }

  function cellInfo(inst, ch) {
    if (!ch || ch === '.') return { label: '', cls: '' };
    const kind = INSTRUMENTS[inst] ? INSTRUMENTS[inst].kind : 'perc';
    if (kind === 'drum') {
      const up = ch.toUpperCase();
      const s = STROKES[up];
      return { label: s ? s.label : ch, cls: `st-${up}${ch !== up ? ' ghost' : ''}`, name: s ? s.name : '' };
    }
    if (kind === 'bell') {
      const up = ch.toUpperCase();
      const s = PERC_STROKES[up] || PERC_STROKES.L;
      return { label: s.label, cls: `st-bell${up === 'U' ? '-hi' : ''}${ch !== up ? ' ghost' : ''}`, name: s.name };
    }
    const accent = ch === 'X';
    return { label: accent ? '◆' : '●', cls: `st-perc${accent ? ' accent' : ''}`, name: accent ? 'Акцент' : 'Удар' };
  }

  function findRhythm(id) {
    return RHYTHMS.find((r) => r.id === id) || Store.customs().find((r) => r.id === id) || null;
  }

  function tempoName(bpm) {
    if (bpm < 40) return 'Grave — очень медленно';
    if (bpm < 60) return 'Largo — широко';
    if (bpm < 76) return 'Adagio — спокойно';
    if (bpm < 108) return 'Andante — шагом';
    if (bpm < 120) return 'Moderato — умеренно';
    if (bpm < 168) return 'Allegro — быстро';
    if (bpm < 200) return 'Presto — очень быстро';
    return 'Prestissimo — стремительно';
  }

  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // Тап-темп: возвращает функцию, которую надо вызывать на каждый тап
  function tapTempo(onBpm) {
    let taps = [];
    return () => {
      const t = performance.now();
      if (taps.length && t - taps[taps.length - 1] > 2000) taps = [];
      taps.push(t);
      if (taps.length > 6) taps.shift();
      if (taps.length >= 2) {
        const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
        onBpm(Math.round(60000 / iv));
      }
    };
  }

  // Поле BPM: ползунок + число + кнопки ±. Возвращает { el, set(v) }.
  function bpmControl({ value, min = 30, max = 240, onChange, label = 'Темп' }) {
    const wrap = document.createElement('div');
    wrap.className = 'bpm-control';
    wrap.innerHTML = `
      <span class="bpm-label">${esc(label)}</span>
      <button class="btn small" data-d="-5" aria-label="Медленнее на 5">−5</button>
      <button class="btn small" data-d="-1" aria-label="Медленнее на 1">−1</button>
      <input type="number" class="bpm-num" min="${min}" max="${max}" value="${value}" aria-label="BPM">
      <button class="btn small" data-d="1" aria-label="Быстрее на 1">+1</button>
      <button class="btn small" data-d="5" aria-label="Быстрее на 5">+5</button>
      <input type="range" class="bpm-range" min="${min}" max="${max}" value="${value}" aria-label="Темп, BPM">
      <span class="bpm-unit">BPM</span>`;
    const num = wrap.querySelector('.bpm-num');
    const range = wrap.querySelector('.bpm-range');
    let cur = value;
    function set(v, fire = true) {
      v = clamp(Math.round(Number(v) || cur), min, max);
      cur = v;
      num.value = v;
      range.value = v;
      if (fire && onChange) onChange(v);
    }
    wrap.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => set(cur + Number(b.dataset.d))));
    range.addEventListener('input', () => set(range.value));
    num.addEventListener('change', () => set(num.value));
    return { el: wrap, set, get value() { return cur; } };
  }

  // Ссылка-«посылка»: объект → base64url (UTF-8) и обратно
  function encodeShare(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeShare(str) {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  }
  function shareLink(route, obj, what) {
    const url = `${location.origin}${location.pathname}#/${route}/import/${encodeShare(obj)}`;
    const done = () => toast(`Ссылка на ${what} скопирована — отправьте её или откройте на телефоне`);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      navigator.share({ title: obj.name, url }).catch(() => {});
    } else if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(done, () => prompt('Скопируйте ссылку:', url));
    } else prompt('Скопируйте ссылку:', url);
    return url;
  }

  return { esc, gcd, lcm, encodeShare, decodeShare, shareLink, clamp, countLabel, groupStarts, cellInfo, findRhythm, tempoName, toast, tapTempo, bpmControl };
})();
