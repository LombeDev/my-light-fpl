import { json, type Bg, type Env, type Snapshot } from "./fpl";

const FPL = "https://fantasy.premierleague.com/api";
const UA = { "User-Agent": "fpl-site/1.0", Accept: "application/json" };

/** Overall league, used as the source of top managers. Change this if FPL moves it. */
const OVERALL_LEAGUE = 314;
const PAGE = 50;
const TARGET = 500; // top managers sampled per gameweek
const BATCH = 40; // picks per refresh; with the standings page, this stays under 50 requests
const EVERY_MS = 5 * 60_000; // at most one sampling batch every five minutes
/** Pairs kept in KV. Capped to stay within the free plan's per-request CPU limit. */
const MAX_PAIRS = 5_000;

const CHIP_NAMES: Record<string, string> = {
  wildcard: "Wildcard",
  freehit: "Free Hit",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
  manager: "Assistant Manager",
};

interface Picks {
  active_chip: string | null;
  picks: { element: number; position: number; is_captain: boolean; is_vice_captain: boolean }[];
}

interface Standing {
  entry: number;
  entry_name: string;
  player_name: string;
  rank: number;
  total: number;
  event_total: number;
}

interface StandingsPage {
  standings: { has_next: boolean; results: Standing[] };
}

export interface SampleState {
  gw: number;
  pages: number;
  pending: number[];
  seen: number;
  skipped: number;
  owned: Record<string, number>;
  captain: Record<string, number>;
  vice: Record<string, number>;
  chips: Record<string, number>;
  /** "a-b" with a < b, counting managers whose 15-player squad contains both. */
  pairs: Record<string, number>;
  updated: string;
}

const bump = (m: Record<string, number>, key: number | string): void => {
  const k = String(key);
  m[k] = (m[k] ?? 0) + 1;
};

const pct = (n: number, of: number): number => (of > 0 ? Math.round((n / of) * 1000) / 10 : 0);

function currentGw(snap: Snapshot): number {
  return (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? 1;
}

/** True at most once per `everyMs` in this data centre. Uses the Cache API, so it costs no KV writes. */
async function throttle(key: string, everyMs: number): Promise<boolean> {
  const cache = caches.default;
  const url = `https://throttle.internal/${key}`;
  const hit = await cache.match(url);
  const last = hit ? Number(await hit.text()) : 0;
  const now = Date.now();
  if (now - last < everyMs) return false;
  await cache.put(url, new Response(String(now), { headers: { "Cache-Control": "max-age=86400" } }));
  return true;
}

function fresh(gw: number): SampleState {
  return {
    gw,
    pages: 0,
    pending: [],
    seen: 0,
    skipped: 0,
    owned: {},
    captain: {},
    vice: {},
    chips: {},
    pairs: {},
    updated: "",
  };
}

async function picksFor(entry: number, gw: number): Promise<Picks | null> {
  const res = await fetch(`${FPL}/entry/${entry}/event/${gw}/picks/`, { headers: UA });
  return res.ok ? ((await res.json()) as Picks) : null;
}

async function runBatch(env: Env): Promise<void> {
  const snap = await env.FPL_KV.get<Snapshot>("snapshot", "json");
  if (!snap) return;
  const gw = currentGw(snap);

  let st = await env.FPL_KV.get<SampleState>("sample", "json");
  if (!st || st.gw !== gw) st = fresh(gw);
  if (!st.pairs) st.pairs = {};

  const maxPages = TARGET / PAGE;
  if (st.seen >= TARGET) return;
  if (st.pages >= maxPages && st.pending.length === 0) return;

  // One standings page per batch, only when the queue is running low.
  if (st.pending.length < BATCH && st.pages < maxPages) {
    st.pages += 1;
    const res = await fetch(
      `${FPL}/leagues-classic/${OVERALL_LEAGUE}/standings/?page_standings=${st.pages}`,
      { headers: UA },
    );
    if (res.ok) {
      const data = (await res.json()) as StandingsPage;
      st.pending.push(...data.standings.results.map((r) => r.entry));
    }
  }

  const batch = st.pending.splice(0, BATCH);
  const results = await Promise.all(batch.map((id) => picksFor(id, gw).catch(() => null)));

  for (const p of results) {
    if (!p || !Array.isArray(p.picks)) {
      st.skipped += 1;
      continue;
    }
    st.seen += 1;

    const ids = p.picks.map((x) => x.element);
    for (const pk of p.picks) {
      bump(st.owned, pk.element);
      if (pk.is_captain) bump(st.captain, pk.element);
      if (pk.is_vice_captain) bump(st.vice, pk.element);
    }

    // Every pair in this squad, bench included, counted once per manager.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        bump(st.pairs, ids[i] < ids[j] ? `${ids[i]}-${ids[j]}` : `${ids[j]}-${ids[i]}`);
      }
    }

    if (p.active_chip) bump(st.chips, p.active_chip);
  }

  // Keep the most common pairs only, so the stored record stays small.
  if (Object.keys(st.pairs).length > MAX_PAIRS) {
    const keep = Object.entries(st.pairs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PAIRS);
    st.pairs = Object.fromEntries(keep);
  }

  st.updated = new Date().toISOString();
  await env.FPL_KV.put("sample", JSON.stringify(st));
}

/** Starts a sampling batch in the background, at most once every five minutes. */
export async function ensureSample(env: Env, bg: Bg): Promise<void> {
  if (!(await throttle("sample", EVERY_MS))) return;
  bg.waitUntil(runBatch(env).catch((err: unknown) => console.error("sample batch failed:", err)));
}

