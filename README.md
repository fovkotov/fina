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

- Кабинет: **https://fina.layero.app/** — веб и API на одном адресе (`door/`, сборка `npm run door:build`). С телефона без VPN это тот же адрес. Счёт тот же gist, до GitHub ходит уже сервер, не телефон.
- **https://fovkotov.github.io/fina/** — не кабинет. GitHub Pages (`.github/workflows/pages.yml`) отдаёт одну строку: сервис переехал на https://fina.layero.app/.
- **https://fina-five-sage.vercel.app/** — то же объявление вместо старого веба на Vercel.
- **https://fina-api-door.vercel.app/** и **https://fina-api-door.netlify.app** (`relay/`) на корне показывают ту же строку, а `/api` по-прежнему проксирует воркер.
- Воркер: **https://fina-api.fovkotov.workers.dev** (с домашнего Wi-Fi; мобильные операторы режут Cloudflare)
- `api.fovkotov.lol` сейчас не наш: домен `fovkotov.lol` истёк у REG.RU и смотрит на парковку регистратора. Пока его не продлить, этот адрес мёртв.

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
cd worker && npx wrangler deploy        # API на Cloudflare
npm run door:build                      # кабинет в door/public, затем layero deploy
git push origin main                    # на Pages уедет только объявление о переезде
```

Секрет обновляется так: `cd worker && npx wrangler secret put GITHUB_TOKEN`.

## Данные

Сид из Google Sheets «ФИНА» (актуально):

- Аня: 1 102 513,52 ₽
- Андрей: 926 185,37 ₽
- + проценты / кэшбэк / изи мани
