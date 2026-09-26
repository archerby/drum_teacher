/*
 * Настроения → веса тем. Каждая точка оценивается как скалярное произведение
 * весов настроения на её теги (см. data/pois.js) — тот же принцип, что у
 * семантического поиска: запрос и документ живут в одном пространстве тем.
 */
export const TAGS = ['absurd', 'quirky', 'history', 'dark', 'legend', 'romantic', 'view',
  'nature', 'art', 'music', 'soviet', 'food', 'science', 'jewish'];

export const MOODS = [
  { id: 'wow', emoji: '🤯', w: { absurd: 3, quirky: 3, legend: 1.5, science: 1 } },
  { id: 'romance', emoji: '💘', w: { romantic: 3, view: 2.5, nature: 2, music: 1.5, food: 0.5 } },
  { id: 'deep', emoji: '🕯️', w: { history: 3, dark: 2.5, jewish: 2, art: 0.5 } },
  { id: 'retro', emoji: '📻', w: { soviet: 3, quirky: 1.5, food: 1, absurd: 1 } },
  { id: 'art', emoji: '🎨', w: { art: 3, music: 2, quirky: 1.5, view: 0.5 } },
  { id: 'chill', emoji: '🛋️', w: { nature: 3, food: 2, view: 1.5, romantic: 1 }, pace: 0.85 },
  { id: 'adventure', emoji: '🧭', w: { legend: 2.5, view: 2, absurd: 1.5, history: 1.5, quirky: 1 }, pace: 1.1 },
  { id: 'tasty', emoji: '🥟', w: { food: 3.5, quirky: 1, history: 0.5 } },
  { id: 'kids', emoji: '🧸', w: { legend: 3, nature: 2, quirky: 2, science: 2, absurd: 1.5 } },
];

export const MOOD_BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]));

/** Суммирует веса выбранных настроений (и, опционально, веса из свободного текста). */
export function combineWeights(moodIds, extra) {
  const w = Object.fromEntries(TAGS.map((t) => [t, 0]));
  const ids = moodIds.length ? moodIds : ['wow'];
  for (const id of ids) {
    const m = MOOD_BY_ID[id];
    if (!m) continue;
    for (const [t, v] of Object.entries(m.w)) w[t] += v / ids.length;
  }
  if (extra) for (const [t, v] of Object.entries(extra)) if (t in w) w[t] += v;
  return w;
}

export function paceFor(moodIds) {
  const ps = moodIds.map((id) => MOOD_BY_ID[id]?.pace || 1);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 1;
}

/*
 * Офлайн-разбор свободного текста: основы слов на ru/uk/be/pl/en → темы и
 * подсказки (время, привал, скрытость). Работает без сервера; если сервер с
 * Claude доступен, он разбирает текст точнее (см. server/server.mjs).
 */
/* Основы слов: совпадение ищется только с начала слова. */
const stems = (list) => new RegExp('(?:^|[^\\p{L}])(?:' + list.join('|') + ')', 'iu');

