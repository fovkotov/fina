# ФИНА — совместный счёт

Веб-кабинет на Next.js + shadcn. Мобильного приложения нет — всё живёт в браузере.

## Вход

- Код: `FINA26`
- PIN: `1425`
- Имя: **Аня** / **Андрей**

## Архитектура

- `web/` — Next.js App Router, статика
- `server/` — Node (Hono): API + раздача статики, БД в GitHub Gist
- `worker/` — старый Cloudflare Worker (запасной; у части РФ-операторов CF режется по IP)

## Прод без VPN (важно)

`*.workers.dev`, `github.io` и даже custom domain на Cloudflare часто **не открываются
с мобильного интернета в РФ** — режут IP Cloudflare/GitHub. Поэтому прод должен
жить на обычном сервере/PaaS **не на Cloudflare**.

Готовый Docker-образ: `server/Dockerfile` (+ `docker-compose.yml` / `amvera.yml`).

### Вариант A — Amvera (Москва), проще всего

1. https://amvera.ru → создать приложение Docker, привязать этот GitHub-репо.
2. В секретах приложения: `GITHUB_TOKEN` = тот же токен, что был у Worker.
3. Дождаться деплоя, открыть технический домен Amvera — он должен открываться без VPN.
4. Привязать свой домен `api.fovkotov.lol`:
   - Cloudflare → Workers → fina-api → Domains: **удалить** custom domain `api` / `app`
   - DNS: A/CNAME на то, что скажет Amvera, **прокси выключен (серое облако)**

### Вариант B — Timeweb App Platform

1. https://timeweb.cloud/services/apps → Docker Compose из этого репо.
2. Env: `GITHUB_TOKEN=...`
3. Технический домен Timeweb → проверка без VPN → привязка `api.fovkotov.lol` так же.

### Вариант C — свой VPS

```bash
export VPS_SSH_HOST=... VPS_SSH_USER=root
export VPS_SSH_PRIVATE_KEY='...' GITHUB_TOKEN='...'
./server/deploy.sh
```

Потом DNS: A `api` и `app` → IP VPS, облако **серое**.

## Запасные адреса (с VPN / домашний Wi‑Fi)

- Cloudflare: https://api.fovkotov.lol/ (пока ещё привязан к Worker)
- Pages: https://fovkotov.github.io/fina/

## Локальный запуск

```bash
# API + статика (нужен GITHUB_TOKEN)
cd web && CLOUDFLARE=true NEXT_PUBLIC_API_BASE= npm run build:cf
cd ../server && GITHUB_TOKEN=... npm run dev   # http://localhost:8787

# или только веб к локальному API
cd web && NEXT_PUBLIC_API_BASE=http://localhost:8787 npm run dev
```

## Данные

Сид из Google Sheets «ФИНА» (актуально):

- Аня: 1 102 513,52 ₽
- Андрей: 926 185,37 ₽
- + проценты / кэшбэк / изи мани
