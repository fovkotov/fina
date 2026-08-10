# ФИНА — совместный счёт

Веб-кабинет на Next.js + shadcn. Мобильного приложения нет — всё живёт в браузере.

## Вход

- Код: `FINA26`
- PIN: `1425`
- Имя: **Аня** / **Андрей**

## Архитектура

- `web/` — Next.js App Router, shadcn UI, torph (morph текста), cuelume (звуки); на прод собирается статикой
- `worker/` — API + раздача кабинета на Cloudflare Worker, там же лежит секрет `GITHUB_TOKEN`
- Общая БД: GitHub Gist (`FINA_GIST_ID` + `GITHUB_TOKEN`)

## Прод

- Кабинет и API: **https://api.fovkotov.lol/** (один Cloudflare Worker + static assets)
- Запасной API: https://fina-api.fovkotov.workers.dev (без VPN часто режется)
- Запасной кабинет: https://fovkotov.github.io/fina/ (GitHub Pages, без VPN часто не открывается)
- Адрес API для сборки Pages лежит в переменной репозитория `FINA_API_BASE`

### Почему не github.io / workers.dev

Российские операторы режут и `*.workers.dev`, и часто `*.github.io` по SNI/IP:
страница не грузится или API падает с `Load failed`. Поэтому и кабинет, и API
отвечают на своих доменах в зоне `fovkotov.lol` (зона делегирована на Cloudflare,
регистрация осталась в REG.RU).

Записи личного сайта в этой зоне стоят серыми (DNS only) — он как жил на GitHub
Pages, так и живёт. `fina.fovkotov.lol` занят личным сайтом; кабинет живёт на
`api.fovkotov.lol` (тот же воркер отдаёт и UI, и `/api`). Поддомен
`app.fovkotov.lol` зарезервирован за воркером, но DNS для него ещё нужно
добавить вручную. Старый адрес `workers.dev` оставлен запасным.

Сборка кабинета для Cloudflare: из корня сайта (без `/fina`), API по умолчанию
тот же origin — запросы идут на `/api/...`. На запасном GitHub Pages в билд
вшит `FINA_API_BASE` (обычно `https://api.fovkotov.lol`).

Если однажды понадобится сменить адрес: поправить `routes` в
`worker/wrangler.toml`, задеплоить воркер (`cd worker && npm run deploy`), затем
при необходимости `gh variable set FINA_API_BASE --body https://новый-адрес` и
`gh workflow run pages.yml`.

Кабинет умеет переключаться на другой API и без пересборки: открыть
`https://api.fovkotov.lol/?api=https://…` — адрес запомнится в браузере,
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
cd worker && npm run deploy   # статика web/out + API на app/api.fovkotov.lol
git push origin main          # запасной GitHub Pages
```

Секрет обновляется так: `cd worker && npx wrangler secret put GITHUB_TOKEN`.

## Данные

Сид из Google Sheets «ФИНА» (актуально):

- Аня: 1 102 513,52 ₽
- Андрей: 926 185,37 ₽
- + проценты / кэшбэк / изи мани
