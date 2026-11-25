/* prices.ts: records price, flag, net transfers and progress every two hours.
   Net transfers are counted from the start of each player's current price window (their last price change),
   not from the start of the gameweek. Logs price changes, sets a one-week lock after a red-to-none flag
   change, and scores the model's 95%+ alerts against the changes that happened.
   Keep TIERS and the flag multipliers in line with public/prices.js.
   Storage: pl:last (latest log), pl:events (recent changes), pl:score (accuracy counts). */
import { json, type Bg, type Env, type Snapshot } from "./fpl";

type Player = Snapshot["players"][number];

const LOG_EVERY_MS = 2 * 60 * 60_000; // at most one log every two hours
const WINDOW_MS = 3 * 60 * 60_000; // only score against a previous log this recent
const MAX_EVENTS = 300;
const WEEK_MS = 7 * 24 * 60 * 60_000;
const ALERT_PCT = 95; // progress at which the page says "Likely"
const MAX_STEPS = 3; // at most £0.3m of movement per gameweek

// Ownership tiers: [minOwnershipPct, riseThresholdNet, fallThresholdNet], highest first.
const TIERS: [number, number, number][] = [
  [50.0, 340000, 310000],
  [30.0, 275000, 250000],
  [15.0, 220000, 195000],
  [5.0, 165000, 145000],
  [1.7, 125000, 110000],
  [0.0, 90000, 85000],
];

// Flag multipliers [rise, fall], by FPL status code.
const FLAG_MULT: Record<string, [number, number]> = {
  i: [1.0, 1.25],
  s: [1.05, 1.15],
  u: [1.05, 1.2],
  d: [1.0, 1.1],
};

// n = no flag, a = amber (doubtful), r = red (injured, suspended or unavailable)
type Flag = "n" | "a" | "r";

// [cost in tenths of £m, gameweek net at the last log, ownership %, flag, lock end (ms),
//  predicted progress %, window base (net transfers at the start of the current price window)]
type Row = [number, number, number, Flag, number, number, number];

interface Last {
  t: number;
  players: Record<string, Row>;
}

export interface PriceEvent {
  id: number;
  dir: 1 | -1; // 1 rise, -1 fall
  at: string; // when the change was detected
  cost: number; // new price, tenths of £m
  net: number; // net transfers in the window that caused the change
  own: number; // ownership % at the last log before the change
  pred: number | null; // predicted progress % at the last log before the change
}

interface Score {
  changes: number; // price changes scored
  missed: number; // changes we did not flag at 95%+ in the right direction
  alerts: number; // 95%+ predictions checked
  hits: number; // alerts that came true
  falseAlarms: number; // alerts that did not come true
  updated: string | null;
}

const emptyScore = (): Score => ({ changes: 0, missed: 0, alerts: 0, hits: 0, falseAlarms: 0, updated: null });

function flagOf(p: Player): Flag {
  const s = String(p.status ?? "a").toLowerCase();
  if (s === "i" || s === "s" || s === "u") return "r";
  if (s === "d") return "a";
  return "n";
}

/**
 * Predicted progress for a player, as a percentage of the next change. Mirrors prices.js.
 * windowNet is the net transfers since the player's last price change, so no gameweek deduction is needed.
 */
