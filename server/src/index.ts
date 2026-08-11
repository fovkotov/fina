import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./api.js";
import type { Env } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function envFromProcess(): Env {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_TOKEN is required");
  return {
    GITHUB_TOKEN: token,
    FINA_GIST_ID: process.env.FINA_GIST_ID?.trim() || undefined,
    WEB_URL: process.env.WEB_URL?.trim() || "https://api.fovkotov.lol",
    ALLOWED_ORIGINS:
      process.env.ALLOWED_ORIGINS?.trim() ||
      "https://api.fovkotov.lol,https://app.fovkotov.lol,http://localhost:3000,http://127.0.0.1:8787",
  };
}

const staticCandidates = [
  process.env.STATIC_DIR,
  path.resolve(__dirname, "../public"),
  path.resolve(__dirname, "../../web/out"),
].filter((v): v is string => Boolean(v));

const staticRoot = staticCandidates.find((dir) => existsSync(dir));
if (!staticRoot) {
  throw new Error(
    `Static dir not found. Looked in: ${staticCandidates.join(", ")}`,
  );
}

const env = envFromProcess();
const app = new Hono();

app.all("/api", (c) => handleApi(c.req.raw, env));
app.all("/api/*", (c) => handleApi(c.req.raw, env));

app.use(
  "/*",
  serveStatic({
    root: staticRoot,
    rewriteRequestPath: (p) => {
      // trailingSlash export: /foo/ → /foo/index.html
      if (p.endsWith("/")) return `${p}index.html`;
      return p;
    },
  }),
);

// SPA/static export fallback
app.notFound(async (c) => {
  const index = path.join(staticRoot, "index.html");
  if (!existsSync(index)) return c.text("Not found", 404);
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(index);
  return c.html(html.toString("utf8"));
});

const port = Number(process.env.PORT || 8787);
console.log(`fina-server on :${port}, static=${staticRoot}`);
serve({ fetch: app.fetch, port });
