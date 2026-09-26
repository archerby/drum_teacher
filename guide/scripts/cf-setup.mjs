#!/usr/bin/env node
/*
 * Публикует guide.upupa.dev через тот же Cloudflare Tunnel, что обслуживает upupa.dev.
 *
 *   CLOUDFLARE_API_TOKEN=… node scripts/cf-setup.mjs            # показать план, ничего не менять
 *   CLOUDFLARE_API_TOKEN=… node scripts/cf-setup.mjs --apply    # применить
 *
 * Без Node на хосте:  docker run --rm -e CLOUDFLARE_API_TOKEN -v "$PWD/scripts:/s:ro" node:22-alpine node /s/cf-setup.mjs --apply
 *
 * Токен: Zone → Zone → Read и Zone → DNS → Edit (upupa.dev), Account → Cloudflare Tunnel → Edit.
 *
 * Что делает (идемпотентно, повторный запуск ничего не ломает):
 *  1. находит зону upupa.dev и её аккаунт;
 *  2. находит туннель — по CNAME www.upupa.dev/upupa.dev → <id>.cfargotunnel.com (или CF_TUNNEL_ID);
 *  3. если туннель управляется из панели — добавляет в его ingress правило
 *     guide.upupa.dev → тот же хост, что у www.upupa.dev, но порт 8090 (или GUIDE_SERVICE),
 *     перед финальным правилом-заглушкой; остальные правила и настройки не трогает;
 *     если туннель на локальном config.yml — печатает, что туда дописать;
 *  4. создаёт проксируемый CNAME guide.upupa.dev → <id>.cfargotunnel.com.
 * Существующую чужую запись или правило с другим адресом меняет только с --force.
 *
 * Переменные: CLOUDFLARE_API_TOKEN (или CF_API_TOKEN), CF_ZONE (upupa.dev), GUIDE_HOST (guide.upupa.dev),
 * GUIDE_PORT (8090), GUIDE_SERVICE (напр. http://localhost:8090), CF_TUNNEL_ID, CF_API_BASE (для тестов).
 */

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const FORCE = args.has('--force');
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
const API = (process.env.CF_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');
const ZONE = process.env.CF_ZONE || 'upupa.dev';
const HOST = process.env.GUIDE_HOST || `guide.${ZONE}`;
const PORT = process.env.GUIDE_PORT || '8090';
const TUNNEL_SUFFIX = '.cfargotunnel.com';

const log = (...a) => console.log(...a);
const plan = (msg) => log(`${APPLY ? '→' : '• план:'} ${msg}`);
function die(msg, code = 1) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

if (args.has('--help') || args.has('-h')) {
  log('Использование: CLOUDFLARE_API_TOKEN=… node scripts/cf-setup.mjs [--apply] [--force]');
  process.exit(0);
}
if (!TOKEN) die('нет CLOUDFLARE_API_TOKEN (права: Zone:Read, DNS:Edit для зоны, Cloudflare Tunnel:Edit для аккаунта)');

async function cf(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    die(`${method} ${path}: сеть недоступна (${err.cause?.code || err.message})`);
  }
  let json = null;
  try { json = await res.json(); } catch { /* не JSON */ }
  if (!res.ok || !json?.success) {
    const errs = (json?.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ');
    die(`${method} ${path} → HTTP ${res.status}${errs ? ` (${errs})` : ''}`);
  }
  return json.result;
}

/* Все страницы списка (DNS-записи, туннели). */
async function cfList(path) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${API}${path}${sep}page=${page}&per_page=100`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }).catch((err) => die(`GET ${path}: сеть недоступна (${err.cause?.code || err.message})`));
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      const errs = (json?.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ');
      die(`GET ${path} → HTTP ${res.status}${errs ? ` (${errs})` : ''}`);
    }
    out.push(...(json.result || []));
    const info = json.result_info;
    if (!info || !info.total_pages || page >= info.total_pages) break;
  }
  return out;
}

const tunnelIdOf = (rec) => (rec?.type === 'CNAME' && rec.content?.endsWith(TUNNEL_SUFFIX)
  ? rec.content.slice(0, -TUNNEL_SUFFIX.length) : null);

function deriveService(ingress) {
  if (process.env.GUIDE_SERVICE) return { service: process.env.GUIDE_SERVICE, from: 'GUIDE_SERVICE' };
  const site = ingress.find((r) => r.hostname === `www.${ZONE}`) || ingress.find((r) => r.hostname === ZONE);
  if (site?.service) {
    try {
      const u = new URL(site.service);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return { service: `http://${u.hostname}:${PORT}`, from: `как у ${site.hostname} (${site.service})` };
      }
    } catch { /* не URL, например http_status:404 */ }
  }
  return { service: `http://localhost:${PORT}`, from: 'по умолчанию — проверь, что cloudflared запущен на том же хосте' };
}

