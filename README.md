# ФИНА — совместный счёт

iOS 26 + веб (Next.js + shadcn) на **одной общей базе**.

## Вход

- Код: `FINA26`
- PIN: `1425`
- Имя: **Аня** / **Андрей**

## Архитектура

- `web/` — Next.js App Router, shadcn UI, torph (morph текста), cuelume (звуки); на прод собирается статикой
- `worker/` — API на Cloudflare Worker, там же лежит секрет `GITHUB_TOKEN`
- Общая БД: GitHub Gist (`FINA_GIST_ID` + `GITHUB_TOKEN`)
- `ios/` — SwiftUI iOS 26, Quick Actions, App Intents, Control Center widgets

## Прод

- Веб: **https://fovkotov.github.io/fina/** (GitHub Pages, workflow `.github/workflows/pages.yml`)
- API: **https://fina-api.fovkotov.workers.dev**
- Адрес API для сборки Pages лежит в переменной репозитория `FINA_API_BASE`

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

В iOS → Ещё → API URL: `https://fina-api.fovkotov.workers.dev`

## iOS

```bash
cd ios && xcodegen generate
open Fina.xcodeproj
```

### Quick Actions

- Spotlight: «Внести в ФИНА» / «Списать в ФИНА»
- Долгий тап по иконке → Внесение / Списание
- Control Center → добавить «ФИНА · Внесение/Списание»
- Deep link: `fina://add?type=deposit|withdrawal`

> Двойной клик кнопки питания зарезервирован Apple Pay. Повесь контролы ФИНА в Control Center или на Action Button.

## TestFlight

Сейчас аккаунт — **Personal Team** (`KTU66V4H4X`). TestFlight на бесплатном Personal Team недоступен — нужен платный Apple Developer Program ($99). После оплаты:

1. Создай App ID `com.fina.app` в developer.apple.com
2. Создай приложение в App Store Connect
3. Archive в Xcode → Distribute → TestFlight

## Данные

Сид из Google Sheets «ФИНА» (актуально):

- Аня: 1 102 513,52 ₽
- Андрей: 926 185,37 ₽
- + проценты / кэшбэк / изи мани
