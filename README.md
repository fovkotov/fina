# ФИНА — совместный счёт

Веб-кабинет на Next.js + shadcn. Мобильного приложения нет — всё живёт в браузере.

## Вход

- Код: `FINA26`
- PIN: `1425`
- Имя: **Аня** / **Андрей**

## Архитектура

- `web/` — Next.js App Router, shadcn UI, torph (morph текста), cuelume (звуки); на прод собирается статикой
- `worker/` — API на Cloudflare Worker, там же лежит секрет `GITHUB_TOKEN`
- Общая БД: GitHub Gist (`FINA_GIST_ID` + `GITHUB_TOKEN`)

## Прод

- Веб: **https://fovkotov.github.io/fina/** (GitHub Pages, workflow `.github/workflows/pages.yml`)
- API: **https://api.fovkotov.lol** (запасной адрес — https://fina-api.fovkotov.workers.dev)
- Адрес API для сборки Pages лежит в переменной репозитория `FINA_API_BASE`

### Почему API не на `workers.dev`

Российские операторы режут `*.workers.dev` по SNI: сайт с Pages грузится, а запрос
к API падает с `Load failed` — на домашнем Wi-Fi всё работает, с мобильного нет.
Поэтому воркер отвечает на своём домене `api.fovkotov.lol` (зона `fovkotov.lol`
делегирована на Cloudflare, регистрация осталась в REG.RU).

Записи личного сайта в этой зоне стоят серыми (DNS only) — он как жил на GitHub
Pages, так и живёт. Старый адрес `workers.dev` оставлен включённым запасным.

Если однажды понадобится сменить адрес API: поправить `routes` в
`worker/wrangler.toml`, задеплоить воркер, затем
`gh variable set FINA_API_BASE --body https://новый-адрес` и `gh workflow run pages.yml`.

Кабинет умеет переключаться на другой API и без пересборки: открыть
`https://fovkotov.github.io/fina/?api=https://…` — адрес запомнится в браузере,
`?api=` без значения возвращает всё обратно.

## Локальный запуск

API (из `worker/`):

```bash
npm install
npx wrangler dev             # http://localhost:8787
```

Веб (из `web/`):

```bash
npm install
NEXT_PUBLIC_API_BASE=http://localhost:8787 npm run dev   # http://localhost:3000
```

## Деплой

```bash
cd worker && npx wrangler deploy        # API
git push origin main                    # веб уедет на Pages сам
```

Секрет обновляется так: `cd worker && npx wrangler secret put GITHUB_TOKEN`.

## Данные

Сид из Google Sheets «ФИНА» (актуально):

- Аня: 1 102 513,52 ₽
- Андрей: 926 185,37 ₽
- + проценты / кэшбэк / изи мани