async function main() {
  log(`${APPLY ? 'Применяю' : 'Сухой прогон (добавь --apply, чтобы применить)'}: ${HOST} через Cloudflare Tunnel\n`);

  // 1. Зона и аккаунт.
  const zones = await cf('GET', `/zones?name=${encodeURIComponent(ZONE)}`);
  const zone = zones?.[0];
  if (!zone) die(`зона ${ZONE} не найдена этим токеном`);
  const accountId = zone.account?.id;
  if (!accountId) die('у зоны нет account.id — токену не хватает прав Zone:Read?');
  log(`✓ зона ${zone.name} (${zone.id}), аккаунт ${zone.account.name || accountId}`);

  // 2. Туннель: из CNAME сайта или явно.
  const records = await cfList(`/zones/${zone.id}/dns_records?type=CNAME`);
  let tunnelId = process.env.CF_TUNNEL_ID || null;
  if (!tunnelId) {
    const site = records.find((r) => r.name === `www.${ZONE}` && tunnelIdOf(r))
      || records.find((r) => r.name === ZONE && tunnelIdOf(r));
    tunnelId = tunnelIdOf(site);
    if (!tunnelId) {
      const ids = [...new Set(records.map(tunnelIdOf).filter(Boolean))];
      if (ids.length === 1) [tunnelId] = ids;
      else if (ids.length > 1) die(`в зоне несколько туннелей (${ids.join(', ')}) — укажи CF_TUNNEL_ID`);
      else die(`не нашёл CNAME на *${TUNNEL_SUFFIX} в зоне ${ZONE} — укажи CF_TUNNEL_ID`);
    }
  }
  const tunnel = await cf('GET', `/accounts/${accountId}/cfd_tunnel/${tunnelId}`);
  log(`✓ туннель «${tunnel.name}» (${tunnel.id}), статус ${tunnel.status}, конфиг: ${tunnel.remote_config ? 'в панели Cloudflare' : 'локальный config.yml'}`);

  // 3. Правило ingress.
  let ingressDone = false;
  if (tunnel.remote_config) {
    const conf = await cf('GET', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`);
    const config = conf?.config || {};
    const ingress = Array.isArray(config.ingress) ? config.ingress.slice() : [];
    const { service, from } = deriveService(ingress);
    const existing = ingress.findIndex((r) => r.hostname === HOST);
    if (existing >= 0 && ingress[existing].service === service) {
      log(`✓ правило ${HOST} → ${service} уже есть`);
      ingressDone = true;
    } else if (existing >= 0 && !FORCE) {
      die(`правило ${HOST} уже есть, но ведёт на ${ingress[existing].service}, а не ${service}. Запусти с --force, чтобы заменить.`);
    } else {
      if (existing >= 0) ingress[existing] = { ...ingress[existing], service };
      else {
        // Новое правило — перед финальной заглушкой (правилом без hostname), иначе в конец и добавить заглушку.
        const catchAll = ingress.length && !ingress[ingress.length - 1].hostname && !ingress[ingress.length - 1].path;
        const rule = { hostname: HOST, service, originRequest: {} };
        if (catchAll) ingress.splice(ingress.length - 1, 0, rule);
        else ingress.push(rule, { service: 'http_status:404' });
      }
      plan(`правило туннеля ${HOST} → ${service} (${from})`);
      if (APPLY) {
        await cf('PUT', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, { config: { ...config, ingress } });
        log(`✓ правило добавлено (было правил: ${config.ingress?.length ?? 0}, стало: ${ingress.length})`);
        ingressDone = true;
      }
    }
  } else {
    log(`! туннель читает локальный config.yml — правило ingress надо дописать на хосте с cloudflared,
  перед финальным «- service: http_status:404»:

    - hostname: ${HOST}
      service: http://localhost:${PORT}     # или http://192.168.88.147:${PORT}, если cloudflared на другом хосте

  затем: systemctl restart cloudflared`);
  }

  // 4. DNS: CNAME на туннель.
  const target = `${tunnelId}${TUNNEL_SUFFIX}`;
  const same = await cfList(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(HOST)}`);
  const current = same.find((r) => r.name === HOST);
  if (current && current.type === 'CNAME' && current.content === target && current.proxied) {
    log(`✓ DNS ${HOST} → ${target} (проксируется) уже есть`);
  } else if (current && !FORCE) {
    die(`для ${HOST} уже есть запись ${current.type} → ${current.content}${current.proxied ? '' : ' (не проксируется)'}. Запусти с --force, чтобы заменить.`);
  } else {
    const body = { type: 'CNAME', name: HOST, content: target, proxied: true, ttl: 1, comment: 'Warsaw walk generator (upupa-guide container, port 8090)' };
    plan(`DNS ${current ? 'заменить' : 'создать'}: CNAME ${HOST} → ${target}, proxied`);
    if (APPLY) {
      if (current) await cf('PUT', `/zones/${zone.id}/dns_records/${current.id}`, body);
      else await cf('POST', `/zones/${zone.id}/dns_records`, body);
      log('✓ DNS-запись готова');
    }
  }

  if (!APPLY) {
    log('\nНичего не изменено. Запусти с --apply.');
    return;
  }
  log(`\nГотово. Когда контейнер запущен на хосте туннеля (docker compose up -d в guide/):
  curl -s https://${HOST}/api/health${ingressDone ? '' : '\n  (не забудь правило в config.yml — см. выше)'}`);
}

main().catch((err) => die(err?.stack || String(err)));
