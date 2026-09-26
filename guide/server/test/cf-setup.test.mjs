import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/cf-setup.mjs', import.meta.url));
const TUNNEL = '6f1b3c1e-0000-4000-8000-000000000abc';

/* Поддельный Cloudflare API с состоянием: зона, DNS-записи, туннель и его конфиг. */
function mockCloudflare(state) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/^\/client\/v4/, '');
      calls.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : null });
      const ok = (result, info) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, errors: [], result, ...(info ? { result_info: info } : {}) })); };
      const fail = (code, msg) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, errors: [{ code: 1000, message: msg }], result: null })); };
      if (req.headers.authorization !== 'Bearer test-token') return fail(403, 'bad token');
      let m;
      if (req.method === 'GET' && p === '/zones') {
        return ok(url.searchParams.get('name') === 'upupa.dev' ? [{ id: 'zone1', name: 'upupa.dev', account: { id: 'acc1', name: 'Upupa' } }] : []);
      }
      if ((m = p.match(/^\/zones\/zone1\/dns_records$/))) {
        if (req.method === 'GET') {
          let list = state.dns;
          if (url.searchParams.get('type')) list = list.filter((r) => r.type === url.searchParams.get('type'));
          if (url.searchParams.get('name')) list = list.filter((r) => r.name === url.searchParams.get('name'));
          return ok(list, { page: 1, per_page: 100, total_pages: 1, count: list.length, total_count: list.length });
        }
        if (req.method === 'POST') { const rec = { id: `rec${state.dns.length + 1}`, ...JSON.parse(body) }; state.dns.push(rec); return ok(rec); }
      }
      if ((m = p.match(/^\/zones\/zone1\/dns_records\/(\w+)$/)) && req.method === 'PUT') {
        const i = state.dns.findIndex((r) => r.id === m[1]);
        state.dns[i] = { id: m[1], ...JSON.parse(body) };
        return ok(state.dns[i]);
      }
      if (req.method === 'GET' && p === `/accounts/acc1/cfd_tunnel/${TUNNEL}`) {
        return ok({ id: TUNNEL, name: 'ct113', status: 'healthy', remote_config: state.remote });
      }
      if (p === `/accounts/acc1/cfd_tunnel/${TUNNEL}/configurations`) {
        if (req.method === 'GET') return ok({ tunnel_id: TUNNEL, version: 3, config: state.config, source: state.remote ? 'cloudflare' : 'local' });
        if (req.method === 'PUT') { state.config = JSON.parse(body).config; return ok({ tunnel_id: TUNNEL, version: 4, config: state.config }); }
      }
      return fail(404, `no route ${req.method} ${p}`);
    });
  });
  return { server, calls };
}

function freshState(over = {}) {
  return {
    remote: true,
    dns: [
      { id: 'rec1', type: 'CNAME', name: 'upupa.dev', content: `${TUNNEL}.cfargotunnel.com`, proxied: true },
      { id: 'rec2', type: 'CNAME', name: 'www.upupa.dev', content: `${TUNNEL}.cfargotunnel.com`, proxied: true },
    ],
    config: {
      ingress: [
        { hostname: 'www.upupa.dev', service: 'http://localhost:8080', originRequest: {} },
        { hostname: 'upupa.dev', service: 'http://localhost:8080' },
        { service: 'http_status:404' },
      ],
      'warp-routing': { enabled: false },
      originRequest: { connectTimeout: 30 },
    },
    ...over,
  };
}

async function withMock(state, fn) {
  const mock = mockCloudflare(state);
  await new Promise((r) => mock.server.listen(0, '127.0.0.1', r));
  try {
    const run = (...flags) => new Promise((resolve) => {
      execFile(process.execPath, [SCRIPT, ...flags], {
        env: { ...process.env, CLOUDFLARE_API_TOKEN: 'test-token', CF_API_BASE: `http://127.0.0.1:${mock.server.address().port}/client/v4`, GUIDE_SERVICE: '' },
      }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr }));
    });
    return await fn(run, mock.calls);
  } finally {
    mock.server.close();
  }
}

