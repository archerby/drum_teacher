import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute, routeFromIds, walkMeters, POI_BY_ID } from '../../public/js/route.js';
import { POIS, STARTS } from '../../public/data/pois.js';
import { MOODS, parseMoodText } from '../../public/js/moods.js';

const S = Object.fromEntries(STARTS.map((s) => [s.id, s]));

test('данные: id уникальны, координаты в Варшаве, теги из словаря', () => {
  const ids = new Set();
  for (const p of POIS) {
    assert.ok(!ids.has(p.id), `дубликат ${p.id}`);
    ids.add(p.id);
    assert.ok(p.lat > 52.15 && p.lat < 52.32 && p.lng > 20.9 && p.lng < 21.12, `${p.id} вне Варшавы`);
    assert.ok(['L', 'R'].includes(p.bank));
    assert.ok([0, 1, 2, 3].includes(p.hidden));
  }
});

test('через Вислу идём по мосту, а не напрямую', () => {
  const direct = walkMeters(POI_BY_ID.rynek, { ...POI_BY_ID.niedzwiedzie, bank: 'L' });
  const viaBridge = walkMeters(POI_BY_ID.rynek, POI_BY_ID.niedzwiedzie);
  assert.ok(viaBridge > direct);
});

test('все комбинации параметров: маршрут не пустой, в бюджете, без длинных перегонов', () => {
  let n = 0;
  for (const start of STARTS) for (const m of MOODS) for (const minutes of [30, 60, 120, 240]) for (const sit of ['no', 'coffee', 'meal', 'bench']) for (const hidden of [0, 2]) {
    const r = buildRoute({ start, minutes, moods: [m.id], sit, hidden, seed: ++n });
    assert.ok(r.stops.length > 0, `пусто: ${start.id} ${m.id} ${minutes} ${sit}`);
    assert.ok(r.totalMinutes <= minutes + 0.01, `перебор: ${start.id} ${m.id} ${minutes} ${sit} → ${r.totalMinutes}`);
    r.stops.forEach((s, i) => assert.ok(s.leg.minutes <= (i === 0 ? 30.01 : 25.01), `перегон ${s.leg.minutes} мин`));
    assert.equal(new Set(r.stops.map((s) => s.id)).size, r.stops.length, 'точки не повторяются');
  }
});

test('привал появляется, когда просили посидеть', () => {
  const r = buildRoute({ start: S.old, minutes: 150, moods: ['wow'], sit: 'coffee', hidden: 1, seed: 7 });
  assert.ok(r.stops.some((s) => s.rest));
});

test('настроение влияет на выбор: «задумчиво» ведёт в еврейскую Варшаву и к памяти войны', () => {
  const r = buildRoute({ start: S.muranow, minutes: 120, moods: ['deep'], sit: 'no', hidden: 1, seed: 3 });
  const dark = r.stops.filter((s) => (s.poi.tags.dark || 0) + (s.poi.tags.history || 0) >= 3).length;
  assert.ok(dark / r.stops.length >= 0.7);
});

test('«только тайное» почти не даёт открыточных мест', () => {
  const r = buildRoute({ start: S.center, minutes: 180, moods: ['wow'], sit: 'no', hidden: 2, seed: 11 });
  assert.ok(r.stops.filter((s) => s.poi.hidden === 0).length <= 1);
});

test('маршрут по ссылке воспроизводится', () => {
  const r = buildRoute({ start: S.old, minutes: 120, moods: ['romance'], sit: 'coffee', hidden: 1, seed: 5 });
  const rest = Object.fromEntries(r.stops.filter((s) => s.rest).map((s) => [s.id, s.rest]));
  const again = routeFromIds(S.old, r.stops.map((s) => s.id), rest, ['romance']);
  assert.deepEqual(again.stops.map((s) => s.id), r.stops.map((s) => s.id));
  assert.ok(Math.abs(again.totalMinutes - r.totalMinutes) < 0.01);
});

test('офлайн-разбор текста настроения', () => {
  const a = parseMoodText('хочу странного, но я устал, 90 мин и кофе');
  assert.ok(a.weights.absurd > 0 && a.tired && a.sit === 'coffee' && a.minutes === 90);
  assert.equal(parseMoodText('будет дождь').hits, 0, '«будет» не должно значить «дети»');
  const b = parseMoodText('Chcę coś tajemniczego i zjeść obiad, 2h');
  assert.ok(b.hidden === 2 && b.sit === 'meal' && b.minutes === 120);
  assert.ok(parseMoodText('romantic sunset walk').weights.romantic >= 3);
});
