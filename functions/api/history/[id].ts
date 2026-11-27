/* history/[id].ts: a manager's season history from FPL's public entry history.
   Returns past seasons (points and finish) and this season's gameweeks. Cached at the edge.
   Lives beside the main API route, so that file is not changed. */

const FPL = "https://fantasy.premierleague.com/api";
const UA = { "User-Agent": "fpl-site/1.0", Accept: "application/json" };

interface RawHistory {
  current?: {
    event: number;
    points: number;
    total_points: number;
    overall_rank: number | null;
    value: number;
    event_transfers: number;
    event_transfers_cost: number;
    points_on_bench: number;
  }[];
  past?: { season_name: string; total_points: number; rank: number | null }[];
}

const json = (body: unknown, status = 200, cache = "no-store"): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cache },
  });

export const onRequestGet: PagesFunction<unknown, "id"> = async (ctx) => {
  const id = String(ctx.params.id ?? "");
  if (!/^\d{1,9}$/.test(id)) return json({ error: "Enter a numeric FPL team ID." }, 400);

  const res = await fetch(`${FPL}/entry/${id}/history/`, {
    headers: UA,
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!res.ok) {
    return json({ error: res.status === 404 ? "No FPL team found with that ID." : "History is not available right now." }, res.status === 404 ? 404 : 502);
  }

  const data = (await res.json()) as RawHistory;

  const past = (data.past ?? []).map((p) => ({
    season: p.season_name,
    points: p.total_points,
    rank: p.rank,
  }));

  const current = (data.current ?? []).map((c) => ({
    gw: c.event,
    points: c.points,
    totalPoints: c.total_points,
    rank: c.overall_rank,
    value: c.value,
    transfers: c.event_transfers,
    hit: c.event_transfers_cost,
    bench: c.points_on_bench,
  }));

  return json({ past, current }, 200, "public, max-age=3600");
};
