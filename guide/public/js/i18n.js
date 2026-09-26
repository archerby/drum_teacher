/* Словари грузятся по требованию; русский — базовый, из него берутся недостающие строки. */
export const LANGS = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'pl', label: 'Polski' },
  { code: 'uk', label: 'Українська' },
  { code: 'be', label: 'Беларуская' },
];

let base = null;
let cur = null;
export let lang = 'ru';

export function detectLang(saved) {
  const codes = LANGS.map((l) => l.code);
  if (saved && codes.includes(saved)) return saved;
  for (const l of navigator.languages || [navigator.language || 'en']) {
    const c = String(l).slice(0, 2).toLowerCase();
    if (codes.includes(c)) return c;
  }
  return 'en';
}

export async function setLang(code) {
  base = base || (await import('../i18n/ru.js')).default;
  if (code === 'ru') cur = base;
  else {
    try { cur = (await import(`../i18n/${code}.js`)).default; } catch { cur = base; code = 'ru'; }
  }
  lang = code;
  document.documentElement.lang = code;
}

/** Строка интерфейса: t('legWalk', { min: 5 }) */
export function t(key, vars) {
  let s = cur?.ui?.[key] ?? base?.ui?.[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

/** Слово во множественном числе: формы через «|» — one|few|many (en: one|other). */
export function plural(key, n) {
  const forms = t(key).split('|');
  const cat = new Intl.PluralRules(lang).select(n);
  const idx = { one: 0, few: 1, many: 2 }[cat] ?? forms.length - 1;
  return forms[Math.min(idx, forms.length - 1)];
}

const pick = (section, id) => cur?.[section]?.[id] ?? base?.[section]?.[id] ?? id;
export const moodName = (id) => pick('moods', id);
export const areaName = (id) => pick('areas', id);
export const routeName = (id) => pick('routeNames', id);
export function poiText(id) {
  return { ...(base?.poi?.[id] || {}), ...(cur?.poi?.[id] || {}) };
}
