/*
 * Варшава без скуки — интерфейс. Два экрана: настройка прогулки (#/) и маршрут (#/r?…).
 * Маршрут целиком живёт в адресе, поэтому им можно поделиться или открыть с QR-кода киоска.
 */
import { POIS, STARTS } from '../data/pois.js';
import { MOODS, MOOD_BY_ID, parseMoodText, TAGS } from './moods.js';
import { buildRoute, routeFromIds, suggestReplacement, POI_BY_ID, REST_MIN, haversine } from './route.js';
import { LANGS, detectLang, setLang, t, plural, moodName, areaName, routeName, poiText, lang } from './i18n.js';
import { drawMap, markVisited, focusStop, resizeMap } from './map.js';

const $app = document.getElementById('app');
const params = new URLSearchParams(location.search);
const KIOSK = params.has('kiosk');
const CENTER = { lat: 52.2297, lng: 21.0122 };
const START_BY_ID = Object.fromEntries(STARTS.map((s) => [s.id, s]));

/* ── Хранилище: только удобства на этом устройстве ─────────────────────── */
const store = {
  get(k, d) { try { const v = localStorage.getItem('wg.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('wg.' + k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};
const session = {
  get(k) { try { return JSON.parse(sessionStorage.getItem('wg.' + k) || 'null'); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem('wg.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const S = {
  moods: KIOSK ? ['wow'] : store.get('moods', ['wow']),
  moodText: '',
  understood: '',
  extraWeights: null,
  tired: false,
  minutes: KIOSK ? 90 : store.get('minutes', 120),
  sit: KIOSK ? 'coffee' : store.get('sit', 'coffee'),
  hidden: KIOSK ? 1 : store.get('hidden', 1),
  startId: store.get('start', 'old'),
  gps: null,
  startNote: '',
  seed: 1,
  route: null,
  routeKey: '',
  open: new Set(),
  visited: new Set(),
  mapHidden: store.get('mapHidden', false),
  ai: false,
  factId: null,
  building: false,
  pushed: false,
};
if (!START_BY_ID[S.startId] && S.startId !== 'gps') S.startId = 'old';
if (S.startId === 'gps') S.startId = 'old'; // геолокацию спрашиваем заново каждый раз


/* ── Утилиты ───────────────────────────────────────────────────────────── */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDur(min) {
  const m = Math.max(1, Math.round(min / 5) * 5);
  if (m < 60) return `${m} ${t('minutes')}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ${t('hours')} ${r} ${t('minutes')}` : `${h} ${t('hours')}`;
}
const fmtLeg = (min) => `${Math.max(1, Math.round(min))} ${t('minutes')}`;
function fmtDist(m) {
  if (m < 950) return `${Math.round(m / 10) * 10} ${t('m')}`;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(m / 1000)} ${t('km')}`;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/* Берег Вислы для произвольной точки: сравниваем долготу с осью реки. */
const RIVER = [[52.19, 21.068], [52.215, 21.052], [52.2342, 21.0415], [52.2404, 21.0345],
  [52.2472, 21.0246], [52.2614, 21.0133], [52.285, 20.995]];
function bankOf(lat, lng) {
  let riverLng = RIVER[0][1];
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [la1, lo1] = RIVER[i];
    const [la2, lo2] = RIVER[i + 1];
    if (lat >= la1 && lat <= la2) { riverLng = lo1 + ((lat - la1) / (la2 - la1)) * (lo2 - lo1); break; }
    if (lat > la2) riverLng = lo2;
  }
  return lng > riverLng ? 'R' : 'L';
}

function parseFrom(v) {
  if (!v) return null;
  if (START_BY_ID[v]) return { ...START_BY_ID[v], key: v };
  const m = v.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = +m[1];
  const lng = +m[2];
  return { lat, lng, bank: bankOf(lat, lng), key: `${lat.toFixed(5)},${lng.toFixed(5)}` };
}

/* Киоск может стоять в конкретном месте: ?kiosk&from=52.2497,21.0122 или ?kiosk&from=old */
const KIOSK_FROM = KIOSK ? parseFrom(params.get('from')) : null;

function currentStart() {
  if (KIOSK_FROM) return KIOSK_FROM;
  if (S.startId === 'gps' && S.gps) return S.gps;
  const s = START_BY_ID[S.startId] || START_BY_ID.old;
  return { ...s, key: s.id };
}

/* ── Свободный текст настроения: Claude на сервере, словарь — офлайн ──── */
async function checkAi() {
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('api/health', { signal: ctl.signal });
    const j = await r.json();
    S.ai = Boolean(j.ai);
  } catch { S.ai = false; }
}

async function aiMood(text) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch('api/mood', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang }),
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

function closestMood(weights) {
  let best = null;
  for (const m of MOODS) {
    let dot = 0;
    for (const tg of TAGS) dot += (m.w[tg] || 0) * (weights[tg] || 0);
    if (!best || dot > best.dot) best = { m, dot };
  }
  return best && best.dot > 0 ? best.m : null;
}

function describeUnderstanding(p) {
  const parts = [];
  const m = closestMood(p.weights || {});
  if (m) parts.push(`${m.emoji} ${moodName(m.id)}`);
  if (p.minutes) parts.push(`⏱ ${fmtDur(p.minutes)}`);
  if (p.sit && p.sit !== 'no') parts.push({ coffee: '☕', meal: '🍲', bench: '🌳' }[p.sit] + ' ' + t('sit' + p.sit[0].toUpperCase() + p.sit.slice(1)));
  if (p.hidden === 2) parts.push('💎 ' + t('hidden2'));
  if (p.hidden === 0) parts.push('🏛 ' + t('hidden0'));
  return parts.join(' · ');
}

async function interpretText() {
  const text = S.moodText.trim();
  S.extraWeights = null;
  S.tired = false;
  S.understood = '';
  if (!text) return;
  let p = null;
  if (S.ai) p = await aiMood(text);
  if (!p || !p.weights) p = parseMoodText(text);
  if (!p.hits && !p.summary && !Object.keys(p.weights || {}).length) return;
  S.extraWeights = p.weights;
  S.tired = Boolean(p.tired);
  if (p.minutes) S.minutes = Math.min(300, Math.max(30, Math.round(p.minutes / 15) * 15));
  if (p.sit) S.sit = p.sit;
  if (p.hidden === 0 || p.hidden === 1 || p.hidden === 2) S.hidden = p.hidden;
  S.understood = p.summary || describeUnderstanding(p);
}

/* ── Маршрут в адресной строке ─────────────────────────────────────────── */
function routeHash(route, meta) {
  const q = new URLSearchParams();
  q.set('from', route.start.key || `${route.start.lat.toFixed(5)},${route.start.lng.toFixed(5)}`);
  q.set('t', meta.minutes);
  q.set('m', meta.moods.join('.'));
  q.set('ids', route.stops.map((s) => s.id).join('.'));
  const rest = route.stops.filter((s) => s.rest).map((s) => `${s.id}~${s.rest}`);
  if (rest.length) q.set('rest', rest.join('.'));
  if (meta.custom) q.set('x', '1');
  return '#/r?' + q.toString();
}

function routeFromHash() {
  const q = new URLSearchParams(location.hash.replace(/^#\/r\??/, ''));
  const start = parseFrom(q.get('from')) || { ...START_BY_ID.old, key: 'old' };
  const ids = (q.get('ids') || '').split('.').filter((id) => POI_BY_ID[id]);
  if (!ids.length) return null;
  const restMap = {};
  for (const r of (q.get('rest') || '').split('.')) {
    const [id, kind] = r.split('~');
    if (id && REST_MIN[kind]) restMap[id] = kind;
  }
  const moods = (q.get('m') || '').split('.').filter((m) => MOOD_BY_ID[m]);
  const route = routeFromIds(start, ids, restMap, moods);
  const custom = q.get('x') === '1';
  route.meta = { minutes: +q.get('t') || Math.round(route.totalMinutes), moods, custom };
  return route;
}

/* ── Экран 1: настройка ────────────────────────────────────────────────── */
function randomFactId(except) {
  const pool = POIS.filter((p) => p.id !== except);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

function renderHome() {
  document.title = `${t('title')} — ${t('tagline')}`;
  S.factId = S.factId || randomFactId();
  const f = poiText(S.factId);
  const moodsHtml = MOODS.map((m) => `
    <button class="mood" data-mood="${m.id}" aria-pressed="${S.moods.includes(m.id)}">
      <span class="e" aria-hidden="true">${m.emoji}</span>${esc(moodName(m.id))}
    </button>`).join('');
  const seg = (group, items, cur) => `<div class="seg" role="group" data-group="${group}">${items.map(([v, label]) =>
    `<button data-val="${v}" aria-pressed="${String(cur) === String(v)}">${label}</button>`).join('')}</div>`;
  const startChips = [
    ...(KIOSK || !navigator.geolocation ? [] : [['gps', '📍 ' + t('startHere')]]),
    ...STARTS.map((s) => [s.id, areaName(s.id)]),
  ].map(([id, label]) => `<button class="chip" data-start="${id}" aria-pressed="${S.startId === id}">${esc(label)}</button>`).join('');
  const langLabel = lang.toUpperCase();

  $app.innerHTML = `
  <div class="wrap">
    <header class="hero">
      <img src="icons/upupa_mascot_sm.png" alt="" width="58" height="58">
      <div class="grow"><h1>${esc(t('title'))}</h1><p>${esc(t('tagline'))}</p></div>
      <button class="lang-btn" data-act="lang" aria-label="${esc(t('langTitle'))}">🌐 ${langLabel}</button>
    </header>

    <div class="card fact-card">
      <div class="label">🤯 ${esc(t('factOfDay'))}</div>
      <p>${esc(f.fact)}</p>
      <div class="src">— ${esc(f.name)}</div>
      <button class="link-btn" data-act="fact">${esc(t('anotherFact'))} →</button>
    </div>

    <section class="section">
      <h2>${esc(t('moodTitle'))} <small>${esc(t('moodHint'))}</small></h2>
      <div class="moods">${moodsHtml}</div>
      <label class="free">
        <input id="moodText" type="text" maxlength="300" autocomplete="off" enterkeyhint="go"
          placeholder="${esc(t('moodFree'))}" value="${esc(S.moodText)}" aria-label="${esc(t('moodFreeExample'))}">
        <span class="spark" aria-hidden="true">${S.ai ? '✨ AI' : '✨'}</span>
      </label>
      <p class="understood" ${S.understood ? '' : 'hidden'}>${esc(t('moodUnderstood'))} <b>${esc(S.understood)}</b></p>
      ${S.moodText ? '' : `<p class="note">${esc(t('moodFreeExample'))}</p>`}
    </section>

    <section class="section">
      <div class="card">
        <div class="time-row"><h2 style="margin:0">${esc(t('timeTitle'))}</h2><span class="time-val" id="timeVal">${fmtDur(S.minutes)}</span></div>
        <input id="time" type="range" min="30" max="300" step="15" value="${S.minutes}" aria-label="${esc(t('timeTitle'))}">
        <div class="presets">${[60, 90, 120, 180, 240].map((m) =>
          `<button class="chip" data-minutes="${m}" aria-pressed="${S.minutes === m}">${fmtDur(m)}</button>`).join('')}</div>
      </div>
    </section>

    <section class="section">
      <h2>${esc(t('sitTitle'))}</h2>
      ${seg('sit', [['no', t('sitNo')], ['coffee', '☕ ' + t('sitCoffee')], ['meal', '🍲 ' + t('sitMeal')], ['bench', '🌳 ' + t('sitBench')]], S.sit)}
    </section>

    <section class="section">
      <h2>💎 ${esc(t('hiddenTitle'))}</h2>
      ${seg('hidden', [[0, t('hidden0')], [1, t('hidden1')], [2, t('hidden2')]], S.hidden)}
    </section>

    ${KIOSK_FROM ? '' : `
    <section class="section">
      <h2>${esc(t('startTitle'))}</h2>
      <div class="chips">${startChips}</div>
      <p class="note" id="startNote" ${S.startNote ? '' : 'hidden'}>${esc(S.startNote)}</p>
    </section>`}

    <p class="about">${esc(t('about'))}</p>
  </div>
  <div class="cta-bar"><button class="cta" data-act="build" ${S.building ? 'disabled' : ''}>✨ ${esc(S.building ? t('building') : t('build'))}</button></div>`;

  const input = document.getElementById('moodText');
  input.addEventListener('input', () => { S.moodText = input.value; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { input.blur(); build(); } });
  const range = document.getElementById('time');
  range.addEventListener('input', () => {
    S.minutes = +range.value;
    document.getElementById('timeVal').textContent = fmtDur(S.minutes);
    document.querySelectorAll('[data-minutes]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.minutes === S.minutes)));
    store.set('minutes', S.minutes);
  });
}

function saveSettings() {
  if (KIOSK) return;
  store.set('moods', S.moods);
  store.set('minutes', S.minutes);
  store.set('sit', S.sit);
  store.set('hidden', S.hidden);
  store.set('start', S.startId);
}

function locate() {
  S.startNote = t('startLocating');
  renderHome();
  navigator.geolocation.getCurrentPosition((pos) => {
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (haversine(p, CENTER) > 7000) {
      S.gps = null;
      S.startId = 'old';
      S.startNote = t('startFar');
    } else {
      S.gps = { ...p, bank: bankOf(p.lat, p.lng), key: `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` };
      S.startId = 'gps';
      S.startNote = '';
    }
    renderHome();
  }, () => {
    S.gps = null;
    S.startId = S.startId === 'gps' ? 'old' : S.startId;
    S.startNote = t('startDenied');
    renderHome();
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

async function build(reroll) {
  if (S.building) return;
  S.building = true;
  if (!reroll) {
    renderHome();
    await interpretText();
  }
  saveSettings();
  const avoid = reroll && S.route ? S.route.stops.map((s) => s.id) : [];
  S.seed = reroll ? S.seed + 1 : Math.floor(Math.random() * 1e9);
  const route = buildRoute({
    start: currentStart(),
    minutes: S.minutes,
    moods: S.moods,
    extraWeights: S.extraWeights,
    tired: S.tired,
    sit: S.sit,
    hidden: S.hidden,
    seed: S.seed,
    avoid,
  });
  S.building = false;
  if (!route.stops.length) {
    renderHome();
    toast(t('empty'));
    return;
  }
  route.meta = { minutes: S.minutes, moods: S.moods, custom: Boolean(S.extraWeights) };
  S.route = route;
  S.open = new Set([route.stops[0].id]);
  S.visited = new Set();
  const hash = routeHash(route, route.meta);
  if (location.hash.startsWith('#/r')) history.replaceState(null, '', hash);
  else { history.pushState(null, '', hash); S.pushed = true; }
  render();
  window.scrollTo(0, 0);
}

/* ── Экран 2: маршрут ──────────────────────────────────────────────────── */
const titleOf = (meta) => (!meta.custom && meta.moods?.length ? routeName(meta.moods[meta.moods.length - 1]) : routeName('mix'));

function gmapsLink(points) {
  const [o, ...rest] = points;
  const d = rest.pop();
  const q = new URLSearchParams({ api: '1', travelmode: 'walking', origin: `${o.lat},${o.lng}`, destination: `${d.lat},${d.lng}` });
  if (rest.length) q.set('waypoints', rest.map((p) => `${p.lat},${p.lng}`).join('|'));
  return 'https://www.google.com/maps/dir/?' + q.toString();
}

/* Мобильные Google Maps принимают до 3 промежуточных точек — режем маршрут на куски. */
function gmapsChunks(route) {
  const pts = [route.start, ...route.stops.map((s) => s.poi)];
  const chunks = [];
  for (let i = 0; i < pts.length - 1; i += 4) {
    const part = pts.slice(i, Math.min(i + 5, pts.length));
    chunks.push({ from: i, to: i + part.length - 1, href: gmapsLink(part) });
  }
  return chunks;
}

function stopHtml(s, i, route) {
  const p = poiText(s.id);
  const open = S.open.has(s.id);
  const done = S.visited.has(s.id);
  const badges = [];
  badges.push(`<span class="badge">📍 ${esc(areaName(s.poi.area))}</span>`);
  if (s.rest) badges.push(`<span class="badge rest">${{ coffee: '☕', meal: '🍲', bench: '🌳' }[s.rest]} ${esc(t('restHere'))}: ${esc(t('rest' + s.rest[0].toUpperCase() + s.rest.slice(1)))} · ${s.restMin} ${esc(t('minutes'))}</span>`);
  if (s.poi.hidden >= 2) badges.push(`<span class="badge gem">💎 ${esc(t('hiddenBadge'))}</span>`);
  if (s.poi.paid) badges.push(`<span class="badge">🎟 ${esc(t('paid'))}</span>`);
  const prev = i === 0 ? route.start : route.stops[i - 1].poi;
  const dir = gmapsLink([prev, s.poi]);
  return `
  <li class="stop ${s.rest ? 'rest-stop' : ''} ${done ? 'done' : ''}" id="stop-${s.id}" open-state="${open}">
    <button class="stop-head" data-toggle="${s.id}" aria-expanded="${open}">
      <span class="num">${done ? '✓' : i + 1}</span>
      <span style="flex:1;min-width:0">
        <span class="stop-title" style="display:block">${esc(p.name)}</span>
        <span class="stop-hook">${esc(p.hook)}</span>
        <span class="badges">${badges.join('')}</span>
      </span>
      <span class="chev" aria-hidden="true">▾</span>
    </button>
    ${open ? `
    <div class="stop-body">
      <p>${esc(p.text)}</p>
      <div class="box fact"><span class="h">🤯 ${esc(t('fact'))}</span>${esc(p.fact)}</div>
      <div class="box look"><span class="h">👀 ${esc(t('look'))}</span>${esc(p.look)}</div>
      <div class="stop-actions">
        <a class="btn small" href="${esc(dir)}" target="_blank" rel="noopener">🧭 ${esc(t('howToGet'))}</a>
        <button class="btn small ${done ? '' : 'primary'}" data-visit="${s.id}">✓ ${esc(t('visited'))}</button>
        <button class="btn small" data-replace="${i}">🔄 ${esc(t('replace'))}</button>
      </div>
    </div>` : ''}
  </li>`;
}

function renderRoute() {
  const route = S.route;
  const meta = route.meta || { minutes: Math.round(route.totalMinutes), moods: [] };
  const title = titleOf(meta);
  document.title = `${title} — ${t('title')}`;
  const doneCount = route.stops.filter((s) => S.visited.has(s.id)).length;
  const restCount = route.stops.filter((s) => s.rest).length;
  const notices = [];
  if (route.restFallback) notices.push(`☕ ${t('restHere')}: ${t('rest' + route.restFallback[0].toUpperCase() + route.restFallback.slice(1))}`);
  if (!navigator.onLine) notices.push('📡 ' + t('offline'));

  const items = route.stops.map((s, i) => `
    <li class="leg" aria-hidden="true">🚶 ${esc(t('legWalk', { min: Math.max(1, Math.round(s.leg.minutes)), dist: fmtDist(s.leg.meters) }))}</li>
    ${stopHtml(s, i, route)}`).join('');

  const chunks = gmapsChunks(route);
  const gm = chunks.length === 1
    ? `<a class="btn small" href="${esc(chunks[0].href)}" target="_blank" rel="noopener">🗺 ${esc(t('openMaps'))}</a>`
    : `<span>🗺 Google Maps:</span>${chunks.map((c) => `<a class="btn small" href="${esc(c.href)}" target="_blank" rel="noopener">${c.from === 0 ? '★' : c.from}–${c.to}</a>`).join('')}`;

  $app.innerHTML = `
  <header class="topbar">
    <button class="icon-btn" data-act="home" aria-label="${esc(t('back'))}">←</button>
    <h1>${esc(title)} · ${fmtDur(meta.minutes)}</h1>
    ${KIOSK ? '' : `<button class="icon-btn" data-act="share" aria-label="${esc(t('share'))}">⤴</button>`}
  </header>
  <div class="wrap">
    <div class="progress" aria-hidden="true"><i style="width:${route.stops.length ? (doneCount / route.stops.length) * 100 : 0}%"></i></div>
    <div class="summary">
      <span>⏱ <b>${fmtDur(route.totalMinutes)}</b> ${esc(t('total'))}</span>
      <span>🚶 <b>${fmtDist(route.meters)}</b></span>
      <span>📍 <b>${route.stops.length}</b> ${esc(plural('stops', route.stops.length))}</span>
      ${restCount ? `<span>☕ <b>${restCount}</b></span>` : ''}
    </div>
    ${notices.map((n) => `<div class="notice">${esc(n)}</div>`).join('')}
    <div id="map" class="${S.mapHidden ? 'collapsed' : ''}" role="img" aria-label="${esc(t('mapShow'))}"></div>
    <div class="actions">
      <button class="btn small" data-act="toggleMap">🗺 ${esc(S.mapHidden ? t('mapShow') : t('mapHide'))}</button>
      <button class="btn small" data-act="reroll">🎲 ${esc(t('reroll'))}</button>
    </div>
    <div class="gm-links">${gm}</div>
    ${KIOSK ? `<div class="card qr-card"><div id="qr"></div><div><b>📱 ${esc(t('kioskQr'))}</b></div></div>` : ''}
    <ol class="stops">
      <li class="leg" style="border:0;margin-left:14px;padding-left:0">★ ${esc(t('you'))}: ${esc(route.start.key && START_BY_ID[route.start.key] ? areaName(route.start.key) : '📍 ' + t('startHere'))}</li>
      ${items}
    </ol>
    <div class="card finish">
      <img src="icons/upupa_mascot_md.png" alt="" width="72">
      <h2>${esc(t('finishTitle'))}</h2>
      <p>${esc(t('finishText'))}</p>
      <div class="actions" style="justify-content:center">
        <button class="btn primary" data-act="home">✨ ${esc(t('again'))}</button>
        ${KIOSK ? `<button class="btn" data-act="reset">${esc(t('kioskReset'))}</button>` : `<button class="btn" data-act="share">⤴ ${esc(t('share'))}</button>`}
      </div>
    </div>
    <p class="about">${esc(t('about'))}</p>
  </div>`;

  if (!S.mapHidden) drawMapNow();
  if (KIOSK) drawQr();
}

function drawMapNow() {
  const el = document.getElementById('map');
  if (!el || !S.route) return;
  drawMap(el, S.route, S.visited, (i) => openStop(S.route.stops[i].id, true), t('you')).catch(() => {
    el.classList.add('collapsed');
  });
}

async function drawQr() {
  const el = document.getElementById('qr');
  if (!el) return;
  if (!window.qrcode) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/qrcode.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    }).catch(() => null);
  }
  if (!window.qrcode) return;
  const url = location.href.replace(/[?&]kiosk[^#]*/, '').replace(/\?(?=#)/, '');
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  el.innerHTML = qr.createImgTag(5, 8);
  const img = el.querySelector('img');
  if (img) img.alt = t('kioskQr');
}

function openStop(id, scroll) {
  S.open.add(id);
  renderStopInPlace(id);
  const el = document.getElementById('stop-' + id);
  if (scroll && el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderStopInPlace(id) {
  const i = S.route.stops.findIndex((s) => s.id === id);
  const el = document.getElementById('stop-' + id);
  if (i < 0 || !el) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = stopHtml(S.route.stops[i], i, S.route).trim();
  el.replaceWith(tmp.firstElementChild);
}

function updateProgress() {
  const bar = document.querySelector('.progress i');
  if (bar) bar.style.width = `${(S.route.stops.filter((s) => S.visited.has(s.id)).length / S.route.stops.length) * 100}%`;
}

function toggleVisited(id) {
  const done = !S.visited.has(id);
  if (done) S.visited.add(id); else S.visited.delete(id);
  session.set('visited.' + S.routeKey, [...S.visited]);
  markVisited(id, done);
  if (done) {
    S.open.delete(id);
    const next = S.route.stops.find((s) => !S.visited.has(s.id));
    renderStopInPlace(id);
    if (next) {
      openStop(next.id, true);
      focusStop(next.poi.lat, next.poi.lng);
    } else {
      document.querySelector('.finish')?.scrollIntoView({ behavior: 'smooth' });
    }
  } else {
    renderStopInPlace(id);
  }
  updateProgress();
}

function replaceStop(index) {
  const route = S.route;
  const meta = route.meta || {};
  const alt = suggestReplacement(route, index, {
    moods: meta.moods || S.moods, extraWeights: S.extraWeights, hidden: S.hidden, seed: S.seed + Date.now() % 1000,
  });
  if (!alt) { toast('🤷'); return; }
  const ids = route.stops.map((s, i) => (i === index ? alt.id : s.id));
  const restMap = {};
  route.stops.forEach((s, i) => { if (s.rest) restMap[i === index ? alt.id : s.id] = s.rest; });
  const next = routeFromIds(route.start, ids, restMap, meta.moods || []);
  next.meta = meta;
  S.route = next;
  S.open.add(alt.id);
  history.replaceState(null, '', routeHash(next, meta));
  S.routeKey = ids.join('.');
  const y = window.scrollY;
  renderRoute();
  window.scrollTo(0, y);
}

async function share() {
  const url = location.href.replace(/[?&]kiosk[^#]*/, '');
  const title = S.route?.meta ? titleOf(S.route.meta) : t('title');
  try {
    if (navigator.share) { await navigator.share({ title, text: t('tagline'), url }); return; }
  } catch { return; }
  try { await navigator.clipboard.writeText(url); toast(t('copied')); } catch { prompt(t('share'), url); }
}

function langSheet() {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(t('langTitle'))}"><h3>🌐 ${esc(t('langTitle'))}</h3>
    <div class="chips">${LANGS.map((l) => `<button class="chip" data-lang="${l.code}" aria-pressed="${l.code === lang}">${l.label}</button>`).join('')}</div></div>`;
  bg.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lang]');
    if (b) {
      await setLang(b.dataset.lang);
      store.set('lang', b.dataset.lang);
      S.understood = '';
      render();
    }
    if (b || e.target === bg) bg.remove();
  });
  document.body.appendChild(bg);
}

/* ── События ───────────────────────────────────────────────────────────── */
$app.addEventListener('click', (e) => {
  const el = e.target.closest('button, a');
  if (!el) return;
  const d = el.dataset;
  if (d.mood) {
    const id = d.mood;
    if (S.moods.includes(id)) S.moods = S.moods.filter((m) => m !== id);
    else S.moods = [...S.moods, id].slice(-2);
    document.querySelectorAll('[data-mood]').forEach((b) => b.setAttribute('aria-pressed', String(S.moods.includes(b.dataset.mood))));
    return;
  }
  if (d.minutes) {
    S.minutes = +d.minutes;
    renderHome();
    return;
  }
  if (d.start) {
    if (d.start === 'gps') { locate(); return; }
    S.startId = d.start;
    S.startNote = '';
    renderHome();
    return;
  }
  const group = el.parentElement?.dataset.group;
  if (group && d.val !== undefined) {
    if (group === 'sit') S.sit = d.val;
    if (group === 'hidden') S.hidden = +d.val;
    el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    return;
  }
  if (d.toggle) {
    if (S.open.has(d.toggle)) S.open.delete(d.toggle); else S.open.add(d.toggle);
    renderStopInPlace(d.toggle);
    if (S.open.has(d.toggle)) {
      const s = S.route.stops.find((x) => x.id === d.toggle);
      if (s) focusStop(s.poi.lat, s.poi.lng);
    }
    return;
  }
  if (d.visit) { toggleVisited(d.visit); return; }
  if (d.replace !== undefined) { replaceStop(+d.replace); return; }
  switch (d.act) {
    case 'build': build(false); break;
    case 'reroll': build(true); break;
    case 'fact': S.factId = randomFactId(S.factId); renderHome(); break;
    case 'lang': langSheet(); break;
    case 'share': share(); break;
    case 'home':
      // Пришли с экрана настройки — просто назад; открыли по ссылке — на главную.
      if (S.pushed) { S.pushed = false; history.back(); } else location.hash = '#/';
      break;
    case 'reset': resetKiosk(); break;
    case 'toggleMap':
      S.mapHidden = !S.mapHidden;
      store.set('mapHidden', S.mapHidden);
      document.getElementById('map').classList.toggle('collapsed', S.mapHidden);
      el.textContent = '🗺 ' + (S.mapHidden ? t('mapShow') : t('mapHide'));
      if (!S.mapHidden) { drawMapNow(); resizeMap(); }
      break;
    default:
  }
});

function render() {
  if (location.hash.startsWith('#/r')) {
    const fromHash = routeFromHash();
    if (!fromHash) { location.hash = '#/'; return; }
    const key = fromHash.stops.map((s) => s.id).join('.');
    if (!S.route || S.routeKey !== key) {
      S.route = fromHash;
      S.routeKey = key;
      S.visited = new Set(session.get('visited.' + key) || []);
      const firstOpen = fromHash.stops.find((s) => !S.visited.has(s.id));
      S.open = new Set(firstOpen ? [firstOpen.id] : []);
    } else {
      S.route.meta = fromHash.meta;
    }
    renderRoute();
  } else {
    renderHome();
  }
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
window.addEventListener('popstate', () => render());
window.addEventListener('online', () => S.route && location.hash.startsWith('#/r') && renderRoute());

/* ── Киоск: заставка с фактами и сброс по бездействию ─────────────────── */
let idleTimer = null;
let attractTimer = null;
function resetKiosk() {
  S.moods = ['wow'];
  S.moodText = '';
  S.understood = '';
  S.extraWeights = null;
  S.minutes = 90;
  S.sit = 'coffee';
  S.hidden = 1;
  S.route = null;
  history.replaceState(null, '', location.pathname + location.search + '#/');
  render();
  showAttract();
}
function showAttract() {
  if (document.querySelector('.attract')) return;
  const el = document.createElement('div');
  el.className = 'attract';
  el.innerHTML = `<img src="icons/upupa_mascot_md.png" alt=""><h1>${esc(t('title'))}</h1><div class="afact"></div><div class="touch">👆 ${esc(t('kioskTouch'))}</div>`;
  const factEl = el.querySelector('.afact');
  let id = randomFactId();
  const show = () => {
    const p = poiText(id);
    factEl.style.opacity = 0;
    setTimeout(() => {
      factEl.innerHTML = `🤯 ${esc(p.fact)}<small>— ${esc(p.name)}</small>`;
      factEl.style.opacity = 1;
    }, 400);
    id = randomFactId(id);
  };
  show();
  attractTimer = setInterval(show, 9000);
  el.addEventListener('click', () => { clearInterval(attractTimer); el.remove(); bumpIdle(); });
  document.body.appendChild(el);
}
function bumpIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(resetKiosk, 120000);
}

/* ── Старт ─────────────────────────────────────────────────────────────── */
(async function init() {
  if (KIOSK) {
    document.body.classList.add('kiosk');
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, bumpIdle, { passive: true }));
  }
  await setLang(KIOSK && params.get('lang') ? params.get('lang') : detectLang(store.get('lang', null)));
  render();
  checkAi().then(() => { if (!location.hash.startsWith('#/r') && S.ai) renderHome(); });
  if (KIOSK && !location.hash.startsWith('#/r')) showAttract();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
