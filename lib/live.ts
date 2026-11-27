import { json, type Env, type Snapshot } from "./fpl";

const FPL = "https://fantasy.premierleague.com/api";
const UA = { "User-Agent": "fpl-site/1.0", Accept: "application/json" };
const MAX_IDS = 10;

interface Pick {
  element: number;
  position: number;
  multiplier: number;
  is_captain: boolean;
}

interface Picks {
  active_chip: string | null;
  picks: Pick[];
  entry_history?: { event_transfers_cost: number };
}

interface Bootstrap {
  elements: { id: number; ep_this: string }[];
}

interface LiveFile {
  gw: number;
  deltas: { e: number; p: number }[];
}

export interface ScoreRow {
  entry: number;
  gross: number;
  hits: number;
  remaining: { low: number; exp: number; high: number };
  captain: number | null;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

const currentGw = (snap: Snapshot): number | null =>
  (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next) ?? snap.events[0])?.id ?? null;

/** Expected points for this gameweek, per player. Cached at the edge for five minutes. */
async function expectedPoints(): Promise<Map<number, number>> {
  const res = await fetch(`${FPL}/bootstrap-static/`, {
    headers: UA,
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`bootstrap-static: HTTP ${res.status}`);
  const boot = (await res.json()) as Bootstrap;
  return new Map(boot.elements.map((e) => [e.id, Number.parseFloat(e.ep_this) || 0]));
}

/**
 * Share of each team's gameweek still to be played.
 * A fixture not started counts as 1, in play as 0.5, finished as 0. Averaged across a team's fixtures,
 * so a double gameweek is handled, and a blank team gets no entry.
 */
function remainingShare(snap: Snapshot, gw: number): Map<number, number> {
  const sum = new Map<number, number>();
  const count = new Map<number, number>();
  for (const f of snap.fixtures) {
    if (f.gw !== gw) continue;
    const left = f.finished ? 0 : f.started ? 0.5 : 1;
    for (const t of [f.home, f.away]) {
      sum.set(t, (sum.get(t) ?? 0) + left);
      count.set(t, (count.get(t) ?? 0) + 1);
    }
  }
  const share = new Map<number, number>();
  for (const [t, n] of count) share.set(t, (sum.get(t) ?? 0) / n);
  return share;
}

/** Scores up to 10 managers for the current gameweek. Only runs while a match window is open. */
export async function livescore(request: Request, env: Env): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d{1,9}$/.test(s))
        .map(Number),
    ),
  ].slice(0, MAX_IDS);
  if (!ids.length) return json({ error: "Provide up to 10 manager IDs." }, 400);

  const snap = await env.FPL_KV.get<Snapshot>("snapshot", "json");
  if (!snap) return json({ error: "Not available yet." }, 503);
  const gw = currentGw(snap);
  if (gw === null) return json({ error: "No gameweek available." }, 503);

  const live = await env.FPL_KV.get<LiveFile>("live", "json");
  const isLive = !!live && live.gw === gw;
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=20" };

  // Outside match windows there is nothing to project, so skip the FPL calls entirely.
  if (!isLive) return new Response(JSON.stringify({ gw, live: false, rows: [] }), { headers });

  const played = new Map((live?.deltas ?? []).map((d) => [d.e, d.p]));
  const ep = await expectedPoints();
  const teamOf = new Map(snap.players.map((p) => [p.id, p.team]));
  const share = remainingShare(snap, gw);

  const rows = await Promise.all(
    ids.map(async (entry): Promise<ScoreRow | null> => {
      const res = await fetch(`${FPL}/entry/${entry}/event/${gw}/picks/`, {
        headers: UA,
        cf: { cacheTtl: 20 },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Picks;
      const benchBoost = data.active_chip === "bboost";

      let gross = 0;
      let rem = 0;
      let captain: number | null = null;

      for (const pk of data.picks) {
        if (pk.is_captain) captain = pk.element;
        if (pk.position > 11 && !benchBoost) continue; // bench only counts with Bench Boost
        const team = teamOf.get(pk.element);
        const left = team === undefined ? 0 : (share.get(team) ?? 0);
        gross += (played.get(pk.element) ?? 0) * pk.multiplier;
        rem += (ep.get(pk.element) ?? 0) * left * pk.multiplier;
      }

      return {
        entry,
        gross,
        hits: data.entry_history?.event_transfers_cost ?? 0,
        remaining: { low: r1(rem * 0.5), exp: r1(rem), high: r1(rem * 1.5) },
        captain,
      };
    }),
  );

  return new Response(
    JSON.stringify({ gw, live: true, rows: rows.filter((r): r is ScoreRow => r !== null) }),
    { headers },
  );
}
