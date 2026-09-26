import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/* Поддельный Anthropic API: проверяем, что уходит правильный запрос, и отдаём ответ. */
let seen = null;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen = { url: req.url, headers: req.headers, body: JSON.parse(body) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: seen.body.model, stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({
        weights: { absurd: 3, quirky: 2, history: 0, dark: 0, legend: 1, romantic: 0, view: 0, nature: 0, art: 0, music: 0, soviet: 0, food: 9, science: 0, jewish: 0 },
        minutes: 95, sit: 'coffee', hidden: 2, tired: true, summary: 'странное, но <b>неспешное</b>',
      }) }],
      usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });
});

test('ручка /api/mood: запрос к Claude и нормализация ответа', async (t) => {
  await new Promise((r) => mock.listen(0, r));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  const { server } = await import('../server.mjs?ai');
  await new Promise((r) => server.listen(0, r));
  t.after(() => { server.close(); mock.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await (await fetch(base + '/api/health')).json();
  assert.deepEqual(health, { ok: true, ai: true });

  const res = await fetch(base + '/api/mood', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'хочу странного, но я устал', lang: 'ru' }),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(seen.url.startsWith('/v1/messages'), true);
  assert.equal(seen.body.model, 'claude-opus-5');
  assert.equal(seen.body.fallbacks, 'default');
  assert.match(seen.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(seen.body.output_config.format.type, 'json_schema');
  assert.match(seen.body.messages[0].content, /<visitor_text>/);
  assert.equal(j.weights.food, 3, 'веса обрезаются до 0..3');
  assert.equal(j.weights.history, undefined, 'нули не передаются');
  assert.equal(j.minutes, 95);
  assert.equal(j.sit, 'coffee');
  assert.equal(j.hidden, 2);
  assert.equal(j.tired, true);
  assert.ok(!/[<>]/.test(j.summary), 'в подписи нет разметки');

  const bad = await fetch(base + '/api/mood', { method: 'POST', body: 'not json' });
  assert.equal(bad.status, 400);
  const traversal = await fetch(base + '/%2e%2e/server/server.mjs');
  assert.notEqual(traversal.status, 200, 'файлы вне public недоступны');
});
