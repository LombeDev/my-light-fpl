export interface Env {
  FPL_KV: KVNamespace;
  SECRET: string;
}

export type Bg = { waitUntil(promise: Promise<unknown>): void };

export interface Meta {
  live: boolean;
  gw: number | null;
  nextWake: number | null;
}

interface SlimPlayer {
  id: number;
  web_name: string;
  team: number;
  element_type: number;
  now_cost: number;
  total_points: number;
  form: number;
  selected_by_percent: number;
  expected_goals: number;
  points_per_million: number;
  status: string;
}

interface SlimFixture {
  id: number;
  gw: number | null;
  kickoff: string | null;
  home: number;
  away: number;
  home_score: number | null;
  away_score: number | null;
  started: boolean;
  finished: boolean;
}

export interface Snapshot {
  generatedAt: string;
  hash: string;
  teams: { id: number; name: string; short: string }[];
  positions: { id: number; short: string }[];
  events: { id: number; current: boolean; next: boolean; finished: boolean }[];
  players: SlimPlayer[];
  fixtures: SlimFixture[];
}

export interface Entry {
  name: string;
  player_first_name: string;
  player_last_name: string;
  summary_overall_points: number;
  summary_overall_rank: number | null;
}

interface RawElement {
  id: number;
  web_name: string;
  team: number;
  element_type: number;
  now_cost: number;
  total_points: number;
  form: string;
  selected_by_percent: string;
  expected_goals: string;
  status: string;
}

interface RawFixture {
  id: number;
  event: number | null;
  kickoff_time: string | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  started: boolean;
  finished: boolean;
}

interface RawBootstrap {
  elements: RawElement[];
  teams: { id: number; name: string; short_name: string }[];
  element_types: { id: number; singular_name_short: string }[];
  events: { id: number; is_current: boolean; is_next: boolean; finished: boolean }[];
}

interface RawLive {
  elements: { id: number; stats: { minutes: number; total_points: number; bps: number; bonus: number } }[];
}

const FPL = "https://fantasy.premierleague.com/api";
const UA = { "User-Agent": "fpl-site/1.0", Accept: "application/json" };
const MIN = 60_000;

