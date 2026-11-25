/* prices.ts: records each player's price, net transfers and flag every two hours, logs price changes,
   and sets a one-week price lock when a player goes from a red flag straight to no flag.
   Storage: pl:last (latest log), pl:events (recent changes). */
import { json, type Bg, type Env, type Snapshot } from "./fpl";

const LOG_EVERY_MS = 2 * 60 * 60_000; // at most one log every two hours
const MAX_EVENTS = 300;
const WEEK_MS = 7 * 24 * 60 * 60_000;

// n = no flag, a = amber (doubtful), r = red (injured, suspended or unavailable)
type Flag = "n" | "a" | "r";

// [cost in tenths of £m, net transfers at the last log, ownership %, flag, lock end time in ms]
type Row = [number, number, number, Flag, number];

interface Last {
  t: number;
  players: Record<string, Row>;
}

export interface PriceEvent {
  id: number;
  dir: 1 | -1;   // 1 rise, -1 fall
  at: string;    // when the change was detected
  cost: number;  // new price, tenths of £m
  net: number;   // net transfers at the last log before the change
  own: number;   // ownership % at the last log before the change
}

function flagOf(p: Snapshot["players"][number]): Flag {
  const s = String(p.status ?? "a").toLowerCase();
  if (s === "i" || s === "s" || s === "u") return "r";
  if (s === "d") return "a";
  return "n";
}

async function due(key: string, everyMs: number): Promise<boolean> {
  const cache = caches.default;
  const url = `https://throttle.internal/${key}`;
  const hit = await cache.match(url);
  const last = hit ? Number(await hit.text()) : 0;
  const now = Date.now();
  if (now - last < everyMs) return false;
  await cache.put(url, new Response(String(now), { headers: { "Cache-Control": "max-age=86400" } }));
  return true;
}

async function logOnce(env: Env): Promise<void> {
  const snap = await env.FPL_KV.get<Snapshot>("snapshot", "json");
  if (!snap) return;

  const last = await env.FPL_KV.get<Last>("pl:last", "json");
  const events = (await env.FPL_KV.get<PriceEvent[]>("pl:events", "json")) ?? [];
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const players: Record<string, Row> = {};
  let changed = false;

  for (const p of snap.players) {
    const key = String(p.id);
    const net = p.transfers_in - p.transfers_out;
    const flag = flagOf(p);
    const prev = last?.players[key];

    // Keep an existing lock until it runs out.
    let lockUntil = prev && prev.length >= 5 ? prev[4] : 0;

    if (prev) {
      if (prev[0] !== p.now_cost) {
        events.push({
          id: p.id,
          dir: p.now_cost > prev[0] ? 1 : -1,
          at: nowIso,
          cost: p.now_cost,
          net: prev[1],
          own: prev[2],
        });
        changed = true;
      }

      // Red flag straight to no flag: the price is locked for a week.
      if (prev[3] === "r" && flag === "n") {
        lockUntil = nowMs + WEEK_MS;
      }
    }

    players[key] = [p.now_cost, net, p.selected_by_percent, flag, lockUntil];
  }

  if (changed) {
    await env.FPL_KV.put("pl:events", JSON.stringify(events.slice(-MAX_EVENTS)));
  }
  await env.FPL_KV.put("pl:last", JSON.stringify({ t: nowMs, players } satisfies Last));
}

/** Starts a log in the background, at most once every two hours. */
export async function recordPrices(env: Env, bg: Bg): Promise<void> {
  if (!(await due("prices-log", LOG_EVERY_MS))) return;
  bg.waitUntil(logOnce(env).catch((err: unknown) => console.error("price log failed:", err)));
}

/** Recent price changes, newest first, with player and club names, and the current price locks. */
export async function priceEvents(env: Env): Promise<Response> {
  const snap = await env.FPL_KV.get<Snapshot>("snapshot", "json");
  if (!snap) return json({ error: "Not available yet." }, 503);

  const events = (await env.FPL_KV.get<PriceEvent[]>("pl:events", "json")) ?? [];
  const last = await env.FPL_KV.get<Last>("pl:last", "json");
  const players = new Map(snap.players.map((p) => [p.id, p]));
  const teams = new Map(snap.teams.map((t) => [t.id, t]));
  const now = Date.now();

  const locks: Record<string, number> = {};
  for (const [id, row] of Object.entries(last?.players ?? {})) {
    if (row.length >= 5 && row[4] > now) locks[id] = row[4];
  }

  const rows = events
    .slice()
    .reverse()
    .slice(0, 100)
    .map((e) => {
      const p = players.get(e.id);
      const t = p ? teams.get(p.team) : undefined;
      return {
        id: e.id,
        name: p?.web_name ?? "Unknown",
        club: t?.short ?? "",
        code: t?.code ?? null,
        dir: e.dir,
        at: e.at,
        cost: e.cost,
        net: e.net,
        own: e.own,
      };
    });

  return new Response(JSON.stringify({ events: rows, locks }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });
}

interface Summary {
  n: number;
  min: number | null;
  p10: number | null;
  median: number | null;
  p90: number | null;
  max: number | null;
}

function summarise(values: number[]): Summary {
  const v = values.slice().sort((a, b) => a - b);
  if (!v.length) return { n: 0, min: null, p10: null, median: null, p90: null, max: null };
  const at = (q: number) => v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))];
  return { n: v.length, min: v[0], p10: at(0.1), median: at(0.5), p90: at(0.9), max: v[v.length - 1] };
}

// Ownership bands, in percent. Thresholds often differ by how many managers own a player.
const BANDS: [string, number, number][] = [
  ["under 5%", 0, 5],
  ["5% to 20%", 5, 20],
  ["20% to 50%", 20, 50],
  ["50% and over", 50, 101],
];

/** Net transfers behind past rises and falls, overall and by ownership band. */
export async function priceCalibrate(env: Env): Promise<Response> {
  const events = (await env.FPL_KV.get<PriceEvent[]>("pl:events", "json")) ?? [];
  const rises = events.filter((e) => e.dir === 1);
  const falls = events.filter((e) => e.dir === -1);

  const bands = BANDS.map(([label, lo, hi]) => {
    const inBand = (e: PriceEvent) => e.own >= lo && e.own < hi;
    return {
      label,
      rises: summarise(rises.filter(inBand).map((e) => e.net)),
      falls: summarise(falls.filter(inBand).map((e) => e.net)),
    };
  });

  return new Response(
    JSON.stringify({
      events: events.length,
      rises: summarise(rises.map((e) => e.net)),
      falls: summarise(falls.map((e) => e.net)),
      bands,
      note: "Net transfers are measured at the last log before each change, so they are estimates.",
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } },
  );
}
