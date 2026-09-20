// Расширения обязательны: Vercel не бандлит функции, а Node ESM не дорезолвит путь.
import { handleApiRequest } from "../src/index.js";
import type { Env } from "../src/db.js";

/**
 * Node-рантайм Vercel отдаёт секреты через process.env, а подтянуть сюда
 * @types/node нельзя: его глобальные Request и Response дерутся с типами воркера.
 */
declare const process: { env: Record<string, string | undefined> };

/** Тот же Web-хендлер, что и на воркере: Vercel понимает эту сигнатуру как есть. */
export default {
  fetch(request: Request): Promise<Response> {
    return handleApiRequest(request, process.env as unknown as Env);
  },
};
