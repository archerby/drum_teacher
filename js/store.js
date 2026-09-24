/* Прогресс ученика и настройки — хранятся в браузере (localStorage). */
window.Store = (() => {
  const KEY = 'bongo_school_v1';
  const data = { lessons: {}, rhythms: {}, poly: {}, custom: [], settings: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(data, JSON.parse(raw));
  } catch (e) { /* приватный режим — работаем без сохранения */ }

  const listeners = [];
  function save(notify = true) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
    if (notify) listeners.forEach((fn) => fn());
  }

  return {
    onChange(fn) { listeners.push(fn); },
    lessonDone: (id) => !!data.lessons[id],
    setLesson(id, v) { data.lessons[id] = v; save(); },
    rhythmDone: (id) => !!(data.rhythms[id] && data.rhythms[id].done),
    rhythmBest: (id) => (data.rhythms[id] && data.rhythms[id].best) || 0,
    setRhythm(id, done, bpm) {
      const r = data.rhythms[id] || {};
      r.done = done;
      if (done && bpm) r.best = Math.max(r.best || 0, bpm);
      data.rhythms[id] = r;
      save();
    },
    polyDone: (k) => !!data.poly[k],
    setPoly(k, v) { data.poly[k] = v; save(); },
    customs: () => data.custom,
    saveCustom(r) {
      const i = data.custom.findIndex((c) => c.id === r.id);
      if (i >= 0) data.custom[i] = r; else data.custom.push(r);
      save();
    },
    deleteCustom(id) {
      data.custom = data.custom.filter((c) => c.id !== id);
      save();
    },
    get(k, def) { return k in data.settings ? data.settings[k] : def; },
    set(k, v) { data.settings[k] = v; save(false); },
  };
})();
