export const JUMP_WIDTH = 360;
export const JUMP_HEIGHT = 580;
export const JUMP_HZ = 60;
export const JUMP_MAX_TICKS = JUMP_HZ * 600;
const PLAYER_RADIUS = 13;

export type PlatformKind = "normal" | "cracked" | "boots" | "helicopter";
type Platform = { x: number; y: number; width: number; kind: PlatformKind; broken?: boolean };

export function createJump(seed: number) {
  return {
    seed: seed >>> 0,
    x: JUMP_WIDTH / 2,
    y: 64,
    vx: 0,
    vy: 8.6,
    peak: 64,
    camera: 0,
    platforms: [{ x: 125, y: 48, width: 110, kind: "normal" }] as Platform[],
    lastY: 48,
    lastX: 180,
    ticks: 0,
    boots: 0,
    flight: 0,
    done: false,
  };
}

export type Jump = ReturnType<typeof createJump>;

function random(game: Jump) {
  game.seed = (Math.imul(game.seed, 1664525) + 1013904223) >>> 0;
  return game.seed / 4294967296;
}

function populate(game: Jump) {
  while (game.lastY < game.camera + JUMP_HEIGHT + 120) {
    const difficulty = Math.min(game.lastY / 2500, 1);
    const width = 87;
    game.lastY += 52 + difficulty * 21 + random(game) * (27 - 2 * difficulty);
    const offset = (random(game) - 0.5) * (115 + difficulty * 108);
    const nearEdge = game.lastX < 55 || game.lastX > 305;
    const wrapJump = game.lastY > 4500 && nearEdge && random(game) < 0.045;
    if (wrapJump) {
      game.lastX = game.lastX < 55 ? 316 : 44;
    } else {
      game.lastX = Math.max(32, Math.min(328, game.lastX + offset));
    }
    const roll = random(game);
    const kind = game.lastY < 250 ? "normal"
      : roll < 0.035 ? "helicopter"
      : roll < 0.105 ? "boots"
      : roll < 0.29 + difficulty * 0.13 ? "cracked"
      : "normal";
    game.platforms.push({ x: game.lastX - width / 2, y: game.lastY, width, kind });
  }
}

export function stepJump(game: Jump, input: number) {
  if (game.done) return;
  game.ticks++;
  populate(game);
  game.vx += (input * 0.82 - game.vx) * 0.21;
  game.x = (game.x + game.vx + JUMP_WIDTH) % JUMP_WIDTH;
  const before = game.y;
  if (game.flight > 0) {
    game.flight--;
    game.vy = 11;
  } else {
    game.vy -= 0.36;
  }
  game.y += game.vy;
  for (const p of game.platforms) {
    if (p.kind !== "boots" && p.kind !== "helicopter") continue;
    const dx = Math.abs(game.x - (p.x + p.width / 2));
    const dy = Math.abs(game.y - (p.y + 12));
    if (Math.hypot(dx, dy) > PLAYER_RADIUS + 12) continue;
    if (p.kind === "boots") {
      game.boots = 2;
      game.vy = Math.max(game.vy, 13.2);
    } else {
      game.flight = 108;
      game.vy = 11;
    }
    p.kind = "normal";
  }
  if (game.vy < 0) {
    for (let i = game.platforms.length - 1; i >= 0; i--) {
      const p = game.platforms[i];
      if (p.broken || before - PLAYER_RADIUS < p.y || game.y - PLAYER_RADIUS > p.y) continue;
      if (game.x + PLAYER_RADIUS < p.x || game.x - PLAYER_RADIUS > p.x + p.width) continue;
      game.y = p.y + PLAYER_RADIUS;
      if (p.kind === "cracked") p.broken = true;
      game.vy = game.boots > 0 ? 13.2 : 8.9;
      if (game.boots > 0) game.boots--;
      break;
    }
  }
  game.peak = Math.max(game.peak, game.y);
  game.camera = Math.max(game.camera, game.y - JUMP_HEIGHT * 0.58);
  while (game.platforms.length && game.platforms[0].y < game.camera - 48) game.platforms.shift();
  game.done = game.y < game.camera - PLAYER_RADIUS || game.ticks >= JUMP_MAX_TICKS;
}

export function jumpScore(game: Jump) {
  return Math.max(0, Math.floor(game.peak - 64));
}

export function verifyJump(seed: number, tape: string) {
  if (!tape.length || tape.length > JUMP_MAX_TICKS) return null;
  const game = createJump(seed);
  for (let i = 0; i < tape.length; i++) {
    const input = tape.charCodeAt(i) - 53;
    if (game.done || input < -5 || input > 5) return null;
    stepJump(game, input);
  }
  return game.done ? jumpScore(game) : null;
}
