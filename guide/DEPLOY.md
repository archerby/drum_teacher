# Деплой guide.upupa.dev

Один контейнер `upupa-guide` (Node 22 alpine): статика приложения + ручка `/api/mood`.
Порт на хосте **8090** → 8080 в контейнере. Схема та же, что у upupa.dev: Docker Compose
на **LXC 113** (`192.168.88.147`), наружу — через cloudflared.

## 1. Первый запуск на CT113

```bash
cd /root
git clone https://github.com/archerby/drum_teacher.git upupa-guide
cd upupa-guide/guide
# (необязательно) ключ Claude для настроения «своими словами»:
cp .env.example .env && chmod 600 .env && nano .env      # ANTHROPIC_API_KEY=...
docker compose up -d --build
```

Проверка:

```bash
docker compose ps                         # upupa-guide: Up (healthy)
curl -f http://127.0.0.1:8090/api/health  # {"ok":true,"ai":true|false}
```

Без ключа всё работает: свободный текст настроения разбирается офлайн-словарём,
`ai:false` в health — это нормально.

## 2. Поддомен в Cloudflare Tunnel

**Одной командой** (нужен токен: Zone → Zone:Read и DNS:Edit для upupa.dev, Account → Cloudflare Tunnel:Edit):

```bash
export CLOUDFLARE_API_TOKEN=…            # не сохранять в git
node scripts/cf-setup.mjs                # план: что будет изменено
node scripts/cf-setup.mjs --apply        # применить
# без Node на хосте:
docker run --rm -e CLOUDFLARE_API_TOKEN -v "$PWD/scripts:/s:ro" node:22-alpine node /s/cf-setup.mjs --apply
```

Скрипт находит туннель по CNAME `www.upupa.dev`, добавляет правило `guide.upupa.dev` → тот же хост,
что у сайта, порт 8090 (перед финальной заглушкой, остальное не трогает) и создаёт проксируемый
CNAME. Повторный запуск ничего не ломает; чужие записи меняет только с `--force`. Если туннель
на локальном `config.yml` — печатает, что туда дописать.

**Вручную:**

**Туннель управляется из панели** (Zero Trust → Networks → Tunnels → ваш туннель →
Public Hostname → Add a public hostname):

| Поле | Значение |
|---|---|
| Subdomain | `guide` |
| Domain | `upupa.dev` |
| Service | `HTTP` · `localhost:8090` (если cloudflared живёт в CT113) или `192.168.88.147:8090` |

CNAME `guide.upupa.dev` Cloudflare создаст сам.

**Туннель с локальным `config.yml`** — добавить правило *перед* финальным `http_status:404`:

```yaml
ingress:
  - hostname: guide.upupa.dev
    service: http://localhost:8090      # или http://192.168.88.147:8090
  # ... остальные правила ...
  - service: http_status:404
```

```bash
cloudflared tunnel route dns <ИМЯ_ТУННЕЛЯ> guide.upupa.dev
systemctl restart cloudflared
```

Проверка снаружи: `curl -sI https://guide.upupa.dev/` → 200 и
`curl -s https://guide.upupa.dev/api/health`.

## 3. Обновление

```bash
cd /root/upupa-guide && git pull && cd guide && docker compose up -d --build
```

После смены ключа в `.env`: `docker compose up -d --force-recreate`.

## Киоск в музее / отеле / туринфо

Открыть в полноэкранном браузере (например `chromium --kiosk <url>`):

```
https://guide.upupa.dev/?kiosk&from=52.2497,21.0122&lang=pl
```

- `from` — где стоит киоск: координаты или район (`old`, `center`, `powisle`, `praga`, `lazienki`, `muranow`);
- `lang` — язык киоска (`ru`, `en`, `pl`, `uk`, `be`);
- крупный интерфейс, заставка с фактами, сброс через 2 минуты бездействия,
  на экране маршрута — QR-код: посетитель уносит прогулку в свой телефон.

## Заметки

- Контейнер read-only, без root и capabilities; память — только кэш gzip и ответов Claude.
- `/api/mood`: до 12 запросов в минуту с одного IP (по `CF-Connecting-IP`), текст до 300 символов,
  одинаковые запросы кэшируются. Модель — `GUIDE_MODEL` (по умолчанию `claude-opus-5`),
  с серверным откатом на другую модель при отказе. Claude не пишет тексты о местах — только
  переводит пожелание в веса тем; все факты — из проверенного словаря.
- Подложка карты — CARTO (данные © OpenStreetMap), грузится браузером напрямую; разрешена в CSP.
