# AGENTS.md

## Cursor Cloud specific instructions

FINA is a joint-account finance web app. See `README.md` for product/login details and
`web/AGENTS.md` for the (non-standard) Next.js version rules. Two services:

- `web/` — Next.js (App Router) UI. Dev: `cd web && NEXT_PUBLIC_API_BASE=http://localhost:8787 npm run dev` → http://localhost:3000
- `worker/` — Cloudflare Worker API + static-asset host. Dev: `cd worker && npx wrangler dev --port 8787` → http://localhost:8787

Dependencies live in each subpackage and are installed by the startup update script
(`npm install` in `web/` and `worker/`). There is no root install.

### Non-obvious caveats

- `wrangler dev` refuses to start unless the `assets.directory` (`web/out`) exists. That
  folder is gitignored and normally produced by `npm run build:cf`. For local API dev you
  don't need the real export — just create a placeholder once:
  `mkdir -p web/out && [ -f web/out/index.html ] || echo '<!doctype html>' > web/out/index.html`
- The worker reads/writes the shared DB from a GitHub Gist and requires a `GITHUB_TOKEN`
  with access to that gist. Provide it to `wrangler dev` via a gitignored `worker/.dev.vars`
  file (wrangler auto-loads it): `GITHUB_TOKEN=<token>`. `FINA_GIST_ID` is already set in
  `wrangler.toml`; override it in `.dev.vars` only to point at a different gist.
  Without a token, `/api/health` works but `/api/auth/login` and `/api/bootstrap` return
  `{"error":"GITHUB_TOKEN is required for shared DB"}` (HTTP 500). The bundled `gh` token is
  a Cursor bot token and cannot access the production gist.
- Local login (from README): invite code `FINA26`, PIN `1425`, name `Аня` or `Андрей`.
- The startup update script runs `npm ci`, which wipes `node_modules`. If `wrangler dev`
  is already running when deps are reinstalled, its `workerd` runtime crashes (goes defunct)
  and stops serving. Restart the worker after any dependency refresh.
- The frontend defaults to same-origin `/api`; pass `NEXT_PUBLIC_API_BASE=http://localhost:8787`
  when running `next dev` so it talks to the local worker.

### Lint / typecheck / build

- Web lint: `cd web && npm run lint` (repo currently has a pre-existing lint error in
  `src/components/fina-app.tsx`; not caused by setup).
- Web typecheck/build: `cd web && npx tsc --noEmit` or `npm run build`.
- Worker typecheck: `cd worker && npm run typecheck`.
- Deploy is manual for the worker and CI-driven for Pages; see `README.md` and
  `.cursor/rules/ship-to-web.mdc`. Do not run deploys as part of local setup.