const num = (v: unknown): number => {
  const n = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function getFpl<T>(path: string): Promise<T> {
  const res = await fetch(`${FPL}/${path}/`, { headers: UA });
  if (!res.ok) throw new Error(`FPL ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function getEntry(id: string): Promise<Entry | null> {
  const res = await fetch(`${FPL}/entry/${id}/`, { headers: UA });
  if (!res.ok) return null;
  const e = (await res.json()) as Entry;
  return {
    name: e.name,
    player_first_name: e.player_first_name,
    player_last_name: e.player_last_name,
    summary_overall_points: e.summary_overall_points,
    summary_overall_rank: e.summary_overall_rank,
  };
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns true if `key` has not run within `everyMs` in this data centre, and marks it as run.
 * Uses the Cache API, so it costs no KV writes.
 */
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

async function maybe(bg: Bg, key: string, everyMs: number, job: () => Promise<void>): Promise<void> {
  if (!(await due(key, everyMs))) return;
  bg.waitUntil(job().catch((err) => console.error(`${key} refresh failed:`, err)));
}

// ---------- Refresh jobs ----------

export async function refreshSnapshot(env: Env): Promise<void> {
  const [boot, fixtures] = await Promise.all([
    getFpl<RawBootstrap>("bootstrap-static"),
    getFpl<RawFixture[]>("fixtures"),
  ]);
  if (!Array.isArray(boot.elements) || boot.elements.length < 500) throw new Error("Unexpected player data");
  if (!Array.isArray(boot.teams) || boot.teams.length < 18) throw new Error("Unexpected team data");
  if (!Array.isArray(fixtures) || fixtures.length < 100) throw new Error("Unexpected fixture data");

  const prev = await env.FPL_KV.get<Snapshot>("snapshot", "json");

  const body = {
    teams: boot.teams.map((t) => ({ id: t.id, name: t.name, short: t.short_name })),
    positions: boot.element_types.map((t) => ({ id: t.id, short: t.singular_name_short })),
    events: boot.events.map((e) => ({ id: e.id, current: e.is_current, next: e.is_next, finished: e.finished })),
    players: boot.elements.map(
      (e): SlimPlayer => ({
        id: e.id,
        web_name: e.web_name,
        team: e.team,
        element_type: e.element_type,
        now_cost: e.now_cost,
        total_points: e.total_points,
        form: round2(num(e.form)),
        selected_by_percent: round2(num(e.selected_by_percent)),
        expected_goals: round2(num(e.expected_goals)),
        points_per_million: e.now_cost > 0 ? round2((e.total_points * 10) / e.now_cost) : 0,
        status: e.status,
      }),
    ),
    fixtures: fixtures.map(
      (f): SlimFixture => ({
        id: f.id,
        gw: f.event,
        kickoff: f.kickoff_time,
        home: f.team_h,
        away: f.team_a,
        home_score: f.team_h_score,
        away_score: f.team_a_score,
        started: f.started,
        finished: f.finished,
      }),
    ),
  };

  const hash = await sha256(JSON.stringify(body));
  if (prev?.hash === hash) return; // nothing changed, so no KV write

  const generatedAt = new Date().toISOString();
  const snap: Snapshot = { generatedAt, hash, ...body };
  await env.FPL_KV.put("snapshot", JSON.stringify(snap));
  await env.FPL_KV.put("version", JSON.stringify({ hash, generatedAt }));
}

export async function refreshState(env: Env): Promise<void> {
  const now = Date.now();
  const fixtures = await getFpl<RawFixture[]>("fixtures");
  if (!Array.isArray(fixtures) || fixtures.length < 100) throw new Error("Unexpected fixture data");

  const prev = await env.FPL_KV.get<Meta>("meta", "json");

  const open = fixtures.filter((f) => !f.finished && f.event !== null);
  const meta: Meta = {
    live: isLive(fixtures, now),
    gw: open.length ? Math.min(...open.map((f) => f.event as number)) : null,
    nextWake: nextWakeAt(fixtures, now),
  };

  if (JSON.stringify(meta) !== JSON.stringify(prev)) {
    await env.FPL_KV.put("meta", JSON.stringify(meta));
  }
  if (prev?.live && !meta.live) {
    await env.FPL_KV.delete("live"); // the match window has ended
  }
}

export async function refreshLive(env: Env, gw: number): Promise<void> {
  const data = await getFpl<RawLive>(`event/${gw}/live`);
  if (!Array.isArray(data.elements)) throw new Error("Unexpected live data");

  const deltas = data.elements
    .filter((el) => el.stats.minutes > 0 || el.stats.total_points !== 0 || el.stats.bps !== 0)
    .map((el) => ({ e: el.id, m: el.stats.minutes, p: el.stats.total_points, b: el.stats.bps, bn: el.stats.bonus }))
    .sort((a, b) => a.e - b.e);

  const hash = await sha256(JSON.stringify(deltas));
  const prev = await env.FPL_KV.get<{ hash: string }>("live", "json");
  if (prev?.hash === hash) return;

  await env.FPL_KV.put("live", JSON.stringify({ gw, hash, deltas }));
}

// ---------- Freshness checks used by the API routes ----------

export async function ensureState(env: Env, bg: Bg): Promise<Meta | null> {
  const meta = await env.FPL_KV.get<Meta>("meta", "json");
  if (!meta) {
    await refreshState(env);
    return env.FPL_KV.get<Meta>("meta", "json");
  }
  const hot = meta.live || (meta.nextWake !== null && Date.now() >= meta.nextWake);
  await maybe(bg, "state", hot ? MIN : 10 * MIN, () => refreshState(env));
  return meta;
}

export async function ensureSnapshot(env: Env, bg: Bg): Promise<void> {
  if (!(await env.FPL_KV.get("version"))) {
    await refreshSnapshot(env);
    return;
  }
  await maybe(bg, "snapshot", 15 * MIN, () => refreshSnapshot(env));
}

export async function ensureLive(env: Env, bg: Bg, gw: number): Promise<void> {
  await maybe(bg, "live", MIN, () => refreshLive(env, gw));
}

// ---------- Schedule helpers ----------

function isLive(fixtures: RawFixture[], now: number): boolean {
  return fixtures.some((f) => {
    if (f.finished || !f.kickoff_time) return false;
    const k = Date.parse(f.kickoff_time);
    return now >= k - 15 * MIN && now <= k + 180 * MIN;
  });
}

function nextWakeAt(fixtures: RawFixture[], now: number): number | null {
  let best: number | null = null;
  for (const f of fixtures) {
    if (f.finished || !f.kickoff_time) continue;
    const start = Date.parse(f.kickoff_time) - 15 * MIN;
    if (start > now && (best === null || start < best)) best = start;
  }
  return best;
}
