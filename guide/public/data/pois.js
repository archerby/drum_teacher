/*
 * Точки маршрута: только структура. Тексты (название, крючок, справка, факт,
 * «что искать») лежат в i18n/<lang>.js под тем же id.
 *
 * lat/lng   — координаты входа или места, где стоит остановиться
 * bank      — берег Вислы: 'L' левый (центр), 'R' правый (Прага)
 * dwell     — сколько минут стоять/смотреть (без захода в платный музей)
 * hidden    — 0 знают все · 1 знают многие · 2 знают местные · 3 скрытый шедевр
 * tags      — 0..3, насколько точка подходит под тему (см. js/moods.js)
 * rest      — где можно присесть: coffee (кофе/десерт), meal (поесть), bench (лавочка)
 * paid      — главное внутри и за деньги (снаружи смотреть можно бесплатно)
 */
export const POIS = [
  // ── Старый и Новый город ─────────────────────────────────────────────
  { id: 'zamek', lat: 52.24795, lng: 21.01518, bank: 'L', area: 'old', dwell: 12, hidden: 0,
    tags: { history: 3, legend: 1, absurd: 1, view: 1 } },
  { id: 'kolumna', lat: 52.24720, lng: 21.01355, bank: 'L', area: 'old', dwell: 5, hidden: 0,
    tags: { legend: 3, history: 2, absurd: 1 } },
  { id: 'rynek', lat: 52.24968, lng: 21.01220, bank: 'L', area: 'old', dwell: 15, hidden: 0,
    tags: { history: 3, legend: 3, romantic: 2, absurd: 1 }, rest: ['coffee', 'meal'] },
  { id: 'kanonia', lat: 52.24915, lng: 21.01465, bank: 'L', area: 'old', dwell: 5, hidden: 2,
    tags: { quirky: 3, legend: 2, absurd: 2, romantic: 1 } },
  { id: 'sw-anny', lat: 52.24655, lng: 21.01420, bank: 'L', area: 'old', dwell: 20, hidden: 1, paid: true,
    tags: { view: 3, romantic: 2, absurd: 1, history: 1 } },
  { id: 'maly-powstaniec', lat: 52.25010, lng: 21.01060, bank: 'L', area: 'old', dwell: 5, hidden: 1,
    tags: { history: 3, dark: 2 } },
  { id: 'barbakan', lat: 52.25068, lng: 21.00975, bank: 'L', area: 'old', dwell: 5, hidden: 0,
    tags: { history: 2, absurd: 2, legend: 1 } },
  { id: 'kilinski', lat: 52.24935, lng: 21.01100, bank: 'L', area: 'old', dwell: 4, hidden: 2,
    tags: { absurd: 3, history: 2, legend: 1, quirky: 1 } },
  { id: 'curie', lat: 52.25155, lng: 21.00855, bank: 'L', area: 'old', dwell: 7, hidden: 1, paid: true,
    tags: { science: 3, absurd: 2, history: 2 } },
  { id: 'nowe-miasto', lat: 52.25275, lng: 21.00820, bank: 'L', area: 'old', dwell: 8, hidden: 1,
    tags: { romantic: 3, history: 1, legend: 1, nature: 1 }, rest: ['bench', 'coffee'] },
  { id: 'mariensztat', lat: 52.24635, lng: 21.01740, bank: 'L', area: 'old', dwell: 5, hidden: 2,
    tags: { romantic: 3, soviet: 2, quirky: 1, history: 1 }, rest: ['bench', 'coffee'] },

  // ── Королевский тракт ────────────────────────────────────────────────
  { id: 'bristol', lat: 52.24240, lng: 21.01575, bank: 'L', area: 'center', dwell: 4, hidden: 1,
    tags: { history: 2, music: 2, romantic: 2, food: 2 }, rest: ['coffee'] },
  { id: 'wizytki', lat: 52.24130, lng: 21.01520, bank: 'L', area: 'center', dwell: 6, hidden: 2,
    tags: { quirky: 3, music: 2, history: 2 } },
  { id: 'kopernik', lat: 52.23940, lng: 21.01830, bank: 'L', area: 'center', dwell: 5, hidden: 0,
    tags: { science: 3, absurd: 3, history: 2 } },
  { id: 'sw-krzyz', lat: 52.23855, lng: 21.01755, bank: 'L', area: 'center', dwell: 8, hidden: 1,
    tags: { music: 3, absurd: 3, dark: 2, legend: 1 } },
  { id: 'blikle', lat: 52.23360, lng: 21.01905, bank: 'L', area: 'center', dwell: 3, hidden: 0,
    tags: { food: 3, history: 2 }, rest: ['coffee'] },
  { id: 'palma', lat: 52.23175, lng: 21.02240, bank: 'L', area: 'center', dwell: 3, hidden: 0,
    tags: { absurd: 3, art: 3, quirky: 3 } },

  // ── Повисле и Висла ──────────────────────────────────────────────────
  { id: 'ostrogski', lat: 52.23660, lng: 21.02370, bank: 'L', area: 'powisle', dwell: 8, hidden: 1,
    tags: { legend: 3, music: 3, absurd: 1 }, rest: ['bench'] },
  { id: 'buw', lat: 52.24250, lng: 21.02480, bank: 'L', area: 'powisle', dwell: 20, hidden: 2,
    tags: { nature: 3, view: 3, romantic: 3, quirky: 2, science: 1 }, rest: ['bench'] },
  { id: 'syrenka', lat: 52.23960, lng: 21.03160, bank: 'L', area: 'powisle', dwell: 5, hidden: 1,
    tags: { legend: 3, romantic: 2, history: 2, dark: 1 } },
  { id: 'bulwary', lat: 52.24330, lng: 21.02900, bank: 'L', area: 'powisle', dwell: 8, hidden: 0,
    tags: { nature: 3, romantic: 2, view: 2, food: 1 }, rest: ['bench', 'coffee'] },

  // ── Центр ────────────────────────────────────────────────────────────
  { id: 'wedel', lat: 52.23335, lng: 21.01470, bank: 'L', area: 'center', dwell: 3, hidden: 1,
    tags: { food: 3, history: 2, soviet: 1, absurd: 1 }, rest: ['coffee'] },
  { id: 'pkin', lat: 52.23180, lng: 21.00600, bank: 'L', area: 'center', dwell: 12, hidden: 0,
    tags: { soviet: 3, absurd: 3, view: 3, history: 2 } },
  { id: 'ogrod-saski', lat: 52.24020, lng: 21.00800, bank: 'L', area: 'center', dwell: 8, hidden: 0,
    tags: { nature: 3, absurd: 2, romantic: 2, history: 1 }, rest: ['bench'] },
  { id: 'grob', lat: 52.24120, lng: 21.01110, bank: 'L', area: 'center', dwell: 8, hidden: 0,
    tags: { history: 3, dark: 2 } },
  { id: 'zacheta', lat: 52.23905, lng: 21.01110, bank: 'L', area: 'center', dwell: 4, hidden: 1,
    tags: { art: 3, dark: 2, history: 2 } },
  { id: 'koszyki', lat: 52.22250, lng: 21.01100, bank: 'L', area: 'south', dwell: 3, hidden: 0,
    tags: { food: 3, history: 1 }, rest: ['meal', 'coffee'] },
  { id: 'mdm', lat: 52.22235, lng: 21.01620, bank: 'L', area: 'south', dwell: 5, hidden: 1,
    tags: { soviet: 3, absurd: 2, art: 1 } },
  { id: 'plac-zbawiciela', lat: 52.21965, lng: 21.01720, bank: 'L', area: 'south', dwell: 4, hidden: 1,
    tags: { art: 2, absurd: 2, quirky: 2, romantic: 1 }, rest: ['coffee'] },
  { id: 'bar-prasowy', lat: 52.21550, lng: 21.02030, bank: 'L', area: 'south', dwell: 3, hidden: 2,
    tags: { food: 3, soviet: 3, quirky: 1 }, rest: ['meal'] },

  // ── Лазенки и Уяздов ─────────────────────────────────────────────────
  { id: 'jazdow', lat: 52.21930, lng: 21.02980, bank: 'L', area: 'lazienki', dwell: 6, hidden: 3,
    tags: { quirky: 3, history: 2, nature: 2, romantic: 1 } },
  { id: 'ujazdowski', lat: 52.21945, lng: 21.03100, bank: 'L', area: 'lazienki', dwell: 8, hidden: 1,
    tags: { art: 3, view: 2, history: 1 } },
  { id: 'chopin-pomnik', lat: 52.21470, lng: 21.02790, bank: 'L', area: 'lazienki', dwell: 8, hidden: 0,
    tags: { music: 3, romantic: 3, nature: 2, dark: 1 }, rest: ['bench'] },
  { id: 'lazienki', lat: 52.21500, lng: 21.03550, bank: 'L', area: 'lazienki', dwell: 15, hidden: 0,
    tags: { romantic: 3, nature: 3, history: 2, legend: 1 }, rest: ['bench'] },
  { id: 'amfiteatr', lat: 52.21375, lng: 21.03650, bank: 'L', area: 'lazienki', dwell: 5, hidden: 2,
    tags: { romantic: 3, art: 2, quirky: 2, music: 1 } },

  // ── Еврейская Варшава, Муранов, Воля ─────────────────────────────────
  { id: 'polin', lat: 52.24940, lng: 20.99330, bank: 'L', area: 'muranow', dwell: 12, hidden: 0,
    tags: { jewish: 3, history: 3, dark: 2, art: 2, absurd: 1 } },
  { id: 'muranow', lat: 52.24580, lng: 20.99650, bank: 'L', area: 'muranow', dwell: 5, hidden: 3,
    tags: { dark: 3, history: 3, soviet: 2, absurd: 1 } },
  { id: 'wiezowiec', lat: 52.24360, lng: 21.00250, bank: 'L', area: 'muranow', dwell: 4, hidden: 2,
    tags: { jewish: 3, legend: 3, dark: 2, absurd: 2 } },
  { id: 'hala-mirowska', lat: 52.23870, lng: 20.99750, bank: 'L', area: 'muranow', dwell: 5, hidden: 1,
    tags: { food: 3, history: 2, dark: 2 }, rest: ['meal', 'coffee'] },
  { id: 'prozna', lat: 52.23640, lng: 21.00440, bank: 'L', area: 'center', dwell: 8, hidden: 2,
    tags: { jewish: 3, history: 3, dark: 1, romantic: 1 } },
  { id: 'kladka', lat: 52.23720, lng: 20.98910, bank: 'L', area: 'muranow', dwell: 5, hidden: 2,
    tags: { dark: 3, jewish: 3, history: 3, art: 1 } },
  { id: 'keret', lat: 52.23775, lng: 20.98905, bank: 'L', area: 'muranow', dwell: 4, hidden: 3,
    tags: { absurd: 3, art: 3, quirky: 3, jewish: 2 } },
  { id: 'mur-getta', lat: 52.23055, lng: 20.99835, bank: 'L', area: 'muranow', dwell: 5, hidden: 3,
    tags: { dark: 3, jewish: 3, history: 3 } },
  { id: 'powstanie', lat: 52.23230, lng: 20.98100, bank: 'L', area: 'muranow', dwell: 20, hidden: 0, paid: true,
    tags: { history: 3, dark: 3 } },

  // ── Прага (правый берег) ─────────────────────────────────────────────
  { id: 'niedzwiedzie', lat: 52.25300, lng: 21.03020, bank: 'R', area: 'praga', dwell: 6, hidden: 2,
    tags: { absurd: 3, quirky: 3, art: 2, nature: 1 }, rest: ['bench'] },
  { id: 'cerkiew', lat: 52.25480, lng: 21.03320, bank: 'R', area: 'praga', dwell: 5, hidden: 2,
    tags: { history: 2, art: 2, absurd: 1, legend: 1 } },
  { id: 'rozycki', lat: 52.25180, lng: 21.03990, bank: 'R', area: 'praga', dwell: 5, hidden: 2,
    tags: { quirky: 3, absurd: 2, history: 2, food: 1 } },
  { id: 'kapliczki', lat: 52.25200, lng: 21.04250, bank: 'R', area: 'praga', dwell: 6, hidden: 3,
    tags: { quirky: 2, history: 2, legend: 1, dark: 1, romantic: 1 } },
  { id: 'koneser', lat: 52.25510, lng: 21.04500, bank: 'R', area: 'praga', dwell: 8, hidden: 1,
    tags: { food: 2, quirky: 2, history: 2, art: 1 }, rest: ['meal', 'coffee'] },
  { id: 'neon', lat: 52.24790, lng: 21.06660, bank: 'R', area: 'praga', dwell: 25, hidden: 2, paid: true,
    tags: { soviet: 3, art: 3, quirky: 2 } },
  { id: 'stadion', lat: 52.23950, lng: 21.04570, bank: 'R', area: 'praga', dwell: 5, hidden: 1,
    tags: { absurd: 3, soviet: 2, history: 2, dark: 1 } },
];

/* Мосты и кладки: пешеходный путь с берега на берег идёт через ближайший из них. */
export const BRIDGES = [
  { id: 'gdanski', lat: 52.26107, lng: 21.01061 },
  { id: 'slasko-dabrowski', lat: 52.24944, lng: 21.02278 },
  { id: 'kladka-karowa', lat: 52.24660, lng: 21.02880 },
  { id: 'swietokrzyski', lat: 52.24194, lng: 21.03500 },
  { id: 'poniatowski', lat: 52.23611, lng: 21.04167 },
];

/* Точки старта, если геолокация недоступна или человек не в центре. */
export const STARTS = [
  { id: 'old', lat: 52.24730, lng: 21.01390, bank: 'L' },
  { id: 'center', lat: 52.23020, lng: 21.01140, bank: 'L' },
  { id: 'powisle', lat: 52.23970, lng: 21.02480, bank: 'L' },
  { id: 'praga', lat: 52.25440, lng: 21.03500, bank: 'R' },
  { id: 'lazienki', lat: 52.21600, lng: 21.02750, bank: 'L' },
  { id: 'muranow', lat: 52.24900, lng: 20.99500, bank: 'L' },
];