/** Current sample totals, as percentages. Also starts a batch if one is due. */
export async function sampleSummary(env: Env, bg: Bg): Promise<Response> {
  await ensureSample(env, bg);

  const snap = await env.FPL_KV.get<Snapshot>("snapshot", "json");
  if (!snap) return json({ error: "Not available yet." }, 503);
  const gw = currentGw(snap);

  const st = await env.FPL_KV.get<SampleState>("sample", "json");
  const s = st && st.gw === gw ? st : null;
  const n = s ? s.seen : 0;

  const shares = (counts: Record<string, number>) =>
    Object.fromEntries(Object.entries(counts).map(([k, c]) => [k, pct(c, n)]));

  const chips = s
    ? Object.entries(s.chips)
        .map(([key, managers]) => ({
          key,
          name: CHIP_NAMES[key] ?? key,
          managers,
          pct: pct(managers, n),
        }))
        .sort((a, b) => b.managers - a.managers)
    : [];

  const pairs = s
    ? Object.entries(s.pairs ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([key, managers]) => {
          const [a, b] = key.split("-").map(Number);
          return { a, b, managers, pct: pct(managers, n) };
        })
    : [];

  return new Response(
    JSON.stringify({
      gw,
      sampled: n,
      target: TARGET,
      skipped: s?.skipped ?? 0,
      updated: s?.updated ?? null,
      owned: s ? shares(s.owned) : {},
      captain: s ? shares(s.captain) : {},
      vice: s ? shares(s.vice) : {},
      chips,
      pairs,
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } },
  );
}

/** Players most often owned alongside one player. Share is of that player's owners. */
export async function pairsFor(id: number, env: Env, bg: Bg): Promise<Response> {
  await ensureSample(env, bg);

  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" };
  const snap = await env.FPL_KV.get<Snapshot>("snapshot", "json");
  if (!snap) return json({ error: "Not available yet." }, 503);
  const gw = currentGw(snap);

  const st = await env.FPL_KV.get<SampleState>("sample", "json");
  if (!st || st.gw !== gw) {
    return new Response(JSON.stringify({ player: id, owners: 0, partners: [] }), { headers });
  }

  const owners = st.owned[String(id)] ?? 0;
  const partners: { id: number; managers: number; pct: number }[] = [];

  for (const [key, managers] of Object.entries(st.pairs ?? {})) {
    const [a, b] = key.split("-").map(Number);
    if (a !== id && b !== id) continue;
    const other = a === id ? b : a;
    partners.push({ id: other, managers, pct: pct(managers, owners) });
  }
  partners.sort((x, y) => y.managers - x.managers);

  return new Response(
    JSON.stringify({ player: id, owners, partners: partners.slice(0, 15) }),
    { headers },
  );
}

/** Five managers either side of a given manager, with DGW and BGW players in each squad. */
export async function around(id: string, env: Env): Promise<Response> {
  const snap = await env.FPL_KV.get<Snapshot>("snapshot", "json");
  if (!snap) return json({ error: "Not available yet." }, 503);
  const gw = currentGw(snap);

  const entryRes = await fetch(`${FPL}/entry/${id}/`, { headers: UA });
  if (!entryRes.ok) return json({ error: "Manager not found." }, 404);
  const entry = (await entryRes.json()) as { summary_overall_rank: number | null };
  if (!entry.summary_overall_rank) return json({ error: "No overall rank yet." }, 404);

  const page = Math.ceil(entry.summary_overall_rank / PAGE);
  const sres = await fetch(
    `${FPL}/leagues-classic/${OVERALL_LEAGUE}/standings/?page_standings=${page}`,
    { headers: UA },
  );
  if (!sres.ok) return json({ error: "Standings unavailable." }, 502);
  const list = ((await sres.json()) as StandingsPage).standings.results;

  const idx = list.findIndex((r) => r.entry === Number(id));
  if (idx < 0) return json({ error: "Could not place you in the standings." }, 404);
  const nearby = list.slice(Math.max(0, idx - 5), idx + 6);

  // Fixtures per team in this gameweek: 2 or more means a double, 0 means a blank.
  const perTeam = new Map<number, number>();
  for (const f of snap.fixtures) {
    if (f.gw !== gw) continue;
    perTeam.set(f.home, (perTeam.get(f.home) ?? 0) + 1);
    perTeam.set(f.away, (perTeam.get(f.away) ?? 0) + 1);
  }
  const players = new Map(snap.players.map((p) => [p.id, p]));

  const picks = await Promise.all(nearby.map((r) => picksFor(r.entry, gw).catch(() => null)));

  const rows = nearby.map((r, i) => {
    const pk = picks[i];
    let dgw = 0;
    let bgw = 0;
    let captain = "";
    if (pk) {
      for (const x of pk.picks) {
        const p = players.get(x.element);
        if (!p) continue;
        const n = perTeam.get(p.team) ?? 0;
        if (n >= 2) dgw += 1;
        else if (n === 0) bgw += 1;
        if (x.is_captain) captain = p.web_name;
      }
    }
    return {
      entry: r.entry,
      manager: r.player_name,
      team: r.entry_name,
      rank: r.rank,
      total: r.total,
      gw: r.event_total,
      dgw: pk ? dgw : null,
      bgw: pk ? bgw : null,
      captain,
      you: r.entry === Number(id),
    };
  });

  return new Response(JSON.stringify({ gw, rows }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
  });
}
