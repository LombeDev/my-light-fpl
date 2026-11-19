import { json, type Env, type Snapshot } from "./fpl";

const FPL = "https://fantasy.premierleague.com/api";
const UA = { "User-Agent": "fpl-site/1.0", Accept: "application/json" };
const MAX_IDS = 10;

const CHIP: Record<string, string> = {
  wildcard: "WC",
  bboost: "BB",
  freehit: "FH",
  "3xc": "TC",
  manager: "AM",
};

interface Picks {
  active_chip: string | null;
  picks: { element: number; is_captain: boolean; is_vice_captain: boolean }[];
  entry_history?: { points: number };
}

interface History {
  current: { event: number; event_transfers_cost: number; value: number }[];
}

interface Transfer {
  element_in: number;
  element_out: number;
  event: number;
}

export interface ManagerDetail {
  entry: number;
  captain: string;
  vice: string;
  chip: string;
  value: number;
  gross: number;
  hit: number;
  transfers: { out: string; in: string }[];
}

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(`${FPL}/${path}/`, {
    headers: UA,
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  return res.ok ? ((await res.json()) as T) : null;
}

async function detail(entry: number, gw: number, names: Map<number, string>): Promise<ManagerDetail | null> {
  const [picks, history, transfers] = await Promise.all([
    get<Picks>(`entry/${entry}/event/${gw}/picks`),
    get<History>(`entry/${entry}/history`),
    get<Transfer[]>(`entry/${entry}/transfers`),
  ]);
  if (!picks) return null;

  const name = (id: number) => names.get(id) ?? "Unknown";
  const cap = picks.picks.find((p) => p.is_captain);
  const vice = picks.picks.find((p) => p.is_vice_captain);

  // Only use this gameweek's row for the hit, so a finished gameweek's cost is never shown.
  const thisGw = history?.current.find((h) => h.event === gw);
  const latest = history?.current.at(-1);

  return {
    entry,
    captain: cap ? name(cap.element) : "",
    vice: vice ? name(vice.element) : "",
    chip: picks.active_chip ? (CHIP[picks.active_chip] ?? picks.active_chip) : "",
    value: latest?.value ?? 0,
    gross: picks.entry_history?.points ?? 0,
    hit: thisGw?.event_transfers_cost ?? 0,
    transfers: (transfers ?? [])
      .filter((t) => t.event === gw)
      .map((t) => ({ out: name(t.element_out), in: name(t.element_in) })),
  };
}

export async function managers(request: Request, env: Env): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d{1,9}$/.test(s)),
    ),
  ].slice(0, MAX_IDS);
  if (!ids.length) return json({ error: "Provide up to 10 manager IDs." }, 400);

  const snap = await env.FPL_KV.get<Snapshot>("snapshot", "json");
  if (!snap) return json({ error: "Not available yet." }, 503);

  const gw = (snap.events.find((e) => e.current) ?? snap.events.find((e) => e.next))?.id;
  if (!gw) return json({ error: "No gameweek available." }, 503);

  const names = new Map(snap.players.map((p) => [p.id, p.web_name]));
  const found = await Promise.all(ids.map((id) => detail(Number(id), gw, names).catch(() => null)));

  return new Response(
    JSON.stringify({ gw, managers: found.filter((m): m is ManagerDetail => m !== null) }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } },
  );
}
