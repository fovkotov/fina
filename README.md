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

CLI в этой среде ломается на TLS, поэтому:

1. Открой [vercel.com/new](https://vercel.com/new)
2. Import GitHub repo `fovkotov/fina`, Root Directory = `web`
3. Env vars:
   - `GITHUB_TOKEN` — токен с scope `gist`
   - `FINA_GIST_ID` = `9ae03be0b8cb1a5a2d1818bd4492c8ea`
4. Deploy

После деплоя в iOS → Ещё → API URL вставь `https://your-app.vercel.app`

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

Нужен платный Apple Developer Program + App Store Connect. Приложение собрано под team `9UNXMK8UZ7` (Development). Для TestFlight:

1. Создай App ID `com.fina.app` в developer.apple.com
2. Создай приложение в App Store Connect
3. Archive в Xcode → Distribute → TestFlight

## Данные

Сид из Google Sheets «ФИНА» (актуально):

- Аня: 1 102 513,52 ₽
- Андрей: 926 185,37 ₽
- + проценты / кэшбэк / изи мани
