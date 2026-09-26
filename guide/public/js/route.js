/*
 * Генератор маршрута — задача «ориентирования» (orienteering problem):
 * набрать точек с максимальной ценностью для настроения, уложившись в бюджет
 * времени = ходьба + осмотр + привалы. Жадная вставка по «ценности на минуту»,
 * затем 2-opt для порядка и добор, если время осталось.
 */
import { POIS, BRIDGES } from '../data/pois.js';
import { combineWeights, paceFor, TAGS } from './moods.js';

export const POI_BY_ID = Object.fromEntries(POIS.map((p) => [p.id, p]));

const METERS_PER_MIN = 75; // ~4.5 км/ч
const DETOUR = 1.3; // улицы не идут по прямой
export const REST_MIN = { coffee: 25, meal: 45, bench: 15 };

export function haversine(a, b) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Пешеходное расстояние: через Вислу — только по мосту. */
export function walkMeters(a, b) {
  if ((a.bank || 'L') === (b.bank || 'L')) return haversine(a, b) * DETOUR;
  let best = Infinity;
  for (const br of BRIDGES) best = Math.min(best, haversine(a, br) + haversine(br, b));
  return best * DETOUR;
}

/** Детерминированный ГПСЧ, чтобы маршрут по ссылке воспроизводился. */
export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function scorePoi(p, weights, hiddenPref, rand) {
  let match = 0;
  let norm = 0;
  for (const t of TAGS) {
    match += (weights[t] || 0) * (p.tags[t] || 0);
    norm += weights[t] || 0;
  }
  match = norm ? match / norm : 1; // 0..3 — насколько точка «про это настроение»
  let s = match * 2.5;
  const h = p.hidden;
  if (hiddenPref === 0) s += [1.6, 0.9, 0, -0.6][h];
  else if (hiddenPref === 1) s += [0.4, 0.3, 0.6, 0.8][h];
  else s += [-2.2, -0.4, 1.4, 2.4][h];
  s += rand() * 1.6; // разнообразие между вариантами
  if (match < 0.5) s *= 0.35; // совсем не про это настроение
  return Math.max(0.1, s);
}

/* Кэш расстояний: оптимизации пересчитывают одни и те же пары тысячи раз. */
const distCache = new Map();
function cachedMeters(a, b) {
  const key = a.lat + ',' + a.lng + '|' + b.lat + ',' + b.lng;
  let d = distCache.get(key);
  if (d === undefined) {
    if (distCache.size > 20000) distCache.clear();
    d = walkMeters(a, b);
    distCache.set(key, d);
  }
  return d;
}

const walkMin = (a, b, pace) => cachedMeters(a, b) / (METERS_PER_MIN * pace);

function routeCost(start, stops, pace) {
  let walk = 0;
  let prev = start;
  for (const s of stops) {
    walk += walkMin(prev, s.poi, pace);
    prev = s.poi;
  }
  const stay = stops.reduce((acc, s) => acc + s.poi.dwell + (s.rest ? s.restMin : 0), 0);
  return { walk, stay, total: walk + stay };
}

/* Длинные перегоны скучны: всё, что дольше 15 минут, штрафуем сверх линейного,
   а дольше 25 минут (30 — от старта) не допускаем вовсе. */
const legPenalty = (m) => Math.max(0, m - 15) * 0.9;
const MAX_LEG = 25;
const tooLong = (m, fromStart) => m > (fromStart ? MAX_LEG + 5 : MAX_LEG);

/* «Цена» порядка точек для оптимизаций: ходьба + штрафы за длинные перегоны. */
function pathCost(start, stops, pace) {
  let cost = 0;
  let prev = start;
  stops.forEach((s, i) => {
    const m = walkMin(prev, s.poi, pace);
    cost += m + legPenalty(m) + (tooLong(m, i === 0) ? 1000 : 0);
    prev = s.poi;
  });
  return cost;
}