const LEXICON = [
  [stems(['странн', 'стран[ео]', 'абсурд', 'безум', 'сумасш', 'дик', 'удив', 'чуд[нн]', 'wow', 'weird', 'crazy', 'absurd', 'odd', 'strange', 'dziwn', 'szalon', 'zwariow', 'дзіўн', 'шалён', 'вар\'ят', 'божевіл', 'дивн']), { absurd: 2, quirky: 2 }],
  [stems(['романт', 'любов', 'любим', 'свидан', 'вдвоём', 'двоих', 'закат', 'romant', 'love', 'date', 'sunset', 'randk', 'zakocha', 'zachód', 'кахан', 'спатканн', 'кохан', 'побачен', 'захад', 'захід']), { romantic: 3, view: 1 }],
  [stems(['истор', 'прошл', 'войн', 'памят', 'груст', 'печал', 'задум', 'histor', 'war', 'memor', 'sad', 'wojn', 'pamię', 'smut', 'zaduma', 'гіст', 'вайн', 'сумн', 'істор', 'війн', 'пам\'ят']), { history: 2, dark: 1.5 }],
  [stems(['евре', 'гетто', 'jew', 'ghetto', 'żyd', 'getto', 'габрэ', 'яўр', 'євре']), { jewish: 3, history: 1 }],
  [stems(['ссср', 'совет', 'соц', 'пнр', 'коммун', 'ретро', 'ностальг', 'soviet', 'commun', 'retro', 'nostalg', 'prl', 'komun', 'socrealiz', 'савец', 'камун', 'радян', 'комун']), { soviet: 3 }],
  [stems(['искусств', 'арт', 'творч', 'вдохнов', 'музык', 'art', 'music', 'inspir', 'creativ', 'sztuk', 'muzyk', 'twórcz', 'мастацт', 'натхн', 'мистецт']), { art: 2, music: 1.5 }],
  [stems(['природ', 'парк', 'зелен', 'дерев', 'рек', 'реч', 'nature', 'park', 'green', 'river', 'tree', 'przyrod', 'zielen', 'rzek', 'прырод', 'рак', 'зялён', 'річк', 'зелен']), { nature: 3 }],
  [stems(['ед[аы]', 'поесть', 'голод', 'вкусн', 'пирог', 'пончик', 'food', 'hungry', 'eat', 'tasty', 'foodie', 'jedzen', 'głod', 'smaczn', 'pierog', 'ежа', 'галодн', 'смачн', 'їж', 'голодн']), { food: 3 }],
  [stems(['вид[аоуы ]', 'вид$', 'панорам', 'высот', 'крыш', 'view', 'panoram', 'rooftop', 'widok', 'dach', 'выгляд', 'краявід', 'панарам']), { view: 3 }],
  [stems(['легенд', 'сказк', 'миф', 'тайн', 'призрак', 'legend', 'myth', 'ghost', 'fairy', 'baśń', 'baśni', 'tajemn', 'mit', 'duch', 'паданн', 'казк', 'таямн', 'таємн']), { legend: 3 }],
  [stems(['наук', 'учён', 'физик', 'science', 'nerd', 'nauk', 'fizyk', 'навук']), { science: 3 }],
  [stems(['дет[иейяь]', 'ребён', 'сын', 'доч', 'kid', 'child', 'family', 'dzieci', 'dzieck', 'rodzin', 'дзец', 'дзяц', 'діт', 'дитин', 'родин']), { legend: 1.5, nature: 1, quirky: 1, science: 1 }],
];

const TIRED = stems(['устал', 'лень', 'лениво', 'похмел', 'медлен', 'tired', 'lazy', 'hangover', 'slow', 'zmęcz', 'leniw', 'kac', 'powoli', 'стаміл', 'лянот', 'лянів', 'втом', 'лін']);
const HIDDEN = stems(['скрыт', 'тайн', 'секрет', 'неизвест', 'не туристич', 'местн', 'hidden', 'secret', 'local', 'off.?beat', 'ukryt', 'tajemn', 'mało znan', 'lokaln', 'схаван', 'таемн', 'прихова', 'таємн', 'мясцов', 'місцев']);
const CLASSIC = stems(['классик', 'главн', 'знаменит', 'обязательн', 'первый раз', 'classic', 'must', 'famous', 'first time', 'klasyk', 'najważniejsz', 'słynn', 'pierwszy raz', 'класік', 'галоўн', 'вядом', 'класик', 'головн', 'відом']);
const COFFEE = stems(['кофе', 'кав', 'coffee', 'kaw', 'десерт', 'dessert', 'deser', 'пончик', 'pączk', 'цукерн']);
const MEAL = stems(['обед', 'ужин', 'поесть', 'голод', 'lunch', 'dinner', 'hungry', 'obiad', 'kolacj', 'głodn', 'абед', 'вячэр', 'галодн', 'обід', 'вечер', 'голодн']);
const HOURS = /(\d+(?:[.,]\d+)?)\s*(?:ч|час|h|hour|godz|гадз|год)/i;
const MINS = /(\d+)\s*(?:мин|min|хв)/i;

export function parseMoodText(text) {
  const out = { weights: {}, hits: 0 };
  if (!text) return out;
  for (const [re, w] of LEXICON) {
    if (re.test(text)) {
      out.hits++;
      for (const [t, v] of Object.entries(w)) out.weights[t] = (out.weights[t] || 0) + v;
    }
  }
  if (TIRED.test(text)) { out.tired = true; out.weights.nature = (out.weights.nature || 0) + 1; out.hits++; }
  if (HIDDEN.test(text)) { out.hidden = 2; out.hits++; }
  else if (CLASSIC.test(text)) { out.hidden = 0; out.hits++; }
  if (MEAL.test(text)) { out.sit = 'meal'; out.hits++; }
  else if (COFFEE.test(text)) { out.sit = 'coffee'; out.hits++; }
  const h = text.match(HOURS);
  const m = text.match(MINS);
  if (h) out.minutes = Math.round(parseFloat(h[1].replace(',', '.')) * 60);
  else if (m) out.minutes = parseInt(m[1], 10);
  return out;
}
