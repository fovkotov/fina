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
- API для телефона: **https://fina-api-door.netlify.app** (`relay/`, прокси на воркер)
- Воркер: **https://fina-api.fovkotov.workers.dev** (с домашнего Wi-Fi; мобильные операторы режут Cloudflare)
- `api.fovkotov.lol` сейчас не наш: домен `fovkotov.lol` истёк у REG.RU и смотрит на парковку регистратора. Пока его не продлить, этот адрес мёртв.

Кабинет на каждый заход сам выбирает первый живой `/api/health`. С мобильного без VPN это дверь на Netlify: телефон до Cloudflare не достаёт, Netlify достаёт.

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