/* Самое дешёвое место вставки точки q в открытый путь start→stops. */
function bestInsertion(start, stops, q, pace) {
  const pts = [start, ...stops.map((s) => s.poi)];
  const tail = walkMin(pts[pts.length - 1], q, pace);
  let best = tooLong(tail, !stops.length)
    ? { delta: Infinity, cost: Infinity, at: stops.length }
    : { delta: tail, cost: tail + legPenalty(tail), at: stops.length };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = walkMin(pts[i], q, pace);
    const b = walkMin(q, pts[i + 1], pace);
    if (tooLong(a, i === 0) || tooLong(b, false)) continue;
    const ab = walkMin(pts[i], pts[i + 1], pace);
    const d = a + b - ab;
    const cost = d + legPenalty(a) + legPenalty(b) - legPenalty(ab);
    if (cost < best.cost) best = { delta: d, cost, at: i };
  }
  return best;
}

/* 2-opt для открытого пути с фиксированным стартом. */
function twoOpt(start, stops, pace) {
  let route = stops.slice();
  let cur = pathCost(start, route, pace);
  for (let guard = 0, improved = true; improved && guard < 50; guard++) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      for (let k = i + 1; k < route.length; k++) {
        const cand = route.slice(0, i).concat(route.slice(i, k + 1).reverse(), route.slice(k + 1));
        const c = pathCost(start, cand, pace);
        if (c + 0.01 < cur) { route = cand; cur = c; improved = true; }
      }
    }
  }
  return route;
}

/* Or-opt: переносим по одной точке на лучшее место (убирает лишние переходы через Вислу). */
function orOpt(start, stops, pace) {
  let route = stops.slice();
  let cur = pathCost(start, route, pace);
  for (let pass = 0; pass < 5; pass++) {
    let improved = false;
    for (let i = 0; i < route.length; i++) {
      const node = route[i];
      const rest = route.slice(0, i).concat(route.slice(i + 1));
      for (let j = 0; j <= rest.length; j++) {
        if (j === i) continue;
        const cand = rest.slice(0, j).concat([node], rest.slice(j));
        const c = pathCost(start, cand, pace);
        if (c + 0.01 < cur) { route = cand; cur = c; improved = true; }
      }
    }
    if (!improved) break;
  }
  return route;
}

const optimize = (start, stops, pace) => orOpt(start, twoOpt(start, stops, pace), pace);

/* Если где-то остался слишком длинный перегон — выкидываем точку, к которой он ведёт. */
function dropLongLegs(start, stops, pace) {
  const out = [];
  let prev = start;
  for (const s of stops) {
    if (tooLong(walkMin(prev, s.poi, pace), !out.length)) continue;
    out.push(s);
    prev = s.poi;
  }
  return out;
}

/* Вылезли из бюджета — выкидываем наименее ценные смотровые точки,
   а если остались одни привалы — сокращаем их. */
function trimToBudget(start, stops, budget, pace) {
  stops = stops.slice();
  const over = () => routeCost(start, stops, pace).total - budget;
  while (stops.length && over() > 0.01) {
    let worst = null;
    const base = routeCost(start, stops, pace).total + pathCost(start, stops, pace);
    stops.forEach((s, i) => {
      if (s.rest) return;
      const without = stops.slice(0, i).concat(stops.slice(i + 1));
      const saved = base - routeCost(start, without, pace).total - pathCost(start, without, pace);
      const ratio = s.score / Math.max(saved, 1);
      if (!worst || ratio < worst.ratio) worst = { i, ratio };
    });
    if (worst) {
      stops.splice(worst.i, 1);
      continue;
    }
    const rest = stops.find((s) => s.rest && s.restMin > 10);
    if (!rest) { stops.pop(); continue; }
    rest.restMin = Math.max(10, Math.floor(rest.restMin - over()));
  }
  return stops;
}

