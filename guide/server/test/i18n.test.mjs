import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { POIS } from '../../public/data/pois.js';
import ru from '../../public/i18n/ru.js';

const keys = (o) => Object.keys(o || {}).sort();

test('в исходном словаре есть тексты для каждой точки', () => {
  for (const p of POIS) {
    const t = ru.poi[p.id];
    assert.ok(t, `нет текста для ${p.id}`);
    for (const f of ['name', 'hook', 'text', 'fact', 'look']) assert.ok(t[f]?.length > 3, `${p.id}.${f}`);
  }
  assert.deepEqual(keys(ru.poi), keys(Object.fromEntries(POIS.map((p) => [p.id, 1]))));
});

for (const code of ['en', 'pl', 'uk', 'be']) {
  const file = new URL(`../../public/i18n/${code}.js`, import.meta.url);
  test(`словарь ${code}: те же ключи, что в ru, плейсхолдеры на месте`, { skip: !existsSync(file) }, async () => {
    const d = (await import(file)).default;
    assert.equal(d.lang, code);
    for (const s of ['ui', 'moods', 'routeNames', 'areas', 'poi']) assert.deepEqual(keys(d[s]), keys(ru[s]), s);
    for (const id of Object.keys(ru.poi)) assert.deepEqual(keys(d.poi[id]), keys(ru.poi[id]), id);
    for (const [k, v] of Object.entries(ru.ui)) {
      for (const ph of v.match(/\{\w+\}/g) || []) assert.ok(d.ui[k].includes(ph), `${code}.ui.${k} без ${ph}`);
    }
  });
}