function modelPct(p: Player, windowNet: number, locked: boolean): number {
  if (locked || !windowNet) return 0;

  const own = Number(p.selected_by_percent) || 0;
  const n = windowNet * (Math.max(0.5, own) > 25 ? 0.92 : 0.95);
  const dir = n > 0 ? 1 : -1;

  const gw = Number(p.cost_change_event) || 0;
  if (dir > 0 ? gw >= MAX_STEPS : gw <= -MAX_STEPS) return 0;

  const tier = TIERS.find(([min]) => own >= min) ?? [0, 90000, 85000];
  const [riseMult, fallMult] = FLAG_MULT[String(p.status ?? "a").toLowerCase()] ?? [1, 1];
  const threshold = dir > 0 ? tier[1] * riseMult : tier[2] * fallMult;

  return (n / threshold) * 100;
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
  const withinWindow = !!last && nowMs - last.t <= WINDOW_MS;

  const players: Record<string, Row> = {};
  const moves = new Map<number, 1 | -1>(); // players whose price changed since the last log

  for (const p of snap.players) {
    const key = String(p.id);
    const net = p.transfers_in - p.transfers_out;
    const flag = flagOf(p);
    const prev = last?.players[key];

    // Keep an existing lock until it runs out.
    let lockUntil = prev && prev.length >= 5 ? prev[4] : 0;

    // The window starts at the first sighting, and restarts at each price change.
    let base = prev && prev.length >= 7 ? prev[6] : net;

    if (prev) {
      if (prev[0] !== p.now_cost) {
        const dir: 1 | -1 = p.now_cost > prev[0] ? 1 : -1;
        moves.set(p.id, dir);
        const prevWindow = prev.length >= 7 ? prev[1] - prev[6] : 0;
        events.push({
          id: p.id,
          dir,
          at: nowIso,
          cost: p.now_cost,
          net: prevWindow,
          own: prev[2],
          pred: prev.length >= 6 ? prev[5] : null,
        });
        // A new window starts at the last log before the change.
        base = prev[1];
      }

      // Red flag straight to no flag: the price is locked for a week.
      if (prev[3] === "r" && flag === "n") lockUntil = nowMs + WEEK_MS;
    }

    const locked = lockUntil > nowMs;
    const windowNet = net - base;
    players[key] = [p.now_cost, net, p.selected_by_percent, flag, lockUntil, modelPct(p, windowNet, locked), base];
  }

  // Score the previous log's 95%+ alerts against the changes in this log.
  // Only scored on change days, and only when the previous log is recent enough to be a fair forecast.
  if (withinWindow && last && moves.size) {
    const score = (await env.FPL_KV.get<Score>("pl:score", "json")) ?? emptyScore();

    for (const [key, row] of Object.entries(last.players)) {
      if (row.length < 6) continue;
      const pred = row[5];
      if (Math.abs(pred) < ALERT_PCT) continue;
      score.alerts += 1;
      if (moves.get(Number(key)) === Math.sign(pred)) score.hits += 1;
      else score.falseAlarms += 1;
    }

    for (const [id, dir] of moves) {
      const row = last.players[String(id)];
      const pred = row && row.length >= 6 ? row[5] : 0;
      const alerted = Math.abs(pred) >= ALERT_PCT && Math.sign(pred) === dir;
      score.changes += 1;
      if (!alerted) score.missed += 1;
    }

    score.updated = nowIso;
    await env.FPL_KV.put("pl:score", JSON.stringify(score));
  }

  if (moves.size) {
    await env.FPL_KV.put("pl:events", JSON.stringify(events.slice(-MAX_EVENTS)));
  }
  await env.FPL_KV.put("pl:last", JSON.stringify({ t: nowMs, players } satisfies Last));
}

/** Starts a log in the background, at most once every two hours. */
export async function recordPrices(env: Env, bg: Bg): Promise<void> {
  if (!(await due("prices-log", LOG_EVERY_MS))) return;
  bg.waitUntil(logOnce(env).catch((err: unknown) => console.error("price log failed:", err)));
}

/**
 * Progress for every player, from the current snapshot and each player's window base.
 * Uses fresh transfer figures, so it is more current than the two-hourly log.
 */
export async function priceProgress(env: Env): Promise<Response> {
  const snap = await env.FPL_KV.get<Snapshot>("snapshot", "json");
  if (!snap) return json({ error: "Not available yet." }, 503);

  const last = await env.FPL_KV.get<Last>("pl:last", "json");
  const now = Date.now();
  const progress: Record<string, number> = {};

  for (const p of snap.players) {
    const row = last?.players[String(p.id)];
    if (!row || row.length < 7) continue; // no window yet, so the client falls back to its own estimate
    const net = p.transfers_in - p.transfers_out;
    const locked = row[4] > now;
    progress[String(p.id)] = Math.round(modelPct(p, net - row[6], locked) * 10) / 10;
  }

  return new Response(JSON.stringify({ t: now, progress }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });
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
        pred: e.pred ?? null,
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

const pctOf = (part: number, whole: number): number | null =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/** Net transfers behind past rises and falls, by ownership band, plus how accurate the model's alerts were. */
export async function priceCalibrate(env: Env): Promise<Response> {
  const events = (await env.FPL_KV.get<PriceEvent[]>("pl:events", "json")) ?? [];
  const score = (await env.FPL_KV.get<Score>("pl:score", "json")) ?? emptyScore();
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

  const accuracy = {
    changes: score.changes,
    alerts: score.alerts,
    hits: score.hits,
    falseAlarms: score.falseAlarms,
    missed: score.missed,
    precision: pctOf(score.hits, score.alerts),
    recall: pctOf(score.changes - score.missed, score.changes),
    updated: score.updated,
  };

  return new Response(
    JSON.stringify({
      events: events.length,
      rises: summarise(rises.map((e) => e.net)),
      falls: summarise(falls.map((e) => e.net)),
      bands,
      accuracy,
      note: "Net transfers are counted from each player's previous price change. Accuracy is an approximation.",
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } },
  );
}
