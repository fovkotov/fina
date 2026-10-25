import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const port = Number(process.env.PORT || 3000);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

// Документ просим положить на edge. Хэшированные файлы из public/
// платформа забирает туда сама и не будит процесс.
const SHELL_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=86400";

function runtimeEnv() {
  return {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "",
    FINA_GIST_ID: process.env.FINA_GIST_ID,
    WEB_URL: process.env.WEB_URL,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  };
}

let apiPromise;

function loadApi() {
  if (!apiPromise) {
    apiPromise = import("./api/index.js").catch((error) => {
      apiPromise = null;
      throw error;
    });
  }
  return apiPromise;
}

function warmApi() {
  loadApi().catch(() => {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function writeHealth(req, res) {
  const origin = req.headers.origin || "*";
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "Authorization,Content-Type",
    "access-control-max-age": "86400",
    vary: "Origin",
  });
  res.end('{"ok":true,"service":"fina"}');
}

async function fileToServe(urlPath) {
  const rel = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(path.join(root, rel));
  if (normalized !== root && !normalized.startsWith(root + path.sep)) return null;

  let target = normalized;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, "index.html");
  } catch {
    if (path.extname(rel)) return null;
    target = path.join(root, "index.html");
  }

  try {
    await stat(target);
  } catch {
    return null;
  }
  return target;
}

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `http://${host}`);

    if (url.pathname === "/api/health") {
      warmApi();
      writeHealth(req, res);
      return;
    }

    if (url.pathname.startsWith("/api")) {
      const { handleApiRequest } = await loadApi();
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(url, {
        method: req.method,
        headers,
        body: hasBody ? await readBody(req) : undefined,
      });
      const response = await handleApiRequest(request, runtimeEnv());
      const body = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(body);
      return;
    }

    const file = await fileToServe(url.pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const hashed = file.includes(`${path.sep}_next${path.sep}`);
    const html = path.extname(file) === ".html";
    if (html) warmApi();
    res.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream",
      "cache-control": hashed
        ? "public, max-age=31536000, immutable"
        : html
          ? SHELL_CACHE
          : "no-cache",
    });
    createReadStream(file).pipe(res);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : "error");
  }
});

server.listen(port, "0.0.0.0");