const mutations = (calls) => calls.filter((c) => c.method !== 'GET');

test('сухой прогон ничего не меняет', async () => {
  const state = freshState();
  await withMock(state, async (run, calls) => {
    const r = await run();
    assert.equal(r.code, 0, r.out);
    assert.equal(mutations(calls).length, 0);
    assert.match(r.out, /guide\.upupa\.dev → http:\/\/localhost:8090/);
  });
});

test('--apply: правило перед заглушкой, прочие настройки целы, CNAME создан; повтор ничего не меняет', async () => {
  const state = freshState();
  await withMock(state, async (run, calls) => {
    const r = await run('--apply');
    assert.equal(r.code, 0, r.out);
    const ing = state.config.ingress;
    assert.equal(ing.length, 4);
    assert.deepEqual(ing[2], { hostname: 'guide.upupa.dev', service: 'http://localhost:8090', originRequest: {} });
    assert.deepEqual(ing[3], { service: 'http_status:404' }, 'заглушка осталась последней');
    assert.deepEqual(ing[0], { hostname: 'www.upupa.dev', service: 'http://localhost:8080', originRequest: {} });
    assert.deepEqual(state.config['warp-routing'], { enabled: false });
    assert.deepEqual(state.config.originRequest, { connectTimeout: 30 });
    const rec = state.dns.find((d) => d.name === 'guide.upupa.dev');
    assert.equal(rec.type, 'CNAME');
    assert.equal(rec.content, `${TUNNEL}.cfargotunnel.com`);
    assert.equal(rec.proxied, true);

    const before = mutations(calls).length;
    const again = await run('--apply');
    assert.equal(again.code, 0, again.out);
    assert.equal(mutations(calls).length, before, 'повторный запуск идемпотентен');
  });
});

test('адрес сервиса берётся с хоста www.upupa.dev', async () => {
  const state = freshState();
  state.config.ingress[0].service = 'http://192.168.88.147:8080';
  await withMock(state, async (run) => {
    const r = await run('--apply');
    assert.equal(r.code, 0, r.out);
    assert.equal(state.config.ingress.find((x) => x.hostname === 'guide.upupa.dev').service, 'http://192.168.88.147:8090');
  });
});

test('локальный config.yml: конфиг не трогаем, CNAME создаём, печатаем подсказку', async () => {
  const state = freshState({ remote: false });
  await withMock(state, async (run, calls) => {
    const r = await run('--apply');
    assert.equal(r.code, 0, r.out);
    assert.ok(!calls.some((c) => c.path.endsWith('/configurations')));
    assert.match(r.out, /hostname: guide\.upupa\.dev/);
    assert.ok(state.dns.some((d) => d.name === 'guide.upupa.dev'));
  });
});

test('чужая запись guide.upupa.dev без --force не перезаписывается', async () => {
  const state = freshState();
  state.dns.push({ id: 'rec9', type: 'A', name: 'guide.upupa.dev', content: '1.2.3.4', proxied: false });
  await withMock(state, async (run) => {
    const r = await run('--apply');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /--force/);
    assert.equal(state.dns.find((d) => d.id === 'rec9').content, '1.2.3.4');
  });
});

test('правило с другим адресом без --force не меняется', async () => {
  const state = freshState();
  state.config.ingress.splice(2, 0, { hostname: 'guide.upupa.dev', service: 'http://localhost:9999' });
  await withMock(state, async (run, calls) => {
    const r = await run('--apply');
    assert.notEqual(r.code, 0);
    assert.equal(mutations(calls).length, 0);
  });
});

test('без токена — понятная ошибка', async () => {
  const r = await new Promise((resolve) => execFile(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH } },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));
  assert.notEqual(r.code, 0);
  assert.match(r.out, /CLOUDFLARE_API_TOKEN/);
});
