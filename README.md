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
- API: **https://fina-api.fovkotov.workers.dev**
- Адрес API для сборки Pages лежит в переменной репозитория `FINA_API_BASE`

### `workers.dev` не открывается с мобильного интернета

Российские операторы режут `*.workers.dev` по SNI: сайт с Pages грузится, а любой
запрос к API падает с `Load failed`. Лечится только переездом воркера на свой домен.

1. Купить домен. Проще всего `.com` прямо в Cloudflare Registrar — зона создаётся
 сама. Любой другой регистратор тоже годится, но тогда нужно делегировать NS
 на Cloudflare (`.ru` в Cloudflare Registrar не регистрируется).
2. В `worker/wrangler.toml` добавить кастомный домен:

 ```toml
 routes = [{ pattern = "api.example.ru", custom_domain = true }]
 ```

3. `cd worker && npx wrangler deploy` — сертификат Cloudflare выпустит сам,
 несколько минут.
4. Добавить новый origin в `ALLOWED_ORIGINS`, если фронт переедет следом.
5. Переменную репозитория `FINA_API_BASE` переставить на `https://api.example.ru`
 (`gh variable set FINA_API_BASE --body https://api.example.ru`) и перезапустить
 Pages: `gh workflow run pages.yml`.

Старый адрес продолжает работать, так что переезд ничего не ломает. Проверить
доступность нового: открыть `/api/health` с телефона по мобильному интернету.

Пока домена нет, кабинет можно на лету перевести на любой запасной адрес API:
открыть `https://fovkotov.github.io/fina/?api=https://…` — адрес запомнится
в браузере. `?api=` без значения возвращает всё обратно.

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