/* Чем заменить привал, если подходящего места рядом нет. */
const REST_FALLBACK = { meal: ['meal', 'coffee', 'bench'], coffee: ['coffee', 'bench'], bench: ['bench', 'coffee'] };

/**
 * opts: { start:{lat,lng,bank}, minutes, moods:[ids], extraWeights, tired, sit:'no'|'coffee'|'meal'|'bench',
 *         hidden:0|1|2, seed, exclude:[ids], avoid:[ids] }
 */
export function buildRoute(opts) {
  const pace = paceFor(opts.moods || []) * (opts.tired ? 0.85 : 1);
  const weights = combineWeights(opts.moods || [], opts.extraWeights);
  const rand = rng(opts.seed || 1);
  const budget = opts.minutes;
  const sit = opts.sit && opts.sit !== 'no' ? opts.sit : null;
  const restCount = sit ? (budget >= 200 ? 2 : budget >= 50 ? 1 : 0) : 0;
  const restBudget = restCount * (sit ? REST_MIN[sit] + 8 : 0); // +8 мин на подход к месту
  const exclude = new Set(opts.exclude || []);
  const avoid = new Set(opts.avoid || []); // точки прошлого варианта — чуть менее желанны
  const start = opts.start;

  // «Только тайное» — открыточные места не берём вовсе (кроме мест для привала).
  const scored = POIS.filter((p) => !exclude.has(p.id) && !(opts.hidden === 2 && p.hidden === 0)).map((p) => ({
    poi: p,
    score: scorePoi(p, weights, opts.hidden ?? 1, rand) * (avoid.has(p.id) ? 0.6 : 1),
  }));
  const scoreOf = Object.fromEntries(scored.map((c) => [c.poi.id, c.score]));

  // 1. Жадный набор смотровых точек в бюджет, оставив время на привалы.
  let stops = [];
  const used = new Set();
  const fill = (limit) => {
    for (;;) {
      const cur = routeCost(start, stops, pace).total;
      let pick = null;
      for (const c of scored) {
        if (used.has(c.poi.id)) continue;
        const ins = bestInsertion(start, stops, c.poi, pace);
        if (ins.delta === Infinity) continue;
        if (cur + ins.delta + c.poi.dwell > limit) continue;
        const value = (c.score * c.score) / (ins.cost + c.poi.dwell + 3);
        if (!pick || value > pick.value) pick = { c, ins, value };
      }
      if (!pick) break;
      stops.splice(pick.ins.at, 0, { poi: pick.c.poi, score: pick.c.score });
      used.add(pick.c.poi.id);
    }
  };
  fill(budget - restBudget);
  stops = optimize(start, stops, pace);
  fill(budget - restBudget);
  stops = optimize(start, stops, pace);

  // 2. Привалы: точка из маршрута, где можно присесть, или новое место ближе к
  //    середине пути. Нет подходящего — пробуем привал попроще (обед → кофе → лавочка).
  let restKind = null;
  for (let r = 0; r < restCount; r++) {
    const target = (stops.length * (r + 1)) / (restCount + 1);
    let placed = false;
    for (const kind of REST_FALLBACK[sit]) {
      const inRoute = stops
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => !s.rest && s.poi.rest?.includes(kind))
        .sort((a, b) => Math.abs(a.i + 0.5 - target) - Math.abs(b.i + 0.5 - target))[0];
      if (inRoute && Math.abs(inRoute.i + 0.5 - target) <= Math.max(1.5, stops.length / 3)) {
        Object.assign(inRoute.s, { rest: kind, restMin: REST_MIN[kind] });
        placed = true;
      } else {
        let best = null;
        const pts = [start, ...stops.map((s) => s.poi)];
        const now = routeCost(start, stops, pace).total;
        for (const p of POIS) {
          if (used.has(p.id) || exclude.has(p.id) || !p.rest?.includes(kind)) continue;
          for (let i = 0; i <= stops.length; i++) {
            const ap = walkMin(pts[i], p, pace);
            const pb = pts[i + 1] ? walkMin(p, pts[i + 1], pace) : 0;
            if (tooLong(ap, i === 0) || tooLong(pb, false)) continue;
            const delta = pts[i + 1] ? ap + pb - walkMin(pts[i], pts[i + 1], pace) : ap;
            const overflow = Math.max(0, now + delta + p.dwell + REST_MIN[kind] - budget);
            const cost = delta + legPenalty(ap) + legPenalty(pb) + overflow * 3 +
              Math.abs(i - target) * 4 - (scoreOf[p.id] || 0) * 2;
            if (!best || cost < best.cost) best = { p, at: i, cost };
          }
        }
        if (best) {
          stops.splice(best.at, 0, { poi: best.p, score: scoreOf[best.p.id] || 1, rest: kind, restMin: REST_MIN[kind] });
          used.add(best.p.id);
          placed = true;
        } else if (inRoute) {
          Object.assign(inRoute.s, { rest: kind, restMin: REST_MIN[kind] });
          placed = true;
        }
      }
      if (placed) { restKind = restKind || kind; break; }
    }
  }

  // 3. Укладываемся в бюджет и чиним порядок.
  stops = trimToBudget(start, stops, budget, pace);
  stops = dropLongLegs(start, optimize(start, stops, pace), pace);
  stops = trimToBudget(start, stops, budget, pace);

  if (!stops.length && sit) {
    // Привал не помещается вместе с прогулкой — гуляем без него.
    return { ...buildRoute({ ...opts, sit: 'no' }), restMissing: true, restFallback: null };
  }
  const route = describe(start, stops, pace);
  route.restFallback = sit && restKind && restKind !== sit ? restKind : null;
  route.restMissing = Boolean(sit && restCount && !restKind);
  return route;
}

