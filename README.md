# ФИНА — совместный счёт

iOS 26 + веб (Next.js + shadcn) на **одной общей базе**.

## Вход

- Код: `FINA26`
- PIN: `1425`
- Имя: **Аня** / **Андрей**

## Архитектура

- `web/` — Next.js App Router, shadcn UI, torph (morph текста), cuelume (звуки)
- API routes в `web/src/app/api/*`
- Общая БД: GitHub Gist (`FINA_GIST_ID` + `GITHUB_TOKEN`)
- `ios/` — SwiftUI iOS 26, Quick Actions, App Intents, Control Center widgets

## Локальный запуск веба

```bash
cd web
cp .env.example .env.local   # вставь GITHUB_TOKEN (gh auth token)
npm install
npm run dev                  # http://localhost:3000
```

## Деплой на Vercel

Прод уже задеплоен:

- **https://fina-five-sage.vercel.app**
- Env: `GITHUB_TOKEN`, `FINA_GIST_ID`

Локально из `web/`:

```bash
vercel --prod
```

В iOS → Ещё → API URL: `https://fina-five-sage.vercel.app`

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
