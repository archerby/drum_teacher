/*
 * Локализация: русский (исходный), English, Polski, Беларуская, Українська.
 * Ключ перевода — сама русская строка. L('Играть') → 'Play'.
 * Подстановки: L('нота {n} из {total}', { n: 2, total: 26 }).
 * Числа: L.plural(n, 'урок|урока|уроков') → форма по правилам языка (перевод — «one|few|many|other»).
 * Данные (уроки, ритмы, мелодии) переводятся целиком при загрузке — I18N.localizeData().
 */
window.I18N = (() => {
  const LANGS = { ru: 'Русский', en: 'English', pl: 'Polski', be: 'Беларуская', uk: 'Українська' };
  const CYR = /[А-Яа-яЁёІіЎў]/;
  const dict = {};

  function detect() {
    const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
    for (const l of list) {
      const code = String(l).toLowerCase().split('-')[0];
      if (LANGS[code]) return code;
    }
    return 'en';
  }

  let lang = Store.get('lang', null);
  if (!LANGS[lang]) lang = detect();
  document.documentElement.lang = lang;
  // словарь языка подключается синхронно, до данных и страниц
  if (lang !== 'ru') document.write(`<script src="js/i18n/${lang}.js"><\/script>`);

  const fmt = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s);
  const tr = (s) => (typeof dict[s] === 'string' && dict[s] ? dict[s] : s);

  function L(s, vars) { return fmt(tr(s), vars); }
  L.plural = (n, forms, vars) => {
    const arr = tr(forms).split('|');
    if (arr.length === 3) arr.push(arr[1]); // русский источник: one|few|many, дробные — как few
    const idx = { one: 0, few: 1, many: 2, other: 3 }[new Intl.PluralRules(lang).select(n)];
    const s = arr[Math.min(idx, arr.length - 1)] || arr[arr.length - 1];
    return fmt(s, { n, ...vars });
  };

  // Данные переводятся «на месте»: все строки с кириллицей, для которых есть перевод
  const DATA = ['INSTRUMENTS', 'STROKES', 'PERC_STROKES', 'HANDS', 'RHYTHM_CATEGORIES', 'RHYTHMS', 'LESSONS', 'LEARNING_PATH', 'MALLET',
    'MELODIES', 'MALLET_LESSONS', 'FINGERINGS', 'FLUTE_LESSONS', 'CHORDS', 'PROGRESSIONS', 'KEYS_LESSONS'];
  function walk(obj) {
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      if (typeof v === 'string') { if (CYR.test(v)) obj[k] = tr(v); } else if (v && typeof v === 'object') walk(v);
    });
  }
  function localizeData() {
    if (lang === 'ru') return;
    DATA.forEach((g) => { if (window[g]) walk(window[g]); });
  }

  // Статичная разметка index.html: текстовые узлы и подписи
  function localizeDom(root) {
    if (lang === 'ru') return;
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) {
      const t = n.nodeValue.trim();
      if (t && CYR.test(t)) n.nodeValue = n.nodeValue.replace(t, tr(t));
    }
    root.querySelectorAll('[title], [aria-label]').forEach((e) => {
      ['title', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v && CYR.test(v)) e.setAttribute(a, tr(v)); });
    });
    document.title = tr(document.title);
    const d = document.querySelector('meta[name="description"]');
    if (d) d.content = tr(d.content);
  }

  function setLang(code) {
    if (!LANGS[code] || code === lang) return;
    Store.set('lang', code);
    location.reload();
  }

  // Переключатель языка в шапке
  function mountSwitcher() {
    const s = document.getElementById('lang-select');
    if (!s) return;
    s.innerHTML = Object.entries(LANGS).map(([c, n]) => `<option value="${c}" ${c === lang ? 'selected' : ''}>${n}</option>`).join('');
    s.addEventListener('change', () => setLang(s.value));
  }

  return {
    get lang() { return lang; },
    LANGS,
    add(code, d) { if (code === lang) Object.assign(dict, d); },
    has: (s) => typeof dict[s] === 'string' && !!dict[s],
    localizeData,
    localizeDom,
    mountSwitcher,
    setLang,
    L,
  };
})();
window.L = I18N.L;