/** Маршрут по готовому списку id (для ссылок «поделиться»). */
export function routeFromIds(start, ids, restMap, moods) {
  const pace = paceFor(moods || []);
  const stops = ids.map((id) => POI_BY_ID[id]).filter(Boolean)
    .map((poi) => {
      const r = restMap[poi.id];
      return { poi, score: 1, rest: r || null, restMin: r ? REST_MIN[r] : 0 };
    });
  return describe(start, stops, pace);
}

function describe(start, stops, pace) {
  let prev = start;
  let meters = 0;
  const legs = stops.map((s) => {
    const m = walkMeters(prev, s.poi);
    prev = s.poi;
    meters += m;
    return { meters: m, minutes: m / (METERS_PER_MIN * pace) };
  });
  const cost = routeCost(start, stops, pace);
  return {
    start,
    stops: stops.map((s, i) => ({
      id: s.poi.id, poi: s.poi, rest: s.rest || null, restMin: s.rest ? s.restMin : 0, leg: legs[i],
    })),
    meters,
    walkMinutes: cost.walk,
    totalMinutes: cost.total,
    pace,
  };
}

/** Замена одной точки: лучшая альтернатива поблизости, подходящая под настроение. */
export function suggestReplacement(route, index, opts) {
  const weights = combineWeights(opts.moods || [], opts.extraWeights);
  const rand = rng((opts.seed || 1) + index * 7919);
  const taken = new Set(route.stops.map((s) => s.id).concat(opts.exclude || []));
  const prev = index === 0 ? route.start : route.stops[index - 1].poi;
  const next = route.stops[index + 1]?.poi;
  const cur = route.stops[index];
  let best = null;
  for (const p of POIS) {
    if (taken.has(p.id)) continue;
    if (cur.rest && !p.rest?.includes(cur.rest)) continue;
    const detour = walkMeters(prev, p) + (next ? walkMeters(p, next) : 0);
    const value = scorePoi(p, weights, opts.hidden ?? 1, rand) * 400 - detour;
    if (!best || value > best.value) best = { p, value };
  }
  return best?.p || null;
}
