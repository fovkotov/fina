import { handleApiRequest } from "./index.js";
import type { Env } from "./db.js";

declare const process: { env: Record<string, string | undefined> };

/** Общий Web-хендлер для файлов в /api: Vercel роутит только по реальному пути файла. */
export default {
  fetch(request: Request): Promise<Response> {
    return handleApiRequest(request, process.env as unknown as Env);
  },
};
